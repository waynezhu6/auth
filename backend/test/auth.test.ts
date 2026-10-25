import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "net";
import { pool } from "./setup.js";
import { SoftAuthenticator } from "./authenticator.js";
import { createApp } from "../src/app.js";
import { ORIGIN, RP_ID } from "../src/config.js";
import { createInvite } from "../src/invites.js";

const server = createApp({ attemptsPerMinute: 1000 }).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

// A browser: keeps the session cookie and sends Origin like the login page.
class Browser {
  cookie = "";

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(this.cookie && { Cookie: this.cookie }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const value = set.split(";")[0];
      this.cookie = value.endsWith("=") ? "" : value;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: res.status, body: (await res.json()) as any, setCookie: set };
  }

  async signUp(invite: string, name: string, passkey: SoftAuthenticator) {
    const opts = await this.call("POST", "/register/options", { invite, name });
    assert.equal(opts.status, 200, JSON.stringify(opts.body));
    return this.call("POST", "/register/verify", { flow: opts.body.flow, response: passkey.create(opts.body.options), label: "Test key" });
  }

  async signIn(passkey: SoftAuthenticator) {
    const opts = await this.call("POST", "/login/options");
    assert.equal(opts.status, 200);
    return this.call("POST", "/login/verify", { flow: opts.body.flow, response: passkey.get(opts.body.options) });
  }

  async addPasskey(passkey: SoftAuthenticator, body: Record<string, string> = {}) {
    const opts = await this.call("POST", "/register/options", body);
    if (opts.status !== 200) return opts;
    return this.call("POST", "/register/verify", { flow: opts.body.flow, response: passkey.create(opts.body.options) });
  }
}

const inviteToken = async (kind: "signup" | "recovery" = "signup", userId?: string) =>
  (await createInvite(kind, userId)).split("/invite/")[1];

test("health", async () => {
  assert.deepEqual((await new Browser().call("GET", "/health")).body, { status: "ok" });
});

test("signs up with an invite, which then can't be used again", async () => {
  const token = await inviteToken();
  const browser = new Browser();
  assert.deepEqual((await browser.call("GET", `/invites/${token}`)).body, { kind: "signup" });

  const res = await browser.signUp(token, "wayne", new SoftAuthenticator(ORIGIN, RP_ID));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.name, "wayne");
  assert.match(res.setCookie!, /^__Host-auth=[\w-]{43}; Max-Age=\d+; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/);

  const me = await browser.call("GET", "/me");
  assert.equal(me.body.user.name, "wayne");
  assert.equal(me.body.passkeys.length, 1);
  assert.equal(me.body.passkeys[0].name, "Test key");

  assert.equal((await browser.call("GET", `/invites/${token}`)).status, 410);
  const again = await new Browser().call("POST", "/register/options", { invite: token, name: "someone" });
  assert.equal(again.status, 410);
});

test("an invite starts only one account, even if two sign-ups race", async () => {
  const token = await inviteToken();
  const [a, b] = [new Browser(), new Browser()];
  const optsA = await a.call("POST", "/register/options", { invite: token, name: "race-a" });
  const optsB = await b.call("POST", "/register/options", { invite: token, name: "race-b" });
  const resA = await a.call("POST", "/register/verify", { flow: optsA.body.flow, response: new SoftAuthenticator(ORIGIN, RP_ID).create(optsA.body.options) });
  const resB = await b.call("POST", "/register/verify", { flow: optsB.body.flow, response: new SoftAuthenticator(ORIGIN, RP_ID).create(optsB.body.options) });
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 410);
  assert.equal(b.cookie, "");
  const { rows } = await pool.query(`SELECT name FROM users WHERE name LIKE 'race-%'`);
  assert.deepEqual(rows, [{ name: "race-a" }]);
});

test("refuses bad and taken usernames, and sign-up without an invite", async () => {
  const token = await inviteToken();
  const browser = new Browser();
  for (const name of ["Wayne", "a", "-x", "has space", "x".repeat(33), undefined]) {
    assert.equal((await browser.call("POST", "/register/options", { invite: token, name })).status, 400, String(name));
  }
  assert.equal((await browser.call("POST", "/register/options", { invite: token, name: "wayne" })).status, 409);
  assert.equal((await browser.call("POST", "/register/options", { name: "free" })).status, 401);
  assert.equal((await browser.call("POST", "/register/options", { invite: "nonsense", name: "free" })).status, 410);
});

test("signs in with a passkey, and other apps can verify the session", async () => {
  const passkey = new SoftAuthenticator(ORIGIN, RP_ID);
  await new Browser().signUp(await inviteToken(), "signin", passkey);

  const browser = new Browser();
  assert.equal((await browser.call("GET", "/verify")).status, 401);
  const res = await browser.signIn(passkey);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.name, "signin");

  // What an app's backend does: forward the browser's Cookie, no Origin.
  const verified = await fetch(`${base}/api/verify`, { headers: { Cookie: browser.cookie } });
  assert.equal(verified.status, 200);
  assert.equal(verified.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys((await verified.json()) as object).sort(), ["id", "name"]);

  // A second sign-in, so the signature counter has to have moved on.
  assert.equal((await new Browser().signIn(passkey)).status, 200);
  const { rows } = await pool.query(`SELECT counter, last_used_at FROM passkeys WHERE id = $1`, [passkey.id]);
  assert.equal(Number(rows[0].counter), 2);
  assert.ok(rows[0].last_used_at);
});

test("a challenge works once, and only for the ceremony it was made for", async () => {
  const passkey = new SoftAuthenticator(ORIGIN, RP_ID);
  await new Browser().signUp(await inviteToken(), "replay", passkey);

  const browser = new Browser();
  const opts = await browser.call("POST", "/login/options");
  const response = passkey.get(opts.body.options);
  assert.equal((await browser.call("POST", "/login/verify", { flow: opts.body.flow, response })).status, 200);
  assert.equal((await browser.call("POST", "/login/verify", { flow: opts.body.flow, response })).status, 400);

  const login = await browser.call("POST", "/login/options");
  const asRegistration = await browser.call("POST", "/register/verify", { flow: login.body.flow, response: passkey.create({ ...login.body.options, user: { id: "x", name: "x", displayName: "x" } }) });
  assert.equal(asRegistration.status, 400);
});

test("refuses a passkey answer made for another site", async () => {
  const passkey = new SoftAuthenticator(ORIGIN, RP_ID);
  await new Browser().signUp(await inviteToken(), "phished", passkey);
  const browser = new Browser();
  const opts = await browser.call("POST", "/login/options");
  const res = await browser.call("POST", "/login/verify", { flow: opts.body.flow, response: passkey.get(opts.body.options, "https://evil.example") });
  assert.equal(res.status, 401);
  assert.equal(browser.cookie, "");

  const wrongRp = new SoftAuthenticator(ORIGIN, "evil.example");
  const reg = await new Browser().call("POST", "/register/options", { invite: await inviteToken(), name: "wrongrp" });
  const verify = await new Browser().call("POST", "/register/verify", { flow: reg.body.flow, response: wrongRp.create(reg.body.options) });
  assert.equal(verify.status, 400);
});

test("limits attempts per client", async () => {
  const limited = createApp({ attemptsPerMinute: 2 }).listen(0);
  const url = `http://127.0.0.1:${(limited.address() as AddressInfo).port}/api/login/options`;
  const post = (ip: string) => fetch(url, { method: "POST", headers: { Origin: ORIGIN, "X-Real-IP": ip } });
  assert.deepEqual([(await post("1.1.1.1")).status, (await post("1.1.1.1")).status, (await post("1.1.1.1")).status], [200, 200, 429]);
  assert.equal((await post("2.2.2.2")).status, 200);
  limited.close();
});

test("refuses state changes from other origins", async () => {
  const browser = new Browser();
  for (const origin of ["https://evil.example", ""]) {
    const res = await browser.call("POST", "/login/options", undefined, { Origin: origin });
    assert.equal(res.status, 403);
  }
});

test("a deleted passkey can't sign in", async () => {
  const first = new SoftAuthenticator(ORIGIN, RP_ID);
  const second = new SoftAuthenticator(ORIGIN, RP_ID);
  const browser = new Browser();
  await browser.signUp(await inviteToken(), "twokeys", first);
  assert.equal((await browser.addPasskey(second)).status, 200);
  assert.equal((await browser.call("GET", "/me")).body.passkeys.length, 2);

  assert.equal((await browser.call("DELETE", `/passkeys/${encodeURIComponent(first.id)}`)).status, 200);
  assert.equal((await new Browser().signIn(first)).status, 401);
  assert.equal((await new Browser().signIn(second)).status, 200);

  const last = await browser.call("DELETE", `/passkeys/${encodeURIComponent(second.id)}`);
  assert.equal(last.status, 409);
});

test("renames a passkey, but not someone else's", async () => {
  const mine = new SoftAuthenticator(ORIGIN, RP_ID);
  const browser = new Browser();
  await browser.signUp(await inviteToken(), "renamer", mine);
  const other = new Browser();
  const theirs = new SoftAuthenticator(ORIGIN, RP_ID);
  await other.signUp(await inviteToken(), "other", theirs);

  assert.equal((await browser.call("PATCH", `/passkeys/${mine.id}`, { name: "  iPhone  " })).status, 200);
  assert.equal((await browser.call("GET", "/me")).body.passkeys[0].name, "iPhone");
  assert.equal((await browser.call("PATCH", `/passkeys/${theirs.id}`, { name: "mine now" })).status, 404);
  assert.equal((await browser.call("DELETE", `/passkeys/${theirs.id}`)).status, 409);
});

test("a recovery link adds a passkey to an existing account", async () => {
  const lost = new SoftAuthenticator(ORIGIN, RP_ID);
  const signup = await new Browser().signUp(await inviteToken(), "forgetful", lost);
  const token = await inviteToken("recovery", signup.body.user.id);

  const browser = new Browser();
  assert.deepEqual((await browser.call("GET", `/invites/${token}`)).body, { kind: "recovery", name: "forgetful" });
  const fresh = new SoftAuthenticator(ORIGIN, RP_ID);
  const res = await browser.addPasskey(fresh, { invite: token });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.name, "forgetful");
  assert.equal((await browser.call("GET", "/me")).body.passkeys.length, 2);
  assert.equal((await browser.addPasskey(new SoftAuthenticator(ORIGIN, RP_ID), { invite: token })).status, 410);
});

test("signs out one session, or all of them", async () => {
  const passkey = new SoftAuthenticator(ORIGIN, RP_ID);
  const phone = new Browser();
  await phone.signUp(await inviteToken(), "leaver", passkey);
  const laptop = new Browser();
  await laptop.signIn(passkey);
  const tablet = new Browser();
  await tablet.signIn(passkey);

  const cookie = laptop.cookie;
  const out = await laptop.call("POST", "/logout", {});
  assert.match(out.setCookie!, /^__Host-auth=; Path=\/; Expires=Thu, 01 Jan 1970/);
  assert.equal((await fetch(`${base}/api/verify`, { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await phone.call("GET", "/verify")).status, 200);

  await phone.call("POST", "/logout", { everywhere: true });
  assert.equal((await tablet.call("GET", "/verify")).status, 401);
});

test("an expired session is refused", async () => {
  const browser = new Browser();
  await browser.signUp(await inviteToken(), "sleepy", new SoftAuthenticator(ORIGIN, RP_ID));
  await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = (SELECT id FROM users WHERE name = 'sleepy')`);
  assert.equal((await browser.call("GET", "/verify")).status, 401);
});

test("an idle session is extended when used, up to the maximum", async () => {
  const browser = new Browser();
  await browser.signUp(await inviteToken(), "regular", new SoftAuthenticator(ORIGIN, RP_ID));
  const user = `(SELECT id FROM users WHERE name = 'regular')`;
  await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '2 hours', expires_at = now() + interval '1 day' WHERE user_id = ${user}`);
  await browser.call("GET", "/verify");
  let { rows } = await pool.query(`SELECT expires_at > now() + interval '29 days' AS extended FROM sessions WHERE user_id = ${user}`);
  assert.equal(rows[0].extended, true);

  await pool.query(`UPDATE sessions SET created_at = now() - interval '364 days', last_seen_at = now() - interval '2 hours' WHERE user_id = ${user}`);
  await browser.call("GET", "/verify");
  ({ rows } = await pool.query(`SELECT expires_at < now() + interval '2 days' AS capped FROM sessions WHERE user_id = ${user}`));
  assert.equal(rows[0].capped, true);
});

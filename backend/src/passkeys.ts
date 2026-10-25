import { randomUUID } from "crypto";
import { Router } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import type pg from "pg";
import pool from "./db.js";
import { ORIGIN, RP_ID, RP_NAME, USERNAME } from "./config.js";
import { saveChallenge, takeChallenge, type Flow } from "./challenges.js";
import { HttpError, wrap } from "./errors.js";
import { findInvite } from "./invites.js";
import { currentUser, startSession } from "./sessions.js";
import { hashToken } from "./tokens.js";

// The passkey ceremonies. Each is an /options call, whose result the browser
// hands to navigator.credentials, then a /verify call with what it returned.
//
//   POST /api/register/options  {invite?, name?}  create a passkey: with a
//        signup invite and a name, for a new account; with a recovery invite,
//        for that invite's account; with neither, for the signed-in account.
//   POST /api/register/verify   {flow, response, label?}
//   POST /api/login/options     sign in with any of this site's passkeys
//   POST /api/login/verify      {flow, response}
//
// Signing in or up starts a session (sessions.ts) and returns {user}.
export const passkeys = Router();

passkeys.post(
  "/register/options",
  wrap(async (req, res) => {
    const { invite, name } = req.body ?? {};
    let flow: Flow;
    let userName: string;
    if (typeof invite === "string" && invite) {
      const found = await findInvite(invite);
      if (!found) throw new HttpError(410, "This link has expired or was already used. Ask for a new one.");
      if (found.kind === "signup") {
        if (typeof name !== "string" || !USERNAME.test(name)) {
          throw new HttpError(400, "Pick a username of 2 to 32 lowercase letters, digits, - or _, starting with a letter or digit.");
        }
        const taken = await pool.query(`SELECT 1 FROM users WHERE name = $1`, [name]);
        if (taken.rowCount) throw new HttpError(409, `The username ${name} is taken.`);
        flow = { kind: "signup", inviteHash: hashToken(invite).toString("hex"), userId: randomUUID(), name };
        userName = name;
      } else {
        flow = { kind: "recovery", inviteHash: hashToken(invite).toString("hex"), userId: found.userId! };
        userName = found.userName!;
      }
    } else {
      const user = await currentUser(req);
      if (!user) throw new HttpError(401, "Sign in first.");
      flow = { kind: "add", userId: user.id };
      userName = user.name;
    }

    const existing = await pool.query(`SELECT id, transports FROM passkeys WHERE user_id = $1`, [flow.userId]);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: uuidBytes(flow.userId),
      userName,
      attestationType: "none",
      // Don't make a second passkey on an authenticator that already has one.
      excludeCredentials: existing.rows.map((r) => ({ id: r.id, transports: r.transports })),
      authenticatorSelection: {
        // A discoverable passkey: signing in needs no username.
        residentKey: "required",
        // Face ID, a fingerprint or the device PIN, not just a tap.
        userVerification: "required",
      },
    });
    res.json({ flow: await saveChallenge(options.challenge, flow), options });
  }),
);

passkeys.post(
  "/register/verify",
  wrap(async (req, res) => {
    const { flow: flowId, response, label } = req.body ?? {};
    const saved = await takeChallenge(flowId);
    if (!saved || saved.flow.kind === "login") throw new HttpError(400, "That took too long. Try again.");
    const flow = saved.flow;

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: saved.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      });
    } catch (err) {
      throw new HttpError(400, `The passkey couldn't be checked: ${(err as Error).message}`);
    }
    if (!verification.verified) throw new HttpError(400, "The passkey couldn't be checked.");
    const { credential, credentialBackedUp } = verification.registrationInfo;

    if (flow.kind === "add") {
      const user = await currentUser(req);
      if (user?.id !== flow.userId) throw new HttpError(401, "Sign in first.");
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      let used: pg.QueryResult | undefined;
      if (flow.kind !== "add") {
        used = await db.query(
          `UPDATE invites SET used_at = now() WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now() RETURNING admin`,
          [Buffer.from(flow.inviteHash, "hex"), flow.kind],
        );
        if (!used.rowCount) throw new HttpError(410, "This link has expired or was already used. Ask for a new one.");
      }
      if (flow.kind === "signup") {
        const created = await db.query(`INSERT INTO users (id, name, admin) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
          flow.userId,
          flow.name,
          used!.rows[0].admin,
        ]);
        if (!created.rowCount) throw new HttpError(409, `The username ${flow.name} is taken.`);
      }
      const added = await db.query(
        `INSERT INTO passkeys (id, user_id, public_key, counter, transports, synced, name)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [credential.id, flow.userId, Buffer.from(credential.publicKey), credential.counter, credential.transports ?? [], credentialBackedUp, passkeyName(label)],
      );
      if (!added.rowCount) throw new HttpError(409, "This passkey is already registered.");
      if (flow.kind !== "add") await startSession(db, req, res, flow.userId);
      const { rows } = await db.query(`SELECT id, name FROM users WHERE id = $1`, [flow.userId]);
      await db.query("COMMIT");
      res.json({ user: rows[0] });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
  }),
);

passkeys.post(
  "/login/options",
  wrap(async (_req, res) => {
    // No allowCredentials: the browser offers every passkey it has for RP_ID.
    const options = await generateAuthenticationOptions({ rpID: RP_ID, userVerification: "required" });
    res.json({ flow: await saveChallenge(options.challenge, { kind: "login" }), options });
  }),
);

passkeys.post(
  "/login/verify",
  wrap(async (req, res) => {
    const { flow: flowId, response } = req.body ?? {};
    const saved = await takeChallenge(flowId);
    if (!saved || saved.flow.kind !== "login") throw new HttpError(400, "That took too long. Try again.");
    if (typeof response?.id !== "string") throw new HttpError(400, "Missing passkey response.");

    const { rows } = await pool.query(`SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = $1`, [response.id]);
    const passkey = rows[0];
    // Most likely removed from the account, but still on the device.
    if (!passkey) throw new HttpError(401, "This passkey isn't registered here anymore. Try another one.");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: saved.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: passkey.id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
    } catch (err) {
      throw new HttpError(401, `The passkey couldn't be checked: ${(err as Error).message}`);
    }
    if (!verification.verified) throw new HttpError(401, "The passkey couldn't be checked.");

    const { newCounter, credentialBackedUp } = verification.authenticationInfo;
    await pool.query(`UPDATE passkeys SET counter = $2, synced = $3, last_used_at = now() WHERE id = $1`, [passkey.id, newCounter, credentialBackedUp]);
    await startSession(pool, req, res, passkey.user_id);
    const user = await pool.query(`SELECT id, name FROM users WHERE id = $1`, [passkey.user_id]);
    res.json({ user: user.rows[0] });
  }),
);

// The WebAuthn user handle: the account's id, so a passkey belongs to one
// account even if its name changes.
function uuidBytes(id: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(id.replace(/-/g, ""), "hex"));
}

export function passkeyName(label: unknown): string {
  const name = typeof label === "string" ? label.trim().slice(0, 60) : "";
  return name || "Passkey";
}

import { Router, type Request } from "express";
import pool from "./db.js";
import { APP_NAME, createApiKey } from "./apikeys.js";
import { ADMIN_FRESH_MS } from "./config.js";
import { HttpError, wrap } from "./errors.js";
import { createInvite } from "./invites.js";
import { currentUser, type SignedIn } from "./sessions.js";

// For admins only. Who is an admin is set on the server (cli.ts), never here.
// Anything that changes something also needs a passkey used in the last 15
// minutes; otherwise it answers 403 {reauth: true} and the page asks for one.
//
//   GET    /api/admin/users                every account, with passkey and
//                                          session counts and last activity
//   GET    /api/admin/invites              unused, unexpired invite links
//   POST   /api/admin/invites              {kind: "signup"} or
//                                          {kind: "recovery", userId}: a link
//   DELETE /api/admin/invites/:id          withdraw one
//   POST   /api/admin/users/:id/logout     end all of an account's sessions
//   DELETE /api/admin/users/:id            delete an account (not an admin's)
//   GET    /api/admin/keys                 every API key, without the key
//   POST   /api/admin/keys                 {app, name, expiresInDays?}: a new
//                                          key, yours, shown only this once
//   DELETE /api/admin/keys/:id             revoke one
export const admin = Router();

async function requireAdmin(req: Request, fresh: boolean): Promise<SignedIn> {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "Sign in first.");
  if (!user.admin) throw new HttpError(403, "Admins only.");
  if (fresh && Date.now() - user.verifiedAt.getTime() > ADMIN_FRESH_MS) {
    throw new HttpError(403, "Confirm it's you with your passkey.", true);
  }
  return user;
}

admin.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

admin.get(
  "/admin/users",
  wrap(async (req, res) => {
    await requireAdmin(req, false);
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.admin, u.created_at AS "createdAt",
             (SELECT count(*)::int FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
             (SELECT count(*)::int FROM sessions s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions,
             (SELECT max(s.last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS "lastSeenAt"
        FROM users u ORDER BY u.created_at`);
    res.json({ users: rows });
  }),
);

admin.get(
  "/admin/invites",
  wrap(async (req, res) => {
    await requireAdmin(req, false);
    const { rows } = await pool.query(`
      SELECT encode(i.token_hash, 'hex') AS id, i.kind, i.admin, u.name AS "userName",
             i.created_at AS "createdAt", i.expires_at AS "expiresAt"
        FROM invites i LEFT JOIN users u ON u.id = i.user_id
       WHERE i.used_at IS NULL AND i.expires_at > now() ORDER BY i.created_at`);
    res.json({ invites: rows });
  }),
);

admin.post(
  "/admin/invites",
  wrap(async (req, res) => {
    await requireAdmin(req, true);
    const { kind, userId } = req.body ?? {};
    if (kind === "signup") {
      res.json({ link: await createInvite("signup") });
    } else if (kind === "recovery" && typeof userId === "string") {
      const { rowCount } = await pool.query(`SELECT 1 FROM users WHERE id::text = $1`, [userId]);
      if (!rowCount) throw new HttpError(404, "No such account.");
      res.json({ link: await createInvite("recovery", userId) });
    } else {
      throw new HttpError(400, 'Send {kind: "signup"} or {kind: "recovery", userId}.');
    }
  }),
);

admin.delete(
  "/admin/invites/:id",
  wrap(async (req, res) => {
    await requireAdmin(req, true);
    const { rowCount } = await pool.query(`DELETE FROM invites WHERE encode(token_hash, 'hex') = $1 AND used_at IS NULL`, [req.params.id]);
    if (!rowCount) throw new HttpError(404, "No such invite.");
    res.json({ ok: true });
  }),
);

admin.post(
  "/admin/users/:id/logout",
  wrap(async (req, res) => {
    await requireAdmin(req, true);
    const { rowCount } = await pool.query(`SELECT 1 FROM users WHERE id::text = $1`, [req.params.id]);
    if (!rowCount) throw new HttpError(404, "No such account.");
    await pool.query(`DELETE FROM sessions WHERE user_id::text = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

admin.delete(
  "/admin/users/:id",
  wrap(async (req, res) => {
    await requireAdmin(req, true);
    const { rows } = await pool.query(`SELECT admin FROM users WHERE id::text = $1`, [req.params.id]);
    if (!rows[0]) throw new HttpError(404, "No such account.");
    // Admin is changed only on the server, and that includes removing one.
    if (rows[0].admin) throw new HttpError(409, "Admins can't be deleted here. Run `cli.js unadmin <name>` on the server first.");
    // Passkeys, sessions and recovery links go with it (ON DELETE CASCADE).
    await pool.query(`DELETE FROM users WHERE id::text = $1`, [req.params.id]);
    res.json({ ok: true });
  }),
);

admin.get(
  "/admin/keys",
  wrap(async (req, res) => {
    await requireAdmin(req, false);
    const { rows } = await pool.query(`
      SELECT k.id, k.prefix, k.app, k.name, u.name AS "userName", k.created_at AS "createdAt",
             k.last_used_at AS "lastUsedAt", k.expires_at AS "expiresAt"
        FROM api_keys k JOIN users u ON u.id = k.user_id ORDER BY k.app, k.created_at`);
    res.json({ keys: rows });
  }),
);

admin.post(
  "/admin/keys",
  wrap(async (req, res) => {
    const user = await requireAdmin(req, true);
    const { app, name, expiresInDays } = req.body ?? {};
    if (typeof app !== "string" || !APP_NAME.test(app)) throw new HttpError(400, "App names are lowercase letters, digits and dashes.");
    if (typeof name !== "string" || !name.trim() || name.length > 64) throw new HttpError(400, "Give the key a name, up to 64 characters.");
    const days = expiresInDays ?? null;
    if (days !== null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) throw new HttpError(400, "Expiry is a whole number of days, 1 to 3650.");
    res.json({ key: await createApiKey(user.id, app, name.trim(), days) });
  }),
);

admin.delete(
  "/admin/keys/:id",
  wrap(async (req, res) => {
    await requireAdmin(req, true);
    const { rowCount } = await pool.query(`DELETE FROM api_keys WHERE id::text = $1`, [req.params.id]);
    if (!rowCount) throw new HttpError(404, "No such key.");
    res.json({ ok: true });
  }),
);

import { Router } from "express";
import pool from "./db.js";
import { HttpError, wrap } from "./errors.js";
import { findInvite } from "./invites.js";
import { currentUser, endSession } from "./sessions.js";
import { passkeyName } from "./passkeys.js";

// The signed-in account, and what other apps ask.
//
//   GET    /api/verify            {id, name} of the signed-in user, or 401.
//                                 Other apps' backends call this over the
//                                 server's internal network with the
//                                 browser's Cookie header (README).
//   GET    /api/me                {user, passkeys}, or 401
//   POST   /api/logout            {everywhere?}: this session, or all of them
//   PATCH  /api/passkeys/:id      {name}: rename one
//   DELETE /api/passkeys/:id      remove one, but never the last
//   GET    /api/invites/:token    {kind, name?} of a usable invite link, or 410
export const account = Router();

account.get(
  "/verify",
  wrap(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "Not signed in");
    res.json(user);
  }),
);

account.get(
  "/me",
  wrap(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "Not signed in");
    const { rows } = await pool.query(
      `SELECT id, name, synced, created_at AS "createdAt", last_used_at AS "lastUsedAt"
         FROM passkeys WHERE user_id = $1 ORDER BY created_at`,
      [user.id],
    );
    res.json({ user, passkeys: rows });
  }),
);

account.post(
  "/logout",
  wrap(async (req, res) => {
    await endSession(req, res, req.body?.everywhere === true);
    res.json({ ok: true });
  }),
);

account.patch(
  "/passkeys/:id",
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "Sign in first.");
    const { rowCount } = await pool.query(`UPDATE passkeys SET name = $3 WHERE id = $1 AND user_id = $2`, [
      req.params.id,
      user.id,
      passkeyName(req.body?.name),
    ]);
    if (!rowCount) throw new HttpError(404, "No such passkey.");
    res.json({ ok: true });
  }),
);

account.delete(
  "/passkeys/:id",
  wrap(async (req, res) => {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, "Sign in first.");
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // Locks the account so two removals at once can't both see a spare.
      await db.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [user.id]);
      const { rows } = await db.query(`SELECT count(*)::int AS n FROM passkeys WHERE user_id = $1`, [user.id]);
      if (rows[0].n <= 1) throw new HttpError(409, "This is your only passkey. Add another before removing it.");
      const { rowCount } = await db.query(`DELETE FROM passkeys WHERE id = $1 AND user_id = $2`, [req.params.id, user.id]);
      if (!rowCount) throw new HttpError(404, "No such passkey.");
      await db.query("COMMIT");
      res.json({ ok: true });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
  }),
);

account.get(
  "/invites/:token",
  wrap(async (req, res) => {
    const invite = await findInvite(req.params.token);
    if (!invite) throw new HttpError(410, "This link has expired or was already used. Ask for a new one.");
    res.json({ kind: invite.kind, name: invite.userName ?? undefined });
  }),
);

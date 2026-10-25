import { randomUUID } from "crypto";
import type { Request } from "express";
import pool from "./db.js";
import { HttpError } from "./errors.js";
import type { User } from "./sessions.js";
import { hashToken, newToken } from "./tokens.js";

// App names are repo names: lowercase letters, digits and dashes.
export const APP_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

// last_used_at moves at most this often, so a busy key isn't a write per call.
const TOUCH_EVERY_MS = 60 * 1000;

export interface KeyUser extends User {
  // The key's name, so the app can tell which key called.
  key: string;
}

// Makes a key for one app. The key itself is returned only here; the
// database keeps its hash. It looks like wz_<app>_<256 random bits>, so
// secret scanners and people can tell what it is and where it belongs.
export async function createApiKey(userId: string, app: string, name: string, expiresInDays: number | null): Promise<string> {
  const key = `wz_${app}_${newToken()}`;
  await pool.query(
    `INSERT INTO api_keys (id, token_hash, prefix, user_id, app, name, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + $7 * interval '1 day')`,
    [randomUUID(), hashToken(key), key.slice(0, `wz_${app}_`.length + 4), userId, app, name, expiresInDays],
  );
  return key;
}

// The Bearer key in the Authorization header, if there is one.
export function bearerKey(req: Request): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  return match?.[1];
}

// The key's owner, if the key is good for this app; otherwise null. A key
// made for another app is refused just like an unknown one.
export async function keyUser(key: string, app: unknown): Promise<KeyUser | null> {
  if (typeof app !== "string" || !APP_NAME.test(app)) throw new HttpError(400, "Say which app is asking (?app=).");
  const hash = hashToken(key);
  const { rows } = await pool.query(
    `SELECT u.id, u.name, k.name AS key, k.last_used_at IS NULL OR k.last_used_at < now() - $3 * interval '1 millisecond' AS stale
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.token_hash = $1 AND k.app = $2 AND (k.expires_at IS NULL OR k.expires_at > now())`,
    [hash, app, TOUCH_EVERY_MS],
  );
  if (!rows[0]) return null;
  if (rows[0].stale) await pool.query(`UPDATE api_keys SET last_used_at = now() WHERE token_hash = $1`, [hash]);
  return { id: rows[0].id, name: rows[0].name, key: rows[0].key };
}

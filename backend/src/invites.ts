import pool from "./db.js";
import { INVITE_TTL_MS, ORIGIN } from "./config.js";
import { APP_BASE } from "./paths.js";
import { hashToken, newToken } from "./tokens.js";

export type InviteKind = "signup" | "recovery";

export interface Invite {
  kind: InviteKind;
  userId: string | null;
  userName: string | null;
}

// A one-time link: a signup invite creates a new account, a recovery link
// adds a passkey to an existing one (for when all of its passkeys are lost).
// Made by the CLI on the server (cli.ts), never through the web.
// admin (signup only) makes the new account an admin; only the CLI passes it.
export async function createInvite(kind: InviteKind, userId: string | null = null, admin = false): Promise<string> {
  const token = newToken();
  await pool.query(
    `INSERT INTO invites (token_hash, kind, user_id, admin, expires_at) VALUES ($1, $2, $3, $4, now() + $5 * interval '1 millisecond')`,
    [hashToken(token), kind, userId, admin && kind === "signup", INVITE_TTL_MS],
  );
  return `${ORIGIN}${APP_BASE}invite/${token}`;
}

// An unused, unexpired invite, without using it up.
export async function findInvite(token: string): Promise<Invite | null> {
  const { rows } = await pool.query(
    `SELECT i.kind, i.user_id, u.name FROM invites i LEFT JOIN users u ON u.id = i.user_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ? { kind: rows[0].kind, userId: rows[0].user_id, userName: rows[0].name } : null;
}

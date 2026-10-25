import type { Request, Response } from "express";
import type pg from "pg";
import pool from "./db.js";
import { SESSION_COOKIE, SESSION_IDLE_MS, SESSION_MAX_MS } from "./config.js";
import { hashToken, newToken } from "./tokens.js";

export interface User {
  id: string;
  name: string;
}

// What this service knows about a signed-in user beyond what apps see.
export interface SignedIn extends User {
  admin: boolean;
  // When this session last proved itself with a passkey.
  verifiedAt: Date;
}

// The browser keeps the cookie for as long as it allows (400 days in Chrome);
// the database decides when the session really ends.
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
// last_seen_at and the idle expiry move at most this often, so apps checking
// a session on every request don't each cause a write.
const TOUCH_EVERY_MS = 60 * 60 * 1000;

// Signs in, replacing the browser's previous session if it had one.
export async function startSession(db: pg.Pool | pg.PoolClient, req: Request, res: Response, userId: string): Promise<void> {
  const old = sessionToken(req);
  if (old) await db.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(old)]);
  const token = newToken();
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 millisecond')`,
    [hashToken(token), userId, SESSION_IDLE_MS],
  );
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: COOKIE_MAX_AGE_MS });
}

export function sessionToken(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

// The signed-in user, or null. Keeps the session alive while it's used.
export async function currentUser(req: Request): Promise<SignedIn | null> {
  const token = sessionToken(req);
  if (!token) return null;
  const hash = hashToken(token);
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.admin, s.verified_at, s.last_seen_at < now() - $2 * interval '1 millisecond' AS stale
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash, TOUCH_EVERY_MS],
  );
  if (!rows[0]) return null;
  if (rows[0].stale) {
    await pool.query(
      `UPDATE sessions SET last_seen_at = now(),
              expires_at = LEAST(created_at + $2 * interval '1 millisecond', now() + $3 * interval '1 millisecond')
        WHERE token_hash = $1`,
      [hash, SESSION_MAX_MS, SESSION_IDLE_MS],
    );
  }
  return { id: rows[0].id, name: rows[0].name, admin: rows[0].admin, verifiedAt: rows[0].verified_at };
}

export async function endSession(req: Request, res: Response, everywhere: boolean): Promise<void> {
  const token = sessionToken(req);
  if (token) {
    if (everywhere) {
      await pool.query(`DELETE FROM sessions WHERE user_id = (SELECT user_id FROM sessions WHERE token_hash = $1)`, [hashToken(token)]);
    } else {
      await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
    }
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}

// Expired sessions are never valid; this only keeps the table small.
export async function pruneSessions(): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
}

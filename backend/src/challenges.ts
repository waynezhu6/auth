import pool from "./db.js";
import { CHALLENGE_TTL_MS } from "./config.js";

// What a ceremony is for, remembered between its two requests.
export type Flow =
  | { kind: "signup"; inviteHash: string; userId: string; name: string }
  | { kind: "recovery"; inviteHash: string; userId: string }
  | { kind: "add"; userId: string }
  | { kind: "login" };

// Each passkey ceremony is two requests: the server hands out a random
// challenge, and the browser returns it signed by the passkey. The challenge
// is kept until then under a flow id, and can only be used once.
export async function saveChallenge(challenge: string, flow: Flow): Promise<string> {
  await pool.query(`DELETE FROM challenges WHERE expires_at < now()`);
  const { rows } = await pool.query(
    `INSERT INTO challenges (challenge, data, expires_at) VALUES ($1, $2, now() + $3 * interval '1 millisecond') RETURNING id`,
    [challenge, flow, CHALLENGE_TTL_MS],
  );
  return rows[0].id;
}

export async function takeChallenge(id: unknown): Promise<{ challenge: string; flow: Flow } | null> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const { rows } = await pool.query(`DELETE FROM challenges WHERE id = $1 AND expires_at > now() RETURNING challenge, data`, [id]);
  return rows[0] ? { challenge: rows[0].challenge, flow: rows[0].data } : null;
}

import pool from "./db.js";
import { createInvite } from "./invites.js";

// Admin commands, run inside the auth container on the server (README):
//
//   node dist/cli.js invite            a link that signs up one new account
//   node dist/cli.js recover <name>    a link that adds a passkey to <name>'s
//                                      account, for when all of them are lost
//   node dist/cli.js users             list accounts
//
// Links work once, for 7 days. There is no sign-up without one.
const [command, arg] = process.argv.slice(2);

try {
  if (command === "invite") {
    console.log(await createInvite("signup"));
  } else if (command === "recover" && arg) {
    const { rows } = await pool.query(`SELECT id FROM users WHERE name = $1`, [arg]);
    if (!rows[0]) throw new Error(`No account named ${arg}`);
    console.log(await createInvite("recovery", rows[0].id));
  } else if (command === "users") {
    const { rows } = await pool.query(
      `SELECT u.name, u.created_at::date AS created, count(p.id)::int AS passkeys
         FROM users u LEFT JOIN passkeys p ON p.user_id = u.id GROUP BY u.id ORDER BY u.created_at`,
    );
    for (const r of rows) console.log(`${r.name}\t${r.passkeys} passkey(s)\tsince ${r.created.toISOString().slice(0, 10)}`);
    if (!rows.length) console.log("No accounts yet. Make one with: invite");
  } else {
    console.error("Usage: cli.js invite | recover <name> | users");
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

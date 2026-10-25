import pool from "./db.js";
import { createInvite } from "./invites.js";

// Admin commands, run inside the auth container on the server (README):
//
//   node dist/cli.js invite [--admin]  a link that signs up one new account;
//                                      --admin makes that account an admin
//   node dist/cli.js recover <name>    a link that adds a passkey to <name>'s
//                                      account, for when all of them are lost
//   node dist/cli.js admin <name>      make <name> an admin (the admin page at
//   node dist/cli.js unadmin <name>    /apps/auth/admin), or stop them being one
//   node dist/cli.js users             list accounts
//
// Links work once, for 7 days. There is no sign-up without one, and being an
// admin can only be granted or taken away here, never from the web.
const [command, arg] = process.argv.slice(2);

try {
  if (command === "invite" && (!arg || arg === "--admin")) {
    console.log(await createInvite("signup", null, arg === "--admin"));
  } else if (command === "recover" && arg) {
    const { rows } = await pool.query(`SELECT id FROM users WHERE name = $1`, [arg]);
    if (!rows[0]) throw new Error(`No account named ${arg}`);
    console.log(await createInvite("recovery", rows[0].id));
  } else if ((command === "admin" || command === "unadmin") && arg) {
    const { rowCount } = await pool.query(`UPDATE users SET admin = $2 WHERE name = $1`, [arg, command === "admin"]);
    if (!rowCount) throw new Error(`No account named ${arg}`);
    console.log(command === "admin" ? `${arg} is now an admin` : `${arg} is no longer an admin`);
  } else if (command === "users") {
    const { rows } = await pool.query(
      `SELECT u.name, u.admin, u.created_at::date AS created, count(p.id)::int AS passkeys
         FROM users u LEFT JOIN passkeys p ON p.user_id = u.id GROUP BY u.id ORDER BY u.created_at`,
    );
    for (const r of rows) console.log(`${r.name}${r.admin ? " (admin)" : ""}\t${r.passkeys} passkey(s)\tsince ${r.created.toISOString().slice(0, 10)}`);
    if (!rows.length) console.log("No accounts yet. Make one with: invite");
  } else {
    console.error("Usage: cli.js invite [--admin] | recover <name> | admin <name> | unadmin <name> | users");
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

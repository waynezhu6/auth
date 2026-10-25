import pg from "pg";
import { after } from "node:test";

// Each test file gets a fresh database on the Postgres in DATABASE_URL (the
// dev one from docker-compose.dev.yml by default, a service container in CI),
// dropped afterwards, so tests never touch real data. Import this first: it
// points DATABASE_URL at that database before src/db.ts reads it.
const server = new URL(process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/app");
const name = `auth_test_${process.pid}`;
const url = new URL(server);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();

const admin = new pg.Client({ connectionString: server.toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${name}`);
await admin.query(`CREATE DATABASE ${name}`);

const { default: pool, migrate } = await import("../src/db.js");
await migrate();

after(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});

export { pool };

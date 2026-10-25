import pg from "pg";
import { runner } from "node-pg-migrate";
import { join } from "path";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function migrate() {
  await runner({
    databaseUrl: process.env.DATABASE_URL!,
    dir: join(import.meta.dirname, "../migrations"),
    direction: "up",
    migrationsTable: "pgmigrations",
    log: () => {},
  });
}

export default pool;

// Admins: set only from the server's command line (src/cli.ts), never from
// the web. An admin invite makes its new account an admin.
// verified_at: when the session's owner last used a passkey, so admin actions
// can ask for one again if it has been a while.

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users ADD COLUMN admin boolean NOT NULL DEFAULT false;
    ALTER TABLE invites ADD COLUMN admin boolean NOT NULL DEFAULT false;
    ALTER TABLE sessions ADD COLUMN verified_at timestamptz NOT NULL DEFAULT now();
  `);
};

export const down = (pgm) => {
  pgm.sql(`
    ALTER TABLE users DROP COLUMN admin;
    ALTER TABLE invites DROP COLUMN admin;
    ALTER TABLE sessions DROP COLUMN verified_at;
  `);
};

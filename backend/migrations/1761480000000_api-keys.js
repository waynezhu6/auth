// API keys: for callers that can't sign in with a passkey (scripts, other
// servers, an iOS Shortcut). An admin makes one on the admin page for one
// app; it acts as its owner, but only when that app asks (account.ts
// /verify). Only a hash of the key is kept. Revoking deletes the row.

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE api_keys (
      id uuid PRIMARY KEY,
      token_hash bytea NOT NULL UNIQUE,
      -- The start of the key, e.g. wz_txtify_Ab3x, so it can be recognized.
      prefix text NOT NULL,
      user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
      -- The one app that accepts it.
      app text NOT NULL,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      expires_at timestamptz
    );
    CREATE INDEX api_keys_user_id ON api_keys (user_id);
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE api_keys;`);
};

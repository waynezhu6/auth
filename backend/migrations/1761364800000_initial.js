// Accounts, their passkeys, login sessions, one-time invite links, and the
// short-lived challenges a passkey ceremony signs.

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      id uuid PRIMARY KEY,
      name text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    -- id is the credential ID the browser reports, base64url.
    CREATE TABLE passkeys (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
      public_key bytea NOT NULL,
      counter bigint NOT NULL DEFAULT 0,
      transports text[] NOT NULL DEFAULT '{}',
      -- Whether the passkey syncs between devices (iCloud Keychain, Google
      -- Password Manager) or lives on one security key or device.
      synced boolean NOT NULL DEFAULT false,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz
    );
    CREATE INDEX passkeys_user_id ON passkeys (user_id);

    -- Only a hash of each session token is kept, so a leaked database can't
    -- be used to sign in.
    CREATE TABLE sessions (
      token_hash bytea PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX sessions_user_id ON sessions (user_id);

    -- signup: creates a new account. recovery: adds a passkey to user_id's.
    CREATE TABLE invites (
      token_hash bytea PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('signup', 'recovery')),
      user_id uuid REFERENCES users ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      CHECK ((kind = 'recovery') = (user_id IS NOT NULL))
    );

    -- Kept in the database rather than in memory so a ceremony started on one
    -- backend can finish on the other during a deploy.
    CREATE TABLE challenges (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge text NOT NULL,
      data jsonb NOT NULL,
      expires_at timestamptz NOT NULL
    );
  `);
};

export const down = (pgm) => {
  pgm.sql(`DROP TABLE challenges, invites, sessions, passkeys, users`);
};

-- Better Auth tables are created by getMigrations() from the installed package,
-- on the same transaction/connection as this additive application schema.
CREATE TABLE IF NOT EXISTS acq_tenants (
  id uuid PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES acq_auth_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS acq_invites (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email text NOT NULL CHECK (email = lower(btrim(email))),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by text REFERENCES acq_auth_users(id),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);

CREATE INDEX IF NOT EXISTS acq_invites_email_idx ON acq_invites(email);
-- Separate invites for the same address must not create separate identities.
CREATE UNIQUE INDEX IF NOT EXISTS acq_auth_users_email_lower_uidx
  ON acq_auth_users(lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS acq_auth_accounts_credential_uidx
  ON acq_auth_accounts("userId") WHERE "providerId" = 'credential';

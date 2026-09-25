-- Additive, independent workspace storage. Better Auth owns acq_auth_* and
-- acq_invites; this migration never creates or changes those tables.
CREATE TABLE IF NOT EXISTS ws_workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  goal text NOT NULL DEFAULT '',
  deadline date,
  owner_id text NOT NULL REFERENCES acq_auth_users(id),
  seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS ws_members (
  workspace_id uuid NOT NULL REFERENCES ws_workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES acq_auth_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS ws_members_user_idx ON ws_members(user_id);

-- The owner must remain a member, even for direct SQL writes.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'ws_workspaces'::regclass
    AND conname = 'ws_owner_membership_fk') THEN
    ALTER TABLE ws_workspaces ADD CONSTRAINT ws_owner_membership_fk
      FOREIGN KEY (id, owner_id) REFERENCES ws_members(workspace_id, user_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ws_tasks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES ws_workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  assignee_id text,
  status text NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
  due_date date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, assignee_id) REFERENCES ws_members(workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS ws_tasks_workspace_idx ON ws_tasks(workspace_id, created_at, id);

CREATE TABLE IF NOT EXISTS ws_materials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES ws_workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  author_id text NOT NULL REFERENCES acq_auth_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ws_materials_workspace_idx ON ws_materials(workspace_id, created_at, id);

CREATE TABLE IF NOT EXISTS ws_invites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES ws_workspaces(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  email text NOT NULL CHECK (email = lower(btrim(email))),
  created_by text NOT NULL REFERENCES acq_auth_users(id),
  signup_required boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by text REFERENCES acq_auth_users(id),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL))
);
CREATE INDEX IF NOT EXISTS ws_invites_workspace_idx ON ws_invites(workspace_id);

CREATE TABLE IF NOT EXISTS ws_commands (
  user_id text NOT NULL REFERENCES acq_auth_users(id),
  command_id text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES ws_workspaces(id) ON DELETE CASCADE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb NOT NULL,
  http_status integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, command_id)
);

CREATE TABLE IF NOT EXISTS ws_events (
  workspace_id uuid NOT NULL REFERENCES ws_workspaces(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  actor_id text NOT NULL REFERENCES acq_auth_users(id),
  command_id text NOT NULL,
  kind text NOT NULL,
  entity_id text NOT NULL,
  source text NOT NULL DEFAULT 'human' CHECK (source = 'human'),
  details jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, seq)
);

BEGIN;
CREATE TABLE IF NOT EXISTS github_connection_oauth_states (
  state_hash text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  installation_id bigint NOT NULL CHECK (installation_id > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS github_connection_states_expiry_idx ON github_connection_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS workspace_github_connections (
  installation_id bigint PRIMARY KEY CHECK (installation_id > 0),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_login text NOT NULL,
  repositories jsonb NOT NULL CHECK (jsonb_typeof(repositories) = 'array'),
  connected_by uuid NOT NULL REFERENCES users(id),
  connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_github_connections_workspace_idx
  ON workspace_github_connections(workspace_id, connected_at DESC);
INSERT INTO schema_migrations(version) VALUES ('011_workspace_github_connections') ON CONFLICT DO NOTHING;
COMMIT;

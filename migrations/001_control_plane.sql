BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS webhook_deliveries (delivery_id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  source text NOT NULL CHECK (source IN ('github', 'jira')),
  source_item_id text NOT NULL,
  repository text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, repository, source_item_id)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  action text NOT NULL,
  actor text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_run_id_id_idx ON audit_events(run_id, id);
INSERT INTO schema_migrations(version) VALUES ('001_control_plane') ON CONFLICT DO NOTHING;
COMMIT;

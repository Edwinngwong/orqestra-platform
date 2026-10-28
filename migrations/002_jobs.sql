BEGIN;
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('execute_run')),
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'completed', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, kind)
);
CREATE INDEX IF NOT EXISTS jobs_ready_idx ON jobs(status, available_at, created_at);
INSERT INTO schema_migrations(version) VALUES ('002_jobs') ON CONFLICT DO NOTHING;
COMMIT;

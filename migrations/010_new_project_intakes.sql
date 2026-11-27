BEGIN;
CREATE TABLE IF NOT EXISTS new_project_intakes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  goal text NOT NULL CHECK (char_length(goal) BETWEEN 20 AND 4000),
  ownership_mode text NOT NULL CHECK (ownership_mode IN ('customer_owned','orqestra_managed')),
  monthly_budget_usd integer CHECK (monthly_budget_usd BETWEEN 1 AND 100000),
  requested_by text NOT NULL CHECK (char_length(requested_by) BETWEEN 1 AND 254),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS new_project_intakes_workspace_idx
  ON new_project_intakes(workspace_id, created_at DESC);
INSERT INTO schema_migrations(version) VALUES ('010_new_project_intakes') ON CONFLICT DO NOTHING;
COMMIT;

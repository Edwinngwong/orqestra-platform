BEGIN;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS tracker_type text NOT NULL DEFAULT 'github_issue' CHECK (tracker_type IN ('github_issue','jira_issue','orqestra_only'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS jira_project_key text;
CREATE TABLE IF NOT EXISTS muse_work_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web','whatsapp','slack','teams','email','github','jira')),
  source_reference text NOT NULL,
  requester_id text NOT NULL,
  title text NOT NULL,
  objective text NOT NULL,
  acceptance_criteria jsonb NOT NULL,
  constraints jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','routed')),
  tracker_type text NOT NULL CHECK (tracker_type IN ('github_issue','jira_issue','orqestra_only')),
  confirmed_by text,
  confirmed_at timestamptz,
  external_id text,
  external_url text,
  run_id uuid REFERENCES runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(channel,source_reference,project_id)
);
CREATE INDEX IF NOT EXISTS muse_work_items_workspace_created_idx ON muse_work_items(workspace_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES ('006_muse_tracker_routing') ON CONFLICT DO NOTHING;
COMMIT;

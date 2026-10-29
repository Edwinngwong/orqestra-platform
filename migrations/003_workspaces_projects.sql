BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  repository text NOT NULL UNIQUE,
  default_branch text NOT NULL DEFAULT 'main',
  github_installation_id bigint NOT NULL,
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,name)
);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id);
INSERT INTO workspaces(id,name,slug) VALUES('00000000-0000-4000-8000-000000000001','Local Development','local-development') ON CONFLICT DO NOTHING;
INSERT INTO projects(id,workspace_id,name,repository,default_branch,github_installation_id,policy)
SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000001',repository,repository,
  COALESCE(payload->'workItem'->>'defaultBranch','main'), COALESCE((payload->'workItem'->>'githubInstallationId')::bigint,0),
  '{"testCommand":["npm","test"],"timeoutSeconds":900,"maxChangedFiles":20,"maxChangedBytes":1000000,"protectedPaths":[".github/workflows",".env","infra"]}'::jsonb
FROM runs GROUP BY repository,payload->'workItem'->>'defaultBranch',payload->'workItem'->>'githubInstallationId'
ON CONFLICT(repository) DO NOTHING;
UPDATE runs SET project_id=projects.id FROM projects WHERE runs.project_id IS NULL AND lower(runs.repository)=lower(projects.repository);
CREATE INDEX IF NOT EXISTS runs_project_created_idx ON runs(project_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES ('003_workspaces_projects') ON CONFLICT DO NOTHING;
COMMIT;

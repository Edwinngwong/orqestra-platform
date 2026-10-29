BEGIN;
UPDATE runs AS run
SET payload = jsonb_set(
  jsonb_set(run.payload, '{workItem,workspaceId}', to_jsonb(project.workspace_id::text), true),
  '{workItem,projectId}', to_jsonb(project.id::text), true
), updated_at = run.updated_at
FROM projects AS project
WHERE run.project_id = project.id
  AND (run.payload->'workItem'->>'workspaceId' IS NULL OR run.payload->'workItem'->>'projectId' IS NULL);
INSERT INTO schema_migrations(version) VALUES ('005_backfill_run_scope') ON CONFLICT DO NOTHING;
COMMIT;

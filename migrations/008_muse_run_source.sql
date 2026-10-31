BEGIN;
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_source_check;
ALTER TABLE runs ADD CONSTRAINT runs_source_check CHECK (source IN ('github', 'jira', 'muse'));
INSERT INTO schema_migrations(version) VALUES ('008_muse_run_source') ON CONFLICT DO NOTHING;
COMMIT;

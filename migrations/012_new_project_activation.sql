BEGIN;
ALTER TABLE new_project_intakes
  DROP CONSTRAINT IF EXISTS new_project_intakes_status_check;
ALTER TABLE new_project_intakes
  ADD CONSTRAINT new_project_intakes_status_check CHECK (status IN ('pending_review','activated'));
ALTER TABLE new_project_intakes
  ADD COLUMN IF NOT EXISTS activated_project_id uuid UNIQUE REFERENCES projects(id) ON DELETE SET NULL;
INSERT INTO schema_migrations(version) VALUES ('012_new_project_activation') ON CONFLICT DO NOTHING;
COMMIT;

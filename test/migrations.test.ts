import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

test("historical runs carry workspace and project scope in their payload", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const result = await pool.query(`SELECT count(*)::int AS missing FROM runs
      WHERE project_id IS NOT NULL AND (payload->'workItem'->>'workspaceId' IS NULL OR payload->'workItem'->>'projectId' IS NULL)`);
    assert.equal(result.rows[0].missing, 0);
  } finally { await pool.end(); }
});

test("Muse work items and project tracker routing are migrated", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const table = await pool.query("SELECT to_regclass('public.muse_work_items') AS name");
    assert.equal(table.rows[0].name, "muse_work_items");
    const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name IN ('tracker_type','jira_project_key') ORDER BY column_name");
    assert.deepEqual(columns.rows.map(row => row.column_name), ["jira_project_key", "tracker_type"]);
  } finally { await pool.end(); }
});

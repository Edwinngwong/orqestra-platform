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

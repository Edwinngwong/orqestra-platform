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

test("WhatsApp bindings and durable inbox are migrated", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const result = await pool.query("SELECT to_regclass('public.whatsapp_bindings') AS bindings,to_regclass('public.whatsapp_messages') AS messages");
    assert.equal(result.rows[0].bindings, "whatsapp_bindings");
    assert.equal(result.rows[0].messages, "whatsapp_messages");
  } finally { await pool.end(); }
});

test("WhatsApp lifecycle notifications use a durable outbox", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try { const result = await pool.query("SELECT to_regclass('public.whatsapp_notifications') AS table_name"); assert.equal(result.rows[0]?.table_name, "whatsapp_notifications"); }
  finally { await pool.end(); }
});

test("runs accept Muse as a durable intake source", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const result = await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='runs'::regclass AND conname='runs_source_check'");
    assert.match(result.rows[0]?.definition ?? "", /'muse'/);
  } finally { await pool.end(); }
});

test("new project intake records are durable and isolated from executable projects", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    const table = await pool.query("SELECT to_regclass('public.new_project_intakes') AS name");
    assert.equal(table.rows[0].name, "new_project_intakes");
    const { PostgresProjectRegistry } = await import("../src/projects.js");
    const registry = new PostgresProjectRegistry(pool);
    const slug = `intake-${crypto.randomUUID().slice(0,8)}`;
    const workspace = await registry.createWorkspace({ name: slug, slug });
    try {
      const intake = await registry.createNewProjectIntake({
        workspaceId: workspace.id, name: "Payments portal", goal: "Allow customers to view their payment history.",
        ownershipMode: "customer_owned", monthlyBudgetUsd: 250, requestedBy: "owner@example.test",
      });
      assert.equal(intake.status, "pending_review");
      assert.equal(intake.monthlyBudgetUsd, 250);
      assert.equal((await registry.listNewProjectIntakes(workspace.id))[0]?.id, intake.id);
      assert.deepEqual(await registry.listProjects(workspace.id), []);
    } finally {
      await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace.id]);
    }
  } finally {
    await pool.end();
  }
});

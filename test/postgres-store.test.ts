import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PostgresRunStore } from "../src/postgres-store.js";
import { PostgresJobQueue } from "../src/queue/jobs.js";

test("atomically persists a PostgreSQL run and rejects duplicate deliveries", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const store = new PostgresRunStore(pool);
  const queue = new PostgresJobQueue(pool);
  const suffix = crypto.randomUUID();
  const run = { id: crypto.randomUUID(), status: "awaiting_intake_approval" as const, workItem: { id: suffix, source: "github" as const, title: "Test", description: "", repository: `test/${suffix}`, defaultBranch: "main" } };
  const event = { at: new Date().toISOString(), runId: run.id, action: "intake_received", actor: "system" };
  try {
    assert.equal(await store.create(run, event, `delivery-${suffix}`), true);
    assert.deepEqual(await store.get(run.id), run);
    assert.equal((await store.audit(run.id)).length, 1);
    await queue.enqueue(run.id);
    const job = await queue.lease("worker-test", 30);
    assert(job);
    assert.equal(job.runId, run.id);
    assert.equal(await queue.heartbeat(job.id, "worker-test", 30), true);
    await queue.complete(job.id, "worker-test");
    assert.equal(await store.create({ ...run, id: crypto.randomUUID() }, { ...event, runId: crypto.randomUUID() }, `delivery-${suffix}`), false);
  } finally {
    await pool.query("DELETE FROM runs WHERE id = $1", [run.id]);
    await pool.query("DELETE FROM webhook_deliveries WHERE delivery_id = $1", [`delivery-${suffix}`]);
    await pool.end();
  }
});

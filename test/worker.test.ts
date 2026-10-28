import assert from "node:assert/strict";
import test from "node:test";
import { Orchestrator } from "../src/orchestrator.js";
import { MemoryJobQueue } from "../src/queue/jobs.js";
import { Worker } from "../src/queue/worker.js";

test("executes approved work from the durable-worker contract", async () => {
  const queue = new MemoryJobQueue();
  const orchestrator = new Orchestrator(
    { async implement() { return { branch: "orqestra/1", commit: "abcdef1", summary: "done" }; } },
    { async runTests() { return { passed: true, summary: "passed" }; } },
    { async createDraft() { return "unused"; } },
  );
  const run = await orchestrator.intake({ id: "1", source: "github", title: "Change", description: "", repository: "org/repo", defaultBranch: "main" });
  assert(run);
  await orchestrator.approveIntake(run.id);
  await queue.enqueue(run.id);
  assert.equal(await new Worker("worker-1", queue, orchestrator).workOnce(), true);
  assert.equal((await orchestrator.get(run.id)).status, "awaiting_pr_approval");
});

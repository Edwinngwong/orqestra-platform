import assert from "node:assert/strict";
import test from "node:test";
import { Orchestrator } from "../src/orchestrator.js";

test("requires both human approvals before opening a draft PR", async () => {
  let prCalls = 0;
  const notifications: string[] = [];
  const service = new Orchestrator(
    { async implement() { return { branch: "orqestra/7", commit: "abcdef1", summary: "implemented" }; } },
    { async runTests() { return { passed: true, summary: "all passed" }; } },
    { async createDraft() { prCalls += 1; return "https://example.test/pr/1"; } },
    undefined,
    { async notify(_run, event) { notifications.push(event); } },
  );
  const run = await service.intake({ id: "7", source: "github", title: "Change", description: "Do it", repository: "org/repo", defaultBranch: "main" });
  assert(run);
  await assert.rejects(() => service.execute(run.id));
  await service.approveIntake(run.id);
  const tested = await service.execute(run.id);
  assert.equal(tested.status, "awaiting_pr_approval");
  assert.equal(prCalls, 0);
  const opened = await service.approveDraftPullRequest(run.id);
  assert.equal(opened.status, "draft_pr_open");
  assert.equal(prCalls, 1);
  const completed = await service.completeMergedPullRequest("org/repo", "orqestra/7", "https://example.test/pr/1");
  assert.equal(completed?.status, "completed");
  assert.equal((await service.completeMergedPullRequest("org/repo", "orqestra/7", "https://example.test/pr/1"))?.status, "completed");
  assert.deepEqual(notifications, ["work_started", "change_ready", "pr_ready", "completed"]);
});

test("notification failures never block delivery state transitions", async () => {
  const service = new Orchestrator(
    { async implement() { return { branch: "orqestra/10", commit: "abcdef3", summary: "implemented" }; } },
    { async runTests() { return { passed: true, summary: "all passed" }; } },
    { async createDraft() { return "https://example.test/pr/10"; } },
    undefined,
    { async notify() { throw new Error("provider unavailable"); } },
  );
  const run = await service.intake({ id: "10", source: "muse", title: "Change", description: "Do it", repository: "org/repo", defaultBranch: "main" }); assert(run);
  assert.equal((await service.approveIntake(run.id)).status, "queued");
  assert.equal((await service.execute(run.id)).status, "awaiting_pr_approval");
});

test("does not offer a PR when tests fail", async () => {
  const service = new Orchestrator(
    { async implement() { return { branch: "orqestra/8", commit: "abcdef2", summary: "implemented" }; } },
    { async runTests() { return { passed: false, summary: "1 failed" }; } },
    { async createDraft() { throw new Error("must not be called"); } },
  );
  const run = await service.intake({ id: "8", source: "jira", title: "Change", description: "Do it", repository: "org/repo", defaultBranch: "main" });
  assert(run);
  await service.approveIntake(run.id);
  assert.equal((await service.execute(run.id)).status, "tests_failed");
  assert.equal((await service.retry(run.id, "reviewer")).status, "queued");
  assert.equal((await service.audit(run.id)).at(-1)?.action, "run_retried");
  await assert.rejects(() => service.approveDraftPullRequest(run.id));
});

test("records agent failures and allows a human retry", async () => {
  const service = new Orchestrator(
    { async implement() { throw new Error("provider unavailable"); } },
    { async runTests() { throw new Error("must not be called"); } },
    { async createDraft() { throw new Error("must not be called"); } },
  );
  const run = await service.intake({ id: "9", source: "github", title: "Change", description: "Do it", repository: "org/repo", defaultBranch: "main" });
  assert(run);
  await service.approveIntake(run.id);
  const failed = await service.execute(run.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.testSummary, "provider unavailable");
  assert.equal((await service.retry(run.id)).status, "queued");
});

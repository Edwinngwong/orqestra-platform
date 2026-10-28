import assert from "node:assert/strict";
import test from "node:test";
import { Orchestrator } from "../src/orchestrator.js";

test("requires both human approvals before opening a draft PR", async () => {
  let prCalls = 0;
  const service = new Orchestrator(
    { async implement() { return { branch: "orqestra/7", commit: "abcdef1", summary: "implemented" }; } },
    { async runTests() { return { passed: true, summary: "all passed" }; } },
    { async createDraft() { prCalls += 1; return "https://example.test/pr/1"; } },
  );
  const run = service.intake({ id: "7", source: "github", title: "Change", description: "Do it", repository: "org/repo", defaultBranch: "main" });
  await assert.rejects(() => service.execute(run.id));
  service.approveIntake(run.id);
  const tested = await service.execute(run.id);
  assert.equal(tested.status, "awaiting_pr_approval");
  assert.equal(prCalls, 0);
  const opened = await service.approveDraftPullRequest(run.id);
  assert.equal(opened.status, "draft_pr_open");
  assert.equal(prCalls, 1);
});

test("does not offer a PR when tests fail", async () => {
  const service = new Orchestrator(
    { async implement() { return { branch: "orqestra/8", commit: "abcdef2", summary: "implemented" }; } },
    { async runTests() { return { passed: false, summary: "1 failed" }; } },
    { async createDraft() { throw new Error("must not be called"); } },
  );
  const run = service.intake({ id: "8", source: "jira", title: "Change", description: "Do it", repository: "org/repo", defaultBranch: "main" });
  service.approveIntake(run.id);
  assert.equal((await service.execute(run.id)).status, "tests_failed");
  await assert.rejects(() => service.approveDraftPullRequest(run.id));
});

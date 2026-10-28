import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonFileRunStore } from "../src/store.js";

test("persists runs and audit events across store instances", () => {
  const path = join(mkdtempSync(join(tmpdir(), "orqestra-")), "runs.json");
  const first = new JsonFileRunStore(path);
  const run = { id: "run-1", status: "awaiting_intake_approval" as const, workItem: { id: "1", source: "github" as const, title: "Test", description: "", repository: "org/repo", defaultBranch: "main" } };
  first.put(run);
  first.appendAudit({ at: "2026-01-01T00:00:00.000Z", runId: run.id, action: "intake_received", actor: "system" });
  const reopened = new JsonFileRunStore(path);
  assert.deepEqual(reopened.get(run.id), run);
  assert.equal(reopened.audit(run.id).length, 1);
});

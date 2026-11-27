import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProjectRegistry } from "../src/projects.js";

test("separates projects by workspace and resolves repositories case-insensitively", async () => {
  const registry = new MemoryProjectRegistry();
  const first = await registry.createWorkspace({ name: "Acme", slug: "acme" });
  const second = await registry.createWorkspace({ name: "Beta", slug: "beta" });
  const policy = { testCommand: ["npm", "test"], timeoutSeconds: 300, maxChangedFiles: 10, maxChangedBytes: 100_000, protectedPaths: [".github"] };
  const project = await registry.createProject({ workspaceId: first.id, name: "API", repository: "Acme/API", defaultBranch: "main", githubInstallationId: 12, policy });
  assert.equal((await registry.listProjects(first.id)).length, 1);
  assert.equal((await registry.listProjects(second.id)).length, 0);
  assert.equal((await registry.findByRepository("acme/api"))?.id, project.id);
});

test("new-project intake is workspace-scoped and never creates an executable project", async () => {
  const registry = new MemoryProjectRegistry();
  const first = await registry.createWorkspace({ name: "Starter", slug: "starter" });
  const second = await registry.createWorkspace({ name: "Separate", slug: "separate" });
  const item = await registry.createNewProjectIntake({
    workspaceId: first.id, name: "Customer portal", goal: "Build a customer portal with appointment booking.",
    ownershipMode: "customer_owned", monthlyBudgetUsd: 100, requestedBy: "owner@example.test",
  });
  assert.equal(item.status, "pending_review");
  assert.equal(item.ownershipMode, "customer_owned");
  assert.deepEqual((await registry.listNewProjectIntakes(first.id)).map(value => value.id), [item.id]);
  assert.deepEqual(await registry.listNewProjectIntakes(second.id), []);
  assert.deepEqual(await registry.listProjects(first.id), []);
  const returned = await registry.listNewProjectIntakes(first.id);
  returned[0]!.name = "mutated";
  assert.equal((await registry.listNewProjectIntakes(first.id))[0]?.name, "Customer portal");
});

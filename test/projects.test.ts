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

test("new-project activation links the original intake to a configured project only once", async () => {
  const registry = new MemoryProjectRegistry();
  const workspace = await registry.createWorkspace({ name: "Starter", slug: "starter-activation" });
  const intake = await registry.createNewProjectIntake({
    workspaceId: workspace.id, name: "Fresh portal", goal: "Build a secure portal for client appointments.",
    ownershipMode: "customer_owned", requestedBy: "admin@example.test",
  });
  const policy = { testCommand: ["npm", "test"], timeoutSeconds: 300, maxChangedFiles: 10,
    maxChangedBytes: 100_000, protectedPaths: [".github"] };
  const result = await registry.activateNewProjectIntake(intake.id, {
    workspaceId: workspace.id, name: intake.name, repository: "acme/fresh-portal", defaultBranch: "main",
    githubInstallationId: 99, policy, tracker: "github_issue",
  });
  assert.equal(result.intake.status, "activated");
  assert.equal(result.intake.activatedProjectId, result.project.id);
  assert.equal((await registry.listNewProjectIntakes(workspace.id))[0]?.status, "activated");
  assert.equal((await registry.listProjects(workspace.id))[0]?.id, result.project.id);
  await assert.rejects(registry.activateNewProjectIntake(intake.id, {
    workspaceId: workspace.id, name: intake.name, repository: "acme/second", defaultBranch: "main",
    githubInstallationId: 99, policy, tracker: "github_issue",
  }), /already activated/);
});

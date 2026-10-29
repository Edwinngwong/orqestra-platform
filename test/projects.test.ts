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

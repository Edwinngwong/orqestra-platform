import assert from "node:assert/strict";
import test from "node:test";
import { MemoryMuseStore, MuseService } from "../src/muse.js";
import { Orchestrator } from "../src/orchestrator.js";
import { MemoryProjectRegistry } from "../src/projects.js";

process.env.NODE_ENV = "test";
const { createPlatformServer } = await import("../src/server.js");

test("exposes authenticated Muse proposal and confirmation endpoints", async () => {
  const orchestrator = new Orchestrator({ async implement() { throw new Error("not called"); } }, { async runTests() { throw new Error("not called"); } }, { async createDraft() { throw new Error("not called"); } });
  const projects = new MemoryProjectRegistry();
  const workspace = await projects.createWorkspace({ name: "Acme", slug: "acme" });
  const project = await projects.createProject({ workspaceId: workspace.id, name: "App", repository: "acme/app", defaultBranch: "main", githubInstallationId: 12, tracker: "orqestra_only", policy: { testCommand: ["npm", "test"], timeoutSeconds: 300, maxChangedFiles: 10, maxChangedBytes: 100_000, protectedPaths: [".github"] } });
  const muse = new MuseService(new MemoryMuseStore(), { async create() { return undefined; } }, orchestrator);
  const server = createPlatformServer(orchestrator, { webhookSecret: "secret", operatorToken: "operator" }, undefined, projects, undefined, undefined, muse);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`; const headers = { authorization: "Bearer operator", "content-type": "application/json" };
  try {
    const response = await fetch(`${base}/v1/muse/work-items`, { method: "POST", headers, body: JSON.stringify({ workspaceId: workspace.id, projectId: project.id, channel: "whatsapp", sourceReference: "wa-1", title: "Fix checkout", objective: "Checkout succeeds", acceptanceCriteria: ["Payment completes"], constraints: [] }) });
    assert.equal(response.status, 201);
    const proposal = await response.json() as { id: string; status: string };
    assert.equal(proposal.status, "proposed");
    const confirmation = await fetch(`${base}/v1/muse/work-items/${proposal.id}/confirm`, { method: "POST", headers });
    assert.equal(confirmation.status, 200);
    const routed = await confirmation.json() as { status: string; runId: string };
    assert.equal(routed.status, "routed");
    assert.equal((await orchestrator.get(routed.runId)).status, "awaiting_intake_approval");
    assert.equal((await (await fetch(`${base}/v1/muse/work-items`, { headers })).json() as unknown[]).length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

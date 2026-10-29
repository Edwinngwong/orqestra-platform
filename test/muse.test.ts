import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Pool } from "pg";
import test from "node:test";
import { RoutedWorkTracker, type TrackerInput } from "../src/adapters/trackers.js";
import type { Project } from "../src/domain.js";
import { MemoryMuseStore, MuseService, PostgresMuseStore } from "../src/muse.js";
import { Orchestrator } from "../src/orchestrator.js";

const project: Project = { id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), name: "App", repository: "acme/app", defaultBranch: "main", githubInstallationId: 42, tracker: "github_issue", policy: { testCommand: ["npm", "test"], timeoutSeconds: 300, maxChangedFiles: 10, maxChangedBytes: 100_000, protectedPaths: [".github"] }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

test("Muse confirms a proposal, routes it to the selected tracker, and creates an approval-pending run", async () => {
  const store = new MemoryMuseStore();
  const routed: TrackerInput[] = [];
  const orchestrator = new Orchestrator({ async implement() { throw new Error("not called"); } }, { async runTests() { throw new Error("not called"); } }, { async createDraft() { throw new Error("not called"); } });
  const muse = new MuseService(store, { async create(input) { routed.push(input); return { id: "17", url: "https://github.test/acme/app/issues/17" }; } }, orchestrator);
  const proposal = await muse.propose({ workspaceId: project.workspaceId, projectId: project.id, channel: "whatsapp", sourceReference: "message-7", requesterId: "user-1", title: "Add reminders", objective: "Notify users before appointments", acceptanceCriteria: ["A reminder is sent"], constraints: ["Keep existing notifications"] }, project);
  assert.equal(proposal.status, "proposed");
  const result = await muse.confirm(proposal.id, "reviewer@example.test", project);
  assert.equal(result.status, "routed");
  assert.equal(result.externalId, "17");
  assert.equal(routed[0]?.kind, "github_issue");
  assert(result.runId);
  const run = await orchestrator.get(result.runId);
  assert.equal(run.status, "awaiting_intake_approval");
  assert.equal(run.workItem.source, "muse");
  assert.equal(run.workItem.repository, "acme/app");
  await assert.rejects(() => muse.confirm(proposal.id, "reviewer@example.test", project), /Cannot confirm/);
});

test("Muse proposal intake is idempotent for a channel source and project", async () => {
  const muse = new MuseService(new MemoryMuseStore(), { async create() { return undefined; } }, new Orchestrator({ async implement() { throw new Error("not called"); } }, { async runTests() { throw new Error("not called"); } }, { async createDraft() { throw new Error("not called"); } }));
  const input = { workspaceId: project.workspaceId, projectId: project.id, channel: "whatsapp" as const, sourceReference: "wamid.retry", requesterId: "user-1", title: "Health check", objective: "Expose health", acceptanceCriteria: ["Returns 200"], constraints: [] };
  const first = await muse.propose(input, project); const retry = await muse.propose(input, project);
  assert.equal(retry.id, first.id);
});

test("tracker routing supports GitHub, Jira, and Orqestra-only policies", async () => {
  const received: Array<{ url?: string; body: string }> = [];
  const server = createServer(async (request, response) => { let body = ""; for await (const chunk of request) body += chunk; received.push({ ...(request.url ? { url: request.url } : {}), body }); response.writeHead(201, { "content-type": "application/json" }); response.end(request.url?.includes("/repos/") ? JSON.stringify({ number: 9, html_url: "https://github.test/issues/9" }) : JSON.stringify({ key: "APP-9" })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  try {
    const tracker = new RoutedWorkTracker(async id => { assert.equal(id, 42); return "installation-token"; }, { baseUrl: base, email: "jira@example.test", apiToken: "jira-token" }, base);
    assert.equal((await tracker.create({ kind: "orqestra_only", repository: "acme/app", githubInstallationId: 42, title: "A", body: "B" })), undefined);
    assert.equal((await tracker.create({ kind: "github_issue", repository: "acme/app", githubInstallationId: 42, title: "A", body: "B" }))?.id, "9");
    assert.equal((await tracker.create({ kind: "jira_issue", repository: "acme/app", githubInstallationId: 42, jiraProjectKey: "APP", title: "A", body: "B" }))?.id, "APP-9");
    assert.equal(received.length, 2);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("persists Muse criteria and constraints as PostgreSQL JSON", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); const workspaceId = crypto.randomUUID(); const projectId = crypto.randomUUID();
  try {
    await pool.query("INSERT INTO workspaces(id,name,slug) VALUES($1,$2,$3)", [workspaceId, "Muse JSON Test", `muse-json-${workspaceId.slice(0, 8)}`]);
    await pool.query("INSERT INTO projects(id,workspace_id,name,repository,github_installation_id,policy) VALUES($1,$2,$3,$4,$5,$6)", [projectId, workspaceId, "App", `test-${workspaceId.slice(0, 8)}/app`, 1, JSON.stringify(project.policy)]);
    const store = new PostgresMuseStore(pool); const value = await store.create({ workspaceId, projectId, channel: "whatsapp", sourceReference: `wamid.${crypto.randomUUID()}`, requesterId: crypto.randomUUID(), title: "Fix checkout", objective: "Checkout succeeds", acceptanceCriteria: ["Payment succeeds"], constraints: ["Keep existing flow"] }, "orqestra_only");
    assert.deepEqual(value.acceptanceCriteria, ["Payment succeeds"]); assert.deepEqual(value.constraints, ["Keep existing flow"]);
  } finally { await pool.query("DELETE FROM workspaces WHERE id=$1", [workspaceId]); await pool.end(); }
});

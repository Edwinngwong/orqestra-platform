import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { Orchestrator } from "../src/orchestrator.js";
import { MemoryProjectRegistry } from "../src/projects.js";

process.env.NODE_ENV = "test";
const { createPlatformServer } = await import("../src/server.js");

test("accepts a signed GitHub issue and creates an approval-pending run", async () => {
  const orchestrator = new Orchestrator(
    { async implement() { throw new Error("not called"); } },
    { async runTests() { throw new Error("not called"); } },
    { async createDraft() { throw new Error("not called"); } },
  );
  const server = createPlatformServer(orchestrator, { webhookSecret: "secret", operatorToken: "operator-secret" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const body = JSON.stringify({ action: "opened", issue: { number: 9, title: "Health check", body: "Add it" }, repository: { full_name: "acme/api", default_branch: "main" } });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  try {
    const headers = { "x-github-event": "issues", "x-github-delivery": "delivery-9", "x-hub-signature-256": signature, "content-type": "application/json" };
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/github`, { method: "POST", headers, body });
    assert.equal(response.status, 201);
    const result = await response.json() as { runId: string; status: string };
    assert.equal(result.status, "awaiting_intake_approval");
    assert.equal((await orchestrator.get(result.runId)).workItem.repository, "acme/api");
    const duplicate = await fetch(`http://127.0.0.1:${address.port}/webhooks/github`, { method: "POST", headers, body });
    assert.equal(duplicate.status, 202);
    assert.deepEqual(await duplicate.json(), { duplicate: true });
    const denied = await fetch(`http://127.0.0.1:${address.port}/v1/runs/${result.runId}`);
    assert.equal(denied.status, 401);
    const approved = await fetch(`http://127.0.0.1:${address.port}/v1/runs/${result.runId}/approve-intake`, { method: "POST", headers: { authorization: "Bearer operator-secret", "x-orqestra-actor": "alice@example.test" } });
    assert.equal(approved.status, 202);
    assert.equal((await approved.json() as { status: string }).status, "queued");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("requires project onboarding and exposes workspace, project, and run lists", async () => {
  const orchestrator = new Orchestrator(
    { async implement() { throw new Error("not called"); } },
    { async runTests() { throw new Error("not called"); } },
    { async createDraft() { throw new Error("not called"); } },
  );
  const registry = new MemoryProjectRegistry();
  const server = createPlatformServer(orchestrator, { webhookSecret: "secret", operatorToken: "operator-secret" }, undefined, registry);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const operatorHeaders = { authorization: "Bearer operator-secret", "content-type": "application/json" };
  const payload = JSON.stringify({ action: "opened", issue: { number: 10, title: "Health check", body: "Add it" }, repository: { full_name: "acme/api", default_branch: "main" }, installation: { id: 44 } });
  const webhookHeaders = { "x-github-event": "issues", "x-github-delivery": "delivery-10", "x-hub-signature-256": `sha256=${createHmac("sha256", "secret").update(payload).digest("hex")}`, "content-type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/webhooks/github`, { method: "POST", headers: webhookHeaders, body: payload })).status, 409);
    const workspaceResponse = await fetch(`${base}/v1/workspaces`, { method: "POST", headers: operatorHeaders, body: JSON.stringify({ name: "Acme", slug: "acme" }) });
    assert.equal(workspaceResponse.status, 201);
    const workspace = await workspaceResponse.json() as { id: string };
    const projectResponse = await fetch(`${base}/v1/projects`, { method: "POST", headers: operatorHeaders, body: JSON.stringify({ workspaceId: workspace.id, name: "API", repository: "acme/api", defaultBranch: "main", githubInstallationId: 44 }) });
    assert.equal(projectResponse.status, 201);
    assert.equal((await fetch(`${base}/webhooks/github`, { method: "POST", headers: webhookHeaders, body: payload })).status, 201);
    assert.equal((await (await fetch(`${base}/v1/workspaces`, { headers: operatorHeaders })).json() as unknown[]).length, 1);
    assert.equal((await (await fetch(`${base}/v1/projects`, { headers: operatorHeaders })).json() as unknown[]).length, 1);
    assert.equal((await (await fetch(`${base}/v1/runs`, { headers: operatorHeaders })).json() as unknown[]).length, 1);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("serves the operator console when a Muse proposal query is present", async () => {
  const orchestrator = new Orchestrator(
    { async implement() { throw new Error("not called"); } },
    { async runTests() { throw new Error("not called"); } },
    { async createDraft() { throw new Error("not called"); } },
  );
  const server = createPlatformServer(orchestrator, { webhookSecret: "secret", operatorToken: "operator-secret" });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/?muse=60f3c9a5-bb09-4087-a779-78df0b6875b5`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ORQESTRA/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("new-project requests validate inputs and do not create repositories or run workflows", async () => {
  const orchestrator = new Orchestrator(
    { async implement() { throw new Error("not called"); } },
    { async runTests() { throw new Error("not called"); } },
    { async createDraft() { throw new Error("not called"); } },
  );
  const registry = new MemoryProjectRegistry();
  const server = createPlatformServer(orchestrator, { webhookSecret: "secret", operatorToken: "operator-secret" }, undefined, registry);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: "Bearer operator-secret", "content-type": "application/json" };
  try {
    const workspace = await registry.createWorkspace({ name: "Acme", slug: "acme" });
    const valid = { workspaceId: workspace.id, name: "Booking Platform", goal: "Customers can book and manage their appointments.", ownershipMode: "orqestra_managed" };
    assert.equal((await fetch(`${base}/v1/new-project-intakes`)).status, 401);
    for (const change of [
      { goal: "short" }, { name: "" }, { ownershipMode: "unknown" },
      { monthlyBudgetUsd: 0 }, { monthlyBudgetUsd: 1.5 }, { monthlyBudgetUsd: 100001 },
    ]) {
      const response = await fetch(`${base}/v1/new-project-intakes`, { method: "POST", headers, body: JSON.stringify({ ...valid, ...change }) });
      assert.equal(response.status, 400, await response.text());
    }
    const response = await fetch(`${base}/v1/new-project-intakes`, { method: "POST", headers, body: JSON.stringify(valid) });
    assert.equal(response.status, 201);
    const item = await response.json() as { id: string; requestedBy: string; status: string };
    assert.equal(item.status, "pending_review");
    assert.equal(item.requestedBy, "local-operator");
    const listed = await fetch(`${base}/v1/new-project-intakes?workspaceId=${workspace.id}`, { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json() as Array<{ id: string }>).map(value => value.id), [item.id]);
    assert.deepEqual(await (await fetch(`${base}/v1/projects`, { headers })).json(), []);
    assert.deepEqual(await (await fetch(`${base}/v1/runs`, { headers })).json(), []);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { Orchestrator } from "../src/orchestrator.js";

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
    assert.equal(approved.status, 200);
    assert.equal((await approved.json() as { status: string }).status, "queued");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

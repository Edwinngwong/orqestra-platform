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
  const server = createPlatformServer(orchestrator, "secret");
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const body = JSON.stringify({ action: "opened", issue: { number: 9, title: "Health check", body: "Add it" }, repository: { full_name: "acme/api", default_branch: "main" } });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/webhooks/github`, { method: "POST", headers: { "x-github-event": "issues", "x-hub-signature-256": signature, "content-type": "application/json" }, body });
    assert.equal(response.status, 201);
    const result = await response.json() as { runId: string; status: string };
    assert.equal(result.status, "awaiting_intake_approval");
    assert.equal(orchestrator.get(result.runId).workItem.repository, "acme/api");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

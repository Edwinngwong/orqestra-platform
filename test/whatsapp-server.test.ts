import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { MemoryMuseStore, MuseService } from "../src/muse.js";
import { Orchestrator } from "../src/orchestrator.js";
import { MemoryProjectRegistry } from "../src/projects.js";
import { MemoryWhatsAppStore, WhatsAppMuseService } from "../src/whatsapp.js";

process.env.NODE_ENV = "test";
const { createPlatformServer } = await import("../src/server.js");

test("serves Meta verification and durably accepts signed webhook messages", async () => {
  const orchestrator = new Orchestrator({ async implement() { throw new Error("not called"); } }, { async runTests() { throw new Error("not called"); } }, { async createDraft() { throw new Error("not called"); } });
  const projects = new MemoryProjectRegistry(); const muse = new MuseService(new MemoryMuseStore(), { async create() { return undefined; } }, orchestrator); const whatsapp = new WhatsAppMuseService(new MemoryWhatsAppStore(), projects, muse, { async interpret() { throw new Error("not called"); } }, { async sendText() { throw new Error("not called"); } });
  const server = createPlatformServer(orchestrator, { webhookSecret: "github", operatorToken: "operator", whatsappAppSecret: "app-secret", whatsappVerifyToken: "verify-token", whatsappPhoneNumberId: "1001", publicBaseUrl: "https://muse.example" }, undefined, projects, undefined, undefined, muse, whatsapp);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1001" }, messages: [{ id: "wamid.1", from: "15550100", type: "text", text: { body: "@muse fix checkout" } }] } }] }] });
  try {
    const challenge = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=987`); assert.equal(challenge.status, 200); assert.equal(await challenge.text(), "987");
    assert.equal((await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=987`)).status, 403);
    assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "x-hub-signature-256": "sha256=bad" }, body: payload })).status, 401);
    const signature = `sha256=${createHmac("sha256", "app-secret").update(payload).digest("hex")}`;
    const accepted = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "x-hub-signature-256": signature, "content-type": "application/json" }, body: payload }); assert.equal(accepted.status, 200); assert.deepEqual(await accepted.json(), { accepted: 1 });
    const replay = await fetch(`${base}/webhooks/whatsapp`, { method: "POST", headers: { "x-hub-signature-256": signature, "content-type": "application/json" }, body: payload }); assert.deepEqual(await replay.json(), { accepted: 0 });
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

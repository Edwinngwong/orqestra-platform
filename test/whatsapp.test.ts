import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Pool } from "pg";
import test from "node:test";
import { parseMuseInterpretation } from "../src/adapters/openai-muse.js";
import { WhatsAppCloudClient } from "../src/adapters/whatsapp.js";
import { MemoryMuseStore, MuseService } from "../src/muse.js";
import { Orchestrator } from "../src/orchestrator.js";
import { MemoryProjectRegistry } from "../src/projects.js";
import { extractMuseMessages, MemoryWhatsAppStore, PostgresWhatsAppStore, verifyMetaChallenge, verifyMetaSignature, WhatsAppMuseService } from "../src/whatsapp.js";

test("verifies Meta challenges and payload signatures without timing leaks", () => {
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
  assert.equal(verifyMetaSignature(raw, signature, "app-secret"), true);
  assert.equal(verifyMetaSignature(raw, signature, "wrong"), false);
  assert.equal(verifyMetaChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify", "hub.challenge": "123" }), "verify"), "123");
  assert.equal(verifyMetaChallenge(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "123" }), "verify"), undefined);
});

test("extracts only explicit bounded @muse text messages", () => {
  const payload = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1001" }, messages: [{ id: "wamid.1", from: "15550100", type: "text", text: { body: "@muse: fix checkout" } }, { id: "wamid.2", from: "15550100", type: "text", text: { body: "normal conversation" } }] } }] }] };
  assert.deepEqual(extractMuseMessages(payload, "https://muse.example"), [{ id: "wamid.1", senderWaId: "15550100", businessPhoneNumberId: "1001", text: "fix checkout", publicBaseUrl: "https://muse.example" }]);
});

test("interprets an authorized WhatsApp request into a Muse proposal and reply", async () => {
  const projects = new MemoryProjectRegistry(); const workspace = await projects.createWorkspace({ name: "Acme", slug: "acme" });
  const project = await projects.createProject({ workspaceId: workspace.id, name: "App", repository: "acme/app", defaultBranch: "main", githubInstallationId: 12, tracker: "orqestra_only", policy: { testCommand: ["npm", "test"], timeoutSeconds: 300, maxChangedFiles: 10, maxChangedBytes: 100_000, protectedPaths: [".github"] } });
  const orchestrator = new Orchestrator({ async implement() { throw new Error("not called"); } }, { async runTests() { throw new Error("not called"); } }, { async createDraft() { throw new Error("not called"); } });
  const muse = new MuseService(new MemoryMuseStore(), { async create() { return undefined; } }, orchestrator); const store = new MemoryWhatsAppStore(); const replies: string[] = [];
  const service = new WhatsAppMuseService(store, projects, muse, { async interpret(message, selected) { assert.equal(message, "fix checkout"); assert.equal(selected.repository, "acme/app"); return { ready: true, title: "Fix checkout", objective: "Checkout completes", acceptanceCriteria: ["Payment succeeds"], constraints: [], clarificationQuestion: "" }; } }, { async sendText(to, text) { assert.equal(to, "15550100"); replies.push(text); return "wamid.reply"; } });
  const binding = await service.createBinding({ workspaceId: workspace.id, projectId: project.id, requesterId: crypto.randomUUID(), senderWaId: "15550100", businessPhoneNumberId: "1001" });
  assert.deepEqual(await service.receive({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1001" }, messages: [{ id: "wamid.1", from: "15550100", type: "text", text: { body: "@muse fix checkout" } }] } }] }] }, "https://muse.example"), [true]);
  assert.deepEqual(await service.receive({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1001" }, messages: [{ id: "wamid.1", from: "15550100", type: "text", text: { body: "@muse fix checkout" } }] } }] }] }, "https://muse.example"), [false]);
  assert.equal(await service.processNext(), true); assert.match(replies[0]!, /Review and confirm/); assert.match(replies[0]!, /https:\/\/muse\.example\/\?muse=/);
  const proposals = await muse.list(workspace.id); assert.equal(proposals.length, 1); assert.equal(proposals[0]?.channel, "whatsapp"); assert.equal(proposals[0]?.status, "proposed");
  await service.deactivateBinding(binding.id);
  await service.receive({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "1001" }, messages: [{ id: "wamid.2", from: "15550100", type: "text", text: { body: "@muse another request" } }] } }] }] }, "https://muse.example");
  assert.equal(await service.processNext(), true); assert.equal(replies.length, 1); assert.equal((await muse.list(workspace.id)).length, 1);
});

test("asks for clarification and rejects invalid model output", async () => {
  assert.throws(() => parseMuseInterpretation({ ready: true, title: "", objective: "", acceptanceCriteria: [], constraints: [], clarificationQuestion: "" }), /incomplete/);
  assert.equal(parseMuseInterpretation({ ready: false, title: "", objective: "", acceptanceCriteria: [], constraints: [], clarificationQuestion: "Which screen?" }).clarificationQuestion, "Which screen?");
});

test("sends bounded text through the WhatsApp Cloud API", async () => {
  const requests: Array<{ authorization?: string; body: string }> = [];
  const server = createServer(async (request, response) => { let body = ""; for await (const chunk of request) body += chunk; requests.push({ ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}), body }); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ messages: [{ id: "wamid.sent" }] })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert(address && typeof address === "object");
  try { const client = new WhatsAppCloudClient("1001", "access-token", "v25.0", `http://127.0.0.1:${address.port}`); assert.equal(await client.sendText("15550100", "Proposal ready"), "wamid.sent"); assert.equal(requests[0]?.authorization, "Bearer access-token"); assert.match(requests[0]?.body ?? "", /Proposal ready/); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("durably leases each WhatsApp message once", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); const store = new PostgresWhatsAppStore(pool); const id = `wamid.test.${crypto.randomUUID()}`;
  try {
    assert.equal(await store.receive({ id, senderWaId: "15550100", businessPhoneNumberId: "1001", text: "fix checkout", publicBaseUrl: "https://muse.example" }), true);
    assert.equal(await store.receive({ id, senderWaId: "15550100", businessPhoneNumberId: "1001", text: "fix checkout", publicBaseUrl: "https://muse.example" }), false);
    const leased = await store.next(); assert.equal(leased?.id, id); assert.equal(leased?.attempts, 1); await store.complete(id);
  } finally { await pool.query("DELETE FROM whatsapp_messages WHERE id=$1", [id]); await pool.end(); }
});

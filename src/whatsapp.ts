import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { MuseInterpreter } from "./adapters/openai-muse.js";
import type { WhatsAppMessenger } from "./adapters/whatsapp.js";
import type { MuseService } from "./muse.js";
import type { ProjectRegistry } from "./projects.js";

export interface WhatsAppBinding { id: string; workspaceId: string; projectId: string; requesterId: string; senderWaId: string; businessPhoneNumberId: string; active: boolean; createdAt: string }
export interface WhatsAppInbound { id: string; senderWaId: string; businessPhoneNumberId: string; text: string; publicBaseUrl: string; attempts: number }
export interface WhatsAppStore {
  createBinding(input: Omit<WhatsAppBinding, "id" | "active" | "createdAt">): Promise<WhatsAppBinding>;
  listBindings(workspaceId?: string): Promise<WhatsAppBinding[]>;
  deactivateBinding(id: string): Promise<void>;
  findBinding(senderWaId: string, businessPhoneNumberId: string): Promise<WhatsAppBinding | undefined>;
  receive(message: Omit<WhatsAppInbound, "attempts">): Promise<boolean>;
  next(): Promise<WhatsAppInbound | undefined>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string): Promise<void>;
  recover(): Promise<void>;
}

export class MemoryWhatsAppStore implements WhatsAppStore {
  private readonly bindings: WhatsAppBinding[] = []; private readonly messages = new Map<string, WhatsAppInbound & { status: string }>();
  async createBinding(input: Omit<WhatsAppBinding, "id" | "active" | "createdAt">) { const existing = this.bindings.find(value => value.senderWaId === input.senderWaId && value.businessPhoneNumberId === input.businessPhoneNumberId); if (existing) throw new Error("WhatsApp sender is already bound"); const value = { ...input, id: crypto.randomUUID(), active: true, createdAt: new Date().toISOString() }; this.bindings.push(value); return structuredClone(value); }
  async listBindings(workspaceId?: string) { return this.bindings.filter(value => !workspaceId || value.workspaceId === workspaceId).map(value => structuredClone(value)); }
  async deactivateBinding(id: string) { const value = this.bindings.find(item => item.id === id); if (value) value.active = false; }
  async findBinding(senderWaId: string, businessPhoneNumberId: string) { const value = this.bindings.find(item => item.active && item.senderWaId === senderWaId && item.businessPhoneNumberId === businessPhoneNumberId); return value && structuredClone(value); }
  async receive(message: Omit<WhatsAppInbound, "attempts">) { if (this.messages.has(message.id)) return false; this.messages.set(message.id, { ...message, attempts: 0, status: "pending" }); return true; }
  async next() { const value = [...this.messages.values()].find(item => ["pending", "failed"].includes(item.status) && item.attempts < 5); if (!value) return undefined; value.status = "processing"; value.attempts++; return structuredClone(value); }
  async complete(id: string) { const value = this.messages.get(id); if (value) value.status = "completed"; }
  async fail(id: string, error: string) { const value = this.messages.get(id); if (value) { value.status = "failed"; Object.assign(value, { error: error.slice(0, 1_000) }); } }
  async recover() { for (const value of this.messages.values()) if (value.status === "processing") value.status = "pending"; }
}

const bindingSelection = 'id,workspace_id AS "workspaceId",project_id AS "projectId",requester_id AS "requesterId",sender_wa_id AS "senderWaId",business_phone_number_id AS "businessPhoneNumberId",active,created_at AS "createdAt"';
const qualifiedBindingSelection = 'b.id,b.workspace_id AS "workspaceId",b.project_id AS "projectId",b.requester_id AS "requesterId",b.sender_wa_id AS "senderWaId",b.business_phone_number_id AS "businessPhoneNumberId",b.active,b.created_at AS "createdAt"';
function mapBinding(row: Record<string, unknown>): WhatsAppBinding { return { id: String(row.id), workspaceId: String(row.workspaceId), projectId: String(row.projectId), requesterId: String(row.requesterId), senderWaId: String(row.senderWaId), businessPhoneNumberId: String(row.businessPhoneNumberId), active: Boolean(row.active), createdAt: new Date(row.createdAt as string | Date).toISOString() }; }
export class PostgresWhatsAppStore implements WhatsAppStore {
  constructor(private readonly pool: Pool) {}
  async createBinding(input: Omit<WhatsAppBinding, "id" | "active" | "createdAt">) { const result = await this.pool.query(`INSERT INTO whatsapp_bindings(id,workspace_id,project_id,requester_id,sender_wa_id,business_phone_number_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING ${bindingSelection}`, [crypto.randomUUID(), input.workspaceId, input.projectId, input.requesterId, input.senderWaId, input.businessPhoneNumberId]); return mapBinding(result.rows[0]); }
  async listBindings(workspaceId?: string) { const result = await this.pool.query(`SELECT ${bindingSelection} FROM whatsapp_bindings ${workspaceId ? "WHERE workspace_id=$1" : ""} ORDER BY created_at DESC`, workspaceId ? [workspaceId] : []); return result.rows.map(mapBinding); }
  async deactivateBinding(id: string) { await this.pool.query("UPDATE whatsapp_bindings SET active=false WHERE id=$1", [id]); }
  async findBinding(senderWaId: string, businessPhoneNumberId: string) { const result = await this.pool.query(`SELECT ${qualifiedBindingSelection} FROM whatsapp_bindings b JOIN users u ON u.id=b.requester_id AND u.active JOIN workspace_memberships m ON m.workspace_id=b.workspace_id AND m.user_id=b.requester_id WHERE b.sender_wa_id=$1 AND b.business_phone_number_id=$2 AND b.active`, [senderWaId, businessPhoneNumberId]); return result.rows[0] && mapBinding(result.rows[0]); }
  async receive(message: Omit<WhatsAppInbound, "attempts">) { const result = await this.pool.query("INSERT INTO whatsapp_messages(id,sender_wa_id,business_phone_number_id,message_text,public_base_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id", [message.id, message.senderWaId, message.businessPhoneNumberId, message.text, message.publicBaseUrl]); return result.rowCount === 1; }
  async next() { const result = await this.pool.query(`UPDATE whatsapp_messages SET status='processing',attempts=attempts+1,updated_at=now() WHERE id=(SELECT id FROM whatsapp_messages WHERE status IN ('pending','failed') AND attempts<5 ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,sender_wa_id AS "senderWaId",business_phone_number_id AS "businessPhoneNumberId",message_text AS text,public_base_url AS "publicBaseUrl",attempts`); const row = result.rows[0]; return row && { id: String(row.id), senderWaId: String(row.senderWaId), businessPhoneNumberId: String(row.businessPhoneNumberId), text: String(row.text), publicBaseUrl: String(row.publicBaseUrl), attempts: Number(row.attempts) }; }
  async complete(id: string) { await this.pool.query("UPDATE whatsapp_messages SET status='completed',processed_at=now(),last_error=NULL,updated_at=now() WHERE id=$1", [id]); }
  async fail(id: string, error: string) { await this.pool.query("UPDATE whatsapp_messages SET status='failed',last_error=$2,updated_at=now() WHERE id=$1", [id, error.slice(0, 1_000)]); }
  async recover() { await this.pool.query("UPDATE whatsapp_messages SET status='pending',updated_at=now() WHERE status='processing'"); }
}

export function verifyMetaSignature(raw: Buffer, signature: string | undefined, appSecret: string): boolean {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const received = Buffer.from(signature.slice(7), "hex"); const expected = createHmac("sha256", appSecret).update(raw).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
function secureEqual(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
export function verifyMetaChallenge(query: URLSearchParams, verifyToken: string): string | undefined { return query.get("hub.mode") === "subscribe" && secureEqual(query.get("hub.verify_token") ?? "", verifyToken) ? query.get("hub.challenge") ?? undefined : undefined; }

export function extractMuseMessages(payload: unknown, publicBaseUrl: string): Array<Omit<WhatsAppInbound, "attempts">> {
  const result: Array<Omit<WhatsAppInbound, "attempts">> = [];
  const root = payload as { object?: string; entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string }; messages?: Array<{ id?: string; from?: string; type?: string; text?: { body?: string } }> } }> }> };
  if (root.object !== "whatsapp_business_account") return result;
  for (const entry of root.entry ?? []) for (const change of entry.changes ?? []) { const phone = change.value?.metadata?.phone_number_id; for (const message of change.value?.messages ?? []) { const text = message.text?.body?.trim(); if (phone && message.id && message.from && message.type === "text" && text && text.length <= 4096 && /^@muse\b/i.test(text)) result.push({ id: message.id, senderWaId: message.from, businessPhoneNumberId: phone, text: text.replace(/^@muse\b[\s:,-]*/i, "").trim(), publicBaseUrl }); } }
  return result.filter(item => item.text.length > 0);
}

export class WhatsAppMuseService {
  constructor(private readonly store: WhatsAppStore, private readonly projects: ProjectRegistry, private readonly muse: MuseService, private readonly interpreter: MuseInterpreter, private readonly messenger: WhatsAppMessenger) {}
  recover() { return this.store.recover(); }
  receive(payload: unknown, publicBaseUrl: string) { return Promise.all(extractMuseMessages(payload, publicBaseUrl).map(message => this.store.receive(message))); }
  listBindings(workspaceId?: string) { return this.store.listBindings(workspaceId); }
  createBinding(input: Omit<WhatsAppBinding, "id" | "active" | "createdAt">) { return this.store.createBinding(input); }
  deactivateBinding(id: string) { return this.store.deactivateBinding(id); }
  async processNext(): Promise<boolean> {
    const message = await this.store.next(); if (!message) return false;
    try {
      const binding = await this.store.findBinding(message.senderWaId, message.businessPhoneNumberId);
      if (!binding) { await this.store.complete(message.id); return true; }
      const project = (await this.projects.listProjects(binding.workspaceId)).find(item => item.id === binding.projectId);
      if (!project) throw new Error("Bound Orqestra project no longer exists");
      const interpretation = await this.interpreter.interpret(message.text, { name: project.name, repository: project.repository });
      if (!interpretation.ready) { await this.messenger.sendText(message.senderWaId, `Muse needs one detail before creating a proposal:\n\n${interpretation.clarificationQuestion}\n\nReply with a new @muse message including that detail.`); await this.store.complete(message.id); return true; }
      const proposal = await this.muse.propose({ workspaceId: binding.workspaceId, projectId: binding.projectId, channel: "whatsapp", sourceReference: message.id, requesterId: binding.requesterId, title: interpretation.title, objective: interpretation.objective, acceptanceCriteria: interpretation.acceptanceCriteria, constraints: interpretation.constraints }, project);
      const link = `${message.publicBaseUrl.replace(/\/$/, "")}/?muse=${encodeURIComponent(proposal.id)}`;
      await this.messenger.sendText(message.senderWaId, `Muse created a proposal for ${project.name}:\n\n${proposal.title}\n\n${proposal.objective}\n\nReview and confirm it here:\n${link}\n\nNo code will run until a reviewer confirms it and approves intake.`);
      await this.store.complete(message.id); return true;
    } catch (error) { await this.store.fail(message.id, error instanceof Error ? error.message : "WhatsApp processing failed"); return true; }
  }
}

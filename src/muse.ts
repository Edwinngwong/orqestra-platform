import type { Pool } from "pg";
import type { IntakeChannel, MuseWorkItem, Project } from "./domain.js";
import type { WorkTracker } from "./adapters/trackers.js";
import type { Orchestrator } from "./orchestrator.js";

export interface ProposeMuseWorkItem {
  workspaceId: string; projectId: string; channel: IntakeChannel; sourceReference: string; requesterId: string;
  title: string; objective: string; acceptanceCriteria: string[]; constraints: string[];
}
export interface MuseStore {
  create(input: ProposeMuseWorkItem, tracker: Project["tracker"]): Promise<MuseWorkItem>;
  get(id: string): Promise<MuseWorkItem | undefined>;
  list(workspaceId?: string): Promise<MuseWorkItem[]>;
  put(item: MuseWorkItem): Promise<void>;
}

export class MemoryMuseStore implements MuseStore {
  private readonly values = new Map<string, MuseWorkItem>();
  async create(input: ProposeMuseWorkItem, tracker: Project["tracker"]) { if ([...this.values.values()].some(value => value.channel === input.channel && value.sourceReference === input.sourceReference && value.projectId === input.projectId)) throw new Error("Muse source reference already exists for this project"); const now = new Date().toISOString(); const value: MuseWorkItem = { ...input, id: crypto.randomUUID(), tracker, status: "proposed", createdAt: now, updatedAt: now }; this.values.set(value.id, value); return structuredClone(value); }
  async get(id: string) { const value = this.values.get(id); return value && structuredClone(value); }
  async list(workspaceId?: string) { return [...this.values.values()].filter(value => !workspaceId || value.workspaceId === workspaceId).map(value => structuredClone(value)); }
  async put(item: MuseWorkItem) { this.values.set(item.id, structuredClone(item)); }
}

function map(row: Record<string, unknown>): MuseWorkItem {
  return { id: String(row.id), workspaceId: String(row.workspaceId), projectId: String(row.projectId), channel: row.channel as IntakeChannel, sourceReference: String(row.sourceReference), requesterId: String(row.requesterId), title: String(row.title), objective: String(row.objective), acceptanceCriteria: row.acceptanceCriteria as string[], constraints: row.constraints as string[], status: row.status as MuseWorkItem["status"], tracker: row.tracker as MuseWorkItem["tracker"], ...(row.confirmedBy ? { confirmedBy: String(row.confirmedBy) } : {}), ...(row.confirmedAt ? { confirmedAt: new Date(row.confirmedAt as string | Date).toISOString() } : {}), ...(row.externalId ? { externalId: String(row.externalId) } : {}), ...(row.externalUrl ? { externalUrl: String(row.externalUrl) } : {}), ...(row.runId ? { runId: String(row.runId) } : {}), createdAt: new Date(row.createdAt as string | Date).toISOString(), updatedAt: new Date(row.updatedAt as string | Date).toISOString() };
}
const selection = 'id,workspace_id AS "workspaceId",project_id AS "projectId",channel,source_reference AS "sourceReference",requester_id AS "requesterId",title,objective,acceptance_criteria AS "acceptanceCriteria",constraints,status,tracker_type AS tracker,confirmed_by AS "confirmedBy",confirmed_at AS "confirmedAt",external_id AS "externalId",external_url AS "externalUrl",run_id AS "runId",created_at AS "createdAt",updated_at AS "updatedAt"';
export class PostgresMuseStore implements MuseStore {
  constructor(private readonly pool: Pool) {}
  async create(input: ProposeMuseWorkItem, tracker: Project["tracker"]) { const result = await this.pool.query(`INSERT INTO muse_work_items(id,workspace_id,project_id,channel,source_reference,requester_id,title,objective,acceptance_criteria,constraints,tracker_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${selection}`, [crypto.randomUUID(), input.workspaceId, input.projectId, input.channel, input.sourceReference, input.requesterId, input.title, input.objective, input.acceptanceCriteria, input.constraints, tracker]); return map(result.rows[0]); }
  async get(id: string) { const result = await this.pool.query(`SELECT ${selection} FROM muse_work_items WHERE id=$1`, [id]); return result.rows[0] && map(result.rows[0]); }
  async list(workspaceId?: string) { const result = await this.pool.query(`SELECT ${selection} FROM muse_work_items ${workspaceId ? "WHERE workspace_id=$1" : ""} ORDER BY created_at DESC`, workspaceId ? [workspaceId] : []); return result.rows.map(map); }
  async put(item: MuseWorkItem) { await this.pool.query('UPDATE muse_work_items SET status=$2,confirmed_by=$3,confirmed_at=$4,external_id=$5,external_url=$6,run_id=$7,updated_at=now() WHERE id=$1', [item.id, item.status, item.confirmedBy ?? null, item.confirmedAt ?? null, item.externalId ?? null, item.externalUrl ?? null, item.runId ?? null]); }
}

export class MuseService {
  constructor(private readonly store: MuseStore, private readonly tracker: WorkTracker, private readonly orchestrator: Orchestrator) {}
  list(workspaceId?: string) { return this.store.list(workspaceId); }
  propose(input: ProposeMuseWorkItem, project: Project) { return this.store.create(input, project.tracker); }
  async confirm(id: string, actor: string, project: Project): Promise<MuseWorkItem> {
    const item = await this.store.get(id);
    if (!item) throw new Error(`Unknown Muse work item: ${id}`);
    if (!(["proposed", "confirmed"] as string[]).includes(item.status)) throw new Error(`Cannot confirm Muse work item from ${item.status}`);
    if (item.projectId !== project.id || item.workspaceId !== project.workspaceId) throw new Error("Muse work item project mismatch");
    if (item.status === "proposed") {
      item.status = "confirmed"; item.confirmedBy = actor; item.confirmedAt = new Date().toISOString(); item.updatedAt = item.confirmedAt;
      await this.store.put(item);
    }
    const body = `${item.objective}\n\n## Acceptance criteria\n${item.acceptanceCriteria.map(value => `- ${value}`).join("\n")}\n\n## Constraints\n${item.constraints.map(value => `- ${value}`).join("\n")}\n\n<!-- orqestra-muse:${item.id} -->`;
    const external = item.externalId && item.externalUrl ? { id: item.externalId, url: item.externalUrl } : await this.tracker.create({ kind: item.tracker, repository: project.repository, githubInstallationId: project.githubInstallationId, ...(project.jiraProjectKey ? { jiraProjectKey: project.jiraProjectKey } : {}), title: item.title, body });
    if (external && !item.externalId) { item.externalId = external.id; item.externalUrl = external.url; await this.store.put(item); }
    const run = await this.orchestrator.intake({ id: item.id, source: "muse", title: item.title, description: body, repository: project.repository, defaultBranch: project.defaultBranch, githubInstallationId: project.githubInstallationId, workspaceId: project.workspaceId, projectId: project.id, testCommand: project.policy.testCommand, timeoutSeconds: project.policy.timeoutSeconds, maxChangedFiles: project.policy.maxChangedFiles, maxChangedBytes: project.policy.maxChangedBytes, protectedPaths: project.policy.protectedPaths }, `muse:${item.id}`);
    if (!run) throw new Error("Muse work item was already routed");
    item.status = "routed"; item.runId = run.id;
    if (external) { item.externalId = external.id; item.externalUrl = external.url; }
    item.updatedAt = new Date().toISOString();
    await this.store.put(item); return item;
  }
}

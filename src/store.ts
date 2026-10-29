import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Run } from "./domain.js";

export interface AuditEvent { at: string; runId: string; action: string; actor: string }
export interface RunStore {
  create(run: Run, event: AuditEvent, deliveryId?: string): Promise<boolean>;
  get(runId: string): Promise<Run | undefined>;
  put(run: Run): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  audit(runId: string): Promise<AuditEvent[]>;
  list(limit?: number): Promise<Run[]>;
}

interface Database { runs: Record<string, Run>; audit: AuditEvent[]; deliveries: string[] }

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();
  private readonly events: AuditEvent[] = [];
  private readonly deliveries = new Set<string>();
  async create(run: Run, event: AuditEvent, deliveryId?: string) {
    if (deliveryId && this.deliveries.has(deliveryId)) return false;
    if (deliveryId) this.deliveries.add(deliveryId);
    this.runs.set(run.id, structuredClone(run));
    this.events.push(structuredClone(event));
    return true;
  }
  async get(id: string) { const run = this.runs.get(id); return run && structuredClone(run); }
  async put(run: Run) { this.runs.set(run.id, structuredClone(run)); }
  async appendAudit(event: AuditEvent) { this.events.push(structuredClone(event)); }
  async audit(runId: string) { return this.events.filter(event => event.runId === runId).map(event => structuredClone(event)); }
  async list(limit = 100) { return [...this.runs.values()].slice(-limit).reverse().map(run => structuredClone(run)); }
}

export class JsonFileRunStore implements RunStore {
  constructor(private readonly path: string) {}
  async create(run: Run, event: AuditEvent, deliveryId?: string) {
    const db = await this.read();
    if (deliveryId && db.deliveries.includes(deliveryId)) return false;
    if (deliveryId) db.deliveries.push(deliveryId);
    db.runs[run.id] = structuredClone(run);
    db.audit.push(structuredClone(event));
    await this.write(db);
    return true;
  }
  async get(runId: string) { const run = (await this.read()).runs[runId]; return run && structuredClone(run); }
  async put(run: Run) { const db = await this.read(); db.runs[run.id] = structuredClone(run); await this.write(db); }
  async appendAudit(event: AuditEvent) { const db = await this.read(); db.audit.push(structuredClone(event)); await this.write(db); }
  async audit(runId: string) { return (await this.read()).audit.filter(event => event.runId === runId); }
  async list(limit = 100) { return Object.values((await this.read()).runs).slice(-limit).reverse(); }
  private async read(): Promise<Database> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Partial<Database>;
      return { runs: parsed.runs ?? {}, audit: parsed.audit ?? [], deliveries: parsed.deliveries ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: {}, audit: [], deliveries: [] };
      throw error;
    }
  }
  private async write(db: Database): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

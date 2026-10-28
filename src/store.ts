import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Run } from "./domain.js";

export interface AuditEvent {
  at: string;
  runId: string;
  action: string;
  actor: string;
}

export interface RunStore {
  get(runId: string): Run | undefined;
  put(run: Run): void;
  appendAudit(event: AuditEvent): void;
  audit(runId: string): AuditEvent[];
}

interface Database { runs: Record<string, Run>; audit: AuditEvent[] }

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, Run>();
  private readonly events: AuditEvent[] = [];
  get(id: string) { const run = this.runs.get(id); return run && structuredClone(run); }
  put(run: Run) { this.runs.set(run.id, structuredClone(run)); }
  appendAudit(event: AuditEvent) { this.events.push(structuredClone(event)); }
  audit(runId: string) { return this.events.filter(event => event.runId === runId).map(event => structuredClone(event)); }
}

export class JsonFileRunStore implements RunStore {
  constructor(private readonly path: string) {}

  get(runId: string) { const run = this.read().runs[runId]; return run && structuredClone(run); }
  put(run: Run) { const db = this.read(); db.runs[run.id] = structuredClone(run); this.write(db); }
  appendAudit(event: AuditEvent) { const db = this.read(); db.audit.push(structuredClone(event)); this.write(db); }
  audit(runId: string) { return this.read().audit.filter(event => event.runId === runId); }

  private read(): Database {
    try { return JSON.parse(readFileSync(this.path, "utf8")) as Database; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { runs: {}, audit: [] };
      throw error;
    }
  }

  private write(db: Database): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

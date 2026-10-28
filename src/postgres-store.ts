import type { Pool, PoolClient } from "pg";
import type { Run } from "./domain.js";
import type { AuditEvent, RunStore } from "./store.js";

export class PostgresRunStore implements RunStore {
  constructor(private readonly pool: Pool) {}
  async create(run: Run, event: AuditEvent, deliveryId?: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (deliveryId) {
        const claimed = await client.query("INSERT INTO webhook_deliveries (delivery_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING delivery_id", [deliveryId]);
        if (claimed.rowCount === 0) { await client.query("ROLLBACK"); return false; }
      }
      await this.insertRun(client, run);
      await this.insertAudit(client, event);
      await client.query("COMMIT");
      return true;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async get(runId: string): Promise<Run | undefined> {
    const result = await this.pool.query("SELECT payload FROM runs WHERE id = $1", [runId]);
    return result.rows[0]?.payload as Run | undefined;
  }
  async put(run: Run): Promise<void> {
    await this.pool.query("UPDATE runs SET status = $2, payload = $3, updated_at = now() WHERE id = $1", [run.id, run.status, run]);
  }
  async appendAudit(event: AuditEvent): Promise<void> { await this.insertAudit(this.pool, event); }
  async audit(runId: string): Promise<AuditEvent[]> {
    const result = await this.pool.query("SELECT occurred_at AS at, run_id AS \"runId\", action, actor FROM audit_events WHERE run_id = $1 ORDER BY id", [runId]);
    return result.rows.map(row => ({ ...row, at: new Date(row.at as string | Date).toISOString() })) as AuditEvent[];
  }
  private async insertRun(client: Pick<PoolClient, "query">, run: Run) {
    await client.query("INSERT INTO runs (id, source, source_item_id, repository, status, payload) VALUES ($1, $2, $3, $4, $5, $6)", [run.id, run.workItem.source, run.workItem.id, run.workItem.repository, run.status, run]);
  }
  private async insertAudit(client: Pick<PoolClient, "query"> | Pool, event: AuditEvent) {
    await client.query("INSERT INTO audit_events (run_id, occurred_at, action, actor) VALUES ($1, $2, $3, $4)", [event.runId, event.at, event.action, event.actor]);
  }
}

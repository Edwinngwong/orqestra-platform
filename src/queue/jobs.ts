import type { Pool } from "pg";

export interface Job { id: string; runId: string; kind: "execute_run"; attempts: number; maxAttempts: number }
export interface JobQueue {
  enqueue(runId: string): Promise<void>;
  lease(workerId: string, leaseSeconds: number): Promise<Job | undefined>;
  heartbeat(jobId: string, workerId: string, leaseSeconds: number): Promise<boolean>;
  complete(jobId: string, workerId: string): Promise<void>;
  fail(jobId: string, workerId: string, error: string): Promise<void>;
  cancel(runId: string): Promise<void>;
}

export class MemoryJobQueue implements JobQueue {
  private readonly jobs: Array<Job & { status: string; owner?: string }> = [];
  async enqueue(runId: string) { const existing = this.jobs.find(job => job.runId === runId); if (existing) { existing.status = "pending"; existing.attempts = 0; delete existing.owner; } else this.jobs.push({ id: crypto.randomUUID(), runId, kind: "execute_run", attempts: 0, maxAttempts: 3, status: "pending" }); }
  async lease(workerId: string) { const job = this.jobs.find(value => value.status === "pending"); if (!job) return undefined; job.status = "leased"; job.owner = workerId; job.attempts += 1; return structuredClone(job); }
  async heartbeat(jobId: string, workerId: string) { return this.jobs.some(job => job.id === jobId && job.owner === workerId && job.status === "leased"); }
  async complete(jobId: string, workerId: string) { const job = this.jobs.find(value => value.id === jobId && value.owner === workerId); if (job) job.status = "completed"; }
  async fail(jobId: string, workerId: string) { const job = this.jobs.find(value => value.id === jobId && value.owner === workerId); if (job) job.status = job.attempts < job.maxAttempts ? "pending" : "failed"; }
  async cancel(runId: string) { const job = this.jobs.find(value => value.runId === runId); if (job) job.status = "cancelled"; }
}

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly pool: Pool) {}
  async enqueue(runId: string) {
    await this.pool.query("INSERT INTO jobs (id, run_id, kind, status) VALUES ($1, $2, 'execute_run', 'pending') ON CONFLICT (run_id, kind) DO UPDATE SET status='pending', attempts=0, available_at=now(), lease_owner=NULL, lease_expires_at=NULL, last_error=NULL, updated_at=now()", [crypto.randomUUID(), runId]);
  }
  async lease(workerId: string, leaseSeconds: number): Promise<Job | undefined> {
    const result = await this.pool.query(`
      WITH candidate AS (
        SELECT id FROM jobs
        WHERE (status = 'pending' AND available_at <= now()) OR (status = 'leased' AND lease_expires_at < now())
        ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE jobs SET status = 'leased', lease_owner = $1,
        lease_expires_at = now() + make_interval(secs => $2), attempts = attempts + 1, updated_at = now()
      WHERE id = (SELECT id FROM candidate)
      RETURNING id, run_id AS "runId", kind, attempts, max_attempts AS "maxAttempts"`, [workerId, leaseSeconds]);
    return result.rows[0] as Job | undefined;
  }
  async heartbeat(jobId: string, workerId: string, leaseSeconds: number) {
    const result = await this.pool.query("UPDATE jobs SET lease_expires_at = now() + make_interval(secs => $3), updated_at = now() WHERE id = $1 AND lease_owner = $2 AND status = 'leased' RETURNING id", [jobId, workerId, leaseSeconds]);
    return result.rowCount === 1;
  }
  async complete(jobId: string, workerId: string) {
    await this.pool.query("UPDATE jobs SET status = 'completed', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND lease_owner = $2", [jobId, workerId]);
  }
  async fail(jobId: string, workerId: string, error: string) {
    await this.pool.query(`UPDATE jobs SET
      status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
      available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE now() + make_interval(secs => LEAST(300, power(2, attempts)::int * 5)) END,
      lease_owner = NULL, lease_expires_at = NULL, last_error = left($3, 4000), updated_at = now()
      WHERE id = $1 AND lease_owner = $2`, [jobId, workerId, error]);
  }
  async cancel(runId: string) { await this.pool.query("UPDATE jobs SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL, updated_at = now() WHERE run_id = $1 AND status IN ('pending', 'leased')", [runId]); }
}

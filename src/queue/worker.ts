import type { Orchestrator } from "../orchestrator.js";
import type { JobQueue } from "./jobs.js";

export class Worker {
  constructor(private readonly id: string, private readonly queue: JobQueue, private readonly orchestrator: Orchestrator, private readonly leaseSeconds = 60) {}
  async workOnce(): Promise<boolean> {
    const job = await this.queue.lease(this.id, this.leaseSeconds);
    if (!job) return false;
    const heartbeat = setInterval(() => void this.queue.heartbeat(job.id, this.id, this.leaseSeconds), Math.max(1000, this.leaseSeconds * 500));
    try {
      await this.orchestrator.execute(job.runId);
      await this.queue.complete(job.id, this.id);
    } catch (error) {
      await this.queue.fail(job.id, this.id, error instanceof Error ? error.message : "Unknown worker error");
    } finally { clearInterval(heartbeat); }
    return true;
  }
}

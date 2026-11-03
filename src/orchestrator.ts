import type { CodingAgent, PullRequests, Run, Sandbox, WorkItem } from "./domain.js";
import { MemoryRunStore, type RunStore } from "./store.js";

export interface RunNotifier { notify(run: Run, event: string): Promise<void> }

export class Orchestrator {
  constructor(
    private readonly agent: CodingAgent,
    private readonly sandbox: Sandbox,
    private readonly pullRequests: PullRequests,
    private readonly store: RunStore = new MemoryRunStore(),
    private readonly notifier?: RunNotifier,
  ) {}

  async intake(item: WorkItem, deliveryId?: string): Promise<Run | undefined> {
    const run: Run = { id: crypto.randomUUID(), workItem: item, status: "awaiting_intake_approval" };
    const event = { at: new Date().toISOString(), runId: run.id, action: "intake_received", actor: "system" };
    return await this.store.create(run, event, deliveryId) ? structuredClone(run) : undefined;
  }

  async get(runId: string): Promise<Run> {
    const run = await this.store.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  list(limit = 100): Promise<Run[]> { return this.store.list(limit); }

  async approveIntake(runId: string, actor = "human"): Promise<Run> {
    const run = await this.get(runId);
    if (run.status !== "awaiting_intake_approval") throw new Error(`Cannot approve intake from ${run.status}`);
    run.status = "queued";
    await this.store.put(run);
    await this.record(run.id, "intake_approved", actor);
    await this.notify(run, "work_started");
    return structuredClone(run);
  }

  async execute(runId: string): Promise<Run> {
    const run = await this.get(runId);
    if (run.status !== "queued") throw new Error(`Cannot execute from ${run.status}`);
    run.status = "running";
    await this.store.put(run);
    try {
      const change = await this.agent.implement(run.workItem);
      run.branch = change.branch;
      const tests = await this.sandbox.runTests(run.workItem, change.commit);
      run.testSummary = tests.summary;
      run.status = tests.passed ? "awaiting_pr_approval" : "tests_failed";
      await this.store.put(run);
      await this.record(run.id, tests.passed ? "tests_passed" : "tests_failed", "system");
      await this.notify(run, tests.passed ? "change_ready" : "run_failed");
    } catch (error) {
      run.status = "failed";
      run.testSummary = error instanceof Error ? error.message : "Execution failed";
      await this.store.put(run);
      await this.record(run.id, "execution_failed", "system");
      await this.notify(run, "run_failed");
    }
    return structuredClone(run);
  }

  async retry(runId: string, actor = "human"): Promise<Run> {
    const run = await this.get(runId);
    if (!(["failed", "tests_failed"] as string[]).includes(run.status)) throw new Error(`Cannot retry from ${run.status}`);
    run.status = "queued";
    delete run.branch;
    delete run.testSummary;
    delete run.pullRequestUrl;
    await this.store.put(run);
    await this.record(run.id, "run_retried", actor);
    return structuredClone(run);
  }

  async approveDraftPullRequest(runId: string, actor = "human"): Promise<Run> {
    const run = await this.get(runId);
    if (run.status !== "awaiting_pr_approval" || !run.branch) {
      throw new Error(`Cannot create draft PR from ${run.status}`);
    }
    run.pullRequestUrl = await this.pullRequests.createDraft({
      repository: run.workItem.repository,
      branch: run.branch,
      base: run.workItem.defaultBranch,
      title: run.workItem.title,
      body: `Automated change for ${run.workItem.source} item ${run.workItem.id}.\n\nTests: ${run.testSummary}`,
      ...(run.workItem.githubInstallationId ? { installationId: run.workItem.githubInstallationId } : {}),
    });
    run.status = "draft_pr_open";
    await this.store.put(run);
    await this.record(run.id, "draft_pr_approved", actor);
    await this.notify(run, "pr_ready");
    return structuredClone(run);
  }

  audit(runId: string) { return this.store.audit(runId); }

  async cancel(runId: string, actor = "human"): Promise<Run> {
    const run = await this.get(runId);
    if (["draft_pr_open", "cancelled"].includes(run.status)) throw new Error(`Cannot cancel from ${run.status}`);
    run.status = "cancelled";
    await this.store.put(run);
    await this.record(run.id, "run_cancelled", actor);
    return structuredClone(run);
  }

  private async record(runId: string, action: string, actor: string): Promise<void> {
    await this.store.appendAudit({ at: new Date().toISOString(), runId, action, actor });
  }

  private async notify(run: Run, event: string): Promise<void> {
    try { await this.notifier?.notify(structuredClone(run), event); }
    catch (error) { console.error("Run notification failed", error instanceof Error ? error.message : error); }
  }
}

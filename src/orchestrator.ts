import type { CodingAgent, PullRequests, Run, Sandbox, WorkItem } from "./domain.js";
import { MemoryRunStore, type RunStore } from "./store.js";

export class Orchestrator {
  constructor(
    private readonly agent: CodingAgent,
    private readonly sandbox: Sandbox,
    private readonly pullRequests: PullRequests,
    private readonly store: RunStore = new MemoryRunStore(),
  ) {}

  intake(item: WorkItem): Run {
    const run: Run = { id: crypto.randomUUID(), workItem: item, status: "awaiting_intake_approval" };
    this.store.put(run);
    this.record(run.id, "intake_received", "system");
    return structuredClone(run);
  }

  get(runId: string): Run {
    const run = this.store.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    return run;
  }

  approveIntake(runId: string, actor = "human"): Run {
    const run = this.get(runId);
    if (run.status !== "awaiting_intake_approval") throw new Error(`Cannot approve intake from ${run.status}`);
    run.status = "queued";
    this.store.put(run);
    this.record(run.id, "intake_approved", actor);
    return structuredClone(run);
  }

  async execute(runId: string): Promise<Run> {
    const run = this.get(runId);
    if (run.status !== "queued") throw new Error(`Cannot execute from ${run.status}`);
    run.status = "running";
    this.store.put(run);
    const change = await this.agent.implement(run.workItem);
    run.branch = change.branch;
    const tests = await this.sandbox.runTests(run.workItem.repository, change.commit);
    run.testSummary = tests.summary;
    run.status = tests.passed ? "awaiting_pr_approval" : "tests_failed";
    this.store.put(run);
    this.record(run.id, tests.passed ? "tests_passed" : "tests_failed", "system");
    return structuredClone(run);
  }

  async approveDraftPullRequest(runId: string, actor = "human"): Promise<Run> {
    const run = this.get(runId);
    if (run.status !== "awaiting_pr_approval" || !run.branch) {
      throw new Error(`Cannot create draft PR from ${run.status}`);
    }
    run.pullRequestUrl = await this.pullRequests.createDraft({
      repository: run.workItem.repository,
      branch: run.branch,
      base: run.workItem.defaultBranch,
      title: run.workItem.title,
      body: `Automated change for ${run.workItem.source} item ${run.workItem.id}.\n\nTests: ${run.testSummary}`,
    });
    run.status = "draft_pr_open";
    this.store.put(run);
    this.record(run.id, "draft_pr_approved", actor);
    return structuredClone(run);
  }

  audit(runId: string) { return this.store.audit(runId); }

  private record(runId: string, action: string, actor: string): void {
    this.store.appendAudit({ at: new Date().toISOString(), runId, action, actor });
  }
}

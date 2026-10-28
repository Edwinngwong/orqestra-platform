export type WorkSource = "github" | "jira";
export type RunStatus =
  | "awaiting_intake_approval"
  | "queued"
  | "running"
  | "tests_failed"
  | "awaiting_pr_approval"
  | "draft_pr_open"
  | "cancelled";

export interface WorkItem {
  id: string;
  source: WorkSource;
  title: string;
  description: string;
  repository: string;
  defaultBranch: string;
  githubInstallationId?: number;
}

export interface Run {
  id: string;
  workItem: WorkItem;
  status: RunStatus;
  branch?: string;
  testSummary?: string;
  pullRequestUrl?: string;
}

export interface AgentResult {
  branch: string;
  commit: string;
  summary: string;
}

export interface TestResult {
  passed: boolean;
  summary: string;
}

export interface CodingAgent {
  implement(item: WorkItem): Promise<AgentResult>;
}

export interface Sandbox {
  runTests(item: WorkItem, commit: string): Promise<TestResult>;
}

export interface PullRequests {
  createDraft(input: { repository: string; branch: string; base: string; title: string; body: string; installationId?: number }): Promise<string>;
}

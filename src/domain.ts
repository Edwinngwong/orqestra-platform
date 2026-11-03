export type WorkSource = "github" | "jira" | "muse";
export type IntakeChannel = "web" | "whatsapp" | "slack" | "teams" | "email" | "github" | "jira";
export type TrackerKind = "github_issue" | "jira_issue" | "orqestra_only";
export type RunStatus =
  | "awaiting_intake_approval"
  | "queued"
  | "running"
  | "failed"
  | "tests_failed"
  | "awaiting_pr_approval"
  | "draft_pr_open"
  | "completed"
  | "cancelled";

export interface WorkItem {
  id: string;
  source: WorkSource;
  title: string;
  description: string;
  repository: string;
  defaultBranch: string;
  githubInstallationId?: number;
  workspaceId?: string;
  projectId?: string;
  testCommand?: string[];
  timeoutSeconds?: number;
  maxChangedFiles?: number;
  maxChangedBytes?: number;
  protectedPaths?: string[];
}

export interface Run {
  id: string;
  workItem: WorkItem;
  status: RunStatus;
  branch?: string;
  testSummary?: string;
  pullRequestUrl?: string;
}

export interface Workspace { id: string; name: string; slug: string; createdAt: string }
export interface ProjectPolicy { testCommand: string[]; timeoutSeconds: number; maxChangedFiles: number; maxChangedBytes: number; protectedPaths: string[] }
export interface Project {
  id: string; workspaceId: string; name: string; repository: string; defaultBranch: string;
  githubInstallationId: number; policy: ProjectPolicy; tracker: TrackerKind; jiraProjectKey?: string; createdAt: string; updatedAt: string;
}

export type MuseWorkItemStatus = "proposed" | "confirmed" | "routed";
export interface MuseWorkItem {
  id: string; workspaceId: string; projectId: string; channel: IntakeChannel; sourceReference: string;
  requesterId: string; title: string; objective: string; acceptanceCriteria: string[]; constraints: string[];
  status: MuseWorkItemStatus; confirmedBy?: string; confirmedAt?: string; tracker: TrackerKind;
  externalId?: string; externalUrl?: string; runId?: string; createdAt: string; updatedAt: string;
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

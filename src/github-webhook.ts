import { createHmac, timingSafeEqual } from "node:crypto";
import type { WorkItem } from "./domain.js";

export function verifyGitHubSignature(body: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

interface GitHubIssuePayload {
  action?: string;
  issue?: { number?: number; title?: string; body?: string | null };
  repository?: { full_name?: string; default_branch?: string };
}

export function githubIssueToWorkItem(payload: GitHubIssuePayload): WorkItem | undefined {
  if (payload.action !== "opened" || !payload.issue?.number || !payload.issue.title || !payload.repository?.full_name) return undefined;
  return {
    id: String(payload.issue.number),
    source: "github",
    title: payload.issue.title,
    description: payload.issue.body ?? "",
    repository: payload.repository.full_name,
    defaultBranch: payload.repository.default_branch ?? "main",
  };
}

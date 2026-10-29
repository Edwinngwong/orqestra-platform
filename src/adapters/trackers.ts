import type { TrackerKind } from "../domain.js";

export interface TrackerItem { id: string; url: string }
export interface TrackerInput {
  kind: TrackerKind; repository: string; githubInstallationId: number; jiraProjectKey?: string;
  title: string; body: string;
}
export interface WorkTracker { create(input: TrackerInput): Promise<TrackerItem | undefined> }

export class RoutedWorkTracker implements WorkTracker {
  constructor(
    private readonly githubToken: (installationId: number) => Promise<string>,
    private readonly jira?: { baseUrl: string; email: string; apiToken: string },
    private readonly githubApiBase = "https://api.github.com",
  ) {}

  async create(input: TrackerInput): Promise<TrackerItem | undefined> {
    if (input.kind === "orqestra_only") return undefined;
    if (input.kind === "github_issue") {
      const token = await this.githubToken(input.githubInstallationId);
      const response = await fetch(`${this.githubApiBase}/repos/${input.repository}/issues`, {
        method: "POST",
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json", "x-github-api-version": "2022-11-28" },
        body: JSON.stringify({ title: input.title, body: input.body }),
      });
      if (!response.ok) throw new Error(`GitHub issue creation failed (${response.status})`);
      const value = await response.json() as { number?: number; html_url?: string };
      if (!value.number || !value.html_url) throw new Error("GitHub did not return an issue reference");
      return { id: String(value.number), url: value.html_url };
    }
    if (!this.jira || !input.jiraProjectKey) throw new Error("Jira routing is not configured for this project");
    const response = await fetch(`${this.jira.baseUrl.replace(/\/$/, "")}/rest/api/3/issue`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${this.jira.email}:${this.jira.apiToken}`).toString("base64")}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ fields: { project: { key: input.jiraProjectKey }, summary: input.title, issuetype: { name: "Task" }, description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: input.body }] }] } } }),
    });
    if (!response.ok) throw new Error(`Jira issue creation failed (${response.status})`);
    const value = await response.json() as { key?: string; self?: string };
    if (!value.key) throw new Error("Jira did not return an issue key");
    return { id: value.key, url: `${this.jira.baseUrl.replace(/\/$/, "")}/browse/${value.key}` };
  }
}

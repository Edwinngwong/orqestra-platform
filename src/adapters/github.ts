import type { PullRequests } from "../domain.js";

export class GitHubPullRequests implements PullRequests {
  constructor(private readonly token: string, private readonly apiBase = "https://api.github.com") {}

  async createDraft(input: { repository: string; branch: string; base: string; title: string; body: string }): Promise<string> {
    const response = await fetch(`${this.apiBase}/repos/${input.repository}/pulls`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ title: input.title, head: input.branch, base: input.base, body: input.body, draft: true }),
    });
    if (!response.ok) throw new Error(`GitHub draft PR failed (${response.status})`);
    const result = await response.json() as { html_url?: string };
    if (!result.html_url) throw new Error("GitHub response did not include a PR URL");
    return result.html_url;
  }
}

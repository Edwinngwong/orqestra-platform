import { createSign } from "node:crypto";
import type { PullRequests } from "../domain.js";

function base64url(value: string | Buffer) { return Buffer.from(value).toString("base64url"); }

export class GitHubAppTokens {
  constructor(private readonly appId: string, private readonly privateKey: string, private readonly apiBase = "https://api.github.com") {}
  private jwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: this.appId }));
    const data = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256").update(data).sign(this.privateKey);
    return `${data}.${base64url(signature)}`;
  }
  async installationToken(installationId: number): Promise<string> {
    const response = await fetch(`${this.apiBase}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${this.jwt()}`, "x-github-api-version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub installation token failed (${response.status})`);
    const result = await response.json() as { token?: string };
    if (!result.token) throw new Error("GitHub did not return an installation token");
    return result.token;
  }
  async repositories(): Promise<Array<{ installationId: number; repository: string; defaultBranch: string }>> {
    const installationsResponse = await fetch(`${this.apiBase}/app/installations`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${this.jwt()}`, "x-github-api-version": "2022-11-28" } });
    if (!installationsResponse.ok) throw new Error(`GitHub installations lookup failed (${installationsResponse.status})`);
    const installations = await installationsResponse.json() as Array<{ id: number }>;
    const result: Array<{ installationId: number; repository: string; defaultBranch: string }> = [];
    for (const installation of installations) {
      const token = await this.installationToken(installation.id);
      const repositoriesResponse = await fetch(`${this.apiBase}/installation/repositories?per_page=100`, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" } });
      if (!repositoriesResponse.ok) throw new Error(`GitHub repositories lookup failed (${repositoriesResponse.status})`);
      const page = await repositoriesResponse.json() as { repositories?: Array<{ full_name: string; default_branch?: string }> };
      for (const repository of page.repositories ?? []) result.push({ installationId: installation.id, repository: repository.full_name, defaultBranch: repository.default_branch ?? "main" });
    }
    return result.sort((a, b) => a.repository.localeCompare(b.repository));
  }
}

export class GitHubPullRequests implements PullRequests {
  constructor(private readonly token: string | ((installationId: number) => Promise<string>), private readonly apiBase = "https://api.github.com") {}
  async createDraft(input: { repository: string; branch: string; base: string; title: string; body: string; installationId?: number }): Promise<string> {
    const token = typeof this.token === "string" ? this.token : input.installationId ? await this.token(input.installationId) : undefined;
    if (!token) throw new Error("GitHub installation ID is required");
    const response = await fetch(`${this.apiBase}/repos/${input.repository}/pulls`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "content-type": "application/json", "x-github-api-version": "2022-11-28" },
      body: JSON.stringify({ title: input.title, head: input.branch, base: input.base, body: input.body, draft: true }),
    });
    if (!response.ok) throw new Error(`GitHub draft PR failed (${response.status})`);
    const result = await response.json() as { html_url?: string };
    if (!result.html_url) throw new Error("GitHub response did not include a PR URL");
    return result.html_url;
  }
}

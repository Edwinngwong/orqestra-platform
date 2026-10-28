import assert from "node:assert/strict";
import test from "node:test";
import { GitHubPullRequests } from "../src/adapters/github.js";

test("creates a draft pull request through the GitHub API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { draft: boolean; head: string };
    assert.equal(body.draft, true);
    assert.equal(body.head, "orqestra/42");
    return new Response(JSON.stringify({ html_url: "https://github.test/org/repo/pull/1" }), { status: 201 });
  };
  try {
    const url = await new GitHubPullRequests("token").createDraft({ repository: "org/repo", branch: "orqestra/42", base: "main", title: "Change", body: "Tests passed" });
    assert.equal(url, "https://github.test/org/repo/pull/1");
  } finally { globalThis.fetch = originalFetch; }
});

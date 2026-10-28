import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { GitHubAppTokens, GitHubPullRequests } from "../src/adapters/github.js";

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

test("exchanges a signed GitHub App JWT for an installation token", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /installations\/123\/access_tokens$/);
    assert.match(String((init?.headers as Record<string, string>).authorization), /^Bearer [^.]+\.[^.]+\.[^.]+$/);
    return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
  };
  try { assert.equal(await new GitHubAppTokens("42", privateKey).installationToken(123), "installation-token"); }
  finally { globalThis.fetch = originalFetch; }
});

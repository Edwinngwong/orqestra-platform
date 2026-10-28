import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIGitHubAgent, parseAgentOutput } from "../src/adapters/openai-github-agent.js";
import type { GitHubAppTokens } from "../src/adapters/github.js";

test("accepts bounded file replacements and rejects traversal", () => {
  assert.deepEqual(parseAgentOutput({ summary: "done", files: [{ path: "src/app.ts", content: "export {};" }] }).files[0]?.path, "src/app.ts");
  assert.throws(() => parseAgentOutput({ summary: "bad", files: [{ path: "../secret", content: "x" }] }));
  assert.throws(() => parseAgentOutput({ summary: "too many", files: Array.from({ length: 21 }, (_, index) => ({ path: `f${index}`, content: "x" })) }));
});

test("turns a schema-constrained model response into a GitHub branch commit", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: "base-commit" } });
    if (url.endsWith("/git/commits/base-commit")) return Response.json({ tree: { sha: "base-tree" } });
    if (url.includes("/git/trees/base-tree?recursive=1")) return Response.json({ tree: [] });
    if (url.endsWith("/responses")) return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ summary: "Added health endpoint", files: [{ path: "src/health.ts", content: "export const health = 'ok';\n" }] }) }] }] });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "new-blob" }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "new-tree" }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "new-commit" }, { status: 201 });
    if (url.endsWith("/git/refs")) return Response.json({ ref: "refs/heads/orqestra/42" }, { status: 201 });
    return new Response("unexpected", { status: 500 });
  };
  const tokens = { async installationToken(id: number) { assert.equal(id, 123); return "installation-token"; } } as unknown as GitHubAppTokens;
  try {
    const result = await new OpenAIGitHubAgent(tokens, "openai-key", "test-model").implement({ id: "42", source: "github", title: "Health", description: "Add endpoint", repository: "org/repo", defaultBranch: "main", githubInstallationId: 123 });
    assert.equal(result.commit, "new-commit");
    assert.match(result.branch, /^orqestra\/42-/);
    assert(calls.some(call => call.startsWith("POST https://api.github.com/repos/org/repo/git/refs")));
  } finally { globalThis.fetch = originalFetch; }
});

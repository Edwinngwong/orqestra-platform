import assert from "node:assert/strict";
import test from "node:test";
import { GitHubOAuthConnections, MemoryGitHubConnectionRegistry } from "../src/github-connections.js";

function mockedGitHub(permission = true) {
  const calls: string[] = [];
  const transport = async (url: string | URL | Request) => {
    const target = String(url); calls.push(target);
    let result: unknown;
    if (target.endsWith("/login/oauth/access_token")) result = { access_token: "temporary-test-token" };
    else if (target.includes("/user/installations/55/repositories")) {
      result = { repositories: [
        { full_name: "acme/portal", default_branch: "main", permissions: { admin: permission } },
        { full_name: "acme/readonly", default_branch: "main", permissions: { admin: false } },
        { full_name: "other/private", default_branch: "main", permissions: { admin: true } },
      ] };
    } else if (target.includes("/user/installations")) result = { installations: [{ id: 55, app_id: 1234, account: { login: "acme" } }] };
    else throw new Error("Unexpected GitHub request: " + target);
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, transport: transport as typeof fetch };
}
const build = (registry: MemoryGitHubConnectionRegistry, transport: typeof fetch) =>
  new GitHubOAuthConnections(registry, { clientId: "client-id", clientSecret: "test-secret", appId: "1234",
    callbackUrl: "https://orqestra.example/v1/github/oauth/callback" }, transport, "https://api.github.test", "https://github.test");

test("OAuth verifies user installation and grants admin repos only", async () => {
  const registry = new MemoryGitHubConnectionRegistry();
  const github = mockedGitHub();
  const service = build(registry, github.transport);
  const url = new URL(await service.begin("workspace-A", "user-A", "session-A", 55));
  assert.equal(url.hostname, "github.test");
  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://orqestra.example/v1/github/oauth/callback");
  const state = url.searchParams.get("state")!;
  const connection = await service.finish("valid-oauth-code", state, "user-A", "session-A", id => id === "workspace-A");
  assert.equal(connection.accountLogin, "acme");
  assert.deepEqual(connection.repositories, [{ repository: "acme/portal", defaultBranch: "main" }]);
  assert.deepEqual(await registry.listConnections("workspace-B"), []);
  assert.equal((await registry.getConnection("workspace-A", 55))?.repositories.length, 1);
  await assert.rejects(service.finish("valid-oauth-code", state, "user-A", "session-A", () => true), /expired or was already used/);
  assert(github.calls.some(call => call.includes("/user/installations/55/repositories")));
});

test("OAuth binds state to user and session and checks current workspace role", async () => {
  const registry = new MemoryGitHubConnectionRegistry();
  const github = mockedGitHub(), service = build(registry, github.transport);
  const url = new URL(await service.begin("workspace-A", "user-A", "session-A", 55));
  const state = url.searchParams.get("state")!;
  await assert.rejects(service.finish("valid-oauth-code", state, "user-B", "session-A", () => true), /expired or was already used/);
  await assert.rejects(service.finish("valid-oauth-code", state, "user-A", "different-session", () => true), /expired or was already used/);
  await assert.rejects(service.finish("valid-oauth-code", state, "user-A", "session-A", () => false), /administrator access/);
  assert.equal(github.calls.length, 0);
  assert.deepEqual(await registry.listConnections("workspace-A"), []);
});

test("OAuth rejects a missing installation and an account without repository admin access", async () => {
  const registry = new MemoryGitHubConnectionRegistry();
  const service = build(registry, mockedGitHub(false).transport);
  const url = new URL(await service.begin("workspace-A", "user-A", "session-A", 55));
  await assert.rejects(service.finish("valid-oauth-code", url.searchParams.get("state")!, "user-A", "session-A", () => true), /No repositories with admin/);
  assert.deepEqual(await registry.listConnections("workspace-A"), []);
  const mismatch = build(new MemoryGitHubConnectionRegistry(), async (url) => {
    const target = String(url);
    if (target.includes("access_token")) return new Response(JSON.stringify({ access_token: "token" }), { status: 200 });
    return new Response(JSON.stringify({ installations: [{ id: 55, app_id: 999, account: { login: "acme" } }] }), { status: 200 });
  });
  const stateUrl = new URL(await mismatch.begin("workspace-A", "user-A", "session-A", 55));
  await assert.rejects(mismatch.finish("valid-oauth-code", stateUrl.searchParams.get("state")!, "user-A", "session-A", () => true), /not accessible/);
});

test("cannot silently transfer an installation to another workspace", async () => {
  const registry = new MemoryGitHubConnectionRegistry();
  const base = { installationId: 55, accountLogin: "acme", repositories: [{ repository: "acme/portal", defaultBranch: "main" }],
    connectedBy: "user-A", connectedAt: new Date().toISOString() };
  await registry.saveConnection({ ...base, workspaceId: "workspace-A" });
  await assert.rejects(registry.saveConnection({ ...base, workspaceId: "workspace-B" }), /already assigned/);
  assert.equal(await registry.removeConnection("workspace-B", 55), false);
  assert.equal((await registry.getConnection("workspace-A", 55))?.accountLogin, "acme");
});

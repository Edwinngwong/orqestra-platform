import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { AuthService, hashPassword, verifyPassword } from "../src/auth.js";
import { Orchestrator } from "../src/orchestrator.js";
import { PostgresProjectRegistry } from "../src/projects.js";

process.env.NODE_ENV = "test";
const { createPlatformServer } = await import("../src/server.js");

test("hashes passwords with a unique salt and verifies them", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
});

test("enforces sessions, CSRF, and workspace roles", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const auth = new AuthService(pool), projects = new PostgresProjectRegistry(pool);
  const suffix = crypto.randomUUID().slice(0, 8), password = "A-strong-test-password-123!";
  const ownerId = await auth.createUser(`owner-${suffix}@example.test`, password, false);
  const viewerId = await auth.createUser(`viewer-${suffix}@example.test`, password, false);
  const workspace = await projects.createWorkspace({ name: `Auth ${suffix}`, slug: `auth-${suffix}` });
  await auth.upsertMembership(workspace.id, ownerId, "owner");
  await auth.upsertMembership(workspace.id, viewerId, "viewer");
  const orchestrator = new Orchestrator({ async implement() { throw new Error("not called"); } }, { async runTests() { throw new Error("not called"); } }, { async createDraft() { throw new Error("not called"); } });
  const server = createPlatformServer(orchestrator, { webhookSecret: "secret", operatorToken: "operator" }, undefined, projects, undefined, auth);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object"); const base = `http://127.0.0.1:${address.port}`;
  const login = async (email: string) => {
    const response = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200);
    const body = await response.json() as { csrfToken: string };
    return { cookie: response.headers.get("set-cookie")!.split(";")[0]!, csrf: body.csrfToken };
  };
  try {
    assert.equal((await fetch(`${base}/v1/workspaces`)).status, 401);
    const owner = await login(`owner-${suffix}@example.test`);
    const restored = await fetch(`${base}/v1/auth/me`, { headers: { cookie: owner.cookie } });
    assert.equal((await restored.json() as { csrfToken: string }).csrfToken, owner.csrf);
    const passwordChange = await fetch(`${base}/v1/auth/change-password`, { method: "POST", headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json" }, body: JSON.stringify({ currentPassword: password, newPassword: "A-different-strong-password-456!" }) });
    assert.equal(passwordChange.status, 200, await passwordChange.text());
    const withoutCsrf = await fetch(`${base}/v1/projects`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: "{}" });
    assert.equal(withoutCsrf.status, 403);
    const ownerList = await fetch(`${base}/v1/workspaces`, { headers: { cookie: owner.cookie } });
    assert.equal(ownerList.status, 200);
    assert.equal((await ownerList.json() as Array<{ id: string }>)[0]?.id, workspace.id);
    const viewer = await login(`viewer-${suffix}@example.test`);
    const denied = await fetch(`${base}/v1/projects`, { method: "POST", headers: { cookie: viewer.cookie, "x-csrf-token": viewer.csrf, "content-type": "application/json" }, body: JSON.stringify({ workspaceId: workspace.id, name: "Denied", repository: "acme/denied", githubInstallationId: 1 }) });
    assert.equal(denied.status, 403);
    const invited = await fetch(`${base}/v1/workspaces/${workspace.id}/members`, { method: "POST", headers: { cookie: owner.cookie, "x-csrf-token": owner.csrf, "content-type": "application/json" }, body: JSON.stringify({ email: `new-${suffix}@example.test`, role: "reviewer" }) });
    assert.equal(invited.status, 201);
    assert.equal(typeof (await invited.json() as { temporaryPassword?: string }).temporaryPassword, "string");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspace.id]);
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`%${suffix}%`]);
    await pool.end();
  }
});

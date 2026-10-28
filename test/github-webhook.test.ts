import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { githubIssueToWorkItem, verifyGitHubSignature } from "../src/github-webhook.js";

test("verifies the exact webhook body", () => {
  const body = Buffer.from('{"action":"opened"}');
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyGitHubSignature(body, signature, "secret"), true);
  assert.equal(verifyGitHubSignature(Buffer.from("changed"), signature, "secret"), false);
});

test("maps newly opened issues and ignores other actions", () => {
  const item = githubIssueToWorkItem({ action: "opened", issue: { number: 42, title: "Add health check", body: "Details" }, repository: { full_name: "acme/api", default_branch: "trunk" } });
  assert.deepEqual(item, { id: "42", source: "github", title: "Add health check", description: "Details", repository: "acme/api", defaultBranch: "trunk" });
  assert.equal(githubIssueToWorkItem({ action: "closed" }), undefined);
});

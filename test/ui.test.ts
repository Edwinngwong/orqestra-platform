import assert from "node:assert/strict";
import test from "node:test";
import { operatorHtml } from "../src/ui/operator.js";
import { landingHtml } from "../src/ui/landing.js";

test("operator dashboard ships syntactically valid Muse, tracker, and WhatsApp controls", () => {
  assert.match(operatorHtml, /id="muse-form"/);
  assert.match(operatorHtml, /value="github_issue"/);
  assert.match(operatorHtml, /value="jira_issue"/);
  assert.match(operatorHtml, /value="orqestra_only"/);
  assert.match(operatorHtml, /id="whatsapp-form"/);
  assert.match(operatorHtml, /id="new-project-form"/);
  assert.match(operatorHtml, /id="github-connect-form"/);
  assert.match(operatorHtml, /id="workspace-filter"/);
  assert.match(operatorHtml, /id="workflow-timeline"/);
  assert.match(operatorHtml, /id="projects-grid"/);
  assert.match(operatorHtml, /id="new-project-intakes"/);
  assert.match(operatorHtml, /Start a new project instead/);
  assert.match(operatorHtml, /Connect an existing project instead/);
  assert.match(operatorHtml, /No infrastructure was provisioned/);
  assert.match(operatorHtml, /Bind my number/);
  assert.match(operatorHtml, /Revoke/);
  const script = operatorHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert(script);
  assert.doesNotThrow(() => new Function(script));
});

test("public website provides two onboarding paths and client portal sign-in", () => {
  assert.match(landingHtml, /Connect an existing project/);
  assert.match(landingHtml, /Start a new project/);
  assert.match(landingHtml, /href="\/app"/);
  assert.match(landingHtml, /human approvals|Human/);
  assert.doesNotMatch(landingHtml, /GITHUB_APP_PRIVATE_KEY|OPERATOR_TOKEN/);
});

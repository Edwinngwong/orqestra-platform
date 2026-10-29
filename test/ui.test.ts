import assert from "node:assert/strict";
import test from "node:test";
import { operatorHtml } from "../src/ui/operator.js";

test("operator dashboard ships syntactically valid Muse and tracker controls", () => {
  assert.match(operatorHtml, /id="muse-form"/);
  assert.match(operatorHtml, /value="github_issue"/);
  assert.match(operatorHtml, /value="jira_issue"/);
  assert.match(operatorHtml, /value="orqestra_only"/);
  const script = operatorHtml.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert(script);
  assert.doesNotThrow(() => new Function(script));
});

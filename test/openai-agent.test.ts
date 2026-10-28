import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentOutput } from "../src/adapters/openai-github-agent.js";

test("accepts bounded file replacements and rejects traversal", () => {
  assert.deepEqual(parseAgentOutput({ summary: "done", files: [{ path: "src/app.ts", content: "export {};" }] }).files[0]?.path, "src/app.ts");
  assert.throws(() => parseAgentOutput({ summary: "bad", files: [{ path: "../secret", content: "x" }] }));
  assert.throws(() => parseAgentOutput({ summary: "too many", files: Array.from({ length: 21 }, (_, index) => ({ path: `f${index}`, content: "x" })) }));
});

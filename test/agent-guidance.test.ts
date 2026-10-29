import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("AGENTS.md declares the current platform version and latest migration", async () => {
  const guide = await readFile("AGENTS.md", "utf8");
  const manifest = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
  const latestMigration = (await readdir("migrations")).filter(name => name.endsWith(".sql")).sort().at(-1);
  assert(latestMigration);
  assert.match(guide, new RegExp(`^- Platform version: ${manifest.version.replace(/\./g, "\\.")}$`, "m"));
  assert.match(guide, new RegExp(`^- Latest migration: ${latestMigration.replace(/\./g, "\\.")}$`, "m"));
  assert.match(guide, /^## Milestone update protocol$/m);
  assert.match(guide, /Do not use, request, reproduce, translate, or derive from any employer-proprietary/);
});

import { createServer } from "node:http";
import { githubIssueToWorkItem, verifyGitHubSignature } from "./github-webhook.js";
import { Orchestrator } from "./orchestrator.js";
import { JsonFileRunStore } from "./store.js";

export function createPlatformServer(orchestrator: Orchestrator, webhookSecret: string) {
  return createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/webhooks/github") { response.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      const signature = request.headers["x-hub-signature-256"];
      const event = request.headers["x-github-event"];
      if (event !== "issues" || !verifyGitHubSignature(body, typeof signature === "string" ? signature : undefined, webhookSecret)) {
        response.writeHead(401).end();
        return;
      }
      try {
        const item = githubIssueToWorkItem(JSON.parse(body.toString("utf8")));
        if (!item) { response.writeHead(202).end(); return; }
        const run = orchestrator.intake(item);
        response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ runId: run.id, status: run.status }));
      } catch {
        response.writeHead(400).end();
      }
    });
  });
}

if (process.env.NODE_ENV !== "test") {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) throw new Error("GITHUB_WEBHOOK_SECRET is required");
  const store = new JsonFileRunStore(process.env.ORQESTRA_DATA_PATH ?? ".data/runs.json");
  const orchestrator = new Orchestrator(
    { async implement(item) { return { branch: `orqestra/${item.id}`, commit: "0000000", summary: "Agent adapter not configured" }; } },
    { async runTests() { return { passed: false, summary: "Sandbox adapter not configured" }; } },
    { async createDraft() { throw new Error("GitHub App adapter not configured"); } },
    store,
  );
  const port = Number(process.env.PORT ?? 8786);
  createPlatformServer(orchestrator, secret).listen(port, () => console.log(`Orqestra platform listening on ${port}`));
}

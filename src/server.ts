import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { githubIssueToWorkItem, verifyGitHubSignature } from "./github-webhook.js";
import { Orchestrator } from "./orchestrator.js";
import { PostgresRunStore } from "./postgres-store.js";
import { MemoryJobQueue, PostgresJobQueue, type JobQueue } from "./queue/jobs.js";
import { JsonFileRunStore, type RunStore } from "./store.js";
import { operatorHtml } from "./ui/operator.js";

function authorized(request: IncomingMessage, token: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ") || !token) return false;
  const expected = createHash("sha256").update(token).digest();
  const received = createHash("sha256").update(value.slice(7)).digest();
  return timingSafeEqual(expected, received);
}

function json(response: ServerResponse, status: number, value?: unknown) {
  response.writeHead(status, value === undefined ? undefined : { "content-type": "application/json" });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function createPlatformServer(orchestrator: Orchestrator, options: { webhookSecret: string; operatorToken: string }, queue: JobQueue = new MemoryJobQueue()) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'", "x-content-type-options": "nosniff" }); response.end(operatorHtml); return; }
      if (request.method === "POST" && request.url === "/webhooks/github") {
        const raw = await body(request);
        const signature = request.headers["x-hub-signature-256"];
        const event = request.headers["x-github-event"];
        const deliveryId = request.headers["x-github-delivery"];
        if (event !== "issues" || typeof deliveryId !== "string" || !verifyGitHubSignature(raw, typeof signature === "string" ? signature : undefined, options.webhookSecret)) return json(response, 401);
        const item = githubIssueToWorkItem(JSON.parse(raw.toString("utf8")));
        if (!item) return json(response, 202);
        const run = await orchestrator.intake(item, deliveryId);
        return run ? json(response, 201, { runId: run.id, status: run.status }) : json(response, 202, { duplicate: true });
      }

      const match = request.url?.match(/^\/v1\/runs\/([0-9a-f-]+)(?:\/(audit|approve-intake|execute|approve-pr|cancel))?$/i);
      if (!match || !authorized(request, options.operatorToken)) return json(response, match ? 401 : 404);
      const runId = match[1]!;
      const action = match[2];
      const actor = request.headers["x-orqestra-actor"];
      const human = typeof actor === "string" && actor.length <= 200 ? actor : "operator";

      if (request.method === "GET" && !action) return json(response, 200, await orchestrator.get(runId));
      if (request.method === "GET" && action === "audit") return json(response, 200, await orchestrator.audit(runId));
      if (request.method === "POST" && action === "approve-intake") {
        const run = await orchestrator.approveIntake(runId, human);
        await queue.enqueue(runId);
        return json(response, 202, run);
      }
      if (request.method === "POST" && action === "execute") return json(response, 200, await orchestrator.execute(runId));
      if (request.method === "POST" && action === "approve-pr") return json(response, 200, await orchestrator.approveDraftPullRequest(runId, human));
      if (request.method === "POST" && action === "cancel") { await queue.cancel(runId); return json(response, 200, await orchestrator.cancel(runId, human)); }
      return json(response, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      json(response, message.startsWith("Unknown run") ? 404 : 409, { error: message });
    }
  });
}

async function servicesFromEnvironment(): Promise<{ store: RunStore; queue: JobQueue }> {
  if (!process.env.DATABASE_URL) return { store: new JsonFileRunStore(process.env.ORQESTRA_DATA_PATH ?? ".data/runs.json"), queue: new MemoryJobQueue() };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  await pool.query("SELECT 1");
  return { store: new PostgresRunStore(pool), queue: new PostgresJobQueue(pool) };
}

if (process.env.NODE_ENV !== "test") {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const operatorToken = process.env.OPERATOR_TOKEN;
  if (!webhookSecret || !operatorToken) throw new Error("GITHUB_WEBHOOK_SECRET and OPERATOR_TOKEN are required");
  const services = await servicesFromEnvironment();
  const orchestrator = new Orchestrator(
    { async implement(item) { return { branch: `orqestra/${item.id}`, commit: "0000000", summary: "Agent adapter not configured" }; } },
    { async runTests() { return { passed: false, summary: "Sandbox adapter not configured" }; } },
    { async createDraft() { throw new Error("GitHub App adapter not configured"); } },
    services.store,
  );
  const port = Number(process.env.PORT ?? 8786);
  createPlatformServer(orchestrator, { webhookSecret, operatorToken }, services.queue).listen(port, () => console.log(`Orqestra platform listening on ${port}`));
}

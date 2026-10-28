import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { GitHubAppTokens, GitHubPullRequests } from "./adapters/github.js";
import { OpenAIGitHubAgent } from "./adapters/openai-github-agent.js";
import { SandboxHttpClient } from "./adapters/sandbox.js";
import { Orchestrator } from "./orchestrator.js";
import { PostgresRunStore } from "./postgres-store.js";
import { PostgresJobQueue } from "./queue/jobs.js";
import { Worker } from "./queue/worker.js";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const pool = new Pool({ connectionString: required("DATABASE_URL"), max: 5 });
const tokens = new GitHubAppTokens(required("GITHUB_APP_ID"), await readFile(required("GITHUB_APP_PRIVATE_KEY_PATH"), "utf8"));
const queue = new PostgresJobQueue(pool);
const orchestrator = new Orchestrator(
  new OpenAIGitHubAgent(tokens, required("OPENAI_API_KEY"), required("OPENAI_MODEL")),
  new SandboxHttpClient(required("SANDBOX_URL"), required("SANDBOX_TOKEN"), required("RESULT_SIGNING_SECRET"), id => tokens.installationToken(id)),
  new GitHubPullRequests(id => tokens.installationToken(id)),
  new PostgresRunStore(pool),
);
const worker = new Worker(process.env.WORKER_ID ?? `worker-${process.pid}`, queue, orchestrator);
for (;;) { if (!await worker.workOnce()) await new Promise(resolve => setTimeout(resolve, 1000)); }

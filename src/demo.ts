import { Orchestrator } from "./orchestrator.js";
import type { CodingAgent, PullRequests, Sandbox } from "./domain.js";

const agent: CodingAgent = { async implement(item) { return { branch: `orqestra/${item.id}`, commit: "abcdef1", summary: "Demo change" }; } };
const sandbox: Sandbox = { async runTests() { return { passed: true, summary: "12 tests passed" }; } };
const prs: PullRequests = { async createDraft({ repository, branch }) { return `https://github.com/${repository}/pull/demo?head=${branch}`; } };

const orchestrator = new Orchestrator(agent, sandbox, prs);
const run = await orchestrator.intake({ id: "ISSUE-42", source: "github", title: "Add health endpoint", description: "Return service status", repository: "acme/service", defaultBranch: "main" });
if (!run) throw new Error("Duplicate demo intake");
await orchestrator.approveIntake(run.id);
await orchestrator.execute(run.id);
console.log(await orchestrator.approveDraftPullRequest(run.id));

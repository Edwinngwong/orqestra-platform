import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { GitHubAppTokens, GitHubPullRequests } from "./adapters/github.js";
import { OpenAIGitHubAgent } from "./adapters/openai-github-agent.js";
import { SandboxHttpClient } from "./adapters/sandbox.js";
import { githubIssueToWorkItem, verifyGitHubSignature } from "./github-webhook.js";
import { Orchestrator } from "./orchestrator.js";
import { PostgresRunStore } from "./postgres-store.js";
import { MemoryJobQueue, PostgresJobQueue, type JobQueue } from "./queue/jobs.js";
import { JsonFileRunStore, type RunStore } from "./store.js";
import { operatorHtml } from "./ui/operator.js";
import { landingHtml } from "./ui/landing.js";
import { GitHubOAuthConnections, MemoryGitHubConnectionRegistry, PostgresGitHubConnectionRegistry, type GitHubConnectionRegistry } from "./github-connections.js";
import { MemoryProjectRegistry, PostgresProjectRegistry, type ProjectRegistry } from "./projects.js";
import type { ProjectPolicy } from "./domain.js";
import { AuthService, type Principal, type WorkspaceRole } from "./auth.js";
import { MemoryMuseStore, MuseService, PostgresMuseStore, type MuseStore } from "./muse.js";
import { RoutedWorkTracker } from "./adapters/trackers.js";
import type { IntakeChannel, TrackerKind } from "./domain.js";
import { OpenAIMuseInterpreter } from "./adapters/openai-muse.js";
import { WhatsAppCloudClient } from "./adapters/whatsapp.js";
import { MemoryWhatsAppStore, PostgresWhatsAppStore, WhatsAppMuseService, type WhatsAppStore, verifyMetaChallenge, verifyMetaSignature } from "./whatsapp.js";

function authorized(request: IncomingMessage, token: string): boolean {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ") || !token) return false;
  const expected = createHash("sha256").update(token).digest();
  const received = createHash("sha256").update(value.slice(7)).digest();
  return timingSafeEqual(expected, received);
}

function json(response: ServerResponse, status: number, value?: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, value === undefined ? headers : { "content-type": "application/json", ...headers });
  response.end(value === undefined ? undefined : JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const defaultPolicy: ProjectPolicy = { testCommand: ["npm", "test"], timeoutSeconds: 900, maxChangedFiles: 20, maxChangedBytes: 1_000_000, protectedPaths: [".github/workflows", ".env", "infra"] };
function validRepository(value: string) { return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value); }

const systemPrincipal: Principal = { userId: "system", email: "local-operator", mustChangePassword: false, system: true, roles: new Map() };

export function createPlatformServer(orchestrator: Orchestrator, options: { webhookSecret: string; operatorToken: string; whatsappAppSecret?: string; whatsappVerifyToken?: string; whatsappPhoneNumberId?: string; publicBaseUrl?: string }, queue: JobQueue = new MemoryJobQueue(), projects?: ProjectRegistry, github?: GitHubAppTokens, auth?: AuthService, muse?: MuseService, whatsapp?: WhatsAppMuseService, githubConnections?: GitHubConnectionRegistry, githubOAuth?: GitHubOAuthConnections) {
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET") {
        const url = new URL(request.url ?? "/", "http://local");
        if (url.pathname === "/" || url.pathname === "/app" || url.pathname === "/operator") {
          const clientDashboard = url.pathname !== "/" || url.searchParams.has("muse");
          response.writeHead(200, { "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
            "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "cache-control": "no-store" });
          response.end(clientDashboard ? operatorHtml : landingHtml); return;
        }
      }
      if (request.url?.startsWith("/webhooks/whatsapp") && request.method === "GET") {
        if (!whatsapp || !options.whatsappVerifyToken) return json(response, 404);
        const challenge = verifyMetaChallenge(new URL(request.url, "http://local").searchParams, options.whatsappVerifyToken);
        if (!challenge) return json(response, 403);
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }); response.end(challenge); return;
      }
      if (request.url === "/webhooks/whatsapp" && request.method === "POST") {
        if (!whatsapp || !options.whatsappAppSecret || !options.publicBaseUrl) return json(response, 503);
        const raw = await body(request);
        const signature = request.headers["x-hub-signature-256"];
        if (!verifyMetaSignature(raw, typeof signature === "string" ? signature : undefined, options.whatsappAppSecret)) return json(response, 401);
        const accepted = (await whatsapp.receive(JSON.parse(raw.toString("utf8")), options.publicBaseUrl)).filter(Boolean).length;
        return json(response, 200, { accepted });
      }
      if (request.method === "POST" && request.url === "/webhooks/github") {
        const raw = await body(request);
        const signature = request.headers["x-hub-signature-256"];
        const event = request.headers["x-github-event"];
        const deliveryId = request.headers["x-github-delivery"];
        if (typeof deliveryId !== "string" || !verifyGitHubSignature(raw, typeof signature === "string" ? signature : undefined, options.webhookSecret)) return json(response, 401);
        if (event === "pull_request") {
          const payload = JSON.parse(raw.toString("utf8")) as { action?: string; pull_request?: { merged?: boolean; html_url?: string; head?: { ref?: string } }; repository?: { full_name?: string } };
          if (payload.action !== "closed" || !payload.pull_request?.merged) return json(response, 202);
          const repository = payload.repository?.full_name, branch = payload.pull_request.head?.ref, url = payload.pull_request.html_url;
          if (!repository || !branch || !url) return json(response, 400, { error: "Incomplete pull request payload" });
          const completed = await orchestrator.completeMergedPullRequest(repository, branch, url);
          return json(response, 200, { completed: Boolean(completed), ...(completed ? { runId: completed.id } : {}) });
        }
        if (event !== "issues") return json(response, 202);
        const payload = JSON.parse(raw.toString("utf8")) as { issue?: { body?: string } };
        if (payload.issue?.body?.includes("<!-- orqestra-muse:")) return json(response, 202, { museManaged: true });
        const item = githubIssueToWorkItem(payload);
        if (!item) return json(response, 202);
        if (projects) {
          const project = await projects.findByRepository(item.repository);
          if (!project) return json(response, 409, { error: "Repository is not configured as an Orqestra project" });
          if (item.githubInstallationId && item.githubInstallationId !== project.githubInstallationId) return json(response, 403, { error: "GitHub installation does not match registered project" });
          item.workspaceId = project.workspaceId;
          item.projectId = project.id;
          item.defaultBranch = project.defaultBranch;
          item.githubInstallationId = project.githubInstallationId;
          item.testCommand = project.policy.testCommand;
          item.timeoutSeconds = project.policy.timeoutSeconds;
          item.maxChangedFiles = project.policy.maxChangedFiles;
          item.maxChangedBytes = project.policy.maxChangedBytes;
          item.protectedPaths = project.policy.protectedPaths;
        }
        const run = await orchestrator.intake(item, deliveryId);
        return run ? json(response, 201, { runId: run.id, status: run.status }) : json(response, 202, { duplicate: true });
      }

      if (request.url === "/v1/auth/login" && request.method === "POST") {
        if (!auth) return json(response, 501, { error: "Session authentication requires PostgreSQL" });
        const input = JSON.parse((await body(request)).toString("utf8")) as { email?: string; password?: string };
        if (!input.email || !input.password) return json(response, 400, { error: "Email and password are required" });
        const result = await auth.login(input.email, input.password);
        const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
        return json(response, 200, { csrfToken: result.csrfToken, user: result.user }, { "set-cookie": result.cookie + secure });
      }

      const principal = auth ? await auth.authenticate(request, options.operatorToken) : (authorized(request, options.operatorToken) ? systemPrincipal : undefined);
      if (request.url?.startsWith("/v1/") && !principal) return json(response, 401, { error: "Authentication required" });
      if (!principal) return json(response, 404);
      if (principal.mustChangePassword && request.url !== "/v1/auth/change-password" && request.url !== "/v1/auth/me" && request.url !== "/v1/auth/logout") return json(response, 403, { error: "Password change required" });
      const stateChanging = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method ?? "");
      if (stateChanging && auth && !auth.validateCsrf(request, principal)) return json(response, 403, { error: "Invalid CSRF token" });
      const can = (workspaceId: string | undefined, role: WorkspaceRole) => principal.system || (!!auth && auth.can(principal, workspaceId, role));
      if (request.url === "/v1/auth/me" && request.method === "GET") return json(response, 200, { id: principal.userId, email: principal.email, mustChangePassword: principal.mustChangePassword, system: principal.system, csrfToken: principal.csrfToken, roles: [...principal.roles].map(([workspaceId, role]) => ({ workspaceId, role })) });
      if (request.url === "/v1/auth/logout" && request.method === "POST") { if (auth) await auth.logout(principal); return json(response, 204, undefined, { "set-cookie": "orqestra_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" }); }
      if (request.url === "/v1/auth/change-password" && request.method === "POST") {
        if (!auth || principal.system) return json(response, 400, { error: "Password change is unavailable for the bootstrap operator" });
        const input = JSON.parse((await body(request)).toString("utf8")) as { currentPassword?: string; newPassword?: string };
        if (!input.currentPassword || !input.newPassword) return json(response, 400, { error: "Current and new passwords are required" });
        await auth.changePassword(principal, input.currentPassword, input.newPassword);
        return json(response, 200, { changed: true });
      }

      if (request.url?.startsWith("/v1/github/oauth/callback") && request.method === "GET") {
        if (!githubOAuth || !auth || !principal || principal.system || !principal.sessionHash) return json(response, 403, { error: "A signed-in user is required to connect GitHub" });
        const callback = new URL(request.url, "http://local");
        const code = callback.searchParams.get("code"), state = callback.searchParams.get("state");
        if (!code || !state) return json(response, 400, { error: "GitHub callback is missing a code or state" });
        await githubOAuth.finish(code, state, principal.userId, principal.sessionHash,
          workspaceId => auth.can(principal, workspaceId, "admin"));
        response.writeHead(303, { location: "/app?github=connected", "cache-control": "no-store", "referrer-policy": "no-referrer" });
        response.end(); return;
      }
      if (request.url?.startsWith("/v1/github/connections")) {
        if (!githubConnections) return json(response, 501, { error: "GitHub connection registry is unavailable" });
        const url = new URL(request.url, "http://local");
        if (request.method === "GET" && url.pathname === "/v1/github/connections") {
          const workspaceId = url.searchParams.get("workspaceId");
          if (!workspaceId || !can(workspaceId, "admin")) return json(response, 403, { error: "Workspace administrator role required" });
          return json(response, 200, await githubConnections.listConnections(workspaceId));
        }
        if (request.method === "POST" && url.pathname === "/v1/github/connections/start") {
          if (!githubOAuth || !auth || principal.system || !principal.sessionHash) return json(response, 501, { error: "GitHub OAuth for a signed-in user is not configured" });
          const input = JSON.parse((await body(request)).toString("utf8")) as { workspaceId?: string; installationId?: number };
          if (!input.workspaceId || !can(input.workspaceId, "admin")) return json(response, 403, { error: "Workspace administrator role required" });
          if (!Number.isSafeInteger(input.installationId) || Number(input.installationId) <= 0) return json(response, 400, { error: "Valid installation ID is required" });
          const url = await githubOAuth.begin(input.workspaceId, principal.userId, principal.sessionHash, input.installationId!);
          return json(response, 200, { authorizeUrl: url });
        }
        if (request.method === "DELETE") {
          const matchConnection = url.pathname.match(/^\/v1\/github\/connections\/(\d+)$/);
          const workspaceId = url.searchParams.get("workspaceId"), installationId = Number(matchConnection?.[1]);
          if (!workspaceId || !can(workspaceId, "admin")) return json(response, 403, { error: "Workspace administrator role required" });
          if (!matchConnection || !Number.isSafeInteger(installationId)) return json(response, 400, { error: "Invalid installation ID" });
          if (projects && (await projects.listProjects(workspaceId)).some(project => project.githubInstallationId === installationId)) {
            return json(response, 409, { error: "Remove or migrate existing projects before disconnecting GitHub" });
          }
          const removed = await githubConnections.removeConnection(workspaceId, installationId);
          return removed ? json(response, 204) : json(response, 404, { error: "GitHub connection not found" });
        }
      }
      if (request.url === "/v1/runs" && request.method === "GET") {
        const runs = await orchestrator.list();
        return json(response, 200, principal.system ? runs : runs.filter(run => can(run.workItem.workspaceId, "viewer")));
      }
      if (request.url?.startsWith("/v1/github/repositories") && request.method === "GET") {
        if (!github) return json(response, 501, { error: "GitHub App discovery is unavailable" });
        const url = new URL(request.url, "http://local");
        if (url.pathname !== "/v1/github/repositories") return json(response, 404);
        if (!githubConnections) {
          if (!principal.system) return json(response, 503, { error: "Workspace-scoped GitHub connections are required" });
          return json(response, 200, await github.repositories());
        }
        const workspaceId = url.searchParams.get("workspaceId");
        if (!workspaceId || !can(workspaceId, "admin")) return json(response, 403, { error: "Workspace administrator role required" });
        const connections = await githubConnections.listConnections(workspaceId);
        const all: Array<{ installationId: number; repository: string; defaultBranch: string }> = [];
        for (const connection of connections) {
          const installed = await github.repositoriesForInstallation(connection.installationId);
          const granted = new Set(connection.repositories.map(repo => repo.repository.toLowerCase()));
          all.push(...installed.filter(repo => granted.has(repo.repository.toLowerCase())));
        }
        return json(response, 200, all.sort((a,b) => a.repository.localeCompare(b.repository)));
      }
      if (request.url?.startsWith("/v1/muse/work-items") && muse) {
        if (!projects) return json(response, 501, { error: "Muse requires the project registry" });
        if (request.method === "GET" && request.url.startsWith("/v1/muse/work-items")) {
          const workspaceId = new URL(request.url, "http://local").searchParams.get("workspaceId") ?? undefined;
          const values = await muse.list(workspaceId);
          return json(response, 200, principal.system ? values : values.filter(value => can(value.workspaceId, "viewer")));
        }
        if (request.method === "POST" && request.url === "/v1/muse/work-items") {
          const input = JSON.parse((await body(request)).toString("utf8")) as { workspaceId?: string; projectId?: string; channel?: IntakeChannel; sourceReference?: string; title?: string; objective?: string; acceptanceCriteria?: string[]; constraints?: string[] };
          const channels: IntakeChannel[] = ["web", "whatsapp", "slack", "teams", "email", "github", "jira"];
          if (!input.workspaceId || !input.projectId || !input.channel || !channels.includes(input.channel) || !input.sourceReference?.trim() || input.sourceReference.length > 500 || !input.title?.trim() || input.title.length > 200 || !input.objective?.trim() || input.objective.length > 10_000 || !Array.isArray(input.acceptanceCriteria) || input.acceptanceCriteria.length < 1 || input.acceptanceCriteria.length > 20 || !input.acceptanceCriteria.every(value => typeof value === "string" && !!value.trim() && value.length <= 1_000) || !Array.isArray(input.constraints) || input.constraints.length > 20 || !input.constraints.every(value => typeof value === "string" && !!value.trim() && value.length <= 1_000)) return json(response, 400, { error: "Workspace, project, channel, bounded source reference, title, objective, and acceptance criteria are required" });
          if (!can(input.workspaceId, "viewer")) return json(response, 403, { error: "Workspace access denied" });
          const project = (await projects.listProjects(input.workspaceId)).find(value => value.id === input.projectId);
          if (!project) return json(response, 404, { error: "Project not found in workspace" });
          return json(response, 201, await muse.propose({ workspaceId: input.workspaceId, projectId: input.projectId, channel: input.channel, sourceReference: input.sourceReference.trim(), requesterId: principal.userId, title: input.title.trim(), objective: input.objective.trim(), acceptanceCriteria: input.acceptanceCriteria.map(value => value.trim()), constraints: input.constraints.map(value => value.trim()) }, project));
        }
        const confirmation = request.url.match(/^\/v1\/muse\/work-items\/([0-9a-f-]+)\/confirm$/i);
        if (request.method === "POST" && confirmation) {
          const item = (await muse.list()).find(value => value.id === confirmation[1]);
          if (!item) return json(response, 404, { error: "Muse work item not found" });
          if (!can(item.workspaceId, "reviewer")) return json(response, 403, { error: "Reviewer role required" });
          const project = (await projects.listProjects(item.workspaceId)).find(value => value.id === item.projectId);
          if (!project) return json(response, 404, { error: "Project not found" });
          return json(response, 200, await muse.confirm(item.id, principal.email, project));
        }
      }
      if (request.url === "/v1/whatsapp/status" && request.method === "GET") return json(response, 200, { configured: Boolean(whatsapp) });
      if (request.url?.startsWith("/v1/whatsapp/bindings") && whatsapp) {
        if (!projects || !options.whatsappPhoneNumberId) return json(response, 501, { error: "WhatsApp binding is not configured" });
        if (principal.system) return json(response, 400, { error: "Sign in as a workspace user to bind a WhatsApp number" });
        if (request.method === "GET") {
          const values = await whatsapp.listBindings();
          return json(response, 200, values.filter(value => can(value.workspaceId, "admin")).map(value => ({ ...value, senderWaId: `••••${value.senderWaId.slice(-4)}` })));
        }
        if (request.method === "POST" && request.url === "/v1/whatsapp/bindings") {
          const input = JSON.parse((await body(request)).toString("utf8")) as { workspaceId?: string; projectId?: string; senderPhone?: string };
          const senderWaId = (input.senderPhone ?? "").replace(/\D/g, "");
          if (!input.workspaceId || !input.projectId || !/^\d{7,20}$/.test(senderWaId)) return json(response, 400, { error: "Workspace, project, and E.164 phone number are required" });
          if (!can(input.workspaceId, "admin")) return json(response, 403, { error: "Administrator role required" });
          const project = (await projects.listProjects(input.workspaceId)).find(value => value.id === input.projectId);
          if (!project) return json(response, 404, { error: "Project not found in workspace" });
          const value = await whatsapp.createBinding({ workspaceId: input.workspaceId, projectId: project.id, requesterId: principal.userId, senderWaId, businessPhoneNumberId: options.whatsappPhoneNumberId });
          return json(response, 201, { ...value, senderWaId: `••••${value.senderWaId.slice(-4)}` });
        }
        const revoke = request.url.match(/^\/v1\/whatsapp\/bindings\/([0-9a-f-]+)$/i);
        if (request.method === "DELETE" && revoke) {
          const binding = (await whatsapp.listBindings()).find(value => value.id === revoke[1]);
          if (!binding) return json(response, 404, { error: "WhatsApp binding not found" });
          if (!can(binding.workspaceId, "admin")) return json(response, 403, { error: "Administrator role required" });
          await whatsapp.deactivateBinding(binding.id); return json(response, 204);
        }
      }
      if (request.url === "/v1/workspaces") {
        if (!projects) return json(response, 501, { error: "Workspace registry requires PostgreSQL" });
        if (request.method === "GET") { const values = await projects.listWorkspaces(); return json(response, 200, principal.system ? values : values.filter(value => principal.roles.has(value.id))); }
        if (request.method === "POST") {
          const input = JSON.parse((await body(request)).toString("utf8")) as { name?: string; slug?: string };
          if (!input.name?.trim() || !input.slug || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(input.slug)) return json(response, 400, { error: "Valid workspace name and slug are required" });
          const workspace = await projects.createWorkspace({ name: input.name.trim(), slug: input.slug });
          if (auth && !principal.system) await auth.upsertMembership(workspace.id, principal.userId, "owner");
          return json(response, 201, workspace);
        }
      }
      const membersMatch = request.url?.match(/^\/v1\/workspaces\/([0-9a-f-]+)\/members$/i);
      if (membersMatch) {
        const workspaceId = membersMatch[1]!;
        if (!auth || !can(workspaceId, "admin")) return json(response, 403, { error: "Administrator role required" });
        if (request.method === "GET") return json(response, 200, await auth.listMembers(workspaceId));
        if (request.method === "POST") {
          const input = JSON.parse((await body(request)).toString("utf8")) as { email?: string; role?: WorkspaceRole };
          if (!input.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email) || !input.role || !["owner", "admin", "reviewer", "viewer"].includes(input.role)) return json(response, 400, { error: "Valid email and role are required" });
          if (input.role === "owner" && !can(workspaceId, "owner")) return json(response, 403, { error: "Only an owner can grant owner access" });
          return json(response, 201, await auth.invite(workspaceId, input.email, input.role));
        }
      }
      if (request.url?.startsWith("/v1/new-project-intakes")) {
        if (!projects) return json(response, 501, { error: "Workspace registry requires PostgreSQL" });
        if (request.method === "GET") {
          const url = new URL(request.url, "http://local");
          if (url.pathname !== "/v1/new-project-intakes") return json(response, 404);
          const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
          if (workspaceId && !can(workspaceId, "viewer")) return json(response, 403, { error: "Workspace access denied" });
          const values = await projects.listNewProjectIntakes(workspaceId);
          return json(response, 200, principal.system ? values : values.filter(value => can(value.workspaceId, "viewer")));
        }
        if (request.method === "POST" && request.url === "/v1/new-project-intakes") {
          const input = JSON.parse((await body(request)).toString("utf8")) as {
            workspaceId?: string; name?: string; goal?: string; ownershipMode?: string; monthlyBudgetUsd?: number;
          };
          if (!input.workspaceId || typeof input.name !== "string" || typeof input.goal !== "string" ||
            !["customer_owned", "orqestra_managed"].includes(input.ownershipMode ?? "") ||
            input.name.trim().length < 1 || input.name.trim().length > 120 ||
            input.goal.trim().length < 20 || input.goal.trim().length > 4000 ||
            (input.monthlyBudgetUsd !== undefined && (!Number.isSafeInteger(input.monthlyBudgetUsd) || input.monthlyBudgetUsd < 1 || input.monthlyBudgetUsd > 100_000))) {
            return json(response, 400, { error: "Valid workspace, name (1-120), goal (20-4000), ownership, and optional monthly budget are required" });
          }
          if (!can(input.workspaceId, "admin")) return json(response, 403, { error: "Administrator role required" });
          const workspace = (await projects.listWorkspaces()).find(value => value.id === input.workspaceId);
          if (!workspace) return json(response, 404, { error: "Workspace not found" });
          return json(response, 201, await projects.createNewProjectIntake({
            workspaceId: input.workspaceId, name: input.name.trim(), goal: input.goal.trim(),
            ownershipMode: input.ownershipMode as "customer_owned" | "orqestra_managed",
            ...(input.monthlyBudgetUsd === undefined ? {} : { monthlyBudgetUsd: input.monthlyBudgetUsd }),
            requestedBy: principal.email,
          }));
        }
        const activate = request.url?.match(/^\/v1\/new-project-intakes\/([0-9a-f-]+)\/activate$/i);
        if (request.method === "POST" && activate) {
          const input = JSON.parse((await body(request)).toString("utf8")) as {
            workspaceId?: string; repository?: string; githubInstallationId?: number;
            defaultBranch?: string; tracker?: TrackerKind; jiraProjectKey?: string; policy?: Partial<ProjectPolicy>;
          };
          if (!input.workspaceId || !input.repository || !validRepository(input.repository) ||
            !Number.isSafeInteger(input.githubInstallationId) || Number(input.githubInstallationId) <= 0) {
            return json(response, 400, { error: "Valid workspace, installed repository and installation ID are required" });
          }
          if (!can(input.workspaceId, "admin")) return json(response, 403, { error: "Administrator role required" });
          const intake = (await projects.listNewProjectIntakes(input.workspaceId)).find(value => value.id === activate[1]);
          if (!intake || intake.status !== "pending_review") return json(response, 409, { error: "New-project request is missing or already activated" });
          const tracker = input.tracker ?? "github_issue";
          if (!["github_issue", "jira_issue", "orqestra_only"].includes(tracker) ||
            (tracker === "jira_issue" && !input.jiraProjectKey?.trim())) return json(response, 400, { error: "Invalid tracker configuration" });
          if (githubConnections) {
            const grant = await githubConnections.getConnection(input.workspaceId, Number(input.githubInstallationId));
            if (!grant || !grant.repositories.some(value => value.repository.toLowerCase() === input.repository!.toLowerCase())) {
              return json(response, 403, { error: "Repository is not authorized for this workspace" });
            }
            if (!github) return json(response, 503, { error: "GitHub App is unavailable" });
            const current = await github.repositoriesForInstallation(Number(input.githubInstallationId));
            if (!current.some(value => value.repository.toLowerCase() === input.repository!.toLowerCase())) {
              return json(response, 403, { error: "The GitHub App no longer has repository access" });
            }
          }
          const policy = { ...defaultPolicy, ...input.policy };
          if (!Array.isArray(policy.testCommand) || policy.testCommand.length < 1 ||
            policy.timeoutSeconds < 1 || policy.timeoutSeconds > 1800 ||
            policy.maxChangedFiles < 1 || policy.maxChangedFiles > 100 ||
            policy.maxChangedBytes < 1 || policy.maxChangedBytes > 5_000_000 ||
            !Array.isArray(policy.protectedPaths)) return json(response, 400, { error: "Invalid project policy" });
          const activated = await projects.activateNewProjectIntake(activate[1]!, {
            workspaceId: input.workspaceId, name: intake.name, repository: input.repository,
            githubInstallationId: Number(input.githubInstallationId),
            defaultBranch: input.defaultBranch?.trim() || "main", policy, tracker,
            ...(input.jiraProjectKey?.trim() ? { jiraProjectKey: input.jiraProjectKey.trim() } : {}),
          });
          return json(response, 201, activated);
        }
      }
      if (request.url?.startsWith("/v1/projects")) {
        if (!projects) return json(response, 501, { error: "Project registry requires PostgreSQL" });
        if (request.method === "GET") {
          const workspaceId = new URL(request.url, "http://local").searchParams.get("workspaceId") ?? undefined;
          const values = await projects.listProjects(workspaceId);
          return json(response, 200, principal.system ? values : values.filter(value => can(value.workspaceId, "viewer")));
        }
        if (request.method === "POST" && request.url === "/v1/projects") {
          const input = JSON.parse((await body(request)).toString("utf8")) as { workspaceId?: string; name?: string; repository?: string; defaultBranch?: string; githubInstallationId?: number; policy?: Partial<ProjectPolicy>; tracker?: TrackerKind; jiraProjectKey?: string };
          if (!input.workspaceId || !input.name?.trim() || !input.repository || !validRepository(input.repository) || !Number.isSafeInteger(input.githubInstallationId) || Number(input.githubInstallationId) <= 0) return json(response, 400, { error: "Workspace, name, owner/repository, and GitHub installation ID are required" });
          if (!can(input.workspaceId, "admin")) return json(response, 403, { error: "Administrator role required" });
          const tracker = input.tracker ?? "github_issue";
          if (!["github_issue", "jira_issue", "orqestra_only"].includes(tracker) || (tracker === "jira_issue" && !input.jiraProjectKey?.trim())) return json(response, 400, { error: "Valid tracker configuration is required" });
          if (githubConnections) {
            const grant = await githubConnections.getConnection(input.workspaceId, Number(input.githubInstallationId));
            if (!grant || !grant.repositories.some(repo => repo.repository.toLowerCase() === input.repository!.toLowerCase())) {
              return json(response, 403, { error: "Repository is not authorized for this workspace" });
            }
            if (!github) return json(response, 503, { error: "GitHub App is unavailable" });
            const installed = await github.repositoriesForInstallation(Number(input.githubInstallationId));
            if (!installed.some(repo => repo.repository.toLowerCase() === input.repository!.toLowerCase())) {
              return json(response, 403, { error: "The GitHub App no longer has repository access" });
            }
          }
          const policy = { ...defaultPolicy, ...input.policy };
          if (!Array.isArray(policy.testCommand) || policy.testCommand.length < 1 || policy.timeoutSeconds < 1 || policy.timeoutSeconds > 1800 || policy.maxChangedFiles < 1 || policy.maxChangedFiles > 100 || policy.maxChangedBytes < 1 || policy.maxChangedBytes > 5_000_000 || !Array.isArray(policy.protectedPaths)) return json(response, 400, { error: "Invalid project policy" });
          return json(response, 201, await projects.createProject({ workspaceId: input.workspaceId, name: input.name.trim(), repository: input.repository, defaultBranch: input.defaultBranch?.trim() || "main", githubInstallationId: Number(input.githubInstallationId), policy, tracker, ...(input.jiraProjectKey?.trim() ? { jiraProjectKey: input.jiraProjectKey.trim() } : {}) }));
        }
      }

      const match = request.url?.match(/^\/v1\/runs\/([0-9a-f-]+)(?:\/(audit|approve-intake|execute|approve-pr|retry|cancel))?$/i);
      if (!match) return json(response, 404);
      const runId = match[1]!;
      const action = match[2];
      const targetRun = await orchestrator.get(runId);
      if (!can(targetRun.workItem.workspaceId, "viewer")) return json(response, 403, { error: "Workspace access denied" });
      const human = principal.email;

      if (request.method === "GET" && !action) return json(response, 200, targetRun);
      if (request.method === "GET" && action === "audit") return json(response, 200, await orchestrator.audit(runId));
      if (request.method === "POST" && !can(targetRun.workItem.workspaceId, "reviewer")) return json(response, 403, { error: "Reviewer role required" });
      if (request.method === "POST" && action === "approve-intake") {
        const run = await orchestrator.approveIntake(runId, human);
        await queue.enqueue(runId);
        return json(response, 202, run);
      }
      if (request.method === "POST" && action === "execute") return json(response, 200, await orchestrator.execute(runId));
      if (request.method === "POST" && action === "approve-pr") return json(response, 200, await orchestrator.approveDraftPullRequest(runId, human));
      if (request.method === "POST" && action === "retry") { const run = await orchestrator.retry(runId, human); await queue.enqueue(runId); return json(response, 202, run); }
      if (request.method === "POST" && action === "cancel") { await queue.cancel(runId); return json(response, 200, await orchestrator.cancel(runId, human)); }
      return json(response, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      json(response, message.startsWith("Unknown run") ? 404 : 409, { error: message });
    }
  });
}

async function servicesFromEnvironment(): Promise<{ store: RunStore; queue: JobQueue; projects: ProjectRegistry; museStore: MuseStore; whatsappStore: WhatsAppStore; githubConnections: GitHubConnectionRegistry; auth?: AuthService }> {
  if (!process.env.DATABASE_URL) return { store: new JsonFileRunStore(process.env.ORQESTRA_DATA_PATH ?? ".data/runs.json"), queue: new MemoryJobQueue(), projects: new MemoryProjectRegistry(), museStore: new MemoryMuseStore(), whatsappStore: new MemoryWhatsAppStore(), githubConnections: new MemoryGitHubConnectionRegistry() };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  await pool.query("SELECT 1");
  return { store: new PostgresRunStore(pool), queue: new PostgresJobQueue(pool), projects: new PostgresProjectRegistry(pool), museStore: new PostgresMuseStore(pool), whatsappStore: new PostgresWhatsAppStore(pool), githubConnections: new PostgresGitHubConnectionRegistry(pool), auth: new AuthService(pool) };
}

if (process.env.NODE_ENV !== "test") {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const operatorToken = process.env.OPERATOR_TOKEN;
  const appId = process.env.GITHUB_APP_ID, keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH, openaiKey = process.env.OPENAI_API_KEY, model = process.env.OPENAI_MODEL;
  const sandboxUrl = process.env.SANDBOX_URL, sandboxToken = process.env.SANDBOX_TOKEN, signingSecret = process.env.RESULT_SIGNING_SECRET;
  if (!webhookSecret || !operatorToken || !appId || !keyPath || !openaiKey || !model || !sandboxUrl || !sandboxToken || !signingSecret) throw new Error("Platform integration environment is incomplete; see .env.example");
  const services = await servicesFromEnvironment();
  const tokens = new GitHubAppTokens(appId, await readFile(keyPath, "utf8"));
  let whatsapp: WhatsAppMuseService | undefined;
  const orchestrator = new Orchestrator(
    new OpenAIGitHubAgent(tokens, openaiKey, model),
    new SandboxHttpClient(sandboxUrl, sandboxToken, signingSecret, id => tokens.installationToken(id)),
    new GitHubPullRequests(id => tokens.installationToken(id)),
    services.store,
    { async notify(run, event) { await whatsapp?.notifyRun(run, event); } },
  );
  const jira = process.env.JIRA_BASE_URL && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN ? { baseUrl: process.env.JIRA_BASE_URL, email: process.env.JIRA_EMAIL, apiToken: process.env.JIRA_API_TOKEN } : undefined;
  const muse = new MuseService(services.museStore, new RoutedWorkTracker(id => tokens.installationToken(id), jira), orchestrator);
  const publicBaseUrl = process.env.WHATSAPP_PUBLIC_BASE_URL || process.env.ORQESTRA_PUBLIC_URL;
  const whatsappReady = process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && publicBaseUrl;
  const triggers = (process.env.WHATSAPP_MUSE_TRIGGERS ?? "@muse,/muse,muse:").split(",").map(value => value.trim()).filter(Boolean);
  whatsapp = whatsappReady ? new WhatsAppMuseService(services.whatsappStore, services.projects, muse, new OpenAIMuseInterpreter(openaiKey, model), new WhatsAppCloudClient(process.env.WHATSAPP_PHONE_NUMBER_ID!, process.env.WHATSAPP_ACCESS_TOKEN!, process.env.WHATSAPP_GRAPH_VERSION ?? "v25.0"), triggers) : undefined;
  if (whatsapp) { await whatsapp.recover(); setInterval(() => Promise.all([whatsapp!.processNext(), whatsapp!.processNextNotification()]).catch(error => console.error("WhatsApp worker failed", error)), 2_000).unref(); }
  const origin = process.env.ORQESTRA_PUBLIC_URL;
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID, clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const githubOAuth = clientId && clientSecret && origin ?
    new GitHubOAuthConnections(services.githubConnections, { clientId, clientSecret, appId,
      callbackUrl: `${origin.replace(/\/$/, "")}/v1/github/oauth/callback` }) : undefined;
  const port = Number(process.env.PORT ?? 8786);
  createPlatformServer(orchestrator, { webhookSecret, operatorToken, ...(process.env.WHATSAPP_APP_SECRET ? { whatsappAppSecret: process.env.WHATSAPP_APP_SECRET } : {}), ...(process.env.WHATSAPP_VERIFY_TOKEN ? { whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN } : {}), ...(process.env.WHATSAPP_PHONE_NUMBER_ID ? { whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID } : {}), ...(publicBaseUrl ? { publicBaseUrl } : {}) }, services.queue, services.projects, tokens, services.auth, muse, whatsapp, services.githubConnections, githubOAuth).listen(port, () => console.log(`Orqestra platform listening on ${port}`));
}

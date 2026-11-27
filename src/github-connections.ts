import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

export interface GitHubRepositoryGrant { repository: string; defaultBranch: string }
export interface GitHubConnection {
  workspaceId: string; installationId: number; accountLogin: string;
  repositories: GitHubRepositoryGrant[]; connectedBy: string; connectedAt: string;
}
interface ConnectionChallenge {
  stateHash: string; workspaceId: string; userId: string; sessionHash: string;
  installationId: number; expiresAt: Date;
}
export interface GitHubConnectionRegistry {
  startChallenge(challenge: ConnectionChallenge): Promise<void>;
  consumeChallenge(stateHash: string, userId: string, sessionHash: string): Promise<ConnectionChallenge | undefined>;
  saveConnection(connection: GitHubConnection): Promise<void>;
  listConnections(workspaceId: string): Promise<GitHubConnection[]>;
  getConnection(workspaceId: string, installationId: number): Promise<GitHubConnection | undefined>;
  removeConnection(workspaceId: string, installationId: number): Promise<boolean>;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fromRow(row: Record<string, unknown>): GitHubConnection {
  return {
    workspaceId: String(row.workspaceId), installationId: Number(row.installationId),
    accountLogin: String(row.accountLogin), repositories: row.repositories as GitHubRepositoryGrant[],
    connectedBy: String(row.connectedBy), connectedAt: new Date(row.connectedAt as string | Date).toISOString(),
  };
}
export class PostgresGitHubConnectionRegistry implements GitHubConnectionRegistry {
  constructor(private readonly pool: Pool) {}
  async startChallenge(value: ConnectionChallenge): Promise<void> {
    await this.pool.query("DELETE FROM github_connection_oauth_states WHERE expires_at < now()");
    await this.pool.query(`INSERT INTO github_connection_oauth_states
      (state_hash,workspace_id,user_id,session_hash,installation_id,expires_at)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [value.stateHash,value.workspaceId,value.userId,value.sessionHash,value.installationId,value.expiresAt]);
  }
  async consumeChallenge(stateHash: string, userId: string, sessionHash: string): Promise<ConnectionChallenge | undefined> {
    const result = await this.pool.query(`DELETE FROM github_connection_oauth_states
      WHERE state_hash=$1 AND user_id=$2 AND session_hash=$3 AND expires_at>now()
      RETURNING state_hash AS "stateHash",workspace_id AS "workspaceId",
        user_id AS "userId",session_hash AS "sessionHash",
        installation_id AS "installationId",expires_at AS "expiresAt"`, [stateHash,userId,sessionHash]);
    return result.rows[0] && { ...result.rows[0], installationId: Number(result.rows[0].installationId) };
  }
  async saveConnection(value: GitHubConnection): Promise<void> {
    // The installation can be assigned to one workspace only; never silently transfer it.
    const result = await this.pool.query(`INSERT INTO workspace_github_connections
      (installation_id,workspace_id,account_login,repositories,connected_by)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(installation_id) DO UPDATE SET
        account_login=excluded.account_login,repositories=excluded.repositories,
        connected_by=excluded.connected_by,connected_at=now()
      WHERE workspace_github_connections.workspace_id=excluded.workspace_id
      RETURNING installation_id`,
      [value.installationId,value.workspaceId,value.accountLogin,JSON.stringify(value.repositories),value.connectedBy]);
    if (!result.rowCount) throw new Error("This GitHub installation is already assigned to another workspace");
  }
  async listConnections(workspaceId: string): Promise<GitHubConnection[]> {
    const result = await this.pool.query(`SELECT workspace_id AS "workspaceId",installation_id AS "installationId",
      account_login AS "accountLogin",repositories,connected_by AS "connectedBy",
      connected_at AS "connectedAt" FROM workspace_github_connections WHERE workspace_id=$1 ORDER BY connected_at DESC`, [workspaceId]);
    return result.rows.map(fromRow);
  }
  async getConnection(workspaceId: string, installationId: number): Promise<GitHubConnection | undefined> {
    const result = await this.pool.query(`SELECT workspace_id AS "workspaceId",installation_id AS "installationId",
      account_login AS "accountLogin",repositories,connected_by AS "connectedBy",
      connected_at AS "connectedAt" FROM workspace_github_connections WHERE workspace_id=$1 AND installation_id=$2`,
      [workspaceId,installationId]);
    return result.rows[0] && fromRow(result.rows[0]);
  }
  async removeConnection(workspaceId: string, installationId: number): Promise<boolean> {
    const result = await this.pool.query("DELETE FROM workspace_github_connections WHERE workspace_id=$1 AND installation_id=$2",
      [workspaceId,installationId]);
    return Boolean(result.rowCount);
  }
}
export class MemoryGitHubConnectionRegistry implements GitHubConnectionRegistry {
  private readonly states = new Map<string, ConnectionChallenge>();
  private readonly connections = new Map<number, GitHubConnection>();
  async startChallenge(challenge: ConnectionChallenge) { this.states.set(challenge.stateHash, { ...challenge }); }
  async consumeChallenge(stateHash: string, userId: string, sessionHash: string) {
    const challenge = this.states.get(stateHash);
    if (!challenge || challenge.userId !== userId || challenge.sessionHash !== sessionHash ||
      challenge.expiresAt.getTime() <= Date.now()) return undefined;
    this.states.delete(stateHash);
    return structuredClone(challenge);
  }
  async saveConnection(value: GitHubConnection) {
    const old = this.connections.get(value.installationId);
    if (old && old.workspaceId !== value.workspaceId) throw new Error("This GitHub installation is already assigned to another workspace");
    this.connections.set(value.installationId, structuredClone(value));
  }
  async listConnections(workspaceId: string) {
    return structuredClone([...this.connections.values()].filter(value => value.workspaceId === workspaceId));
  }
  async getConnection(workspaceId: string, installationId: number) {
    const value = this.connections.get(installationId);
    return value?.workspaceId === workspaceId ? structuredClone(value) : undefined;
  }
  async removeConnection(workspaceId: string, installationId: number) {
    const old = this.connections.get(installationId);
    return old?.workspaceId === workspaceId ? this.connections.delete(installationId) : false;
  }
}

type Transport = typeof fetch;
export class GitHubOAuthConnections {
  constructor(
    private readonly registry: GitHubConnectionRegistry,
    private readonly config: { clientId: string; clientSecret: string; appId: string; callbackUrl: string },
    private readonly transport: Transport = fetch,
    private readonly apiBase = "https://api.github.com",
    private readonly oauthBase = "https://github.com",
  ) {}
  async begin(workspaceId: string, userId: string, sessionHash: string, installationId: number) {
    if (!Number.isSafeInteger(installationId) || installationId <= 0) throw new Error("Valid GitHub installation ID required");
    const state = randomBytes(32).toString("base64url");
    await this.registry.startChallenge({ stateHash: hash(state), workspaceId, userId, sessionHash,
      installationId, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const url = new URL("/login/oauth/authorize", this.oauthBase);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.callbackUrl);
    url.searchParams.set("state", state);
    return url.toString();
  }
  private async githubGet<T>(path: string, token: string): Promise<T> {
    const response = await this.transport(`${this.apiBase}${path}`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub authorization verification failed (${response.status})`);
    return await response.json() as T;
  }
  async finish(code: string, state: string, userId: string, sessionHash: string,
    authorizeWorkspace: (workspaceId: string) => boolean): Promise<GitHubConnection> {
    if (!/^[a-zA-Z0-9_-]{20,150}$/.test(state) || !/^[a-zA-Z0-9_-]{5,500}$/.test(code)) throw new Error("Invalid GitHub callback");
    const pending = await this.registry.consumeChallenge(hash(state), userId, sessionHash);
    if (!pending) throw new Error("GitHub authorization has expired or was already used");
    if (!authorizeWorkspace(pending.workspaceId)) throw new Error("Workspace administrator access is required");
    const exchange = await this.transport(`${this.oauthBase}/login/oauth/access_token`, {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret,
        code, redirect_uri: this.config.callbackUrl }),
    });
    if (!exchange.ok) throw new Error("GitHub authorization exchange failed");
    const token = await exchange.json() as { access_token?: string; error?: string };
    if (!token.access_token || token.error) throw new Error("GitHub authorization was not granted");
    let accountLogin = "";
    let matched = false;
    for (let page = 1; page <= 10; page++) {
      const result = await this.githubGet<{ installations?: Array<{ id: number; app_id: number; account?: { login?: string } }> }>(
        `/user/installations?per_page=100&page=${page}`, token.access_token);
      const installs = result.installations ?? [];
      const found = installs.find(value => value.id === pending.installationId && String(value.app_id) === this.config.appId);
      if (found) { matched = true; accountLogin = found.account?.login ?? ""; break; }
      if (installs.length < 100) break;
    }
    if (!matched || !accountLogin) throw new Error("The GitHub App installation is not accessible to this GitHub user");
    // Only a GitHub repository administrator may authorize Orqestra for that repository.
    // These grants intentionally exclude repos where the OAuth user has read/write only.
    const repositories: GitHubRepositoryGrant[] = [];
    for (let page = 1; page <= 10; page++) {
      const result = await this.githubGet<{ repositories?: Array<{ full_name: string; default_branch?: string; permissions?: { admin?: boolean } }> }>(
        `/user/installations/${pending.installationId}/repositories?per_page=100&page=${page}`, token.access_token);
      const values = result.repositories ?? [];
      for (const value of values) if (value.permissions?.admin === true &&
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.full_name) &&
        value.full_name.split("/")[0]?.toLowerCase() === accountLogin.toLowerCase()) {
        repositories.push({ repository: value.full_name, defaultBranch: value.default_branch ?? "main" });
      }
      if (values.length < 100) break;
    }
    if (!repositories.length) throw new Error("No repositories with admin permissions were authorized for this installation");
    const connection: GitHubConnection = { workspaceId: pending.workspaceId,
      installationId: pending.installationId, accountLogin,
      repositories, connectedBy: pending.userId, connectedAt: new Date().toISOString() };
    await this.registry.saveConnection(connection);
    return connection;
  }
}

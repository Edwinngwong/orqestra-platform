import type { Pool } from "pg";
import type { Project, ProjectPolicy, Workspace } from "./domain.js";

export interface CreateWorkspace { name: string; slug: string }
export interface CreateProject { workspaceId: string; name: string; repository: string; defaultBranch: string; githubInstallationId: number; policy: ProjectPolicy }
export interface ProjectRegistry {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspace): Promise<Workspace>;
  listProjects(workspaceId?: string): Promise<Project[]>;
  createProject(input: CreateProject): Promise<Project>;
  findByRepository(repository: string): Promise<Project | undefined>;
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id), workspaceId: String(row.workspaceId), name: String(row.name), repository: String(row.repository),
    defaultBranch: String(row.defaultBranch), githubInstallationId: Number(row.githubInstallationId), policy: row.policy as ProjectPolicy,
    createdAt: new Date(row.createdAt as string | Date).toISOString(), updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
  };
}

export class PostgresProjectRegistry implements ProjectRegistry {
  constructor(private readonly pool: Pool) {}
  async listWorkspaces(): Promise<Workspace[]> {
    const result = await this.pool.query('SELECT id,name,slug,created_at AS "createdAt" FROM workspaces ORDER BY name');
    return result.rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toISOString() })) as Workspace[];
  }
  async createWorkspace(input: CreateWorkspace): Promise<Workspace> {
    const result = await this.pool.query('INSERT INTO workspaces(id,name,slug) VALUES($1,$2,$3) RETURNING id,name,slug,created_at AS "createdAt"', [crypto.randomUUID(), input.name, input.slug]);
    return { ...result.rows[0], createdAt: new Date(result.rows[0].createdAt).toISOString() } as Workspace;
  }
  async listProjects(workspaceId?: string): Promise<Project[]> {
    const result = await this.pool.query(`SELECT id,workspace_id AS "workspaceId",name,repository,default_branch AS "defaultBranch",github_installation_id AS "githubInstallationId",policy,created_at AS "createdAt",updated_at AS "updatedAt" FROM projects ${workspaceId ? "WHERE workspace_id=$1" : ""} ORDER BY name`, workspaceId ? [workspaceId] : []);
    return result.rows.map(mapProject);
  }
  async createProject(input: CreateProject): Promise<Project> {
    const result = await this.pool.query('INSERT INTO projects(id,workspace_id,name,repository,default_branch,github_installation_id,policy) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,workspace_id AS "workspaceId",name,repository,default_branch AS "defaultBranch",github_installation_id AS "githubInstallationId",policy,created_at AS "createdAt",updated_at AS "updatedAt"', [crypto.randomUUID(), input.workspaceId, input.name, input.repository, input.defaultBranch, input.githubInstallationId, input.policy]);
    return mapProject(result.rows[0]);
  }
  async findByRepository(repository: string): Promise<Project | undefined> {
    const result = await this.pool.query('SELECT id,workspace_id AS "workspaceId",name,repository,default_branch AS "defaultBranch",github_installation_id AS "githubInstallationId",policy,created_at AS "createdAt",updated_at AS "updatedAt" FROM projects WHERE lower(repository)=lower($1)', [repository]);
    return result.rows[0] && mapProject(result.rows[0]);
  }
}

export class MemoryProjectRegistry implements ProjectRegistry {
  private readonly workspaces: Workspace[] = [];
  private readonly projects: Project[] = [];
  async listWorkspaces() { return structuredClone(this.workspaces); }
  async createWorkspace(input: CreateWorkspace) { const value = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }; this.workspaces.push(value); return structuredClone(value); }
  async listProjects(workspaceId?: string) { return structuredClone(workspaceId ? this.projects.filter(value => value.workspaceId === workspaceId) : this.projects); }
  async createProject(input: CreateProject) { const now = new Date().toISOString(); const value = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now }; this.projects.push(value); return structuredClone(value); }
  async findByRepository(repository: string) { const value = this.projects.find(item => item.repository.toLowerCase() === repository.toLowerCase()); return value && structuredClone(value); }
}

import type { Pool } from "pg";
import type { Project, ProjectPolicy, TrackerKind, Workspace } from "./domain.js";

export interface CreateWorkspace { name: string; slug: string }
export type OwnershipMode = "customer_owned" | "orqestra_managed";
export interface CreateNewProjectIntake {
  workspaceId: string;
  name: string;
  goal: string;
  ownershipMode: OwnershipMode;
  monthlyBudgetUsd?: number;
  requestedBy: string;
}
export interface NewProjectIntake extends CreateNewProjectIntake {
  id: string;
  status: "pending_review";
  createdAt: string;
  updatedAt: string;
}
export interface CreateProject { workspaceId: string; name: string; repository: string; defaultBranch: string; githubInstallationId: number; policy: ProjectPolicy; tracker?: TrackerKind; jiraProjectKey?: string }
export interface ProjectRegistry {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspace): Promise<Workspace>;
  listProjects(workspaceId?: string): Promise<Project[]>;
  createProject(input: CreateProject): Promise<Project>;
  findByRepository(repository: string): Promise<Project | undefined>;
  listNewProjectIntakes(workspaceId?: string): Promise<NewProjectIntake[]>;
  createNewProjectIntake(input: CreateNewProjectIntake): Promise<NewProjectIntake>;
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id), workspaceId: String(row.workspaceId), name: String(row.name), repository: String(row.repository),
    defaultBranch: String(row.defaultBranch), githubInstallationId: Number(row.githubInstallationId), policy: row.policy as ProjectPolicy,
    tracker: (row.tracker as TrackerKind | undefined) ?? "github_issue", ...(row.jiraProjectKey ? { jiraProjectKey: String(row.jiraProjectKey) } : {}),
    createdAt: new Date(row.createdAt as string | Date).toISOString(), updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
  };
}

function mapIntake(row: Record<string, unknown>): NewProjectIntake {
  return {
    id: String(row.id), workspaceId: String(row.workspaceId), name: String(row.name),
    goal: String(row.goal), ownershipMode: row.ownershipMode as OwnershipMode,
    ...(row.monthlyBudgetUsd === null || row.monthlyBudgetUsd === undefined ? {} : { monthlyBudgetUsd: Number(row.monthlyBudgetUsd) }),
    requestedBy: String(row.requestedBy), status: "pending_review",
    createdAt: new Date(row.createdAt as string | Date).toISOString(),
    updatedAt: new Date(row.updatedAt as string | Date).toISOString(),
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
    const result = await this.pool.query(`SELECT id,workspace_id AS "workspaceId",name,repository,default_branch AS "defaultBranch",github_installation_id AS "githubInstallationId",policy,tracker_type AS tracker,jira_project_key AS "jiraProjectKey",created_at AS "createdAt",updated_at AS "updatedAt" FROM projects ${workspaceId ? "WHERE workspace_id=$1" : ""} ORDER BY name`, workspaceId ? [workspaceId] : []);
    return result.rows.map(mapProject);
  }
  async createProject(input: CreateProject): Promise<Project> {
    const result = await this.pool.query('INSERT INTO projects(id,workspace_id,name,repository,default_branch,github_installation_id,policy,tracker_type,jira_project_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,workspace_id AS "workspaceId",name,repository,default_branch AS "defaultBranch",github_installation_id AS "githubInstallationId",policy,tracker_type AS tracker,jira_project_key AS "jiraProjectKey",created_at AS "createdAt",updated_at AS "updatedAt"', [crypto.randomUUID(), input.workspaceId, input.name, input.repository, input.defaultBranch, input.githubInstallationId, input.policy, input.tracker ?? "github_issue", input.jiraProjectKey ?? null]);
    return mapProject(result.rows[0]);
  }
  async findByRepository(repository: string): Promise<Project | undefined> {
    const result = await this.pool.query('SELECT id,workspace_id AS "workspaceId",name,repository,default_branch AS "defaultBranch",github_installation_id AS "githubInstallationId",policy,tracker_type AS tracker,jira_project_key AS "jiraProjectKey",created_at AS "createdAt",updated_at AS "updatedAt" FROM projects WHERE lower(repository)=lower($1)', [repository]);
    return result.rows[0] && mapProject(result.rows[0]);
  }
  async listNewProjectIntakes(workspaceId?: string): Promise<NewProjectIntake[]> {
    const result = await this.pool.query(`SELECT id,workspace_id AS "workspaceId",name,goal,ownership_mode AS "ownershipMode",monthly_budget_usd AS "monthlyBudgetUsd",requested_by AS "requestedBy",status,created_at AS "createdAt",updated_at AS "updatedAt" FROM new_project_intakes ${workspaceId ? "WHERE workspace_id=$1" : ""} ORDER BY created_at DESC`, workspaceId ? [workspaceId] : []);
    return result.rows.map(mapIntake);
  }
  async createNewProjectIntake(input: CreateNewProjectIntake): Promise<NewProjectIntake> {
    const result = await this.pool.query(`INSERT INTO new_project_intakes(id,workspace_id,name,goal,ownership_mode,monthly_budget_usd,requested_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING id,workspace_id AS "workspaceId",name,goal,ownership_mode AS "ownershipMode",monthly_budget_usd AS "monthlyBudgetUsd",requested_by AS "requestedBy",status,created_at AS "createdAt",updated_at AS "updatedAt"`,
      [crypto.randomUUID(), input.workspaceId, input.name, input.goal, input.ownershipMode, input.monthlyBudgetUsd ?? null, input.requestedBy]);
    return mapIntake(result.rows[0]);
  }
}

export class MemoryProjectRegistry implements ProjectRegistry {
  private readonly workspaces: Workspace[] = [];
  private readonly projects: Project[] = [];
  private readonly intakes: NewProjectIntake[] = [];
  async listWorkspaces() { return structuredClone(this.workspaces); }
  async createWorkspace(input: CreateWorkspace) { const value = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }; this.workspaces.push(value); return structuredClone(value); }
  async listProjects(workspaceId?: string) { return structuredClone(workspaceId ? this.projects.filter(value => value.workspaceId === workspaceId) : this.projects); }
  async createProject(input: CreateProject) { const now = new Date().toISOString(); const value: Project = { ...input, tracker: input.tracker ?? "github_issue", id: crypto.randomUUID(), createdAt: now, updatedAt: now }; this.projects.push(value); return structuredClone(value); }
  async findByRepository(repository: string) { const value = this.projects.find(item => item.repository.toLowerCase() === repository.toLowerCase()); return value && structuredClone(value); }
  async listNewProjectIntakes(workspaceId?: string) { return structuredClone(workspaceId ? this.intakes.filter(value => value.workspaceId === workspaceId) : this.intakes); }
  async createNewProjectIntake(input: CreateNewProjectIntake) {
    const now = new Date().toISOString();
    const value: NewProjectIntake = { ...input, id: crypto.randomUUID(), status: "pending_review", createdAt: now, updatedAt: now };
    this.intakes.push(value);
    return structuredClone(value);
  }
}

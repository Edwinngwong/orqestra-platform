import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { promisify } from "node:util";
import type { Pool } from "pg";

const scrypt = promisify(scryptCallback);
export type WorkspaceRole = "owner" | "admin" | "reviewer" | "viewer";
export interface Principal { userId: string; email: string; mustChangePassword: boolean; system: boolean; roles: Map<string, WorkspaceRole>; csrfHash?: string; sessionHash?: string }
const rank: Record<WorkspaceRole, number> = { viewer: 1, reviewer: 2, admin: 3, owner: 4 };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 200) throw new Error("Password must be 12-200 characters");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(password, Buffer.from(saltValue, "base64url"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function cookie(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export class AuthService {
  constructor(private readonly pool: Pool) {}
  async authenticate(request: IncomingMessage, operatorToken: string): Promise<Principal | undefined> {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ") && operatorToken) {
      const expected = Buffer.from(digest(operatorToken));
      const received = Buffer.from(digest(authorization.slice(7)));
      if (timingSafeEqual(expected, received)) return { userId: "system", email: "local-operator", mustChangePassword: false, system: true, roles: new Map() };
    }
    const raw = cookie(request, "orqestra_session");
    if (!raw) return undefined;
    const sessionHash = digest(raw);
    const result = await this.pool.query(`SELECT u.id,u.email,u.must_change_password AS "mustChangePassword",s.csrf_hash AS "csrfHash",m.workspace_id AS "workspaceId",m.role
      FROM user_sessions s JOIN users u ON u.id=s.user_id AND u.active
      LEFT JOIN workspace_memberships m ON m.user_id=u.id
      WHERE s.token_hash=$1 AND s.expires_at>now()`, [sessionHash]);
    if (!result.rows.length) return undefined;
    const roles = new Map<string, WorkspaceRole>();
    for (const row of result.rows) if (row.workspaceId) roles.set(String(row.workspaceId), row.role as WorkspaceRole);
    const first = result.rows[0];
    return { userId: first.id, email: first.email, mustChangePassword: first.mustChangePassword, system: false, roles, csrfHash: first.csrfHash, sessionHash };
  }
  async login(email: string, password: string): Promise<{ cookie: string; csrfToken: string; user: { id: string; email: string; mustChangePassword: boolean; roles: Array<{ workspaceId: string; role: WorkspaceRole }> } }> {
    const result = await this.pool.query('SELECT id,email,password_hash AS "passwordHash",must_change_password AS "mustChangePassword" FROM users WHERE email=lower($1) AND active', [email]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new Error("Invalid email or password");
    const token = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url");
    await this.pool.query("DELETE FROM user_sessions WHERE expires_at<=now()");
    await this.pool.query("INSERT INTO user_sessions(token_hash,csrf_hash,user_id,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')", [digest(token), digest(csrfToken), user.id]);
    const memberships = await this.pool.query('SELECT workspace_id AS "workspaceId",role FROM workspace_memberships WHERE user_id=$1', [user.id]);
    return { cookie: `orqestra_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, csrfToken, user: { id: user.id, email: user.email, mustChangePassword: user.mustChangePassword, roles: memberships.rows } };
  }
  validateCsrf(request: IncomingMessage, principal: Principal): boolean { return principal.system || (!!principal.csrfHash && digest(String(request.headers["x-csrf-token"] ?? "")) === principal.csrfHash); }
  can(principal: Principal, workspaceId: string | undefined, minimum: WorkspaceRole): boolean { return principal.system || (!!workspaceId && rank[principal.roles.get(workspaceId) ?? "viewer"] >= rank[minimum] && principal.roles.has(workspaceId)); }
  async logout(principal: Principal) { if (principal.sessionHash) await this.pool.query("DELETE FROM user_sessions WHERE token_hash=$1", [principal.sessionHash]); }
  async changePassword(principal: Principal, current: string, next: string) {
    const result = await this.pool.query('SELECT password_hash AS "passwordHash" FROM users WHERE id=$1', [principal.userId]);
    if (!result.rows[0] || !(await verifyPassword(current, result.rows[0].passwordHash))) throw new Error("Current password is incorrect");
    await this.pool.query("UPDATE users SET password_hash=$2,must_change_password=false,updated_at=now() WHERE id=$1", [principal.userId, await hashPassword(next)]);
    await this.pool.query("DELETE FROM user_sessions WHERE user_id=$1 AND token_hash<>$2", [principal.userId, principal.sessionHash ?? ""]);
  }
  async createUser(email: string, password: string, mustChangePassword = true): Promise<string> {
    const id = crypto.randomUUID();
    await this.pool.query("INSERT INTO users(id,email,password_hash,must_change_password) VALUES($1,lower($2),$3,$4)", [id, email, await hashPassword(password), mustChangePassword]);
    return id;
  }
  async upsertMembership(workspaceId: string, userId: string, role: WorkspaceRole) { await this.pool.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role", [workspaceId, userId, role]); }
  async listMembers(workspaceId: string) { const result = await this.pool.query('SELECT u.id,u.email,m.role,u.must_change_password AS "mustChangePassword",m.created_at AS "createdAt" FROM workspace_memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.email', [workspaceId]); return result.rows; }
  async invite(workspaceId: string, email: string, role: WorkspaceRole) {
    const temporaryPassword = `${randomBytes(18).toString("base64url")}Aa1!`;
    const existing = await this.pool.query("SELECT id FROM users WHERE email=lower($1)", [email]);
    const userId = existing.rows[0]?.id ?? await this.createUser(email, temporaryPassword, true);
    await this.upsertMembership(workspaceId, userId, role);
    return { userId, email: email.toLowerCase(), role, ...(existing.rows[0] ? {} : { temporaryPassword }) };
  }
}

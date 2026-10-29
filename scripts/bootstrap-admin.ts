import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { AuthService } from "../src/auth.js";

const email = process.argv[2]?.toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Usage: bootstrap-admin.ts user@example.com");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const password = process.env.BOOTSTRAP_PASSWORD ?? `${randomBytes(18).toString("base64url")}Aa1!`;
const pool = new Pool({ connectionString });
try {
  const auth = new AuthService(pool);
  const existing = await pool.query("SELECT id FROM users WHERE email=$1", [email]);
  const userId = existing.rows[0]?.id ?? await auth.createUser(email, password, true);
  const workspace = await pool.query("SELECT id FROM workspaces ORDER BY created_at LIMIT 1");
  if (!workspace.rows[0]) throw new Error("Create a workspace before bootstrapping an owner");
  await auth.upsertMembership(workspace.rows[0].id, userId, "owner");
  console.log(JSON.stringify({ email, password: existing.rows[0] ? undefined : password, workspaceId: workspace.rows[0].id }));
} finally { await pool.end(); }

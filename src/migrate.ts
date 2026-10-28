import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 1 });
try {
  for (const file of (await readdir("migrations")).filter(file => file.endsWith(".sql")).sort()) {
    await pool.query(await readFile(join("migrations", file), "utf8"));
    console.log(`Applied ${file}`);
  }
} finally { await pool.end(); }

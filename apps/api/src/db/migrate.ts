import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnv } from "../config/env.schema";

/**
 * Chạy migration qua kết nối DIRECT (không qua PgBouncer) — DDL cần session ổn định.
 * GX-4: từ G2, policy + FORCE RLS phải nằm TRƯỚC bước backfill company_id trong cùng dãy migration.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_DIRECT_URL) {
    throw new Error("DATABASE_DIRECT_URL is required to run migrations.");
  }

  const pool = new Pool({ connectionString: env.DATABASE_DIRECT_URL, max: 1 });
  try {
    const db = drizzle(pool);
    const migrationsFolder = path.join(__dirname, "..", "..", "migrations");
    await migrate(db, { migrationsFolder });
    console.log(`[db:migrate] applied migrations from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[db:migrate] failed:", err);
  process.exit(1);
});

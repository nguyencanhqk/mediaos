import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * _migrate-from.ts — helper RIÊNG cho seed1-red-evidence.sh (KHÔNG dùng ở app runtime).
 *
 * Khác src/db/migrate.ts ở DUY NHẤT một điểm: thư mục migrations lấy từ env MIGRATIONS_FOLDER thay vì
 * hard-code apps/api/migrations. Điều này cho phép trỏ vào một thư mục migrations TẠM có _journal.json
 * bị CẮT (vd đến idx 126 = 0443) → drizzle migrator chỉ áp các tag trong journal đó ⇒ áp CHỈ đến 0443
 * mà KHÔNG sửa journal gốc. Dùng để tạo bằng chứng RED-before-GREEN (chain 0000→0443 vs 0000→0444).
 *
 * KHÔNG import config/env.schema để tránh fail-fast khi thiếu các biến không liên quan trong ngữ cảnh CLI
 * này — chỉ cần DATABASE_DIRECT_URL.
 */
async function main(): Promise<void> {
  const directUrl = process.env.DATABASE_DIRECT_URL;
  if (!directUrl) {
    throw new Error("DATABASE_DIRECT_URL is required to run migrations.");
  }
  const migrationsFolder =
    process.env.MIGRATIONS_FOLDER ?? path.join(__dirname, "..", "migrations");

  const pool = new Pool({ connectionString: directUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log(`[_migrate-from] applied migrations from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[_migrate-from] failed:", err);
  process.exit(1);
});

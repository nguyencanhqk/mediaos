#!/usr/bin/env node
// setup-db-roles.mjs — gán MẬT KHẨU cho 3 DB role (G2-1), TÁCH khỏi migration.
//
// BẤT BIẾN #3: mật khẩu KHÔNG nằm trong source/migration → đọc từ env tại runtime.
// Chạy SAU `db:migrate` (migration 0001 đã tạo role), bằng kết nối SUPERUSER bootstrap.
// Idempotent: chạy lại nhiều lần an toàn (ALTER ROLE ... PASSWORD ghi đè).
//
// Env:
//   DATABASE_DIRECT_URL  postgres://<superuser>...  (kết nối bootstrap, có quyền ALTER ROLE)
//   APP_DB_PASSWORD      mật khẩu cho mediaos_app    (BẮT BUỘC)
//   WORKER_DB_PASSWORD   mật khẩu cho mediaos_worker (BẮT BUỘC)
//   OWNER_DB_PASSWORD    mật khẩu cho mediaos_owner  (tuỳ chọn — chỉ cần khi prod chạy migration bằng owner)
//
// Dùng: `node scripts/setup-db-roles.mjs`  (hoặc `pnpm db:setup-roles`).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Pool } from "pg";

const DIRECT_URL = process.env.DATABASE_DIRECT_URL;
if (!DIRECT_URL) {
  console.error("[setup-db-roles] DATABASE_DIRECT_URL is required (superuser bootstrap connection).");
  process.exit(1);
}

/** Nơi sinh userlist.txt cho PgBouncer auth_query (mount read-only vào container). */
const USERLIST_PATH = process.env.PGBOUNCER_USERLIST_PATH ?? "./.secrets/pgbouncer/userlist.txt";

/** Role → biến env mật khẩu. owner tuỳ chọn (prod), app/worker/pgbouncer_auth bắt buộc. */
const ROLE_PASSWORDS = [
  { role: "mediaos_app", env: "APP_DB_PASSWORD", required: true },
  { role: "mediaos_worker", env: "WORKER_DB_PASSWORD", required: true },
  { role: "pgbouncer_auth", env: "PGBOUNCER_AUTH_PASSWORD", required: true },
  { role: "mediaos_owner", env: "OWNER_DB_PASSWORD", required: false },
];

async function main() {
  const missing = ROLE_PASSWORDS.filter((r) => r.required && !process.env[r.env]);
  if (missing.length > 0) {
    console.error(
      `[setup-db-roles] thiếu env bắt buộc: ${missing.map((r) => r.env).join(", ")}`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: DIRECT_URL, max: 1 });
  try {
    for (const { role, env, required } of ROLE_PASSWORDS) {
      const password = process.env[env];
      if (!password) {
        if (!required) {
          console.log(`[setup-db-roles] bỏ qua ${role} (không có ${env}).`);
        }
        continue;
      }
      // ALTER ROLE ... PASSWORD KHÔNG nhận tham số bind cho tên role → kiểm tra role tồn tại
      // qua tham số bind trước, rồi format định danh an toàn. Mật khẩu truyền qua literal có escape.
      const exists = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
      if (exists.rowCount === 0) {
        throw new Error(`role ${role} chưa tồn tại — chạy db:migrate (0001) trước.`);
      }
      const quotedPassword = `'${password.replace(/'/g, "''")}'`;
      await pool.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${quotedPassword}`);
      console.log(`[setup-db-roles] đã gán mật khẩu cho ${role}.`);
    }

    // Sinh userlist.txt cho PgBouncer auth_query: chứa SCRAM verifier của pgbouncer_auth
    // (đọc từ pg_authid sau khi đã set password). KHÔNG log nội dung (secret).
    const verifier = await pool.query(
      "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
      ["pgbouncer_auth"],
    );
    const hash = verifier.rows[0]?.rolpassword;
    if (!hash) {
      throw new Error("không đọc được hash của pgbouncer_auth (cần superuser đọc pg_authid).");
    }
    const line = `"pgbouncer_auth" "${hash}"\n`;
    mkdirSync(dirname(USERLIST_PATH), { recursive: true });
    writeFileSync(USERLIST_PATH, line, { mode: 0o600 });
    console.log(`[setup-db-roles] đã sinh userlist PgBouncer → ${USERLIST_PATH}`);

    console.log("[setup-db-roles] hoàn tất.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[setup-db-roles] thất bại:", err instanceof Error ? err.message : err);
  process.exit(1);
});

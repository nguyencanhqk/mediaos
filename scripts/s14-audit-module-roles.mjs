// s14-audit-module-roles.mjs — ĐO trạng thái gán role của các module đã ship (wave S11/S12/S13) trên một DB thật.
//
// VÌ SAO TỒN TẠI: `SuperAdminBootstrap` là no-op trên PROD (chỉ chạy khi DB trống), và các migration seed role
// (0550 ASSET · 0554 ROOM · 0560 RECRUIT · 0565 PAYROLL) chỉ TẠO role + cấp quyền cho role — KHÔNG gán role cho
// người. Hệ quả: module ship xong vẫn VÔ HÌNH với mọi admin thật, và job NOTI theo module phát 0 thông báo.
// Không có cổng tự động nào bắt được việc này (typecheck/CI/int-spec đều xanh) ⇒ phải ĐO trên DB.
//
// CHỈ SELECT — script này không ghi một hàng nào. Việc GÁN role phải đi qua màn quản trị role (đường sản phẩm,
// có audit), KHÔNG blanket grant, KHÔNG SQL tay (done_when của S14-OPS-MODULEROLE-1).
//
// Cách dùng (từ gốc repo):
//   node scripts/s14-audit-module-roles.mjs            # đọc DATABASE_DIRECT_URL từ <repo>/.env
//   node scripts/s14-audit-module-roles.mjs --json     # in JSON cho pipeline
//
// Lưu ý: `<repo>/.env` là env RUNTIME của PROD (memory env-prod-file-is-not-the-runtime-env) — `.env.prod`
// KHÔNG phải file runtime. Đổi DB đích thì set DATABASE_DIRECT_URL sẵn trong môi trường trước khi chạy.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AS_JSON = process.argv.includes("--json");

/**
 * Role sinh bởi migration seed của từng wave. `module` = mã trong bảng `modules`.
 * `probePair` = một cặp quyền ĐẶC TRƯNG của module — dùng để đối chiếu "role có thật quyền không",
 * chứ không chỉ "role có tồn tại không".
 */
const WAVE_ROLES = [
  {
    role: "asset-manager",
    module: "ASSET",
    wave: "S11",
    migration: "0550",
    probePair: ["view", "asset"],
  },
  {
    role: "office-admin",
    module: "ROOM",
    wave: "S11",
    migration: "0554",
    probePair: ["view", "room"],
  },
  {
    role: "recruiter",
    module: "RECRUIT",
    wave: "S12",
    migration: "0560",
    probePair: ["view", "job-opening"],
  },
  {
    role: "payroll-officer",
    module: "PAYROLL",
    wave: "S13",
    migration: "0565",
    probePair: ["view", "payroll-period"],
  },
];

/** Migration của lô payroll — chưa áp đủ thì role `payroll-officer` chưa tồn tại. */
const PAYROLL_BATCH = ["0564", "0565", "0566", "0567", "0568"];

function loadDotEnv() {
  if (process.env.DATABASE_DIRECT_URL) return "môi trường sẵn có";
  const path = resolve(REPO_ROOT, ".env");
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  if (!process.env.DATABASE_DIRECT_URL) throw new Error(`Thiếu DATABASE_DIRECT_URL trong ${path}`);
  return path;
}

async function main() {
  const envSource = loadDotEnv();
  const dbName = /\/([A-Za-z0-9_]+)(\?|$)/.exec(process.env.DATABASE_DIRECT_URL)?.[1] ?? "?";
  const pool = new Pool({ connectionString: process.env.DATABASE_DIRECT_URL, max: 1 });
  const client = await pool.connect();

  try {
    const one = async (sql, params = []) => (await client.query(sql, params)).rows;

    // ── 1. Migration head ────────────────────────────────────────────────────
    const applied = await one(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`);
    const lastFive = await one(
      `SELECT hash, to_char(to_timestamp(created_at / 1000), 'YYYY-MM-DD HH24:MI') AS applied_at
         FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5`,
    );
    const payrollApplied = PAYROLL_BATCH.filter((tag) =>
      lastFive.some((r) => String(r.hash).includes(tag)),
    );

    // ── 2. Toàn bộ role + số người + số quyền ────────────────────────────────
    const roles = await one(
      `SELECT r.name,
              r.is_system,
              r.requires_two_factor,
              (SELECT count(*)::int FROM user_roles ur
                 JOIN users u ON u.id = ur.user_id
                WHERE ur.role_id = r.id AND u.deleted_at IS NULL) AS members,
              (SELECT count(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) AS perms
         FROM roles r
        WHERE r.deleted_at IS NULL
        ORDER BY r.is_system DESC, r.name`,
    );

    // ── 3. Bốn role wave: tồn tại · có quyền đặc trưng · ai đang giữ ─────────
    const waveRows = [];
    for (const spec of WAVE_ROLES) {
      const found = roles.find((r) => r.name === spec.role);
      let holders = [];
      let hasProbe = null;
      if (found) {
        holders = await one(
          `SELECT u.email, u.full_name, u.two_factor_enabled, u.is_active
             FROM user_roles ur
             JOIN users u ON u.id = ur.user_id
             JOIN roles r ON r.id = ur.role_id
            WHERE r.name = $1 AND r.deleted_at IS NULL AND u.deleted_at IS NULL
            ORDER BY u.email`,
          [spec.role],
        );
        const probe = await one(
          `SELECT 1 FROM role_permissions rp
             JOIN roles r ON r.id = rp.role_id
             JOIN permissions p ON p.id = rp.permission_id
            WHERE r.name = $1 AND r.deleted_at IS NULL AND p.action = $2 AND p.resource = $3
            LIMIT 1`,
          [spec.role, spec.probePair[0], spec.probePair[1]],
        );
        hasProbe = probe.length > 0;
      }
      waveRows.push({
        wave: spec.wave,
        module: spec.module,
        role: spec.role,
        migration: spec.migration,
        exists: Boolean(found),
        requires_2fa: found?.requires_two_factor ?? null,
        perms: found?.perms ?? 0,
        has_probe_pair: hasProbe,
        members: holders.length,
        holders,
      });
    }

    // ── 4. Bảng modules: is_active (KHÔNG phải cổng, nhưng lái app-shell) ────
    const modules = await one(`SELECT code, name, is_active FROM modules ORDER BY code`);

    // ── 5. Role nào còn giữ grant wildcard (đường ngầm quanh mọi cổng) ───────
    const wildcards = await one(
      `SELECT r.name, p.action, p.resource
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.deleted_at IS NULL AND (p.action = '*' OR p.resource = '*')
        ORDER BY r.name, p.action, p.resource`,
    );

    const report = {
      db: dbName,
      env_source: envSource,
      measured_at: new Date().toISOString(),
      migrations_applied: applied[0].n,
      migration_head: lastFive,
      payroll_batch_in_head: payrollApplied,
      wave_roles: waveRows,
      all_roles: roles,
      modules,
      wildcard_grants: wildcards,
    };

    if (AS_JSON) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`\nDB = ${dbName}   ·   env từ: ${envSource}   ·   đo lúc ${report.measured_at}`);
    console.log(`Migration đã áp: ${report.migrations_applied}`);
    console.log(`Head 5 gần nhất:`);
    console.table(lastFive);
    console.log(`\n── 4 role sinh bởi wave S11/S12/S13 ──`);
    console.table(
      waveRows.map((r) => ({
        wave: r.wave,
        module: r.module,
        role: r.role,
        migration: r.migration,
        exists: r.exists,
        requires_2fa: r.requires_2fa,
        perms: r.perms,
        has_probe_pair: r.has_probe_pair,
        members: r.members,
      })),
    );
    for (const r of waveRows) {
      if (r.holders.length) {
        console.log(`\n  ${r.role} — ${r.holders.length} người:`);
        console.table(r.holders);
      }
    }
    console.log(`\n── Toàn bộ role trên DB ──`);
    console.table(roles);
    console.log(`\n── modules.is_active ──`);
    console.table(modules);
    console.log(`\n── grant wildcard còn sót (đường ngầm quanh mọi cổng) ──`);
    console.table(wildcards);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`LỖI: ${e.message}`);
  process.exit(1);
});

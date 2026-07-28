#!/usr/bin/env node
/**
 * check-prod-test-tenants.mjs — CHỐT HỒI QUY của S6-SEC-DBFENCE-1 (KI-028).
 *
 * VÌ SAO CÓ FILE NÀY. KI-028 đã đóng một lần ngày 27/7 bằng cách DỌN RÁC mà không có chốt nào phát
 * hiện rác mọc lại. Hai ngày sau: 16 tenant test → 74. Lần này rác quay lại là ĐỎ, không phải phát
 * hiện tình cờ trong một FULL gate khác.
 *
 * LÀM GÌ. Đếm company khớp mẫu tenant test (`slug ~ '-[0-9a-f]{8}$'` — hậu tố randomUUID của
 * `test/helpers/seed.ts::seedCompany`) trong DB PROD. Khác 0 ⇒ exit 1.
 *
 * CHẠY:
 *   node scripts/check-prod-test-tenants.mjs                 # đọc DATABASE_DIRECT_URL, mặc định .env.prod
 *   node scripts/check-prod-test-tenants.mjs --env .env.dev-online
 *   DATABASE_DIRECT_URL=postgres://… node scripts/check-prod-test-tenants.mjs
 *   node scripts/check-prod-test-tenants.mjs --json          # máy đọc
 *
 * KHÔNG với tới được DB (máy khác / CI / Postgres chưa lên) ⇒ exit 0 + cảnh báo. Chốt này canh DB
 * PROD của MÁY CÓ PROD; nó không được phép tạo đỏ-giả ở nơi không có PROD.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const TEST_SLUG_PATTERN = "-[0-9a-f]{8}$";
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const envFile = args.includes("--env") ? args[args.indexOf("--env") + 1] : ".env.prod";

function urlFromEnvFile(file) {
  const abs = resolve(process.cwd(), file);
  if (!existsSync(abs)) return null;
  for (const raw of readFileSync(abs, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    if (line.slice(0, eq).trim() === "DATABASE_DIRECT_URL") return line.slice(eq + 1).trim();
  }
  return null;
}

function ket(code, payload) {
  if (asJson) console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
}

const url = process.env.DATABASE_DIRECT_URL?.trim() || urlFromEnvFile(envFile);
if (!url) {
  if (!asJson)
    console.warn(
      `[prod-tenant-check] BỎ QUA: không có DATABASE_DIRECT_URL (và ${envFile} không có/không khai).`,
    );
  ket(0, { skipped: true, reason: "no-database-url" });
}

const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });

let res;
try {
  res = await pool.query(
    `SELECT
       (SELECT count(*) FROM companies)                                             AS company_tong,
       (SELECT count(*) FROM companies WHERE slug ~ $1)                             AS company_test,
       (SELECT count(*) FROM users u JOIN companies c ON c.id = u.company_id
         WHERE c.slug ~ $1 AND u.deleted_at IS NULL AND u.status = 'active')        AS user_test_active,
       (SELECT count(DISTINCT u.id) FROM users u
          JOIN companies c ON c.id = u.company_id
          JOIN user_roles ur ON ur.user_id = u.id AND ur.deleted_at IS NULL
          JOIN roles r ON r.id = ur.role_id AND r.company_id IS NULL
         WHERE c.slug ~ $1 AND u.deleted_at IS NULL)                                AS user_test_role_toan_cuc,
       (SELECT current_database())                                                  AS db`,
    [TEST_SLUG_PATTERN],
  );
} catch (err) {
  if (!asJson) console.warn(`[prod-tenant-check] BỎ QUA: không nối được DB (${err.message}).`);
  await pool.end().catch(() => {});
  ket(0, { skipped: true, reason: "unreachable", error: err.message });
}

const r = res.rows[0];
const soTest = Number(r.company_test);
const chiTiet = {
  db: r.db,
  company_tong: Number(r.company_tong),
  company_test: soTest,
  user_test_active: Number(r.user_test_active),
  user_test_role_toan_cuc: Number(r.user_test_role_toan_cuc),
};

let mau = [];
if (soTest > 0) {
  const s = await pool.query(
    `SELECT slug, created_at FROM companies WHERE slug ~ $1 ORDER BY created_at DESC LIMIT 10`,
    [TEST_SLUG_PATTERN],
  );
  mau = s.rows.map((x) => `${x.slug} (${x.created_at.toISOString()})`);
}
await pool.end();

if (soTest === 0) {
  if (!asJson)
    console.log(`[prod-tenant-check] ✅ ${r.db}: 0 tenant test / ${chiTiet.company_tong} company.`);
  ket(0, { ok: true, ...chiTiet });
}

if (!asJson) {
  console.error(`
╔══════════════════════════════════════════════════════════════════════════════════╗
║  ĐỎ: DB PROD lại có TENANT TEST (KI-028 tái diễn).                              ║
╚══════════════════════════════════════════════════════════════════════════════════╝
  database                     : ${chiTiet.db}
  company khớp mẫu tenant test : ${chiTiet.company_test} / ${chiTiet.company_tong}
  user test còn active         : ${chiTiet.user_test_active}
  user test giữ role TOÀN CỤC  : ${chiTiet.user_test_role_toan_cuc}

  mới nhất:
${mau.map((m) => `    - ${m}`).join("\n")}

  Nghĩa là hàng rào ở apps/api/test/db-target.ts + test/global-setup.ts đã bị vượt qua HOẶC bị nới.
  Tìm nguồn: đối chiếu tiền tố slug với đối số label của seedCompany(direct, "<label>") trong spec.
`);
}
ket(1, { ok: false, ...chiTiet, moi_nhat: mau });

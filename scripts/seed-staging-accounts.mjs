/**
 * seed-staging-accounts.mjs — Seed 4 tài khoản staging/UAT (Employee · Manager · HR · company-admin)
 * lên mediaos_dev, NON-DESTRUCTIVE + idempotent. Chạy SAU `db:migrate` (staging order: migrate → seed →
 * API up env PLATFORM_SUPERADMIN_* → smoke). Dùng cho UAT (mediaos_dev) — KHÔNG dùng cho DB test tự động.
 *
 * KHÁC seed-admin.mjs (chỉ 1 admin, tham số ADMIN_*): file này seed đúng 4 tài khoản demo-role cố định để
 * QA đăng nhập thử 5-role (SA đến từ SuperAdminBootstrapService, KHÔNG seed ở đây). Đọc THÔNG SỐ từ env.
 *
 * BẤT BIẾN / RÀNG BUỘC (CLAUDE.md §2/§3, S5-DEVOPS-1):
 *   #1 company_id: MỌI INSERT (users + user_roles) SET company_id = <resolved> TƯỜNG MINH. Kết nối qua
 *      DATABASE_DIRECT_URL = superuser `mediaos` (BYPASSRLS) — hợp lệ cho công cụ seed vận hành (mirror
 *      seed-admin.mjs / demo-seed-base.mjs). KHÔNG dựa vào RLS session var; cô lập ép bằng company_id literal.
 *   #3 secret: mật khẩu đọc từ STAGING_SEED_*_PASSWORD (fail-fast, MIN ≥12 — nhất là company-admin), hash
 *      argon2id (params khớp PasswordService). TUYỆT ĐỐI KHÔNG log mật khẩu/hash.
 *   • TUYỆT ĐỐI KHÔNG tạo role super-admin / KHÔNG grant catalog / KHÔNG chạm role_permissions — SA 100% qua
 *     SuperAdminBootstrapService (env PLATFORM_SUPERADMIN_*). Ở đây chỉ gán 4 SYSTEM role có sẵn.
 *   • KHÔNG drop/wipe/hard-delete. KHÔNG ghi audit_logs (owner CHẤP NHẬN — mirror demo-seed-base precedent).
 *
 * IDEMPOTENCY:
 *   - company: resolve theo slug (NOT NULL else fail) — KHÔNG tạo mới (staging đã có tenant-root sau boot).
 *   - users: UPSERT theo (company_id, email) — chạy lại reset mật khẩu + kích hoạt, KHÔNG nhân bản.
 *   - user_roles: SELECT-then-INSERT lọc `deleted_at IS NULL` (khớp partial index user_roles_active_uq,
 *     mig 0471) — KHÔNG ON CONFLICT; tombstone (đã gỡ) KHÔNG chặn re-grant.
 *
 * Biến môi trường:
 *   SEED_DIRECT_URL | DATABASE_DIRECT_URL           (bắt buộc)  direct superuser :5432 → mediaos_dev
 *   STAGING_SEED_COMPANY_SLUG                        (tuỳ chọn, mặc định "demo")
 *   STAGING_SEED_{EMPLOYEE|MANAGER|HR|ADMIN}_EMAIL   (bắt buộc)
 *   STAGING_SEED_{EMPLOYEE|MANAGER|HR|ADMIN}_PASSWORD(bắt buộc, ≥12 ký tự — KHÔNG bao giờ log)
 *   STAGING_SEED_{EMPLOYEE|MANAGER|HR|ADMIN}_NAME    (tuỳ chọn, default tên hiển thị mặc định)
 *
 * Chạy:  node scripts/seed-staging-accounts.mjs   (sau khi nạp env — xem `m seed-staging`)
 * Exit:  0 = OK · ≠0 = cấu hình sai (fail-fast TRƯỚC mọi ghi DB) hoặc lỗi DB (ROLLBACK, KHÔNG ghi một phần).
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

// `@node-rs/argon2` (native) KHÔNG hoist lên node_modules gốc repo; `pg` có thể có hoặc không tuỳ hoist.
// Neo resolve vào apps/api (nơi cả hai là direct dep) theo VỊ TRÍ FILE — chạy được từ mọi cwd (CI / wrapper).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const apiRequire = createRequire(path.join(repoRoot, "apps", "api", "package.json"));
const pg = apiRequire("pg");
const { hash, Algorithm } = apiRequire("@node-rs/argon2");

const MIN_PASSWORD_LENGTH = 12;
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

// 4 SYSTEM role (company_id NULL) — resolve theo NAME lúc chạy, đối chiếu canonical id để chặn drift.
//   company-admin=0001 (mig 0005) · employee=0008 (mig 0005) · manager=0010 · hr=0011 (mig 0444).
const ACCOUNTS = [
  {
    key: "EMPLOYEE",
    roleName: "employee",
    roleId: "00000000-0000-0000-0000-000000000008",
    defaultName: "Staging Employee",
  },
  {
    key: "MANAGER",
    roleName: "manager",
    roleId: "00000000-0000-0000-0000-000000000010",
    defaultName: "Staging Manager",
  },
  {
    key: "HR",
    roleName: "hr",
    roleId: "00000000-0000-0000-0000-000000000011",
    defaultName: "Staging HR",
  },
  {
    key: "ADMIN",
    roleName: "company-admin",
    roleId: "00000000-0000-0000-0000-000000000001",
    defaultName: "Staging Company Admin",
  },
];

/** Parse + validate env TRƯỚC mọi kết nối/ghi DB. KHÔNG bao giờ log giá trị mật khẩu. */
function parseConfig() {
  const errors = [];

  const directUrl = process.env.SEED_DIRECT_URL ?? process.env.DATABASE_DIRECT_URL;
  if (!directUrl || !directUrl.trim()) {
    errors.push("thiếu SEED_DIRECT_URL hoặc DATABASE_DIRECT_URL (kết nối direct superuser :5432).");
  } else {
    // GUARD defense-in-depth (security-review 2026-07-11): blocklist DB prod `mediaos` NGAY TRONG script —
    // không dựa mỗi wrapper `m seed-staging` (PROD và UAT chung 1 cluster Postgres, chạy tay với .env
    // ambient trỏ prod là seed nhầm prod). Mirror blocklist của migrate-verify-ephemeral.sh.
    const dbName = directUrl.split("?")[0].split("/").pop();
    if (dbName === "mediaos") {
      errors.push(
        "GUARD: DB đích 'mediaos' là PROD — từ chối seed staging. Trỏ DATABASE_DIRECT_URL/SEED_DIRECT_URL sang mediaos_dev (hoặc DB cô lập).",
      );
    }
  }

  const companySlug = (process.env.STAGING_SEED_COMPANY_SLUG ?? "demo").trim();
  if (!companySlug) errors.push("STAGING_SEED_COMPANY_SLUG rỗng.");

  const accounts = ACCOUNTS.map((a) => {
    const email = (process.env[`STAGING_SEED_${a.key}_EMAIL`] ?? "").trim().toLowerCase();
    const password = process.env[`STAGING_SEED_${a.key}_PASSWORD`] ?? "";
    const name = (process.env[`STAGING_SEED_${a.key}_NAME`] ?? a.defaultName).trim();

    if (!email) {
      errors.push(`thiếu STAGING_SEED_${a.key}_EMAIL.`);
    }
    if (!password) {
      errors.push(`thiếu STAGING_SEED_${a.key}_PASSWORD.`);
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      errors.push(
        `STAGING_SEED_${a.key}_PASSWORD phải ≥${MIN_PASSWORD_LENGTH} ký tự (tài khoản quyền cao).`,
      );
    }
    return { ...a, email, password, name };
  });

  if (errors.length > 0) {
    console.error("[seed-staging] cấu hình KHÔNG hợp lệ — KHÔNG ghi DB, thoát:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  return { directUrl: directUrl.trim(), companySlug, accounts };
}

/** company theo slug — NOT NULL else fail (staging đã có tenant-root; script KHÔNG tạo company). */
async function resolveCompanyId(c, slug) {
  const r = await c.query(`SELECT id FROM companies WHERE slug = $1 AND deleted_at IS NULL`, [
    slug,
  ]);
  if (r.rowCount === 0) {
    throw new Error(
      `company slug='${slug}' KHÔNG tồn tại (chạy db:migrate + boot API tạo tenant-root TRƯỚC khi seed).`,
    );
  }
  return r.rows[0].id;
}

/** SYSTEM role theo NAME (company_id NULL). Đối chiếu canonical id để chặn drift/role trùng tên tenant. */
async function resolveSystemRoleId(c, account) {
  const r = await c.query(
    `SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL`,
    [account.roleName],
  );
  if (r.rowCount === 0) {
    throw new Error(`role hệ thống '${account.roleName}' KHÔNG tồn tại — migration chưa seed?`);
  }
  const id = r.rows[0].id;
  if (id !== account.roleId) {
    throw new Error(
      `role '${account.roleName}' id=${id} KHÔNG khớp canonical ${account.roleId} — nghi drift, dừng an toàn.`,
    );
  }
  return id;
}

/** UPSERT user theo (company_id, email). company_id TƯỜNG MINH ở INSERT. */
async function upsertUser(c, companyId, account, pwHash) {
  const existing = await c.query(`SELECT id FROM users WHERE company_id = $1 AND email = $2`, [
    companyId,
    account.email,
  ]);
  if (existing.rowCount === 0) {
    const userId = crypto.randomUUID();
    await c.query(
      `INSERT INTO users (id, company_id, email, password_hash, full_name, status, must_change_password)
       VALUES ($1, $2, $3, $4, $5, 'active', false)`,
      [userId, companyId, account.email, pwHash, account.name],
    );
    return { userId, created: true };
  }
  const userId = existing.rows[0].id;
  await c.query(
    `UPDATE users
        SET password_hash = $1, status = 'active', deleted_at = NULL,
            must_change_password = false, updated_at = now()
      WHERE id = $2`,
    [pwHash, userId],
  );
  return { userId, created: false };
}

/**
 * Gán role idempotent. SELECT-then-INSERT lọc deleted_at IS NULL (khớp partial index user_roles_active_uq,
 * mig 0471) — KHÔNG ON CONFLICT. company_id TƯỜNG MINH. granted_by = self (mirror seed-admin).
 */
async function ensureRoleGrant(c, userId, roleId, companyId) {
  const existing = await c.query(
    `SELECT id FROM user_roles
      WHERE user_id = $1 AND role_id = $2 AND company_id = $3 AND deleted_at IS NULL`,
    [userId, roleId, companyId],
  );
  if (existing.rowCount > 0) return false;
  await c.query(
    `INSERT INTO user_roles (user_id, role_id, company_id, granted_by) VALUES ($1, $2, $3, $1)`,
    [userId, roleId, companyId],
  );
  return true;
}

async function main() {
  const config = parseConfig(); // fail-fast TRƯỚC khi mở kết nối.

  const client = new pg.Client({ connectionString: config.directUrl });
  await client.connect();
  try {
    await client.query("BEGIN");

    const companyId = await resolveCompanyId(client, config.companySlug);

    for (const account of config.accounts) {
      const roleId = await resolveSystemRoleId(client, account);
      const pwHash = await hash(account.password, ARGON);
      const { userId, created } = await upsertUser(client, companyId, account, pwHash);
      const granted = await ensureRoleGrant(client, userId, roleId, companyId);
      console.log(
        `[seed-staging] ${account.roleName.padEnd(14)} ${account.email} ` +
          `(user ${created ? "created" : "reused"}, role ${granted ? "granted" : "kept"}).`,
      );
    }

    await client.query("COMMIT");

    // Xác minh nhanh (KHÔNG secret): mọi hàng seed thuộc đúng company_id đã resolve.
    const emails = config.accounts.map((a) => a.email);
    const uCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE company_id = $1 AND email = ANY($2::citext[])`,
      [companyId, emails],
    );
    const rCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM user_roles
        WHERE company_id = $1 AND deleted_at IS NULL AND user_id IN (
          SELECT id FROM users WHERE company_id = $1 AND email = ANY($2::citext[])
        )`,
      [companyId, emails],
    );
    console.log(
      `\n[seed-staging] HOÀN TẤT. company='${config.companySlug}' (${companyId}) — ` +
        `users=${uCount.rows[0].n}/4, active user_roles=${rCount.rows[0].n}. ` +
        `Đăng nhập bằng mật khẩu từ STAGING_SEED_*_PASSWORD.`,
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[seed-staging] thất bại:", err instanceof Error ? err.message : err);
  process.exit(1);
});

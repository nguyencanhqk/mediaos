/**
 * seed-admin.mjs — Seed tài khoản ADMIN cho 1 công ty (tham số hoá, idempotent). Dùng cho PROD/staging.
 *
 * KHÁC demo-seed-base.mjs (dev, hardcode company `demo` + admin@demo.local): file này đọc THÔNG SỐ từ env
 * nên tạo được admin cho domain thật. Thay cho *BootstrapService cũ (đã gỡ khi de-media-fy) — KHÔNG còn
 * seed-lúc-khởi-động; admin tạo TƯỜNG MINH qua script này (chạy SAU db:migrate).
 *
 * Tạo: company (nếu thiếu) + user admin (UPSERT) + gán role hệ thống `company-admin` (role 0001, do
 * migration 0005 seed → "Full non-sensitive management" + quyền nhạy cảm tích luỹ qua các migration).
 *
 * Biến môi trường:
 *   ADMIN_COMPANY_SLUG   (bắt buộc)  slug công ty, vd "funtime"
 *   ADMIN_COMPANY_NAME   (tuỳ chọn)  tên hiển thị công ty (default = slug)
 *   ADMIN_EMAIL          (bắt buộc)  email đăng nhập admin
 *   ADMIN_PASSWORD       (bắt buộc)  mật khẩu (≥12 ký tự — argon2id hash phía app, KHÔNG bao giờ log)
 *   ADMIN_NAME           (tuỳ chọn)  tên hiển thị admin (default "Administrator")
 *   SEED_DIRECT_URL | DATABASE_DIRECT_URL  (bắt buộc)  kết nối superuser/owner direct (:5432)
 *
 * Chạy:  node apps/api/seed-admin.mjs        (sau khi nạp .env vào môi trường — xem `m deploy-seed`)
 * Idempotent: chạy lại an toàn (reset mật khẩu admin, không nhân bản company/role).
 */
import crypto from "node:crypto";
import { hash, Algorithm } from "@node-rs/argon2";
import pg from "pg";

const ROLE_COMPANY_ADMIN = "00000000-0000-0000-0000-000000000001"; // migration 0005
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`[seed-admin] thiếu biến môi trường bắt buộc: ${name}`);
    process.exit(1);
  }
  return v.trim();
}

const DIRECT_URL = process.env.SEED_DIRECT_URL ?? process.env.DATABASE_DIRECT_URL;
if (!DIRECT_URL) {
  console.error(
    "[seed-admin] thiếu SEED_DIRECT_URL hoặc DATABASE_DIRECT_URL (kết nối direct :5432).",
  );
  process.exit(1);
}

const COMPANY_SLUG = required("ADMIN_COMPANY_SLUG");
const COMPANY_NAME = (process.env.ADMIN_COMPANY_NAME ?? COMPANY_SLUG).trim();
const ADMIN_EMAIL = required("ADMIN_EMAIL").toLowerCase();
const ADMIN_PASSWORD = required("ADMIN_PASSWORD");
const ADMIN_NAME = (process.env.ADMIN_NAME ?? "Administrator").trim();

if (ADMIN_PASSWORD.length < 12) {
  console.error("[seed-admin] ADMIN_PASSWORD phải ≥12 ký tự (tài khoản quyền cao).");
  process.exit(1);
}

async function main() {
  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ── Company ───────────────────────────────────────────────────────────────
    let companyId;
    const cExists = await c.query(`SELECT id FROM companies WHERE slug = $1`, [COMPANY_SLUG]);
    if (cExists.rowCount === 0) {
      companyId = crypto.randomUUID();
      await c.query(
        `INSERT INTO companies (id, slug, name, status) VALUES ($1, $2, $3, 'active')`,
        [companyId, COMPANY_SLUG, COMPANY_NAME],
      );
      console.log(`[seed-admin] tạo company '${COMPANY_SLUG}'.`);
    } else {
      companyId = cExists.rows[0].id;
      console.log(`[seed-admin] company '${COMPANY_SLUG}' đã tồn tại — dùng lại.`);
    }

    // ── Admin user (UPSERT theo company_id + email) ─────────────────────────────
    const pwHash = await hash(ADMIN_PASSWORD, ARGON);
    let userId;
    const uExists = await c.query(`SELECT id FROM users WHERE company_id = $1 AND email = $2`, [
      companyId,
      ADMIN_EMAIL,
    ]);
    if (uExists.rowCount === 0) {
      userId = crypto.randomUUID();
      await c.query(
        `INSERT INTO users (id, company_id, email, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, $5, 'active')`,
        [userId, companyId, ADMIN_EMAIL, pwHash, ADMIN_NAME],
      );
      console.log(`[seed-admin] tạo admin ${ADMIN_EMAIL}.`);
    } else {
      userId = uExists.rows[0].id;
      await c.query(
        `UPDATE users SET password_hash = $1, status = 'active', deleted_at = NULL WHERE id = $2`,
        [pwHash, userId],
      );
      console.log(`[seed-admin] admin ${ADMIN_EMAIL} đã có — reset mật khẩu + kích hoạt.`);
    }

    // ── Gán role company-admin (idempotent) ─────────────────────────────────────
    const rExists = await c.query(
      `SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2 AND company_id = $3`,
      [userId, ROLE_COMPANY_ADMIN, companyId],
    );
    if (rExists.rowCount === 0) {
      await c.query(
        `INSERT INTO user_roles (user_id, role_id, company_id, granted_by) VALUES ($1, $2, $3, $1)`,
        [userId, ROLE_COMPANY_ADMIN, companyId],
      );
      console.log("[seed-admin] gán role company-admin.");
    }

    await c.query("COMMIT");
    console.log(
      `\n[seed-admin] HOÀN TẤT. Login: companySlug=${COMPANY_SLUG}  email=${ADMIN_EMAIL}  (mật khẩu từ ADMIN_PASSWORD)`,
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error("[seed-admin] thất bại:", err instanceof Error ? err.message : err);
  process.exit(1);
});

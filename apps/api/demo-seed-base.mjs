/**
 * Seed GỐC cho công ty demo — tạo company `demo` + admin `admin@demo.local` (Admin@12345)
 * + gán role companyAdmin. PHẢI chạy TRƯỚC demo-seed-full.mjs (file đó giả định 2 thứ này đã có).
 *
 * Chạy:  node "c:/dev 2/MediaOS/apps/api/demo-seed-base.mjs"   (chạy từ apps/api để ESM resolve module).
 *   Hoặc qua dev/dev.bat option [5].
 *
 * Idempotent: chạy lại an toàn (reset mật khẩu admin về Admin@12345, không nhân bản).
 */
import pg from "pg";
import { hash, Algorithm } from "@node-rs/argon2";

const DIRECT_URL =
  process.env.SEED_DIRECT_URL ?? "postgres://mediaos:changeme_dev_only@localhost:5432/mediaos";

// Hằng PHẢI khớp demo-seed-full.mjs.
const COMPANY_ID = "401c90a0-dfea-4b0a-986c-4317b798cd7b";
const ADMIN_ID = "31348071-d4e2-4723-a66d-3322e4ce85aa";
const ROLE_COMPANY_ADMIN = "00000000-0000-0000-0000-000000000001";
const ADMIN_EMAIL = "admin@demo.local";
const ADMIN_PASSWORD = "Admin@12345";
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function main() {
  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  try {
    await c.query("BEGIN");

    // ── Company demo ──────────────────────────────────────────────────────────
    const cExists = await c.query(`SELECT id FROM companies WHERE id=$1 OR slug='demo'`, [COMPANY_ID]);
    if (cExists.rowCount === 0) {
      await c.query(
        `INSERT INTO companies (id, slug, name, status) VALUES ($1, 'demo', 'Demo Company', 'active')`,
        [COMPANY_ID],
      );
      console.log("[seed-base] tạo company demo.");
    } else {
      console.log("[seed-base] company demo đã tồn tại — bỏ qua.");
    }

    // ── Admin user ────────────────────────────────────────────────────────────
    const pwHash = await hash(ADMIN_PASSWORD, ARGON);
    const uExists = await c.query(
      `SELECT id FROM users WHERE id=$1 OR (company_id=$2 AND email=$3)`,
      [ADMIN_ID, COMPANY_ID, ADMIN_EMAIL],
    );
    if (uExists.rowCount === 0) {
      await c.query(
        `INSERT INTO users (id, company_id, email, password_hash, full_name, status)
         VALUES ($1, $2, $3, $4, 'Demo Admin', 'active')`,
        [ADMIN_ID, COMPANY_ID, ADMIN_EMAIL, pwHash],
      );
      console.log("[seed-base] tạo admin@demo.local (Admin@12345).");
    } else {
      await c.query(`UPDATE users SET password_hash=$1, status='active', deleted_at=NULL WHERE id=$2`, [
        pwHash,
        uExists.rows[0].id,
      ]);
      console.log("[seed-base] admin@demo.local đã có — reset mật khẩu về Admin@12345.");
    }

    // ── Role companyAdmin cho admin ───────────────────────────────────────────
    const rExists = await c.query(
      `SELECT 1 FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3`,
      [ADMIN_ID, ROLE_COMPANY_ADMIN, COMPANY_ID],
    );
    if (rExists.rowCount === 0) {
      await c.query(
        `INSERT INTO user_roles (user_id, role_id, company_id, granted_by) VALUES ($1, $2, $3, $1)`,
        [ADMIN_ID, ROLE_COMPANY_ADMIN, COMPANY_ID],
      );
      console.log("[seed-base] gán role companyAdmin cho admin.");
    }

    await c.query("COMMIT");
    console.log("\n[seed-base] HOÀN TẤT. Login: companySlug=demo  email=admin@demo.local  pass=Admin@12345");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
}

main().catch((err) => {
  console.error("[seed-base] thất bại:", err instanceof Error ? err.message : err);
  process.exit(1);
});

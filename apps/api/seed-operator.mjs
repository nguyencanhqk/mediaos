/**
 * seed-operator.mjs — tạo 1 platform-admin OPERATOR cho apps/admin (local demo).
 * Chạy TỪ apps/api: `node seed-operator.mjs` (ESM resolve @node-rs/argon2 + pg).
 *
 * - Upsert user operator@demo.local / Operator@12345 trong company demo.
 * - Gán role hệ thống platform-admin (…f0) → login issue aud=operator.
 * - Local demo: tắt requires_two_factor cho role f0 (né 2FA TOTP envelope-KMS).
 */
import { hash, Algorithm } from "@node-rs/argon2";
import pg from "pg";

const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const COMPANY_ID = "401c90a0-dfea-4b0a-986c-4317b798cd7b"; // company demo
const ROLE_F0 = "00000000-0000-0000-0000-0000000000f0"; // platform-admin (system role)
const EMAIL = "operator@demo.local";
const PASSWORD = "Operator@12345";
const NAME = "Operator Demo";

const url =
  process.env.DATABASE_DIRECT_URL ||
  "postgres://mediaos:changeme_dev_only@localhost:5432/mediaos";

const c = new pg.Client({ connectionString: url });

async function selId(sql, args) {
  const r = await c.query(sql, args);
  return r.rows[0]?.id ?? null;
}

async function main() {
  await c.connect();
  const pwHash = await hash(PASSWORD, ARGON);

  // 1. Upsert user
  let uid = await selId(
    `SELECT id FROM users WHERE company_id=$1 AND email=$2 AND deleted_at IS NULL`,
    [COMPANY_ID, EMAIL],
  );
  if (!uid) {
    uid = await selId(
      `INSERT INTO users (company_id,email,password_hash,full_name,status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [COMPANY_ID, EMAIL, pwHash, NAME],
    );
    console.log("created user", EMAIL, uid);
  } else {
    await c.query(`UPDATE users SET password_hash=$1, full_name=$2, status='active' WHERE id=$3`, [
      pwHash,
      NAME,
      uid,
    ]);
    console.log("updated user", EMAIL, uid);
  }

  // 2. Assign platform-admin role (…f0)
  const hasRole = await selId(`SELECT id FROM user_roles WHERE user_id=$1 AND role_id=$2`, [
    uid,
    ROLE_F0,
  ]);
  if (!hasRole) {
    await c.query(
      `INSERT INTO user_roles (user_id, role_id, company_id, granted_by)
       VALUES ($1,$2,$3,$1)`,
      [uid, ROLE_F0, COMPANY_ID],
    );
    console.log("granted platform-admin role …f0");
  } else {
    console.log("platform-admin role already granted");
  }

  // 3. Local demo: tắt 2FA cho role platform-admin (né TOTP envelope-KMS enrollment)
  const r = await c.query(
    `UPDATE roles SET requires_two_factor=false WHERE id=$1 AND requires_two_factor IS DISTINCT FROM false`,
    [ROLE_F0],
  );
  console.log(`role f0 requires_two_factor → false (rows: ${r.rowCount})`);

  console.log("\n=== OPERATOR LOGIN (apps/admin) ===");
  console.log("  email:    ", EMAIL);
  console.log("  password: ", PASSWORD);
  console.log("  company:  ", "demo (slug)");
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

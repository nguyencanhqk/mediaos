/**
 * import-hr-employees.mjs — nhập DANH SÁCH NHÂN VIÊN THẬT từ file JSON (HR export)
 * vào 1 company: org_units + positions + users (tài khoản đăng nhập) + employee_profiles + user_roles.
 *
 * Chạy TỪ apps/api (để ESM resolve được `pg` + `@node-rs/argon2`):
 *   SEED_DIRECT_URL=postgres://mediaos:...@localhost:5432/<db> node import-hr-employees.mjs \
 *     --data .secrets/funtime-employees.json --company-slug funtime \
 *     [--create-company --company-name "..."] \
 *     (--default-password "..." | --emit-passwords .secrets/passwords.csv) [--prod]
 *
 * Đặc tính:
 *   - IDEMPOTENT: SELECT-then-INSERT theo unique thật (company+code / company+email); chạy lại không nhân bản,
 *     KHÔNG bao giờ ghi đè password của user đã tồn tại.
 *   - Nhân viên `status:"resigned"` → user tạo ở trạng thái `locked` (không đăng nhập được, giữ tên + lịch sử).
 *   - User mới: must_change_password = true (ép đổi mật khẩu lần đầu — DB-10 §17.2).
 *   - An toàn: từ chối chạy vào database `mediaos` (PROD) nếu thiếu cờ --prod.
 *   - KHÔNG import lương/CCCD/địa chỉ/ngân hàng — chỉ danh bạ + tổ chức (PII nhạy cảm để HR nhập qua app).
 *
 * Không phải code sản phẩm — công cụ vận hành một-lần, cùng họ với seed-admin.mjs / demo-seed-full.mjs.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { hash, Algorithm } from "@node-rs/argon2";

// Params PHẢI khớp PasswordService (apps/api/src/auth/password.service.ts) để login verify được.
const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const ROLE_EMPLOYEE = "00000000-0000-0000-0000-000000000008";
const ROLE_COMPANY_ADMIN = "00000000-0000-0000-0000-000000000001";
const PROD_DB_NAME = "mediaos";

function parseArgs(argv) {
  const flags = { createCompany: false, prod: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data") flags.data = argv[++i];
    else if (a === "--company-slug") flags.companySlug = argv[++i];
    else if (a === "--company-name") flags.companyName = argv[++i];
    else if (a === "--create-company") flags.createCompany = true;
    else if (a === "--default-password") flags.defaultPassword = argv[++i];
    else if (a === "--emit-passwords") flags.emitPasswords = argv[++i];
    else if (a === "--prod") flags.prod = true;
    else throw new Error(`Tham số không hợp lệ: ${a}`);
  }
  if (!flags.data || !flags.companySlug)
    throw new Error("Bắt buộc: --data <file.json> --company-slug <slug>");
  if (!flags.defaultPassword && !flags.emitPasswords)
    throw new Error(
      "Phải chọn --default-password <pw> HOẶC --emit-passwords <file.csv> — nếu không, mật khẩu random sẽ không ai biết.",
    );
  return flags;
}

function genPassword() {
  // 12 ký tự base64url + hậu tố cố định đảm bảo đủ lớp ký tự; must_change_password ép đổi ngay lần đầu.
  return `${crypto.randomBytes(9).toString("base64url")}@Ft9`;
}

/** Kiểm tra chéo nội bộ file dữ liệu TRƯỚC khi chạm DB — fail loud, fail sớm. */
function validateData(data) {
  const errors = [];
  const unitCodes = new Set(data.orgUnits.map((u) => u.code));
  const posCodes = new Set(data.positions.map((p) => p.code));
  const empCodes = new Set();
  const emails = new Set();
  for (const u of data.orgUnits)
    if (u.parent && !unitCodes.has(u.parent))
      errors.push(`orgUnit ${u.code}: parent ${u.parent} không tồn tại`);
  for (const e of data.employees) {
    if (empCodes.has(e.code)) errors.push(`employee code trùng: ${e.code}`);
    empCodes.add(e.code);
    const email = e.email.toLowerCase();
    if (emails.has(email)) errors.push(`email trùng: ${email}`);
    emails.add(email);
    if (!unitCodes.has(e.unit)) errors.push(`employee ${e.code}: unit ${e.unit} không tồn tại`);
    if (e.position && !posCodes.has(e.position))
      errors.push(`employee ${e.code}: position ${e.position} không tồn tại`);
    if (!["active", "resigned"].includes(e.status))
      errors.push(`employee ${e.code}: status ${e.status} không hợp lệ`);
  }
  for (const e of data.employees)
    if (e.managerCode && !empCodes.has(e.managerCode))
      errors.push(`employee ${e.code}: managerCode ${e.managerCode} không có trong danh sách`);
  for (const u of data.orgUnits)
    if (u.headCode && !empCodes.has(u.headCode))
      errors.push(`orgUnit ${u.code}: headCode ${u.headCode} không có trong danh sách`);
  if (errors.length) throw new Error(`File dữ liệu lỗi:\n  - ${errors.join("\n  - ")}`);
}

async function selId(c, sql, params) {
  const r = await c.query(sql, params);
  return r.rows[0]?.id ?? null;
}

async function main() {
  const flags = parseArgs(process.argv);
  const DIRECT_URL = process.env.SEED_DIRECT_URL;
  if (!DIRECT_URL)
    throw new Error("Thiếu env SEED_DIRECT_URL (postgres://mediaos:...@localhost:5432/<db>)");

  const data = JSON.parse(fs.readFileSync(flags.data, "utf8"));
  validateData(data);

  const c = new pg.Client({ connectionString: DIRECT_URL });
  await c.connect();
  const summary = {
    unitsCreated: 0,
    positionsCreated: 0,
    usersCreated: 0,
    usersExisting: 0,
    usersLocked: 0,
    profilesCreated: 0,
    profilesSkipped: 0,
    rolesGranted: 0,
    managersWired: 0,
  };
  const newCredentials = []; // { code, email, password } — CHỈ ghi ra file khi --emit-passwords
  try {
    const dbName = (await c.query("SELECT current_database() AS db")).rows[0].db;
    if (dbName === PROD_DB_NAME && !flags.prod)
      throw new Error(
        `Đang trỏ vào database '${PROD_DB_NAME}' (PROD). Thêm cờ --prod nếu THẬT SỰ có chủ đích.`,
      );
    console.log(
      `→ database: ${dbName} | company-slug: ${flags.companySlug} | ${data.employees.length} nhân viên`,
    );

    await c.query("BEGIN");

    // ── COMPANY (resolve theo slug; --create-company mới được tạo) ────────────
    let companyId = await selId(
      c,
      `SELECT id FROM companies WHERE slug=$1 AND deleted_at IS NULL`,
      [flags.companySlug],
    );
    if (!companyId) {
      if (!flags.createCompany)
        throw new Error(
          `Company slug '${flags.companySlug}' không tồn tại (dùng --create-company nếu muốn tạo).`,
        );
      companyId = await selId(
        c,
        `INSERT INTO companies (slug, name, status) VALUES ($1,$2,'active') RETURNING id`,
        [flags.companySlug, flags.companyName ?? data.company?.name ?? flags.companySlug],
      );
      console.log(`  + company mới: ${flags.companySlug} (${companyId})`);
    }

    // Fail-loud: role hệ thống phải có sẵn (seed canonical qua migration).
    const roleOk = await selId(c, `SELECT id FROM roles WHERE id=$1`, [ROLE_EMPLOYEE]);
    if (!roleOk)
      throw new Error(`Role employee (${ROLE_EMPLOYEE}) chưa được seed — DB chưa migrate đủ?`);

    // granted_by = một company-admin sẵn có của company (nullable nếu chưa có).
    const grantedBy = await selId(
      c,
      `SELECT user_id AS id FROM user_roles WHERE company_id=$1 AND role_id=$2 LIMIT 1`,
      [companyId, ROLE_COMPANY_ADMIN],
    );

    // ── ORG UNITS (idempotent theo company+code) + wire parent ────────────────
    const unitId = {};
    for (const u of data.orgUnits) {
      let id = await selId(
        c,
        `SELECT id FROM org_units WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`,
        [companyId, u.code],
      );
      if (!id) {
        id = await selId(
          c,
          `INSERT INTO org_units (company_id,name,type,code,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
          [companyId, u.name, u.type, u.code],
        );
        summary.unitsCreated++;
      }
      unitId[u.code] = id;
    }
    for (const u of data.orgUnits)
      await c.query(`UPDATE org_units SET parent_id=$1 WHERE id=$2`, [
        u.parent ? unitId[u.parent] : null,
        unitId[u.code],
      ]);

    // ── POSITIONS (idempotent theo company+code) ──────────────────────────────
    const posId = {};
    for (const p of data.positions) {
      let id = await selId(
        c,
        `SELECT id FROM positions WHERE company_id=$1 AND code=$2 AND deleted_at IS NULL`,
        [companyId, p.code],
      );
      if (!id) {
        id = await selId(
          c,
          `INSERT INTO positions (company_id,name,code,level,status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
          [companyId, p.name, p.code, p.level],
        );
        summary.positionsCreated++;
      }
      posId[p.code] = id;
    }

    // ── USERS + EMPLOYEE_PROFILES + USER_ROLES ────────────────────────────────
    const userIdByEmpCode = {};
    for (const e of data.employees) {
      const email = e.email.toLowerCase();
      // email ở DB là citext → so sánh = đã case-insensitive.
      let uid = await selId(
        c,
        `SELECT id FROM users WHERE company_id=$1 AND email=$2 AND deleted_at IS NULL`,
        [companyId, email],
      );
      if (!uid) {
        const plain = flags.defaultPassword ?? genPassword();
        const pwHash = await hash(plain, ARGON);
        const isActive = e.status === "active";
        uid = await selId(
          c,
          `INSERT INTO users (company_id,email,password_hash,full_name,status,must_change_password,locked_at,locked_reason,created_by)
           VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8) RETURNING id`,
          [
            companyId,
            email,
            pwHash,
            e.name,
            isActive ? "active" : "locked",
            isActive ? null : e.endDate ? `${e.endDate}T00:00:00Z` : new Date().toISOString(),
            isActive ? null : "Đã nghỉ việc (import HR)",
            grantedBy,
          ],
        );
        summary.usersCreated++;
        if (!isActive) summary.usersLocked++;
        if (isActive && !flags.defaultPassword)
          newCredentials.push({ code: e.code, email, password: plain });
      } else {
        summary.usersExisting++;
        await c.query(`UPDATE users SET full_name=COALESCE(full_name,$1) WHERE id=$2`, [
          e.name,
          uid,
        ]);
      }
      userIdByEmpCode[e.code] = uid;

      // profile: unique (company+employee_code) VÀ (company+user_id) khi active — check cả hai rồi mới INSERT.
      const byCode = await selId(
        c,
        `SELECT id FROM employee_profiles WHERE company_id=$1 AND employee_code=$2 AND deleted_at IS NULL`,
        [companyId, e.code],
      );
      const byUser = await selId(
        c,
        `SELECT id FROM employee_profiles WHERE company_id=$1 AND user_id=$2 AND deleted_at IS NULL`,
        [companyId, uid],
      );
      if (byCode || byUser) {
        summary.profilesSkipped++;
      } else {
        await c.query(
          `INSERT INTO employee_profiles
             (company_id,user_id,employee_code,org_unit_id,position_id,employment_type,
              start_date,end_date,official_date,contract_type,phone,date_of_birth,gender,
              work_location,notes,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            companyId,
            uid,
            e.code,
            unitId[e.unit],
            e.position ? posId[e.position] : null,
            e.employmentType ?? "full_time",
            e.startDate,
            e.endDate,
            e.officialDate,
            e.contractType,
            e.phone,
            e.dob,
            e.gender,
            e.workLocation,
            e.note ?? null,
            e.status,
          ],
        );
        summary.profilesCreated++;
      }

      const hasRole = await selId(
        c,
        `SELECT id FROM user_roles WHERE user_id=$1 AND role_id=$2 AND company_id=$3`,
        [uid, ROLE_EMPLOYEE, companyId],
      );
      if (!hasRole) {
        await c.query(
          `INSERT INTO user_roles (user_id,role_id,company_id,granted_by) VALUES ($1,$2,$3,$4)`,
          [uid, ROLE_EMPLOYEE, companyId, grantedBy],
        );
        summary.rolesGranted++;
      }
    }

    // ── PASS 2: quản lý trực tiếp (theo managerCode file HR, KHÔNG suy diễn) ──
    for (const e of data.employees) {
      if (!e.managerCode) continue;
      await c.query(
        `UPDATE employee_profiles SET direct_manager_id=$1
          WHERE company_id=$2 AND employee_code=$3 AND deleted_at IS NULL`,
        [userIdByEmpCode[e.managerCode], companyId, e.code],
      );
      summary.managersWired++;
    }

    // ── PASS 3: trưởng đơn vị (headCode tường minh trong file) ────────────────
    for (const u of data.orgUnits) {
      if (!u.headCode) continue;
      await c.query(`UPDATE org_units SET head_user_id=$1 WHERE id=$2`, [
        userIdByEmpCode[u.headCode],
        unitId[u.code],
      ]);
    }

    await c.query("COMMIT");
    console.log("✓ COMMIT thành công.\n── Tổng kết ──");
    for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${v}`);

    if (flags.emitPasswords && newCredentials.length) {
      const csv =
        "employee_code,email,temp_password\n" +
        newCredentials.map((r) => `${r.code},${r.email},${r.password}`).join("\n") +
        "\n";
      fs.writeFileSync(flags.emitPasswords, csv, "utf8");
      console.log(
        `\n⚠ ${newCredentials.length} mật khẩu tạm ghi vào ${flags.emitPasswords} — PHÁT CHO NHÂN VIÊN rồi XÓA file. must_change_password=true nên hệ thống ép đổi ngay lần đầu.`,
      );
    } else if (flags.defaultPassword) {
      console.log(
        `\n⚠ Mọi user MỚI dùng chung mật khẩu tạm (--default-password) + must_change_password=true.`,
      );
    }

    // Đếm kiểm chứng cuối (đọc lại từ DB, không tin bộ đếm).
    const checks = [
      [
        "org_units",
        `SELECT count(*)::int AS n FROM org_units WHERE company_id=$1 AND deleted_at IS NULL`,
      ],
      [
        "positions",
        `SELECT count(*)::int AS n FROM positions WHERE company_id=$1 AND deleted_at IS NULL`,
      ],
      [
        "users active",
        `SELECT count(*)::int AS n FROM users WHERE company_id=$1 AND status='active' AND deleted_at IS NULL`,
      ],
      [
        "users locked",
        `SELECT count(*)::int AS n FROM users WHERE company_id=$1 AND status='locked' AND deleted_at IS NULL`,
      ],
      [
        "employee_profiles",
        `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id=$1 AND deleted_at IS NULL`,
      ],
      [
        "profiles resigned",
        `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id=$1 AND status='resigned' AND deleted_at IS NULL`,
      ],
      ["user_roles", `SELECT count(*)::int AS n FROM user_roles WHERE company_id=$1`],
      [
        "managers set",
        `SELECT count(*)::int AS n FROM employee_profiles WHERE company_id=$1 AND direct_manager_id IS NOT NULL AND deleted_at IS NULL`,
      ],
    ];
    console.log("\n── Đếm lại từ DB ──");
    for (const [label, sql] of checks) {
      const r = await c.query(sql, [companyId]);
      console.log(`  ${label.padEnd(20)} ${r.rows[0].n}`);
    }
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error("✗ IMPORT LỖI:", e.message);
  process.exit(1);
});

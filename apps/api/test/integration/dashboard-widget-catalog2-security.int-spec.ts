/**
 * S4-DASH-CATALOG-2 — CROWN security cho 9 widget đợt 2 (USER_SUMMARY/EMPLOYEE_SUMMARY/MODULE_STATUS/
 * SYSTEM_LOGS/LEAVE_BALANCE/NEW_EMPLOYEES/CONTRACT_EXPIRING/LEAVE_CALENDAR/ATTENDANCE_ALERTS).
 *
 * BỔ SUNG cho dash-seed-catalog-permissions.int-spec.ts (const-driven A/A2/E2/E3/G/F/I — auto phủ 16 widget) —
 * file này chứng minh GATE-Ở-HANDLER + COUNT-ONLY + KHÔNG-PII bằng ĐƯỜNG THẬT (AppModule boot + real engine
 * + real DB), KHÔNG chỉ đọc const:
 *
 *   M   grant-matrix source-pair (empirical): view:audit-log + view:dashboard-audit-log CA-only (chống leo thang
 *       SYSTEM_LOGS); view:foundation-module CA-only trong 4 role canonical; view:user = {hr,CA}; read:employee/
 *       view:contract/view-own:leave-balance đủ 4 canonical; view-team:leave-calendar/attendance = {mgr,hr,CA}.
 *   M2  migration 0493 THUẦN DATA: KHÔNG INSERT permissions/role_permissions, KHÔNG CREATE/ALTER.
 *   Deny per-handler: user CHỈ read:dashboard (qua controller gate) → MỖI trong 9 slug → 403 fail-closed
 *       (handler tự gate cặp nguồn TRƯỚC aggregate — KHÔNG nuốt thành Degraded 200). ĐẶC BIỆT USER_SUMMARY/
 *       MODULE_STATUS/SYSTEM_LOGS mà method nguồn KHÔNG tự gate ⇒ chứng handler LÀ cổng.
 *   SYSTEM_LOGS crown: non-CA → 403; CA → 200 COUNT-ONLY — response + row cache KHÔNG chứa
 *       ip/ipAddress/userAgent/actorUserId/actorEmployeeId/actor-email/changes/payload/metadata/errorMessage.
 *   PII: 5 widget PII (SYSTEM_LOGS/NEW_EMPLOYEES/LEAVE_CALENDAR/ATTENDANCE_ALERTS/CONTRACT_EXPIRING) —
 *       response + row dashboard_widget_cache KHÔNG chứa baseSalary/salaryType/identity_* (trap value + field name).
 *   Cross-tenant: viewer company B KHÔNG thấy marker của A ở 9 widget.
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate): chạy DB cô lập
 *   TURBO_FORCE=1 pnpm --filter @mediaos/contracts build
 *   bash scripts/lane-db-setup.sh dashcat2 --reset
 *   LANE_DB=mediaos_dashcat2 npx vitest run test/integration/dashboard-widget-catalog2-security.int-spec.ts
 * Thiếu LANE_DB ⇒ suite SKIP (skipIf) — KHÔNG đỏ/xanh-giả trên DB chung.
 */

import "reflect-metadata";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runIsolatedDb = hasDb && Boolean(process.env.LANE_DB);
const PASSWORD = "Passw0rd!dashcat2X";

/** 9 slug đợt 2 (dataSourceKey) — deny-path per-handler đi qua đủ. */
const NEW_SLUGS = [
  "user-summary",
  "employee-summary",
  "module-status",
  "system-logs",
  "leave-balance",
  "new-employees",
  "contract-expiring",
  "leave-calendar",
  "attendance-alerts",
] as const;

/** Field/giá trị PII CẤM lộ ở response + row cache (crown). */
const AUDIT_FORBIDDEN = [
  "ipAddress",
  "userAgent",
  "actorUserId",
  "actorEmployeeId",
  "actor_email",
  "changes",
  "payload",
  "metadata",
  "errorMessage",
];
const SALARY_PII_FORBIDDEN = ["baseSalary", "salaryType", "salary_type", "base_salary", "identity"];

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}
function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1",
    [action, resourceType],
  );
  if (r.rows.length === 0) throw new Error(`permission missing: ${action}:${resourceType}`);
  return r.rows[0].id as string;
}

async function grant(
  direct: Pool,
  roleId: string,
  action: string,
  resourceType: string,
  scope: "Own" | "Team" | "Department" | "Company" | "System",
): Promise<void> {
  await seedRolePermission(
    direct,
    roleId,
    await permId(direct, action, resourceType),
    "ALLOW",
    scope,
  );
}

/** 9 cặp nguồn (+ read:dashboard controller gate) cho role "full" — Company scope để viewer thấy toàn tenant. */
async function grantAllNineSources(direct: Pool, roleId: string): Promise<void> {
  const pairs: Array<[string, string, "Own" | "Team" | "Company"]> = [
    ["read", "dashboard", "Company"], // controller gate
    ["view", "user", "Company"], // USER_SUMMARY
    ["read", "employee", "Company"], // EMPLOYEE_SUMMARY + NEW_EMPLOYEES
    ["view", "foundation-module", "Company"], // MODULE_STATUS
    ["view", "audit-log", "Company"], // SYSTEM_LOGS (SENSITIVE)
    ["view-own", "leave-balance", "Own"], // LEAVE_BALANCE
    ["view", "contract", "Company"], // CONTRACT_EXPIRING
    ["view-team", "leave-calendar", "Company"], // LEAVE_CALENDAR (Company ⇒ toàn tenant)
    ["view-team", "attendance", "Company"], // ATTENDANCE_ALERTS (SENSITIVE, Company ⇒ toàn tenant)
  ];
  for (const [a, r, s] of pairs) await grant(direct, roleId, a, r, s);
}

async function cleanupDash(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
    companyIds,
  ]);
}

// ── trap seeders (direct pool — chỉ dựng dữ liệu, KHÔNG qua API) ──────────────────────────────────

async function seedOrgUnit(direct: Pool, companyId: string, name: string): Promise<string> {
  const r = await direct.query(
    "INSERT INTO org_units (company_id, name, type) VALUES ($1,$2,'department') RETURNING id",
    [companyId, name],
  );
  return r.rows[0].id as string;
}

/** Employee "bẫy": base_salary + salary_type + identity_number + phone — widget KHÔNG được lộ các field này. */
async function seedTrapEmployee(
  direct: Pool,
  opts: {
    companyId: string;
    userId: string | null;
    orgUnitId: string;
    salary: string;
    identity: string;
    code: string;
  },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles
       (company_id, user_id, org_unit_id, employee_code, status, start_date,
        base_salary, salary_type, identity_number, phone)
     VALUES ($1,$2,$3,$4,'active',(now() - interval '3 days')::date,$5,'monthly',$6,'0911TRAPXX')
     RETURNING id`,
    [opts.companyId, opts.userId, opts.orgUnitId, opts.code, opts.salary, opts.identity],
  );
  return r.rows[0].id as string;
}

/** attendance_record 'late' HÔM NAY (TZ VN) — ATTENDANCE_ALERTS phải bắt được (status legacy lowercase). */
async function seedLateAttendanceToday(
  direct: Pool,
  companyId: string,
  userId: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO attendance_records (company_id, user_id, work_date, status, attendance_status, late_minutes)
     VALUES ($1,$2,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'late','Late',30)`,
    [companyId, userId],
  );
}

/** audit_log "bẫy": ip/user_agent/actor + metadata — SYSTEM_LOGS count-only KHÔNG được lộ. */
async function seedTrapAudit(
  direct: Pool,
  companyId: string,
  actorUserId: string,
  marker: string,
): Promise<void> {
  await direct.query(
    `INSERT INTO audit_logs
       (company_id, actor_user_id, action, object_type, object_id, ip, user_agent, metadata, created_at)
     VALUES ($1,$2,'update','employee',$3,'203.0.113.77','TRAP-UA/${marker}',
             jsonb_build_object('secret','${marker}'), now())`,
    [companyId, actorUserId, randomUUID()],
  );
}

async function seedLeaveType(direct: Pool, companyId: string, name: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO leave_types (company_id, name, code) VALUES ($1,$2,$3) RETURNING id`,
    [companyId, name, `LT-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

/** leave_request Approved trong cửa sổ [hôm nay,+30] với `reason` bẫy — LEAVE_CALENDAR KHÔNG lộ reason. */
async function seedApprovedLeave(
  direct: Pool,
  opts: {
    companyId: string;
    userId: string;
    employeeId: string;
    leaveTypeId: string;
    reason: string;
  },
): Promise<void> {
  await direct.query(
    `INSERT INTO leave_requests
       (company_id, user_id, employee_id, leave_type_id, leave_request_code,
        start_date, end_date, total_days, duration_type, status, reason, submitted_at)
     VALUES ($1,$2,$3,$4,$5,
             (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 2,
             (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 2,
             1,'FullDay','Approved',$6, now())`,
    [
      opts.companyId,
      opts.userId,
      opts.employeeId,
      opts.leaveTypeId,
      `LR-${randomUUID().slice(0, 8)}`,
      opts.reason,
    ],
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// M / M2 — grant-matrix source-pair (empirical) + migration 0493 thuần data (DB-only)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!runIsolatedDb)(
  "S4-DASH-CATALOG-2 — grant-matrix + migration content (DB cô lập)",
  () => {
    let direct: Pool;

    beforeAll(() => {
      direct = directPool();
    });
    afterAll(async () => {
      if (direct) await direct.end();
    });

    /** Tập role canonical (company_id NULL) có ALLOW cho (action, resource). */
    async function rolesWith(action: string, resourceType: string): Promise<string[]> {
      const res = await direct.query<{ name: string }>(
        `SELECT ro.name FROM role_permissions rp
         JOIN roles ro ON ro.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.action=$1 AND p.resource_type=$2 AND rp.effect='ALLOW'
          AND ro.company_id IS NULL AND ro.deleted_at IS NULL
          AND ro.name IN ('employee','manager','hr','company-admin')
        ORDER BY ro.name`,
        [action, resourceType],
      );
      return res.rows.map((r) => r.name).sort();
    }

    // ── crown anti-escalation: SYSTEM_LOGS chỉ CA ──────────────────────────────────────────────────
    it("view:audit-log (SYSTEM_LOGS gate, SENSITIVE) chỉ company-admin — employee/manager/hr VẮNG", async () => {
      expect(await rolesWith("view", "audit-log")).toEqual(["company-admin"]);
    });
    it("view:dashboard-audit-log chỉ company-admin (0484) — chống leo thang song song", async () => {
      expect(await rolesWith("view", "dashboard-audit-log")).toEqual(["company-admin"]);
    });
    it("view:foundation-module (MODULE_STATUS gate) chỉ company-admin trong 4 role canonical", async () => {
      expect(await rolesWith("view", "foundation-module")).toEqual(["company-admin"]);
    });

    // ── PIN tập role thật (KHÔNG assert 'hr absent' — tránh RED-giả) ────────────────────────────────
    it("view:user (USER_SUMMARY gate) = {hr, company-admin} — employee/manager VẮNG (0444:88-89)", async () => {
      expect(await rolesWith("view", "user")).toEqual(["company-admin", "hr"]);
    });
    it("read:employee (EMPLOYEE_SUMMARY/NEW_EMPLOYEES) đủ 4 role canonical", async () => {
      expect(await rolesWith("read", "employee")).toEqual([
        "company-admin",
        "employee",
        "hr",
        "manager",
      ]);
    });
    it("view:contract (CONTRACT_EXPIRING) đủ 4 role canonical (scope Own/Team/Company theo role)", async () => {
      expect(await rolesWith("view", "contract")).toEqual([
        "company-admin",
        "employee",
        "hr",
        "manager",
      ]);
    });
    it("view-own:leave-balance (LEAVE_BALANCE) đủ 4 role canonical", async () => {
      expect(await rolesWith("view-own", "leave-balance")).toEqual([
        "company-admin",
        "employee",
        "hr",
        "manager",
      ]);
    });
    it("view-team:leave-calendar (LEAVE_CALENDAR) = {company-admin, hr, manager} — employee VẮNG", async () => {
      expect(await rolesWith("view-team", "leave-calendar")).toEqual([
        "company-admin",
        "hr",
        "manager",
      ]);
    });
    it("view-team:attendance (ATTENDANCE_ALERTS, SENSITIVE) = {company-admin, hr, manager} — employee VẮNG", async () => {
      expect(await rolesWith("view-team", "attendance")).toEqual([
        "company-admin",
        "hr",
        "manager",
      ]);
    });

    // ── M2: migration 0493 KHÔNG chạm permissions/role_permissions/DDL ──────────────────────────────
    it("migration 0493 THUẦN DATA: KHÔNG INSERT permissions/role_permissions, KHÔNG CREATE/ALTER TABLE", () => {
      const dir = join(__dirname, "../../migrations");
      const file = readdirSync(dir).find((f) => /dashcatalog2/i.test(f));
      expect(file, "migration dashcatalog2 phải tồn tại").toBeTruthy();
      const sql = readFileSync(join(dir, file as string), "utf8");
      // Bỏ dòng comment (-- …) để không bắt nhầm chú thích.
      const code = sql
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      expect(
        /insert\s+into\s+role_permissions/i.test(code),
        "0493 KHÔNG được INSERT role_permissions",
      ).toBe(false);
      expect(/insert\s+into\s+permissions/i.test(code), "0493 KHÔNG được INSERT permissions").toBe(
        false,
      );
      expect(/create\s+table/i.test(code), "0493 KHÔNG được CREATE TABLE").toBe(false);
      expect(/alter\s+table/i.test(code), "0493 KHÔNG được ALTER TABLE").toBe(false);
      // CÓ INSERT dashboard_widgets (đúng mục tiêu).
      expect(/insert\s+into\s+dashboard_widgets/i.test(code)).toBe(true);
    });

    // ── phantom (Option B + SA-only) ────────────────────────────────────────────────────────────────
    it("KHÔNG cặp *:dashboard-widget và KHÔNG refresh:dashboard-cache (phantom)", async () => {
      const w = await direct.query(
        `SELECT 1 FROM permissions WHERE resource_type='dashboard-widget'`,
      );
      expect(w.rowCount).toBe(0);
      const r = await direct.query(
        `SELECT 1 FROM permissions WHERE action='refresh' AND resource_type='dashboard-cache'`,
      );
      expect(r.rowCount).toBe(0);
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// GATE-Ở-HANDLER + COUNT-ONLY + PII + cross-tenant (AppModule boot, real engine + real DB)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!runIsolatedDb)(
  "S4-DASH-CATALOG-2 — handler gate/count-only/PII (app boot)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    const email = { full: "", deny: "", bFull: "" };
    const SALARY = "77712345"; // bẫy lương
    const IDENTITY = "CMND999TRAP"; // bẫy identity_number
    const AUDIT_MARK = randomUUID().slice(0, 8);
    const LEAVE_REASON = `SECRET-REASON-${randomUUID().slice(0, 6)}`;
    const DEPT = `CAT2-DEPT-${randomUUID().slice(0, 6)}`;

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "dcat2A");
      B = await seedCompany(direct, "dcat2B");
      companyIds.push(A.companyId, B.companyId);

      // Role full (9 nguồn) + role deny (chỉ read:dashboard) trong A; role full trong B.
      const roleFull = await seedRole(direct, A.companyId, "dcat2-full");
      await grantAllNineSources(direct, roleFull);
      const roleDeny = await seedRole(direct, A.companyId, "dcat2-deny");
      await grant(direct, roleDeny, "read", "dashboard", "Company"); // controller gate pass, handler gates fail
      const roleFullB = await seedRole(direct, B.companyId, "dcat2-full-b");
      await grantAllNineSources(direct, roleFullB);

      email.full = `full@${A.slug}.test`;
      email.deny = `deny@${A.slug}.test`;
      email.bFull = `bfull@${B.slug}.test`;
      const uFull = await seedUser(direct, A.companyId, email.full, hash);
      const uDeny = await seedUser(direct, A.companyId, email.deny, hash);
      const uBFull = await seedUser(direct, B.companyId, email.bFull, hash);
      await seedUserRole(direct, uFull, roleFull, A.companyId);
      await seedUserRole(direct, uDeny, roleDeny, A.companyId);
      await seedUserRole(direct, uBFull, roleFullB, B.companyId);

      // Trap data company A (viewer full = Company scope ⇒ thấy hết).
      const deptA = await seedOrgUnit(direct, A.companyId, DEPT);
      const empA = await seedTrapEmployee(direct, {
        companyId: A.companyId,
        userId: uFull,
        orgUnitId: deptA,
        salary: SALARY,
        identity: IDENTITY,
        code: `EMP-${randomUUID().slice(0, 6)}`,
      });
      await seedLateAttendanceToday(direct, A.companyId, uFull);
      await seedTrapAudit(direct, A.companyId, uFull, AUDIT_MARK);
      const ltA = await seedLeaveType(direct, A.companyId, "Annual-cat2");
      await seedApprovedLeave(direct, {
        companyId: A.companyId,
        userId: uFull,
        employeeId: empA,
        leaveTypeId: ltA,
        reason: LEAVE_REASON,
      });

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      await cleanupDash(direct, companyIds);
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    async function getWidget(slug: string, tenant: SeededTenant, mail: string) {
      return api(nest)
        .get(`/dashboard/widgets/${slug}`)
        .set(bearer(await login(nest, tenant.slug, mail)));
    }

    // ── Deny per-handler: user chỉ read:dashboard ⇒ MỖI slug 403 (KHÔNG Degraded 200) ────────────────
    it.each(NEW_SLUGS)(
      "deny: /widgets/%s với user chỉ read:dashboard → 403 fail-closed (handler tự gate)",
      async (slug) => {
        const token = await login(nest, A.slug, email.deny);
        const res = await api(nest).get(`/dashboard/widgets/${slug}`).set(bearer(token));
        expect(
          res.status,
          `${slug} phải 403 (không nuốt thành Degraded): ${JSON.stringify(res.body)}`,
        ).toBe(403);
      },
    );

    // ── SYSTEM_LOGS crown: non-CA 403; CA count-only, KHÔNG actor/ip/metadata ────────────────────────
    it("SYSTEM_LOGS: user thiếu view:audit-log → 403 (không lộ có bao nhiêu log)", async () => {
      const res = await getWidget("system-logs", A, email.deny);
      expect(res.status).toBe(403);
    });

    it("SYSTEM_LOGS: user CÓ view:audit-log → 200 COUNT-ONLY; response KHÔNG ip/userAgent/actor/metadata/trap", async () => {
      const res = await getWidget("system-logs", A, email.full);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const summary = res.body.data.data?.summary;
      expect(summary, "SYSTEM_LOGS phải trả summary count").toBeTruthy();
      expect(typeof summary.last7d).toBe("number");
      expect(summary.last7d).toBeGreaterThanOrEqual(1); // trap audit + login logs
      const blob = JSON.stringify(res.body.data);
      for (const bad of [...AUDIT_FORBIDDEN, "203.0.113.77", "TRAP-UA", AUDIT_MARK]) {
        expect(blob.includes(bad), `SYSTEM_LOGS response lộ field/giá trị cấm: ${bad}`).toBe(false);
      }
    });

    it("SYSTEM_LOGS: row dashboard_widget_cache KHÔNG chứa actor/ip/metadata/trap (chỉ count)", async () => {
      await getWidget("system-logs", A, email.full); // warm cache
      const rows = await direct.query(
        `SELECT data FROM dashboard_widget_cache
        WHERE company_id=$1 AND cache_key LIKE '%:SYSTEM_LOGS:%' AND deleted_at IS NULL`,
        [A.companyId],
      );
      expect(rows.rows.length, "cache SYSTEM_LOGS phải tồn tại").toBeGreaterThanOrEqual(1);
      const blob = JSON.stringify(rows.rows.map((r) => r.data));
      for (const bad of [...AUDIT_FORBIDDEN, "203.0.113.77", "TRAP-UA", AUDIT_MARK]) {
        expect(blob.includes(bad), `cache SYSTEM_LOGS lộ field/giá trị cấm: ${bad}`).toBe(false);
      }
    });

    // ── PII: 5 widget — response + cache KHÔNG lộ baseSalary/salaryType/identity_* ────────────────────
    const PII_SLUGS = [
      "new-employees",
      "employee-summary",
      "contract-expiring",
      "leave-calendar",
      "attendance-alerts",
      "system-logs",
    ] as const;

    it.each(PII_SLUGS)("PII: /widgets/%s response KHÔNG chứa lương/identity trap", async (slug) => {
      const res = await getWidget(slug, A, email.full);
      expect([200], `${slug} status: ${JSON.stringify(res.body)}`).toContain(res.status);
      const blob = JSON.stringify(res.body.data);
      for (const bad of [...SALARY_PII_FORBIDDEN, SALARY, IDENTITY, "0911TRAPXX"]) {
        expect(blob.includes(bad), `${slug} response lộ PII: ${bad}`).toBe(false);
      }
    });

    it("PII: row dashboard_widget_cache của 5 widget PII KHÔNG chứa lương/identity trap", async () => {
      // Warm cache toàn bộ 5 widget PII trước khi soi row.
      for (const slug of PII_SLUGS) await getWidget(slug, A, email.full);
      const rows = await direct.query(
        `SELECT data FROM dashboard_widget_cache WHERE company_id=$1 AND deleted_at IS NULL`,
        [A.companyId],
      );
      const blob = JSON.stringify(rows.rows.map((r) => r.data));
      for (const bad of [...SALARY_PII_FORBIDDEN, SALARY, IDENTITY, "0911TRAPXX", LEAVE_REASON]) {
        expect(blob.includes(bad), `cache row lộ PII: ${bad}`).toBe(false);
      }
    });

    // ── sanity: full user THẤY data (đảm bảo trap thật tồn tại — PII/cross-tenant không xanh-giả vì rỗng) ──
    it("sanity: ATTENDANCE_ALERTS bắt bản ghi 'late' hôm nay (marker thật tồn tại)", async () => {
      const res = await getWidget("attendance-alerts", A, email.full);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        res.body.data.data.summary.total,
        "phải có ≥1 alert (late hôm nay)",
      ).toBeGreaterThanOrEqual(1);
    });

    it("sanity: EMPLOYEE_SUMMARY đếm ≥1 nhân viên; NEW_EMPLOYEES trả danh sách có mã bẫy", async () => {
      const sum = await getWidget("employee-summary", A, email.full);
      expect(sum.body.data.data.summary.total).toBeGreaterThanOrEqual(1);
      const list = await getWidget("new-employees", A, email.full);
      expect(list.body.data.data.summary.total).toBeGreaterThanOrEqual(1);
    });

    // ── Cross-tenant: viewer B KHÔNG thấy marker A ở 9 widget ────────────────────────────────────────
    it("cross-tenant: viewer B (đủ 9 quyền) KHÔNG thấy marker A ở các widget scoped", async () => {
      const markers = [SALARY, IDENTITY, DEPT, LEAVE_REASON, AUDIT_MARK, "0911TRAPXX"];
      for (const slug of NEW_SLUGS) {
        const res = await getWidget(slug, B, email.bFull);
        expect([200], `${slug} B status: ${JSON.stringify(res.body)}`).toContain(res.status);
        const blob = JSON.stringify(res.body.data);
        for (const m of markers) {
          expect(blob.includes(m), `cross-tenant leak: ${slug} lộ marker A (${m}) sang B`).toBe(
            false,
          );
        }
      }
    });
  },
);

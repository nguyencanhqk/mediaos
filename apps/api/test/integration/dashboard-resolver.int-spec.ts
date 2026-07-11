/**
 * S4-DASH-BE-1 — Dashboard resolver + widget registry (HTTP, real permission engine + real DB).
 * Cửa: /dashboard/me · /dashboard/types · /dashboard/{employee|manager|hr|admin} (API-08 §10.1, 4 route TĨNH).
 *
 * RED-first — deny-path đi đầu (§7 plan docs/plans/S4-DASH-BE-1.md):
 *   M1 no-role → 403 mọi route.  M2 employee-only widget set + /me + /types.  M3 manager-only.
 *   M4 hr thứ-tự-ưu-tiên (Admin>HR>Manager).  M5 admin đủ 4.  M6 cross-tenant RLS.
 *   M7 DASHBOARD_NOT_RESOLVED (uploader).  M8 limit.  M9 PROJECT_PROGRESS vắng mặt.
 *   M10 gate tầng-2 CÙNG-TENANT hai chiều (crown data-scope).
 *
 * ⚠ SAI LỆCH PLAN vs DB THẬT (đã probe mediaos_dashbe1, chống "reviewer pass real bug"):
 *   (a) role `employee` THỰC SỰ CÓ `read:employee` (blanket seed) ⇒ HR_OVERVIEW (gate=read:employee) KHÔNG
 *       phân biệt được employee/hr. M10 vì thế dùng PENDING_LEAVE (gate=view:leave): employee KHÔNG có
 *       view:leave, hr CÓ — vẫn chứng đúng tầng-2 gate HAI CHIỀU mà plan §7-M10 nhắm tới.
 *   (b) role `hr` CÓ view-employee:dashboard (DASH_GRANT_MATRIX) ⇒ /types của hr trả 3 type
 *       (Employee/Manager/HR), KHÔNG phải 2 như plan M4 viết. Assert 3, is_default=HR.
 *
 * Gate hasDb && LANE_DB (memory integration-test-lane-db-gate): .env trỏ DB dev chung (hasDb=true) → CHỈ
 * chạy trên DB cô lập lane, nếu không sẽ đỏ-giả/xanh-giả.
 */

import "reflect-metadata";
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
import { DASH_DEFAULT_CONFIG } from "../../src/dashboard/dashboard-widget-catalog.const";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** widget_code[] từ response (envelope → data.widgets[].widget_code). */
function widgetCodes(body: { data: { widgets: Array<{ widget_code: string }> } }): string[] {
  return body.data.widgets.map((w) => w.widget_code);
}

/** widget_id GLOBAL (company_id NULL) theo widget_code — mig 0484 đã seed catalog toàn cục. */
async function globalWidgetId(direct: Pool, widgetCode: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM dashboard_widgets WHERE widget_code = $1 AND company_id IS NULL AND deleted_at IS NULL",
    [widgetCode],
  );
  if (r.rows.length === 0) {
    throw new Error(
      `[S4-DASH-BE-1] global widget '${widgetCode}' không tồn tại — mig 0484 phải chạy trước`,
    );
  }
  return r.rows[0].id as string;
}

/** Plant 1 config Company-scope cho company (direct pool, bypass RLS) — mô phỏng DashboardConfigSeeder. */
async function seedConfig(
  direct: Pool,
  companyId: string,
  dashboardType: string,
  widgetCode: string,
  sortOrder: number,
  isEnabled = true,
): Promise<void> {
  const widgetId = await globalWidgetId(direct, widgetCode);
  await direct.query(
    `INSERT INTO dashboard_widget_configs
       (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
     VALUES ($1, $2, $3, 'Company', NULL, NULL, $4, $5)`,
    [companyId, widgetId, dashboardType, isEnabled, sortOrder],
  );
}

/** Seed toàn bộ DASH_DEFAULT_CONFIG cho 1 company (seedCompany qua direct pool KHÔNG chạy runtime seeder). */
async function seedDefaultConfigs(direct: Pool, companyId: string): Promise<void> {
  for (const e of DASH_DEFAULT_CONFIG) {
    await seedConfig(direct, companyId, e.dashboardType, e.widgetCode, e.sortOrder);
  }
}

async function canonicalRoleId(direct: Pool, name: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
    [name],
  );
  if (r.rows.length === 0) {
    throw new Error(
      `[S4-DASH-BE-1] canonical role không tồn tại: ${name} (mig 0005/0444 phải chạy trước)`,
    );
  }
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)("S4-DASH-BE-1 Dashboard resolver + widget registry (HTTP)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  const email = {
    noRole: "",
    emp: "",
    mgr: "",
    hr: "",
    admin: "",
    uploader: "",
    bEmp: "",
  };

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "dashbe1a");
    B = await seedCompany(direct, "dashbe1b");
    companyIds.push(A.companyId, B.companyId);

    const roleEmp = await canonicalRoleId(direct, "employee");
    const roleMgr = await canonicalRoleId(direct, "manager");
    const roleHr = await canonicalRoleId(direct, "hr");
    const roleAdmin = await canonicalRoleId(direct, "company-admin");
    const roleUploader = await canonicalRoleId(direct, "uploader");

    email.noRole = `norole@${A.slug}.test`;
    email.emp = `emp@${A.slug}.test`;
    email.mgr = `mgr@${A.slug}.test`;
    email.hr = `hr@${A.slug}.test`;
    email.admin = `admin@${A.slug}.test`;
    email.uploader = `uploader@${A.slug}.test`;
    email.bEmp = `emp@${B.slug}.test`;

    const uNoRole = await seedUser(direct, A.companyId, email.noRole, hash);
    void uNoRole; // KHÔNG gán role — deny-path M1
    const uEmp = await seedUser(direct, A.companyId, email.emp, hash);
    const uMgr = await seedUser(direct, A.companyId, email.mgr, hash);
    const uHr = await seedUser(direct, A.companyId, email.hr, hash);
    const uAdmin = await seedUser(direct, A.companyId, email.admin, hash);
    const uUploader = await seedUser(direct, A.companyId, email.uploader, hash);
    const uBEmp = await seedUser(direct, B.companyId, email.bEmp, hash);

    await seedUserRole(direct, uEmp, roleEmp, A.companyId);
    await seedUserRole(direct, uMgr, roleMgr, A.companyId);
    await seedUserRole(direct, uHr, roleHr, A.companyId);
    await seedUserRole(direct, uAdmin, roleAdmin, A.companyId);
    await seedUserRole(direct, uUploader, roleUploader, A.companyId);
    await seedUserRole(direct, uBEmp, roleEmp, B.companyId);

    // Default configs cho A (nguồn assert widget set chuẩn).
    await seedDefaultConfigs(direct, A.companyId);

    // M6 cross-tenant: HR_OVERVIEW rò vào Employee dashboard của B (KHÔNG được lộ sang A).
    await seedConfig(direct, B.companyId, "Employee", "HR_OVERVIEW", 99);

    // M10 gate tầng-2 CÙNG-TENANT: PENDING_LEAVE (gate=view:leave) vào Employee dashboard của A.
    //   employee KHÔNG có view:leave ⇒ bị loại; hr CÓ view:leave ⇒ thấy. (Xem chú thích SAI-LỆCH (a).)
    await seedConfig(direct, A.companyId, "Employee", "PENDING_LEAVE", 99);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    // dashboard_widget_configs.company_id → companies ON DELETE CASCADE ⇒ cleanupTenants (xoá companies) phủ.
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  // ── M1 no-role → 403 mọi route (read:dashboard grant theo ROLE; user không role = 0 grant) ────────────
  it("M1 no-role: GET /dashboard/me·/types·/employee·/manager·/hr·/admin → 403", async () => {
    const h = bearer(await login(nest, A.slug, email.noRole));
    for (const path of [
      "/dashboard/me",
      "/dashboard/types",
      "/dashboard/employee",
      "/dashboard/manager",
      "/dashboard/hr",
      "/dashboard/admin",
    ]) {
      expect((await api(nest).get(path).set(h)).status, path).toBe(403);
    }
  });

  // ── M2 employee-only ──────────────────────────────────────────────────────────────────────────────
  it("M2 employee: /manager·/hr·/admin → 403", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    expect((await api(nest).get("/dashboard/manager").set(h)).status).toBe(403);
    expect((await api(nest).get("/dashboard/hr").set(h)).status).toBe(403);
    expect((await api(nest).get("/dashboard/admin").set(h)).status).toBe(403);
  });

  it("M2 employee: /dashboard/employee → 200, đúng 4 widget theo sort_order (KHÔNG HR_OVERVIEW/PENDING_LEAVE/PROJECT_PROGRESS)", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/employee").set(h);
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard_type).toBe("Employee");
    expect(widgetCodes(res.body)).toEqual([
      "ATTENDANCE_TODAY",
      "MY_TASKS",
      "TASK_ALERTS",
      "NOTIFICATIONS",
    ]);
    expect(res.body.data.generated_at).toBeTruthy();
  });

  it("M2 employee: /dashboard/me → 200, dashboard_type=Employee", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/me").set(h);
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard_type).toBe("Employee");
  });

  it("M2 employee: /dashboard/types → 200, đúng 1 phần tử Employee (is_default)", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/types").set(h);
    expect(res.status).toBe(200);
    const types = res.body.data as Array<{ dashboard_type: string; is_default: boolean }>;
    expect(types).toHaveLength(1);
    expect(types[0]).toMatchObject({ dashboard_type: "Employee", is_default: true });
  });

  // ── M3 manager-only ───────────────────────────────────────────────────────────────────────────────
  it("M3 manager: /hr·/admin → 403; /manager → 200 {PENDING_LEAVE,TASK_ALERTS,NOTIFICATIONS} (KHÔNG MY_TASKS)", async () => {
    const h = bearer(await login(nest, A.slug, email.mgr));
    expect((await api(nest).get("/dashboard/hr").set(h)).status).toBe(403);
    expect((await api(nest).get("/dashboard/admin").set(h)).status).toBe(403);
    const res = await api(nest).get("/dashboard/manager").set(h);
    expect(res.status).toBe(200);
    const codes = widgetCodes(res.body);
    expect(codes).toEqual(["PENDING_LEAVE", "TASK_ALERTS", "NOTIFICATIONS"]);
    expect(codes).not.toContain("MY_TASKS");
  });

  it("M3 manager: /dashboard/me → dashboard_type=Manager", async () => {
    const h = bearer(await login(nest, A.slug, email.mgr));
    const res = await api(nest).get("/dashboard/me").set(h);
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard_type).toBe("Manager");
  });

  // ── M4 hr: thứ-tự-ưu-tiên (Admin>HR>Manager) — hr có CẢ view-manager nhưng /me PHẢI = HR ──────────────
  it("M4 hr: /dashboard/me → HR (không phải Manager dù hr có view-manager:dashboard)", async () => {
    const h = bearer(await login(nest, A.slug, email.hr));
    const res = await api(nest).get("/dashboard/me").set(h);
    expect(res.status).toBe(200);
    expect(res.body.data.dashboard_type).toBe("HR");
  });

  it("M4 hr: /dashboard/types → 3 type (Employee/Manager/HR), is_default duy nhất HR", async () => {
    const h = bearer(await login(nest, A.slug, email.hr));
    const res = await api(nest).get("/dashboard/types").set(h);
    expect(res.status).toBe(200);
    const types = res.body.data as Array<{ dashboard_type: string; is_default: boolean }>;
    const byType = new Map(types.map((t) => [t.dashboard_type, t.is_default]));
    expect(new Set(byType.keys())).toEqual(new Set(["Employee", "Manager", "HR"]));
    expect(types.filter((t) => t.is_default)).toHaveLength(1);
    expect(byType.get("HR")).toBe(true);
  });

  // ── M5 company-admin: đủ 4 grant ──────────────────────────────────────────────────────────────────
  it("M5 admin: /dashboard/me → Admin; /types → đủ 4 type, is_default duy nhất Admin", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const me = await api(nest).get("/dashboard/me").set(h);
    expect(me.status).toBe(200);
    expect(me.body.data.dashboard_type).toBe("Admin");

    const res = await api(nest).get("/dashboard/types").set(h);
    expect(res.status).toBe(200);
    const types = res.body.data as Array<{ dashboard_type: string; is_default: boolean }>;
    expect(new Set(types.map((t) => t.dashboard_type))).toEqual(
      new Set(["Employee", "Manager", "HR", "Admin"]),
    );
    expect(types.filter((t) => t.is_default)).toHaveLength(1);
    expect(types.find((t) => t.is_default)?.dashboard_type).toBe("Admin");
  });

  // ── M6 cross-tenant RLS: A employee KHÔNG thấy HR_OVERVIEW rò từ B ────────────────────────────────────
  it("M6 cross-tenant: A employee /dashboard/employee → đúng 4 chuẩn, KHÔNG rò HR_OVERVIEW của B", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/employee").set(h);
    expect(res.status).toBe(200);
    const codes = widgetCodes(res.body);
    expect(codes).not.toContain("HR_OVERVIEW");
    expect(codes).toEqual(["ATTENDANCE_TODAY", "MY_TASKS", "TASK_ALERTS", "NOTIFICATIONS"]);
  });

  // ── M7 DASHBOARD_NOT_RESOLVED (uploader: read:dashboard blanket nhưng KHÔNG view-*:dashboard) ──────────
  it("M7 uploader: /dashboard/me → 404 DASH-ERR-DASHBOARD_NOT_RESOLVED; /types → 404 cùng mã", async () => {
    const h = bearer(await login(nest, A.slug, email.uploader));
    const me = await api(nest).get("/dashboard/me").set(h);
    expect(me.status).toBe(404);
    expect(me.body.error.code).toBe("DASH-ERR-DASHBOARD_NOT_RESOLVED");
    const types = await api(nest).get("/dashboard/types").set(h);
    expect(types.status).toBe(404);
    expect(types.body.error.code).toBe("DASH-ERR-DASHBOARD_NOT_RESOLVED");
  });

  // ── M8 limit: áp SAU sort; validate (0/âm/chữ → 400) ─────────────────────────────────────────────────
  it("M8 employee: /dashboard/employee?limit=2 → 2 widget đầu theo sort_order", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/employee?limit=2").set(h);
    expect(res.status).toBe(200);
    expect(widgetCodes(res.body)).toEqual(["ATTENDANCE_TODAY", "MY_TASKS"]);
  });

  it("M8 employee: /dashboard/employee?limit=0 và limit=abc → 400 (KHÔNG 500, KHÔNG trả toàn bộ)", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    expect((await api(nest).get("/dashboard/employee?limit=0").set(h)).status).toBe(400);
    expect((await api(nest).get("/dashboard/employee?limit=abc").set(h)).status).toBe(400);
  });

  // ── M9 PROJECT_PROGRESS không có default config ⇒ vắng mặt mọi dashboard/role ─────────────────────────
  it("M9 PROJECT_PROGRESS vắng mặt ở employee/manager/hr/admin dashboard", async () => {
    const probes: Array<[keyof typeof email, string, string]> = [
      ["emp", A.slug, "/dashboard/employee"],
      ["mgr", A.slug, "/dashboard/manager"],
      ["hr", A.slug, "/dashboard/hr"],
      ["admin", A.slug, "/dashboard/admin"],
    ];
    for (const [key, slug, path] of probes) {
      const h = bearer(await login(nest, slug, email[key]));
      const res = await api(nest).get(path).set(h);
      expect(res.status, path).toBe(200);
      expect(widgetCodes(res.body), path).not.toContain("PROJECT_PROGRESS");
    }
  });

  // ── M10 gate tầng-2 CÙNG-TENANT HAI CHIỀU (crown) ────────────────────────────────────────────────────
  it("M10 loại: employee /dashboard/employee KHÔNG chứa PENDING_LEAVE (thiếu view:leave), vẫn đúng 4", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/employee").set(h);
    expect(res.status).toBe(200);
    const codes = widgetCodes(res.body);
    expect(codes).not.toContain("PENDING_LEAVE");
    expect(codes).toEqual(["ATTENDANCE_TODAY", "MY_TASKS", "TASK_ALERTS", "NOTIFICATIONS"]);
  });

  it("M10 nhận: hr /dashboard/employee CHỨA PENDING_LEAVE (có view:leave) — gate tầng-2 hai chiều", async () => {
    const h = bearer(await login(nest, A.slug, email.hr));
    const res = await api(nest).get("/dashboard/employee").set(h);
    expect(res.status).toBe(200);
    expect(widgetCodes(res.body)).toContain("PENDING_LEAVE");
  });

  // ── smoke ────────────────────────────────────────────────────────────────────────────────────────
  it("smoke: /dashboard/me không token → 401", async () => {
    expect((await api(nest).get("/dashboard/me")).status).toBe(401);
    void randomUUID;
  });
});

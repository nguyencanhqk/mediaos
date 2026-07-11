/**
 * S4-DASH-BE-2 — Widget DATA + cache + degraded (HTTP, real permission engine + real DB).
 * Cửa: GET /dashboard/widgets (catalog omit widget thiếu quyền) · GET /dashboard/widgets/:slug (data 1 widget).
 *
 * RED-first — CROWN deny-path/scope/cache/degraded đi đầu (§7 plan docs/plans/S4-DASH-BE-2.md):
 *   D1 permission deny fail-closed per-widget (uploader/custom thiếu cặp source → 403, KHÔNG nuốt thành Degraded).
 *   D2 catalog omit (custom role read:task-only ⇒ chỉ my-tasks; hr-overview/pending-leave/notifications OMIT).
 *   D3 PROJECT_PROGRESS: thiếu project_id → 400; thiếu read:project → 403; project không tồn tại/ngoài scope → 404.
 *   D4 degraded: mock TaskCoreService throw ⇒ /widgets/my-tasks status=Degraded HTTP 200; deny VẪN 403 (không nuốt).
 *   D5 cache: miss→hit (last_updated_at ổn định) · refresh trong min-interval serve cache · quá min-interval regen.
 *   D6 cache-key per-user (A≠B) + append-only grant (app KHÔNG DELETE dashboard_widget_cache).
 *   D7 HR_OVERVIEW viewer-independent KHÔNG lộ lương/PII (response LẪN cache row).
 *
 * Grant canonical (probe mediaos_dashbe2): employee{read:task/employee/project/notification Own · view-own:att ·
 *   view-employee:dash · read:dash} · uploader{read:dash · read:project Company} KHÁC (thiếu task/employee/leave/
 *   notification/att) ⇒ uploader = "qua read:dashboard nhưng thiếu cặp source" hoàn hảo cho D1.
 *
 * Gate hasDb && LANE_DB (memory integration-test-lane-db-gate): chạy DB cô lập mediaos_dashbe2.
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
import { TaskCoreService } from "../../src/tasks/task-core.service";
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

async function canonicalRoleId(direct: Pool, name: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
    [name],
  );
  if (r.rows.length === 0) throw new Error(`canonical role missing: ${name}`);
  return r.rows[0].id as string;
}

async function permId(direct: Pool, action: string, resourceType: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1",
    [action, resourceType],
  );
  if (r.rows.length === 0) throw new Error(`permission missing: ${action}:${resourceType}`);
  return r.rows[0].id as string;
}

async function globalWidgetId(direct: Pool, widgetCode: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM dashboard_widgets WHERE widget_code=$1 AND company_id IS NULL AND deleted_at IS NULL",
    [widgetCode],
  );
  if (r.rows.length === 0) throw new Error(`global widget missing: ${widgetCode}`);
  return r.rows[0].id as string;
}

async function seedConfig(
  direct: Pool,
  companyId: string,
  dashboardType: string,
  widgetCode: string,
  sortOrder: number,
): Promise<void> {
  const widgetId = await globalWidgetId(direct, widgetCode);
  await direct.query(
    `INSERT INTO dashboard_widget_configs
       (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
     VALUES ($1,$2,$3,'Company',NULL,NULL,true,$4)`,
    [companyId, widgetId, dashboardType, sortOrder],
  );
}

describe.skipIf(!hasLaneDb)("S4-DASH-BE-2 Widget DATA + cache + degraded (HTTP)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  const email = { emp: "", mgr: "", hr: "", uploader: "", limited: "", bEmp: "" };
  const ids = { emp: "", limited: "", bEmp: "" };

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "dashbe2a");
    B = await seedCompany(direct, "dashbe2b");
    companyIds.push(A.companyId, B.companyId);

    const roleEmp = await canonicalRoleId(direct, "employee");
    const roleMgr = await canonicalRoleId(direct, "manager");
    const roleHr = await canonicalRoleId(direct, "hr");
    const roleUploader = await canonicalRoleId(direct, "uploader");

    // Custom role A: read:dashboard + view-employee:dashboard + read:task ONLY (không read:employee/view:leave/
    // read:notification/view-own:attendance/read:project) — chứng minh catalog OMIT + per-widget deny sạch.
    const roleLimited = await seedRole(direct, A.companyId, "dash-only-tasks");
    await seedRolePermission(
      direct,
      roleLimited,
      await permId(direct, "read", "dashboard"),
      "ALLOW",
      "Company",
    );
    await seedRolePermission(
      direct,
      roleLimited,
      await permId(direct, "view-employee", "dashboard"),
      "ALLOW",
      "Own",
    );
    await seedRolePermission(
      direct,
      roleLimited,
      await permId(direct, "read", "task"),
      "ALLOW",
      "Own",
    );

    email.emp = `emp@${A.slug}.test`;
    email.mgr = `mgr@${A.slug}.test`;
    email.hr = `hr@${A.slug}.test`;
    email.uploader = `uploader@${A.slug}.test`;
    email.limited = `limited@${A.slug}.test`;
    email.bEmp = `emp@${B.slug}.test`;

    ids.emp = await seedUser(direct, A.companyId, email.emp, hash);
    const uMgr = await seedUser(direct, A.companyId, email.mgr, hash);
    const uHr = await seedUser(direct, A.companyId, email.hr, hash);
    const uUploader = await seedUser(direct, A.companyId, email.uploader, hash);
    ids.limited = await seedUser(direct, A.companyId, email.limited, hash);
    ids.bEmp = await seedUser(direct, B.companyId, email.bEmp, hash);

    await seedUserRole(direct, ids.emp, roleEmp, A.companyId);
    await seedUserRole(direct, uMgr, roleMgr, A.companyId);
    await seedUserRole(direct, uHr, roleHr, A.companyId);
    await seedUserRole(direct, uUploader, roleUploader, A.companyId);
    await seedUserRole(direct, ids.limited, roleLimited, A.companyId);
    await seedUserRole(direct, ids.bEmp, roleEmp, B.companyId);

    // Employee dashboard configs cho A — catalog có nhiều widget để omit theo quyền.
    for (const [code, order] of [
      ["ATTENDANCE_TODAY", 10],
      ["MY_TASKS", 20],
      ["NOTIFICATIONS", 30],
      ["PENDING_LEAVE", 40],
      ["HR_OVERVIEW", 50],
    ] as const) {
      await seedConfig(direct, A.companyId, "Employee", code, order);
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    // dashboard_widget_cache/configs.company_id → companies CASCADE ⇒ cleanupTenants (xoá companies) phủ.
    await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await direct.query("DELETE FROM dashboard_widget_configs WHERE company_id = ANY($1::uuid[])", [
      companyIds,
    ]);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  // ── D1 permission deny fail-closed per-widget (qua read:dashboard nhưng thiếu cặp source → 403) ──────
  it("D1 uploader: /widgets/{my-tasks,hr-overview,pending-leave,notifications,attendance-today} → 403", async () => {
    const h = bearer(await login(nest, A.slug, email.uploader));
    for (const slug of [
      "my-tasks",
      "hr-overview",
      "pending-leave",
      "notifications",
      "attendance-today",
    ]) {
      const res = await api(nest).get(`/dashboard/widgets/${slug}`).set(h);
      expect(res.status, slug).toBe(403);
    }
  });

  it("D1 employee: /widgets/pending-leave → 403 (thiếu view:leave); /widgets/my-tasks → 200 (có read:task)", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    expect((await api(nest).get("/dashboard/widgets/pending-leave").set(h)).status).toBe(403);
    const ok = await api(nest).get("/dashboard/widgets/my-tasks").set(h);
    expect(ok.status).toBe(200);
    expect(["Active", "Empty"]).toContain(ok.body.data.status);
    expect(ok.body.data.widget_code).toBe("MY_TASKS");
  });

  // ── D2 catalog OMIT widget thiếu quyền (KHÔNG hiện như Degraded-có-data) ────────────────────────────
  it("D2 limited(read:task-only): GET /widgets ⇒ chỉ my-tasks; OMIT hr-overview/pending-leave/notifications/attendance-today", async () => {
    const h = bearer(await login(nest, A.slug, email.limited));
    const res = await api(nest).get("/dashboard/widgets").set(h);
    expect(res.status).toBe(200);
    const codes = (res.body.data as Array<{ widget_code: string }>).map((w) => w.widget_code);
    expect(codes).toContain("MY_TASKS");
    expect(codes).not.toContain("HR_OVERVIEW");
    expect(codes).not.toContain("PENDING_LEAVE");
    expect(codes).not.toContain("NOTIFICATIONS");
    expect(codes).not.toContain("ATTENDANCE_TODAY");
  });

  // ── D3 PROJECT_PROGRESS: 400 thiếu param · 403 thiếu read:project · 404 project ngoài scope ──────────
  it("D3 project-progress: thiếu project_id → 400", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/widgets/project-progress").set(h);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("DASH-ERR-VALIDATION");
  });

  it("D3 project-progress: limited thiếu read:project → 403 (authorize TRƯỚC aggregate)", async () => {
    const h = bearer(await login(nest, A.slug, email.limited));
    const res = await api(nest)
      .get(`/dashboard/widgets/project-progress?project_id=${randomUUID()}`)
      .set(h);
    expect(res.status).toBe(403);
  });

  it("D3 project-progress: employee project_id không tồn tại/ngoài scope → 404 (getProject)", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest)
      .get(`/dashboard/widgets/project-progress?project_id=${randomUUID()}`)
      .set(h);
    expect(res.status).toBe(404);
  });

  // ── D5 cache: miss→hit (last_updated_at ổn định) · refresh trong min-interval serve · quá min-interval regen ──
  it("D5 cache: miss(hit=false) → hit(true, last_updated_at ổn định) → refresh<min-interval serve → regen sau min-interval", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    // Ép miss sạch: xoá cache emp MY_TASKS (các test D1/D3 trước có thể đã warm cache).
    await direct.query(
      "DELETE FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE $2",
      [A.companyId, `%:MY_TASKS:u:${ids.emp}%`],
    );
    const c1 = await api(nest).get("/dashboard/widgets/my-tasks").set(h);
    expect(c1.status).toBe(200);
    expect(c1.body.data.cache.hit).toBe(false);
    const l0 = c1.body.data.last_updated_at as string;

    const c2 = await api(nest).get("/dashboard/widgets/my-tasks").set(h);
    expect(c2.body.data.cache.hit).toBe(true);
    expect(c2.body.data.last_updated_at).toBe(l0);

    // refresh=true NGAY (trong min-interval 10s) ⇒ VẪN serve cache (chống cache-busting).
    const c3 = await api(nest).get("/dashboard/widgets/my-tasks?refresh=true").set(h);
    expect(c3.body.data.cache.hit).toBe(true);
    expect(c3.body.data.last_updated_at).toBe(l0);

    // Lùi generated_at ra ngoài min-interval ⇒ refresh=true regen (generated_at MỚI).
    await direct.query(
      `UPDATE dashboard_widget_cache SET generated_at = now() - interval '2 minutes'
       WHERE company_id=$1 AND cache_key LIKE $2 AND deleted_at IS NULL`,
      [A.companyId, `%:MY_TASKS:u:${ids.emp}%`],
    );
    const c4 = await api(nest).get("/dashboard/widgets/my-tasks?refresh=true").set(h);
    expect(c4.body.data.cache.hit).toBe(false);
    expect(new Date(c4.body.data.last_updated_at).getTime()).toBeGreaterThan(
      new Date(l0).getTime(),
    );
  });

  // ── D6 cache-key per-user (A≠B) + append-only grant (app KHÔNG DELETE) ──────────────────────────────
  it("D6 cache-key kèm userId (per-user) — 2 user khác nhau ⇒ cache_key KHÁC", async () => {
    // emp (A) đã ghi cache ở D5. bEmp (B) gọi cùng slug ⇒ row riêng, cache_key khác.
    const hb = bearer(await login(nest, B.slug, email.bEmp));
    const rb = await api(nest).get("/dashboard/widgets/my-tasks").set(hb);
    expect(rb.status).toBe(200);
    const rows = await direct.query(
      "SELECT company_id, cache_key, user_id FROM dashboard_widget_cache WHERE cache_key LIKE '%:MY_TASKS:%'",
    );
    const keyA = rows.rows.find((r) => r.user_id === ids.emp)?.cache_key as string;
    const keyB = rows.rows.find((r) => r.user_id === ids.bEmp)?.cache_key as string;
    expect(keyA).toBeTruthy();
    expect(keyB).toBeTruthy();
    expect(keyA).not.toBe(keyB);
  });

  it("D6 append-only: mediaos_app GRANT trên dashboard_widget_cache có INSERT/UPDATE, KHÔNG DELETE (BẤT BIẾN #2)", async () => {
    const g = await direct.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee='mediaos_app' AND table_name='dashboard_widget_cache'`,
    );
    const privs = new Set(g.rows.map((r) => r.privilege_type as string));
    expect(privs.has("INSERT")).toBe(true);
    expect(privs.has("UPDATE")).toBe(true);
    expect(privs.has("SELECT")).toBe(true);
    expect(privs.has("DELETE")).toBe(false);
  });

  // ── D7 HR_OVERVIEW viewer-independent KHÔNG lộ lương/PII (response LẪN cache row) ────────────────────
  it("D7 hr: /widgets/hr-overview → 200 chỉ headcount/byStatus/byOrgUnit; KHÔNG salary/PII trong data LẪN cache", async () => {
    const h = bearer(await login(nest, A.slug, email.hr));
    const res = await api(nest).get("/dashboard/widgets/hr-overview").set(h);
    expect(res.status).toBe(200);
    const blob = JSON.stringify(res.body.data);
    for (const forbidden of ["baseSalary", "salaryType", "phone", "contractType", "notes"]) {
      expect(blob.includes(forbidden), `response chứa field cấm: ${forbidden}`).toBe(false);
    }
    const cacheRows = await direct.query(
      "SELECT data FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE '%:HR_OVERVIEW:%' AND deleted_at IS NULL",
      [A.companyId],
    );
    const cacheBlob = JSON.stringify(cacheRows.rows.map((r) => r.data));
    for (const forbidden of ["baseSalary", "salaryType", "phone", "contractType", "notes"]) {
      expect(cacheBlob.includes(forbidden), `cache chứa field cấm: ${forbidden}`).toBe(false);
    }
  });

  // ── smoke ────────────────────────────────────────────────────────────────────
  it("smoke: /dashboard/widgets/my-tasks không token → 401", async () => {
    expect((await api(nest).get("/dashboard/widgets/my-tasks")).status).toBe(401);
  });
});

// ── D4 degraded (app RIÊNG override TaskCoreService.getMyTasks throw) ──────────────────────────────────
describe.skipIf(!hasLaneDb)(
  "S4-DASH-BE-2 degraded (source module lỗi → Degraded, KHÔNG nuốt 403)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;
    let A: SeededTenant;
    const companyIds: string[] = [];
    const email = { emp: "", uploader: "" };

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "dashbe2deg");
      companyIds.push(A.companyId);
      const roleEmp = await canonicalRoleId(direct, "employee");
      const roleUploader = await canonicalRoleId(direct, "uploader");
      email.emp = `emp@${A.slug}.test`;
      email.uploader = `uploader@${A.slug}.test`;
      const uEmp = await seedUser(direct, A.companyId, email.emp, hash);
      const uUp = await seedUser(direct, A.companyId, email.uploader, hash);
      await seedUserRole(direct, uEmp, roleEmp, A.companyId);
      await seedUserRole(direct, uUp, roleUploader, A.companyId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        // Mock ném PLAIN Error (KHÔNG HttpException) ⇒ runner map Degraded (không nuốt 403 — gate chạy TRƯỚC fetch).
        .overrideProvider(TaskCoreService)
        .useValue({
          getMyTasks: async () => {
            throw new Error("boom: task module down");
          },
        })
        .compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    it("D4 employee: /widgets/my-tasks → 200 status=Degraded + error_state.code=DASH-ERR-SOURCE_MODULE_UNAVAILABLE (KHÔNG 500)", async () => {
      const h = bearer(await login(nest, A.slug, email.emp));
      const res = await api(nest).get("/dashboard/widgets/my-tasks").set(h);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Degraded");
      expect(res.body.data.error_state.code).toBe("DASH-ERR-SOURCE_MODULE_UNAVAILABLE");
      expect(res.body.data.data).toBeNull();
    });

    it("D4 uploader: /widgets/my-tasks → 403 (permission-deny KHÔNG bị nuốt thành Degraded — gate TRƯỚC fetch)", async () => {
      const h = bearer(await login(nest, A.slug, email.uploader));
      const res = await api(nest).get("/dashboard/widgets/my-tasks").set(h);
      expect(res.status).toBe(403);
    });
  },
);

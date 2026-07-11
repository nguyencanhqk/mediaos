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

      // Config catalog Employee — để GET /widgets?include_data=true có widget để attach data (path attachData).
      // emp (canonical) có read:task/notification ⇒ MY_TASKS/TASK_ALERTS/NOTIFICATIONS xuất hiện; TaskCore mock
      // throw ⇒ 2 widget TASK degraded TRONG catalog, catalog VẪN 200 (Promise.allSettled, không nuốt cả dashboard).
      for (const [code, order] of [
        ["MY_TASKS", 20],
        ["TASK_ALERTS", 30],
        ["NOTIFICATIONS", 50],
      ] as const) {
        await seedConfig(direct, A.companyId, "Employee", code, order);
      }

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
      await direct.query(
        "DELETE FROM dashboard_widget_configs WHERE company_id = ANY($1::uuid[])",
        [companyIds],
      );
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

    // ── D4b catalog degraded (path attachData ~L188-220): 1 source lỗi ⇒ catalog VẪN 200 (không 500 cả dashboard) ──
    it("D4b employee: GET /widgets?include_data=true → 200; MY_TASKS/TASK_ALERTS status=Degraded, NOTIFICATIONS vẫn có mặt", async () => {
      const h = bearer(await login(nest, A.slug, email.emp));
      const res = await api(nest).get("/dashboard/widgets?include_data=true").set(h);
      expect(res.status).toBe(200);
      const items = res.body.data as Array<{
        widget_code: string;
        status?: string;
        error_state?: { code: string } | null;
        quick_actions?: unknown[];
      }>;
      // Catalog KHÔNG rỗng dù 1 source lỗi (chống nuốt cả dashboard).
      expect(items.length).toBeGreaterThan(0);
      const myTasks = items.find((w) => w.widget_code === "MY_TASKS");
      expect(myTasks, "MY_TASKS phải nằm trong catalog").toBeTruthy();
      // Source TASK throw ⇒ widget degraded (không 403, không mất khỏi catalog) + mã lỗi đúng.
      expect(myTasks?.status).toBe("Degraded");
      expect(myTasks?.error_state?.code).toBe("DASH-ERR-SOURCE_MODULE_UNAVAILABLE");
      // Widget nguồn KHÁC (NOTI) không bị kéo theo — vẫn có mặt trong catalog.
      expect(items.some((w) => w.widget_code === "NOTIFICATIONS")).toBe(true);
      // include_data vẫn đính quick_actions metadata cho từng item.
      expect(Array.isArray(myTasks?.quick_actions)).toBe(true);
    });
  },
);

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// Seed helpers cho DATA happy-path (direct pool, bypass RLS — chỉ dựng lưới, KHÔNG phản ánh đường app).
// ══════════════════════════════════════════════════════════════════════════════════════════════════

/** employee_profiles ACTIVE (join attendance theo user_id + đếm headcount HR_OVERVIEW). Trả employeeId. */
async function seedEmployeeProfile(
  direct: Pool,
  companyId: string,
  userId: string,
  orgUnitId?: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
     VALUES ($1,$2,$3,'active') RETURNING id`,
    [companyId, userId, orgUnitId ?? null],
  );
  return r.rows[0].id as string;
}

/** tasks (task_status TitleCase HIỆN ĐẠI, task_type='office'). creatorUserId ⇒ nguồn 'created' của /my. */
async function seedTaskRow(
  direct: Pool,
  opts: {
    companyId: string;
    creatorUserId: string;
    title: string;
    taskStatus: string;
    dueAt?: string | null;
    projectId?: string | null;
  },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status, creator_user_id, due_at, project_id)
     VALUES ($1,'office',$2,$3,$4,$5,$6) RETURNING id`,
    [
      opts.companyId,
      opts.title,
      opts.taskStatus,
      opts.creatorUserId,
      opts.dueAt ?? null,
      opts.projectId ?? null,
    ],
  );
  return r.rows[0].id as string;
}

/** projects (status legacy 'active' + project_status 'Active'). Trả projectId. */
async function seedProjectRow(direct: Pool, companyId: string, name: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO projects (company_id, name, status, project_status)
     VALUES ($1,$2,'active','Active') RETURNING id`,
    [companyId, name],
  );
  return r.rows[0].id as string;
}

/** notifications — cột legacy (user_id/type/body/is_read) + cột mới song song (recipient_user_id/status/...). */
async function seedNotificationRow(
  direct: Pool,
  companyId: string,
  recipientUserId: string,
  title: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notifications
       (company_id, user_id, type, body, is_read,
        recipient_user_id, status, priority, title, short_body, notification_type, module_code, event_code)
     VALUES ($1,$2,'general',$3,false,
             $2,'Unread','Normal',$4,$5,'Task','TASK','TASK_ASSIGNED')
     RETURNING id`,
    [
      companyId,
      recipientUserId,
      `Nội dung ${title} đủ dài cho short_content fallback`,
      title,
      title,
    ],
  );
  return r.rows[0].id as string;
}

/** attendance_records cho HÔM NAY theo TZ công ty (join listMyRecords theo user_id). status legacy 'present'. */
async function seedAttendanceToday(direct: Pool, companyId: string, userId: string): Promise<void> {
  await direct.query(
    `INSERT INTO attendance_records (company_id, user_id, work_date, status, attendance_status)
     VALUES ($1,$2,(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date,'present','Present')`,
    [companyId, userId],
  );
}

/** leave_types tối thiểu (Annual). Trả leaveTypeId. */
async function seedLeaveType(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    `INSERT INTO leave_types (company_id, name, code) VALUES ($1,'Annual',$2) RETURNING id`,
    [companyId, `LT-${randomUUID().slice(0, 8)}`],
  );
  return r.rows[0].id as string;
}

/** leave_requests status='Pending' (owner=employeeId trong scope người duyệt). employee_id BẮT BUỘC (INNER JOIN). */
async function seedPendingLeave(
  direct: Pool,
  opts: { companyId: string; userId: string; employeeId: string; leaveTypeId: string },
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO leave_requests
       (company_id, user_id, employee_id, leave_type_id, leave_request_code,
        start_date, end_date, total_days, duration_type, status, submitted_at)
     VALUES ($1,$2,$3,$4,$5,'2027-03-02','2027-03-02',1,'FullDay','Pending', now())
     RETURNING id`,
    [
      opts.companyId,
      opts.userId,
      opts.employeeId,
      opts.leaveTypeId,
      `LR-${randomUUID().slice(0, 8)}`,
    ],
  );
  return r.rows[0].id as string;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// DATA HAPPY-PATH — ĐỦ 7 slug in-sprint trả DATA THẬT (đẩy coverage handler+runner ≥80%), + quick_actions +
// include_data. CHỨNG MINH FIX-1 (BUG1 PROJECT_PROGRESS aggregate theo task_status) + FIX-2 (BUG2 TASK_ALERTS
// loại Done/Cancelled). 1 user "viewer" scope Company mọi cặp source ⇒ chạm cả 7 handler trong 1 setup.
// ══════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasLaneDb)(
  "S4-DASH-BE-2 Widget DATA happy-path (7 slug data + quick_actions + include_data)",
  () => {
    const direct = directPool();
    let nest: INestApplication;
    let H: SeededTenant;
    const companyIds: string[] = [];
    const email = { viewer: "", owner: "" };
    const ids = { viewer: "", owner: "" };
    const sfx = randomUUID().slice(0, 8);
    const MARK = {
      overdueTodo: `MYOVERDUE-${sfx}`,
      overdueDone: `MYDONE-${sfx}`,
      overdueCancelled: `MYCANCEL-${sfx}`,
      dueSoon: `MYDUESOON-${sfx}`,
      future: `MYFUTURE-${sfx}`,
      project: `PROJ-${sfx}`,
      notif: `NOTI-${sfx}`,
    };
    let projectId = "";
    let leaveTypeName = "Annual";

    beforeAll(async () => {
      const hash = await hashedPw();
      H = await seedCompany(direct, "dashbe2hp");
      companyIds.push(H.companyId);

      // Custom role: read:dashboard + view-employee:dashboard + toàn bộ cặp source (Company) ⇒ 1 user chạm cả 7 widget.
      const role = await seedRole(direct, H.companyId, "dash-all-viewer");
      const grants: Array<[string, string, "Own" | "Company"]> = [
        ["read", "dashboard", "Company"],
        ["view-employee", "dashboard", "Own"],
        ["read", "task", "Company"],
        ["read", "notification", "Company"],
        ["view-own", "attendance", "Company"],
        ["view", "leave", "Company"],
        ["read", "project", "Company"],
        ["read", "employee", "Company"],
      ];
      for (const [a, r, s] of grants) {
        await seedRolePermission(direct, role, await permId(direct, a, r), "ALLOW", s);
      }

      email.viewer = `viewer@${H.slug}.test`;
      email.owner = `owner@${H.slug}.test`;
      ids.viewer = await seedUser(direct, H.companyId, email.viewer, hash);
      ids.owner = await seedUser(direct, H.companyId, email.owner, hash);
      await seedUserRole(direct, ids.viewer, role, H.companyId);

      // employee_profiles: viewer (attendance join + headcount) + owner (owner đơn nghỉ + headcount).
      await seedEmployeeProfile(direct, H.companyId, ids.viewer);
      const ownerEmp = await seedEmployeeProfile(direct, H.companyId, ids.owner);

      // MY_TASKS / TASK_ALERTS — task CỦA viewer (creator=viewer). due_at + task_status trộn (BUG2 regression):
      //   overdue Todo → alert · overdue Done/Cancelled → KHÔNG alert · dueSoon (<48h) Todo → alert · future → KHÔNG.
      const at = (ms: number) => new Date(Date.now() + ms).toISOString();
      const DAY = 86_400_000;
      await seedTaskRow(direct, {
        companyId: H.companyId,
        creatorUserId: ids.viewer,
        title: MARK.overdueTodo,
        taskStatus: "Todo",
        dueAt: at(-2 * DAY),
      });
      await seedTaskRow(direct, {
        companyId: H.companyId,
        creatorUserId: ids.viewer,
        title: MARK.overdueDone,
        taskStatus: "Done",
        dueAt: at(-2 * DAY),
      });
      await seedTaskRow(direct, {
        companyId: H.companyId,
        creatorUserId: ids.viewer,
        title: MARK.overdueCancelled,
        taskStatus: "Cancelled",
        dueAt: at(-2 * DAY),
      });
      await seedTaskRow(direct, {
        companyId: H.companyId,
        creatorUserId: ids.viewer,
        title: MARK.dueSoon,
        taskStatus: "Todo",
        dueAt: at(DAY),
      });
      await seedTaskRow(direct, {
        companyId: H.companyId,
        creatorUserId: ids.viewer,
        title: MARK.future,
        taskStatus: "Todo",
        dueAt: at(10 * DAY),
      });

      // PROJECT_PROGRESS — project + 5 task theo task_status (creator=owner ⇒ KHÔNG lọt my-tasks của viewer):
      //   Todo×2 · In Progress×1 · Done×2 ⇒ total 5, done 2, percent 40, byStatus keyed task_status (KHÔNG 'not_started').
      projectId = await seedProjectRow(direct, H.companyId, MARK.project);
      for (const st of ["Todo", "Todo", "In Progress", "Done", "Done"]) {
        await seedTaskRow(direct, {
          companyId: H.companyId,
          creatorUserId: ids.owner,
          title: `${MARK.project}-${st}-${randomUUID().slice(0, 4)}`,
          taskStatus: st,
          projectId,
        });
      }

      // NOTIFICATIONS — 1 thông báo CHƯA đọc cho viewer.
      await seedNotificationRow(direct, H.companyId, ids.viewer, MARK.notif);

      // ATTENDANCE_TODAY — 1 record HÔM NAY (TZ công ty) cho viewer.
      await seedAttendanceToday(direct, H.companyId, ids.viewer);

      // PENDING_LEAVE — 1 đơn Pending owner=ownerEmp, nằm trong scope Company của viewer (view:leave).
      const leaveTypeId = await seedLeaveType(direct, H.companyId);
      leaveTypeName = "Annual";
      await seedPendingLeave(direct, {
        companyId: H.companyId,
        userId: ids.owner,
        employeeId: ownerEmp,
        leaveTypeId,
      });

      // Config catalog Employee — 6 widget KHÔNG cần param (PROJECT_PROGRESS bắt buộc project_id ⇒ không đưa vào catalog).
      for (const [code, order] of [
        ["ATTENDANCE_TODAY", 10],
        ["MY_TASKS", 20],
        ["TASK_ALERTS", 30],
        ["PENDING_LEAVE", 40],
        ["NOTIFICATIONS", 50],
        ["HR_OVERVIEW", 60],
      ] as const) {
        await seedConfig(direct, H.companyId, "Employee", code, order);
      }

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
        companyIds,
      ]);
      await direct.query(
        "DELETE FROM dashboard_widget_configs WHERE company_id = ANY($1::uuid[])",
        [companyIds],
      );
      await cleanupTenants(direct, companyIds);
      await direct.end();
      if (nest) await nest.close();
    });

    async function widget(slug: string, qs = "") {
      const h = bearer(await login(nest, H.slug, email.viewer));
      return api(nest).get(`/dashboard/widgets/${slug}${qs}`).set(h);
    }

    // ── MY_TASKS: data thật (task của viewer) ───────────────────────────────────────────────────────
    it("MY_TASKS: 200 Active, trả task CỦA viewer (source=created)", async () => {
      const res = await widget("my-tasks");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Active");
      const blob = JSON.stringify(res.body.data.data);
      expect(blob.includes(MARK.overdueTodo)).toBe(true);
      expect(res.body.data.data.summary.total).toBeGreaterThanOrEqual(5);
    });

    // ── TASK_ALERTS content (BUG2 regression): loại Done/Cancelled quá hạn; giữ overdue Todo + dueSoon <48h ──
    it("TASK_ALERTS: overdue Todo + dueSoon LÀ alert; overdue Done/Cancelled KHÔNG; overdue=1 dueSoon=1 (FIX BUG2)", async () => {
      const res = await widget("task-alerts");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Active");
      const blob = JSON.stringify(res.body.data.data);
      // Alert đúng: overdue chưa hoàn thành + sắp đến hạn.
      expect(blob.includes(MARK.overdueTodo), "overdue Todo phải là alert").toBe(true);
      expect(blob.includes(MARK.dueSoon), "dueSoon (<48h) phải là alert").toBe(true);
      // KHÔNG alert: đã Done/Cancelled dù quá hạn (BUG2: TASK_TERMINAL_STATUSES TitleCase khớp) + future.
      expect(blob.includes(MARK.overdueDone), "Done quá hạn KHÔNG được là alert").toBe(false);
      expect(blob.includes(MARK.overdueCancelled), "Cancelled quá hạn KHÔNG được là alert").toBe(
        false,
      );
      expect(blob.includes(MARK.future), "future (>48h) KHÔNG được là alert").toBe(false);
      const s = res.body.data.data.summary;
      expect(s.total).toBe(2);
      expect(s.overdue).toBe(1);
      expect(s.dueSoon).toBe(1);
    });

    // ── PROJECT_PROGRESS (BUG1 regression): aggregate theo task_status HIỆN ĐẠI, done/percent > 0 ────────
    it("PROJECT_PROGRESS: 200 Active, byStatus keyed task_status (Todo/In Progress/Done) + done=2 percent=40 (FIX BUG1)", async () => {
      const res = await widget("project-progress", `?project_id=${projectId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Active");
      const d = res.body.data.data;
      expect(d.summary.total).toBe(5);
      // Cốt lõi BUG1: done/percent > 0 (TRƯỚC FIX luôn 0 vì đọc status legacy 'not_started').
      expect(d.summary.done).toBe(2);
      expect(d.summary.percent).toBe(40);
      // byStatus keyed theo task_status HIỆN ĐẠI — KHÔNG có key 'not_started' legacy.
      expect(d.byStatus.Todo).toBe(2);
      expect(d.byStatus["In Progress"]).toBe(1);
      expect(d.byStatus.Done).toBe(2);
      expect(d.byStatus.not_started, "KHÔNG được đọc status legacy").toBeUndefined();
    });

    // ── NOTIFICATIONS: 200 data (không chỉ Empty/403) ───────────────────────────────────────────────
    it("NOTIFICATIONS: 200 Active, có item chưa đọc của viewer (unread ≥ 1)", async () => {
      const res = await widget("notifications");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Active");
      expect(res.body.data.data.summary.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.data.summary.unread).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(res.body.data.data).includes(MARK.notif)).toBe(true);
    });

    // ── ATTENDANCE_TODAY: 200 data (record hôm nay) ─────────────────────────────────────────────────
    it("ATTENDANCE_TODAY: 200 Active, có record hôm nay (date = hôm nay TZ công ty)", async () => {
      const res = await widget("attendance-today");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Active");
      expect(res.body.data.data.summary.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.data.items.length).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.data.data.date).toBe("string");
    });

    // ── PENDING_LEAVE manager happy-path: view:leave thấy đơn Pending trong scope (nửa còn thiếu của QA) ──
    it("PENDING_LEAVE: viewer có view:leave → 200 Active, thấy đơn Pending owner trong scope Company", async () => {
      const res = await widget("pending-leave");
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Active");
      expect(res.body.data.data.summary.total).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(res.body.data.data).includes(leaveTypeName)).toBe(true);
    });

    // ── HR_OVERVIEW: 200 headcount aggregate (viewer-independent) ────────────────────────────────────
    it("HR_OVERVIEW: 200, headcount ≥ 2 (viewer + owner), KHÔNG lộ lương/PII", async () => {
      const res = await widget("hr-overview");
      expect(res.status).toBe(200);
      expect(res.body.data.data.summary.headcount).toBeGreaterThanOrEqual(2);
      const blob = JSON.stringify(res.body.data.data);
      for (const bad of ["baseSalary", "salaryType", "phone", "contractType"]) {
        expect(blob.includes(bad), `HR_OVERVIEW lộ field cấm: ${bad}`).toBe(false);
      }
    });

    // ── quick_actions metadata per-viewer (§8.4): enabled/disabled_reason theo quyền NGƯỜI XEM (khớp FIX-2) ──
    it("quick_actions: my-tasks — OPEN_MY_TASKS enabled (read:task); CREATE_TASK disabled (thiếu create:task) + disabled_reason", async () => {
      const res = await widget("my-tasks");
      expect(res.status).toBe(200);
      const qa = res.body.data.quick_actions as Array<{
        action_code: string;
        enabled: boolean;
        disabled_reason: string | null;
      }>;
      expect(Array.isArray(qa)).toBe(true);
      const open = qa.find((a) => a.action_code === "OPEN_MY_TASKS");
      const create = qa.find((a) => a.action_code === "CREATE_TASK");
      expect(open?.enabled, "OPEN_MY_TASKS: viewer có read:task").toBe(true);
      expect(open?.disabled_reason).toBeNull();
      expect(create?.enabled, "CREATE_TASK: viewer THIẾU create:task").toBe(false);
      expect(create?.disabled_reason).toContain("create:task");
    });

    // ── GET /widgets?include_data=true: catalog kèm data (path attachData) + quick_actions per item ──────
    it("include_data=true: 200, catalog kèm data + quick_actions; MY_TASKS có status+data attach", async () => {
      const h = bearer(await login(nest, H.slug, email.viewer));
      const res = await api(nest).get("/dashboard/widgets?include_data=true").set(h);
      expect(res.status).toBe(200);
      const items = res.body.data as Array<{
        widget_code: string;
        status?: string;
        data?: unknown;
        quick_actions?: unknown[];
      }>;
      expect(items.length).toBeGreaterThanOrEqual(5);
      for (const it of items) expect(Array.isArray(it.quick_actions)).toBe(true);
      const myTasks = items.find((w) => w.widget_code === "MY_TASKS");
      expect(myTasks?.status).toBe("Active");
      expect(myTasks?.data, "MY_TASKS include_data phải kèm data").toBeTruthy();
    });
  },
);

/**
 * S4-DASH-BE-2 — CROWN security DEEP (data-content isolation, real permission engine + real DB).
 *
 * BỔ SUNG cho dashboard-widget-data.int-spec.ts (D1-D7 của L2, assert chủ yếu MÃ TRẠNG THÁI): file này
 * chứng minh CÔ LẬP DỮ LIỆU THẬT — seed row cụ thể rồi assert NỘI DUNG response + row cache, không chỉ 200/403:
 *
 *   S1 scope Own (my-tasks): seed task của user KHÁC cùng company ⇒ KHÔNG lọt vào /widgets/my-tasks của emp.
 *   S2 cross-tenant (my-tasks): user company B gọi ⇒ KHÔNG thấy task company A (RLS+scope); cache A KHÔNG phục vụ B.
 *   S3 cache no-leak: cache_key(A) ≠ cache_key(B); row cache của B KHÔNG chứa field/nội dung của A;
 *      đọc cache_key của A dưới GUC tenant B (app role, RLS) ⇒ 0 row.
 *   S4 masking-tier (hr-overview): 2 user CÙNG read:employee khác view-salary ⇒ CẢ HAI KHÔNG thấy lương/PII
 *      trong response LẪN row cache; HR_OVERVIEW viewer-independent ⇒ 1 cache_key company-wide (user_id NULL).
 *   S5 authorize-before-aggregate (project-progress): getProject gate TRƯỚC ⇒ 403/404 và TasksService.listByProject
 *      KHÔNG được gọi (spy) — deny KHÔNG bị nuốt, aggregate KHÔNG chạy khi authorize fail.
 *   S6 append-only (dashboard_widget_cache): app role DELETE bị TỪ CHỐI (permission denied); soft-delete =
 *      UPDATE deleted_at (BẤT BIẾN #2) THÀNH CÔNG và row vẫn tồn tại.
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate): chạy DB cô lập mediaos_dashbe2
 * (bash scripts/lane-db-setup.sh dashbe2 → export LANE_DB=mediaos_dashbe2). Thiếu LANE_DB ⇒ suite SKIP.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { TasksService } from "../../src/tasks/tasks.service";
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

const PASSWORD = "Passw0rd!dashsec1";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

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

/** id cặp quyền trong catalog toàn cục (fail-loud nếu thiếu — migration chưa chạy). */
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

/** Grant (action,resourceType,scope) cho role đã seed. */
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

async function seedTask(
  direct: Pool,
  companyId: string,
  creatorUserId: string,
  title: string,
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO tasks (company_id, task_type, title, task_status, creator_user_id)
     VALUES ($1,'office',$2,'Todo',$3) RETURNING id`,
    [companyId, title, creatorUserId],
  );
  return r.rows[0].id as string;
}

async function cleanupDashCache(direct: Pool, companyIds: string[]): Promise<void> {
  if (companyIds.length === 0) return;
  await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])", [
    companyIds,
  ]);
  await direct.query("DELETE FROM dashboard_widget_configs WHERE company_id = ANY($1::uuid[])", [
    companyIds,
  ]);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S1-S4 — real engine, no mocks: scope Own · cross-tenant · cache no-leak · masking-tier
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasLaneDb)(
  "S4-DASH-BE-2 CROWN data-isolation (scope · tenant · cache · masking)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    const email = { aEmp: "", aOther: "", bEmp: "", uView: "", uNoView: "" };
    const ids = { aEmp: "", aOther: "", bEmp: "" };
    const TITLE = { aOwn: "", aOther: "", bOwn: "" };
    const SALARY = "99999777"; // số lương "bẫy" — nếu lọt ⇒ mask fail.
    const PII = { phone: "0900SECRETX", notes: "SECRET-NOTE-XYZ" };

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "dashsecA");
      B = await seedCompany(direct, "dashsecB");
      companyIds.push(A.companyId, B.companyId);

      // Roles A: emp (read:task Own) + hrView (read:employee + view-salary) + hrNoView (read:employee ONLY).
      const roleEmpA = await seedRole(direct, A.companyId, "dashsec-emp");
      await grant(direct, roleEmpA, "read", "dashboard", "Company");
      await grant(direct, roleEmpA, "read", "task", "Own");

      const roleHrView = await seedRole(direct, A.companyId, "dashsec-hr-view");
      await grant(direct, roleHrView, "read", "dashboard", "Company");
      await grant(direct, roleHrView, "read", "employee", "Company");
      await grant(direct, roleHrView, "view-salary", "employee", "Company");

      const roleHrNoView = await seedRole(direct, A.companyId, "dashsec-hr-noview");
      await grant(direct, roleHrNoView, "read", "dashboard", "Company");
      await grant(direct, roleHrNoView, "read", "employee", "Company");

      // Role B: emp (read:task Own) — company-scoped role riêng cho tenant B.
      const roleEmpB = await seedRole(direct, B.companyId, "dashsec-emp-b");
      await grant(direct, roleEmpB, "read", "dashboard", "Company");
      await grant(direct, roleEmpB, "read", "task", "Own");

      email.aEmp = `aemp@${A.slug}.test`;
      email.aOther = `aother@${A.slug}.test`;
      email.uView = `uview@${A.slug}.test`;
      email.uNoView = `unoview@${A.slug}.test`;
      email.bEmp = `bemp@${B.slug}.test`;

      ids.aEmp = await seedUser(direct, A.companyId, email.aEmp, hash);
      ids.aOther = await seedUser(direct, A.companyId, email.aOther, hash);
      const uView = await seedUser(direct, A.companyId, email.uView, hash);
      const uNoView = await seedUser(direct, A.companyId, email.uNoView, hash);
      ids.bEmp = await seedUser(direct, B.companyId, email.bEmp, hash);

      await seedUserRole(direct, ids.aEmp, roleEmpA, A.companyId);
      await seedUserRole(direct, ids.aOther, roleEmpA, A.companyId);
      await seedUserRole(direct, uView, roleHrView, A.companyId);
      await seedUserRole(direct, uNoView, roleHrNoView, A.companyId);
      await seedUserRole(direct, ids.bEmp, roleEmpB, B.companyId);

      // Tasks: own của aEmp, own của aOther (cùng company A), own của bEmp (company B).
      const sfx = randomUUID().slice(0, 8);
      TITLE.aOwn = `AEMP-OWN-${sfx}`;
      TITLE.aOther = `AOTHER-${sfx}`;
      TITLE.bOwn = `BEMP-${sfx}`;
      await seedTask(direct, A.companyId, ids.aEmp, TITLE.aOwn);
      await seedTask(direct, A.companyId, ids.aOther, TITLE.aOther);
      await seedTask(direct, B.companyId, ids.bEmp, TITLE.bOwn);

      // Employee "bẫy lương" trong A: base_salary + PII — HR_OVERVIEW chỉ được đếm, KHÔNG lộ các field này.
      const ou = await direct.query(
        "INSERT INTO org_units (company_id, name, type) VALUES ($1,'Sec-Dept','department') RETURNING id",
        [A.companyId],
      );
      await direct.query(
        `INSERT INTO employee_profiles
         (company_id, org_unit_id, status, base_salary, salary_type, phone, contract_type, notes)
       VALUES ($1,$2,'active',$3,'monthly',$4,'permanent',$5)`,
        [A.companyId, ou.rows[0].id as string, SALARY, PII.phone, PII.notes],
      );

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      await cleanupDashCache(direct, companyIds);
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    // ── S1 scope Own: emp CHỈ thấy task của chính mình, KHÔNG thấy task user khác cùng company ─────────
    it("S1 scope Own: /widgets/my-tasks của aEmp CHỨA task của mình, KHÔNG chứa task của aOther (cùng company)", async () => {
      const res = await api(nest)
        .get("/dashboard/widgets/my-tasks")
        .set(bearer(await login(nest, A.slug, email.aEmp)));
      expect(res.status).toBe(200);
      const blob = JSON.stringify(res.body.data.data);
      expect(blob.includes(TITLE.aOwn), "task của chính aEmp phải xuất hiện").toBe(true);
      expect(blob.includes(TITLE.aOther), "task của aOther KHÔNG được lọt scope Own").toBe(false);
    });

    // ── S2 cross-tenant: user company B KHÔNG thấy task company A ────────────────────────────────────
    it("S2 cross-tenant: /widgets/my-tasks của bEmp CHỨA task B, KHÔNG chứa BẤT KỲ task company A", async () => {
      const res = await api(nest)
        .get("/dashboard/widgets/my-tasks")
        .set(bearer(await login(nest, B.slug, email.bEmp)));
      expect(res.status).toBe(200);
      const blob = JSON.stringify(res.body.data.data);
      expect(blob.includes(TITLE.bOwn)).toBe(true);
      expect(blob.includes(TITLE.aOwn), "cross-tenant leak: task A lọt sang B").toBe(false);
      expect(blob.includes(TITLE.aOther), "cross-tenant leak: task A lọt sang B").toBe(false);
    });

    // ── S3 cache no-leak: cache_key(A)≠(B) · row B không chứa data A · cache A không đọc được dưới tenant B ──
    it("S3 cache no-leak: cache_key aEmp ≠ bEmp; row cache B KHÔNG chứa nội dung A; đọc cache A dưới GUC tenant B ⇒ 0 row", async () => {
      // Ép miss sạch rồi warm cache cho cả hai (self-contained, không phụ thuộc thứ tự test).
      await cleanupDashCache(direct, companyIds);
      await api(nest)
        .get("/dashboard/widgets/my-tasks")
        .set(bearer(await login(nest, A.slug, email.aEmp)));
      await api(nest)
        .get("/dashboard/widgets/my-tasks")
        .set(bearer(await login(nest, B.slug, email.bEmp)));

      const rows = await direct.query(
        "SELECT company_id, user_id, cache_key, data FROM dashboard_widget_cache WHERE cache_key LIKE '%:MY_TASKS:%' AND deleted_at IS NULL",
      );
      const rowA = rows.rows.find((r) => r.user_id === ids.aEmp);
      const rowB = rows.rows.find((r) => r.user_id === ids.bEmp);
      expect(rowA, "cache row aEmp").toBeTruthy();
      expect(rowB, "cache row bEmp").toBeTruthy();
      // cache_key per-user ⇒ KHÁC nhau; company_id tách bạch.
      expect(rowA.cache_key).not.toBe(rowB.cache_key);
      expect(rowA.company_id).toBe(A.companyId);
      expect(rowB.company_id).toBe(B.companyId);
      // Row cache của B KHÔNG chứa nội dung của A (không rò chéo qua cache).
      expect(JSON.stringify(rowB.data).includes(TITLE.aOwn)).toBe(false);

      // RLS: mediaos_app dưới GUC tenant B KHÔNG đọc được cache_key của A (dù biết đúng key).
      const c = await app.connect();
      try {
        await c.query("SELECT set_config('app.current_company_id', $1, true)", [B.companyId]);
        const leak = await c.query("SELECT id FROM dashboard_widget_cache WHERE cache_key = $1", [
          rowA.cache_key,
        ]);
        expect(leak.rows.length, "RLS: cache A đọc được dưới tenant B").toBe(0);
      } finally {
        c.release();
      }
    });

    // ── S4 masking-tier: HR_OVERVIEW viewer-independent — KHÔNG lộ lương/PII cho CẢ HAI tier ──────────
    it("S4 masking: uNoView (thiếu view-salary) /widgets/hr-overview → 200, KHÔNG lương/PII trong response", async () => {
      const res = await api(nest)
        .get("/dashboard/widgets/hr-overview")
        .set(bearer(await login(nest, A.slug, email.uNoView)));
      expect(res.status).toBe(200);
      const blob = JSON.stringify(res.body.data);
      for (const bad of [
        SALARY,
        PII.phone,
        PII.notes,
        "baseSalary",
        "salaryType",
        "contractType",
      ]) {
        expect(blob.includes(bad), `response lộ field cấm: ${bad}`).toBe(false);
      }
      // Có số liệu tổng hợp viewer-independent (headcount ≥ 1 vì employee bẫy tồn tại).
      expect(res.body.data.data.summary.headcount).toBeGreaterThanOrEqual(1);
    });

    it("S4 masking: uView (CÓ view-salary) /widgets/hr-overview → 200, VẪN KHÔNG lương/PII (viewer-independent)", async () => {
      const res = await api(nest)
        .get("/dashboard/widgets/hr-overview")
        .set(bearer(await login(nest, A.slug, email.uView)));
      expect(res.status).toBe(200);
      const blob = JSON.stringify(res.body.data);
      for (const bad of [
        SALARY,
        PII.phone,
        PII.notes,
        "baseSalary",
        "salaryType",
        "contractType",
      ]) {
        expect(blob.includes(bad), `response (view-salary) lộ field cấm: ${bad}`).toBe(false);
      }
    });

    it("S4 masking: cache HR_OVERVIEW share company-wide (user_id NULL, cache_scope Company) + KHÔNG lương/PII trong row", async () => {
      await cleanupDashCache(direct, [A.companyId]);
      // Cả hai tier đọc ⇒ nếu viewer-independent thì DÙNG CHUNG 1 cache_key company-wide.
      await api(nest)
        .get("/dashboard/widgets/hr-overview")
        .set(bearer(await login(nest, A.slug, email.uView)));
      await api(nest)
        .get("/dashboard/widgets/hr-overview")
        .set(bearer(await login(nest, A.slug, email.uNoView)));

      const rows = await direct.query(
        "SELECT user_id, cache_scope, cache_key, data FROM dashboard_widget_cache WHERE company_id=$1 AND cache_key LIKE '%:HR_OVERVIEW:%' AND deleted_at IS NULL",
        [A.companyId],
      );
      expect(rows.rows.length, "HR_OVERVIEW company-wide = 1 row chia sẻ").toBe(1);
      const row = rows.rows[0];
      expect(row.user_id, "company-shared ⇒ user_id NULL").toBeNull();
      expect(row.cache_scope).toBe("Company");
      const cacheBlob = JSON.stringify(row.data);
      for (const bad of [SALARY, PII.phone, PII.notes, "baseSalary", "salaryType"]) {
        expect(cacheBlob.includes(bad), `cache row lộ field cấm: ${bad}`).toBe(false);
      }
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S5 — authorize-before-aggregate: getProject gate TRƯỚC ⇒ listByProject KHÔNG chạy khi deny (spy)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasLaneDb)(
  "S4-DASH-BE-2 CROWN authorize-before-aggregate (project-progress)",
  () => {
    const direct = directPool();
    let nest: INestApplication;
    let A: SeededTenant;
    const companyIds: string[] = [];
    const email = { noProj: "", withProj: "" };
    let listByProjectSpy: MockInstance<TasksService["listByProject"]>;

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "dashsecP");
      companyIds.push(A.companyId);

      const roleNoProj = await seedRole(direct, A.companyId, "dashsec-noproj");
      await grant(direct, roleNoProj, "read", "dashboard", "Company");
      // KHÔNG read:project ⇒ gate widget 403.

      const roleWithProj = await seedRole(direct, A.companyId, "dashsec-withproj");
      await grant(direct, roleWithProj, "read", "dashboard", "Company");
      await grant(direct, roleWithProj, "read", "project", "Company");

      email.noProj = `noproj@${A.slug}.test`;
      email.withProj = `withproj@${A.slug}.test`;
      const uNo = await seedUser(direct, A.companyId, email.noProj, hash);
      const uWith = await seedUser(direct, A.companyId, email.withProj, hash);
      await seedUserRole(direct, uNo, roleNoProj, A.companyId);
      await seedUserRole(direct, uWith, roleWithProj, A.companyId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
      // Spy trên instance THẬT trong container (cùng instance mà handler inject as `this.tasks`).
      listByProjectSpy = vi.spyOn(nest.get(TasksService), "listByProject");
    });

    afterAll(async () => {
      listByProjectSpy?.mockRestore();
      await cleanupDashCache(direct, companyIds);
      await cleanupTenants(direct, companyIds);
      await direct.end();
      if (nest) await nest.close();
    });

    it("S5 thiếu read:project ⇒ 403 và listByProject KHÔNG được gọi (gate TRƯỚC aggregate)", async () => {
      listByProjectSpy.mockClear();
      const res = await api(nest)
        .get(`/dashboard/widgets/project-progress?project_id=${randomUUID()}`)
        .set(bearer(await login(nest, A.slug, email.noProj)));
      expect(res.status).toBe(403);
      expect(listByProjectSpy).not.toHaveBeenCalled();
    });

    it("S5 project ngoài scope/không tồn tại ⇒ 404 (getProject) và listByProject KHÔNG được gọi", async () => {
      listByProjectSpy.mockClear();
      const res = await api(nest)
        .get(`/dashboard/widgets/project-progress?project_id=${randomUUID()}`)
        .set(bearer(await login(nest, A.slug, email.withProj)));
      expect(res.status).toBe(404);
      expect(listByProjectSpy).not.toHaveBeenCalled();
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S6 — append-only: dashboard_widget_cache app role KHÔNG DELETE; soft-delete = UPDATE deleted_at (BẤT BIẾN #2)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasLaneDb)("S4-DASH-BE-2 CROWN append-only (dashboard_widget_cache)", () => {
  const direct = directPool();
  const app = appPool();
  let A: SeededTenant;
  const companyIds: string[] = [];
  let cacheId: string;

  beforeAll(async () => {
    A = await seedCompany(direct, "dashsecAO");
    companyIds.push(A.companyId);
    const widgetId = await globalWidgetId(direct, "MY_TASKS");
    const r = await direct.query(
      `INSERT INTO dashboard_widget_cache
         (company_id, widget_id, dashboard_type, cache_scope, cache_key, data, status, generated_at, expires_at)
       VALUES ($1,$2,'Employee','Own',$3,'{}'::jsonb,'Fresh', now(), now() + interval '5 minutes')
       RETURNING id`,
      [A.companyId, widgetId, `Employee:MY_TASKS:ao:${randomUUID().slice(0, 8)}`],
    );
    cacheId = r.rows[0].id as string;
  });

  afterAll(async () => {
    await cleanupDashCache(direct, companyIds);
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.end();
  });

  /** Chạy fn dưới role mediaos_app + GUC tenant (RLS+FORCE) trong 1 transaction. */
  async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }

  it("S6 app role DELETE dashboard_widget_cache bị TỪ CHỐI (không có quyền DELETE)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query("DELETE FROM dashboard_widget_cache WHERE id = $1", [cacheId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("S6 soft-delete = UPDATE deleted_at THÀNH CÔNG và row VẪN TỒN TẠI (invalidation, không hard-delete)", async () => {
    await asTenant(A.companyId, async (c) => {
      await c.query("UPDATE dashboard_widget_cache SET deleted_at = now() WHERE id = $1", [
        cacheId,
      ]);
    });
    const still = await direct.query(
      "SELECT deleted_at FROM dashboard_widget_cache WHERE id = $1",
      [cacheId],
    );
    expect(still.rows.length, "row vẫn tồn tại (soft-delete, không bị xoá vật lý)").toBe(1);
    expect(still.rows[0].deleted_at, "deleted_at đã được set").not.toBeNull();
  });
});

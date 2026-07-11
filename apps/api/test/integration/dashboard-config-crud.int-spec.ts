/**
 * S4-DASH-BE-3 — Dashboard widget CONFIG CRUD (HTTP, real permission engine + real DB, mig 0491).
 * Cửa: GET /dashboard/configs · PATCH /dashboard/configs/:id (API-10:310, DASH-API-201/203).
 *
 * RED-first — deny-path đi đầu (§7 plan WO S4-DASH-BE-3). Controller THỨ TƯ trên
 * @Controller("dashboard") sau DashboardController (report/…) + DashboardResolverController (me/types/…):
 * chưa hiện thực ⇒ /configs 404 (Nest không có route). Sau GREEN: 403/200/404 đúng semantics.
 *
 * ⚠ SAI LỆCH THỰC TẾ (đã probe DB, chống "reviewer pass real bug"):
 *   - role `employee` KHÔNG có view:leave ⇒ PENDING_LEAVE (gate tầng-2 = view:leave) là widget CHUẨN để
 *     chứng "config bật KHÔNG mở quyền xem": admin bật is_enabled cho PENDING_LEAVE ở dashboard Employee,
 *     employee VẪN không thấy (gate tầng-2), nhưng hr (CÓ view:leave) THẤY ⇒ config-active nhưng bị cap
 *     read-time (registry authoritative — permission-matrix-spec §7).
 *   - company-admin có cặp view/update:dashboard-config (mig 0484 DASH_GRANT_MATRIX); employee/hr KHÔNG
 *     (DASH_ADMIN_ONLY_PAIRS) ⇒ deny-path 403.
 *
 * Gate hasDb && LANE_DB (memory integration-test-lane-db-gate): .env trỏ DB dev chung (hasDb=true) → CHỈ
 * chạy trên DB cô lập lane (mediaos_dashbe3 đã áp mig 0491: GRANT UPDATE + object_type; nối tiếp head THẬT
 * 0490_s4_notiseed2 sau rebase/renumber), else đỏ-giả.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool, PoolClient } from "pg";
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

/** widget_id GLOBAL (company_id NULL) theo widget_code — mig 0484 seed catalog toàn cục. */
async function globalWidgetId(direct: Pool, widgetCode: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM dashboard_widgets WHERE widget_code = $1 AND company_id IS NULL AND deleted_at IS NULL",
    [widgetCode],
  );
  if (r.rows.length === 0) {
    throw new Error(
      `[S4-DASH-BE-3] global widget '${widgetCode}' không tồn tại — mig 0484 chạy trước`,
    );
  }
  return r.rows[0].id as string;
}

/** Plant 1 config Company-scope, trả về config id (direct pool, bypass RLS). */
async function seedConfig(
  direct: Pool,
  companyId: string,
  dashboardType: string,
  widgetCode: string,
  sortOrder: number,
  isEnabled = true,
): Promise<string> {
  const widgetId = await globalWidgetId(direct, widgetCode);
  const r = await direct.query(
    `INSERT INTO dashboard_widget_configs
       (company_id, widget_id, dashboard_type, config_scope, role_id, user_id, is_enabled, sort_order)
     VALUES ($1, $2, $3, 'Company', NULL, NULL, $4, $5) RETURNING id`,
    [companyId, widgetId, dashboardType, isEnabled, sortOrder],
  );
  return r.rows[0].id as string;
}

async function canonicalRoleId(direct: Pool, name: string): Promise<string> {
  const r = await direct.query(
    "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
    [name],
  );
  if (r.rows.length === 0) {
    throw new Error(
      `[S4-DASH-BE-3] canonical role không tồn tại: ${name} (mig 0005/0444 chạy trước)`,
    );
  }
  return r.rows[0].id as string;
}

function patch(app: INestApplication, id: string, h: Record<string, string>) {
  return api(app).patch(`/dashboard/configs/${id}`).set(h);
}

describe.skipIf(!hasLaneDb)("S4-DASH-BE-3 Dashboard config CRUD (HTTP)", () => {
  const direct = directPool();
  const app = appPool();
  let nest: INestApplication;

  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];

  const email = { admin: "", emp: "", hr: "" };
  let adminUserId = "";

  // Config ids per test-purpose (tránh 1 test PATCH clobber assert của test khác).
  let patchOkCfgId = ""; // HR dashboard — admin PATCH 200 (T1)
  let auditCfgId = ""; //   HR dashboard — audit-on-change (T4), assert đúng 1 audit row
  let appendCfgId = ""; //  HR dashboard — append-only (T5): PATCH=UPDATE, DELETE denied
  let pendingLeaveEmpId = ""; // Employee dashboard — escalation (T3), is_enabled=false ban đầu
  let configBId = ""; //    company B — cross-tenant (T2)

  beforeAll(async () => {
    const hash = await hashedPw();
    A = await seedCompany(direct, "dashbe3a");
    B = await seedCompany(direct, "dashbe3b");
    companyIds.push(A.companyId, B.companyId);

    const roleEmp = await canonicalRoleId(direct, "employee");
    const roleHr = await canonicalRoleId(direct, "hr");
    const roleAdmin = await canonicalRoleId(direct, "company-admin");

    email.admin = `admin@${A.slug}.test`;
    email.emp = `emp@${A.slug}.test`;
    email.hr = `hr@${A.slug}.test`;

    const uAdmin = await seedUser(direct, A.companyId, email.admin, hash);
    const uEmp = await seedUser(direct, A.companyId, email.emp, hash);
    const uHr = await seedUser(direct, A.companyId, email.hr, hash);
    adminUserId = uAdmin;

    await seedUserRole(direct, uAdmin, roleAdmin, A.companyId);
    await seedUserRole(direct, uEmp, roleEmp, A.companyId);
    await seedUserRole(direct, uHr, roleHr, A.companyId);

    // Employee dashboard defaults cho A (nguồn resolver read cho escalation/precedence).
    await seedConfig(direct, A.companyId, "Employee", "ATTENDANCE_TODAY", 10);
    await seedConfig(direct, A.companyId, "Employee", "MY_TASKS", 20);
    await seedConfig(direct, A.companyId, "Employee", "TASK_ALERTS", 30);
    await seedConfig(direct, A.companyId, "Employee", "NOTIFICATIONS", 50);
    // PENDING_LEAVE (gate tầng-2 = view:leave) DISABLED — escalation bật lên nhưng emp vẫn bị cap read-time.
    pendingLeaveEmpId = await seedConfig(
      direct,
      A.companyId,
      "Employee",
      "PENDING_LEAVE",
      99,
      false,
    );

    // HR dashboard — target PATCH riêng (KHÔNG đụng resolver Employee read của emp/hr assert khác).
    patchOkCfgId = await seedConfig(direct, A.companyId, "HR", "HR_OVERVIEW", 10);
    auditCfgId = await seedConfig(direct, A.companyId, "HR", "TASK_ALERTS", 20);
    appendCfgId = await seedConfig(direct, A.companyId, "HR", "MY_TASKS", 30);

    // company B — cross-tenant target (T2).
    configBId = await seedConfig(direct, B.companyId, "Employee", "NOTIFICATIONS", 10);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    nest = moduleRef.createNestApplication();
    nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    nest.useGlobalFilters(new AllExceptionsFilter());
    await nest.init();
  });

  afterAll(async () => {
    await cleanupTenants(direct, companyIds);
    await direct.end();
    await app.end();
    if (nest) await nest.close();
  });

  // ── T1 permission deny (PermissionGuard class-level chặn TRƯỚC xử lý) ────────────────────────────────
  it("T1 employee THIẾU view:dashboard-config → GET /dashboard/configs = 403", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await api(nest).get("/dashboard/configs").set(h);
    expect(res.status).toBe(403);
  });

  it("T1 employee THIẾU update:dashboard-config → PATCH /configs/:id = 403 (gate TRƯỚC xử lý: KHÔNG mutate, KHÔNG audit)", async () => {
    const h = bearer(await login(nest, A.slug, email.emp));
    const res = await patch(nest, patchOkCfgId, h).send({ sort_order: 99 });
    expect(res.status).toBe(403);
    // PermissionGuard chặn TRƯỚC service ⇒ TUYỆT ĐỐI KHÔNG side-effect (fail-closed): sort_order giữ nguyên
    // giá trị seed (10, chưa test nào mutate patchOkCfgId trước đây), KHÔNG audit CONFIG_UPDATE nào được ghi.
    // Không guard = 200 + mutate + audit ⇒ hai assert dưới đi RED (chứng test KHÔNG false-green).
    const row = await direct.query(
      "SELECT sort_order FROM dashboard_widget_configs WHERE id = $1",
      [patchOkCfgId],
    );
    expect(row.rows[0].sort_order).toBe(10);
    const aud = await direct.query(
      `SELECT 1 FROM audit_logs
        WHERE object_type = 'dashboard_widget_config' AND object_id = $1
          AND action_group = 'CONFIG_UPDATE'`,
      [patchOkCfgId],
    );
    expect(aud.rows).toHaveLength(0);
  });

  it("T1 company-admin CÓ cặp → GET /configs = 200 (list envelope items[])", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await api(nest).get("/dashboard/configs").set(h);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });

  it("T1 company-admin PATCH /configs/:id (sort_order) → 200 + trả item đã cập nhật", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, patchOkCfgId, h).send({ sort_order: 15 });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(patchOkCfgId);
    expect(res.body.data.sort_order).toBe(15);
    expect(res.body.data.widget_code).toBe("HR_OVERVIEW");
  });

  // ── T2 cross-tenant (RLS ẩn row company khác — 404, KHÔNG 403 lộ tồn tại) ─────────────────────────────
  it("T2 admin A PATCH id config của company B → 404 DASH-ERR-NOT_FOUND", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, configBId, h).send({ sort_order: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DASH-ERR-NOT_FOUND");
    // Bằng chứng ĐỘC LẬP (không chỉ dựa status 404): PATCH chéo-tenant KHÔNG side-effect lên row company B.
    // direct/superuser đọc bypass RLS ⇒ thấy giá trị thật; sort_order phải GIỮ NGUYÊN giá trị seed (10),
    // KHÔNG bị đổi thành 5. Nếu RLS/tenant-filter thủng ⇒ assert này đi RED.
    const bRow = await direct.query(
      "SELECT sort_order FROM dashboard_widget_configs WHERE id = $1",
      [configBId],
    );
    expect(bRow.rows[0].sort_order).toBe(10);
  });

  it("T2 admin A GET /configs KHÔNG chứa row của company B", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await api(nest).get("/dashboard/configs").set(h);
    expect(res.status).toBe(200);
    const ids = (res.body.data.items as Array<{ id: string }>).map((i) => i.id);
    expect(ids).not.toContain(configBId);
    expect(ids).toContain(patchOkCfgId);
  });

  it("T2 filter dashboard_type=HR → chỉ trả config HR dashboard của A", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await api(nest).get("/dashboard/configs?dashboard_type=HR").set(h);
    expect(res.status).toBe(200);
    const types = new Set(
      (res.body.data.items as Array<{ dashboard_type: string }>).map((i) => i.dashboard_type),
    );
    expect(types).toEqual(new Set(["HR"]));
  });

  // ── T3 config-không-escalate (registry tier-2 authoritative) ─────────────────────────────────────────
  it("T3 admin bật is_enabled=true cho PENDING_LEAVE(Employee) → employee THIẾU view:leave VẪN không thấy", async () => {
    const admin = bearer(await login(nest, A.slug, email.admin));
    const upd = await patch(nest, pendingLeaveEmpId, admin).send({ is_enabled: true });
    expect(upd.status).toBe(200);
    expect(upd.body.data.is_enabled).toBe(true);

    const emp = bearer(await login(nest, A.slug, email.emp));
    const view = await api(nest).get("/dashboard/employee").set(emp);
    expect(view.status).toBe(200);
    const codes = (view.body.data.widgets as Array<{ widget_code: string }>).map(
      (w) => w.widget_code,
    );
    expect(codes).not.toContain("PENDING_LEAVE");
  });

  it("T3 chứng config-active (không phải chưa bật): hr CÓ view:leave → THẤY PENDING_LEAVE ở dashboard Employee", async () => {
    const hr = bearer(await login(nest, A.slug, email.hr));
    const view = await api(nest).get("/dashboard/employee").set(hr);
    expect(view.status).toBe(200);
    const codes = (view.body.data.widgets as Array<{ widget_code: string }>).map(
      (w) => w.widget_code,
    );
    expect(codes).toContain("PENDING_LEAVE");
  });

  // ── T4 audit-on-change (append-only, cùng withTenant tx) ─────────────────────────────────────────────
  it("T4 PATCH thành công ghi ĐÚNG 1 audit_logs object_type=dashboard_widget_config CONFIG_UPDATE", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, auditCfgId, h).send({ sort_order: 25 });
    expect(res.status).toBe(200);

    const rows = await direct.query(
      `SELECT action, action_group, permission_code, module_code, actor_user_id,
              old_values, new_values, changed_fields
         FROM audit_logs
        WHERE object_type = 'dashboard_widget_config' AND object_id = $1`,
      [auditCfgId],
    );
    expect(rows.rows).toHaveLength(1);
    const a = rows.rows[0];
    expect(a.action_group).toBe("CONFIG_UPDATE");
    expect(a.permission_code).toBe("DASH.CONFIG.UPDATE");
    expect(a.module_code).toBe("DASH");
    expect(a.actor_user_id).toBe(adminUserId);
    // before ≠ after: sort_order 20 → 25 (snapshot config-only).
    expect(a.old_values.sort_order).toBe(20);
    expect(a.new_values.sort_order).toBe(25);
    expect(a.changed_fields).toContain("sort_order");
  });

  // ── T5 append-only (BẤT BIẾN #2) ─────────────────────────────────────────────────────────────────────
  it("T5 PATCH là UPDATE (row cũ giữ, updated_at đổi)", async () => {
    const before = await direct.query(
      "SELECT updated_at FROM dashboard_widget_configs WHERE id = $1",
      [appendCfgId],
    );
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, appendCfgId, h).send({ sort_order: 35 });
    expect(res.status).toBe(200);
    const after = await direct.query(
      "SELECT id, sort_order, updated_at, deleted_at FROM dashboard_widget_configs WHERE id = $1",
      [appendCfgId],
    );
    expect(after.rows).toHaveLength(1); // row vẫn tồn tại (UPDATE, không DELETE)
    expect(after.rows[0].sort_order).toBe(35);
    expect(after.rows[0].deleted_at).toBeNull();
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].updated_at).getTime(),
    );
  });

  it("T5 app role KHÔNG DELETE dashboard_widget_configs (thiếu DELETE grant → permission denied)", async () => {
    await expect(
      asTenant(A.companyId, async (c) => {
        await c.query("DELETE FROM dashboard_widget_configs WHERE id = $1", [appendCfgId]);
      }),
    ).rejects.toThrow(/permission denied/);
  });

  // ── T6 validation (400 ở ranh giới, KHÔNG 500) ───────────────────────────────────────────────────────
  it("T6 PATCH body rỗng {} → 400 (.refine ít nhất 1 field)", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, patchOkCfgId, h).send({});
    expect(res.status).toBe(400);
  });

  it("T6 data_scope_override ngoài enum → 400", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, patchOkCfgId, h).send({ data_scope_override: "Xxx" });
    expect(res.status).toBe(400);
  });

  it("T6 id không phải uuid → 400 (ParseUUIDPipe, KHÔNG 500)", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, "not-a-uuid", h).send({ sort_order: 1 });
    expect(res.status).toBe(400);
  });

  it("T6 id uuid hợp lệ nhưng không tồn tại → 404 DASH-ERR-NOT_FOUND", async () => {
    const h = bearer(await login(nest, A.slug, email.admin));
    const res = await patch(nest, randomUUID(), h).send({ sort_order: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("DASH-ERR-NOT_FOUND");
  });

  // ── T7 precedence effect (User>Role>Company giữ nguyên ở registry) — LAST (mutate default) ────────────
  it("T7 admin PATCH is_enabled=false config Company của 1 widget → resolver bỏ widget khỏi dashboard", async () => {
    // Dùng ATTENDANCE_TODAY (gate tầng-2 = view-own:attendance — employee CÓ) để chứng precedence:
    // bật/tắt is_enabled ở config Company đổi đúng danh sách widget resolver trả (User>Role>Company giữ nguyên).
    const atRow = await direct.query(
      `SELECT c.id FROM dashboard_widget_configs c
         JOIN dashboard_widgets w ON w.id = c.widget_id
        WHERE c.company_id = $1 AND c.dashboard_type = 'Employee'
          AND w.widget_code = 'ATTENDANCE_TODAY' AND c.deleted_at IS NULL`,
      [A.companyId],
    );
    const atId = atRow.rows[0].id as string;

    const admin = bearer(await login(nest, A.slug, email.admin));
    const emp1 = bearer(await login(nest, A.slug, email.emp));
    const seen0 = await api(nest).get("/dashboard/employee").set(emp1);
    expect(
      (seen0.body.data.widgets as Array<{ widget_code: string }>).map((w) => w.widget_code),
    ).toContain("ATTENDANCE_TODAY");

    const upd = await patch(nest, atId, admin).send({ is_enabled: false });
    expect(upd.status).toBe(200);

    const emp2 = bearer(await login(nest, A.slug, email.emp));
    const seen1 = await api(nest).get("/dashboard/employee").set(emp2);
    expect(
      (seen1.body.data.widgets as Array<{ widget_code: string }>).map((w) => w.widget_code),
    ).not.toContain("ATTENDANCE_TODAY");
  });

  // ── smoke ────────────────────────────────────────────────────────────────────────────────────────────
  it("smoke: GET /dashboard/configs không token → 401", async () => {
    expect((await api(nest).get("/dashboard/configs")).status).toBe(401);
  });

  /** Chạy fn trong 1 transaction bằng app role (mediaos_app) với tenant GUC set. */
  async function asTenant<T>(companyId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
});

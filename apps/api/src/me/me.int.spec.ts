/**
 * S5-ME-BE-1 — MeModule integration (Postgres THẬT, DB CÔ LẬP). Chứng minh trên đường THẬT (guard global +
 * PermissionGuard cổng ME.ACCESS + RLS+FORCE qua withTenant) các bất biến KHÔNG mock được:
 *   deny      : user KHÔNG có ME.ACCESS → 403 trên CẢ 6 route (guard fail-closed).
 *   forbidden : MA TRẬN 5 nguồn — user CÓ ME.ACCESS + linked nhưng THIẾU 1 source-pair → section='forbidden',
 *               section khác='ok', HTTP 200 (assert /me/overview LẪN route section chuyên biệt).
 *   IDOR      : ?user_id / body{employee_id} lạ → response chỉ dữ liệu caller (từ token), hành vi KHÔNG đổi.
 *   own-scope : A không thấy dữ liệu B cùng tenant.
 *   x-tenant  : token tenant X không surface dữ liệu tenant Y (planted rows) — section employee của X.
 *   unlinked  : user chưa liên kết employee → hr/att/leave='unlinked_employee', task/noti='ok', identity ok.
 *   disabled  : company_settings module.<code>.enabled=false → 'module_disabled'; no-row → 'ok' (không stale).
 *   degraded  : reader nguồn ném non-HttpException (spy) → section='error', HTTP 200 (KHÔNG 500).
 *
 * Anomaly >1 employee (§12.4) không dựng được ở DB (partial-unique (company_id,user_id) WHERE deleted_at IS
 * NULL chặn 2 non-deleted) ⇒ CHỨNG MINH ở me-current-person.resolver.spec.ts (mock repo → 2 rows → 409+audit).
 * Classification 403/404/infra chi tiết ở me-aggregation.service.spec.ts (unit).
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane (bash scripts/lane-db-setup.sh me → export LANE_DB=mediaos_me).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { TaskCoreService } from "../tasks/task-core.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!me-be-1";

/** (action, resourceType, isSensitive) — khớp NGUYÊN VĂN decorator/seed module nguồn + mig 0495. */
const PAIR = {
  accessMe: ["access", "me", false],
  hr: ["read", "employee", false],
  att: ["view-own", "attendance", true],
  leave: ["view-own", "leave-balance", false],
  task: ["read", "task", false],
  noti: ["read", "notification", false],
} as const;
type Triple = readonly [string, string, boolean];

const ALL_SOURCE: Triple[] = [PAIR.hr, PAIR.att, PAIR.leave, PAIR.task, PAIR.noti];
const ROUTES = [
  "/me",
  "/me/overview",
  "/me/attendance-summary",
  "/me/leave-summary",
  "/me/task-summary",
  "/me/notification-summary",
] as const;

async function insertEmployee(
  direct: Pool,
  companyId: string,
  userId: string,
  code: string,
  status = "active",
): Promise<string> {
  const r = await direct.query(
    "INSERT INTO employee_profiles (company_id, user_id, status, employee_code) VALUES ($1,$2,$3,$4) RETURNING id",
    [companyId, userId, status, code],
  );
  return r.rows[0].id as string;
}

async function seedRoleWithPairs(
  direct: Pool,
  companyId: string,
  name: string,
  pairs: Triple[],
): Promise<string> {
  const roleId = await seedRole(direct, companyId, name);
  for (const [action, rt, sensitive] of pairs) {
    const permId = await seedPermissionCatalog(direct, action, rt, sensitive);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Own");
  }
  return roleId;
}

describe.skipIf(!runDb)("S5-ME-BE-1 MeModule (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let pw: string;
  let A: SeededTenant;
  let B: SeededTenant;
  const companyIds: string[] = [];
  let seq = 0;

  /** Seed user + optional role + optional employee, login → { userId, token, empCode }. */
  async function makeUser(
    tenant: SeededTenant,
    opts: { roleId?: string; withEmployee?: boolean; empCode?: string },
  ): Promise<{ userId: string; token: string; empCode: string | null }> {
    const tag = `u${++seq}`;
    const email = `${tag}-${tenant.slug}@x.test`;
    const userId = await seedUser(direct, tenant.companyId, email, pw);
    if (opts.roleId) await seedUserRole(direct, userId, opts.roleId, tenant.companyId);
    let empCode: string | null = null;
    if (opts.withEmployee !== false) {
      empCode = opts.empCode ?? `E-${tag}`;
      await insertEmployee(direct, tenant.companyId, userId, empCode);
    }
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: tenant.slug, email, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    return { userId, token: login.body.data.accessToken as string, empCode };
  }

  function get(path: string, token: string) {
    return request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    pw = await new PasswordService().hash(LOGIN_PW);
    A = await seedCompany(direct, "mebe1a");
    B = await seedCompany(direct, "mebe1b");
    companyIds.push(A.companyId, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── deny-path: no ME.ACCESS → 403 on all 6 routes ──────────────────────────────
  it("deny — user KHÔNG có cặp ME.ACCESS → 403 trên CẢ 6 route", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-no-access", [PAIR.noti]);
    const { token } = await makeUser(A, { roleId });
    for (const route of ROUTES) {
      const res = await get(route, token);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
    }
  });

  // ── forbidden matrix: 5 sources ────────────────────────────────────────────────
  const MATRIX: { name: keyof typeof PAIR; section: string; route: string | null }[] = [
    { name: "hr", section: "hr", route: null },
    { name: "att", section: "attendance", route: "/me/attendance-summary" },
    { name: "leave", section: "leave", route: "/me/leave-summary" },
    { name: "task", section: "task", route: "/me/task-summary" },
    { name: "noti", section: "notification", route: "/me/notification-summary" },
  ];

  it.each(MATRIX)(
    "forbidden matrix — thiếu source-pair $section → section='forbidden', khác='ok', HTTP 200",
    async ({ name, section, route }) => {
      const missing = PAIR[name];
      const pairs: Triple[] = [
        PAIR.accessMe,
        ...ALL_SOURCE.filter((p) => !(p[0] === missing[0] && p[1] === missing[1])),
      ];
      const roleId = await seedRoleWithPairs(direct, A.companyId, `me-no-${section}`, pairs);
      const { token } = await makeUser(A, { roleId, withEmployee: true });

      // /me/overview: target section forbidden, 4 section còn lại ok, HTTP 200.
      const ov = await get("/me/overview", token);
      expect(ov.status, JSON.stringify(ov.body)).toBe(200);
      const sections = ov.body.data as Record<string, { status: string }>;
      expect(sections[section].status).toBe("forbidden");
      for (const s of ["hr", "attendance", "leave", "task", "notification"]) {
        if (s !== section) expect(sections[s].status, `${s} phải ok`).toBe("ok");
      }

      // Route section chuyên biệt (att/leave/task/noti) cũng 'forbidden' + 200; HR không có route riêng.
      if (route) {
        const res = await get(route, token);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("forbidden");
      } else {
        // HR: /me (identity) vẫn 200 (account + link ok — cổng ME.ACCESS pass).
        const me = await get("/me", token);
        expect(me.status).toBe(200);
        expect(me.body.data.account.userId).toBeTruthy();
      }
    },
  );

  // ── IDOR: client-supplied user_id/employee_id ignored ─────────────────────────
  it("IDOR — ?user_id=B / body{employee_id:B} bị BỎ QUA: response chỉ dữ liệu caller", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-full-idor", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const caller = await makeUser(A, { roleId, empCode: "E-CALLER" });
    const victim = await makeUser(A, { roleId, empCode: "E-VICTIM" });

    const baseline = await get("/me", caller.token);
    expect(baseline.status).toBe(200);
    expect(baseline.body.data.employee.employeeCode).toBe("E-CALLER");

    // Truyền owner ID lạ qua query + body — controller KHÔNG khai @Query/@Body ⇒ bỏ qua, KHÔNG đổi hành vi.
    const attack = await request(app.getHttpServer())
      .get(`/me?user_id=${victim.userId}&employee_id=${victim.userId}`)
      .set("Authorization", `Bearer ${caller.token}`)
      .send({ user_id: victim.userId, employee_id: victim.userId });
    expect(attack.status).toBe(200);
    expect(attack.body.data.account.userId).toBe(caller.userId);
    expect(attack.body.data.employee.employeeCode).toBe("E-CALLER");
  });

  // ── own-scope: A không thấy B (cùng tenant) ────────────────────────────────────
  it("own-scope — user A không lộ dữ liệu employee của user B cùng tenant", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-full-own", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const a = await makeUser(A, { roleId, empCode: "E-OWN-A" });
    const b = await makeUser(A, { roleId, empCode: "E-OWN-B" });

    const ovA = await get("/me/overview", a.token);
    expect(ovA.status).toBe(200);
    expect(ovA.body.data.identity.employee.employeeCode).toBe("E-OWN-A");
    expect(ovA.body.data.hr.data.employeeCode).toBe("E-OWN-A");
    expect(JSON.stringify(ovA.body.data)).not.toContain("E-OWN-B");
    expect(JSON.stringify(ovA.body.data)).not.toContain(b.userId);
  });

  // ── cross-tenant: token tenant X không surface dữ liệu tenant Y ────────────────
  it("cross-tenant — token tenant A không surface employee của tenant B (planted rows)", async () => {
    const roleA = await seedRoleWithPairs(direct, A.companyId, "me-full-xa", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const a = await makeUser(A, { roleId: roleA, empCode: "E-XT-A" });
    // Plant employee tenant B gắn CÙNG user id A (mô phỏng dữ liệu lệch) — RLS withTenant(A) không được lấy.
    await insertEmployee(direct, B.companyId, a.userId, "E-XT-B-PLANT");

    const me = await get("/me", a.token);
    expect(me.status).toBe(200);
    expect(me.body.data.employee.employeeCode).toBe("E-XT-A");
    expect(JSON.stringify(me.body.data)).not.toContain("E-XT-B-PLANT");
  });

  // ── unlinked employee ──────────────────────────────────────────────────────────
  it("unlinked — user chưa liên kết employee → hr/att/leave='unlinked_employee', task/noti='ok', identity ok", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-full-unlinked", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token, userId } = await makeUser(A, { roleId, withEmployee: false });

    const ov = await get("/me/overview", token);
    expect(ov.status, JSON.stringify(ov.body)).toBe(200);
    expect(ov.body.data.identity.linkStatus).toBe("unlinked");
    expect(ov.body.data.identity.employee).toBeNull();
    expect(ov.body.data.identity.account.userId).toBe(userId);
    expect(ov.body.data.hr.status).toBe("unlinked_employee");
    expect(ov.body.data.attendance.status).toBe("unlinked_employee");
    expect(ov.body.data.leave.status).toBe("unlinked_employee");
    expect(ov.body.data.task.status).toBe("ok");
    expect(ov.body.data.notification.status).toBe("ok");
  });

  // ── module_disabled + all-modules-ok ───────────────────────────────────────────
  it("module_disabled — company_settings module.LEAVE.enabled=false → 'module_disabled'; no-row → 'ok'", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-full-moddis", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token } = await makeUser(A, { roleId });

    // all-modules-ok chốt (chưa seed row nào): leave='ok'.
    const before = await get("/me/leave-summary", token);
    expect(before.status).toBe(200);
    expect(before.body.data.status).toBe("ok");

    // core-lock chỉ chặn toggle API, KHÔNG chặn value → insert THẲNG jsonb false.
    await direct.query(
      `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, status)
       VALUES ($1, 'module.LEAVE.enabled', 'false'::jsonb, 'Boolean', 'module', 'Active')`,
      [A.companyId],
    );
    const after = await get("/me/leave-summary", token);
    expect(after.status).toBe(200);
    expect(after.body.data.status).toBe("module_disabled");
    expect(after.body.data.data).toBeNull();

    const ov = await get("/me/overview", token);
    expect(ov.body.data.leave.status).toBe("module_disabled");
    // module khác không seed → vẫn ok (không stale).
    expect(ov.body.data.notification.status).toBe("ok");

    // Dọn NGAY (company_settings không nằm trong cleanup per-test) để KHÔNG rò trạng thái sang test sau.
    await direct.query(
      "DELETE FROM company_settings WHERE company_id = $1 AND setting_key = 'module.LEAVE.enabled'",
      [A.companyId],
    );
  });

  // ── degraded: reader ném non-HttpException → 'error', HTTP 200 (KHÔNG 500) ─────
  it("degraded — TaskCoreService.getMyTasks ném lỗi hạ tầng → task.status='error', HTTP 200", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-full-degraded", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token } = await makeUser(A, { roleId });

    const taskCore = app.get(TaskCoreService);
    const spy = vi
      .spyOn(taskCore, "getMyTasks")
      .mockRejectedValue(new Error("simulated infra failure"));
    try {
      const res = await get("/me/task-summary", token);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("error");
      expect(res.body.data.data).toBeNull();

      const ov = await get("/me/overview", token);
      expect(ov.status).toBe(200);
      expect(ov.body.data.task.status).toBe("error");
      // 1 nguồn lỗi KHÔNG làm hỏng section khác.
      expect(ov.body.data.notification.status).toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  // ── happy: full grants + linked → mọi section ok ───────────────────────────────
  it("happy — user full-grant + linked → /me/overview 200, mọi section 'ok'", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "me-full-happy", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token } = await makeUser(A, { roleId, empCode: "E-HAPPY" });
    const ov = await get("/me/overview", token);
    expect(ov.status, JSON.stringify(ov.body)).toBe(200);
    for (const s of ["hr", "attendance", "leave", "task", "notification"]) {
      expect(ov.body.data[s].status, `${s}`).toBe("ok");
    }
    expect(ov.body.data.identity.linkStatus).toBe("linked");
  });
});

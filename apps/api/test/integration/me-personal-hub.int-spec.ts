/**
 * S5-ME-BE-1 (lane meinttests) — MeModule Personal Hub integration (Postgres THẬT, DB CÔ LẬP).
 *
 * Đây là int-spec CANONICAL cho CI (test/integration/*.int-spec.ts, gate `hasDb && LANE_DB`). Chứng minh
 * trên ĐƯỜNG THẬT (JwtAuthGuard global 401 · PermissionGuard cổng ME.ACCESS 403 · RLS+FORCE qua withTenant)
 * các bất biến KHÔNG mock được, phủ TOÀN BỘ ma trận nghiệm thu SPEC-09 §11.2/§12/§13/§14:
 *   deny         : user KHÔNG có cặp ME.ACCESS → 403 AUTH-ERR-FORBIDDEN trên CẢ 6 route (fail-closed).
 *   forbidden(5) : MA TRẬN ĐỦ 5 NGUỒN (HR/ATT/LEAVE/TASK/NOTI) — CÓ ME.ACCESS nhưng THIẾU 1 source-pair →
 *                  section X='forbidden' + section khác='ok' + HTTP 200; assert /me/overview LẪN route riêng.
 *   IDOR         : ?user_id=<B> / body{employee_id:<B>} bị BỎ QUA — response chỉ dữ liệu caller (từ token).
 *   own-scope    : user A KHÔNG lộ dữ liệu employee của user B cùng tenant qua bất kỳ route ME.
 *   x-tenant     : token tenant A KHÔNG surface dữ liệu tenant B (planted rows) — RLS ép.
 *   degraded     : reader nguồn (TASK) ném non-HttpException → task.status='error', khác 'ok', HTTP 200 (KHÔNG 500).
 *   404≠forbidden: reader nguồn (HR) ném NotFoundException(404) → section='ok'+data null (KHÔNG dán 'forbidden').
 *   unlinked     : user chưa liên kết employee → hr/att/leave='unlinked_employee', task/noti='ok', identity ok.
 *   module_disab : company_settings module.<code>.enabled=false → 'module_disabled'; no-row → 'ok' (không stale).
 *   multi-emp    : user link >1 employee active → 409 ME-ERR-DATA-INCONSISTENT + ghi audit object_type='user'
 *                  (KHÔNG tự chọn). Partial-unique (company_id,user_id) WHERE deleted_at IS NULL chặn 2 rows
 *                  ở DB ⇒ dựng bằng SPY MeRepository (defense-in-depth path — resolver vẫn fail-LOUD).
 *   happy/routes : full-grant + linked → 6 route đều 200, mọi section 'ok', section-envelope hợp lệ.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane:
 *   bash scripts/lane-db-setup.sh me → export LANE_DB=mediaos_me → pnpm --filter @mediaos/api test
 */

import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { TaskCoreService } from "../../src/tasks/task-core.service";
import { HrReadService } from "../../src/employees/hr-read.service";
import { AuditService } from "../../src/events/audit.service";
import { MeRepository } from "../../src/me/me.repository";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

// Chạy CHỈ khi có Postgres THẬT + LANE_DB (không skip-giả trên DB dev chung — memory gate).
const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!me-inttests-1";

/** (action, resourceType, isSensitive) — khớp NGUYÊN VĂN decorator/seed module nguồn + mig 0495 (access:me). */
const PAIR = {
  accessMe: ["access", "me", false], // ME.ACCESS — mig 0495 (action='access', resourceType='me', is_sensitive=false)
  hr: ["read", "employee", false], // HR    → hr-read.controller read:employee
  att: ["view-own", "attendance", true], // ATT   → attendance VIEW_OWN (mig 0454 is_sensitive=TRUE)
  leave: ["view-own", "leave-balance", false], // LEAVE → leave VIEW_OWN_BALANCE
  task: ["read", "task", false], // TASK  → tasks getMyTasks
  noti: ["read", "notification", false], // NOTI  → my-notifications READ_NOTIFICATION
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
const SECTION_ROUTES = [
  "/me/attendance-summary",
  "/me/leave-summary",
  "/me/task-summary",
  "/me/notification-summary",
] as const;
const SECTIONS = ["hr", "attendance", "leave", "task", "notification"] as const;

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
    // scope 'Own' — mirror mig 0495 (ME đọc-lại own của chính user).
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Own");
  }
  return roleId;
}

describe.skipIf(!runDb)("S5-ME-BE-1 MeModule Personal Hub (DB cô lập, đường thật)", () => {
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
    opts: { roleId?: string; withEmployee?: boolean; empCode?: string } = {},
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
    A = await seedCompany(direct, "meit-a");
    B = await seedCompany(direct, "meit-b");
    companyIds.push(A.companyId, B.companyId);
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── (a) deny-path RED: no ME.ACCESS → 403 AUTH-ERR-FORBIDDEN on all 6 routes ────
  it("deny — user KHÔNG có cặp ME.ACCESS → 403 AUTH-ERR-FORBIDDEN trên CẢ 6 route", async () => {
    // Có quyền NOTI nhưng KHÔNG có access:me ⇒ cổng ME.ACCESS chặn TRƯỚC khi vào bất kỳ section.
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-no-access", [PAIR.noti]);
    const { token } = await makeUser(A, { roleId });
    for (const route of ROUTES) {
      const res = await get(route, token);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.error.code, `${route} code`).toBe("AUTH-ERR-FORBIDDEN");
    }
  });

  // ── (a2) JwtAuthGuard global: chưa auth → 401 ──────────────────────────────────
  it("unauth — không kèm Bearer → 401 trên mọi route ME (guard global)", async () => {
    for (const route of ROUTES) {
      const res = await request(app.getHttpServer()).get(route);
      expect(res.status, `${route}`).toBe(401);
    }
  });

  // ── (b) MA TRẬN forbidden per-section — ĐỦ 5 NGUỒN ─────────────────────────────
  const MATRIX: {
    name: keyof typeof PAIR;
    section: (typeof SECTIONS)[number];
    route: string | null;
  }[] = [
    { name: "hr", section: "hr", route: null },
    { name: "att", section: "attendance", route: "/me/attendance-summary" },
    { name: "leave", section: "leave", route: "/me/leave-summary" },
    { name: "task", section: "task", route: "/me/task-summary" },
    { name: "noti", section: "notification", route: "/me/notification-summary" },
  ];

  it.each(MATRIX)(
    "forbidden matrix — CÓ ME.ACCESS + THIẾU source $section → section='forbidden', khác='ok', HTTP 200",
    async ({ name, section, route }) => {
      const missing = PAIR[name];
      // Cấp ME.ACCESS + 4/5 source, CỐ Ý bỏ đúng source `name`.
      const pairs: Triple[] = [
        PAIR.accessMe,
        ...ALL_SOURCE.filter((p) => !(p[0] === missing[0] && p[1] === missing[1])),
      ];
      const roleId = await seedRoleWithPairs(direct, A.companyId, `meit-no-${section}`, pairs);
      const { token } = await makeUser(A, { roleId, withEmployee: true });

      // /me/overview: section target 'forbidden', 4 section còn lại 'ok', HTTP 200 (KHÔNG 403/500 lọt).
      const ov = await get("/me/overview", token);
      expect(ov.status, JSON.stringify(ov.body)).toBe(200);
      const sections = ov.body.data as Record<string, { status: string }>;
      expect(sections[section].status, `overview.${section}`).toBe("forbidden");
      for (const s of SECTIONS) {
        if (s !== section) expect(sections[s].status, `overview.${s} phải ok`).toBe("ok");
      }

      // Route section chuyên biệt (att/leave/task/noti): cũng 'forbidden' + 200 (section-envelope, KHÔNG 403).
      if (route) {
        const res = await get(route, token);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("forbidden");
        expect(res.body.data.data).toBeNull();
      } else {
        // HR không có route riêng — /me (identity) vẫn 200 (cổng ME.ACCESS pass).
        const me = await get("/me", token);
        expect(me.status).toBe(200);
        expect(me.body.data.account.userId).toBeTruthy();
      }
    },
  );

  // ── (c) IDOR RED: client-supplied user_id/employee_id BỎ QUA ───────────────────
  it("IDOR — ?user_id=<B>/body{employee_id:<B>} bị BỎ QUA: response chỉ dữ liệu caller (từ token)", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-idor", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const caller = await makeUser(A, { roleId, empCode: "E-CALLER" });
    const victim = await makeUser(A, { roleId, empCode: "E-VICTIM" });

    const baseline = await get("/me", caller.token);
    expect(baseline.status).toBe(200);
    expect(baseline.body.data.employee.employeeCode).toBe("E-CALLER");

    // Truyền owner ID lạ qua query + body — controller CỐ Ý KHÔNG khai @Query/@Body ⇒ hành vi KHÔNG đổi.
    const attack = await request(app.getHttpServer())
      .get(`/me?user_id=${victim.userId}&employee_id=${victim.userId}`)
      .set("Authorization", `Bearer ${caller.token}`)
      .send({ user_id: victim.userId, employee_id: victim.userId });
    expect(attack.status).toBe(200);
    expect(attack.body.data.account.userId).toBe(caller.userId);
    expect(attack.body.data.employee.employeeCode).toBe("E-CALLER");
    expect(JSON.stringify(attack.body.data)).not.toContain("E-VICTIM");
    expect(JSON.stringify(attack.body.data)).not.toContain(victim.userId);
  });

  // ── (d) own-scope: A không thấy B cùng tenant ──────────────────────────────────
  it("own-scope — user A không lộ dữ liệu employee của user B cùng tenant qua route ME", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-own", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const a = await makeUser(A, { roleId, empCode: "E-OWN-A" });
    const b = await makeUser(A, { roleId, empCode: "E-OWN-B" });

    const ovA = await get("/me/overview", a.token);
    expect(ovA.status).toBe(200);
    expect(ovA.body.data.identity.employee.employeeCode).toBe("E-OWN-A");
    expect(ovA.body.data.hr.data.employeeCode).toBe("E-OWN-A");
    // Không có mảnh dữ liệu B nào lọt vào response của A.
    expect(JSON.stringify(ovA.body.data)).not.toContain("E-OWN-B");
    expect(JSON.stringify(ovA.body.data)).not.toContain(b.userId);
  });

  // ── (e) cross-tenant: token tenant A không surface tenant B ────────────────────
  it("cross-tenant — token tenant A KHÔNG surface employee của tenant B (planted rows)", async () => {
    const roleA = await seedRoleWithPairs(direct, A.companyId, "meit-xt", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const a = await makeUser(A, { roleId: roleA, empCode: "E-XT-A" });
    // Plant employee tenant B gắn CÙNG user id A (dữ liệu lệch) — RLS withTenant(A) KHÔNG được lấy.
    await insertEmployee(direct, B.companyId, a.userId, "E-XT-B-PLANT");

    const me = await get("/me", a.token);
    expect(me.status).toBe(200);
    expect(me.body.data.employee.employeeCode).toBe("E-XT-A");
    expect(JSON.stringify(me.body.data)).not.toContain("E-XT-B-PLANT");

    const ov = await get("/me/overview", a.token);
    expect(ov.status).toBe(200);
    expect(JSON.stringify(ov.body.data)).not.toContain("E-XT-B-PLANT");
  });

  // ── (f) degraded (silent-failure guard): reader ném non-HttpException → 'error' 200 ──
  it("degraded — TaskCoreService.getMyTasks ném lỗi hạ tầng → task.status='error', HTTP 200 (KHÔNG 500)", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-degraded", [
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
      // 1 nguồn lỗi KHÔNG làm hỏng section khác, KHÔNG nuốt thành 'ok'.
      expect(ov.body.data.notification.status).toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  // ── (g) 404 ≠ forbidden: reader ném NotFoundException(404) → 'ok'+null (KHÔNG 'forbidden') ──
  it("404-not-forbidden — HrReadService.getMyProfile ném NotFoundException → hr.status='ok', data null (KHÔNG 'forbidden')", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-404", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    // Linked + có read:employee ⇒ gate qua, reader mới được gọi (phân biệt thiếu-DỮ-LIỆU vs thiếu-QUYỀN).
    const { token } = await makeUser(A, { roleId, withEmployee: true });

    const hr = app.get(HrReadService);
    const spy = vi
      .spyOn(hr, "getMyProfile")
      .mockRejectedValue(new NotFoundException("employee profile not found"));
    try {
      const ov = await get("/me/overview", token);
      expect(ov.status, JSON.stringify(ov.body)).toBe(200);
      // NotFoundException = KHÔNG-có-dữ-liệu ⇒ 'ok' + data null; TUYỆT ĐỐI KHÔNG dán 'forbidden'.
      expect(ov.body.data.hr.status).toBe("ok");
      expect(ov.body.data.hr.data).toBeNull();
      // Section khác vẫn 'ok'.
      expect(ov.body.data.notification.status).toBe("ok");
    } finally {
      spy.mockRestore();
    }
  });

  // ── (h) unlinked-employee: identity ok; hr/att/leave='unlinked_employee'; task/noti='ok' ──
  it("unlinked — user chưa liên kết employee → hr/att/leave='unlinked_employee', task/noti='ok', identity ok, HTTP 200", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-unlinked", [
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
    // TASK/NOTI theo user_id (không phụ thuộc employee) ⇒ vẫn 'ok'.
    expect(ov.body.data.task.status).toBe("ok");
    expect(ov.body.data.notification.status).toBe("ok");
  });

  // ── (i) module_disabled + all-modules-ok (chốt chống stale) ────────────────────
  it("module_disabled — module.LEAVE.enabled=false → 'module_disabled'; no-row → 'ok' (không stale)", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-moddis", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token } = await makeUser(A, { roleId });

    // all-modules-ok CHỐT (chưa seed company_settings): leave='ok'. Chứng minh default-enabled (không stale sai).
    const before = await get("/me/leave-summary", token);
    expect(before.status).toBe(200);
    expect(before.body.data.status).toBe("ok");

    // core-lock chỉ chặn toggle API, KHÔNG chặn VALUE → INSERT THẲNG jsonb false (mô phỏng company tắt module).
    await direct.query(
      `INSERT INTO company_settings (company_id, setting_key, setting_value, value_type, category, status)
       VALUES ($1, 'module.LEAVE.enabled', 'false'::jsonb, 'Boolean', 'module', 'Active')`,
      [A.companyId],
    );
    try {
      const after = await get("/me/leave-summary", token);
      expect(after.status).toBe(200);
      expect(after.body.data.status).toBe("module_disabled");
      expect(after.body.data.data).toBeNull();

      const ov = await get("/me/overview", token);
      expect(ov.body.data.leave.status).toBe("module_disabled");
      // Module khác KHÔNG seed row → vẫn 'ok' (không lan tắt sai).
      expect(ov.body.data.notification.status).toBe("ok");
      expect(ov.body.data.task.status).toBe("ok");
    } finally {
      // Dọn NGAY (company_settings không nằm trong cleanup per-test) — KHÔNG rò trạng thái sang test sau.
      await direct.query(
        "DELETE FROM company_settings WHERE company_id = $1 AND setting_key = 'module.LEAVE.enabled'",
        [A.companyId],
      );
    }
  });

  // ── (j) multi-active-employee anomaly → 409 ME-ERR-DATA-INCONSISTENT + GHI audit object_type='user' ──
  // Partial-unique (company_id,user_id) WHERE deleted_at IS NULL chặn 2 non-deleted ở DB ⇒ ép resolver thấy
  // >1 qua SPY repo (defense-in-depth: dữ liệu lịch sử lỗi vẫn phải fail-LOUD, KHÔNG đoán / KHÔNG tự chọn).
  function spyTwoActiveEmployees() {
    const repo = app.get(MeRepository);
    return vi.spyOn(repo, "findActiveEmployeesByUserIdTx").mockResolvedValue([
      {
        employeeId: "11111111-1111-1111-1111-111111111111",
        employeeCode: "E-M1",
        fullName: "M1",
        departmentName: null,
        positionName: null,
      },
      {
        employeeId: "22222222-2222-2222-2222-222222222222",
        employeeCode: "E-M2",
        fullName: "M2",
        departmentName: null,
        positionName: null,
      },
    ]);
  }

  it("multi-employee — link >1 employee active → 409 ME-ERR-DATA-INCONSISTENT + GHI audit object_type='user' (KHÔNG tự chọn)", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-multi", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token, userId } = await makeUser(A, { roleId, empCode: "E-MULTI" });

    const repoSpy = spyTwoActiveEmployees();
    const audit = app.get(AuditService);
    const auditSpy = vi.spyOn(audit, "record");
    try {
      const res = await get("/me", token);
      // 409 + mã business ME-ERR-DATA-INCONSISTENT (resolver KHÔNG tự chọn 1 trong 2).
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error.code).toBe("ME-ERR-DATA-INCONSISTENT");

      // GHI audit object_type='user' action 'MeDataInconsistent' cho user token-resolved (KHÔNG object khác,
      // KHÔNG auto-pick). Đây là điều acceptance yêu cầu: "ghi audit object_type='user', KHÔNG tự chọn".
      expect(auditSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          objectType: "user",
          action: "MeDataInconsistent",
          objectId: userId,
        }),
      );
      // KHÔNG được ghi audit cho object khác 'user' trong nhánh anomaly này.
      for (const call of auditSpy.mock.calls) {
        if ((call[1] as { action?: string }).action === "MeDataInconsistent") {
          expect((call[1] as { objectType?: string }).objectType).toBe("user");
        }
      }
    } finally {
      auditSpy.mockRestore();
      repoSpy.mockRestore();
    }
  });

  // ── (j2) 🔴 KNOWN DEFECT (lane memodule, src/me) — audit anomaly bị ROLLBACK, KHÔNG persist ────────────
  // MeCurrentPersonResolver.resolve GHI audit.record(tx) RỒI throw ConflictException TRONG CÙNG withTenant tx
  // ⇒ drizzle ROLLBACK toàn transaction ⇒ audit_logs KHÔNG còn dòng anomaly. SPEC-09 §12.4 yêu cầu audit
  // PERSIST để Admin/HR xử lý — audit rollback = anomaly vô hình. `it.fails` = TÀI LIỆU-THỰC-THI cho defect
  // ĐÃ BIẾT: hiện PASS vì body ĐỎ (0 dòng); khi memodule sửa (ghi audit ở withTenant RIÊNG đã COMMIT trước
  // khi throw, hoặc after-throw) body sẽ XANH ⇒ it.fails ĐỎ ⇒ ÉP flip sang `it` thường. KHÔNG che defect:
  // đã liệt kê ở blockers trả về cho lane memodule + FULL gate red-zone.
  it.fails(
    "multi-employee AUDIT PERSIST (known-defect memodule) — audit_logs GIỮ dòng anomaly sau 409",
    async () => {
      const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-multi-persist", [
        PAIR.accessMe,
        ...ALL_SOURCE,
      ]);
      const { token, userId } = await makeUser(A, { roleId, empCode: "E-MULTI-P" });
      const repoSpy = spyTwoActiveEmployees();
      try {
        const res = await get("/me", token);
        expect(res.status).toBe(409);
        const rows = await direct.query(
          `SELECT object_type, object_id FROM audit_logs
            WHERE company_id = $1 AND action = 'MeDataInconsistent'`,
          [A.companyId],
        );
        // Kỳ vọng ĐÚNG (khi defect sửa xong): anomaly persist với object_type='user' cho user token-resolved.
        expect(rows.rowCount, "audit anomaly PHẢI persist (append-only §12.4)").toBeGreaterThan(0);
        expect(rows.rows[0].object_type).toBe("user");
        expect(rows.rows[0].object_id).toBe(userId);
      } finally {
        repoSpy.mockRestore();
      }
    },
  );

  // ── (k) happy: full-grant + linked → 6 route đều 200 + section-envelope, mọi section 'ok' ──
  it("happy — full-grant + linked → 6 route đều 200 + section-envelope, mọi section 'ok'", async () => {
    const roleId = await seedRoleWithPairs(direct, A.companyId, "meit-happy", [
      PAIR.accessMe,
      ...ALL_SOURCE,
    ]);
    const { token } = await makeUser(A, { roleId, empCode: "E-HAPPY" });

    // /me/overview: mọi section 'ok', identity linked.
    const ov = await get("/me/overview", token);
    expect(ov.status, JSON.stringify(ov.body)).toBe(200);
    for (const s of SECTIONS) {
      expect(ov.body.data[s].status, `overview.${s}`).toBe("ok");
    }
    expect(ov.body.data.identity.linkStatus).toBe("linked");

    // /me (identity): 200 + account.
    const me = await get("/me", token);
    expect(me.status).toBe(200);
    expect(me.body.data.account.userId).toBeTruthy();

    // 4 route section chuyên biệt: 200 + section-envelope {status:'ok', data:not-undefined} (KHÔNG 403/500).
    for (const route of SECTION_ROUTES) {
      const res = await get(route, token);
      expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toHaveProperty("status");
      expect(res.body.data).toHaveProperty("data");
      expect(res.body.data.status, `${route}.status`).toBe("ok");
    }
  });
});

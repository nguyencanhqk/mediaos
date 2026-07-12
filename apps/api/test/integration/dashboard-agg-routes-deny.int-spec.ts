/**
 * S4-QA-1 (lane qadashaggdeny) — CROWN deny-path cho 5 route AGGREGATION của DashboardController
 * chưa được phủ bởi resolver/widget specs: POST /dashboard/refresh · GET /dashboard/report ·
 * GET /dashboard/summary · GET /dashboard/mv-stats · GET /dashboard/alerts.
 *
 * MỤC TIÊU (SPEC-07 §8.2 · API-08): chứng minh cổng phân quyền + NULL-masking SERVER-SIDE của các route
 * tổng hợp — least-privilege (manage ≠ read), fail-closed (thiếu read:dashboard → 403 KHÔNG 200 rỗng),
 * và masking per-sub-type (report finance/employee/attendance = field null, KHÔNG 403, KHÔNG rò type chéo).
 *
 *   R  POST /dashboard/refresh  → gate manage:dashboard (DN-7): read-only role → 403; manage → 200.
 *   P  GET  /dashboard/report   → gate read:dashboard; masking finance/employee/attendance per can() nội tầng.
 *   S  GET  /dashboard/summary  → gate read:dashboard; inner can() task/attendance/leave (thiếu ⇒ mục null/omit).
 *   M  GET  /dashboard/mv-stats → gate read:dashboard (no-role → 403; có quyền → 200).
 *   A  GET  /dashboard/alerts   → gate read:dashboard (no-role → 403; có quyền → 200).
 *
 * ═══ DRIFT THẬT (đã probe mediaos_qadashagg — chống "reviewer pass real bug") ═══
 *   (a) manage:dashboard KHÔNG có trong catalog permissions (0484 header (c): cố ý KHÔNG seed
 *       'refresh/manage:dashboard' vì chỉ super-admin dùng, không enumerate). ⇒ positive-path phải
 *       seedPermissionCatalog('manage','dashboard') + grant TRỰC TIẾP trong spec (direct pool).
 *   (b) role canonical `cfo`/`finance`/`leadership`/`admin` KHÔNG TỒN TẠI; blanket 0101 grant các cặp
 *       finance_report/employee_report/attendance_report cho role tên đó ⇒ landed 0 dòng; `hr`/`manager`
 *       sinh ở 0444 (SAU 0101) cũng KHÔNG nhận (0488 header ghi rõ, cố ý không backfill — report là domain
 *       PARK de-media-fy). ⇒ KHÔNG có role thật để đóng vai từng tier. Ta SEED ROLE IN-SPEC với đúng bộ
 *       cặp report mà 0101 NHẮM TỚI (finance→cfo/finance/leadership/admin · employee+attendance→hr/manager/
 *       leadership/admin), tách khỏi drift blanket-seed → chứng minh BIÊN masking THẬT (per-sub-type),
 *       anti-fragile với thứ tự role sinh. KHÔNG dựng nội dung finance_report (out-of-scope de-media-fy).
 *
 * ═══ ANTI-VACUOUS-GREEN (bài học reviewers-pass-real-bugs) ═══
 *   Vì handler ĐÃ đúng, mỗi deny (1) assert ĐÚNG status + error body (KHÔNG chỉ !=200), (2) mutation-check:
 *   tạm gỡ guard/gate → test lật RED. Bằng chứng RED ghi trong docs/plans/S4-QA-1.md §MUTATION-CHECK.
 *   refresh positive-path SPY DashboardRefreshService.refresh (cô lập infra REFRESH MV — worker role không
 *   own MV nên refresh thật 500; cổng bảo mật = guard cho qua handler, KHÔNG phải hạ tầng REFRESH).
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate + ci-skips-most-integration-specs): .env
 * trỏ DB dev chung (hasDb=true) ⇒ CHỈ chạy trên DB cô lập lane; thiếu LANE_DB ⇒ suite SKIP (không đỏ/xanh-giả).
 *   bash scripts/lane-db-setup.sh qadashagg → export LANE_DB=mediaos_qadashagg → npx vitest run <spec>.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { DashboardRefreshService } from "../../src/dashboard/dashboard-refresh.service";
import { appPool, directPool, hasDb } from "../helpers/integration-db";
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

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!qadashagg9";
const hasLaneDb = hasDb && !!process.env.LANE_DB;
const FORBIDDEN_CODE = "AUTH-ERR-FORBIDDEN";

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

/** Grant (action,resourceType,scope) 'ALLOW' cho role đã seed. */
async function grant(
  direct: Pool,
  roleId: string,
  action: string,
  resourceType: string,
  scope: "Own" | "Team" | "Department" | "Company" | "System" = "Company",
): Promise<void> {
  await seedRolePermission(
    direct,
    roleId,
    await permId(direct, action, resourceType),
    "ALLOW",
    scope,
  );
}

/** Assert 403 fail-closed CHUẨN — status + envelope + mã lỗi (KHÔNG chỉ !=200). */
function expectForbidden(res: request.Response, ctx: string): void {
  expect(res.status, `${ctx} status`).toBe(403);
  expect(res.body?.success, `${ctx} success=false`).toBe(false);
  expect(res.body?.data, `${ctx} data=null`).toBeNull();
  expect(res.body?.error?.code, `${ctx} error.code`).toBe(FORBIDDEN_CODE);
}

describe.skipIf(!hasLaneDb)(
  "S4-QA-1 DASH aggregation-route deny-path (refresh · report · summary · mv-stats · alerts)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;
    let A: SeededTenant;
    const companyIds: string[] = [];

    // Vai (mỗi vai = 1 role in-spec với bộ cặp CHÍNH XÁC — cô lập khỏi drift blanket-seed).
    const email = {
      noRole: "", // 0 grant → thiếu read:dashboard ⇒ 403 fail-closed mọi route
      dashOnly: "", // read:dashboard ONLY → report all-null · summary inner-omit · mv-stats/alerts 200 · refresh 403
      manage: "", // read:dashboard + manage:dashboard → refresh 200
      reportHr: "", // read:dashboard + employee_report + attendance_report (KHÔNG finance) → finance null
      reportFinance: "", // read:dashboard + finance_report ONLY → employee/attendance null
      reportAll: "", // read:dashboard + cả 3 report → all non-null
      summaryFull: "", // read:dashboard + read:task + read:attendance + read:leave → summary đầy đủ
    };

    let refreshSpy: MockInstance<DashboardRefreshService["refresh"]>;

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "qadashagg");
      companyIds.push(A.companyId);

      // manage:dashboard CHƯA có trong catalog (drift (a)) → tạo cặp catalog rồi grant in-spec.
      await seedPermissionCatalog(direct, "manage", "dashboard", false);

      // ── Roles (company-scoped, is_system=false) ──────────────────────────────────────────────
      const roleDashOnly = await seedRole(direct, A.companyId, "qadashagg-dash-only");
      await grant(direct, roleDashOnly, "read", "dashboard");

      const roleManage = await seedRole(direct, A.companyId, "qadashagg-manage");
      await grant(direct, roleManage, "read", "dashboard");
      await grant(direct, roleManage, "manage", "dashboard");

      const roleReportHr = await seedRole(direct, A.companyId, "qadashagg-report-hr");
      await grant(direct, roleReportHr, "read", "dashboard");
      await grant(direct, roleReportHr, "read", "employee_report");
      await grant(direct, roleReportHr, "read", "attendance_report");

      const roleReportFinance = await seedRole(direct, A.companyId, "qadashagg-report-finance");
      await grant(direct, roleReportFinance, "read", "dashboard");
      await grant(direct, roleReportFinance, "read", "finance_report");

      const roleReportAll = await seedRole(direct, A.companyId, "qadashagg-report-all");
      await grant(direct, roleReportAll, "read", "dashboard");
      await grant(direct, roleReportAll, "read", "finance_report");
      await grant(direct, roleReportAll, "read", "employee_report");
      await grant(direct, roleReportAll, "read", "attendance_report");

      const roleSummaryFull = await seedRole(direct, A.companyId, "qadashagg-summary-full");
      await grant(direct, roleSummaryFull, "read", "dashboard");
      await grant(direct, roleSummaryFull, "read", "task");
      await grant(direct, roleSummaryFull, "read", "attendance");
      await grant(direct, roleSummaryFull, "read", "leave");

      // ── Users ────────────────────────────────────────────────────────────────────────────────
      email.noRole = `norole@${A.slug}.test`;
      email.dashOnly = `dashonly@${A.slug}.test`;
      email.manage = `manage@${A.slug}.test`;
      email.reportHr = `reporthr@${A.slug}.test`;
      email.reportFinance = `reportfin@${A.slug}.test`;
      email.reportAll = `reportall@${A.slug}.test`;
      email.summaryFull = `summaryfull@${A.slug}.test`;

      const uNoRole = await seedUser(direct, A.companyId, email.noRole, hash);
      void uNoRole; // KHÔNG gán role — deny fail-closed
      const uDashOnly = await seedUser(direct, A.companyId, email.dashOnly, hash);
      const uManage = await seedUser(direct, A.companyId, email.manage, hash);
      const uReportHr = await seedUser(direct, A.companyId, email.reportHr, hash);
      const uReportFinance = await seedUser(direct, A.companyId, email.reportFinance, hash);
      const uReportAll = await seedUser(direct, A.companyId, email.reportAll, hash);
      const uSummaryFull = await seedUser(direct, A.companyId, email.summaryFull, hash);

      await seedUserRole(direct, uDashOnly, roleDashOnly, A.companyId);
      await seedUserRole(direct, uManage, roleManage, A.companyId);
      await seedUserRole(direct, uReportHr, roleReportHr, A.companyId);
      await seedUserRole(direct, uReportFinance, roleReportFinance, A.companyId);
      await seedUserRole(direct, uReportAll, roleReportAll, A.companyId);
      await seedUserRole(direct, uSummaryFull, roleSummaryFull, A.companyId);

      // MV được tạo WITH NO DATA ở mig 0102; DB cô lập fresh-migrate KHÔNG có job refresh nên SELECT trên
      // MV chưa-populate THROW ("has not been populated") — trạng thái HẠ TẦNG, KHÔNG phải lỗi bảo mật.
      // Populate qua owner (mediaos, own MV) = mô phỏng refresh-job đã chạy ⇒ /mv-stats positive-path có ý
      // nghĩa (gate read:dashboard). (Ghi chú cho DASH: getTaskStatusStats/getOutputStats hứa "[] khi MV
      // rỗng" nhưng trạng thái CHƯA-populate lại throw — latent, ngoài scope QA deny-path này.)
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_task_status");
      await direct.query("REFRESH MATERIALIZED VIEW mv_dashboard_output");

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();

      // Cô lập infra REFRESH MV (worker role không own MV → refresh thật 500). Deny-path chứng minh
      // GUARD chặn TRƯỚC handler (spy KHÔNG được gọi khi deny); positive chứng minh guard cho qua handler.
      refreshSpy = vi
        .spyOn(nest.get(DashboardRefreshService), "refresh")
        .mockResolvedValue({ refreshedAt: new Date().toISOString() });
    });

    afterAll(async () => {
      refreshSpy?.mockRestore();
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // R — POST /dashboard/refresh : least-privilege manage:dashboard ≠ read:dashboard (SPEC-07 §8.2 DN-7)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    it("R1 refresh: role CHỈ read:dashboard → 403 (manage≠read) + error body; handler KHÔNG chạy (spy 0 lần)", async () => {
      refreshSpy.mockClear();
      const h = bearer(await login(nest, A.slug, email.dashOnly));
      const res = await api(nest).post("/dashboard/refresh").set(h);
      expectForbidden(res, "refresh read-only");
      expect(
        refreshSpy,
        "guard chặn TRƯỚC handler ⇒ refresh() không được gọi",
      ).not.toHaveBeenCalled();
    });

    it("R2 refresh: no-role → 403 fail-closed (không token quyền = không refresh)", async () => {
      refreshSpy.mockClear();
      const h = bearer(await login(nest, A.slug, email.noRole));
      expectForbidden(await api(nest).post("/dashboard/refresh").set(h), "refresh no-role");
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("R3 refresh: role có manage:dashboard (seed in-spec) → 200 + refreshedAt; handler chạy đúng 1 lần", async () => {
      refreshSpy.mockClear();
      const h = bearer(await login(nest, A.slug, email.manage));
      const res = await api(nest).post("/dashboard/refresh").set(h);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.refreshedAt, "refreshedAt echo").toBeTruthy();
      expect(
        refreshSpy,
        "manage:dashboard cho qua guard ⇒ handler gọi refresh()",
      ).toHaveBeenCalledTimes(1);
    });

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // P — GET /dashboard/report : gate read:dashboard + NULL-masking per-sub-type (KHÔNG 403 ở tầng con)
    // ════════════════════════════════════════════════════════════════════════════════════════════
    it("P1 report: no-role (thiếu read:dashboard) → 403 (controller gate blanket) + error body", async () => {
      const h = bearer(await login(nest, A.slug, email.noRole));
      expectForbidden(await api(nest).get("/dashboard/report").set(h), "report no-role");
    });

    it("P2 report: read:dashboard ONLY (tier employee) → 200 nhưng finance+employee+attendance ĐỀU null (masking)", async () => {
      const h = bearer(await login(nest, A.slug, email.dashOnly));
      const res = await api(nest).get("/dashboard/report").set(h);
      expect(res.status).toBe(200);
      const rep = res.body.data.report;
      // finance section (read:finance_report thiếu)
      expect(rep.revenueThisMonth).toBeNull();
      expect(rep.costThisMonth).toBeNull();
      expect(rep.profitThisMonth).toBeNull();
      expect(rep.revenueByChannel).toBeNull();
      // employee section (read:employee_report thiếu)
      expect(rep.totalEmployees).toBeNull();
      // attendance section (read:attendance_report thiếu)
      expect(rep.todayAttendanceRate).toBeNull();
    });

    it("P3 report: tier hr/manager (employee+attendance, KHÔNG finance) → finance null; employee+attendance NON-NULL (không rò type chéo)", async () => {
      const h = bearer(await login(nest, A.slug, email.reportHr));
      const res = await api(nest).get("/dashboard/report").set(h);
      expect(res.status).toBe(200);
      const rep = res.body.data.report;
      // finance STRICTLY null — section bị từ chối KHÔNG rớt sang employee/attendance.
      expect(rep.revenueThisMonth, "finance deny → null").toBeNull();
      expect(rep.costThisMonth).toBeNull();
      expect(rep.profitThisMonth).toBeNull();
      expect(rep.revenueByChannel).toBeNull();
      // employee + attendance ĐƯỢC phép → number (0 khi rỗng, KHÔNG null).
      expect(typeof rep.totalEmployees, "employee_report allow → number").toBe("number");
      expect(typeof rep.todayAttendanceRate, "attendance_report allow → number").toBe("number");
    });

    it("P4 report: tier cfo/finance (finance ONLY) → finance NON-NULL; employee+attendance null (biên deny chiều ngược)", async () => {
      const h = bearer(await login(nest, A.slug, email.reportFinance));
      const res = await api(nest).get("/dashboard/report").set(h);
      expect(res.status).toBe(200);
      const rep = res.body.data.report;
      expect(typeof rep.revenueThisMonth, "finance_report allow → number").toBe("number");
      expect(typeof rep.costThisMonth).toBe("number");
      expect(typeof rep.profitThisMonth).toBe("number");
      expect(Array.isArray(rep.revenueByChannel), "finance allow → mảng").toBe(true);
      // employee + attendance THIẾU → strictly null (không rò từ finance sang).
      expect(rep.totalEmployees, "employee deny → null").toBeNull();
      expect(rep.todayAttendanceRate, "attendance deny → null").toBeNull();
    });

    it("P5 report: tier leadership/admin (đủ 3 report) → mọi section NON-NULL", async () => {
      const h = bearer(await login(nest, A.slug, email.reportAll));
      const res = await api(nest).get("/dashboard/report").set(h);
      expect(res.status).toBe(200);
      const rep = res.body.data.report;
      expect(typeof rep.revenueThisMonth).toBe("number");
      expect(Array.isArray(rep.revenueByChannel)).toBe(true);
      expect(typeof rep.totalEmployees).toBe("number");
      expect(typeof rep.todayAttendanceRate).toBe("number");
    });

    // ════════════════════════════════════════════════════════════════════════════════════════════
    // S/M/A — GET /dashboard/{summary,mv-stats,alerts} : fail-closed read:dashboard + summary inner can()
    // ════════════════════════════════════════════════════════════════════════════════════════════
    it("SMA1 no-role → 403 fail-closed cho CẢ /summary, /mv-stats, /alerts (KHÔNG 200 rỗng)", async () => {
      const h = bearer(await login(nest, A.slug, email.noRole));
      expectForbidden(await api(nest).get("/dashboard/summary").set(h), "summary no-role");
      expectForbidden(await api(nest).get("/dashboard/mv-stats").set(h), "mv-stats no-role");
      expectForbidden(await api(nest).get("/dashboard/alerts").set(h), "alerts no-role");
    });

    it("SMA2 có read:dashboard → 200 cho /summary, /mv-stats, /alerts", async () => {
      const h = bearer(await login(nest, A.slug, email.dashOnly));
      expect((await api(nest).get("/dashboard/summary").set(h)).status).toBe(200);
      expect((await api(nest).get("/dashboard/mv-stats").set(h)).status).toBe(200);
      expect((await api(nest).get("/dashboard/alerts").set(h)).status).toBe(200);
    });

    it("SMA3 /summary inner can() DENY: read:dashboard ONLY ⇒ tasks.byStatus OMIT + attendance null + leave null", async () => {
      const h = bearer(await login(nest, A.slug, email.dashOnly));
      const res = await api(nest).get("/dashboard/summary").set(h);
      expect(res.status).toBe(200);
      const s = res.body.data;
      // thiếu read:task ⇒ KHÔNG có breakdown byStatus (chỉ tổng own-scope).
      expect(s.tasks.byStatus, "thiếu read:task → byStatus omit").toBeUndefined();
      // thiếu read:attendance ⇒ mọi field attendance null.
      expect(s.attendance.todayPresent, "thiếu read:attendance → null").toBeNull();
      expect(s.attendance.monthAttendanceDays).toBeNull();
      // thiếu read:leave ⇒ mọi field leave null.
      expect(s.leave.pendingRequests, "thiếu read:leave → null").toBeNull();
      expect(s.leave.approvedThisMonth).toBeNull();
    });

    it("SMA4 /summary inner can() ALLOW: read:dashboard+task+attendance+leave ⇒ byStatus mảng + attendance/leave number", async () => {
      const h = bearer(await login(nest, A.slug, email.summaryFull));
      const res = await api(nest).get("/dashboard/summary").set(h);
      expect(res.status).toBe(200);
      const s = res.body.data;
      expect(Array.isArray(s.tasks.byStatus), "read:task allow → byStatus mảng").toBe(true);
      expect(typeof s.attendance.todayPresent, "read:attendance allow → number").toBe("number");
      expect(typeof s.leave.pendingRequests, "read:leave allow → number").toBe("number");
    });
  },
);

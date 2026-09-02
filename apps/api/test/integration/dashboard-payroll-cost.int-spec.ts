/**
 * S13-PAYROLL-DASH-1 — widget DASH «chi phí lương kỳ» (SPEC-11 §10 PAYROLL-FUNC-014 · §10.1
 * PAYROLL-WIDGET-001 · PAY-DEC-010, mig 0568): `payroll-cost` (PAYROLL_COST).
 *
 * NĂM RÀNG BUỘC ĐƯỢC CHỨNG Ở ĐÂY (không phải ở FE — FE chỉ có gate PHỤ theo CẶP):
 *
 *  1. CẶP GATE là cặp ĐỌC-TIỀN `('view-line','payroll-period')`. Hai ca deny đối xứng chứng nó KHÔNG
 *     phải cặp nào khác: người có `view:payroll-period` (cặp DANH SÁCH, cố ý `is_sensitive=false` nên
 *     SPEC-11 §334 cấm chở tiền) ⇒ 403; người có `calculate:payroll-period` (cặp GHI) mà thiếu
 *     `view-line` ⇒ cũng 403 (§329: gác bằng cặp ghi thì "ai thấy widget đều ghi được lương").
 *
 *  2. SÀN SCOPE 'Company' ép ở HAI TẦNG đọc CÙNG hằng (`DASH_WIDGET_MIN_DATA_SCOPE`): đường METADATA
 *     (GET /dashboard/me — omit ⇒ FE không mount ⇒ không gọi API, SPEC-11 §23 mục 13) VÀ đường DATA
 *     (GET /dashboard/widgets/payroll-cost ⇒ 403). Sàn KHÔNG phải phòng xa: `latestSummaryTx` SUM
 *     TOÀN company (không co theo actor scope), nên grant `view-line` hẹp hơn Company mà được serve là
 *     rò TỔNG QUỸ LƯƠNG ngoài scope. Đo một tầng là chưa đủ (bẫy `asset-guards-pairs-in-two-layers`) —
 *     đường metadata KHÔNG đi qua `PayrollAccessService` nên `companyFloor` của route 018 không gác nó.
 *
 *  3. MỘT CÔNG THỨC, MỘT CON SỐ. Widget PHẢI khớp `GET /payroll-periods/summary` (PAYROLL-API-018) cho
 *     CÙNG người gọi — đối chiếu trực tiếp endpoint nguồn, không so hằng chép tay
 *     (memory `reused-method-must-be-actor-scoped`). Kèm số kỳ vọng TƯỜNG MINH: hai vế cùng sai vẫn
 *     "khớp nhau". Cụ thể: kỳ GẦN NHẤT (không phải kỳ cũ hơn), dòng soft-delete KHÔNG cộng.
 *
 *  4. AUDIT lượt đọc lương (SPEC-11 §19): đường widget đi qua `PayrollCalcService.summary` nên PHẢI để
 *     lại vết `audit_logs` như route 018 — nếu ai đó "tối ưu" bằng cách gọi thẳng repository, ca này ĐỎ.
 *
 *  5. Cách ly tenant: công ty B (0 kỳ lương) ⇒ Empty, KHÔNG con số nào của công ty A.
 *
 * GATE CỨNG `hasDb && LANE_DB` (memory `integration-test-lane-db-gate`) — chỉ chạy trên DB cô lập lane.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { DatabaseService } from "../../src/db/db.service";
import { DashboardConfigSeeder } from "../../src/dashboard/dashboard-config.seeder";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd", "payrolldash1"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company";
/** [action, resource, scope, isSensitive] — view-line:payroll-period PHẢI true (mig 0565). */
type PairGrant = [string, string, Scope, boolean];

/** Mọi actor cần cặp này để qua @RequirePermission của DashboardWidgetDataController + resolver /me. */
const DASH_BASE: PairGrant[] = [
  ["read", "dashboard", "Company", false],
  ["view-employee", "dashboard", "Own", false],
];

const VIEW_LINE: PairGrant = ["view-line", "payroll-period", "Company", true];

// Kỳ GẦN NHẤT (2026-08) — số của nó là số widget phải trả.
const NEW_PERIOD_MONTH = "2026-08";
const OLD_PERIOD_MONTH = "2026-07";
// Ba dòng SỐNG của kỳ mới: gross 30tr + 20tr + 10tr = 60tr; net 27tr + 18tr + 9tr = 54tr.
const EXPECTED_HEADCOUNT = 3;
const EXPECTED_GROSS = 60_000_000;
const EXPECTED_NET = 54_000_000;
// Marker của kỳ CŨ — không được lọt vào payload (widget chỉ trả kỳ gần nhất).
const OLD_GROSS = 777_000_777;

describe.skipIf(!hasLaneDb)(
  "S13-PAYROLL-DASH-1 — widget PAYROLL_COST (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let officerUser = ""; // view-line:payroll-period @Company        ← PHẢI thấy widget
    let deptUser = ""; // view-line:payroll-period @Department     ← sàn scope PHẢI chặn
    let listOnlyUser = ""; // CHỈ view:payroll-period (không chở tiền) ← PHẢI 403
    let writeOnlyUser = ""; // CHỈ calculate:payroll-period (cặp GHI)   ← PHẢI 403
    let bareUser = ""; // KHÔNG cặp payroll nào
    let bUser = ""; // công ty B: view-line @Company, tenant KHÔNG có kỳ lương

    let tOfficer = "";
    let tDept = "";
    let tListOnly = "";
    let tWriteOnly = "";
    let tBare = "";
    let tB = "";

    let newPeriodId = "";

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      pairs: PairGrant[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `pdash-${label}-${userId.slice(0, 8)}`);
      for (const [action, resource, scope, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, companyId);
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ companySlug: slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    const http = () => request(app.getHttpServer());
    const get = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);

    /** Kỳ lương `Draft` — trạng thái DUY NHẤT không đòi `attendance_period_id` (CHECK
     *  payroll_periods_calculated_needs_attendance_check, mig 0564). Widget chỉ ĐỌC nên trạng thái nào
     *  cũng phục vụ được; dùng Draft để fixture không phải dựng cả kỳ công + vết FSM. */
    async function seedPeriod(companyId: string, month: string): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status)
         VALUES ($1, $2, 'Draft') RETURNING id`,
        [companyId, month],
      );
      return r.rows[0].id;
    }

    async function seedLine(
      companyId: string,
      periodId: string,
      userId: string,
      gross: number,
      net: number,
      deleted = false,
    ): Promise<void> {
      await direct.query(
        `INSERT INTO payroll_period_lines
           (company_id, payroll_period_id, user_id, input_snapshot_json, base_amount, gross, net, deleted_at)
         VALUES ($1, $2, $3, '{"src":"pdash1-fixture"}'::jsonb, $4, $4, $5,
                 CASE WHEN $6 THEN now() ELSE NULL END)`,
        [companyId, periodId, userId, gross, net, deleted],
      );
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "pdash1a");
      B = await seedCompany(direct, "pdash1b");
      companyIds.push(A.companyId, B.companyId);

      const mk = (name: string, co = A) =>
        seedUser(direct, co.companyId, `${name}@${co.slug}.test`, hash);
      officerUser = await mk("officer");
      deptUser = await mk("dept");
      listOnlyUser = await mk("listonly");
      writeOnlyUser = await mk("writeonly");
      bareUser = await mk("bare");
      bUser = await seedUser(direct, B.companyId, `officer@${B.slug}.test`, hash);

      await grantPairs(A.companyId, officerUser, "officer", [...DASH_BASE, VIEW_LINE]);
      // Grant HẸP GIẢ ĐỊNH (hôm nay ma trận §9g chỉ có @Company) — đo SÀN, không đo ma trận seed.
      await grantPairs(A.companyId, deptUser, "dept", [
        ...DASH_BASE,
        ["view-line", "payroll-period", "Department", true],
      ]);
      await grantPairs(A.companyId, listOnlyUser, "listonly", [
        ...DASH_BASE,
        ["view", "payroll-period", "Company", false],
      ]);
      await grantPairs(A.companyId, writeOnlyUser, "writeonly", [
        ...DASH_BASE,
        ["calculate", "payroll-period", "Company", true],
      ]);
      await grantPairs(A.companyId, bareUser, "bare", DASH_BASE);
      await grantPairs(B.companyId, bUser, "b", [...DASH_BASE, VIEW_LINE]);

      tOfficer = await login(A.slug, `officer@${A.slug}.test`);
      tDept = await login(A.slug, `dept@${A.slug}.test`);
      tListOnly = await login(A.slug, `listonly@${A.slug}.test`);
      tWriteOnly = await login(A.slug, `writeonly@${A.slug}.test`);
      tBare = await login(A.slug, `bare@${A.slug}.test`);
      tB = await login(B.slug, `officer@${B.slug}.test`);

      // ── Fixture PAYROLL (SQL — summary chỉ ĐỌC + SUM, không cần đi qua FSM):
      //    kỳ CŨ 2026-07 với 1 dòng gross khổng lồ (marker) — widget KHÔNG được trả nó;
      //    kỳ MỚI 2026-08 với 3 dòng SỐNG (60tr gross / 54tr net) + 1 dòng soft-delete (KHÔNG cộng).
      const oldPeriodId = await seedPeriod(A.companyId, OLD_PERIOD_MONTH);
      await seedLine(A.companyId, oldPeriodId, officerUser, OLD_GROSS, OLD_GROSS);

      newPeriodId = await seedPeriod(A.companyId, NEW_PERIOD_MONTH);
      await seedLine(A.companyId, newPeriodId, officerUser, 30_000_000, 27_000_000);
      await seedLine(A.companyId, newPeriodId, deptUser, 20_000_000, 18_000_000);
      await seedLine(A.companyId, newPeriodId, bareUser, 10_000_000, 9_000_000);
      await seedLine(A.companyId, newPeriodId, listOnlyUser, 99_000_000, 99_000_000, true);
      // Công ty B: KHÔNG kỳ lương ⇒ widget Empty (đồng thời chứng cách ly tenant).

      // Seeder default dashboard_widget_configs (company_id NOT NULL ⇒ runtime, không ở migration).
      const dbsvc = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new DashboardConfigSeeder());
      const runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
      const outcomes = await runner.reconcileCompany(A.companyId);
      expect(outcomes.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);
      const outcomesB = await runner.reconcileCompany(B.companyId);
      expect(outcomesB.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);
    }, 180_000);

    afterAll(async () => {
      if (direct) {
        await direct.query(
          "DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])",
          [companyIds],
        );
        await direct.query("DELETE FROM payroll_period_lines WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await direct.query("DELETE FROM payroll_periods WHERE company_id = ANY($1::uuid[])", [
          companyIds,
        ]);
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
      await app.close();
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Tầng DATA — GET /dashboard/widgets/payroll-cost
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("PAYROLL_COST — tầng DATA", () => {
      it("RED: user KHÔNG có cặp payroll nào ⇒ 403 (fail-closed, KHÔNG Degraded 200)", async () => {
        const res = await get(tBare, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: CHỈ view:payroll-period (cặp danh sách, không chở tiền) ⇒ 403 — cặp gate là view-line", async () => {
        const res = await get(tListOnly, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: CHỈ calculate:payroll-period (cặp GHI) ⇒ 403 — không lấy cặp ghi làm cổng đọc", async () => {
        const res = await get(tWriteOnly, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: view-line@Department ⇒ 403 — SÀN 'Company' vì latestSummaryTx SUM TOÀN company", async () => {
        const res = await get(tDept, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("ALLOW @Company: 200 và số liệu KHỚP GET /payroll-periods/summary của CÙNG người gọi", async () => {
        const src = await get(tOfficer, "/payroll-periods/summary");
        expect(src.status, JSON.stringify(src.body)).toBe(200);
        const res = await get(tOfficer, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        const w = res.body.data.data as {
          period: { payrollPeriodId: string; periodMonth: string; status: string };
          summary: { headcount: number; totalGross: number | null; totalNet: number | null };
        };
        // Parity với endpoint nguồn (một công thức, một con số).
        expect(w.period.payrollPeriodId).toBe(src.body.data.payrollPeriodId);
        expect(w.period.periodMonth).toBe(src.body.data.periodMonth);
        expect(w.period.status).toBe(src.body.data.status);
        expect(w.summary.headcount).toBe(src.body.data.headcount);
        expect(w.summary.totalGross).toBe(src.body.data.totalGross);
        expect(w.summary.totalNet).toBe(src.body.data.totalNet);

        // Số kỳ vọng TƯỜNG MINH (parity một mình không đủ — hai vế cùng sai vẫn "khớp"):
        // kỳ GẦN NHẤT, dòng soft-delete KHÔNG cộng.
        expect(w.period.payrollPeriodId).toBe(newPeriodId);
        expect(w.period.periodMonth).toBe(NEW_PERIOD_MONTH);
        expect(w.summary.headcount).toBe(EXPECTED_HEADCOUNT);
        expect(Number(w.summary.totalGross)).toBe(EXPECTED_GROSS);
        expect(Number(w.summary.totalNet)).toBe(EXPECTED_NET);
      });

      it("KHÔNG rò kỳ CŨ: payload không mang con số của 2026-07", async () => {
        const res = await get(tOfficer, "/dashboard/widgets/payroll-cost");
        expect(res.status).toBe(200);
        const flat = JSON.stringify(res.body.data);
        expect(flat).not.toContain(String(OLD_GROSS));
        expect(flat).not.toContain(OLD_PERIOD_MONTH);
      });

      /**
       * Đường widget đi qua `PayrollCalcService.summary` (chứ KHÔNG repository) chính vì audit nằm ở
       * service — ca này ĐỎ nếu ai đó "tối ưu" bằng cách gọi thẳng `latestSummaryTx`.
       *
       * Xoá cache TRƯỚC khi gọi, KHÔNG dùng `?refresh=true`: `DASH_WIDGET_MIN_REFRESH_MS` (10s) vẫn
       * phục vụ cache hợp lệ cho `refresh=true` (chống cache-busting đập source) ⇒ ca đo bằng refresh
       * là ca ĐỎ NGẪU NHIÊN theo thứ tự chạy. Đo trên cache MISS mới là đo đúng đường `fetch`.
       */
      const auditReadCount = async (): Promise<number> => {
        const r = await direct.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_logs
            WHERE company_id = $1 AND actor_user_id = $2
              AND action = 'read' AND object_type = 'payroll_period'`,
          [A.companyId, officerUser],
        );
        return Number(r.rows[0].n);
      };

      it("AUDIT: lượt xem widget trên cache MISS để lại hàng audit_logs read/payroll_period", async () => {
        await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [
          A.companyId,
        ]);
        const before = await auditReadCount();
        const res = await get(tOfficer, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.cache?.hit).toBe(false);
        expect(await auditReadCount()).toBeGreaterThan(before);
      });

      /**
       * ⚠️ MẶT KIA CỦA CÙNG CƠ CHẾ, ghim tường minh để không ai đọc ca trên thành "mọi lượt xem widget
       * đều có vết": cache company-shared (TTL 300s) ⇒ lượt xem thứ hai KHÔNG chạy `fetch` ⇒ KHÔNG đẻ
       * audit. Đây là hành vi CHẤP NHẬN ĐƯỢC chứ không phải lỗ: SPEC-11 §20.12 liệt kê đúng ba đường
       * phải +1 hàng audit mỗi lượt (`/lines` · `/payslips/:id` · `/salary-profiles`) và widget KHÔNG
       * nằm trong đó; §20.13 chỉ đòi widget đúng số + đúng người thấy. Nếu về sau owner muốn vết
       * per-view cho widget, chỗ sửa là `gateAndResolve` (chạy MỌI lần serve), KHÔNG phải `fetch`.
       */
      it("AUDIT: lượt xem thứ hai ăn cache ⇒ KHÔNG đẻ thêm audit (giới hạn ĐÃ BIẾT, không phải lỗ)", async () => {
        await get(tOfficer, "/dashboard/widgets/payroll-cost"); // nạp cache
        const before = await auditReadCount();
        const res = await get(tOfficer, "/dashboard/widgets/payroll-cost");
        expect(res.status).toBe(200);
        expect(res.body.data.cache?.hit).toBe(true);
        expect(await auditReadCount()).toBe(before);
      });

      it("cross-tenant: công ty B (0 kỳ lương) ⇒ Empty, KHÔNG con số nào của công ty A", async () => {
        const res = await get(tB, "/dashboard/widgets/payroll-cost");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Empty");
        const flat = JSON.stringify(res.body.data);
        expect(flat).not.toContain(String(EXPECTED_GROSS));
        expect(flat).not.toContain(String(EXPECTED_NET));
        expect(flat).not.toContain(NEW_PERIOD_MONTH);
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Tầng METADATA — GET /dashboard/me: omit ⇒ FE KHÔNG mount ⇒ KHÔNG gọi API (SPEC-11 §23 mục 13)
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("PAYROLL_COST — tầng METADATA (GET /dashboard/me)", () => {
      const codesOf = (body: unknown): string[] =>
        ((body as { data: { widgets: Array<{ widget_code: string }> } }).data.widgets ?? []).map(
          (w) => w.widget_code,
        );

      it("bare (không cặp): PAYROLL_COST VẮNG khỏi /dashboard/me", async () => {
        const res = await get(tBare, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("PAYROLL_COST");
      });

      it("chỉ view:payroll-period: VẮNG — cặp danh sách không mở được widget chở tiền", async () => {
        const res = await get(tListOnly, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("PAYROLL_COST");
      });

      it("view-line@Department: VẮNG — sàn scope ép ở CẢ tầng metadata, cùng hằng với tầng data", async () => {
        const res = await get(tDept, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("PAYROLL_COST");
      });

      it("view-line@Company: CÓ trong /dashboard/me — cùng dashboard type 'Employee' với các ca trên", async () => {
        const res = await get(tOfficer, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // Mọi actor ở đây đều resolve về dashboard 'Employee' (chỉ có view-employee:dashboard) ⇒ khác
        // biệt DUY NHẤT là CẶP + SCOPE, không phải dashboard_type / role.
        expect(res.body.data.dashboard_type).toBe("Employee");
        expect(codesOf(res.body)).toContain("PAYROLL_COST");
      });

      it("METADATA không chở tiền: /dashboard/me chỉ có shell (data=null) cho PAYROLL_COST", async () => {
        const res = await get(tOfficer, "/dashboard/me");
        expect(res.status).toBe(200);
        const w = (res.body.data.widgets as Array<{ widget_code: string; data: unknown }>).find(
          (x) => x.widget_code === "PAYROLL_COST",
        );
        expect(w).toBeDefined();
        expect(w?.data).toBeNull();
        expect(JSON.stringify(res.body.data)).not.toContain(String(EXPECTED_GROSS));
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Đường catalog — GET /dashboard/widgets omit widget ngoài quyền
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    it("GET /dashboard/widgets: dept/bare/listOnly KHÔNG thấy PAYROLL_COST; officer thấy", async () => {
      const codes = async (t: string) => {
        const res = await get(t, "/dashboard/widgets");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        return (res.body.data as Array<{ widget_code: string }>).map((w) => w.widget_code);
      };
      expect(await codes(tBare)).not.toContain("PAYROLL_COST");
      expect(await codes(tDept)).not.toContain("PAYROLL_COST");
      expect(await codes(tListOnly)).not.toContain("PAYROLL_COST");
      expect(await codes(tOfficer)).toContain("PAYROLL_COST");
    });

    it("slug lạ vẫn 404 (không mở cửa hậu khi thêm slug mới)", async () => {
      const res = await get(tOfficer, "/dashboard/widgets/payroll-costs");
      expect([404, 400]).toContain(res.status);
    });
  },
);

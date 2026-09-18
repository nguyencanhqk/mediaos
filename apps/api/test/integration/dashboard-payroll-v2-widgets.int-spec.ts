/**
 * S15-PAYROLL-DASH-1 — 2 widget DASH của PAYROLL v2 (SPEC-11 §10.1b, mig 0576):
 *   • `payroll-budget`          (PAYROLL_BUDGET)          — ngân sách năm: kế hoạch · thực hiện · chênh lệch
 *   • `payroll-advance-pending` (PAYROLL_ADVANCE_PENDING) — ĐẾM tạm ứng `Pending`
 *
 * SÁU RÀNG BUỘC ĐƯỢC CHỨNG Ở ĐÂY (FE chỉ có gate PHỤ theo CẶP nên không chứng được gì trong số này):
 *
 *  1. MỖI WIDGET MƯỢN CẶP CỦA RIÊNG ROUTE NGUỒN — không mượn chéo. Hai ca đối xứng: người CHỈ có
 *     `view:payroll-budget` thấy BUDGET mà KHÔNG thấy ADVANCE_PENDING, và ngược lại. Đây là ca quan
 *     trọng nhất của WO: sao chép khuôn widget anh em rất dễ kéo theo cặp gate của nó.
 *
 *  2. CẶP GATE CỦA ADVANCE_PENDING LÀ `view` CHỨ KHÔNG PHẢI `approve`. Ca «chỉ approve ⇒ 403» ghim lựa
 *     chọn này. Tổ hợp đó KHÔNG canonical (mig 0571 §4.7 ép approve ⇒ view để chống duyệt mù) — ca này
 *     tồn tại để khoá QUYẾT ĐỊNH, không phải để mô tả một vai có thật.
 *
 *  3. SÀN SCOPE 'Company' ép ở HAI TẦNG đọc CÙNG hằng `DASH_WIDGET_MIN_DATA_SCOPE` — đường METADATA
 *     (GET /dashboard/me omit ⇒ FE không mount ⇒ KHÔNG gọi API) VÀ đường DATA (403). Đo một tầng là
 *     chưa đủ (bẫy `asset-guards-pairs-in-two-layers`): đường metadata KHÔNG đi qua PayrollAccessService
 *     nên `companyFloor` của route 073/059 không gác nó.
 *
 *  4. MỘT CÔNG THỨC, MỘT CON SỐ. Ngân sách của widget PHẢI khớp khối `budget` của `GET /payroll/overview`
 *     (PAYROLL-API-078) cho CÙNG người gọi — đối chiếu endpoint nguồn, KHÔNG so hằng chép tay. Kèm số
 *     kỳ vọng TƯỜNG MINH: hai vế cùng sai vẫn "khớp nhau".
 *
 *  5. AUDIT lượt đọc (SPEC-11 §19) trên cache MISS — và ca ĐỐI CHỨNG «cache hit ⇒ KHÔNG thêm audit»
 *     (giới hạn ĐÃ BIẾT của widget, memory `widget-cache-hit-skips-audit-trail`; thiếu ca thứ hai thì ca
 *     thứ nhất bị đọc thành "mọi lượt xem đều có vết" — sai).
 *
 *  6. Cách ly tenant: công ty B (0 ngân sách, 0 phiếu, 0 tạm ứng) ⇒ CẢ HAI widget `Empty`, payload
 *     KHÔNG chứa con số nào của công ty A.
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
import { publishedPeriodWithPayslips } from "../helpers/payroll-v2-fixtures";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = ["Passw0rd", "payrolldash2"].join("!");

type Scope = "Own" | "Team" | "Department" | "Company";
/** [action, resource, scope, isSensitive] — cả hai cặp PAYROLL phải sensitive (mig 0571). */
type PairGrant = [string, string, Scope, boolean];

/** Mọi actor cần cặp này để qua @RequirePermission của DashboardWidgetDataController + resolver /me. */
const DASH_BASE: PairGrant[] = [
  ["read", "dashboard", "Company", false],
  ["view-employee", "dashboard", "Own", false],
];

const VIEW_BUDGET: PairGrant = ["view", "payroll-budget", "Company", true];
const VIEW_ADVANCE: PairGrant = ["view", "payroll-advance", "Company", true];
/** Cặp của route 078 — chỉ officer có, để đối chiếu widget với nguồn. */
const VIEW_REPORT: PairGrant = ["view", "payroll-report", "Company", true];

/**
 * NĂM TÀI CHÍNH: widget KHÔNG nhận tham số, nó tự lấy `new Date().getUTCFullYear()` — fixture phải gieo
 * đúng năm đó. (Về lý thuyết một lượt chạy vắt qua nửa đêm 31/12 UTC sẽ lệch; chấp nhận, mọi widget
 * "năm hiện tại" đều vậy.)
 */
const YEAR = new Date().getUTCFullYear();
const PERIOD_MONTH = `${YEAR}-03`;
// 2 phiếu của kỳ ĐÃ PHÁT HÀNH: gross 40tr + 60tr ⇒ thực hiện = 100tr.
const EXPECTED_ACTUAL = 100_000_000;
const PLANNED = 250_000_000;
const EXPECTED_VARIANCE = PLANNED - EXPECTED_ACTUAL; // 150tr
const EXPECTED_USAGE_PCT = 40; // 100tr / 250tr
// 3 tạm ứng Pending SỐNG (+1 Approved, +1 Pending đã xoá mềm — cả hai KHÔNG được đếm).
const EXPECTED_PENDING = 3;

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-DASH-1 — widget PAYROLL_BUDGET + PAYROLL_ADVANCE_PENDING (DB cô lập, đường thật)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let officerUser = ""; // budget + advance + report @Company   ← thấy CẢ HAI widget
    let budgetOnlyUser = ""; // CHỈ view:payroll-budget @Company      ← thấy BUDGET, KHÔNG thấy ADVANCE
    let advanceOnlyUser = ""; // CHỈ view:payroll-advance @Company     ← ngược lại
    let approveOnlyUser = ""; // CHỈ approve:payroll-advance @Company  ← 403 (gate là `view`)
    let deptUser = ""; // cả hai cặp @Department                ← SÀN scope phải chặn
    let bareUser = ""; // KHÔNG cặp payroll nào
    let bUser = ""; // công ty B: cả hai cặp @Company, tenant RỖNG

    let tOfficer = "";
    let tBudgetOnly = "";
    let tAdvanceOnly = "";
    let tApproveOnly = "";
    let tDept = "";
    let tBare = "";
    let tB = "";

    async function grantPairs(
      companyId: string,
      userId: string,
      label: string,
      pairs: PairGrant[],
    ): Promise<void> {
      const roleId = await seedRole(direct, companyId, `pdash2-${label}-${userId.slice(0, 8)}`);
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

    /** Hàng ngân sách TOÀN CÔNG TY (`org_unit_id IS NULL`) — nhánh «có hàng công ty» của yearTotalsTx. */
    async function seedBudget(companyId: string, planned: number, actorId: string): Promise<void> {
      await direct.query(
        `INSERT INTO payroll_budgets (company_id, fiscal_year, org_unit_id, planned_amount, note, created_by)
         VALUES ($1, $2, NULL, $3::numeric, 'pdash2 fixture', $4)`,
        [companyId, YEAR, planned, actorId],
      );
    }

    /**
     * Tạm ứng PHẢI sinh ở hình dạng `Pending` sạch — trigger `payroll_advance_freeze_guard` (mig 0572
     * §4c M3) CẤM INSERT thẳng `Approved`/đã quyết định. Nên ca `Approved` đi hai bước như sản phẩm:
     * INSERT Pending rồi UPDATE vết quyết định (không kèm sửa tiền — vế (D) của cùng trigger).
     * Xoá mềm vẫn gieo ngay ở INSERT: hàng còn `Pending` chưa bind nên vế (B) không chặn.
     */
    async function seedAdvance(
      companyId: string,
      userId: string,
      status: "Pending" | "Approved",
      actorId: string,
      softDeleted = false,
      deciderId = bareUser,
    ): Promise<void> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_advances
           (company_id, user_id, amount, deduct_period_month, reason, status, created_by, deleted_at)
         VALUES ($1, $2, 1000000, $3, 'pdash2 fixture', 'Pending', $4,
                 CASE WHEN $5 THEN now() END)
         RETURNING id`,
        [companyId, userId, PERIOD_MONTH, actorId, softDeleted],
      );
      if (status === "Approved") {
        // Người duyệt PHẢI khác người tạo — CHECK `payroll_advances_four_eyes_check` sống ở DB.
        await direct.query(
          `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now()
            WHERE id = $1`,
          [r.rows[0].id, deciderId],
        );
      }
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);
      A = await seedCompany(direct, "pdash2a");
      B = await seedCompany(direct, "pdash2b");
      companyIds.push(A.companyId, B.companyId);

      const mk = (name: string, co = A) =>
        seedUser(direct, co.companyId, `${name}@${co.slug}.test`, hash);
      officerUser = await mk("officer");
      budgetOnlyUser = await mk("budgetonly");
      advanceOnlyUser = await mk("advanceonly");
      approveOnlyUser = await mk("approveonly");
      deptUser = await mk("dept");
      bareUser = await mk("bare");
      bUser = await seedUser(direct, B.companyId, `officer@${B.slug}.test`, hash);

      await grantPairs(A.companyId, officerUser, "officer", [
        ...DASH_BASE,
        VIEW_BUDGET,
        VIEW_ADVANCE,
        VIEW_REPORT,
      ]);
      await grantPairs(A.companyId, budgetOnlyUser, "budgetonly", [...DASH_BASE, VIEW_BUDGET]);
      await grantPairs(A.companyId, advanceOnlyUser, "advanceonly", [...DASH_BASE, VIEW_ADVANCE]);
      await grantPairs(A.companyId, approveOnlyUser, "approveonly", [
        ...DASH_BASE,
        ["approve", "payroll-advance", "Company", true],
      ]);
      // Grant HẸP GIẢ ĐỊNH (ma trận §9g hôm nay chỉ có @Company) — đo SÀN, không đo ma trận seed.
      await grantPairs(A.companyId, deptUser, "dept", [
        ...DASH_BASE,
        ["view", "payroll-budget", "Department", true],
        ["view", "payroll-advance", "Department", true],
      ]);
      await grantPairs(A.companyId, bareUser, "bare", DASH_BASE);
      await grantPairs(B.companyId, bUser, "b", [...DASH_BASE, VIEW_BUDGET, VIEW_ADVANCE]);

      tOfficer = await login(A.slug, `officer@${A.slug}.test`);
      tBudgetOnly = await login(A.slug, `budgetonly@${A.slug}.test`);
      tAdvanceOnly = await login(A.slug, `advanceonly@${A.slug}.test`);
      tApproveOnly = await login(A.slug, `approveonly@${A.slug}.test`);
      tDept = await login(A.slug, `dept@${A.slug}.test`);
      tBare = await login(A.slug, `bare@${A.slug}.test`);
      tB = await login(B.slug, `officer@${B.slug}.test`);

      // ── Fixture A: kỳ ĐÃ PHÁT HÀNH + 2 phiếu (⇒ thực hiện 100tr) · ngân sách năm 250tr ·
      //    3 tạm ứng Pending sống + 1 Approved + 1 Pending xoá mềm.
      await publishedPeriodWithPayslips(direct, A.companyId, {
        month: PERIOD_MONTH,
        payees: [
          { userId: officerUser, net: "36000000", gross: "40000000" },
          { userId: bareUser, net: "54000000", gross: "60000000" },
        ],
        officerId: officerUser,
        approverId: bareUser, // PHẢI khác officer (CHECK four-eyes sống ở DB)
      });
      await seedBudget(A.companyId, PLANNED, officerUser);
      await seedAdvance(A.companyId, bareUser, "Pending", officerUser);
      await seedAdvance(A.companyId, deptUser, "Pending", officerUser);
      await seedAdvance(A.companyId, budgetOnlyUser, "Pending", officerUser);
      await seedAdvance(A.companyId, advanceOnlyUser, "Approved", officerUser);
      await seedAdvance(A.companyId, approveOnlyUser, "Pending", officerUser, true);
      // Công ty B: KHÔNG gieo gì ⇒ cả hai widget Empty (đồng thời chứng cách ly tenant).

      // Seeder default dashboard_widget_configs (company_id NOT NULL ⇒ runtime, không ở migration).
      const dbsvc = new DatabaseService();
      const registry = new MasterDataSeederRegistry();
      registry.register(new DashboardConfigSeeder());
      const runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
      for (const cid of companyIds) {
        const outcomes = await runner.reconcileCompany(cid);
        expect(outcomes.find((o) => o.seedKey === "dash.default-configs")?.ok).toBe(true);
      }
    }, 180_000);

    afterAll(async () => {
      if (direct) {
        await direct.query(
          "DELETE FROM dashboard_widget_cache WHERE company_id = ANY($1::uuid[])",
          [companyIds],
        );
        for (const table of [
          "payroll_advances",
          "payroll_budgets",
          "payslips",
          "payroll_periods",
          "attendance_periods",
        ]) {
          await direct.query(`DELETE FROM ${table} WHERE company_id = ANY($1::uuid[])`, [
            companyIds,
          ]);
        }
        await cleanupTenants(direct, companyIds);
        await direct.end();
      }
      await app.close();
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // PAYROLL_BUDGET — tầng DATA
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("PAYROLL_BUDGET — tầng DATA (GET /dashboard/widgets/payroll-budget)", () => {
      it("RED: không cặp payroll nào ⇒ 403 (fail-closed, KHÔNG Degraded 200)", async () => {
        const res = await get(tBare, "/dashboard/widgets/payroll-budget");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: CHỈ view:payroll-advance ⇒ 403 — KHÔNG mượn chéo cặp của widget anh em", async () => {
        const res = await get(tAdvanceOnly, "/dashboard/widgets/payroll-budget");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: view:payroll-budget@Department ⇒ 403 — SÀN 'Company' vì yearTotalsTx cộng TOÀN công ty", async () => {
        const res = await get(tDept, "/dashboard/widgets/payroll-budget");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("ALLOW @Company: 200, số KHỚP khối `budget` của GET /payroll/overview (078) + số kỳ vọng tường minh", async () => {
        const src = await get(tOfficer, "/payroll/overview");
        expect(src.status, JSON.stringify(src.body)).toBe(200);
        const res = await get(tOfficer, "/dashboard/widgets/payroll-budget");
        expect(res.status, JSON.stringify(res.body)).toBe(200);

        const w = res.body.data.data as {
          fiscalYear: number;
          plannedAmount: number | null;
          actualAmount: number;
          variance: number | null;
          usagePct: number | null;
        };
        const srcBudget = src.body.data.budget as {
          fiscalYear: number;
          plannedAmount: number | null;
          actualAmount: number;
          usagePct: number | null;
        };
        // Parity với nguồn (một công thức, một con số).
        expect(
          srcBudget,
          "078 phải có khối budget cho actor giữ view:payroll-budget",
        ).toBeDefined();
        expect(w.fiscalYear).toBe(srcBudget.fiscalYear);
        expect(Number(w.plannedAmount)).toBe(Number(srcBudget.plannedAmount));
        expect(Number(w.actualAmount)).toBe(Number(srcBudget.actualAmount));
        expect(Number(w.usagePct)).toBe(Number(srcBudget.usagePct));

        // Số kỳ vọng TƯỜNG MINH — parity một mình không đủ (hai vế cùng sai vẫn "khớp").
        expect(w.fiscalYear).toBe(YEAR);
        expect(Number(w.plannedAmount)).toBe(PLANNED);
        expect(Number(w.actualAmount)).toBe(EXPECTED_ACTUAL);
        expect(Number(w.variance)).toBe(EXPECTED_VARIANCE);
        expect(Number(w.usagePct)).toBe(EXPECTED_USAGE_PCT);
      });

      it("AUDIT: cache MISS ⇒ +1 hàng audit_logs read/payroll_budget (đi qua SERVICE, không repository)", async () => {
        await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [
          A.companyId,
        ]);
        const before = await auditCount("payroll_budget");
        const res = await get(tOfficer, "/dashboard/widgets/payroll-budget");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.cache?.hit).toBe(false);
        expect(await auditCount("payroll_budget")).toBeGreaterThan(before);
      });

      /**
       * MẶT KIA của cùng cơ chế (memory `widget-cache-hit-skips-audit-trail`): cache company-shared ⇒
       * lượt xem thứ hai KHÔNG chạy `fetch` ⇒ KHÔNG đẻ audit. Giới hạn ĐÃ BIẾT, không phải lỗ —
       * SPEC-11 §20.12 không liệt widget vào nhóm phải +1 vết mỗi lượt. Ghim để ca trên không bị đọc
       * thành "mọi lượt xem widget đều có vết".
       */
      it("AUDIT: lượt thứ hai ăn cache ⇒ KHÔNG đẻ thêm audit (giới hạn ĐÃ BIẾT)", async () => {
        await get(tOfficer, "/dashboard/widgets/payroll-budget"); // nạp cache
        const before = await auditCount("payroll_budget");
        const res = await get(tOfficer, "/dashboard/widgets/payroll-budget");
        expect(res.status).toBe(200);
        expect(res.body.data.cache?.hit).toBe(true);
        expect(await auditCount("payroll_budget")).toBe(before);
      });

      it("cross-tenant: công ty B rỗng ⇒ Empty, KHÔNG con số nào của công ty A", async () => {
        const res = await get(tB, "/dashboard/widgets/payroll-budget");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Empty");
        const flat = JSON.stringify(res.body.data);
        expect(flat).not.toContain(String(PLANNED));
        expect(flat).not.toContain(String(EXPECTED_ACTUAL));
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // PAYROLL_ADVANCE_PENDING — tầng DATA
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("PAYROLL_ADVANCE_PENDING — tầng DATA (GET /dashboard/widgets/payroll-advance-pending)", () => {
      it("RED: không cặp payroll nào ⇒ 403", async () => {
        const res = await get(tBare, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: CHỈ view:payroll-budget ⇒ 403 — KHÔNG mượn chéo cặp của widget anh em", async () => {
        const res = await get(tBudgetOnly, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      /**
       * Ghim QUYẾT ĐỊNH cặp gate = `view`, KHÔNG phải `approve` (SPEC-11 §10.1b). Tổ hợp «approve mà
       * thiếu view» KHÔNG canonical — mig 0571 §4.7 chặn nó ở seed để chống duyệt mù; ca này dựng tay
       * để nếu ai đó đổi gate sang cặp duyệt thì ĐỎ ngay.
       */
      it("RED: CHỈ approve:payroll-advance ⇒ 403 — gate là cặp ĐỌC `view`, không phải cặp DUYỆT", async () => {
        const res = await get(tApproveOnly, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("RED: view:payroll-advance@Department ⇒ 403 — SÀN 'Company' vì countTx đếm TOÀN công ty", async () => {
        const res = await get(tDept, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(403);
      });

      it("ALLOW @Company: đếm ĐÚNG 3 — Approved KHÔNG tính, hàng xoá mềm KHÔNG tính", async () => {
        const res = await get(tOfficer, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Active");
        expect((res.body.data.data as { total: number }).total).toBe(EXPECTED_PENDING);
      });

      /**
       * SPEC-11 §10.1b: widget CHỈ trả `total` — không tên người, không số tiền. Ghim bằng cách soi
       * payload phẳng: thêm khoá ở handler mà quên nghĩ sẽ ĐỎ ở đây.
       */
      it("payload CHỈ có `total` — không tên người, không số tiền", async () => {
        const res = await get(tOfficer, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.data.data as object)).toEqual(["total"]);
        expect(JSON.stringify(res.body.data)).not.toContain("1000000");
      });

      it("AUDIT: cache MISS ⇒ +1 hàng audit_logs read/payroll_advance", async () => {
        await direct.query("DELETE FROM dashboard_widget_cache WHERE company_id = $1", [
          A.companyId,
        ]);
        const before = await auditCount("payroll_advance");
        const res = await get(tOfficer, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.cache?.hit).toBe(false);
        expect(await auditCount("payroll_advance")).toBeGreaterThan(before);
      });

      it("cross-tenant: công ty B (0 tạm ứng) ⇒ Empty, KHÔNG thấy số của công ty A", async () => {
        const res = await get(tB, "/dashboard/widgets/payroll-advance-pending");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Empty");
      });
    });

    // ══════════════════════════════════════════════════════════════════════════════════════════════
    // Tầng METADATA — GET /dashboard/me: omit ⇒ FE KHÔNG mount ⇒ KHÔNG gọi API
    // ══════════════════════════════════════════════════════════════════════════════════════════════

    describe("Tầng METADATA (GET /dashboard/me) — cùng hằng sàn với tầng DATA", () => {
      const codesOf = (body: unknown): string[] =>
        ((body as { data: { widgets: Array<{ widget_code: string }> } }).data.widgets ?? []).map(
          (w) => w.widget_code,
        );

      it("bare: CẢ HAI widget VẮNG khỏi /dashboard/me", async () => {
        const res = await get(tBare, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("PAYROLL_BUDGET");
        expect(codesOf(res.body)).not.toContain("PAYROLL_ADVANCE_PENDING");
      });

      it("@Department: CẢ HAI VẮNG — sàn scope ép ở tầng metadata y như tầng data", async () => {
        const res = await get(tDept, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(codesOf(res.body)).not.toContain("PAYROLL_BUDGET");
        expect(codesOf(res.body)).not.toContain("PAYROLL_ADVANCE_PENDING");
      });

      /** Ca lõi của WO: hai widget ĐỘC LẬP theo cặp — cùng dashboard type, khác nhau DUY NHẤT ở cặp. */
      it("budgetOnly thấy ĐÚNG PAYROLL_BUDGET; advanceOnly thấy ĐÚNG PAYROLL_ADVANCE_PENDING", async () => {
        const b = await get(tBudgetOnly, "/dashboard/me");
        expect(b.status, JSON.stringify(b.body)).toBe(200);
        expect(b.body.data.dashboard_type).toBe("Employee");
        expect(codesOf(b.body)).toContain("PAYROLL_BUDGET");
        expect(codesOf(b.body)).not.toContain("PAYROLL_ADVANCE_PENDING");

        const a = await get(tAdvanceOnly, "/dashboard/me");
        expect(a.status, JSON.stringify(a.body)).toBe(200);
        expect(a.body.data.dashboard_type).toBe("Employee");
        expect(codesOf(a.body)).toContain("PAYROLL_ADVANCE_PENDING");
        expect(codesOf(a.body)).not.toContain("PAYROLL_BUDGET");
      });

      it("officer: CÓ cả hai, và METADATA KHÔNG chở tiền (data=null)", async () => {
        const res = await get(tOfficer, "/dashboard/me");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const widgets = res.body.data.widgets as Array<{ widget_code: string; data: unknown }>;
        for (const code of ["PAYROLL_BUDGET", "PAYROLL_ADVANCE_PENDING"]) {
          const w = widgets.find((x) => x.widget_code === code);
          expect(w, `thiếu ${code}`).toBeDefined();
          expect(w?.data).toBeNull();
        }
        expect(JSON.stringify(res.body.data)).not.toContain(String(PLANNED));
      });

      it("GET /dashboard/widgets: catalog cũng omit theo CẶP (không chỉ /dashboard/me)", async () => {
        const codes = async (t: string) => {
          const res = await get(t, "/dashboard/widgets");
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          return (res.body.data as Array<{ widget_code: string }>).map((w) => w.widget_code);
        };
        expect(await codes(tBare)).not.toContain("PAYROLL_BUDGET");
        expect(await codes(tDept)).not.toContain("PAYROLL_ADVANCE_PENDING");
        expect(await codes(tBudgetOnly)).not.toContain("PAYROLL_ADVANCE_PENDING");
        expect(await codes(tOfficer)).toContain("PAYROLL_BUDGET");
        expect(await codes(tOfficer)).toContain("PAYROLL_ADVANCE_PENDING");
      });
    });

    /** Đếm vết đọc của officer theo object_type — dùng chung cho hai cụm audit. */
    async function auditCount(objectType: string): Promise<number> {
      const r = await direct.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM audit_logs
          WHERE company_id = $1 AND actor_user_id = $2
            AND action = 'read' AND object_type = $3`,
        [A.companyId, officerUser, objectType],
      );
      return Number(r.rows[0].n);
    }
  },
);

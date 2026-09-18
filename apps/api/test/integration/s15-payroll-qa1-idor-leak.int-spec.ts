/**
 * S15-PAYROLL-QA-1 (lane B) — G5 · G7 · #24: cross-tenant GHI trên 5 route mới v2, loại trừ danh sách,
 * Own fail-closed cho phiếu lương, và ca ghim "duyệt mù" (SPEC-11 §21.1 mục 17–19 · 24 · plan §0 G5/G7).
 *
 *  G5. **Cross-tenant GHI** — actor tenant A (đủ mọi cặp) bắn id THẬT của tenant B trên 5 route mới:
 *      039 (settings) · 041 (dependent) · 052 (template) · 064 (reject tạm ứng) · 075 (budget) ⇒
 *      **404 PAYROLL-ERR-010** (không 403 — 403 tự nó là oracle), và hàng của B **NGUYÊN VẸN** sau đó.
 *      Mỗi DENY có ALLOW song sinh trên object CỦA CHÍNH A ⇒ đúng mã 2xx. Kèm loại trừ danh sách:
 *      036 (nhân sự) · 073 (ngân sách) không bao giờ chứa id của B dù A có dữ liệu thật.
 *  G7. **Own fail-closed** — người dùng chỉ giữ 3 cặp Own của phiếu lương nhưng CHƯA TỪNG có phiếu nào
 *      (không `employee_profiles`, không `salary_profiles`, không `payslips`): 031 ⇒ 200 rỗng trong khi
 *      công ty có phiếu ĐÃ PHÁT HÀNH của người khác; 032/084 trên phiếu người khác ⇒ 404 010, 0 audit,
 *      0 hàng `files` (084). ALLOW song sinh: chủ phiếu thật ⇒ 200 ở cả ba. (065 dạng tương tự đã ghim ở
 *      `s15-payroll-be4-advances.int-spec.ts` dòng ~583–590 — KHÔNG lặp lại ở đây.)
 *  #24. **Đối chứng "duyệt mù"** — role giữ `('approve','payroll-advance')` bị gỡ RUNTIME hàng
 *      `('view','payroll-advance')` (mô phỏng trôi sau lúc migrate, SPEC-11 §11.3 ghi chú 7): 059/061 vẫn
 *      403, nhưng 063 (duyệt) vẫn **201** — RỦI RO CÒN LẠI ĐÃ ĐƯỢC OWNER CHẤP NHẬN, ca này CHỈ GHIM hành vi,
 *      không phải bug cần vá.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). 084 cần thêm object storage (`S3_ENDPOINT`/`S3_BUCKET`).
 */
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { inspectPdf, normalizePdfText } from "../helpers/pdf-text";
import {
  employeeProfile,
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
  seedPayrollCatalog,
} from "../helpers/payroll-v2-fixtures";
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
const hasStorage = !!process.env.S3_ENDPOINT && !!process.env.S3_BUCKET;
const LOGIN_PW = loginPasswordFixture("s15qa1bidorleak");
type Actor = { id: string; token: string };

describe.skipIf(!hasLaneDb)("S15-PAYROLL-QA-1 (lane B) · G5 cross-tenant + G7 Own + #24", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let B: SeededTenant;

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const get = (t: string, u: string) => auth(t)(http().get(u));
  const post = (t: string, u: string) => auth(t)(http().post(u));
  const put = (t: string, u: string) => auth(t)(http().put(u));
  const patch = (t: string, u: string) => auth(t)(http().patch(u));

  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function mk(
    t: SeededTenant,
    label: string,
    grant: (id: string) => Promise<void>,
  ): Promise<Actor> {
    const email = `${label}@${t.slug}.test`;
    const id = await seedUser(
      direct,
      t.companyId,
      email,
      await new PasswordService().hash(LOGIN_PW),
    );
    await grant(id);
    return { id, token: await login(t, email) };
  }

  /** Cấp một tập cặp + trả về `roleId` (cần cho #24 — gỡ MỘT hàng `role_permissions` sau khi đã cấp). */
  async function grantReturningRoleId(
    companyId: string,
    userId: string,
    label: string,
    pairs: ReadonlyArray<readonly [string, string]>,
  ): Promise<string> {
    const roleId = await seedRole(
      direct,
      companyId,
      `s15qa1idor-${label}-${randomUUID().slice(0, 6)}`,
    );
    for (const [action, resourceType] of pairs) {
      const permId = await seedPermissionCatalog(direct, action, resourceType, true);
      await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    }
    await seedUserRole(direct, userId, roleId, companyId);
    return roleId;
  }

  const auditCountFor = async (companyId: string, actorId: string): Promise<number> =>
    Number(
      (
        await direct.query(
          `SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND actor_user_id = $2`,
          [companyId, actorId],
        )
      ).rows[0].n,
    );

  let attacker: Actor; // tenant A, đủ mọi cặp — dùng để bắn id của B VÀ làm ALLOW song sinh trên object của A.
  let aOfficer2: Actor; // tenant A, đủ mọi cặp, KHÁC `attacker` — người TẠO tạm ứng ALLOW-twin (tránh tự duyệt).
  let aEmployeeId = "";
  let aTemplateId = "";
  let aBudgetId = "";
  let ownerEmp: Actor; // G7 — Own, CÓ phiếu.
  let noPayslipEmp: Actor; // G7 — Own, KHÔNG BAO GIỜ có phiếu/hồ sơ.
  let ownerPayslipId = "";

  let bEmployeeId = "";
  let bTemplateId = "";
  let bAdvanceId = "";
  let bBudgetId = "";
  let bDependentBaselineCount = 0;

  const FISCAL_YEAR = 2077;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();

    A = await seedCompany(direct, "s15qa1bidora");
    B = await seedCompany(direct, "s15qa1bidorb");
    companyIds.push(A.companyId, B.companyId);

    // ── Tenant A ──────────────────────────────────────────────────────────────────────────────
    attacker = await mk(A, "attacker", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "s15qa1b-atk"),
    );
    aOfficer2 = await mk(A, "officer2", (id) =>
      grantAllPayrollPairs(direct, A.companyId, id, "s15qa1b-off2"),
    );

    aEmployeeId = await seedUser(direct, A.companyId, `aemp@${A.slug}.test`, "x");
    await employeeProfile(direct, A.companyId, aEmployeeId, "QA1B-A01");
    aTemplateId = await seedPayrollCatalog(direct, A.companyId);

    const aBudget = await post(attacker.token, "/payroll/budgets").send({
      fiscalYear: FISCAL_YEAR,
      plannedAmount: 1_000_000,
      note: "qa1b own budget",
    });
    expect(aBudget.status, JSON.stringify(aBudget.body)).toBe(201);
    aBudgetId = aBudget.body.data.id as string;

    ownerEmp = await mk(A, "owneremp", (id) =>
      grantPayrollPairs(
        direct,
        A.companyId,
        id,
        "s15qa1b-owner",
        ["mePayslipList", "mePayslipDetail", "mePayslipPdf"],
        "Own",
      ),
    );
    noPayslipEmp = await mk(A, "nopayslip", (id) =>
      grantPayrollPairs(
        direct,
        A.companyId,
        id,
        "s15qa1b-nopay",
        ["mePayslipList", "mePayslipDetail", "mePayslipPdf"],
        "Own",
      ),
    );
    await direct.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [
      ownerEmp.id,
      "Nguyễn Văn Chủ Phiếu",
    ]);
    await employeeProfile(direct, A.companyId, ownerEmp.id, "QA1B-OWN");
    const approverThrowaway = await seedUser(direct, A.companyId, `approver@${A.slug}.test`, "x");
    const pub = await publishedPeriodWithPayslips(direct, A.companyId, {
      month: "2094-05",
      payees: [
        { userId: ownerEmp.id, net: "6000000.00" },
        { userId: aEmployeeId, net: "6500000.00" },
      ],
      officerId: attacker.id,
      approverId: approverThrowaway,
    });
    ownerPayslipId = pub.payslipIdByUser.get(ownerEmp.id) ?? "";

    // ── Tenant B — bộ đối tượng để A bắn sang ────────────────────────────────────────────────
    const bOfficer = await mk(B, "officer", (id) =>
      grantAllPayrollPairs(direct, B.companyId, id, "s15qa1b-boff"),
    );
    bEmployeeId = await seedUser(direct, B.companyId, `bemp@${B.slug}.test`, "x");
    await employeeProfile(direct, B.companyId, bEmployeeId, "QA1B-B01");
    bTemplateId = await seedPayrollCatalog(direct, B.companyId);

    const bAdvance = await post(bOfficer.token, "/payroll/advances").send({
      userId: bEmployeeId,
      amount: 500_000,
      deductPeriodMonth: "2077-01",
      reason: "qa1b advance cua B",
    });
    expect(bAdvance.status, JSON.stringify(bAdvance.body)).toBe(201);
    bAdvanceId = bAdvance.body.data.id as string;

    const bBudget = await post(bOfficer.token, "/payroll/budgets").send({
      fiscalYear: FISCAL_YEAR,
      plannedAmount: 2_000_000,
      note: "qa1b budget cua B",
    });
    expect(bBudget.status, JSON.stringify(bBudget.body)).toBe(201);
    bBudgetId = bBudget.body.data.id as string;

    const bDep = await post(bOfficer.token, `/payroll/employees/${bEmployeeId}/dependents`).send({
      fullName: "NPT cua B",
      relationship: "Child",
      effectiveFrom: "2027-01-01",
      effectiveTo: "2027-12-31",
    });
    expect(bDep.status, JSON.stringify(bDep.body)).toBe(201);
    const cnt = await direct.query(
      `SELECT count(*)::int AS n FROM payroll_dependents WHERE company_id = $1 AND user_id = $2`,
      [B.companyId, bEmployeeId],
    );
    bDependentBaselineCount = cnt.rows[0].n as number;
    expect(bDependentBaselineCount).toBe(1);
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═══ G5 — cross-tenant GHI trên 5 route mới ═══════════════════════════════════════════════════

  describe("G5 · 039 PUT settings", () => {
    it("id của B ⇒ 404 010, KHÔNG tạo hàng settings cho B; ALLOW: PUT trên nhân sự CỦA A ⇒ 200", async () => {
      const res = await put(attacker.token, `/payroll/employees/${bEmployeeId}/settings`).send({
        joinsSocialInsurance: true,
        joinsUnion: false,
        bankAccountNumber: "1112223334445",
        bankName: "ACB",
        accountHolder: "KE HOACH XAU",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      const row = await direct.query(
        `SELECT count(*)::int AS n FROM payroll_employee_settings WHERE company_id = $1 AND user_id = $2`,
        [B.companyId, bEmployeeId],
      );
      expect(row.rows[0].n, "404 mà vẫn ghi hàng cho B là lỗ tệ hơn 200").toBe(0);

      const allow = await put(attacker.token, `/payroll/employees/${aEmployeeId}/settings`).send({
        joinsSocialInsurance: true,
        joinsUnion: false,
      });
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
    });
  });

  describe("G5 · 041 POST dependent", () => {
    it("userId của B ⇒ 404 010, số NPT của B KHÔNG đổi; ALLOW: tạo NPT cho nhân sự CỦA A ⇒ 201", async () => {
      const res = await post(attacker.token, `/payroll/employees/${bEmployeeId}/dependents`).send({
        fullName: "NPT gia mao",
        relationship: "Child",
        effectiveFrom: "2028-01-01",
        effectiveTo: "2028-12-31",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      const cnt = await direct.query(
        `SELECT count(*)::int AS n FROM payroll_dependents WHERE company_id = $1 AND user_id = $2`,
        [B.companyId, bEmployeeId],
      );
      expect(cnt.rows[0].n).toBe(bDependentBaselineCount);

      const allow = await post(attacker.token, `/payroll/employees/${aEmployeeId}/dependents`).send(
        {
          fullName: "NPT that cua A",
          relationship: "Child",
          effectiveFrom: "2028-01-01",
          effectiveTo: "2028-12-31",
        },
      );
      expect(allow.status, JSON.stringify(allow.body)).toBe(201);
    });
  });

  describe("G5 · 052 PATCH template", () => {
    it("id mẫu của B ⇒ 404 010, tên mẫu của B KHÔNG đổi; ALLOW: PATCH mẫu CỦA A ⇒ 200", async () => {
      const before = await direct.query(`SELECT name FROM payroll_templates WHERE id = $1`, [
        bTemplateId,
      ]);
      const res = await patch(attacker.token, `/payroll/templates/${bTemplateId}`).send({
        name: "mau bi doi ten tu tenant khac",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      const row = await direct.query(`SELECT name FROM payroll_templates WHERE id = $1`, [
        bTemplateId,
      ]);
      expect(row.rows[0].name).toBe(before.rows[0].name);

      const allow = await patch(attacker.token, `/payroll/templates/${aTemplateId}`).send({
        name: "Mau mac dinh doi ten hop le",
      });
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
    });
  });

  describe("G5 · 064 POST reject tạm ứng", () => {
    it("id tạm ứng của B (Pending) ⇒ 404 010, trạng thái B KHÔNG đổi; ALLOW: từ chối tạm ứng CỦA A ⇒ 201", async () => {
      const res = await post(attacker.token, `/payroll/advances/${bAdvanceId}/reject`).send({
        note: "tu choi xuyen tenant",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      const row = await direct.query(`SELECT status FROM payroll_advances WHERE id = $1`, [
        bAdvanceId,
      ]);
      expect(row.rows[0].status).toBe("Pending");

      // ALLOW: tạo tạm ứng CỦA A (người TẠO = aOfficer2, thụ hưởng = aEmployeeId) rồi `attacker` (bên thứ
      // ba, không phải người tạo/thụ hưởng) từ chối — tránh 409 `self-approval` (SPEC-11 §11.3 B2).
      const created = await post(aOfficer2.token, "/payroll/advances").send({
        userId: aEmployeeId,
        amount: 300_000,
        deductPeriodMonth: "2077-02",
        reason: "qa1b advance cua A",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const allow = await post(
        attacker.token,
        `/payroll/advances/${created.body.data.id}/reject`,
      ).send({ note: "tu choi hop le" });
      expect(allow.status, JSON.stringify(allow.body)).toBe(201);
    });
  });

  describe("G5 · 075 PATCH budget", () => {
    it("id ngân sách của B (thật, không phải random) ⇒ 404 010, số tiền B KHÔNG đổi; ALLOW: PATCH ngân sách CỦA A ⇒ 200", async () => {
      const res = await patch(attacker.token, `/payroll/budgets/${bBudgetId}`).send({
        plannedAmount: 999,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      const row = await direct.query(`SELECT planned_amount FROM payroll_budgets WHERE id = $1`, [
        bBudgetId,
      ]);
      expect(Number(row.rows[0].planned_amount)).toBe(2_000_000);

      const allow = await patch(attacker.token, `/payroll/budgets/${aBudgetId}`).send({
        plannedAmount: 1_500_000,
      });
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
    });
  });

  describe("G5 · loại trừ danh sách 036/073", () => {
    it("036 danh sách nhân sự của A CÓ nhân sự A, KHÔNG có nhân sự B", async () => {
      const res = await get(attacker.token, "/payroll/employees?per_page=100");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ userId: string }>).map((x) => x.userId);
      expect(ids, "nhân sự CỦA A phải có mặt").toContain(aEmployeeId);
      expect(ids, "nhân sự CỦA B không được lọt vào").not.toContain(bEmployeeId);
    });

    it("073 danh sách ngân sách của A CÓ ngân sách A, KHÔNG có ngân sách B (CÙNG fiscalYear)", async () => {
      const res = await get(attacker.token, `/payroll/budgets?fiscalYear=${FISCAL_YEAR}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(ids, "ngân sách CỦA A phải có mặt").toContain(aBudgetId);
      expect(ids, "ngân sách CỦA B không được lọt vào").not.toContain(bBudgetId);
    });
  });

  // ═══ G7 — Own fail-closed: người CHƯA TỪNG có phiếu ═══════════════════════════════════════════

  describe("G7 · 031 danh sách của người CHƯA TỪNG có phiếu", () => {
    it("200 rỗng CHÍNH XÁC dù công ty có phiếu ĐÃ PHÁT HÀNH của người khác", async () => {
      const res = await get(noPayslipEmp.token, "/me/payslips");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toEqual([]);
      if (res.body.pagination) expect(res.body.pagination.total).toBe(0);

      // ALLOW song sinh — chủ phiếu thật thấy DANH SÁCH KHÔNG rỗng.
      const allow = await get(ownerEmp.token, "/me/payslips");
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
      const ids = (allow.body.data as Array<{ id: string }>).map((x) => x.id);
      expect(ids).toContain(ownerPayslipId);
    });
  });

  describe("G7 · 032 chi tiết phiếu người khác cho người KHÔNG có phiếu nào", () => {
    it("404 010, 0 audit; ALLOW: chủ phiếu đọc phiếu CỦA MÌNH ⇒ 200", async () => {
      const before = await auditCountFor(A.companyId, noPayslipEmp.id);
      const res = await get(noPayslipEmp.token, `/me/payslips/${ownerPayslipId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      expect(await auditCountFor(A.companyId, noPayslipEmp.id)).toBe(before);

      const allow = await get(ownerEmp.token, `/me/payslips/${ownerPayslipId}`);
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
      expect(allow.body.data.id).toBe(ownerPayslipId);
    });
  });

  describe.skipIf(!hasStorage)("G7 · 084 PDF phiếu người khác cho người KHÔNG có phiếu nào", () => {
    it("404 010, 0 audit, 0 hàng `files`; ALLOW: chủ phiếu tải PDF CỦA MÌNH ⇒ 200", async () => {
      const before = await auditCountFor(A.companyId, noPayslipEmp.id);
      const res = await get(noPayslipEmp.token, `/me/payslips/${ownerPayslipId}/pdf`);
      expect(res.status, JSON.stringify(res.body)).toBe(404);
      expect(res.body.error.code).toBe("PAYROLL-ERR-010");
      expect(await auditCountFor(A.companyId, noPayslipEmp.id)).toBe(before);
      const files = await direct.query(
        `SELECT count(*)::int AS n FROM files WHERE company_id = $1 AND uploaded_by = $2`,
        [A.companyId, noPayslipEmp.id],
      );
      expect(files.rows[0].n).toBe(0);

      const allow = await get(ownerEmp.token, `/me/payslips/${ownerPayslipId}/pdf`);
      expect(allow.status, JSON.stringify(allow.body)).toBe(200);
      expect(typeof allow.body.data.url).toBe("string");
      const pdf = await inspectPdf(
        new Uint8Array(await (await fetch(allow.body.data.url as string)).arrayBuffer()),
      );
      expect(normalizePdfText(pdf.text)).toContain("Nguyễn Văn Chủ Phiếu");
    });
  });

  // ═══ #24 — đối chứng "duyệt mù" (RỦI RO CÒN LẠI, KHÔNG phải bug) ═══════════════════════════════

  describe("#24 · role giữ approve nhưng bị gỡ view LÚC RUNTIME vẫn duyệt được (SPEC-11 §11.3 ghi chú 7)", () => {
    it("059/061 403 sau khi gỡ view; 063 duyệt tạm ứng KHÔNG liên quan ⇒ vẫn 201 (ghim rủi ro đã owner chấp nhận)", async () => {
      const gapEmail = `gapapprove@${A.slug}.test`;
      const gapId = await seedUser(
        direct,
        A.companyId,
        gapEmail,
        await new PasswordService().hash(LOGIN_PW),
      );
      // Cấp CẢ HAI cặp trước — mô phỏng trạng thái "đúng lúc migrate" mà invariant seed từng giữ.
      const gapRoleId = await grantReturningRoleId(A.companyId, gapId, "gap", [
        ["approve", "payroll-advance"],
        ["view", "payroll-advance"],
      ]);
      const gapToken = await login(A, gapEmail);

      // Đối chứng KHÔNG-vacuous: TRƯỚC khi gỡ, 059 phải 200 (chứng minh 403 sau đó là DO việc gỡ, không
      // phải vì role thiếu quyền từ đầu).
      const before059 = await get(gapToken, "/payroll/advances");
      expect(before059.status, JSON.stringify(before059.body)).toBe(200);

      // Trôi RUNTIME (không qua migration) — gỡ đúng MỘT hàng `role_permissions` của cặp `view`.
      const del = await direct.query(
        `DELETE FROM role_permissions rp USING permissions p
          WHERE rp.permission_id = p.id AND rp.role_id = $1
            AND p.action = 'view' AND p.resource_type = 'payroll-advance'`,
        [gapRoleId],
      );
      expect(del.rowCount, "phải gỡ đúng 1 hàng — kẻo ca này xanh vì lý do khác").toBe(1);

      expect((await get(gapToken, "/payroll/advances")).status).toBe(403);
      const someAdvance = await post(aOfficer2.token, "/payroll/advances").send({
        userId: aEmployeeId,
        amount: 111_000,
        deductPeriodMonth: "2077-03",
        reason: "qa1b blind-approval residual",
      });
      expect(someAdvance.status, JSON.stringify(someAdvance.body)).toBe(201);
      expect((await get(gapToken, `/payroll/advances/${someAdvance.body.data.id}`)).status).toBe(
        403,
      );

      // RỦI RO CÒN LẠI: 063 (duyệt) chỉ đòi cặp `approve`, KHÔNG đòi `view` — vẫn 201. Đây KHÔNG phải lỗ
      // hổng cần vá trong WO này (owner đã ký nhận ở SPEC-11 §11.3 ghi chú 7) — ca này CHỈ GHIM hành vi để
      // một lượt sau lỡ "vá" bằng cách thêm view-check vào resolveActor thì biết mình vừa đổi hợp đồng.
      const approve = await post(
        gapToken,
        `/payroll/advances/${someAdvance.body.data.id}/approve`,
      ).send({});
      expect(approve.status, JSON.stringify(approve.body)).toBe(201);
    });
  });
});

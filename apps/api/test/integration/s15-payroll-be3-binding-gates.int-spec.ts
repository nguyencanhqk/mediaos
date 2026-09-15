/**
 * S15-PAYROLL-BE-3 — gắn mẫu vào kỳ (002/004) + cổng FAIL-CLOSED của `calculate` (plan §4.2 · §4.3 · §0b B1 · B2 · M1 ·
 * §3.7). Đường thật (HTTP + Postgres lane), dữ liệu hỏng dựng bằng GHI THẲNG DB — đúng mô hình «lách tiền-kiểm».
 *
 * QUY TẮC:
 *  - mỗi cổng DENY từ `CollectingData` assert kỳ Ở NGUYÊN trạng thái và 0 dòng (lỗi ⇒ rollback cả lượt);
 *  - nhóm B2 dựng trạng thái `Calculated` CÓ dòng + fingerprint + thưởng đã gắn + tạm ứng `Deducted` rồi gây lỗi khi
 *    TÍNH LẠI — ca «lỗi ⇒ không đổi gì» trên kỳ rỗng là xanh-RỖNG (plan §0b B2);
 *  - mọi thao tác phá dữ liệu dùng chung (hàng hệ thống, bản tỉ lệ) KHÔI PHỤC trong `finally`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
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
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cloneTemplate,
  grantAllPayrollPairs,
  lockedAttendancePeriod,
  seedPayrollCatalog,
  setProfileItem,
  setTemplateOverride,
  unlinkTemplateComponent,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe3gates");
const REQUIRED_INPUTS = ["THUONG", "PHAT", "TAM_UNG", "NGHI_KHONG_LUONG"] as const;

describe.skipIf(!hasLaneDb)("S15-PAYROLL-BE-3 · gắn mẫu (002/004) + cổng fail-closed của calculate", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;
  let B: SeededTenant;
  let C: SeededTenant;
  let N: SeededTenant;
  let tA = "";
  let tC = "";
  let tN = "";
  let officerA = "";
  let adminA = "";
  let officerC = "";
  let templateA = "";
  let templateB = "";
  let templateC = "";
  /** Nhân sự GROSS và NET của A — NET dùng để gây 021 bằng phụ cấp hồ sơ lớn hơn NET mục tiêu. */
  let grossUser = "";
  let netUser = "";
  let seq = 0;

  const nextMonth = (): string => {
    const i = seq++;
    return `${2060 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };
  const nextCode = (): string => `BE3_CLONE_${seq++}`;

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({
    post: (u: string) => http().post(u).set("Authorization", `Bearer ${t}`),
    patch: (u: string) => http().patch(u).set("Authorization", `Bearer ${t}`),
  });

  const detail = (res: request.Response, field: string): string | undefined =>
    (res.body?.error?.details as Array<{ field: string; message: string }> | undefined)?.find(
      (d) => d.field === field,
    )?.message;

  function expectError(res: request.Response, status: number, code: string, kind: string): void {
    const label = `${res.status} ${JSON.stringify(res.body)}`;
    expect(res.status, label).toBe(status);
    expect(res.body?.error?.code, label).toBe(code);
    expect(detail(res, "kind"), label).toBe(kind);
  }

  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http().post("/auth/login").send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function payrollUser(t: SeededTenant, label: string, hash: string) {
    const email = `${label}@${t.slug}.test`;
    const id = await seedUser(direct, t.companyId, email, hash);
    await grantAllPayrollPairs(direct, t.companyId, id, `be3g-${label}`);
    return { id, token: await login(t, email) };
  }

  async function profile(companyId: string, userId: string, base: string, type: "GROSS" | "NET") {
    await direct.query(
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances, salary_type)
       VALUES ($1, $2, '2024-01-01', $3, '[]'::jsonb, $4)`,
      [companyId, userId, base, type],
    );
  }

  /** Kỳ ở `CollectingData`, kỳ công đã khoá. Không truyền `templateId` ⇒ kỳ CHƯA gắn mẫu. */
  async function newPeriod(t: SeededTenant, token: string, templateId?: string): Promise<string> {
    const month = nextMonth();
    const attendancePeriodId = await lockedAttendancePeriod(direct, t.companyId, month);
    const res = await as(token)
      .post("/payroll-periods")
      .send({ periodMonth: month, attendancePeriodId, ...(templateId ? { templateId } : {}) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.id as string;
    expect((await as(token).post(`/payroll-periods/${id}/collect`)).status).toBe(201);
    return id;
  }

  const calc = (token: string, id: string) => as(token).post(`/payroll-periods/${id}/calculate`);

  async function expectUntouched(periodId: string): Promise<void> {
    const r = await direct.query<{ status: string; lines: number }>(
      `SELECT p.status,
              (SELECT count(*)::int FROM payroll_period_lines l
                WHERE l.payroll_period_id = p.id AND l.deleted_at IS NULL) AS lines
         FROM payroll_periods p WHERE p.id = $1`,
      [periodId],
    );
    expect(r.rows[0]).toEqual({ status: "CollectingData", lines: 0 });
  }

  /** Sửa `kind` hàng HỆ THỐNG vượt trigger đóng băng (mô phỏng build cũ/người vượt trigger) — khôi phục trong finally. */
  async function withSystemKind(companyId: string, code: string, kind: string, fn: () => Promise<void>) {
    const orig = await direct.query<{ kind: string }>(
      `SELECT kind FROM salary_components WHERE company_id = $1 AND code = $2 AND is_system`,
      [companyId, code],
    );
    const set = async (k: string) => {
      const c = await direct.connect();
      try {
        await c.query("BEGIN");
        await c.query("ALTER TABLE salary_components DISABLE TRIGGER salary_component_system_freeze");
        await c.query(
          `UPDATE salary_components SET kind = $3 WHERE company_id = $1 AND code = $2 AND is_system`,
          [companyId, code, k],
        );
        await c.query("ALTER TABLE salary_components ENABLE TRIGGER salary_component_system_freeze");
        await c.query("COMMIT");
      } catch (err) {
        await c.query("ROLLBACK");
        throw err;
      } finally {
        c.release();
      }
    };
    await set(kind);
    try {
      await fn();
    } finally {
      await set(orig.rows[0].kind);
    }
  }

  async function withRatesSoftDeleted(companyId: string, fn: () => Promise<void>) {
    const r = await direct.query<{ id: string }>(
      `UPDATE payroll_statutory_rates SET deleted_at = now()
        WHERE company_id = $1 AND deleted_at IS NULL RETURNING id`,
      [companyId],
    );
    expect(r.rows.length, "fixture phải có bản tỉ lệ để xoá").toBeGreaterThan(0);
    try {
      await fn();
    } finally {
      await direct.query(`UPDATE payroll_statutory_rates SET deleted_at = NULL WHERE id = ANY($1::uuid[])`, [
        r.rows.map((x) => x.id),
      ]);
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Ca race 058 giữ một request HTTP treo trong khi test chạy câu DB — server phải nghe thật (khuôn fsm-race).
    await app.listen(0);
    direct = directPool();
    const hash = await new PasswordService().hash(LOGIN_PW);

    A = await seedCompany(direct, "be3gatesa");
    B = await seedCompany(direct, "be3gatesb");
    C = await seedCompany(direct, "be3gatesc");
    N = await seedCompany(direct, "be3gatesn");
    for (const t of [A, B, C, N]) {
      companyIds.push(t.companyId);
      await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
        t.companyId,
        JSON.stringify({ days: [1, 2, 3, 4, 5] }),
      ]);
    }
    templateA = await seedPayrollCatalog(direct, A.companyId);
    templateB = await seedPayrollCatalog(direct, B.companyId);
    templateC = await seedPayrollCatalog(direct, C.companyId);
    // N CỐ Ý không seed catalog — ca «công ty chưa seed» phải 422, không 200 với net = 0.

    ({ id: officerA, token: tA } = await payrollUser(A, "officer", hash));
    // adminA chỉ là NGƯỜI DUYỆT của fixture (four-eyes thưởng/phạt/tạm ứng) — không gọi route; B chỉ cần mẫu (ca 404).
    ({ id: adminA } = await payrollUser(A, "admin", hash));
    ({ id: officerC, token: tC } = await payrollUser(C, "officer", hash));
    ({ token: tN } = await payrollUser(N, "officer", hash));

    grossUser = await seedUser(direct, A.companyId, `gross@${A.slug}.test`, "x");
    netUser = await seedUser(direct, A.companyId, `net@${A.slug}.test`, "x");
    await profile(A.companyId, grossUser, "20000000.00", "GROSS");
    await profile(A.companyId, netUser, "10000000.00", "NET");
    await setProfileItem(direct, A.companyId, netUser, "PHU_CAP", "1000000.00");
    const cUser = await seedUser(direct, C.companyId, `gross@${C.slug}.test`, "x");
    await profile(C.companyId, cUser, "15000000.00", "GROSS");
    const nUser = await seedUser(direct, N.companyId, `gross@${N.slug}.test`, "x");
    await profile(N.companyId, nUser, "15000000.00", "GROSS");
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // BIND — 002 · 004
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("BIND — gắn mẫu vào kỳ lúc tạo (002) và lúc sửa (004)", () => {
    it("BIND1 — 002 gắn MAU_MAC_DINH ⇒ 201 + `templateId`; không gửi ⇒ `templateId` null", async () => {
      const month = nextMonth();
      const att = await lockedAttendancePeriod(direct, A.companyId, month);
      const res = await as(tA)
        .post("/payroll-periods")
        .send({ periodMonth: month, attendancePeriodId: att, templateId: templateA });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.templateId).toBe(templateA);
      const bare = await as(tA).post("/payroll-periods").send({ periodMonth: nextMonth() });
      expect(bare.status, JSON.stringify(bare.body)).toBe(201);
      expect(bare.body.data.templateId).toBeNull();
    });

    it("BIND2 — 004 gắn mẫu khi kỳ ở CollectingData ⇒ 200 + `templateId`", async () => {
      const id = await newPeriod(A, tA);
      const res = await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: templateA });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.templateId).toBe(templateA);
    });

    it("BIND3 — mẫu của tenant KHÁC / id bịa ⇒ 404 sentinel, kỳ KHÔNG được tạo", async () => {
      const month = nextMonth();
      const att = await lockedAttendancePeriod(direct, A.companyId, month);
      expectError(
        await as(tA).post("/payroll-periods").send({ periodMonth: month, attendancePeriodId: att, templateId: templateB }),
        404,
        "PAYROLL-ERR-010",
        "not-found",
      );
      const created = await direct.query(
        `SELECT 1 FROM payroll_periods WHERE company_id = $1 AND period_month = $2`,
        [A.companyId, month],
      );
      expect(created.rows.length).toBe(0);
      const id = await newPeriod(A, tA);
      expectError(
        await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: randomUUID() }),
        404,
        "PAYROLL-ERR-010",
        "not-found",
      );
    });

    it("BIND4 — mẫu ngưng dùng ⇒ 409 023 `template-inactive`", async () => {
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      await direct.query(`UPDATE payroll_templates SET is_active = false WHERE id = $1`, [tpl]);
      const id = await newPeriod(A, tA);
      expectError(
        await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: tpl }),
        409,
        "PAYROLL-ERR-023",
        "template-inactive",
      );
    });

    it("BIND5 — mẫu scope `org_unit` ⇒ 409 023 `template-scope-unsupported` (kỳ tính cho CẢ công ty)", async () => {
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name) VALUES ($1, 'Phòng BE3') RETURNING id`,
        [A.companyId],
      );
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      await direct.query(`UPDATE payroll_templates SET scope = 'org_unit', org_unit_id = $2 WHERE id = $1`, [
        tpl,
        ou.rows[0].id,
      ]);
      const id = await newPeriod(A, tA);
      expectError(
        await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: tpl }),
        409,
        "PAYROLL-ERR-023",
        "template-scope-unsupported",
      );
    });

    it("BIND6 — mẫu thiếu nút tổng hợp / thiếu thành phần mang đầu vào ⇒ 422 018, kỳ KHÔNG đổi mẫu", async () => {
      const id = await newPeriod(A, tA);
      const noEngine = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      await unlinkTemplateComponent(direct, A.companyId, noEngine, "TONG_KHAU_TRU");
      expectError(
        await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: noEngine }),
        422,
        "PAYROLL-ERR-018",
        "template-missing-engine-nodes",
      );
      const noAdvance = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      await unlinkTemplateComponent(direct, A.companyId, noAdvance, "TAM_UNG");
      const res = await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: noAdvance });
      expectError(res, 422, "PAYROLL-ERR-018", "template-input-missing");
      expect(detail(res, "components")).toBe("TAM_UNG");
      const row = await direct.query(`SELECT template_id FROM payroll_periods WHERE id = $1`, [id]);
      expect(row.rows[0].template_id).toBeNull();
    });

    it("BIND7 — 004 đổi mẫu ở Calculated ⇒ 409 023 `template-locked` (KHÔNG 001); sửa ghi chú ⇒ vẫn 001", async () => {
      const id = await newPeriod(A, tA, templateA);
      expect((await calc(tA, id)).status).toBe(201);
      expectError(
        await as(tA).patch(`/payroll-periods/${id}`).send({ templateId: templateA }),
        409,
        "PAYROLL-ERR-023",
        "template-locked",
      );
      const note = await as(tA).patch(`/payroll-periods/${id}`).send({ note: "muộn" });
      expect(note.status, JSON.stringify(note.body)).toBe(409);
      expect(note.body.error.code).toBe("PAYROLL-ERR-001");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // G — cổng calculate từ CollectingData: lỗi ⇒ kỳ Ở NGUYÊN + 0 dòng
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("G — cổng fail-closed của calculate (kỳ giữ CollectingData, 0 dòng)", () => {
    it("G1 — kỳ CHƯA gắn mẫu ⇒ 409 023 `template-missing` (owner O-1: không rơi về công thức v1)", async () => {
      const id = await newPeriod(A, tA);
      expectError(await calc(tA, id), 409, "PAYROLL-ERR-023", "template-missing");
      await expectUntouched(id);
    });

    it("G2 — mẫu của kỳ bị XOÁ MỀM sau khi gắn ⇒ 409 023 `template-missing` (reason template-deleted)", async () => {
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      const id = await newPeriod(A, tA, tpl);
      await direct.query(`UPDATE payroll_templates SET deleted_at = now() WHERE id = $1`, [tpl]);
      const res = await calc(tA, id);
      expectError(res, 409, "PAYROLL-ERR-023", "template-missing");
      expect(detail(res, "reason")).toBe("template-deleted");
      await expectUntouched(id);
    });

    it("G3 — mẫu bị NGƯNG sau khi gắn ⇒ 409 023 `template-inactive`", async () => {
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      const id = await newPeriod(A, tA, tpl);
      await direct.query(`UPDATE payroll_templates SET is_active = false WHERE id = $1`, [tpl]);
      expectError(await calc(tA, id), 409, "PAYROLL-ERR-023", "template-inactive");
      await expectUntouched(id);
    });

    it("G4 — mẫu bị đổi sang scope org_unit sau khi gắn ⇒ 409 023 `template-scope-unsupported`", async () => {
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name) VALUES ($1, 'Phòng BE3 G4') RETURNING id`,
        [A.companyId],
      );
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      const id = await newPeriod(A, tA, tpl);
      await direct.query(`UPDATE payroll_templates SET scope = 'org_unit', org_unit_id = $2 WHERE id = $1`, [
        tpl,
        ou.rows[0].id,
      ]);
      expectError(await calc(tA, id), 409, "PAYROLL-ERR-023", "template-scope-unsupported");
      await expectUntouched(id);
    });

    it("G5 — KHÔNG có bản tỉ lệ hiệu lực ⇒ 422 022 `statutory-rate-missing` (CẤM tính với tỉ lệ 0)", async () => {
      const id = await newPeriod(A, tA, templateA);
      await withRatesSoftDeleted(A.companyId, async () => {
        expectError(await calc(tA, id), 422, "PAYROLL-ERR-022", "statutory-rate-missing");
      });
      await expectUntouched(id);
    });

    it("G6 — bậc TNCN ghi thẳng DB không tăng dần ⇒ 422 022 `statutory-rate-incomplete`", async () => {
      const id = await newPeriod(A, tA, templateA);
      const rate = await direct.query<{ id: string; pit_brackets: unknown }>(
        `SELECT id, pit_brackets FROM payroll_statutory_rates WHERE company_id = $1 AND deleted_at IS NULL`,
        [A.companyId],
      );
      const broken = [
        { upTo: 10000000, rate: 5 },
        { upTo: 5000000, rate: 10 },
        { upTo: 18000000, rate: 15 },
        { upTo: 32000000, rate: 20 },
        { upTo: 52000000, rate: 25 },
        { upTo: 80000000, rate: 30 },
        { upTo: null, rate: 35 },
      ];
      await direct.query(`UPDATE payroll_statutory_rates SET pit_brackets = $2::jsonb WHERE id = $1`, [
        rate.rows[0].id,
        JSON.stringify(broken),
      ]);
      try {
        expectError(await calc(tA, id), 422, "PAYROLL-ERR-022", "statutory-rate-incomplete");
      } finally {
        await direct.query(`UPDATE payroll_statutory_rates SET pit_brackets = $2::jsonb WHERE id = $1`, [
          rate.rows[0].id,
          JSON.stringify(rate.rows[0].pit_brackets),
        ]);
      }
      await expectUntouched(id);
    });

    it("G7 — link nút tổng hợp bị gỡ thẳng DB sau khi gắn ⇒ 422 018 (kiểm đồ thị LẦN HAI lúc tính)", async () => {
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      const id = await newPeriod(A, tA, tpl);
      await unlinkTemplateComponent(direct, A.companyId, tpl, "TONG_KHAU_TRU");
      expectError(await calc(tA, id), 422, "PAYROLL-ERR-018", "template-missing-engine-nodes");
      await expectUntouched(id);
    });

    it("G8 — ghi đè công thức tạo VÒNG ghi thẳng DB ⇒ 422 019 `formula-cycle`", async () => {
      const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      const id = await newPeriod(A, tA, tpl);
      await setTemplateOverride(direct, A.companyId, tpl, "LUONG_CO_BAN", "TONG_THU_NHAP");
      expectError(await calc(tA, id), 422, "PAYROLL-ERR-019", "formula-cycle");
      await expectUntouched(id);
    });

    it("G9 — hàng HỆ THỐNG lệch hằng seeder (kind THUONG) ⇒ 422 018 `system-component-drift`", async () => {
      const id = await newPeriod(A, tA, templateA);
      await withSystemKind(A.companyId, "THUONG", "deduction", async () => {
        const res = await calc(tA, id);
        expectError(res, 422, "PAYROLL-ERR-018", "system-component-drift");
        expect(detail(res, "components")).toBe("THUONG");
      });
      await expectUntouched(id);
    });

    const COVERAGE_CASES = REQUIRED_INPUTS.flatMap((code) =>
      (["unlink", "override"] as const).map((variant) => ({ code, variant })),
    );
    it.each(COVERAGE_CASES)(
      "G10 — B1 độ phủ đầu vào: $variant $code ⇒ 422 018 `template-input-missing`",
      async ({ code, variant }) => {
        const tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
        const id = await newPeriod(A, tA, tpl);
        if (variant === "unlink") await unlinkTemplateComponent(direct, A.companyId, tpl, code);
        else await setTemplateOverride(direct, A.companyId, tpl, code, "0");
        const res = await calc(tA, id);
        expectError(res, 422, "PAYROLL-ERR-018", "template-input-missing");
        expect(detail(res, "components")).toBe(code);
        await expectUntouched(id);
      },
    );

    it("G11 — item hồ sơ mang mã NGOÀI mẫu (PC_001 di sản) ⇒ 422 018 `profile-item-unknown-component` + userId", async () => {
      const id = await newPeriod(A, tA, templateA);
      await setProfileItem(direct, A.companyId, grossUser, "PC_001", "500000.00");
      try {
        const res = await calc(tA, id);
        expectError(res, 422, "PAYROLL-ERR-018", "profile-item-unknown-component");
        expect(detail(res, "userId")).toBe(grossUser);
        expect(detail(res, "componentCodes")).toBe("PC_001");
      } finally {
        await direct.query(
          `UPDATE salary_profile_items SET deleted_at = now() WHERE company_id = $1 AND component_code = 'PC_001'`,
          [A.companyId],
        );
      }
      await expectUntouched(id);
    });

    it("G12 — gross-up NET căn cứ lặp ≤ 0 ⇒ 422 021 `grossup-not-converged` + userId, 0 dòng", async () => {
      const id = await newPeriod(A, tA, templateA);
      await setProfileItem(direct, A.companyId, netUser, "PHU_CAP", "99000000.00");
      try {
        const res = await calc(tA, id);
        expectError(res, 422, "PAYROLL-ERR-021", "grossup-not-converged");
        expect(detail(res, "userId")).toBe(netUser);
        expect(detail(res, "reason")).toBe("non-positive-base");
        expect(detail(res, "iterations")).toBe("1");
      } finally {
        await setProfileItem(direct, A.companyId, netUser, "PHU_CAP", "1000000.00");
      }
      await expectUntouched(id);
    });

    it("G13 — công ty CHƯA seed catalog + mẫu tự tạo gắn thẳng DB ⇒ 422 018, KHÔNG 200 với net = 0", async () => {
      const id = await newPeriod(N, tN);
      const tpl = await direct.query<{ id: string }>(
        `INSERT INTO payroll_templates (company_id, code, name, scope, is_active) VALUES ($1, 'TU_TAO', 'Tự tạo', 'company', true) RETURNING id`,
        [N.companyId],
      );
      await direct.query(`UPDATE payroll_periods SET template_id = $2 WHERE id = $1`, [id, tpl.rows[0].id]);
      const res = await calc(tN, id);
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe("PAYROLL-ERR-018");
      await expectUntouched(id);
    });

    it("G14 — m3: khoản Approved của người KHÔNG đủ điều kiện ⇒ 201 + `warnings` đếm (không tiền), khoản KHÔNG bị gắn", async () => {
      const month = nextMonth();
      const orphan = await seedUser(direct, A.companyId, `orphan-${randomUUID().slice(0, 6)}@x.test`, "x");
      const bp = await direct.query<{ id: string }>(
        `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status, created_by, decided_by, decided_at)
         VALUES ($1, $2, 'bonus', 100000, $3, 'be3 m3', 'Approved', $4, $5, now()) RETURNING id`,
        [A.companyId, orphan, month, officerA, adminA],
      );
      const adv = await direct.query<{ id: string }>(
        `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, status, created_by)
         VALUES ($1, $2, 200000, $3, 'be3 m3', 'Pending', $4) RETURNING id`,
        [A.companyId, orphan, month, officerA],
      );
      await direct.query(
        `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
        [adv.rows[0].id, adminA],
      );
      const att = await lockedAttendancePeriod(direct, A.companyId, month);
      const p = await as(tA).post("/payroll-periods").send({ periodMonth: month, attendancePeriodId: att, templateId: templateA });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      expect((await as(tA).post(`/payroll-periods/${p.body.data.id}/collect`)).status).toBe(201);
      const res = await calc(tA, p.body.data.id as string);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data.warnings).toEqual(
        expect.arrayContaining(["unconsumed-bonus-penalties:1", "unconsumed-advances:1"]),
      );
      const bound = await direct.query(
        `SELECT (SELECT payroll_period_id FROM bonus_penalties WHERE id = $1) AS bp,
                (SELECT payroll_period_id FROM payroll_advances WHERE id = $2) AS adv`,
        [bp.rows[0].id, adv.rows[0].id],
      );
      expect(bound.rows[0]).toEqual({ bp: null, adv: null });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // B2 — lỗi khi TÍNH LẠI từ Calculated: dòng · fingerprint · thưởng đã gắn · tạm ứng Deducted Y NGUYÊN
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("B2 — lỗi khi tính lại từ Calculated ⇒ KHÔNG đổi gì (plan §0b B2)", () => {
    let periodId = "";
    let tpl = "";
    let bonusId = "";
    let advanceId = "";
    let before: Awaited<ReturnType<typeof snapshot>>;

    async function snapshot() {
      const lines = await direct.query(
        `SELECT user_id, base_amount::text, allowance_amount::text, bonus_amount::text, penalty_amount::text,
                deduction_amount::text, adjustment_amount::text, gross::text, net::text,
                template_fingerprint, gross_up_iterations, component_values_json
           FROM payroll_period_lines
          WHERE payroll_period_id = $1 AND deleted_at IS NULL ORDER BY user_id`,
        [periodId],
      );
      const bonus = await direct.query(`SELECT payroll_period_id, consumed_at FROM bonus_penalties WHERE id = $1`, [
        bonusId,
      ]);
      const advance = await direct.query(
        `SELECT status, payroll_period_id, consumed_at FROM payroll_advances WHERE id = $1`,
        [advanceId],
      );
      const period = await direct.query(`SELECT status FROM payroll_periods WHERE id = $1`, [periodId]);
      return { lines: lines.rows, bonus: bonus.rows[0], advance: advance.rows[0], status: period.rows[0].status };
    }

    async function expectRecalcFailsUntouched(status: number, code: string, kind: string) {
      expectError(await calc(tA, periodId), status, code, kind);
      expect(await snapshot()).toEqual(before);
    }

    beforeAll(async () => {
      tpl = await cloneTemplate(direct, A.companyId, templateA, nextCode(), officerA);
      periodId = await newPeriod(A, tA, tpl);
      const month = (
        await direct.query<{ m: string }>(`SELECT period_month AS m FROM payroll_periods WHERE id = $1`, [periodId])
      ).rows[0].m;
      const bp = await direct.query<{ id: string }>(
        `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status, created_by, decided_by, decided_at)
         VALUES ($1, $2, 'bonus', 700000, $3, 'be3 b2', 'Approved', $4, $5, now()) RETURNING id`,
        [A.companyId, grossUser, month, officerA, adminA],
      );
      bonusId = bp.rows[0].id;
      const adv = await direct.query<{ id: string }>(
        `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, status, created_by)
         VALUES ($1, $2, 300000, $3, 'be3 b2', 'Pending', $4) RETURNING id`,
        [A.companyId, grossUser, month, officerA],
      );
      advanceId = adv.rows[0].id;
      await direct.query(
        `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
        [advanceId, adminA],
      );
      const res = await calc(tA, periodId);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      before = await snapshot();
      // Neo chống xanh-RỖNG: trạng thái trước PHẢI có đủ thứ để mất.
      expect(before.status).toBe("Calculated");
      expect(before.lines.length).toBe(2);
      expect(before.lines.every((l) => /^[0-9a-f]{64}$/.test(l.template_fingerprint as string))).toBe(true);
      expect(before.bonus.payroll_period_id).toBe(periodId);
      expect(before.advance).toMatchObject({ status: "Deducted", payroll_period_id: periodId });
    }, 120_000);

    it("B2a — 021 (NET không hội tụ) khi tính lại", async () => {
      await setProfileItem(direct, A.companyId, netUser, "PHU_CAP", "99000000.00");
      try {
        await expectRecalcFailsUntouched(422, "PAYROLL-ERR-021", "grossup-not-converged");
      } finally {
        await setProfileItem(direct, A.companyId, netUser, "PHU_CAP", "1000000.00");
      }
    });

    it("B2b — 018 `system-component-drift` khi tính lại", async () => {
      await withSystemKind(A.companyId, "THUONG", "deduction", () =>
        expectRecalcFailsUntouched(422, "PAYROLL-ERR-018", "system-component-drift"),
      );
    });

    it("B2c — 018 `template-input-missing` (ghi đè TAM_UNG thẳng DB) khi tính lại", async () => {
      await setTemplateOverride(direct, A.companyId, tpl, "TAM_UNG", "0");
      try {
        await expectRecalcFailsUntouched(422, "PAYROLL-ERR-018", "template-input-missing");
      } finally {
        await setTemplateOverride(direct, A.companyId, tpl, "TAM_UNG", null);
      }
    });

    it("B2d — 022 `statutory-rate-missing` khi tính lại", async () => {
      await withRatesSoftDeleted(A.companyId, () =>
        expectRecalcFailsUntouched(422, "PAYROLL-ERR-022", "statutory-rate-missing"),
      );
    });

    it("B2e — khôi phục xong, tính lại ⇒ 201 với số + fingerprint BẰNG trước (tạm ứng vẫn Deducted, không nhân đôi)", async () => {
      expect((await calc(tA, periodId)).status).toBe(201);
      const after = await snapshot();
      const money = (s: typeof before) =>
        s.lines.map(({ component_values_json: _cvj, ...rest }) => rest);
      expect(money(after)).toEqual(money(before));
      expect(after.advance).toMatchObject({ status: "Deducted", payroll_period_id: periodId });
      expect(after.bonus.payroll_period_id).toBe(periodId);
      const bound = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM payroll_advances WHERE payroll_period_id = $1`,
        [periodId],
      );
      expect(bound.rows[0].n).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // R — 058 đua với calculate (plan §3.7)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("R — 058 lấy khoá catalog ĐỘC QUYỀN", () => {
    async function waitForAdvisoryWaiter(): Promise<void> {
      for (let i = 0; i < 100; i++) {
        const r = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = 'advisory'`,
        );
        if (r.rows[0].n > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("058 KHÔNG chờ khoá catalog sau 5s — khoá độc quyền vắng mặt?");
    }

    it("R1 — calculate giữ khoá dùng chung ⇒ 058 CHỜ; kỳ thành Calculated rồi commit ⇒ 058 thấy in-use ⇒ 409 033", async () => {
      const rate = await direct.query<{ id: string }>(
        `SELECT id FROM payroll_statutory_rates WHERE company_id = $1 AND deleted_at IS NULL`,
        [C.companyId],
      );
      const rateId = rate.rows[0].id;
      const periodId = await newPeriod(C, tC, templateC);
      // ĐỐI CHỨNG ALLOW: chưa kỳ nào dùng bản tỉ lệ ⇒ 058 sửa được.
      const ok = await as(tC).patch(`/payroll/statutory-rates/${rateId}`).send({ note: "be3 allow" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);

      const holder = await direct.connect();
      try {
        await holder.query("BEGIN");
        await holder.query("SELECT pg_advisory_xact_lock_shared(hashtext($1))", [`payroll-catalog:${C.companyId}`]);
        const pending = as(tC)
          .patch(`/payroll/statutory-rates/${rateId}`)
          .send({ note: "be3 race" })
          .then((r) => r);
        await waitForAdvisoryWaiter();
        await holder.query(
          `UPDATE payroll_periods SET status = 'Calculated', calculated_by = $2, calculated_at = now() WHERE id = $1`,
          [periodId, officerC],
        );
        await holder.query("COMMIT");
        expectError(await pending, 409, "PAYROLL-ERR-033", "rate-in-use");
      } finally {
        holder.release();
      }
    });
  });
});

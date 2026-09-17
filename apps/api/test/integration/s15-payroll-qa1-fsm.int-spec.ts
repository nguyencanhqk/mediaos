/**
 * S15-PAYROLL-QA-1 — G9 (FSM kỳ lương ở tầng HTTP, bảng kỳ vọng CHÉP TAY) + G12 (mã 005/006 qua HTTP).
 *
 * ⚠️ **KHÁC `s13-payroll-qa1-fsm-race.int-spec.ts`**: file đó suy tập ô CHO/CẤM từ CHÍNH `nextStatus()` —
 * đúng để đo THỨ TỰ CỔNG, nhưng một bug trong `nextStatus()` sẽ lọt qua vì test và code-dưới-test suy từ
 * CÙNG một nguồn. `HAND_TABLE` dưới đây là bảng **CHÉP TAY** (literal, không gọi `nextStatus`/`isAllowedTransition`
 * khi dựng kỳ vọng) cho 8 trạng thái × 9 action CÓ ROUTE (72 ô) — `nextStatus` chỉ xuất hiện ĐÚNG MỘT lần, ở ca
 * cross-check cuối file, tách biệt khỏi nguồn kỳ vọng của `it.each`.
 *
 * **Phát hiện của bảng tay (KHÔNG thấy được nếu suy từ `nextStatus`)**: FSM cho phép 13 ô (10 cạnh đổi trạng
 * thái có route + 3 ô tại chỗ), nhưng CHỈ 11 ô thật sự trả 2xx qua HTTP trên fixture này — `publish@Approved`
 * và `generate-payslips@Approved` bị cổng 007 (chưa có phiếu / chưa có dòng nháp) chặn TRƯỚC khi tới FSM, vì
 * fixture CỐ Ý không sinh phiếu/dòng cho 8 kỳ của ma trận (cùng khuôn `s13-payroll-qa1-fsm-race`: "fixture mục A
 * CỐ Ý không sinh phiếu"). SPEC-11 §21.1 mục 12 nói mọi ô ✗ ⇒ 409 001 — `publish` ở 7/8 trạng thái KHÔNG-Approved
 * trả **007** thay vì 001 (cổng "chưa sinh phiếu" chạy TRƯỚC FSM, xem `payroll-payslips.service.ts:137`), lệch so
 * với văn bản §21.1 nhưng là quyết định thứ tự cổng ĐÃ ĐO (không phải bug — cùng phát hiện của s13, ghim lại ở
 * đây bằng bảng tay độc lập).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { nextStatus } from "../../src/payroll/payroll-fsm";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import { writeSalaryProfileWithItems } from "../helpers/payroll-fixtures";
import { grantAllPayrollPairs, seedPayrollCatalog } from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollqa1fsm");

const STATUSES: readonly PayrollPeriodStatus[] = [
  "Draft",
  "CollectingData",
  "Calculated",
  "Reviewing",
  "Approved",
  "Published",
  "Paid",
  "Locked",
];

/** 9 action CÓ ROUTE trên `/payroll-periods/:id/…` (KHÔNG có `complete-batch` — không route, xem BE-4). */
const ROUTES: ReadonlyArray<{
  action: string;
  path: (id: string) => string;
  body?: Record<string, unknown>;
}> = [
  { action: "collect", path: (id) => `/payroll-periods/${id}/collect` },
  { action: "calculate", path: (id) => `/payroll-periods/${id}/calculate` },
  { action: "submit", path: (id) => `/payroll-periods/${id}/submit` },
  { action: "approve", path: (id) => `/payroll-periods/${id}/approve` },
  {
    action: "reject",
    path: (id) => `/payroll-periods/${id}/reject`,
    body: { reason: "qa s15 fsm hand-table" },
  },
  { action: "generate-payslips", path: (id) => `/payroll-periods/${id}/generate-payslips` },
  { action: "publish", path: (id) => `/payroll-periods/${id}/publish` },
  { action: "lock", path: (id) => `/payroll-periods/${id}/lock` },
  {
    action: "reopen",
    path: (id) => `/payroll-periods/${id}/reopen`,
    body: { reason: "qa s15 fsm hand-table" },
  },
];

interface Cell {
  status: number;
  code?: string;
  kind?: string;
}
const OK = (status = 201): Cell => ({ status });
const DENY = (code: string, kind?: string): Cell => ({ status: 409, code, kind });

/**
 * BẢNG TAY — 8 trạng thái × 9 action, CHÉP TỪ ĐỌC SOURCE (payroll-fsm.ts · payroll-calc.service.ts ·
 * payroll-approval.service.ts · payroll-payslips.service.ts), KHÔNG gọi hàm nào của module đang test.
 */
const HAND_TABLE: Record<PayrollPeriodStatus, Record<string, Cell>> = {
  Draft: {
    collect: OK(),
    calculate: DENY("PAYROLL-ERR-001"),
    submit: DENY("PAYROLL-ERR-001"),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: DENY("PAYROLL-ERR-001"),
    reopen: DENY("PAYROLL-ERR-001"),
  },
  CollectingData: {
    collect: OK(),
    calculate: OK(),
    submit: DENY("PAYROLL-ERR-001"),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: DENY("PAYROLL-ERR-001"),
    reopen: DENY("PAYROLL-ERR-001"),
  },
  Calculated: {
    collect: DENY("PAYROLL-ERR-001"),
    calculate: OK(),
    submit: OK(),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: DENY("PAYROLL-ERR-001"),
    reopen: OK(),
  },
  Reviewing: {
    collect: DENY("PAYROLL-ERR-001"),
    calculate: DENY("PAYROLL-ERR-001"),
    submit: DENY("PAYROLL-ERR-001"),
    approve: OK(),
    reject: OK(),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: DENY("PAYROLL-ERR-001"),
    reopen: OK(),
  },
  Approved: {
    collect: DENY("PAYROLL-ERR-001"),
    calculate: DENY("PAYROLL-ERR-003", "period-frozen"),
    submit: DENY("PAYROLL-ERR-001"),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    // FSM CHO (ô tại chỗ) nhưng fixture không có dòng nháp ⇒ 007 kind KHÁC publish (xem docblock đầu file).
    "generate-payslips": DENY("PAYROLL-ERR-007", "no-line-to-generate"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: DENY("PAYROLL-ERR-001"),
    reopen: OK(),
  },
  Published: {
    collect: DENY("PAYROLL-ERR-001"),
    calculate: DENY("PAYROLL-ERR-003", "period-frozen"),
    submit: DENY("PAYROLL-ERR-001"),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    // `lock` chỉ từ `Paid` — KHÔNG nhảy cóc từ `Published` (khoá kỳ khi chưa chi trả xong).
    lock: DENY("PAYROLL-ERR-001"),
    reopen: DENY("PAYROLL-ERR-004", "period-terminal"),
  },
  Paid: {
    collect: DENY("PAYROLL-ERR-001"),
    calculate: DENY("PAYROLL-ERR-003", "period-frozen"),
    submit: DENY("PAYROLL-ERR-001"),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: OK(),
    reopen: DENY("PAYROLL-ERR-004", "period-terminal"),
  },
  Locked: {
    collect: DENY("PAYROLL-ERR-001"),
    calculate: DENY("PAYROLL-ERR-003", "period-frozen"),
    submit: DENY("PAYROLL-ERR-001"),
    approve: DENY("PAYROLL-ERR-001"),
    reject: DENY("PAYROLL-ERR-001"),
    "generate-payslips": DENY("PAYROLL-ERR-001"),
    publish: DENY("PAYROLL-ERR-007", "no-payslip"),
    lock: DENY("PAYROLL-ERR-001"),
    reopen: DENY("PAYROLL-ERR-004", "period-terminal"),
  },
};

describe.skipIf(!hasLaneDb)("S15-PAYROLL-QA-1 · G9 — FSM 9×8 bảng tay + G12 mã 005/006", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  const companyIds: string[] = [];
  let templateId = "";
  let attendancePeriodId = "";
  let subjectId = "";

  let actor1Id = "";
  let actor2Id = "";
  let tActor1 = "";
  let tActor2 = "";
  const periodByStatus = new Map<PayrollPeriodStatus, string>();
  let seq = 0;
  const nextMonth = (): string => {
    const i = seq++;
    return `2081-${String((i % 12) + 1).padStart(2, "0")}`;
  };

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => (r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  const post = (t: string, u: string, body: Record<string, unknown> = {}) =>
    auth(t)(http().post(u)).send(body);
  const detail = (res: request.Response, field: string): string | undefined =>
    (res.body?.error?.details as Array<{ field: string; message: string }> | undefined)?.find(
      (d) => d.field === field,
    )?.message;

  async function login(email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeActor(label: string): Promise<{ id: string; token: string }> {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const email = `${label}@${A.slug}.test`;
    const id = await seedUser(direct, A.companyId, email, hash);
    await grantAllPayrollPairs(direct, A.companyId, id, `s15qa1fsm-${label}`);
    return { id, token: await login(email) };
  }

  /** Nạp lại hàng kỳ về hình dạng CHUẨN của `status` — khuôn `s13-payroll-qa1-fsm-race.int-spec.ts:resetTo`. */
  async function resetTo(periodId: string, status: PayrollPeriodStatus): Promise<void> {
    const submitted = ["Reviewing", "Approved", "Published", "Paid", "Locked"].includes(status);
    const approved = ["Approved", "Published", "Paid", "Locked"].includes(status);
    const published = ["Published", "Paid", "Locked"].includes(status);
    const paid = ["Paid", "Locked"].includes(status);
    const locked = status === "Locked";
    const calculated = status !== "Draft" && status !== "CollectingData";
    await direct.query(
      `UPDATE payroll_periods SET
         status = $2,
         attendance_period_id = $3,
         calculated_by = CASE WHEN $4 THEN $6::uuid ELSE NULL END,
         calculated_at = CASE WHEN $4 THEN now() ELSE NULL END,
         submitted_by  = CASE WHEN $5 THEN $7::uuid ELSE NULL END,
         submitted_at  = CASE WHEN $5 THEN now() ELSE NULL END,
         approved_by   = CASE WHEN $8 THEN $6::uuid ELSE NULL END,
         approved_at   = CASE WHEN $8 THEN now() ELSE NULL END,
         published_by  = CASE WHEN $9 THEN $6::uuid ELSE NULL END,
         published_at  = CASE WHEN $9 THEN now() ELSE NULL END,
         locked_by     = CASE WHEN $10 THEN $6::uuid ELSE NULL END,
         locked_at     = CASE WHEN $10 THEN now() ELSE NULL END,
         paid_by       = CASE WHEN $11 THEN $6::uuid ELSE NULL END,
         paid_at       = CASE WHEN $11 THEN now() ELSE NULL END,
         payslips_generated_by = NULL,
         payslips_generated_at = NULL
       WHERE id = $1`,
      [
        periodId,
        status,
        attendancePeriodId,
        calculated,
        submitted,
        actor1Id,
        actor2Id,
        approved,
        published,
        locked,
        paid,
      ],
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);
    direct = directPool();

    A = await seedCompany(direct, "s15qa1fsm");
    companyIds.push(A.companyId);
    templateId = await seedPayrollCatalog(direct, A.companyId);
    await direct.query(`UPDATE companies SET working_days_json = $2::jsonb WHERE id = $1`, [
      A.companyId,
      JSON.stringify({ days: [1, 2, 3, 4, 5] }),
    ]);

    const a1 = await makeActor("actor1");
    actor1Id = a1.id;
    tActor1 = a1.token;
    const a2 = await makeActor("actor2");
    actor2Id = a2.id;
    tActor2 = a2.token;

    // Người ĂN LƯƠNG (khác cả hai actor) — hồ sơ lương hiệu lực ⇒ `calculate` sinh được dòng thật.
    subjectId = await seedUser(direct, A.companyId, `subject@${A.slug}.test`, "x");
    await writeSalaryProfileWithItems(
      direct,
      `INSERT INTO salary_profiles (company_id, user_id, effective_date, base_salary, allowances)
       VALUES ($1, $2, '2081-01-01', '10000000.00', '[]'::jsonb) RETURNING id`,
      [A.companyId, subjectId],
    );

    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status)
       VALUES ($1, '2081-01', 'locked') RETURNING id`,
      [A.companyId],
    );
    attendancePeriodId = ap.rows[0].id;

    for (const status of STATUSES) {
      const month = nextMonth();
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id, template_id)
         VALUES ($1, $2, 'Draft', $3, $4) RETURNING id`,
        [A.companyId, month, attendancePeriodId, templateId],
      );
      periodByStatus.set(status, r.rows[0].id);
      await resetTo(r.rows[0].id, status);
    }
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ── A. Bảng tay 72 ô qua route THẬT ──────────────────────────────────────────────────────────

  describe("A. bảng tay 8 trạng thái × 9 action — route thật", () => {
    const CELLS = STATUSES.flatMap((state) =>
      ROUTES.map((r) => ({ state, spec: r, expected: HAND_TABLE[state][r.action] })),
    );

    it.each(CELLS)("$spec.action @ $state ⇒ $expected.status $expected.code", async (c) => {
      const id = periodByStatus.get(c.state)!;
      await resetTo(id, c.state);
      const res = await post(tActor1, c.spec.path(id), c.spec.body ?? {});
      const label = `${c.spec.action} @ ${c.state} | ${res.status} ${JSON.stringify(
        res.body?.error ?? res.body,
      )}`;
      expect(res.status, label).toBe(c.expected.status);
      if (c.expected.code) expect(res.body?.error?.code, label).toBe(c.expected.code);
      if (c.expected.kind) expect(detail(res, "kind"), label).toBe(c.expected.kind);
    });

    it("neo chống xanh-rỗng: đúng 72 ô, 11 ô 2xx, 61 ô lỗi", () => {
      const flat = CELLS.map((c) => c.expected);
      expect(flat.length).toBe(72);
      expect(flat.filter((c) => c.status < 300).length).toBe(11);
      expect(flat.filter((c) => c.status >= 300).length).toBe(61);
    });

    /**
     * Cross-check DUY NHẤT nơi `nextStatus` xuất hiện trong file — KHÔNG dùng để dựng kỳ vọng của `it.each`
     * trên. Đo lỗ: FSM tự nó CHO 13 ô (10 cạnh + 3 tại chỗ, có route), nhưng bảng tay chỉ có 11 ô thật sự 2xx —
     * 2 ô còn lại (`publish@Approved`, `generate-payslips@Approved`) bị cổng 007 chặn TRƯỚC FSM trên fixture
     * không sinh phiếu/dòng này (xem docblock đầu file).
     */
    it("cross-check: FSM tự thân CHO 13 ô nhưng chỉ 11 ô bảng-tay là 2xx thật (007 chặn 2 ô Approved)", () => {
      let fsmAllowed = 0;
      for (const state of STATUSES) {
        for (const r of ROUTES) {
          if (nextStatus(state, r.action as Parameters<typeof nextStatus>[1]) !== null) {
            fsmAllowed++;
          }
        }
      }
      expect(fsmAllowed).toBe(13);
      const handSuccess = STATUSES.flatMap((s) =>
        ROUTES.map((r) => HAND_TABLE[s][r.action]),
      ).filter((c) => c.status < 300).length;
      expect(handSuccess).toBe(11);
      expect(HAND_TABLE.Approved["publish"]).toEqual(DENY("PAYROLL-ERR-007", "no-payslip"));
      expect(HAND_TABLE.Approved["generate-payslips"]).toEqual(
        DENY("PAYROLL-ERR-007", "no-line-to-generate"),
      );
    });
  });

  // ── B. Không có đường tắt vào `Paid` trên `/payroll-periods` ─────────────────────────────────

  describe("B. Approved → Paid KHÔNG có route tắt trên payroll-periods", () => {
    it("`POST /payroll-periods/:id/pay` và `/complete` ⇒ 404 (route không tồn tại) — đường DUY NHẤT là complete-batch (072)", async () => {
      const id = periodByStatus.get("Approved")!;
      await resetTo(id, "Approved");
      for (const suffix of ["pay", "complete"]) {
        const res = await post(tActor1, `/payroll-periods/${id}/${suffix}`);
        expect(res.status, `${suffix}: ${JSON.stringify(res.body)}`).toBe(404);
      }
    });
  });

  // ── C. Happy path đầy đủ + four-eyes SWAP sau reopen + G12 (005/006) ─────────────────────────

  describe("C. vòng đời đầy đủ · four-eyes swap sau reopen · 005 trực tiếp · 006 KHÔNG xảy ra", () => {
    it("collect→calculate→submit→[005]→approve→reopen→calculate→submit(khác)→approve(swap)→[006 race+lặp]→publish; vết đúng từng bước", async () => {
      const month = nextMonth();
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id, template_id)
         VALUES ($1, $2, 'Draft', $3, $4) RETURNING id`,
        [A.companyId, month, attendancePeriodId, templateId],
      );
      const id = r.rows[0].id;
      const row = async () =>
        (
          await direct.query<{
            status: string;
            calculated_by: string | null;
            calculated_at: Date | null;
            submitted_by: string | null;
            submitted_at: Date | null;
            approved_by: string | null;
            approved_at: Date | null;
            payslips_generated_by: string | null;
            payslips_generated_at: Date | null;
            published_by: string | null;
            published_at: Date | null;
          }>(
            `SELECT status, calculated_by, calculated_at, submitted_by, submitted_at,
                    approved_by, approved_at, payslips_generated_by, payslips_generated_at,
                    published_by, published_at
               FROM payroll_periods WHERE id = $1`,
            [id],
          )
        ).rows[0];

      expect((await post(tActor1, `/payroll-periods/${id}/collect`)).status).toBe(201);
      expect((await row()).status).toBe("CollectingData");

      const calc1 = await post(tActor1, `/payroll-periods/${id}/calculate`);
      expect(calc1.status, JSON.stringify(calc1.body)).toBe(201);
      let snap = await row();
      expect(snap.status).toBe("Calculated");
      expect(snap.calculated_by).toBe(actor1Id);
      expect(snap.calculated_at).not.toBeNull();

      const sub1 = await post(tActor1, `/payroll-periods/${id}/submit`);
      expect(sub1.status, JSON.stringify(sub1.body)).toBe(201);
      snap = await row();
      expect(snap.status).toBe("Reviewing");
      expect(snap.submitted_by).toBe(actor1Id);

      // G12-005 — người GỬI DUYỆT tự duyệt ⇒ 409 005 `four-eyes` (pre-check TRƯỚC FSM, `payroll-approval.service.ts:129`).
      const selfApprove = await post(tActor1, `/payroll-periods/${id}/approve`);
      expect(selfApprove.status, JSON.stringify(selfApprove.body)).toBe(409);
      expect(selfApprove.body?.error?.code).toBe("PAYROLL-ERR-005");
      expect(detail(selfApprove, "kind")).toBe("four-eyes");

      // ALLOW đối chứng — người KHÁC duyệt được.
      const app1 = await post(tActor2, `/payroll-periods/${id}/approve`);
      expect(app1.status, JSON.stringify(app1.body)).toBe(201);
      snap = await row();
      expect(snap.status).toBe("Approved");
      expect(snap.approved_by).toBe(actor2Id);
      expect(snap.submitted_by).toBe(actor1Id); // approve KHÔNG xoá submitted_*.

      // ── four-eyes SWAP: reopen rồi tính/gửi/duyệt lại với VAI TRÒ ĐẢO — actor1 (người gửi duyệt lượt
      // trước, KHÔNG tự duyệt được) giờ duyệt được vì lượt này actor2 mới là người gửi duyệt.
      const reopen1 = await post(tActor1, `/payroll-periods/${id}/reopen`, { reason: "qa swap" });
      expect(reopen1.status, JSON.stringify(reopen1.body)).toBe(201);
      snap = await row();
      expect(snap.status).toBe("CollectingData");
      expect(snap.calculated_by).toBeNull();
      expect(snap.submitted_by).toBeNull();
      expect(snap.approved_by).toBeNull();

      const calc2 = await post(tActor1, `/payroll-periods/${id}/calculate`);
      expect(calc2.status, JSON.stringify(calc2.body)).toBe(201);

      const sub2 = await post(tActor2, `/payroll-periods/${id}/submit`);
      expect(sub2.status, JSON.stringify(sub2.body)).toBe(201);
      snap = await row();
      expect(snap.submitted_by).toBe(actor2Id);

      // SWAP thật: actor1 duyệt được (không còn là người gửi duyệt lượt này) — trước đó bị 005 chặn.
      const app2 = await post(tActor1, `/payroll-periods/${id}/approve`);
      expect(app2.status, JSON.stringify(app2.body)).toBe(201);
      snap = await row();
      expect(snap.status).toBe("Approved");
      expect(snap.approved_by).toBe(actor1Id);
      expect(snap.submitted_by).toBe(actor2Id);

      // G12-006 — RACE hai lượt generate-payslips ĐỒNG THỜI trên kỳ Approved vừa đủ điều kiện (có dòng nháp
      // từ `calc2`) rồi LẶP tuần tự: cả ba lượt ĐỀU 2xx, KHÔNG BAO GIỜ 409 006 — no-op đọc cờ dưới CÙNG row-lock
      // với lượt ghi (xem `payroll-payslips.service.ts:68`), nên `payslips_period_user_uq` không bao giờ vỡ qua
      // route này (đã ghim ở s13: "double-generate-payslips … 006 không được xảy ra").
      const [gen1, gen2] = await Promise.all([
        post(tActor1, `/payroll-periods/${id}/generate-payslips`),
        post(tActor2, `/payroll-periods/${id}/generate-payslips`),
      ]);
      for (const g of [gen1, gen2]) {
        expect(g.status, JSON.stringify(g.body)).toBe(201);
        expect(g.body?.error?.code).not.toBe("PAYROLL-ERR-006");
      }
      const genAgain = await post(tActor1, `/payroll-periods/${id}/generate-payslips`);
      expect(genAgain.status, JSON.stringify(genAgain.body)).toBe(201);
      expect(genAgain.body.data.warnings).toContain("payslips-already-generated");
      const slipCount = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM payslips WHERE payroll_period_id = $1 AND user_id = $2`,
        [id, subjectId],
      );
      expect(slipCount.rows[0].n, "0 phiếu nhân bản qua 3 lượt gọi").toBe(1);
      snap = await row();
      expect(snap.payslips_generated_by).toBe(actor1Id);
      expect(snap.payslips_generated_at).not.toBeNull();

      const pub = await post(tActor1, `/payroll-periods/${id}/publish`);
      expect(pub.status, JSON.stringify(pub.body)).toBe(201);
      snap = await row();
      expect(snap.status).toBe("Published");
      expect(snap.published_by).toBe(actor1Id);
      expect(snap.published_at).not.toBeNull();
      expect(snap.approved_by).toBe(actor1Id); // publish KHÔNG xoá approved_*/submitted_*.
      expect(snap.submitted_by).toBe(actor2Id);

      // Bonus (khớp ô Published/reopen của bảng tay, trên kỳ THẬT vừa đi hết vòng đời — không chỉ fixture SQL).
      // ⚠️ KHÁC ma trận A: kỳ này ĐÃ sinh phiếu (bước [006]) nên vế MỘT của `assertReopenAllowed` (cờ
      // `payslipsGeneratedAt`) chặn TRƯỚC vế hai (trạng thái terminal) — kind ở đây là
      // `payslip-already-generated`, không phải `period-terminal` (ma trận A dùng fixture cờ NULL nên
      // luôn thấy vế hai — hai kind CÙNG mã 004, khác nguyên nhân, xem `payroll-fsm.ts:assertReopenAllowed`).
      const reopenAfterPublish = await post(tActor1, `/payroll-periods/${id}/reopen`, {
        reason: "qa post-publish",
      });
      expect(reopenAfterPublish.status).toBe(409);
      expect(reopenAfterPublish.body?.error?.code).toBe("PAYROLL-ERR-004");
      expect(detail(reopenAfterPublish, "kind")).toBe("payslip-already-generated");
    }, 60_000);
  });

  // ── D. Hai vế TRAIL_RESET còn thiếu bằng chứng HTTP: `collect` xoá `calculated`, `lock` ghi `locked` ──

  describe("D. TRAIL_RESET qua HTTP — collect xoá `calculated` · lock ghi `locked`", () => {
    it("collect (in-place, CollectingData→CollectingData) xoá calculated_by/at còn sót (hình dạng phòng thủ)", async () => {
      const month = nextMonth();
      const ins = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods
           (company_id, period_month, status, attendance_period_id, template_id, calculated_by, calculated_at)
         VALUES ($1, $2, 'CollectingData', $3, $4, $5, now())
         RETURNING id`,
        [A.companyId, month, attendancePeriodId, templateId, actor1Id],
      );
      const id = ins.rows[0].id;
      const before = await direct.query<{ calculated_by: string | null }>(
        `SELECT calculated_by FROM payroll_periods WHERE id = $1`,
        [id],
      );
      expect(before.rows[0].calculated_by).toBe(actor1Id);

      const res = await post(tActor1, `/payroll-periods/${id}/collect`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const after = await direct.query<{
        calculated_by: string | null;
        calculated_at: Date | null;
      }>(`SELECT calculated_by, calculated_at FROM payroll_periods WHERE id = $1`, [id]);
      expect(after.rows[0].calculated_by).toBeNull();
      expect(after.rows[0].calculated_at).toBeNull();
    });

    it("lock (Paid→Locked) ghi locked_by/at, GIỮ NGUYÊN paid/approved/published/submitted", async () => {
      const month = nextMonth();
      const ins = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods
           (company_id, period_month, status, attendance_period_id, template_id,
            calculated_by, calculated_at, submitted_by, submitted_at,
            approved_by, approved_at, published_by, published_at, paid_by, paid_at)
         VALUES ($1, $2, 'Paid', $3, $4, $5, now(), $5, now(), $6, now(), $6, now(), $6, now())
         RETURNING id`,
        [A.companyId, month, attendancePeriodId, templateId, actor2Id, actor1Id],
      );
      const id = ins.rows[0].id;
      const res = await post(tActor1, `/payroll-periods/${id}/lock`);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const after = await direct.query<{
        status: string;
        locked_by: string | null;
        locked_at: Date | null;
        submitted_by: string | null;
        approved_by: string | null;
        published_by: string | null;
        paid_by: string | null;
      }>(
        `SELECT status, locked_by, locked_at, submitted_by, approved_by, published_by, paid_by
           FROM payroll_periods WHERE id = $1`,
        [id],
      );
      expect(after.rows[0].status).toBe("Locked");
      expect(after.rows[0].locked_by).toBe(actor1Id);
      expect(after.rows[0].locked_at).not.toBeNull();
      // `lock` KHÔNG chạm ba cặp vết trước đó (TRAIL_RESET.lock = { clear: [], set: ['locked'] }).
      expect(after.rows[0].submitted_by).toBe(actor2Id);
      expect(after.rows[0].approved_by).toBe(actor1Id);
      expect(after.rows[0].published_by).toBe(actor1Id);
      expect(after.rows[0].paid_by).toBe(actor1Id);
    });
  });
});

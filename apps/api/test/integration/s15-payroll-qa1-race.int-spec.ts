/**
 * S15-PAYROLL-QA-1 — G8: 5 kịch bản ĐUA GHI (`Promise.all`, HTTP thật, lặp vài vòng cho rẻ) chưa có int-spec nào đo
 * (plan §0 khoảng trống G8 · SPEC-11 §21.1 mục 15):
 *
 *  1. **072** hoàn tất CÙNG một đợt chi trả (đợt phủ ĐỦ kỳ — đợt CUỐI) hai lần song song.
 *  2. **063 vs 064** duyệt vs từ chối CÙNG một tạm ứng `Pending`, hai người duyệt khác nhau.
 *  3. **011 vs 012** duyệt vs từ chối CÙNG một kỳ `Reviewing`, hai người duyệt khác nhau (≠ người gửi duyệt).
 *  4. **085** lấy-hoặc-tạo PDF hàng loạt cho CÙNG một kỳ, CÙNG một người gọi, hai request song song.
 *  5. **047 × 047** hai công thức riêng lẻ hợp lệ, HỢP LẠI thành vòng (§21.1 mục 7 — khoá catalog tuần tự hoá).
 *
 * Bất biến chung: **KHÔNG 5xx**, đúng-một-thắng (hoặc đúng-một-hàng-tạo-ra ở ca 4), thua thì 409 ĐÚNG MÃ, và
 * đếm hiệu ứng phụ (outbox/hàng DB) không nhân đôi. `await app.listen(0)` NGAY SAU `app.init()` — supertest tự
 * đóng server tạm khi request ĐẦU về, thiếu dòng này thì `Promise.all` ăn `ECONNRESET` (xanh cục bộ, đỏ CI —
 * memory `supertest-closes-shared-server-on-first-response`; cổng `supertest-listen-ratchet` ép tự động).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). Ca 4 cần thêm S3 (mirror gate của `s15-payroll-be5b-pdf-batch.int-spec.ts`).
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
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  grantAllPayrollPairs,
  publishedPeriodWithPayslips,
  seedPayrollCatalog,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const hasStorage = !!process.env.S3_ENDPOINT && !!process.env.S3_BUCKET;
const LOGIN_PW = loginPasswordFixture("s15payrollqa1race");

interface Actor {
  id: string;
  token: string;
}

describe.skipIf(!hasLaneDb)("S15-PAYROLL-QA-1 · G8 — đua ghi (race)", () => {
  let app: INestApplication;
  let direct: Pool;
  const companyIds: string[] = [];
  let A: SeededTenant;

  // ── đợt chi trả (072) ──
  let officer: Actor;
  let completer1: Actor;
  let completer2: Actor;
  const payees: string[] = [];

  // ── tạm ứng (063 vs 064) ──
  let advCreator: Actor;
  let advApprover1: Actor;
  let advApprover2: Actor;

  // ── kỳ lương (011 vs 012) ──
  let periodSubmitter: Actor;
  let periodApprover1: Actor;
  let periodApprover2: Actor;
  let attendancePeriodId = "";

  // ── PDF hàng loạt (085) ──
  let pdfActor: Actor;

  let seq = 0;
  const nextMonth = (): string => {
    const i = seq++;
    return `${2085 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  };

  const http = () => request(app.getHttpServer());
  const as = (t: string) => ({
    get: (u: string) => http().get(u).set("Authorization", `Bearer ${t}`),
    post: (u: string) => http().post(u).set("Authorization", `Bearer ${t}`),
  });
  const detail = (res: request.Response, field: string): string | undefined =>
    (res.body?.error?.details as Array<{ field: string; message: string }> | undefined)?.find(
      (d) => d.field === field,
    )?.message;
  const noServerError = (rs: request.Response[], label: string): void => {
    for (const r of rs) {
      expect(
        r.status,
        `${label} — 5xx là hỏng hạ tầng đua, không phải "đã chặn": ${r.text}`,
      ).toBeLessThan(500);
    }
  };

  async function login(t: SeededTenant, email: string): Promise<string> {
    const res = await http()
      .post("/auth/login")
      .send({ companySlug: t.slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function makeActor(label: string): Promise<Actor> {
    const hash = await new PasswordService().hash(LOGIN_PW);
    const email = `${label}@${A.slug}.test`;
    const id = await seedUser(direct, A.companyId, email, hash);
    await grantAllPayrollPairs(direct, A.companyId, id, `s15qa1race-${label}`);
    return { id, token: await login(A, email) };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Đua ghi giữ HAI request treo song song — server phải nghe thật.
    await app.listen(0);
    direct = directPool();

    A = await seedCompany(direct, "s15qa1race");
    companyIds.push(A.companyId);

    officer = await makeActor("officer");
    completer1 = await makeActor("completer1");
    completer2 = await makeActor("completer2");
    advCreator = await makeActor("advcreator");
    advApprover1 = await makeActor("advapprover1");
    advApprover2 = await makeActor("advapprover2");
    periodSubmitter = await makeActor("periodsubmitter");
    periodApprover1 = await makeActor("periodapprover1");
    periodApprover2 = await makeActor("periodapprover2");
    pdfActor = await makeActor("pdfactor");

    for (let i = 0; i < 3; i++) {
      payees.push(await seedUser(direct, A.companyId, `payee${i}@${A.slug}.test`, "x"));
    }

    // Tháng RIÊNG ngoài dải `nextMonth()` (chỉ đủ ~8 lượt kể cả 3 describe race) — tránh đụng
    // `attendance_periods_company_month_uq` với các kỳ Published mà `publishedPeriodWithPayslips` tự tạo.
    const ap = await direct.query<{ id: string }>(
      `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, '2089-12', 'locked') RETURNING id`,
      [A.companyId],
    );
    attendancePeriodId = ap.rows[0].id;
  }, 300_000);

  afterAll(async () => {
    if (direct) await cleanupTenants(direct, companyIds);
    await direct?.end();
    await app?.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("G8-1 · 072 — hoàn tất CÙNG một đợt (đợt CUỐI, phủ đủ kỳ) hai lần song song", () => {
    it("3 vòng: đúng 1×200 batch-completed + 1×409 027 batch-already-completed; kỳ Paid ĐÚNG MỘT lần; ĐÚNG 1 outbox NOTI-027; 0×5xx", async () => {
      for (let round = 0; round < 3; round++) {
        const month = nextMonth();
        const { periodId } = await publishedPeriodWithPayslips(direct, A.companyId, {
          month,
          payees: payees.map((userId, i) => ({ userId, net: `${(i + 1) * 500_000}.00` })),
          officerId: officer.id,
          approverId: completer1.id,
        });
        const created = await as(officer.token)
          .post("/payroll/payment-batches")
          .send({ payrollPeriodId: periodId, method: "cash", userIds: payees });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const batchId = created.body.data.id as string;

        const [r1, r2] = await Promise.all([
          as(completer1.token)
            .post(`/payroll/payment-batches/${batchId}/complete`)
            .send({ confirmAllPaid: true }),
          as(completer2.token)
            .post(`/payroll/payment-batches/${batchId}/complete`)
            .send({ confirmAllPaid: true }),
        ]);
        noServerError([r1, r2], `round ${round}`);
        const statuses = [r1.status, r2.status].sort((a, b) => a - b);
        expect(statuses, `round ${round}: ${JSON.stringify([r1.body, r2.body])}`).toEqual([
          200, 409,
        ]);
        const winner = r1.status === 200 ? r1 : r2;
        const loser = r1.status === 409 ? r1 : r2;
        expect(winner.body.data.periodStatus).toBe("Paid");
        expect(loser.body?.error?.code, `round ${round}`).toBe("PAYROLL-ERR-027");
        expect(detail(loser, "kind"), `round ${round}`).toBe("batch-already-completed");

        const p = await direct.query<{ status: string }>(
          `SELECT status FROM payroll_periods WHERE id = $1`,
          [periodId],
        );
        expect(p.rows[0].status, `round ${round}`).toBe("Paid");
        const ev = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM outbox_events
            WHERE company_id = $1 AND event_type = 'payroll.payment_batch_completed'
              AND payload->>'periodId' = $2`,
          [A.companyId, periodId],
        );
        expect(ev.rows[0].n, `round ${round} — NOTI-027 không được nhân đôi`).toBe(1);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("G8-2 · 063 vs 064 — duyệt vs từ chối CÙNG tạm ứng `Pending`, hai người duyệt khác nhau", () => {
    it("3 vòng: đúng MỘT thắng (201), còn lại 409 025 advance-not-pending; trạng thái cuối khớp bên thắng; 0×5xx", async () => {
      for (let round = 0; round < 3; round++) {
        const beneficiary = await seedUser(
          direct,
          A.companyId,
          `benef${round}@${A.slug}.test`,
          "x",
        );
        const created = await as(advCreator.token)
          .post("/payroll/advances")
          .send({
            userId: beneficiary,
            amount: 1_000_000,
            deductPeriodMonth: "2093-01",
            reason: `race round ${round}`,
          });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        const advanceId = created.body.data.id as string;

        const [ra, rb] = await Promise.all([
          as(advApprover1.token).post(`/payroll/advances/${advanceId}/approve`).send({}),
          as(advApprover2.token)
            .post(`/payroll/advances/${advanceId}/reject`)
            .send({ note: `race reject round ${round}` }),
        ]);
        noServerError([ra, rb], `round ${round}`);
        const statuses = [ra.status, rb.status].sort((a, b) => a - b);
        expect(statuses, `round ${round}: ${JSON.stringify([ra.body, rb.body])}`).toEqual([
          201, 409,
        ]);
        const winner = ra.status === 201 ? ra : rb;
        const loser = ra.status === 409 ? ra : rb;
        expect(loser.body?.error?.code, `round ${round}`).toBe("PAYROLL-ERR-025");
        expect(detail(loser, "kind"), `round ${round}`).toBe("advance-not-pending");
        const row = await direct.query<{ status: string }>(
          `SELECT status FROM payroll_advances WHERE id = $1`,
          [advanceId],
        );
        expect(row.rows[0].status, `round ${round}`).toBe(winner.body.data.status);
        expect(["Approved", "Rejected"]).toContain(row.rows[0].status);
        // ĐÚNG một quyết định được ghi — không có audit/outbox kép của người thua (thua ăn 409 TRƯỚC ghi).
        const decisions = await direct.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM audit_logs
            WHERE company_id = $1 AND object_type = 'payroll_advance' AND object_id = $2
              AND action IN ('approve','reject')`,
          [A.companyId, advanceId],
        );
        expect(decisions.rows[0].n, `round ${round}`).toBe(1);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe("G8-3 · 011 vs 012 — duyệt vs từ chối CÙNG kỳ `Reviewing`, hai người duyệt khác nhau", () => {
    /** Kỳ Reviewing trực tiếp qua SQL (thoả mọi CHECK của mig 0564/0572) — `submitted_by` ≠ HAI người duyệt. */
    async function freshReviewingPeriod(month: string): Promise<string> {
      const r = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods
           (company_id, period_month, status, attendance_period_id,
            calculated_by, calculated_at, submitted_by, submitted_at)
         VALUES ($1, $2, 'Reviewing', $3, $4, now(), $4, now())
         RETURNING id`,
        [A.companyId, month, attendancePeriodId, periodSubmitter.id],
      );
      return r.rows[0].id;
    }

    it("3 vòng: đúng MỘT thắng (201), còn lại 409 001; trạng thái + vết duyệt cuối khớp bên thắng; 0×5xx", async () => {
      for (let round = 0; round < 3; round++) {
        const periodId = await freshReviewingPeriod(nextMonth());
        const [ra, rb] = await Promise.all([
          as(periodApprover1.token).post(`/payroll-periods/${periodId}/approve`).send({}),
          as(periodApprover2.token)
            .post(`/payroll-periods/${periodId}/reject`)
            .send({ reason: `race reject round ${round}` }),
        ]);
        noServerError([ra, rb], `round ${round}`);
        const statuses = [ra.status, rb.status].sort((a, b) => a - b);
        expect(statuses, `round ${round}: ${JSON.stringify([ra.body, rb.body])}`).toEqual([
          201, 409,
        ]);
        const loser = ra.status === 409 ? ra : rb;
        expect(loser.body?.error?.code, `round ${round}`).toBe("PAYROLL-ERR-001");

        const row = await direct.query<{
          status: string;
          approved_by: string | null;
          submitted_by: string | null;
        }>(`SELECT status, approved_by, submitted_by FROM payroll_periods WHERE id = $1`, [
          periodId,
        ]);
        if (ra.status === 201) {
          // approve thắng: Approved, vết gửi duyệt VẪN GIỮ (approve không xoá submitted_*).
          expect(row.rows[0].status, `round ${round}`).toBe("Approved");
          expect(row.rows[0].approved_by, `round ${round}`).toBe(periodApprover1.id);
          expect(row.rows[0].submitted_by, `round ${round}`).toBe(periodSubmitter.id);
        } else {
          // reject thắng: về lại Calculated, `submitted_*` bị XOÁ (TRAIL_RESET.reject).
          expect(row.rows[0].status, `round ${round}`).toBe("Calculated");
          expect(row.rows[0].approved_by, `round ${round}`).toBeNull();
          expect(row.rows[0].submitted_by, `round ${round}`).toBeNull();
        }
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  describe.skipIf(!hasStorage)(
    "G8-4 · 085 — lấy-hoặc-tạo PDF hàng loạt, CÙNG người gọi, song song",
    () => {
      it("2 vòng: hai POST song song ⇒ cả hai 202 + CÙNG fileId; ĐÚNG 1 hàng `files` được tạo; 0×5xx", async () => {
        for (let round = 0; round < 2; round++) {
          const month = nextMonth();
          const { periodId } = await publishedPeriodWithPayslips(direct, A.companyId, {
            month,
            payees: [
              { userId: payees[0], net: "1000000.00" },
              { userId: payees[1], net: "2000000.00" },
            ],
            officerId: officer.id,
            approverId: completer1.id,
          });
          const before = (
            await direct.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM files WHERE company_id = $1 AND uploaded_by = $2`,
              [A.companyId, pdfActor.id],
            )
          ).rows[0].n;

          const [r1, r2] = await Promise.all([
            as(pdfActor.token).post(`/payroll-periods/${periodId}/payslips/pdf-batch`).send({}),
            as(pdfActor.token).post(`/payroll-periods/${periodId}/payslips/pdf-batch`).send({}),
          ]);
          noServerError([r1, r2], `round ${round}`);
          expect(
            [r1.status, r2.status],
            `round ${round}: ${JSON.stringify([r1.body, r2.body])}`,
          ).toEqual([202, 202]);
          expect(r1.body.data.fileId, `round ${round} — get-or-create phải trả CÙNG lô`).toBe(
            r2.body.data.fileId,
          );
          const after = (
            await direct.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM files WHERE company_id = $1 AND uploaded_by = $2`,
              [A.companyId, pdfActor.id],
            )
          ).rows[0].n;
          expect(after, `round ${round} — advisory lock phải chặn tạo trùng`).toBe(before + 1);
        }
      });
    },
  );

  /**
   * 5 · SPEC-11 §21.1 #7 — «vòng sinh ra do GHI SONG SONG». Hai PATCH 047: X := Y + 1 và Y := X + 1 — mỗi bản riêng
   * lẻ KHÔNG vòng (đồ thị lúc bắt đầu X, Y đều là hằng). Không có `payrollCatalogLockTx` thì cả hai kiểm vòng trên
   * snapshot cũ, cùng commit, và catalog mang vòng tới tận lượt `calculate`. Có khoá ⇒ lượt sau đọc được lượt trước
   * đã commit ⇒ đúng MỘT 200 + MỘT 422 019. (Vế «lúc TÍNH vẫn bắt» ghi thẳng DB: `s15-payroll-be3-binding-gates` G8.)
   */
  it("5 · 047 × 047 song song — hai công thức hợp lệ riêng lẻ, HỢP LẠI thành vòng ⇒ đúng một 200 + một 422 019", async () => {
    await seedPayrollCatalog(direct, A.companyId);
    const patch = (id: string, formula: string) =>
      http()
        .patch(`/payroll/salary-components/${id}`)
        .set("Authorization", `Bearer ${officer.token}`)
        .send({ formula });
    for (let round = 0; round < 3; round++) {
      const codes = [`QA1RX${round}`, `QA1RY${round}`] as const;
      const ids: string[] = [];
      for (const code of codes) {
        const r = await as(officer.token)
          .post("/payroll/salary-components")
          .send({ code, name: code, kind: "earning", valueType: "formula", formula: "1000" });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        ids.push(r.body.data.id as string);
      }

      const [r1, r2] = await Promise.all([
        patch(ids[0], `${codes[1]} + 1`),
        patch(ids[1], `${codes[0]} + 1`),
      ]);
      noServerError([r1, r2], `round ${round}`);
      expect(
        [r1.status, r2.status].sort(),
        `round ${round}: ${JSON.stringify([r1.body, r2.body])}`,
      ).toEqual([200, 422]);
      const loser = r1.status === 422 ? r1 : r2;
      expect(loser.body.error.code).toBe("PAYROLL-ERR-019");
      expect(detail(loser, "kind")).toBe("formula-cycle");

      // Đúng MỘT công thức mới được lưu ⇒ catalog sau đua KHÔNG mang vòng.
      const rows = await direct.query<{ code: string; formula: string }>(
        `SELECT code, formula FROM salary_components
          WHERE company_id = $1 AND code = ANY($2::text[]) AND deleted_at IS NULL`,
        [A.companyId, [...codes]],
      );
      expect(rows.rows).toHaveLength(2);
      expect(
        rows.rows.filter((r) => r.formula !== "1000"),
        `round ${round}`,
      ).toHaveLength(1);
    }
  });
});

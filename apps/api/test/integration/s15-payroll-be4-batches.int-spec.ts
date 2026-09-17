/**
 * S15-PAYROLL-BE-4 — đợt chi trả `PAYROLL-API-066..070` (plan §4.3 · §4.4 · §6.2). Đường thật (HTTP + Postgres lane).
 *
 * 🔀 **S15-PAYROLL-QA-1 (G15a) — tách khỏi file gốc 945 dòng** (đọc-để-đăng ký-cổng `check.sh` file ≤ 800 dòng):
 * phần này giữ **067 (lập đợt) · BE-4B (users.status ở reader quyền/EXISTS đợt) · 066/068/070 (đọc+mask) · 069
 * (sửa đợt)**; phần **071 (tệp UNC) · 072 (hoàn tất theo LUẬT PHỦ) · kỳ Locked di sản/cross-tenant** chuyển sang
 * `s15-payroll-be4-batches-complete.int-spec.ts` (self-contained: tự boot app + tự seed tenant, KHÔNG chia sẻ
 * `getHttpServer` — census `apps/api/test/foundation/supertest-listen-ratchet.unit-spec.ts` phân tích mỗi file
 * riêng). Mọi `it(...)` giữ NGUYÊN tiêu đề + assertion so với file gốc — tách chỉ đổi cách CHIA FILE, không đổi
 * hành vi.
 *
 * Trọng tâm phần này: `bank` tự nạp + snapshot TK LÚC LẬP · `cash` mọi người · C3 (`no-eligible-completer`) ·
 * BE-4B (users.status ở reader quyền · EXISTS đợt cùng company ở `insertLinesTx`) · 068/070 đọc+mask (viewer thấy
 * tiền — cặp chở-tiền) · 069 add/remove/markPaid · B1 (dòng đã chi không gỡ được) · B4 (PATCH `Completed` ⇒ 400).
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
import { DatabaseService } from "../../src/db/db.service";
import { PayrollPaymentBatchesRepository } from "../../src/payroll/payroll-payment-batches.repository";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  bankSettings,
  employeeProfile,
  grantAllPayrollPairs,
  grantPayrollPairs,
  publishedPeriodWithPayslips,
} from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s15payrollbe4bat");
/** Tiền tố số TK của fixture — mọi số TK sinh từ đây; chuỗi này KHÔNG được xuất hiện ở log/audit/DTO. */
const ACCT_PREFIX = "8800550077";
const MONEY_KEY = /gross|\bnet\b|amount|salary/i;

interface Batch {
  id: string;
  warnings: string[];
}

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-BE-4 · đợt chi trả 066–070 (lập đợt · BE-4B · đọc+mask · sửa đợt)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];
    let A: SeededTenant;
    let B: SeededTenant;
    let C: SeededTenant;
    /** officer = người LẬP đợt · completer = người HOÀN TẤT · viewer = chỉ view:payment-batch. */
    let officer = { id: "", token: "" };
    let completer = { id: "", token: "" };
    let viewer = { id: "", token: "" };
    let officerB = { id: "", token: "" };
    let soloC = { id: "", token: "" };
    /** 10 người hưởng lương của A: P0..P7 có TK, P8/P9 KHÔNG. */
    const payees: string[] = [];
    let seq = 0;

    const nextMonth = (): string => {
      const i = seq++;
      return `${2080 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    };
    const acct = (i: number) => `${ACCT_PREFIX}${String(i).padStart(2, "0")}`;
    const netOf = (i: number) => `${(i + 1) * 1_000_000}.00`;

    const http = () => request(app.getHttpServer());
    const as = (t: string) => ({
      get: (u: string) => http().get(u).set("Authorization", `Bearer ${t}`),
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
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: t.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** Kỳ `Published` mới của A với 10 phiếu (net (i+1)×1tr; P9 net 0 để có `zero-net`). */
    async function publishedPeriod(status: "Published" | "Approved" | "Locked" = "Published") {
      const month = nextMonth();
      const list = payees.map((userId, i) => ({ userId, net: i === 9 ? "0.00" : netOf(i) }));
      const { periodId, payslipIdByUser } = await publishedPeriodWithPayslips(direct, A.companyId, {
        month,
        payees: list,
        officerId: officer.id,
        approverId: completer.id,
        status,
      });
      return { periodId, month, payslipIdByUser };
    }

    async function createBatch(
      t: string,
      body: Record<string, unknown>,
      expectStatus = 201,
    ): Promise<Batch> {
      const res = await as(t).post("/payroll/payment-batches").send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(expectStatus);
      return res.body.data as Batch;
    }

    const linesOf = async (batchId: string) =>
      (
        await direct.query<{
          user_id: string;
          bank_account_snapshot: string | null;
          paid_at: Date | null;
          deleted_at: Date | null;
        }>(
          `SELECT user_id, bank_account_snapshot, paid_at, deleted_at FROM payroll_payment_lines
          WHERE batch_id = $1 ORDER BY user_id`,
          [batchId],
        )
      ).rows;

    const outboxOf = async (eventType: string, periodId: string) =>
      (
        await direct.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM outbox_events WHERE company_id = $1 AND event_type = $2 AND payload->>'periodId' = $3`,
          [A.companyId, eventType, periodId],
        )
      ).rows;

    const auditRows = async (objectId: string | null, action: string) =>
      (
        await direct.query<{ before: unknown; after: unknown }>(
          `SELECT before, after FROM audit_logs
          WHERE company_id = $1 AND object_type = 'payroll_payment_batch' AND action = $2
            AND ($3::uuid IS NULL OR object_id = $3::uuid)`,
          [A.companyId, action, objectId],
        )
      ).rows;

    async function complete(t: string, batchId: string, body: Record<string, unknown> = {}) {
      return as(t).post(`/payroll/payment-batches/${batchId}/complete`).send(body);
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // Ca race giữ HAI request treo song song — server phải nghe thật (memory `supertest-closes-shared-server-on-first-response`).
      await app.listen(0);
      direct = directPool();
      const hash = await new PasswordService().hash(LOGIN_PW);

      A = await seedCompany(direct, "be4bata");
      B = await seedCompany(direct, "be4batb");
      C = await seedCompany(direct, "be4batc");
      companyIds.push(A.companyId, B.companyId, C.companyId);

      const mk = async (t: SeededTenant, label: string, grant: (id: string) => Promise<void>) => {
        const email = `${label}@${t.slug}.test`;
        const id = await seedUser(direct, t.companyId, email, hash);
        await grant(id);
        return { id, token: await login(t, email) };
      };
      officer = await mk(A, "officer", (id) =>
        grantAllPayrollPairs(direct, A.companyId, id, "be4b-officer"),
      );
      completer = await mk(A, "completer", (id) =>
        grantAllPayrollPairs(direct, A.companyId, id, "be4b-completer"),
      );
      viewer = await mk(A, "viewer", (id) =>
        grantPayrollPairs(direct, A.companyId, id, "be4b-viewer", ["batchList"]),
      );
      officerB = await mk(B, "officer", (id) =>
        grantAllPayrollPairs(direct, B.companyId, id, "be4b-officerb"),
      );
      // B có người THỨ HAI giữ manage:payment-batch ⇒ C3 không chặn trước 404 sentinel ở ca cross-tenant.
      await mk(B, "admin", (id) => grantAllPayrollPairs(direct, B.companyId, id, "be4b-adminb"));
      // C: CHỈ MỘT người giữ manage:payment-batch ⇒ C3.
      soloC = await mk(C, "solo", (id) =>
        grantAllPayrollPairs(direct, C.companyId, id, "be4b-soloc"),
      );

      for (let i = 0; i < 10; i++) {
        const id = await seedUser(direct, A.companyId, `p${i}@${A.slug}.test`, "x");
        payees.push(id);
        await employeeProfile(direct, A.companyId, id, `NVB4${String(i).padStart(2, "0")}`);
        if (i < 8) await bankSettings(direct, A.companyId, id, acct(i), "VCB", `HOLDER ${i}`);
      }
    }, 300_000);

    afterAll(async () => {
      if (direct) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("067 — lập đợt", () => {
      it("kỳ `Approved` ⇒ 409 027 `period-not-published`, 0 đợt", async () => {
        const { periodId } = await publishedPeriod("Approved");
        expectError(
          await as(officer.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: periodId, method: "bank" }),
          409,
          "PAYROLL-ERR-027",
          "period-not-published",
        );
        const n = await direct.query(
          `SELECT count(*)::int AS n FROM payroll_payment_batches WHERE payroll_period_id = $1`,
          [periodId],
        );
        expect(n.rows[0].n).toBe(0);
      });

      it("`bank` tự nạp ⇒ 8 dòng + warnings `no-bank-account:2`; snapshot = số TK LÚC LẬP (đổi settings sau, dòng giữ số cũ)", async () => {
        const { periodId } = await publishedPeriod();
        const b = await createBatch(officer.token, { payrollPeriodId: periodId, method: "bank" });
        expect(b.warnings).toContain("no-bank-account:2");
        const lines = await linesOf(b.id);
        expect(lines).toHaveLength(8);
        expect(lines.map((l) => l.user_id).sort()).toEqual(payees.slice(0, 8).sort());
        const p0 = lines.find((l) => l.user_id === payees[0])!;
        expect(p0.bank_account_snapshot).toBe(acct(0));
        // Đổi settings SAU khi lập ⇒ snapshot bất động.
        await bankSettings(direct, A.companyId, payees[0], `${ACCT_PREFIX}99`, "VCB", "HOLDER 0");
        expect(
          (await linesOf(b.id)).find((l) => l.user_id === payees[0])!.bank_account_snapshot,
        ).toBe(acct(0));
        await bankSettings(direct, A.companyId, payees[0], acct(0), "VCB", "HOLDER 0");
        // Audit create: có `added[].last4`, KHÔNG số đầy đủ, KHÔNG tiền.
        const audit = await auditRows(b.id, "create");
        expect(audit).toHaveLength(1);
        const json = JSON.stringify(audit[0].after);
        expect(json).toContain(acct(0).slice(-4));
        expect(json).not.toContain(ACCT_PREFIX);
        expect(json).not.toMatch(MONEY_KEY);
      });

      // silent-failure-hunter BE-4 #2: tự nạp trúng 0 người KHÔNG được im lặng — 201 + `no-eligible-payees`.
      it("tự nạp lần 2 cùng kỳ (8 người đã ở đợt 1, 2 người thiếu TK) ⇒ 201, 0 dòng, warnings `no-eligible-payees` + `no-bank-account:2`", async () => {
        const { periodId } = await publishedPeriod();
        const b1 = await createBatch(officer.token, { payrollPeriodId: periodId, method: "bank" });
        expect(await linesOf(b1.id)).toHaveLength(8);
        expect(b1.warnings).not.toContain("no-eligible-payees");
        const b2 = await createBatch(officer.token, { payrollPeriodId: periodId, method: "bank" });
        expect(b2.warnings).toContain("no-eligible-payees");
        expect(b2.warnings).toContain("no-bank-account:2");
        expect(await linesOf(b2.id)).toHaveLength(0);
      });

      it("`userIds` tường minh có người thiếu TK ở đợt `bank` ⇒ 409 027 `payee-no-bank-account`, 0 dòng", async () => {
        const { periodId } = await publishedPeriod();
        expectError(
          await as(officer.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: periodId, method: "bank", userIds: [payees[0], payees[8]] }),
          409,
          "PAYROLL-ERR-027",
          "payee-no-bank-account",
        );
        const n = await direct.query(
          `SELECT count(*)::int AS n FROM payroll_payment_lines l JOIN payroll_payment_batches b ON b.id = l.batch_id WHERE b.payroll_period_id = $1`,
          [periodId],
        );
        expect(n.rows[0].n).toBe(0);
      });

      it("`cash` ⇒ 10 dòng, snapshot NULL, warnings `zero-net:1`; trùng `code` ⇒ 409 027 `batch-code-exists`", async () => {
        const { periodId } = await publishedPeriod();
        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          code: "CASH-A",
        });
        expect(b.warnings).toContain("zero-net:1");
        const lines = await linesOf(b.id);
        expect(lines).toHaveLength(10);
        expect(lines.every((l) => l.bank_account_snapshot === null)).toBe(true);
        const { periodId: p2 } = await publishedPeriod();
        expectError(
          await as(officer.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: p2, method: "cash", code: "CASH-A" }),
          409,
          "PAYROLL-ERR-027",
          "batch-code-exists",
        );
      });

      it("body có `bankAccountNumber` ⇒ 400 (strict) — snapshot KHÔNG nhận từ body", async () => {
        const { periodId } = await publishedPeriod();
        const res = await as(officer.token)
          .post("/payroll/payment-batches")
          .send({ payrollPeriodId: periodId, method: "bank", bankAccountNumber: "1" });
        expect(res.status, JSON.stringify(res.body)).toBe(400);
      });

      it("`userId` không có phiếu ở kỳ ⇒ 404 sentinel", async () => {
        const { periodId } = await publishedPeriod();
        expectError(
          await as(officer.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: periodId, method: "cash", userIds: [officer.id] }),
          404,
          "PAYROLL-ERR-010",
          "not-found",
        );
      });

      it("C3 — công ty chỉ MỘT người giữ manage:payment-batch ⇒ 422 017 `no-eligible-completer`, 0 đợt", async () => {
        const pC = await seedUser(direct, C.companyId, `p@${C.slug}.test`, "x");
        const { periodId } = await publishedPeriodWithPayslips(direct, C.companyId, {
          month: nextMonth(),
          payees: [{ userId: pC, net: "1.00" }],
          officerId: soloC.id,
          approverId: pC,
        });
        expectError(
          await as(soloC.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: periodId, method: "cash" }),
          422,
          "PAYROLL-ERR-017",
          "no-eligible-completer",
        );
        const n = await direct.query(
          `SELECT count(*)::int AS n FROM payroll_payment_batches WHERE company_id = $1`,
          [C.companyId],
        );
        expect(n.rows[0].n).toBe(0);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    // S15-PAYROLL-BE-4B — nợ FULL gate BE-4 (plan BE-4 §11b): reader quyền lọc `users.status = 'active'` (security M3)
    // · `insertLinesTx` EXISTS đợt CÙNG công ty (database LOW). RED trước khi vá: holder bị đình chỉ vẫn được đếm ⇒ C3
    // xanh giả (four-eyes 072 không bao giờ thoả) / NOTI-027 vào tài khoản chết; dòng chi gắn được vào đợt công ty khác.
    describe("BE-4B — users.status ở reader quyền · EXISTS đợt ở insertLinesTx", () => {
      const setStatus = (userId: string, status: "active" | "suspended") =>
        direct.query(`UPDATE users SET status = $2 WHERE id = $1`, [userId, status]);

      it("C3b — người thứ hai giữ manage:payment-batch nhưng `suspended` ⇒ vẫn 422 017; kích hoạt lại ⇒ 201 (đối chứng ALLOW)", async () => {
        const pC = await seedUser(direct, C.companyId, `p2@${C.slug}.test`, "x");
        const holder2 = await seedUser(direct, C.companyId, `holder2@${C.slug}.test`, "x");
        await grantPayrollPairs(direct, C.companyId, holder2, "be4b-holder2", ["batchComplete"]);
        await setStatus(holder2, "suspended");
        const { periodId } = await publishedPeriodWithPayslips(direct, C.companyId, {
          month: nextMonth(),
          payees: [{ userId: pC, net: "1.00" }],
          officerId: soloC.id,
          approverId: pC,
        });
        const body = { payrollPeriodId: periodId, method: "cash" };
        expectError(
          await as(soloC.token).post("/payroll/payment-batches").send(body),
          422,
          "PAYROLL-ERR-017",
          "no-eligible-completer",
        );
        // ĐỐI CHỨNG ALLOW: cùng người, cùng cặp, chỉ đổi `users.status` ⇒ đủ người hoàn tất ⇒ 201.
        await setStatus(holder2, "active");
        const ok = await as(soloC.token).post("/payroll/payment-batches").send(body);
        expect(ok.status, JSON.stringify(ok.body)).toBe(201);
        // Trả C về «một người hoàn tất hoạt động» cho ca sau.
        await setStatus(holder2, "suspended");
      });

      it("NOTI-027 KHÔNG tới holder view:payment-batch bị đình chỉ — payload đi theo reader đã lọc users.status", async () => {
        const { periodId } = await publishedPeriod();
        await setStatus(viewer.id, "suspended");
        try {
          const a = await createBatch(officer.token, {
            payrollPeriodId: periodId,
            method: "cash",
          });
          const r = await complete(completer.token, a.id, { confirmAllPaid: true });
          expect(r.status, JSON.stringify(r.body)).toBe(200);
          expect(r.body.data.periodStatus).toBe("Paid");
          const ev = await outboxOf("payroll.payment_batch_completed", periodId);
          expect(ev).toHaveLength(1);
          // holders(view:payment-batch) − completer = officer (+ viewer NẾU còn hoạt động — đang đình chỉ ⇒ loại).
          expect(ev[0].payload["recipientUserIds"]).toEqual([officer.id]);
        } finally {
          await setStatus(viewer.id, "active");
        }
      });

      it("insertLinesTx — batch_id không tồn tại HOẶC thuộc công ty khác ⇒ 0 dòng (EXISTS đợt cùng company), không FK/500", async () => {
        const { payslipIdByUser } = await publishedPeriod();
        const repo = app.get(PayrollPaymentBatchesRepository);
        const db = app.get(DatabaseService);
        const payslipId = payslipIdByUser.get(payees[0])!;
        const ghost = await db.withTenant(A.companyId, (tx) =>
          repo.insertLinesTx(
            tx,
            A.companyId,
            { id: randomUUID(), method: "cash" },
            [payslipId],
            officer.id,
          ),
        );
        expect(ghost).toEqual([]);
        // Đợt THẬT của B (B có hai holder ⇒ C3 qua) — cùng id thật, khác company ⇒ 0 dòng.
        const pB = await seedUser(direct, B.companyId, `pb@${B.slug}.test`, "x");
        const { periodId: periodB } = await publishedPeriodWithPayslips(direct, B.companyId, {
          month: nextMonth(),
          payees: [{ userId: pB, net: "1.00" }],
          officerId: officerB.id,
          approverId: pB,
        });
        const bB = await createBatch(officerB.token, {
          payrollPeriodId: periodB,
          method: "cash",
          userIds: [pB],
        });
        const cross = await db.withTenant(A.companyId, (tx) =>
          repo.insertLinesTx(
            tx,
            A.companyId,
            { id: bB.id, method: "cash" },
            [payslipId],
            officer.id,
          ),
        );
        expect(cross).toEqual([]);
        const n = await direct.query(
          `SELECT count(*)::int AS n FROM payroll_payment_lines WHERE batch_id = $1 AND company_id = $2`,
          [bB.id, A.companyId],
        );
        expect(n.rows[0].n).toBe(0);
      });
    });
    describe("066/068/070 — đọc + mask", () => {
      it("068 `totalNet` = Σ net dòng sống; 070 VẮNG khoá TK đầy đủ, có `bankAccountLast4`; audit +1 mỗi lượt; viewer thấy tiền (cặp chở-tiền)", async () => {
        const { periodId } = await publishedPeriod();
        const b = await createBatch(officer.token, { payrollPeriodId: periodId, method: "bank" });
        const expected = payees.slice(0, 8).reduce((s, _u, i) => s + Number(netOf(i)), 0);
        const r0 = (await auditRows(b.id, "read")).length;
        const d = await as(viewer.token).get(`/payroll/payment-batches/${b.id}`);
        expect(d.status, JSON.stringify(d.body)).toBe(200);
        expect(d.body.data.totalNet).toBe(expected);
        expect(d.body.data.lineCount).toBe(8);
        expect(d.body.data.paidLineCount).toBe(0);
        const l = await as(viewer.token).get(`/payroll/payment-batches/${b.id}/lines?per_page=100`);
        expect(l.status, JSON.stringify(l.body)).toBe(200);
        const rows = l.body.data as Array<Record<string, unknown>>;
        expect(rows).toHaveLength(8);
        for (const row of rows) {
          expect(Object.keys(row)).not.toContain("bankAccountSnapshot");
          expect(Object.keys(row)).not.toContain("bankAccountNumber");
          expect(typeof row["bankAccountLast4"]).toBe("string");
          expect(typeof row["net"]).toBe("number");
          expect(typeof row["employeeCode"]).toBe("string");
        }
        expect(JSON.stringify(l.body)).not.toContain(ACCT_PREFIX);
        expect((await auditRows(b.id, "read")).length).toBe(r0 + 2);
        const list = await as(viewer.token).get(
          `/payroll/payment-batches?payrollPeriodId=${periodId}`,
        );
        expect(list.status).toBe(200);
        expect((list.body.data as Array<{ id: string }>).map((x) => x.id)).toContain(b.id);
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("069 — sửa đợt (thêm/bớt/đánh dấu đã chi)", () => {
      it("add/remove/markPaid; thêm người đã ở đợt khác ⇒ 409 027 `payee-already-in-batch` (payslip_uq); audit mang last4", async () => {
        const { periodId } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "bank",
          userIds: [payees[0], payees[1]],
        });
        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "bank",
          userIds: [payees[2]],
        });
        // Thêm P0 (đã ở a) vào b ⇒ unique TOÀN công ty.
        expectError(
          await as(officer.token)
            .patch(`/payroll/payment-batches/${b.id}`)
            .send({ addUserIds: [payees[0]] }),
          409,
          "PAYROLL-ERR-027",
          "payee-already-in-batch",
        );
        // Gỡ P1 khỏi a rồi thêm vào b ⇒ được.
        const rm = await as(officer.token)
          .patch(`/payroll/payment-batches/${a.id}`)
          .send({ removeUserIds: [payees[1]] });
        expect(rm.status, JSON.stringify(rm.body)).toBe(200);
        const add = await as(officer.token)
          .patch(`/payroll/payment-batches/${b.id}`)
          .send({ addUserIds: [payees[1]] });
        expect(add.status, JSON.stringify(add.body)).toBe(200);
        const mark = await as(officer.token)
          .patch(`/payroll/payment-batches/${b.id}`)
          .send({ markPaidUserIds: [payees[2]], status: "Ready", note: "n" });
        expect(mark.status, JSON.stringify(mark.body)).toBe(200);
        const lines = await linesOf(b.id);
        expect(
          lines
            .filter((l) => l.deleted_at === null)
            .map((l) => l.user_id)
            .sort(),
        ).toEqual([payees[1], payees[2]].sort());
        expect(lines.find((l) => l.user_id === payees[2])!.paid_at).not.toBeNull();
        const audits = await auditRows(a.id, "update");
        const json = JSON.stringify(audits.map((x) => x.after));
        expect(json).toContain(acct(1).slice(-4));
        expect(json).not.toContain(ACCT_PREFIX);
      });

      it("B1 — markPaid rồi remove ⇒ 409 027 `line-already-paid`, dòng CÒN SỐNG, `payslip_uq` KHÔNG nhả (đợt khác vẫn 409)", async () => {
        const { periodId } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: [payees[0]],
        });
        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: [payees[1]],
        });
        expect(
          (
            await as(officer.token)
              .patch(`/payroll/payment-batches/${a.id}`)
              .send({ markPaidUserIds: [payees[0]] })
          ).status,
        ).toBe(200);
        expectError(
          await as(officer.token)
            .patch(`/payroll/payment-batches/${a.id}`)
            .send({ removeUserIds: [payees[0]] }),
          409,
          "PAYROLL-ERR-027",
          "line-already-paid",
        );
        const lines = await linesOf(a.id);
        expect(lines).toHaveLength(1);
        expect(lines[0].deleted_at).toBeNull();
        expectError(
          await as(officer.token)
            .patch(`/payroll/payment-batches/${b.id}`)
            .send({ addUserIds: [payees[0]] }),
          409,
          "PAYROLL-ERR-027",
          "payee-already-in-batch",
        );
      });

      it("B4 — PATCH `status: Completed` ⇒ 400 (enum RIÊNG); đợt `Completed` thật ⇒ 409 027 `batch-already-completed`", async () => {
        const { periodId } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: [payees[0]],
        });
        expect(
          (
            await as(officer.token)
              .patch(`/payroll/payment-batches/${a.id}`)
              .send({ status: "Completed" })
          ).status,
        ).toBe(400);
        const done = await complete(completer.token, a.id, { confirmAllPaid: true });
        expect(done.status, JSON.stringify(done.body)).toBe(200);
        expectError(
          await as(officer.token).patch(`/payroll/payment-batches/${a.id}`).send({ note: "x" }),
          409,
          "PAYROLL-ERR-027",
          "batch-already-completed",
        );
        expectError(
          await as(officer.token)
            .patch(`/payroll/payment-batches/${a.id}`)
            .send({ addUserIds: [payees[1]] }),
          409,
          "PAYROLL-ERR-027",
          "batch-already-completed",
        );
      });

      it("trigger T1/T2 kích hoạt THẬT ở DB: sửa đợt Completed ⇒ `payroll_payment_batch_freeze:frozen:`; chèn dòng vào đợt Completed ⇒ `payroll_payment_line_guard:insert-into-completed:`", async () => {
        const { periodId, payslipIdByUser } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: [payees[0]],
        });
        expect((await complete(completer.token, a.id, { confirmAllPaid: true })).status).toBe(200);
        await expect(
          direct.query(`UPDATE payroll_payment_batches SET pay_date = '2080-01-01' WHERE id = $1`, [
            a.id,
          ]),
        ).rejects.toMatchObject({
          code: "23514",
          message: expect.stringMatching(/^payroll_payment_batch_freeze:frozen:/),
        });
        await expect(
          direct.query(
            `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id) VALUES ($1, $2, $3, $4)`,
            [A.companyId, a.id, payees[1], payslipIdByUser.get(payees[1])],
          ),
        ).rejects.toMatchObject({
          code: "23514",
          message: expect.stringMatching(/^payroll_payment_line_guard:insert-into-completed:/),
        });
        await expect(
          direct.query(`UPDATE payroll_payment_lines SET paid_at = NULL WHERE batch_id = $1`, [
            a.id,
          ]),
        ).rejects.toMatchObject({
          code: "23514",
          message: expect.stringMatching(/^payroll_payment_line_guard:frozen:/),
        });
      });
    });
  },
);

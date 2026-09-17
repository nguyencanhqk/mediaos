/**
 * S15-PAYROLL-BE-4 — đợt chi trả `PAYROLL-API-071..072` (plan §4.3 · §4.4 · §6.2). Đường thật (HTTP + Postgres lane).
 *
 * 🔀 **S15-PAYROLL-QA-1 (G15a) — nửa SAU của `s15-payroll-be4-batches.int-spec.ts`** (file gốc 945 dòng vượt
 * trần 800 — đọc-để-đăng ký-cổng `check.sh`): phần **067 (lập đợt) · BE-4B · 066/068/070 (đọc+mask) · 069 (sửa
 * đợt)** ở file kia; phần này giữ **071 (tệp UNC) · 072 (hoàn tất theo LUẬT PHỦ) · kỳ Locked di sản/cross-tenant**.
 * File TỰ boot app + TỰ seed tenant (KHÔNG chia sẻ `getHttpServer` với file kia — census
 * `apps/api/test/foundation/supertest-listen-ratchet.unit-spec.ts` phân tích mỗi file riêng). Mọi `it(...)` giữ
 * NGUYÊN tiêu đề + assertion so với file gốc — tách chỉ đổi cách CHIA FILE, không đổi hành vi.
 *
 * Trọng tâm: 071 BA cặp + tệp UNC chứa số TK ĐẦY ĐỦ · LUẬT PHỦ (072) với ca ÂM «đợt giữa chừng KHÔNG 409» + race
 * hai đợt cuối · MEDIUM-2 (log không chứa số TK) · kỳ `Locked` di sản `legacyPaidTrail` · cross-tenant 404.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { Logger, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
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
const LOGIN_PW = loginPasswordFixture("s15payrollbe4batc");
/** Tiền tố số TK của fixture — mọi số TK sinh từ đây; chuỗi này KHÔNG được xuất hiện ở log/audit/DTO. */
const ACCT_PREFIX = "8800550077";
const MONEY_KEY = /gross|\bnet\b|amount|salary/i;

interface Batch {
  id: string;
  warnings: string[];
}

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-BE-4 · đợt chi trả 071–072 (tệp UNC · luật PHỦ · kỳ Locked di sản · cross-tenant)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];
    let A: SeededTenant;
    let B: SeededTenant;
    /** officer = người LẬP đợt · completer = người HOÀN TẤT · viewer = chỉ view:payment-batch · u1/u2/u3 = thiếu từng cặp cho 071. */
    let officer = { id: "", token: "" };
    let completer = { id: "", token: "" };
    let viewer = { id: "", token: "" };
    let u1 = { id: "", token: "" };
    let u2 = { id: "", token: "" };
    let u3 = { id: "", token: "" };
    let officerB = { id: "", token: "" };
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

      A = await seedCompany(direct, "be4batca");
      B = await seedCompany(direct, "be4batcb");
      companyIds.push(A.companyId, B.companyId);

      const mk = async (t: SeededTenant, label: string, grant: (id: string) => Promise<void>) => {
        const email = `${label}@${t.slug}.test`;
        const id = await seedUser(direct, t.companyId, email, hash);
        await grant(id);
        return { id, token: await login(t, email) };
      };
      officer = await mk(A, "officer", (id) =>
        grantAllPayrollPairs(direct, A.companyId, id, "be4bc-officer"),
      );
      completer = await mk(A, "completer", (id) =>
        grantAllPayrollPairs(direct, A.companyId, id, "be4bc-completer"),
      );
      viewer = await mk(A, "viewer", (id) =>
        grantPayrollPairs(direct, A.companyId, id, "be4bc-viewer", ["batchList"]),
      );
      u1 = await mk(A, "u1", (id) =>
        grantPayrollPairs(direct, A.companyId, id, "be4bc-u1", ["batchExport"]),
      );
      u2 = await mk(A, "u2", (id) =>
        grantPayrollPairs(direct, A.companyId, id, "be4bc-u2", ["batchExport", "periodExport"]),
      );
      u3 = await mk(A, "u3", (id) =>
        grantPayrollPairs(direct, A.companyId, id, "be4bc-u3", ["batchExport", "payslipList"]),
      );
      officerB = await mk(B, "officer", (id) =>
        grantAllPayrollPairs(direct, B.companyId, id, "be4bc-officerb"),
      );
      // B có người THỨ HAI giữ manage:payment-batch ⇒ C3 không chặn trước 404 sentinel ở ca cross-tenant.
      await mk(B, "admin", (id) => grantAllPayrollPairs(direct, B.companyId, id, "be4bc-adminb"));

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
    describe("071 — tệp UNC (BA cặp)", () => {
      it("thiếu từng cặp ⇒ 403 + 0 audit; ĐỦ ba cặp ⇒ 200 XLSX chứa số TK ĐẦY ĐỦ, Σ Số tiền = Σ net, đúng 1 audit không TK/tiền", async () => {
        const { periodId } = await publishedPeriod();
        const b = await createBatch(officer.token, { payrollPeriodId: periodId, method: "bank" });
        const before = (await auditRows(b.id, "read")).length;
        for (const u of [u1, u2, u3]) {
          const res = await as(u.token).get(`/payroll/payment-batches/${b.id}/export`);
          expect(res.status, `${JSON.stringify(res.body)}`).toBe(403);
          expect(res.headers["content-type"]).toMatch(/application\/json/);
        }
        expect((await auditRows(b.id, "read")).length).toBe(before);

        const ok = await as(officer.token)
          .get(`/payroll/payment-batches/${b.id}/export`)
          .buffer(true)
          .parse(binaryParser);
        expect(ok.status).toBe(200);
        expect(ok.headers["content-type"]).toContain("spreadsheetml.sheet");
        expect(ok.headers["content-disposition"]).toMatch(/attachment; filename="unc-CT-.*\.xlsx"/);
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(ok.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
        const sheet = wb.worksheets[0];
        const accounts: string[] = [];
        let sum = 0;
        sheet.eachRow((row, n) => {
          if (n === 1) return;
          accounts.push(String(row.getCell(4).value));
          sum += Number(row.getCell(6).value);
        });
        expect(accounts.sort()).toEqual(
          payees
            .slice(0, 8)
            .map((_u, i) => acct(i))
            .sort(),
        );
        expect(sum).toBe(payees.slice(0, 8).reduce((s, _u, i) => s + Number(netOf(i)), 0));
        const audits = await auditRows(b.id, "read");
        expect(audits.length).toBe(before + 1);
        const json = JSON.stringify(audits[audits.length - 1]);
        expect(json).not.toContain(ACCT_PREFIX);
        expect(json).not.toMatch(MONEY_KEY);
        expect(json).toContain('"rowCount":8');
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("072 — hoàn tất theo LUẬT PHỦ", () => {
      it("đợt rỗng ⇒ 409 028 `batch-empty`; chưa chi ⇒ 409 027 `batch-incomplete`; người lập tự hoàn tất ⇒ 409 027 `batch-four-eyes`", async () => {
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
              .send({ removeUserIds: [payees[0]] })
          ).status,
        ).toBe(200);
        expectError(await complete(completer.token, a.id), 409, "PAYROLL-ERR-028", "batch-empty");
        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: [payees[1], payees[2]],
        });
        const inc = await complete(completer.token, b.id);
        expectError(inc, 409, "PAYROLL-ERR-027", "batch-incomplete");
        expect(detail(inc, "unpaidLines")).toBe("2");
        expectError(
          await complete(officer.token, b.id, { confirmAllPaid: true }),
          409,
          "PAYROLL-ERR-027",
          "batch-four-eyes",
        );
        const st = await direct.query(`SELECT status FROM payroll_payment_batches WHERE id = $1`, [
          b.id,
        ]);
        expect(st.rows[0].status).toBe("Draft");
      });

      it("A(6) ⇒ 200 `Published` unpaidPayees 4 (ca ÂM: KHÔNG 409); B(4) ⇒ 200 `Paid` + paid_* + legacyPaidTrail false + 1 outbox 027, 0 outbox 023; lần hai ⇒ 027; lập đợt mới sau Paid ⇒ 027", async () => {
        const { periodId, month } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: payees.slice(0, 6),
        });
        const ra = await complete(completer.token, a.id, {
          confirmAllPaid: true,
          payDate: `${month}-28`,
        });
        expect(ra.status, JSON.stringify(ra.body)).toBe(200);
        expect(ra.body.data).toEqual({
          id: a.id,
          batchStatus: "Completed",
          periodStatus: "Published",
          unpaidPayees: 4,
        });
        expect(await outboxOf("payroll.payment_batch_completed", periodId)).toHaveLength(0);

        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: payees.slice(6),
        });
        const rb = await complete(completer.token, b.id, { confirmAllPaid: true });
        expect(rb.status, JSON.stringify(rb.body)).toBe(200);
        expect(rb.body.data).toEqual({
          id: b.id,
          batchStatus: "Completed",
          periodStatus: "Paid",
          unpaidPayees: 0,
        });
        const period = await as(officer.token).get(`/payroll-periods/${periodId}`);
        expect(period.status).toBe(200);
        expect(period.body.data.status).toBe("Paid");
        expect(period.body.data.paidBy).toBe(completer.id);
        expect(period.body.data.paidAt).not.toBeNull();
        expect(period.body.data.legacyPaidTrail).toBe(false);
        const ev = await outboxOf("payroll.payment_batch_completed", periodId);
        expect(ev).toHaveLength(1);
        // holders(view:payment-batch) − actor(completer) = officer · viewer · u1? (u1..u3 KHÔNG có view) ⇒ officer, viewer.
        expect((ev[0].payload["recipientUserIds"] as string[]).sort()).toEqual(
          [officer.id, viewer.id].sort(),
        );
        expect(ev[0].payload["period_month"]).toBe(month);
        expect(JSON.stringify(ev[0].payload)).not.toMatch(MONEY_KEY);
        const pub = await direct.query(
          `SELECT count(*)::int AS n FROM outbox_events WHERE company_id = $1 AND event_type = 'payroll.payslip_published' AND payload->>'periodId' = $2`,
          [A.companyId, periodId],
        );
        expect(pub.rows[0].n).toBe(0);
        expectError(
          await complete(completer.token, b.id),
          409,
          "PAYROLL-ERR-027",
          "batch-already-completed",
        );
        expectError(
          await as(officer.token)
            .post("/payroll/payment-batches")
            .send({ payrollPeriodId: periodId, method: "cash" }),
          409,
          "PAYROLL-ERR-027",
          "period-not-published",
        );
      });

      it("RACE — hai đợt cuối hoàn tất song song ⇒ đúng một kỳ `Paid`, 0 lỗi 5xx, 1 outbox 027", async () => {
        const { periodId } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: payees.slice(0, 5),
        });
        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: payees.slice(5),
        });
        const [ra, rb] = await Promise.all([
          complete(completer.token, a.id, { confirmAllPaid: true }),
          complete(completer.token, b.id, { confirmAllPaid: true }),
        ]);
        expect(
          [ra.status, rb.status],
          `${JSON.stringify(ra.body)} | ${JSON.stringify(rb.body)}`,
        ).toEqual([200, 200]);
        const statuses = [ra.body.data.periodStatus, rb.body.data.periodStatus].sort();
        expect(statuses).toEqual(["Paid", "Published"]);
        const p = await direct.query(`SELECT status FROM payroll_periods WHERE id = $1`, [
          periodId,
        ]);
        expect(p.rows[0].status).toBe("Paid");
        expect(await outboxOf("payroll.payment_batch_completed", periodId)).toHaveLength(1);
      });

      it("MEDIUM-2 — race `payslip_uq` (hai đợt cùng thêm một người) và đường 500 giả lập `cross-user`: log KHÔNG chứa số TK", async () => {
        const errorSpy = vi.spyOn(Logger.prototype, "error");
        const { periodId, payslipIdByUser } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "bank",
          userIds: [payees[0]],
        });
        const b = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "bank",
          userIds: [payees[1]],
        });
        const [r1, r2] = await Promise.all([
          as(officer.token)
            .patch(`/payroll/payment-batches/${a.id}`)
            .send({ addUserIds: [payees[2]] }),
          as(officer.token)
            .patch(`/payroll/payment-batches/${b.id}`)
            .send({ addUserIds: [payees[2]] }),
        ]);
        expect([r1.status, r2.status].sort()).toEqual([200, 409]);
        const lost = r1.status === 409 ? r1 : r2;
        expect(detail(lost, "kind")).toBe("payee-already-in-batch");

        // Gieo `cross-user` THẲNG DB qua đường 069: thay tạm câu INSERT của repository bằng câu ghi sai user_id.
        const repo = app.get(PayrollPaymentBatchesRepository);
        const original = repo.insertLinesTx.bind(repo);
        const spy = vi
          .spyOn(repo, "insertLinesTx")
          .mockImplementation(async (tx, companyId, batch, _ids, actor) => {
            const { sql } = await import("drizzle-orm");
            await tx.execute(sql`
          insert into payroll_payment_lines (company_id, batch_id, user_id, payslip_id, bank_account_snapshot, bank_name_snapshot, account_holder_snapshot, created_by)
          values (${companyId}::uuid, ${batch.id}::uuid, ${payees[3]}::uuid, ${payslipIdByUser.get(payees[4])}::uuid,
                  ${acct(3)}, 'VCB', 'HOLDER', ${actor}::uuid)`);
            return original(tx, companyId, batch, _ids, actor);
          });
        try {
          const res = await as(officer.token)
            .patch(`/payroll/payment-batches/${a.id}`)
            .send({ addUserIds: [payees[3]] });
          expect(res.status, JSON.stringify(res.body)).toBe(500);
          expect(JSON.stringify(res.body)).not.toContain(ACCT_PREFIX);
        } finally {
          spy.mockRestore();
        }
        const logged = errorSpy.mock.calls
          .map((c) =>
            c.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : String(x))).join("\n"),
          )
          .join("\n");
        expect(logged).toContain("payroll_payment_lines write failed");
        expect(logged).toContain("tag=payroll_payment_line_guard:cross-user");
        expect(logged).not.toContain(ACCT_PREFIX);
        errorSpy.mockRestore();
      });
    });

    // ═══════════════════════════════════════════════════════════════════════════════════════════════
    describe("kỳ Locked di sản · cross-tenant", () => {
      it("kỳ `Locked` di sản (paid_* := published_*) ⇒ 003 trả `legacyPaidTrail: true`", async () => {
        const { periodId } = await publishedPeriod("Locked");
        const res = await as(officer.token).get(`/payroll-periods/${periodId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe("Locked");
        expect(res.body.data.paidAt).toBe(res.body.data.publishedAt);
        expect(res.body.data.legacyPaidTrail).toBe(true);
      });

      it("cross-tenant: token B với đợt của A ⇒ 404 ở 068/069/070/071/072; 066 không thấy", async () => {
        const { periodId } = await publishedPeriod();
        const a = await createBatch(officer.token, {
          payrollPeriodId: periodId,
          method: "cash",
          userIds: [payees[0]],
        });
        const b = as(officerB.token);
        expect((await b.get(`/payroll/payment-batches/${a.id}`)).status).toBe(404);
        expect((await b.patch(`/payroll/payment-batches/${a.id}`).send({ note: "x" })).status).toBe(
          404,
        );
        expect((await b.get(`/payroll/payment-batches/${a.id}/lines`)).status).toBe(404);
        expect((await b.get(`/payroll/payment-batches/${a.id}/export`)).status).toBe(404);
        expect((await b.post(`/payroll/payment-batches/${a.id}/complete`).send({})).status).toBe(
          404,
        );
        const list = await b.get("/payroll/payment-batches?per_page=100");
        expect((list.body.data as Array<{ id: string }>).map((x) => x.id)).not.toContain(a.id);
        expect(
          (
            await b
              .post(`/payroll/payment-batches`)
              .send({ payrollPeriodId: periodId, method: "cash" })
          ).status,
        ).toBe(404);
        expect(
          (await as(officer.token).get(`/payroll/payment-batches/${randomUUID()}`)).status,
        ).toBe(404);
      });
    });
  },
);

/** supertest parser nhị phân cho XLSX. */
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void): void {
  // superagent giao IncomingMessage (stream) cho parser tuỳ biến — kiểu khai là Response, đọc như stream.
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (c: Buffer) => chunks.push(c));
  stream.on("end", () => cb(null, Buffer.concat(chunks)));
}

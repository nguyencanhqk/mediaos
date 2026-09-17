/**
 * S15-PAYROLL-BE-4 — đợt chi trả, file 2/2 (S15-PAYROLL-DEBT-1 tách theo describe từ
 * `s15-payroll-be4-batches.int-spec.ts`): 071 tệp UNC BA cặp + số TK ĐẦY ĐỦ · 072 hoàn tất theo LUẬT PHỦ (ca ÂM
 * «đợt giữa chừng KHÔNG 409» + race hai đợt cuối · C3 · MEDIUM-2 log không chứa số TK) · kỳ `Locked` di sản
 * `legacyPaidTrail` · cross-tenant. Khung chung: `test/helpers/payroll-be4-batches-suite.ts`.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
 */
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { PayrollPaymentBatchesRepository } from "../../src/payroll/payroll-payment-batches.repository";
import { hasDb } from "../helpers/integration-db";
import {
  ACCT_PREFIX,
  MONEY_KEY,
  binaryParser,
  useBe4BatchesSuite,
} from "../helpers/payroll-be4-batches-suite";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-BE-4 · đợt chi trả 071–072 (UNC · luật PHỦ) + Locked/cross-tenant",
  () => {
    const suite = useBe4BatchesSuite("be4batx");
    const {
      officer,
      completer,
      viewer,
      u1,
      u2,
      u3,
      officerB,
      payees,
      acct,
      netOf,
      as,
      detail,
      expectError,
      publishedPeriod,
      createBatch,
      outboxOf,
      auditRows,
      complete,
    } = suite;

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
        const st = await suite.direct.query(
          `SELECT status FROM payroll_payment_batches WHERE id = $1`,
          [b.id],
        );
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
        const pub = await suite.direct.query(
          `SELECT count(*)::int AS n FROM outbox_events WHERE company_id = $1 AND event_type = 'payroll.payslip_published' AND payload->>'periodId' = $2`,
          [suite.A.companyId, periodId],
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
        const p = await suite.direct.query(`SELECT status FROM payroll_periods WHERE id = $1`, [
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
        const repo = suite.app.get(PayrollPaymentBatchesRepository);
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

/**
 * S15-PAYROLL-QA-1 — bắn THẬT mọi ràng buộc DB còn thiếu ca của bảng "constraint → SQLSTATE → mã"
 * (`docs/spec/SPEC-11 PAYROLL.md:739-763`, mục 30(b) §21.1 + dòng "QA census bắt buộc" ngay dưới bảng).
 * Cặp với `test/foundation/payroll-constraint-map-census.unit-spec.ts` (quét tĩnh — file NÀY là bằng
 * chứng động: lỗi PG THẬT, KHÔNG mock, rồi đưa thẳng vào `mapPayrollPgError(err)`).
 *
 * KHÔNG boot Nest app — `directPool()` bắn SQL thô, bắt lỗi `pg` THẬT, gọi `mapPayrollPgError` như một
 * hàm THUẦN. `directPool()` dùng role owner/superuser (BYPASSRLS) — không sao: CHECK/UNIQUE/EXCLUDE/
 * trigger vẫn chạy bất kể RLS (`directPool-bypasses-rls-not-constraints`).
 *
 * PHẠM VI:
 *  A. Bảy ràng buộc TÊN đo được là CHƯA từng bắn thật ở DB trong bất kỳ `*payroll*.int-spec.ts` nào
 *     (đo bằng `payroll-constraint-map-census.unit-spec.ts` — 5 cái đã biết trước khi mở WO +
 *     `salary_components_code_shape_check` lộ ra vì mọi chỗ nhắc nó chỉ là COMMENT, không phải ca thật).
 *     HAI TRONG BẢY map SAI/KHÔNG map so với bảng ĐÓNG — pin RED có chủ đích, xem docblock từng `it`.
 *  B. Đại diện `trigger:tag` → `mapPayrollPgError` — `s15-payroll-db2-invariants.int-spec.ts` đã bắn ĐỦ
 *     15/15 cặp ở tầng SQLSTATE+message (qua `expectTag`) nhưng KHÔNG file nào gọi `mapPayrollPgError`
 *     với lỗi thật của track C; đây là lớp còn thiếu (HTTP/mã/`kind` đúng bảng, không chỉ SQLSTATE).
 *  C. Một tag `not-found` của `payroll_advance_freeze_guard` — có trong trigger THẬT (mig 0572:740,753)
 *     và trong `docs/plans/S15-PAYROLL-DB-2.md §3.5.a` nhưng KHÔNG có trong bảng ĐÓNG của SPEC-11 — bằng
 *     chứng cho báo cáo, KHÔNG tính vào 15 cặp census (ngoài phạm vi bảng SPEC-11 đang audit).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5) — chạy: `LANE=s15qa1b … s15-payroll-qa1-constraints.int-spec.ts`.
 */

import { randomUUID } from "node:crypto";
import type { HttpException } from "@nestjs/common";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAYROLL_ERR_CODE, mapPayrollPgError } from "../../src/payroll/payroll.errors";
import { directPool, hasDb } from "../helpers/integration-db";
import { cleanupTenants, seedCompany, seedUser, type SeededTenant } from "../helpers/seed";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

interface PgRawError extends Error {
  code?: string;
  constraint?: string;
}

interface MappedBody {
  status: number;
  code: string;
  kind: string | undefined;
  raw: unknown;
}

describe.skipIf(!hasLaneDb)(
  "S15-PAYROLL-QA-1 · constraint → SQLSTATE → mã (đường thật, DB cô lập)",
  () => {
    let direct: Pool;
    let A: SeededTenant;
    let u1 = ""; // actor mặc định (created_by / officer)
    let u2 = ""; // second actor (decided_by / approver — khác u1, cần cho four-eyes)
    const companyIds: string[] = [];
    let monthSeq = 0;

    /** Tháng khác nhau cho mỗi kỳ fixture — unique (company_id, period_month). */
    const nextMonth = (): string => {
      const i = monthSeq++;
      return `${2050 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    };

    beforeAll(async () => {
      if (!hasLaneDb) return;
      direct = directPool();
      A = await seedCompany(direct, "qa1constr");
      companyIds.push(A.companyId);
      u1 = await seedUser(direct, A.companyId, `qa1c-u1-${randomUUID().slice(0, 8)}@test.local`);
      u2 = await seedUser(direct, A.companyId, `qa1c-u2-${randomUUID().slice(0, 8)}@test.local`);
    });

    afterAll(async () => {
      if (!hasLaneDb) return;
      await cleanupTenants(direct, companyIds);
      await direct.end();
    });

    /** Chạy `sql` — kỳ vọng NÉM lỗi PG thật; trả lỗi đó (KHÔNG mock). Chạy trót lọt ⇒ ném lỗi harness rõ ràng. */
    async function fireRaw(sql: string, params: unknown[]): Promise<PgRawError> {
      try {
        await direct.query(sql, params);
      } catch (err) {
        return err as PgRawError;
      }
      throw new Error(`fireRaw: câu lệnh kỳ vọng NÉM lỗi PG nhưng chạy trót lọt — ${sql}`);
    }

    /** Câu lệnh kỳ vọng THÀNH CÔNG (đối chứng DƯƠNG) — ném lại nếu KHÔNG. */
    async function allow(sql: string, params: unknown[]): Promise<void> {
      await direct.query(sql, params);
    }

    /** Đưa lỗi PG thật (không mock) vào `mapPayrollPgError`, giải body HttpException nếu có. */
    function mapped(err: unknown): MappedBody | null {
      const result = mapPayrollPgError(err);
      if (!result) return null;
      const http = result as HttpException;
      const body = http.getResponse() as {
        code: string;
        details?: Array<{ field: string; message: string }>;
      };
      return {
        status: http.getStatus(),
        code: body.code,
        kind: body.details?.find((d) => d.field === "kind")?.message,
        raw: body,
      };
    }

    const cCode = (n: string) => `QA1C_${n}_${randomUUID().slice(0, 6)}`.toUpperCase();

    /** Kỳ `Calculated` — `payroll_periods_calculated_needs_attendance_check` đòi `attendance_period_id` NOT NULL. */
    async function mkCalcPeriod(): Promise<string> {
      const month = nextMonth();
      const ap = await direct.query<{ id: string }>(
        `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
        [A.companyId, month],
      );
      const p = await direct.query<{ id: string }>(
        `INSERT INTO payroll_periods (company_id, period_month, status, attendance_period_id)
         VALUES ($1, $2, 'Calculated', $3) RETURNING id`,
        [A.companyId, month, ap.rows[0].id],
      );
      return p.rows[0].id;
    }

    // ════════════════════════════════════════════════════════════════════════════════════════════════
    // A. Bảy ràng buộc TÊN chưa từng bắn thật (đo bằng census unit-spec)
    // ════════════════════════════════════════════════════════════════════════════════════════════════
    describe("A. ràng buộc TÊN chưa từng có ca thật", () => {
      it("A1 `salary_components_company_code_uq` (23505) ⇒ 409 024 component-code-exists", async () => {
        const code = cCode("DUPCODE");
        await allow(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, $2, 'first', 'earning', 'formula', 'SYS_BASE_SALARY')`,
          [A.companyId, code],
        );
        const err = await fireRaw(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, $2, 'dup', 'earning', 'formula', 'SYS_BASE_SALARY')`,
          [A.companyId, code],
        );
        expect(err.code).toBe("23505");
        expect(err.constraint).toBe("salary_components_company_code_uq");
        const m = mapped(err);
        expect(m, "mapPayrollPgError trả null — thiếu nhánh map").not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.COMPONENT_CONFLICT);
        expect(m?.kind).toBe("component-code-exists");
        // ĐỐI CHỨNG DƯƠNG: mã KHÁC đi qua.
        await allow(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, $2, 'ok', 'earning', 'formula', 'SYS_BASE_SALARY')`,
          [A.companyId, cCode("DUPCODE2")],
        );
      });

      it("A2 `salary_components_code_shape_check` (23514) ⇒ 409 024 component-code-reserved (mọi ca cũ CHỈ là comment, không phải ca thật)", async () => {
        const err = await fireRaw(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, 'SYS_QA_RESERVED', 'bad', 'earning', 'formula', 'SYS_BASE_SALARY')`,
          [A.companyId],
        );
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("salary_components_code_shape_check");
        const m = mapped(err);
        expect(m).not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.COMPONENT_CONFLICT);
        expect(m?.kind).toBe("component-code-reserved");
        // ĐỐI CHỨNG DƯƠNG: mã hợp lệ (không mang tiền tố hệ thống) đi qua.
        await allow(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, $2, 'ok', 'earning', 'formula', 'SYS_BASE_SALARY')`,
          [A.companyId, cCode("SHAPEOK")],
        );
      });

      /**
       * SPEC-11 từng TỰ MÂU THUẪN về HAI CHECK này: dòng 711 (khối «Kind bổ sung» của BE-2) ⇒ 422 018
       * `component-value-pair`; bảng đóng ⇒ 400 VALIDATION-ERR-001. Chốt theo 711 (S15-PAYROLL-QA-1, bảng đóng đã
       * đính chính cùng WO): route SỬA 047 kiểm cặp `valueType` trên hàng SAU MERGE ở SERVICE và trả đúng 422 018
       * `component-value-pair` (contracts `updateSalaryComponentSchema`) — lưới DB phải cho CÙNG phản hồi, kẻo một
       * race/đường ghi lách tiền-kiểm đổi mã HTTP. 400 chỉ đúng cho CHECK mà Zod mirror trên PAYLOAD (045), còn
       * 047 là PATCH từng phần nên Zod không thấy hàng sau merge.
       */
      it("A3 `salary_components_value_pair_check` (23514) ⇒ 422 018 component-value-pair (cùng phản hồi tiền-kiểm 047)", async () => {
        const err = await fireRaw(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula, fixed_amount)
         VALUES ($1, $2, 'bad-value-pair', 'earning', 'formula', NULL, NULL)`,
          [A.companyId, cCode("VPAIR")],
        );
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("salary_components_value_pair_check");
        const m = mapped(err);
        expect(m, "mapPayrollPgError KHÔNG được trả null (⇒ 500)").not.toBeNull();
        expect(m?.status).toBe(422);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.FORMULA_INVALID);
        expect(m?.kind).toBe("component-value-pair");
        // ĐỐI CHỨNG DƯƠNG: cặp value_type/formula hợp lệ đi qua (không đụng CHECK này).
        await allow(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula)
         VALUES ($1, $2, 'ok', 'earning', 'formula', 'SYS_BASE_SALARY')`,
          [A.companyId, cCode("VPAIROK")],
        );
      });

      /** Cùng hàng bảng đóng với A3 (hai CHECK một hàng) ⇒ cùng phản hồi 422 018 `component-value-pair`. */
      it("A4 `salary_components_engine_kind_check` (23514) ⇒ 422 018 component-value-pair (cùng hàng với A3)", async () => {
        const err = await fireRaw(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, is_system)
         VALUES ($1, $2, 'bad-engine-kind', 'earning', 'engine', true)`,
          [A.companyId, cCode("EKIND")],
        );
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("salary_components_engine_kind_check");
        const m = mapped(err);
        expect(m, "mapPayrollPgError KHÔNG được trả null (⇒ 500)").not.toBeNull();
        expect(m?.status).toBe(422);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.FORMULA_INVALID);
        expect(m?.kind).toBe("component-value-pair");
        // ĐỐI CHỨNG DƯƠNG: aggregate + engine + is_system (khuôn 4 nút tổng hợp seeder) đi qua.
        await allow(
          `INSERT INTO salary_components (company_id, code, name, kind, value_type, is_system)
         VALUES ($1, $2, 'ok', 'aggregate', 'engine', true)`,
          [A.companyId, cCode("EKINDOK")],
        );
      });

      it("A5 `payroll_statutory_rates_company_effective_uq` (23505) ⇒ 409 033 rate-effective-date-exists", async () => {
        const rateSql = (effectiveFrom: string): [string, unknown[]] => [
          `INSERT INTO payroll_statutory_rates
           (company_id, effective_from, si_employee_pct, hi_employee_pct, ui_employee_pct,
            si_employer_pct, hi_employer_pct, ui_employer_pct, union_employer_pct,
            union_employee_pct, si_cap, hi_cap, ui_cap, base_wage, min_region_wage,
            personal_deduction, dependent_deduction, pit_brackets)
         VALUES ($1, $2, 8,1.5,1, 17.5,3,1, 2,1, 1,1,1, 1,1, 1,1,
                 '[{"upTo":1,"rate":5},{"upTo":2,"rate":10},{"upTo":3,"rate":15},
                   {"upTo":4,"rate":20},{"upTo":5,"rate":25},{"upTo":6,"rate":30},
                   {"upTo":null,"rate":35}]'::jsonb)`,
          [A.companyId, effectiveFrom],
        ];
        const [sql, params] = rateSql("2051-01-01");
        await allow(sql, params);
        const [sql2, params2] = rateSql("2051-01-01");
        const err = await fireRaw(sql2, params2);
        expect(err.code).toBe("23505");
        expect(err.constraint).toBe("payroll_statutory_rates_company_effective_uq");
        const m = mapped(err);
        expect(m).not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.STATUTORY_RATE_CONFLICT);
        expect(m?.kind).toBe("rate-effective-date-exists");
        const [sql3, params3] = rateSql("2051-02-01");
        await allow(sql3, params3); // ĐỐI CHỨNG DƯƠNG: ngày hiệu lực khác đi qua.
      });

      it("A6 `payroll_templates_company_code_uq` (23505) ⇒ 409 023 template-code-exists", async () => {
        const code = cCode("TPL");
        await allow(
          `INSERT INTO payroll_templates (company_id, code, name, scope) VALUES ($1, $2, 'first', 'company')`,
          [A.companyId, code],
        );
        const err = await fireRaw(
          `INSERT INTO payroll_templates (company_id, code, name, scope) VALUES ($1, $2, 'dup', 'company')`,
          [A.companyId, code],
        );
        expect(err.code).toBe("23505");
        expect(err.constraint).toBe("payroll_templates_company_code_uq");
        const m = mapped(err);
        expect(m).not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.TEMPLATE_CONFLICT);
        expect(m?.kind).toBe("template-code-exists");
        await allow(
          `INSERT INTO payroll_templates (company_id, code, name, scope) VALUES ($1, $2, 'ok', 'company')`,
          [A.companyId, cCode("TPL2")],
        );
      });

      /**
       * 🩹 LỖI SẢN PHẨM lộ ra ở S15-PAYROLL-QA-1 (đã vá cùng WO): `mapPayrollPgError` trả `null` cho CHECK này ⇒
       * `payroll-calc.service.ts` (`adjustLine`, route 009) ném `mapPayrollPgError(err) ?? err` ⇒ lỗi PG thô ra
       * `AllExceptionsFilter` ⇒ **500 vô danh ở vùng đỏ**. Bảng đóng SPEC-11 §12.1 đòi **400 VALIDATION-ERR-001**
       * (Zod mirror ĐÚNG BẰNG ở 009 — cùng lớp ba CHECK «Zod đã mirror» đã có `payrollBadRequest`). Ca unit cũ
       * ghim `null` là ghim cái lỗ — đã đổi cùng lượt vá.
       */
      it("A7 `payroll_period_lines_adjustment_check` (23514) ⇒ 400 VALIDATION-ERR-001 (trước vá: null ⇒ 500)", async () => {
        const period = await direct.query<{ id: string }>(
          `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, $2, 'Draft') RETURNING id`,
          [A.companyId, nextMonth()],
        );
        const periodId = period.rows[0].id;
        const err = await fireRaw(
          `INSERT INTO payroll_period_lines
           (company_id, payroll_period_id, user_id, input_snapshot_json, adjustment_amount, adjustment_reason)
         VALUES ($1, $2, $3, '{"workDays":22}'::jsonb, 100.00, NULL)`,
          [A.companyId, periodId, u1],
        );
        expect(err.code).toBe("23514");
        expect(err.constraint).toBe("payroll_period_lines_adjustment_check");
        const m = mapped(err);
        expect(m, "null ⇒ lỗi PG thô ⇒ 500 vùng đỏ (đúng lỗi đã vá)").not.toBeNull();
        expect(m?.status).toBe(400);
        expect(m?.code).toBe("VALIDATION-ERR-001");
        // ĐỐI CHỨNG DƯƠNG: adjustment_amount khác 0 KÈM lý do đi qua.
        await allow(
          `INSERT INTO payroll_period_lines
           (company_id, payroll_period_id, user_id, input_snapshot_json, adjustment_amount, adjustment_reason)
         VALUES ($1, $2, $3, '{"workDays":22}'::jsonb, 100.00, 'QA lý do')`,
          [A.companyId, periodId, u2],
        );
      });
    });

    // ════════════════════════════════════════════════════════════════════════════════════════════════
    // B. Đại diện trigger:tag → mapPayrollPgError (SQLSTATE đã có ca thật ở db2-invariants; ở đây thêm
    //    lớp HTTP/mã/kind — mỗi nhánh PHÂN BIỆT của `mapPayrollTrackCTag` có ≥1 ca gọi hàm THẬT)
    // ════════════════════════════════════════════════════════════════════════════════════════════════
    describe("B. trigger:tag → mapPayrollPgError (đại diện mỗi nhánh phân biệt)", () => {
      it("B1 T1 `payroll_payment_batch_freeze:frozen` ⇒ 409 027 batch-already-completed", async () => {
        const period = await direct.query<{ id: string }>(
          `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, $2, 'Draft') RETURNING id`,
          [A.companyId, nextMonth()],
        );
        const periodId = period.rows[0].id;
        // T1 chặn INSERT thẳng ở `Completed` (tag `insert-completed`, hoàn tất CHỈ qua API-072) — phải
        // tạo `Draft` rồi UPDATE sang `Completed` ở CÂU RIÊNG.
        const batch = await direct.query<{ id: string }>(
          `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method)
         VALUES ($1, $2, $3, 'cash') RETURNING id`,
          [A.companyId, periodId, cCode("B1")],
        );
        const batchId = batch.rows[0].id;
        await allow(
          `UPDATE payroll_payment_batches SET status = 'Completed', completed_by = $2, completed_at = now() WHERE id = $1`,
          [batchId, u1],
        );
        const err = await fireRaw(
          `UPDATE payroll_payment_batches SET status = 'Draft' WHERE id = $1`,
          [batchId],
        );
        expect(err.code).toBe("23514");
        expect(err.message.startsWith("payroll_payment_batch_freeze:frozen:")).toBe(true);
        const m = mapped(err);
        expect(m).not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.PAYMENT_BATCH_CONFLICT);
        expect(m?.kind).toBe("batch-already-completed");
        // ĐỐI CHỨNG DƯƠNG: sửa `note` của đợt Completed vẫn đi qua (T1 CHO PHÉP đúng cột này).
        await allow(`UPDATE payroll_payment_batches SET note = 'qa note' WHERE id = $1`, [batchId]);
      });

      it("B2 T1 `payroll_payment_batch_freeze:has-active-lines` ⇒ mapPayrollPgError trả null (500 CÓ CHỦ ĐÍCH — service phải gỡ dòng trước, đúng SPEC-11 dòng 759)", async () => {
        const period = await direct.query<{ id: string }>(
          `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, $2, 'Draft') RETURNING id`,
          [A.companyId, nextMonth()],
        );
        const periodId = period.rows[0].id;
        const payslip = await direct.query<{ id: string }>(
          `INSERT INTO payslips
             (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
         VALUES ($1, $2, $3, 1, 1, 1, $3, '{"workDays":22}'::jsonb) RETURNING id`,
          [A.companyId, periodId, u1],
        );
        const payslipId = payslip.rows[0].id;
        const batch = await direct.query<{ id: string }>(
          `INSERT INTO payroll_payment_batches (company_id, payroll_period_id, code, method)
         VALUES ($1, $2, $3, 'cash') RETURNING id`,
          [A.companyId, periodId, cCode("B2")],
        );
        const batchId = batch.rows[0].id;
        const line = await direct.query<{ id: string }>(
          `INSERT INTO payroll_payment_lines (company_id, batch_id, user_id, payslip_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
          [A.companyId, batchId, u1, payslipId],
        );
        const err = await fireRaw(
          `UPDATE payroll_payment_batches SET deleted_at = now() WHERE id = $1`,
          [batchId],
        );
        expect(err.code).toBe("23514");
        expect(err.message.startsWith("payroll_payment_batch_freeze:has-active-lines:")).toBe(true);
        expect(mapped(err)).toBeNull();
        // ĐỐI CHỨNG DƯƠNG: gỡ dòng TRƯỚC rồi xoá đợt SAU thì qua.
        await allow(`UPDATE payroll_payment_lines SET deleted_at = now() WHERE id = $1`, [
          line.rows[0].id,
        ]);
        await allow(`UPDATE payroll_payment_batches SET deleted_at = now() WHERE id = $1`, [
          batchId,
        ]);
      });

      it("B3 T3 `payroll_advance_freeze_guard:period-frozen` ⇒ 409 026 advance-period-frozen", async () => {
        const pDraft = await direct.query<{ id: string }>(
          `INSERT INTO payroll_periods (company_id, period_month, status) VALUES ($1, $2, 'Draft') RETURNING id`,
          [A.companyId, nextMonth()],
        );
        const pCalcId = await mkCalcPeriod();
        const adv = await direct.query<{ id: string }>(
          `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, created_by)
         VALUES ($1, $2, 100, '2050-01', 'qa tam ung', $3) RETURNING id`,
          [A.companyId, u1, u1],
        );
        const advId = adv.rows[0].id;
        await allow(
          `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
          [advId, u2],
        );
        const err = await fireRaw(
          `UPDATE payroll_advances SET status = 'Deducted', payroll_period_id = $2, consumed_at = now() WHERE id = $1`,
          [advId, pDraft.rows[0].id],
        );
        expect(err.code).toBe("23514");
        expect(err.message.startsWith("payroll_advance_freeze_guard:period-frozen:")).toBe(true);
        const m = mapped(err);
        expect(m).not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.ADVANCE_PERIOD_FROZEN);
        expect(m?.kind).toBe("advance-period-frozen");
        // ĐỐI CHỨNG DƯƠNG: bind vào kỳ `Calculated` thì qua.
        await allow(
          `UPDATE payroll_advances SET status = 'Deducted', payroll_period_id = $2, consumed_at = now() WHERE id = $1`,
          [advId, pCalcId],
        );
      });

      it("B4 T3 `payroll_advance_freeze_guard:rebind` ⇒ 409 025 advance-already-deducted (KIND KHÁC B3/frozen — chốt phân nhánh trong mapPayrollTrackCTag)", async () => {
        const pCalc1Id = await mkCalcPeriod();
        const pCalc2Id = await mkCalcPeriod();
        const adv = await direct.query<{ id: string }>(
          `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, created_by)
         VALUES ($1, $2, 100, '2050-02', 'qa tam ung rebind', $3) RETURNING id`,
          [A.companyId, u1, u1],
        );
        const advId = adv.rows[0].id;
        await allow(
          `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
          [advId, u2],
        );
        await allow(
          `UPDATE payroll_advances SET status = 'Deducted', payroll_period_id = $2, consumed_at = now() WHERE id = $1`,
          [advId, pCalc1Id],
        );
        const err = await fireRaw(
          `UPDATE payroll_advances SET payroll_period_id = $2 WHERE id = $1`,
          [advId, pCalc2Id],
        );
        expect(err.code).toBe("23514");
        expect(err.message.startsWith("payroll_advance_freeze_guard:rebind:")).toBe(true);
        const m = mapped(err);
        expect(m).not.toBeNull();
        expect(m?.status).toBe(409);
        expect(m?.code).toBe(PAYROLL_ERR_CODE.ADVANCE_CONFLICT);
        expect(
          m?.kind,
          "rebind ⇒ kind KHÁC frozen/status-terminal/insert-shape (advance-not-pending)",
        ).toBe("advance-already-deducted");
        // ĐỐI CHỨNG DƯƠNG: nhả consume (Deducted → Approved, cả cặp về NULL) trong khi kỳ vẫn Calculated thì qua.
        await allow(
          `UPDATE payroll_advances SET status = 'Approved', payroll_period_id = NULL, consumed_at = NULL WHERE id = $1`,
          [advId],
        );
      });
    });

    // ════════════════════════════════════════════════════════════════════════════════════════════════
    // C. Bằng chứng cho báo cáo — tag `not-found` của T3 KHÔNG có trong bảng ĐÓNG của SPEC-11
    // ════════════════════════════════════════════════════════════════════════════════════════════════
    describe("C. phát hiện — tag ngoài bảng ĐÓNG SPEC-11 (không tính vào N=15 của census)", () => {
      it("C1 🔴 `payroll_advance_freeze_guard:not-found` CÓ THẬT trong trigger (mig 0572:740,753) + docs/plans/S15-PAYROLL-DB-2.md §3.5.a nhưng VẮNG khỏi bảng ĐÓNG SPEC-11 (dòng 754-755 chỉ liệt 5 tag, thiếu `not-found`) — mapPayrollPgError trả null (cùng xử lý null như 4 tag CỐ Ý unmapped khác, nhưng KHÔNG được census SPEC-11 ghim vì bảng thiếu dòng)", async () => {
        const adv = await direct.query<{ id: string }>(
          `INSERT INTO payroll_advances (company_id, user_id, amount, deduct_period_month, reason, created_by)
         VALUES ($1, $2, 100, '2050-03', 'qa not-found', $3) RETURNING id`,
          [A.companyId, u1, u1],
        );
        const advId = adv.rows[0].id;
        await allow(
          `UPDATE payroll_advances SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
          [advId, u2],
        );
        const err = await fireRaw(
          `UPDATE payroll_advances SET status = 'Deducted', payroll_period_id = $2, consumed_at = now() WHERE id = $1`,
          [advId, randomUUID()],
        );
        expect(err.code).toBe("23514");
        expect(err.message.startsWith("payroll_advance_freeze_guard:not-found:")).toBe(true);
        expect(
          mapped(err),
          "not-found rơi null giống 4 tag CỐ Ý unmapped khác — hành vi AN TOÀN (500 vùng đỏ có chủ đích, không phải lộ dữ liệu), nhưng SPEC-11 cần bổ sung dòng cho tag này để census không có lỗ trống",
        ).toBeNull();
      });
    });
  },
);

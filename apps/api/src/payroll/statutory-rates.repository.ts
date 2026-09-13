import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { payrollStatutoryRates, type PayrollStatutoryRate } from "../db/schema/payroll";

/** Cột numeric là CHUỖI; `pitBrackets` là jsonb đã được service kiểm liên tục. */
export type StatutoryRateWrite = Partial<
  Pick<
    PayrollStatutoryRate,
    | "effectiveFrom"
    | "siEmployeePct"
    | "hiEmployeePct"
    | "uiEmployeePct"
    | "siEmployerPct"
    | "hiEmployerPct"
    | "uiEmployerPct"
    | "unionEmployerPct"
    | "unionEmployeePct"
    | "siCap"
    | "hiCap"
    | "uiCap"
    | "baseWage"
    | "minRegionWage"
    | "personalDeduction"
    | "dependentDeduction"
    | "pitBrackets"
    | "note"
  >
>;

export type StatutoryRateWithUse = PayrollStatutoryRate & { inUse: boolean };

/**
 * «Bản tỉ lệ R ĐÃ CÓ KỲ DÙNG» — định nghĩa CHỐT ở plan BE-2 §4 (plan-review MF13), mirror ĐÚNG BẰNG
 * `inUseAtTx` dưới:
 *   ∃ `payroll_periods` chưa xoá, `status ∉ {Draft, CollectingData}`, `ngày cuối tháng(period_month) ≥ R.effective_from`.
 *
 * ⚠️ KHÔNG có vế «không có bản R2 xen giữa»: vế đó cho phép lách bằng HAI lượt gọi — POST một R2 có
 * `effective_from` rơi vào kỳ đã tính (R thôi «đang dùng») rồi PATCH số của R tự do. Bản lỏng hơn là lỗ đổi tiền.
 * `NOT IN` (không phải `IN` các trạng thái «đã tính») ⇒ trạng thái mới của DB-2 (`Published`) tự động được tính.
 *
 * ⚠️ Viết tên bảng TƯỜNG MINH trong SQL thô: drizzle render cột trong `sql` KHÔNG kèm tên bảng
 * (`drizzle-sql-template-renders-columns-unqualified`) — với subquery tương quan đó là tham chiếu mơ hồ.
 */
const IN_USE_EXISTS = sql<boolean>`EXISTS (
  SELECT 1 FROM payroll_periods pp
   WHERE pp.company_id = payroll_statutory_rates.company_id
     AND pp.deleted_at IS NULL
     AND pp.status NOT IN ('Draft', 'CollectingData')
     AND (to_date(pp.period_month, 'YYYY-MM') + interval '1 month' - interval '1 day')::date
         >= payroll_statutory_rates.effective_from
)`;

/**
 * S15-PAYROLL-BE-2 — `payroll_statutory_rates` (PAYROLL-API-055..058). GRANT app `SELECT, INSERT, UPDATE` — không
 * DELETE, và không route xoá (SPEC-11 §15.1 không cấp).
 */
@Injectable()
export class StatutoryRatesRepository {
  private static live(companyId: string) {
    return and(eq(payrollStatutoryRates.companyId, companyId), isNull(payrollStatutoryRates.deletedAt));
  }

  /** 055 — mới nhất trước; `inUse` tính TRONG CÙNG câu (không N+1). */
  async listTx(
    tx: TenantTx,
    companyId: string,
    page: number,
    perPage: number,
  ): Promise<{ rows: StatutoryRateWithUse[]; total: number }> {
    const where = StatutoryRatesRepository.live(companyId);
    const [rows, totals] = await Promise.all([
      tx
        .select({ ...getTableColumns(payrollStatutoryRates), inUse: IN_USE_EXISTS })
        .from(payrollStatutoryRates)
        .where(where)
        .orderBy(desc(payrollStatutoryRates.effectiveFrom))
        .limit(perPage)
        .offset((page - 1) * perPage),
      tx.select({ n: count() }).from(payrollStatutoryRates).where(where),
    ]);
    return { rows, total: Number(totals[0]?.n ?? 0) };
  }

  async findTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<PayrollStatutoryRate | null> {
    const q = tx
      .select()
      .from(payrollStatutoryRates)
      .where(and(StatutoryRatesRepository.live(companyId), eq(payrollStatutoryRates.id, id)))
      .limit(1);
    const [row] = opts.forUpdate ? await q.for("update") : await q;
    return row ?? null;
  }

  /** Cùng vị từ với `IN_USE_EXISTS`, cho một ngày hiệu lực bất kỳ (058 kiểm với `min(cũ, mới)`). */
  async inUseAtTx(tx: TenantTx, companyId: string, effectiveFrom: string): Promise<boolean> {
    const result = await tx.execute<{ in_use: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM payroll_periods pp
         WHERE pp.company_id = ${companyId}
           AND pp.deleted_at IS NULL
           AND pp.status NOT IN ('Draft', 'CollectingData')
           AND (to_date(pp.period_month, 'YYYY-MM') + interval '1 month' - interval '1 day')::date
               >= ${effectiveFrom}::date
      ) AS in_use`);
    return result.rows[0]?.in_use === true;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    w: Required<Omit<StatutoryRateWrite, "note">> & { note: string | null },
    actorUserId: string,
  ): Promise<PayrollStatutoryRate> {
    const [row] = await tx
      .insert(payrollStatutoryRates)
      .values({ companyId, ...w, createdBy: actorUserId, updatedBy: actorUserId })
      .returning();
    return row as PayrollStatutoryRate;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    w: StatutoryRateWrite,
    actorUserId: string,
  ): Promise<PayrollStatutoryRate | null> {
    const [row] = await tx
      .update(payrollStatutoryRates)
      .set({ ...w, updatedBy: actorUserId, updatedAt: sql`now()` })
      .where(and(StatutoryRatesRepository.live(companyId), eq(payrollStatutoryRates.id, id)))
      .returning();
    return row ?? null;
  }
}

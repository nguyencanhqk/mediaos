import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { payrollBudgets, type PayrollBudget } from "../db/schema/payroll-disbursement";
import type { PayrollBudgetRow } from "./payroll-disbursement.mapper";
import { fiscalYearRange, publishedPayslipsCte, rowsOf } from "./payroll-report.sql";

/**
 * S15-PAYROLL-BE-4 — `payroll_budgets` (DB-13 §14.4, mig 0572): ngân sách lương năm × đơn vị; `org_unit_id NULL` = toàn
 * công ty (unique `COALESCE(org_unit_id, sentinel)` — trùng NULL vẫn 23505 ⇒ 029).
 *
 * «THỰC HIỆN» (D-4) KHÔNG LƯU — tính LÚC GỌI ở `listTx`: Σ `payslips.gross` của kỳ `PUBLISHED_PERIOD_STATUSES` (qua
 * `publishedPayslipsCte` của `payroll-report.sql.ts` từ S15-PAYROLL-BE-5 — KHÔNG viết danh sách thứ hai) có `period_month` thuộc `fiscal_year`, gom theo
 * `employee_profiles.org_unit_id` HIỆN TẠI của chủ phiếu (hồ sơ sống, mới nhất — người chuyển phòng làm số năm cũ đổi chỗ;
 * DB-13 §14.4 chốt đọc lúc gọi, plan C12). Hàng toàn công ty = tổng MỌI phiếu. Chưa gồm phần BH doanh nghiệp.
 * BẤT BIẾN #1: mọi câu bind `company_id`; #2: xoá = `deleted_at`.
 */
@Injectable()
export class PayrollBudgetsRepository {
  private static scope(companyId: string) {
    return and(eq(payrollBudgets.companyId, companyId), isNull(payrollBudgets.deletedAt));
  }

  /**
   * Câu đọc DÙNG CHUNG của 073 và báo cáo `budget-status` (S15-PAYROLL-BE-5): hàng ngân sách năm (+ lọc đơn vị) kèm tên
   * đơn vị (sống), thực hiện, chênh lệch và tỉ lệ dùng — mọi phép tính ở SQL. «Thực hiện» đi qua `publishedPayslipsCte`
   * (MỘT định nghĩa với báo cáo/Tổng quan — plan BE-5 D-1).
   */
  static rowsSql(companyId: string, fiscalYear: number, orgUnitId: string | undefined) {
    return sql`
      with ${publishedPayslipsCte(companyId, fiscalYearRange(fiscalYear))},
      actual as (select org_unit_id, sum(gross) as gross from pub group by org_unit_id)
      select b.id, b.company_id, b.fiscal_year, b.org_unit_id, b.planned_amount, b.note,
             b.created_at, b.created_by, b.updated_at, b.updated_by, b.deleted_at, b.deleted_by,
             ou.name as org_unit_name, x.actual_amount,
             b.planned_amount - x.actual_amount as variance,
             case when b.planned_amount > 0 then round(x.actual_amount * 100 / b.planned_amount, 2) end as usage_pct
        from payroll_budgets b
        left join org_units ou on ou.company_id = b.company_id and ou.id = b.org_unit_id and ou.deleted_at is null
        cross join lateral (
          select coalesce(
                   case when b.org_unit_id is null
                        then (select sum(a.gross) from actual a)
                        else (select a.gross from actual a where a.org_unit_id = b.org_unit_id)
                   end, 0) as actual_amount
        ) x
       where b.company_id = ${companyId}::uuid
         and b.deleted_at is null
         and b.fiscal_year = ${fiscalYear}
         and ${orgUnitId ? sql`b.org_unit_id = ${orgUnitId}::uuid` : sql`true`}
       order by (b.org_unit_id is not null), ou.name nulls last, b.id`;
  }

  /** 073 — hàng ngân sách năm (+ lọc đơn vị) kèm tên đơn vị (sống) và thực hiện. Không phân trang (≤ vài chục hàng). */
  async listTx(
    tx: TenantTx,
    companyId: string,
    fiscalYear: number,
    orgUnitId: string | undefined,
  ): Promise<PayrollBudgetRow[]> {
    const res = await tx.execute<Record<string, unknown>>(
      PayrollBudgetsRepository.rowsSql(companyId, fiscalYear, orgUnitId),
    );
    return rowsOf<Record<string, unknown>>(res).map((r) => ({
      id: String(r["id"]),
      companyId: String(r["company_id"]),
      fiscalYear: Number(r["fiscal_year"]),
      orgUnitId: (r["org_unit_id"] as string | null) ?? null,
      plannedAmount: String(r["planned_amount"]),
      note: (r["note"] as string | null) ?? null,
      createdAt: r["created_at"] as Date,
      createdBy: (r["created_by"] as string | null) ?? null,
      updatedAt: r["updated_at"] as Date,
      updatedBy: (r["updated_by"] as string | null) ?? null,
      deletedAt: (r["deleted_at"] as Date | null) ?? null,
      deletedBy: (r["deleted_by"] as string | null) ?? null,
      orgUnitName: (r["org_unit_name"] as string | null) ?? null,
      actualAmount: String(r["actual_amount"] ?? "0"),
    }));
  }

  /** Báo cáo `budget-status` (081/082) — CÙNG câu với 073 (`rowsSql`), trả hàng thô kèm `variance`/`usage_pct`. */
  async reportRowsTx(
    tx: TenantTx,
    companyId: string,
    fiscalYear: number,
    orgUnitId: string | undefined,
  ): Promise<Record<string, unknown>[]> {
    const res = await tx.execute<Record<string, unknown>>(
      PayrollBudgetsRepository.rowsSql(companyId, fiscalYear, orgUnitId),
    );
    return rowsOf<Record<string, unknown>>(res);
  }

  /**
   * S15-PAYROLL-BE-5 (plan §0b B4) — tổng NĂM không cộng trùng hàng công ty với hàng đơn vị. Dùng cho hàng tổng của
   * báo cáo `budget-status` VÀ khối ngân sách của Tổng quan (078):
   *  · lọc đơn vị ⇒ hàng của đơn vị đó (kế hoạch NULL nếu chưa lập) và thực hiện của CHÍNH đơn vị đó;
   *  · có hàng toàn công ty ⇒ kế hoạch hàng đó, thực hiện Σ mọi phiếu;
   *  · chỉ có hàng đơn vị ⇒ Σ kế hoạch các đơn vị, thực hiện Σ trên CÙNG các đơn vị đó;
   *  · chưa lập gì ⇒ kế hoạch NULL, thực hiện Σ mọi phiếu.
   */
  async yearTotalsTx(
    tx: TenantTx,
    companyId: string,
    fiscalYear: number,
    orgUnitId: string | undefined,
  ): Promise<{
    plannedAmount: string | null;
    actualAmount: string;
    variance: string | null;
    usagePct: string | null;
  }> {
    const unit = orgUnitId ?? null;
    const res = await tx.execute<Record<string, unknown>>(sql`
      with ${publishedPayslipsCte(companyId, fiscalYearRange(fiscalYear))},
      actual as (select org_unit_id, sum(gross) as gross from pub group by org_unit_id),
      b as (
        select org_unit_id, planned_amount
          from payroll_budgets
         where company_id = ${companyId}::uuid and deleted_at is null and fiscal_year = ${fiscalYear}
      ),
      t as (
        select
          case
            when ${unit}::uuid is not null then (select planned_amount from b where org_unit_id = ${unit}::uuid)
            when exists (select 1 from b where org_unit_id is null) then (select planned_amount from b where org_unit_id is null)
            else (select sum(planned_amount) from b)
          end as planned,
          coalesce(
            case
              when ${unit}::uuid is not null then (select gross from actual where org_unit_id = ${unit}::uuid)
              when exists (select 1 from b where org_unit_id is null) or not exists (select 1 from b)
                then (select sum(gross) from actual)
              else (select sum(a.gross) from actual a where a.org_unit_id in (select org_unit_id from b))
            end, 0) as actual
      )
      select planned as planned_amount, actual as actual_amount, planned - actual as variance,
             case when planned > 0 then round(actual * 100 / planned, 2) end as usage_pct
        from t`);
    const [row] = rowsOf<Record<string, unknown>>(res);
    const planned = (row?.["planned_amount"] as string | null | undefined) ?? null;
    return {
      plannedAmount: planned,
      actualAmount: String(row?.["actual_amount"] ?? "0"),
      variance: (row?.["variance"] as string | null | undefined) ?? null,
      usagePct: (row?.["usage_pct"] as string | null | undefined) ?? null,
    };
  }

  async lockForUpdateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<PayrollBudget | null> {
    const [row] = await tx
      .select()
      .from(payrollBudgets)
      .where(and(PayrollBudgetsRepository.scope(companyId), eq(payrollBudgets.id, id)))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    input: {
      fiscalYear: number;
      orgUnitId: string | null;
      plannedAmount: number;
      note: string | null;
    },
    actorUserId: string,
  ): Promise<PayrollBudget> {
    const [row] = await tx
      .insert(payrollBudgets)
      .values({
        companyId,
        fiscalYear: input.fiscalYear,
        orgUnitId: input.orgUnitId,
        // numeric(18,2) — CHUỖI.
        plannedAmount: input.plannedAmount.toFixed(2),
        note: input.note,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: { plannedAmount?: number; note?: string | null },
    actorUserId: string,
  ): Promise<PayrollBudget | null> {
    const set: Record<string, unknown> = { updatedBy: actorUserId, updatedAt: new Date() };
    if (patch.plannedAmount !== undefined) set["plannedAmount"] = patch.plannedAmount.toFixed(2);
    if (patch.note !== undefined) set["note"] = patch.note;
    const [row] = await tx
      .update(payrollBudgets)
      .set(set)
      .where(and(PayrollBudgetsRepository.scope(companyId), eq(payrollBudgets.id, id)))
      .returning();
    return row ?? null;
  }

  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<PayrollBudget | null> {
    const [row] = await tx
      .update(payrollBudgets)
      .set({ deletedAt: new Date(), deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(PayrollBudgetsRepository.scope(companyId), eq(payrollBudgets.id, id)))
      .returning();
    return row ?? null;
  }
}

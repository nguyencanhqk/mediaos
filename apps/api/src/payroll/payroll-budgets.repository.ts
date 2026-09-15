import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { payrollBudgets, type PayrollBudget } from "../db/schema/payroll-disbursement";
import type { PayrollBudgetRow } from "./payroll-disbursement.mapper";
import { PUBLISHED_PERIOD_STATUSES } from "./payroll-payslips.repository";

const rowsOf = <T>(res: unknown): T[] =>
  ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as T[];

/**
 * S15-PAYROLL-BE-4 — `payroll_budgets` (DB-13 §14.4, mig 0572): ngân sách lương năm × đơn vị; `org_unit_id NULL` = toàn
 * công ty (unique `COALESCE(org_unit_id, sentinel)` — trùng NULL vẫn 23505 ⇒ 029).
 *
 * «THỰC HIỆN» (D-4) KHÔNG LƯU — tính LÚC GỌI ở `listTx`: Σ `payslips.gross` của kỳ `PUBLISHED_PERIOD_STATUSES` (import từ
 * `payroll-payslips.repository.ts` — KHÔNG viết danh sách thứ hai) có `period_month` thuộc `fiscal_year`, gom theo
 * `employee_profiles.org_unit_id` HIỆN TẠI của chủ phiếu (hồ sơ sống, mới nhất — người chuyển phòng làm số năm cũ đổi chỗ;
 * DB-13 §14.4 chốt đọc lúc gọi, plan C12). Hàng toàn công ty = tổng MỌI phiếu. Chưa gồm phần BH doanh nghiệp.
 * BẤT BIẾN #1: mọi câu bind `company_id`; #2: xoá = `deleted_at`.
 */
@Injectable()
export class PayrollBudgetsRepository {
  private static scope(companyId: string) {
    return and(eq(payrollBudgets.companyId, companyId), isNull(payrollBudgets.deletedAt));
  }

  /** 073 — hàng ngân sách năm (+ lọc đơn vị) kèm tên đơn vị (sống) và thực hiện. Không phân trang (≤ vài chục hàng). */
  async listTx(
    tx: TenantTx,
    companyId: string,
    fiscalYear: number,
    orgUnitId: string | undefined,
  ): Promise<PayrollBudgetRow[]> {
    const res = await tx.execute<Record<string, unknown>>(sql`
      with actual as (
        select ep.org_unit_id, sum(ps.gross) as gross
          from payslips ps
          join payroll_periods pp
            on pp.company_id = ps.company_id and pp.id = ps.payroll_period_id and pp.deleted_at is null
          left join lateral (
            select e.org_unit_id
              from employee_profiles e
             where e.company_id = ps.company_id and e.user_id = ps.user_id and e.deleted_at is null
             order by e.created_at desc
             limit 1
          ) ep on true
         where ps.company_id = ${companyId}::uuid
           and pp.status = any(${sql.param(PUBLISHED_PERIOD_STATUSES)}::text[])
           and left(pp.period_month, 4) = ${String(fiscalYear)}
         group by ep.org_unit_id
      )
      select b.id, b.company_id, b.fiscal_year, b.org_unit_id, b.planned_amount, b.note,
             b.created_at, b.created_by, b.updated_at, b.updated_by, b.deleted_at, b.deleted_by,
             ou.name as org_unit_name,
             coalesce(
               case when b.org_unit_id is null
                    then (select sum(a.gross) from actual a)
                    else (select a.gross from actual a where a.org_unit_id = b.org_unit_id)
               end, 0) as actual_amount
        from payroll_budgets b
        left join org_units ou on ou.company_id = b.company_id and ou.id = b.org_unit_id and ou.deleted_at is null
       where b.company_id = ${companyId}::uuid
         and b.deleted_at is null
         and b.fiscal_year = ${fiscalYear}
         and ${orgUnitId ? sql`b.org_unit_id = ${orgUnitId}::uuid` : sql`true`}
       order by (b.org_unit_id is not null), ou.name nulls last, b.id`);
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

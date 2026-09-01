import { Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { attendancePeriods } from "../db/schema/hr";
import { payrollPeriods, type PayrollPeriod } from "../db/schema/payroll";
import { TRAIL_RESET, type PeriodAction } from "./payroll-fsm";

export interface PeriodListFilter {
  status?: PayrollPeriodStatus[];
  periodMonth?: string;
  from?: string;
  to?: string;
}

/**
 * S13-PAYROLL-BE-1 — truy cập bảng `payroll_periods`.
 *
 * BẤT BIẾN #1: mọi câu bind `company_id` **tường minh** dù RLS + `withTenant` đã đỡ; mọi câu lọc
 * `deleted_at IS NULL` (soft delete — bất biến #2).
 *
 * ⚠️ Mig `0564` đã DROP trigger `payroll_period_status_guard` ⇒ DB **không** ép chuyển tiếp nữa. Mọi
 * hành động chạm trạng thái PHẢI đi qua `lockForUpdateTx` trước (row-lock), rồi `assertPeriodTransition`
 * ở service, rồi `applyTransitionTx` ở đây — ba bước, không tắt bước nào.
 */
@Injectable()
export class PayrollPeriodsRepository {
  private static scope(companyId: string) {
    return and(eq(payrollPeriods.companyId, companyId), isNull(payrollPeriods.deletedAt));
  }

  private static filterCond(companyId: string, f: PeriodListFilter) {
    const conds = [PayrollPeriodsRepository.scope(companyId)];
    if (f.status?.length) conds.push(inArray(payrollPeriods.status, f.status));
    if (f.periodMonth) conds.push(eq(payrollPeriods.periodMonth, f.periodMonth));
    // `from`/`to` là biên THÁNG so trên `period_month` (text 'YYYY-MM' — so chuỗi = so thời gian
    // vì định dạng zero-padded cố định, CHECK `payroll_periods_month_check` bảo đảm điều đó).
    if (f.from) conds.push(gte(payrollPeriods.periodMonth, f.from));
    if (f.to) conds.push(lte(payrollPeriods.periodMonth, f.to));
    return and(...conds);
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: PeriodListFilter,
    limit: number,
    offset: number,
  ): Promise<PayrollPeriod[]> {
    return tx
      .select()
      .from(payrollPeriods)
      .where(PayrollPeriodsRepository.filterCond(companyId, f))
      .orderBy(desc(payrollPeriods.periodMonth))
      .limit(limit)
      .offset(offset);
  }

  async countTx(tx: TenantTx, companyId: string, f: PeriodListFilter): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(payrollPeriods)
      .where(PayrollPeriodsRepository.filterCond(companyId, f));
    return Number(row?.n ?? 0);
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<PayrollPeriod | null> {
    const [row] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(PayrollPeriodsRepository.scope(companyId), eq(payrollPeriods.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * **Row-lock bắt buộc** cho MỌI hành động chạm trạng thái (SPEC-11 §13.1) — `collect` · `calculate` ·
   * `adjust-line` · `submit` · `approve` · `reject` · `generate-payslips` · `publish` · `lock` · `reopen`.
   * Thiếu lock trên `generate-payslips`/`reopen` là đường vào trạng thái KHÔNG THOÁT ĐƯỢC.
   */
  async lockForUpdateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<PayrollPeriod | null> {
    const [row] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(PayrollPeriodsRepository.scope(companyId), eq(payrollPeriods.id, id)))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    input: { periodMonth: string; attendancePeriodId: string | null; note: string | null },
    actorUserId: string,
  ): Promise<PayrollPeriod> {
    const [row] = await tx
      .insert(payrollPeriods)
      .values({
        companyId,
        periodMonth: input.periodMonth,
        attendancePeriodId: input.attendancePeriodId,
        note: input.note,
        status: "Draft",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row;
  }

  /** PATCH 004 — chỉ `attendance_period_id` + `note` (KHÔNG `status`: FSM đi qua route hành động). */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: { attendancePeriodId?: string; note?: string | null },
    actorUserId: string,
  ): Promise<PayrollPeriod | null> {
    const [row] = await tx
      .update(payrollPeriods)
      .set({ ...patch, updatedBy: actorUserId, updatedAt: new Date() })
      .where(and(PayrollPeriodsRepository.scope(companyId), eq(payrollPeriods.id, id)))
      .returning();
    return row ?? null;
  }

  /**
   * Áp một chuyển tiếp FSM: ghi `status` mới + **bảng RESET vết duyệt** (`TRAIL_RESET`) trong CÙNG một
   * câu UPDATE — không tách hai câu, kẻo giữa hai câu tồn tại một trạng thái vi phạm CHECK cặp.
   *
   * Gọi SAU `lockForUpdateTx` + `assertPeriodTransition`. `extra` dành cho cột riêng của hành động
   * (`reopen_reason`).
   */
  async applyTransitionTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    to: PayrollPeriodStatus,
    via: PeriodAction,
    actorUserId: string,
    extra: Partial<Record<"reopenReason", string>> = {},
  ): Promise<PayrollPeriod | null> {
    const trail = TRAIL_RESET[via];
    const patch: Record<string, unknown> = {
      status: to,
      updatedBy: actorUserId,
      updatedAt: new Date(),
      ...extra,
    };
    for (const col of trail.clear) {
      patch[`${col}By`] = null;
      patch[`${col}At`] = null;
    }
    const now = new Date();
    for (const col of trail.set) {
      patch[`${col}By`] = actorUserId;
      patch[`${col}At`] = now;
    }
    const [row] = await tx
      .update(payrollPeriods)
      .set(patch)
      .where(and(PayrollPeriodsRepository.scope(companyId), eq(payrollPeriods.id, id)))
      .returning();
    return row ?? null;
  }

  /**
   * Picker 035 — kỳ công để gắn vào kỳ lương. **BẮT BUỘC**: `payroll-officer` giữ 0 cặp ngoài PAYROLL
   * nên không gọi được `GET /attendance/periods` (gác `('read','attendance')`). Trường bó HẸP.
   */
  async pickAttendancePeriodsTx(
    tx: TenantTx,
    companyId: string,
    status: "open" | "locked" | undefined,
    limit: number,
  ) {
    const conds = [eq(attendancePeriods.companyId, companyId)];
    if (status) conds.push(eq(attendancePeriods.status, status));
    return tx
      .select({
        id: attendancePeriods.id,
        periodMonth: attendancePeriods.periodMonth,
        status: attendancePeriods.status,
      })
      .from(attendancePeriods)
      .where(and(...conds))
      .orderBy(desc(attendancePeriods.periodMonth))
      .limit(limit);
  }

  /** Kỳ công có thuộc company không — dùng khi gắn ở `create`/`update` (⇒ 404 sentinel nếu không). */
  async attendancePeriodExistsTx(
    tx: TenantTx,
    companyId: string,
    attendancePeriodId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: attendancePeriods.id })
      .from(attendancePeriods)
      .where(
        and(
          eq(attendancePeriods.companyId, companyId),
          eq(attendancePeriods.id, attendancePeriodId),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** Số dòng bảng lương nháp còn sống — `affectedLines` của envelope route GHI (KHÔNG phải số tiền). */
  async countLiveLinesTx(tx: TenantTx, companyId: string, periodId: string): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from payroll_period_lines
       where company_id = ${companyId}
         and payroll_period_id = ${periodId}
         and deleted_at is null
    `);
    const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
    return Number((list as { n: number }[])[0]?.n ?? 0);
  }

  /** Thứ tự ổn định cho danh sách kỳ khi cùng tháng (không dựa `created_at` — now() per-statement ties). */
  static readonly stableOrder = [desc(payrollPeriods.periodMonth), asc(payrollPeriods.id)];
}

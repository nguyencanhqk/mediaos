import { Injectable } from "@nestjs/common";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  attendancePeriods,
  attendanceRecords,
  payrollPeriods,
  payslipItems,
  payslips,
  salaryProfiles,
} from "../db/schema";

const PAYSLIP_COLUMNS = {
  id: payslips.id,
  companyId: payslips.companyId,
  payrollPeriodId: payslips.payrollPeriodId,
  userId: payslips.userId,
  salaryProfileId: payslips.salaryProfileId,
  baseSalary: payslips.baseSalary,
  totalAllowances: payslips.totalAllowances,
  gross: payslips.gross,
  net: payslips.net,
  currency: payslips.currency,
  workDays: payslips.workDays,
  presentDays: payslips.presentDays,
  lateMinutes: payslips.lateMinutes,
  kpiAmount: payslips.kpiAmount,
  bonusAmount: payslips.bonusAmount,
  penaltyAmount: payslips.penaltyAmount,
  entryKind: payslips.entryKind,
  replacesPayslipId: payslips.replacesPayslipId,
  createdBy: payslips.createdBy,
  createdAt: payslips.createdAt,
} as const;

export interface PayslipListFilters {
  payrollPeriodId?: string;
  userId?: string;
}

export interface PayslipInsertData {
  payrollPeriodId: string;
  userId: string;
  salaryProfileId: string | null;
  baseSalary: string;
  totalAllowances: string;
  gross: string;
  net: string;
  currency: string;
  workDays: string;
  presentDays: string;
  lateMinutes: number;
  entryKind?: string;
  replacesPayslipId?: string | null;
  createdBy: string;
}

export interface PayslipItemInsertData {
  payslipId: string;
  itemType: string;
  label: string;
  amount: string;
  meta?: unknown;
}

/** Active salary profile snapshot source (read-only feed). */
export interface ActiveSalaryProfileRow {
  id: string;
  userId: string;
  baseSalary: string;
  allowances: unknown;
  currency: string;
}

/**
 * PayslipRepository — APPEND-ONLY (BẤT BIẾN #2): CHỈ insert + select. KHÔNG update/delete method.
 * "Sửa" = insert entry_kind adjustment/void mới (service quyết). MỌI query qua tx (RLS) + eq(companyId).
 * Cũng đọc salary_profiles + attendance_records (G11) read-only để aggregate snapshot — TRONG cùng tenant.
 */
@Injectable()
export class PayslipRepository {
  // ── payslips (append-only) ──────────────────────────────────────────────────

  insertPayslipTx(tx: TenantTx, companyId: string, data: PayslipInsertData) {
    return tx
      .insert(payslips)
      .values({
        companyId,
        payrollPeriodId: data.payrollPeriodId,
        userId: data.userId,
        salaryProfileId: data.salaryProfileId,
        baseSalary: data.baseSalary,
        totalAllowances: data.totalAllowances,
        gross: data.gross,
        net: data.net,
        currency: data.currency,
        workDays: data.workDays,
        presentDays: data.presentDays,
        lateMinutes: data.lateMinutes,
        entryKind: data.entryKind ?? "original",
        replacesPayslipId: data.replacesPayslipId ?? null,
        createdBy: data.createdBy,
      })
      .returning(PAYSLIP_COLUMNS);
  }

  insertItemTx(tx: TenantTx, companyId: string, data: PayslipItemInsertData) {
    return tx
      .insert(payslipItems)
      .values({
        companyId,
        payslipId: data.payslipId,
        itemType: data.itemType,
        label: data.label,
        amount: data.amount,
        meta: (data.meta ?? null) as never,
      })
      .returning({ id: payslipItems.id });
  }

  async listTx(tx: TenantTx, companyId: string, filters: PayslipListFilters) {
    const conditions = [eq(payslips.companyId, companyId)];
    if (filters.payrollPeriodId)
      conditions.push(eq(payslips.payrollPeriodId, filters.payrollPeriodId));
    if (filters.userId) conditions.push(eq(payslips.userId, filters.userId));
    return await tx
      .select(PAYSLIP_COLUMNS)
      .from(payslips)
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
      .orderBy(payslips.createdAt);
  }

  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(PAYSLIP_COLUMNS)
      .from(payslips)
      .where(and(eq(payslips.companyId, companyId), eq(payslips.id, id)))
      .limit(1);
    return row;
  }

  /** Count existing original payslips for a (period, user) — idempotency guard against double-run. */
  async countForPeriodUserTx(
    tx: TenantTx,
    companyId: string,
    payrollPeriodId: string,
    userId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(payslips)
      .where(
        and(
          eq(payslips.companyId, companyId),
          eq(payslips.payrollPeriodId, payrollPeriodId),
          eq(payslips.userId, userId),
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** Read the payroll period + its linked attendance period status (BR lock gate), same tenant. */
  async findPeriodWithAttendanceLockTx(
    tx: TenantTx,
    companyId: string,
    payrollPeriodId: string,
  ): Promise<{
    id: string;
    periodMonth: string;
    status: string;
    attendancePeriodStatus: string | null;
  } | undefined> {
    const [row] = await tx
      .select({
        id: payrollPeriods.id,
        periodMonth: payrollPeriods.periodMonth,
        status: payrollPeriods.status,
        attendancePeriodStatus: attendancePeriods.status,
      })
      .from(payrollPeriods)
      .leftJoin(attendancePeriods, eq(payrollPeriods.attendancePeriodId, attendancePeriods.id))
      .where(
        and(
          eq(payrollPeriods.companyId, companyId),
          eq(payrollPeriods.id, payrollPeriodId),
          isNull(payrollPeriods.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  // ── read-only sources for the snapshot (same tenant via RLS) ──────────────────

  async listActiveSalaryProfilesTx(
    tx: TenantTx,
    companyId: string,
    userIds?: string[],
  ): Promise<ActiveSalaryProfileRow[]> {
    const conditions = [
      eq(salaryProfiles.companyId, companyId),
      isNull(salaryProfiles.deletedAt),
      eq(salaryProfiles.status, "active"),
    ];
    if (userIds && userIds.length > 0) {
      conditions.push(sql`${salaryProfiles.userId} = ANY(${userIds})`);
    }
    return await tx
      .select({
        id: salaryProfiles.id,
        userId: salaryProfiles.userId,
        baseSalary: salaryProfiles.baseSalary,
        allowances: salaryProfiles.allowances,
        currency: salaryProfiles.currency,
      })
      .from(salaryProfiles)
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])));
  }

  /** Aggregate attendance (G11) for a user in a 'YYYY-MM' period — read-only, same tenant. */
  async aggregateAttendanceTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    periodMonth: string,
  ): Promise<{ presentDays: number; lateMinutes: number }> {
    const [row] = await tx
      .select({
        presentDays: sql<string>`count(*) FILTER (WHERE ${attendanceRecords.checkInAt} IS NOT NULL)`,
        lateMinutes: sql<string>`coalesce(sum(${attendanceRecords.lateMinutes}), 0)`,
      })
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, companyId),
          eq(attendanceRecords.userId, userId),
          isNull(attendanceRecords.deletedAt),
          sql`to_char(${attendanceRecords.workDate}, 'YYYY-MM') = ${periodMonth}`,
        ),
      );
    return {
      presentDays: Number(row?.presentDays ?? 0),
      lateMinutes: Number(row?.lateMinutes ?? 0),
    };
  }
}

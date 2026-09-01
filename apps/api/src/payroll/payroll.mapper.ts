import type {
  Allowance,
  BonusPenaltyDto,
  PayrollPeriodDto,
  PayrollPeriodStatus,
  SalaryProfileDto,
  SalaryProfileListItemDto,
} from "@mediaos/contracts";
import type { BonusPenalty, PayrollPeriod, SalaryProfile } from "../db/schema/payroll";
import type { PayrollActor } from "./payroll.types";

/**
 * S13-PAYROLL-BE-1 — DTO + **MASKING Ở SERVER** (SPEC-11 §18, PAY-DEC-006 Phương án B).
 *
 * ⚠️ Biểu hiện của mask là **VẮNG KHOÁ** — không `null`, không `0`. Hai điều đó khác nhau sau
 * `JSON.stringify`: `{}` vs `{"baseSalary":null}`; cái sau vẫn nói cho client biết "trường này tồn
 * tại và bạn không được xem", và tệ hơn, FE khai `.optional()` sẽ nhận `null` là **giá trị**.
 * Spec assert `"baseSalary" in dto === false`, KHÔNG assert `=== undefined`.
 *
 * PAYROLL **không có DTO nửa-mask**: mọi route chở tiền gác bằng đúng một cặp chở-tiền, nên
 * `actor.canSeeMoney` trên route đó luôn `true`. Cờ tồn tại để route KHÔNG chở tiền (danh sách/chi
 * tiết kỳ — `view:payroll-period` cố ý `is_sensitive=false`) ép được `false` **kể cả** khi caller
 * tình cờ giữ `view-line`: số tiền không được đi qua cặp không nhạy cảm (SPEC-11 §11.1).
 */

/** `numeric` của pg về JS là CHUỖI — chuyển ở đúng biên DTO, không tính toán trên nó. */
const num = (v: string | number | null | undefined): number => Number(v ?? 0);

const iso = (v: Date | string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
};

/** Chỉ thêm khoá khi `cond` — đây là toàn bộ cơ chế mask. */
const when = <T extends object>(cond: boolean, obj: T): T | Record<string, never> =>
  cond ? obj : {};

export function toSalaryProfileDto(row: SalaryProfile, actor: PayrollActor): SalaryProfileDto {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    effectiveDate: String(row.effectiveDate),
    ...when(actor.canSeeMoney, {
      baseSalary: num(row.baseSalary),
      allowances: (row.allowances ?? []) as Allowance[],
    }),
    note: row.note,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  } as SalaryProfileDto;
}

export function toSalaryProfileListItem(
  row: SalaryProfile,
  actor: PayrollActor,
): SalaryProfileListItemDto {
  return {
    id: row.id,
    userId: row.userId,
    effectiveDate: String(row.effectiveDate),
    ...when(actor.canSeeMoney, {
      baseSalary: num(row.baseSalary),
      allowances: (row.allowances ?? []) as Allowance[],
    }),
  } as SalaryProfileListItemDto;
}

/**
 * DTO kỳ lương — **KHÔNG khoá tiền nào, kể cả tổng** (API-18 §6.1). Tổng chi phí kỳ đi qua
 * `GET /payroll-periods/summary` (018, BE-2) gác bằng cặp ĐỌC nhạy cảm `('view-line','payroll-period')`.
 * Vết duyệt (`calculatedBy`…) KHÔNG phải số tiền nên vẫn trả.
 */
export function toPayrollPeriodDto(row: PayrollPeriod): PayrollPeriodDto {
  return {
    id: row.id,
    companyId: row.companyId,
    periodMonth: row.periodMonth,
    status: row.status as PayrollPeriodStatus,
    payDate: row.payDate ? String(row.payDate) : null,
    attendancePeriodId: row.attendancePeriodId,
    note: row.note,
    reopenReason: row.reopenReason,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    calculatedBy: row.calculatedBy,
    calculatedAt: iso(row.calculatedAt),
    submittedBy: row.submittedBy,
    submittedAt: iso(row.submittedAt),
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    publishedBy: row.publishedBy,
    publishedAt: iso(row.publishedAt),
    lockedBy: row.lockedBy,
    lockedAt: iso(row.lockedAt),
    payslipsGeneratedBy: row.payslipsGeneratedBy,
    payslipsGeneratedAt: iso(row.payslipsGeneratedAt),
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  } as PayrollPeriodDto;
}

export function toBonusPenaltyDto(row: BonusPenalty, actor: PayrollActor): BonusPenaltyDto {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    kind: row.kind as BonusPenaltyDto["kind"],
    ...when(actor.canSeeMoney, { amount: num(row.amount) }),
    periodMonth: row.periodMonth,
    reason: row.reason,
    status: row.status as BonusPenaltyDto["status"],
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    payrollPeriodId: row.payrollPeriodId,
    consumedAt: iso(row.consumedAt),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  } as BonusPenaltyDto;
}

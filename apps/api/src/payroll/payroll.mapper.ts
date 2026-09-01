import type {
  Allowance,
  BonusPenaltyDto,
  PayrollPeriodDto,
  PayrollPeriodLineDto,
  PayrollPeriodStatus,
  PayrollSummaryDto,
  PayslipDerivedStatus,
  PayslipDetailDto,
  PayslipDto,
  PayslipItemDto,
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
// ════════════════════════════════════════════════════════════════════════════════════════════════
// S13-PAYROLL-BE-2 — dòng bảng lương · phiếu lương · breakdown · tổng kỳ
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Chốt FAIL-CLOSED cho 17 route BE-2 — **tất cả đều chở tiền** nên `canSeeMoney` phải luôn `true`
 * (route gác bằng đúng một cặp chở-tiền, `resolveActor` đã assert).
 *
 * Vì sao cần dù `when(...)` đã có: trên route chở tiền, nhánh strip của `when` là code **không cổng
 * nào chạm tới**. Nếu một WO sau vô tình thêm `routeKey` của BE-2 vào `MONEY_FREE_ROUTES`, hoặc đổi
 * cách tính cờ, thì cả module lặng lẽ trả DTO **rỗng khoá tiền** — FE hiện 0đ, không ai đỏ. Ném ở đây
 * biến sai-cấu-hình thành lỗi ồn thay vì bảng lương trắng.
 */
export function assertMoneyRoute(actor: PayrollActor): void {
  if (!actor.canSeeMoney) {
    throw new Error(
      `PayrollMapper: route '${actor.routeKey}' CHỞ TIỀN nhưng actor.canSeeMoney = false — ` +
        `cấu hình MONEY_FREE_ROUTES/PAYROLL_ROUTE_PAIRS lệch. KHÔNG trả DTO rỗng khoá tiền im lặng.`,
    );
  }
}

/** Hàng `payroll_period_lines` đọc thô (numeric là CHUỖI ở pg). */
interface RawLine {
  id: string;
  payroll_period_id: string;
  user_id: string;
  salary_profile_id: string | null;
  work_days: string;
  present_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
  late_minutes: number;
  base_amount: string;
  allowance_amount: string;
  bonus_amount: string;
  penalty_amount: string;
  deduction_amount: string;
  adjustment_amount: string;
  adjustment_reason: string | null;
  gross: string;
  net: string;
  created_at: Date | string;
  updated_at: Date | string;
}

/** 008 · 017 — dòng bảng lương nháp. Năm đại lượng NGÀY không phải tiền ⇒ luôn có mặt. */
export function toPayrollLineDto(row: RawLine, actor: PayrollActor): PayrollPeriodLineDto {
  assertMoneyRoute(actor);
  return {
    id: row.id,
    payrollPeriodId: row.payroll_period_id,
    userId: row.user_id,
    salaryProfileId: row.salary_profile_id,
    workDays: num(row.work_days),
    presentDays: num(row.present_days),
    paidLeaveDays: num(row.paid_leave_days),
    unpaidLeaveDays: num(row.unpaid_leave_days),
    lateMinutes: Number(row.late_minutes ?? 0),
    ...when(actor.canSeeMoney, {
      baseAmount: num(row.base_amount),
      allowanceAmount: num(row.allowance_amount),
      bonusAmount: num(row.bonus_amount),
      penaltyAmount: num(row.penalty_amount),
      deductionAmount: num(row.deduction_amount),
      adjustmentAmount: num(row.adjustment_amount),
      adjustmentReason: row.adjustment_reason,
      gross: num(row.gross),
      net: num(row.net),
    }),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
  } as PayrollPeriodLineDto;
}

interface RawSummary {
  payroll_period_id: string;
  period_month: string;
  status: string;
  headcount: number;
  total_gross: string;
  total_net: string;
}

/**
 * 018 — tổng chi phí kỳ. `totalGross`/`totalNet` là **`number`**, KHÔNG chuỗi.
 *
 * ⚠️ ĐẢO quyết định của API-18 §6.3 (ghi chú cũ bảo trả chuỗi) — quyết định 01/09/2026, plan D2: cả
 * module (dòng · phiếu · item · `num()`) dùng `number`; riêng `summary` dùng chuỗi thì FE mang HAI
 * cách đọc tiền trong cùng một màn. Tổng VND của một kỳ (~10^12) còn cách `MAX_SAFE_INTEGER` bốn bậc.
 * Chưa có consumer nào parse chuỗi (`S13-PAYROLL-FE-1` chưa tồn tại lúc đảo).
 */
export function toPayrollSummaryDto(row: RawSummary, actor: PayrollActor): PayrollSummaryDto {
  assertMoneyRoute(actor);
  return {
    payrollPeriodId: row.payroll_period_id,
    periodMonth: row.period_month,
    status: row.status as PayrollPeriodStatus,
    headcount: Number(row.headcount ?? 0),
    ...when(actor.canSeeMoney, {
      totalGross: num(row.total_gross),
      totalNet: num(row.total_net),
    }),
  } as PayrollSummaryDto;
}

/** Hàng `payslips` đọc thô + hai cột dẫn xuất ghép ở repository. */
interface RawPayslip {
  id: string;
  company_id: string;
  payroll_period_id: string;
  user_id: string;
  salary_profile_id: string | null;
  base_salary: string;
  total_allowances: string;
  bonus_amount: string;
  penalty_amount: string;
  deduction_amount: string;
  adjustment_amount: string;
  gross: string;
  net: string;
  work_days: string;
  present_days: string;
  paid_leave_days: string;
  unpaid_leave_days: string;
  late_minutes: number;
  created_by: string;
  created_at: Date | string;
  /** `payroll_periods.status` của kỳ — nguồn của trạng thái dẫn xuất. */
  period_status: string;
  /** `payslip_acknowledgements.created_at` của CHÍNH chủ phiếu; NULL = chưa xác nhận. */
  acknowledged_at: Date | string | null;
}

/**
 * Trạng thái phiếu là **DẪN XUẤT** (SPEC-11 §13.2) — không có cột, không có CHECK:
 *   kỳ `Paid`/`Locked` + đã ack ⇒ `Acknowledged` · kỳ `Paid`/`Locked` ⇒ `Published` ·
 *   kỳ chưa phát hành ⇒ `Generated`.
 *
 * Nhánh mặc định **fail-closed `null`** (schema `.nullable()`): trạng thái kỳ ngoài phổ đã biết thì
 * KHÔNG được đoán là `Published` — đoán sai chiều đó là nói với nhân viên rằng phiếu đã phát hành.
 */
export function derivePayslipStatus(
  periodStatus: string,
  acknowledgedAt: Date | string | null,
): PayslipDerivedStatus | null {
  if (periodStatus === "Paid" || periodStatus === "Locked") {
    return acknowledgedAt ? "Acknowledged" : "Published";
  }
  if (
    periodStatus === "Draft" ||
    periodStatus === "CollectingData" ||
    periodStatus === "Calculated" ||
    periodStatus === "Reviewing" ||
    periodStatus === "Approved"
  ) {
    return "Generated";
  }
  return null;
}

export function toPayslipDto(row: RawPayslip, actor: PayrollActor): PayslipDto {
  assertMoneyRoute(actor);
  return {
    id: row.id,
    companyId: row.company_id,
    payrollPeriodId: row.payroll_period_id,
    userId: row.user_id,
    salaryProfileId: row.salary_profile_id,
    status: derivePayslipStatus(row.period_status, row.acknowledged_at),
    ...when(actor.canSeeMoney, {
      baseSalary: num(row.base_salary),
      totalAllowances: num(row.total_allowances),
      bonusAmount: num(row.bonus_amount),
      penaltyAmount: num(row.penalty_amount),
      deductionAmount: num(row.deduction_amount),
      adjustmentAmount: num(row.adjustment_amount),
      gross: num(row.gross),
      net: num(row.net),
    }),
    workDays: num(row.work_days),
    presentDays: num(row.present_days),
    paidLeaveDays: num(row.paid_leave_days),
    unpaidLeaveDays: num(row.unpaid_leave_days),
    lateMinutes: Number(row.late_minutes ?? 0),
    createdBy: row.created_by,
    createdAt: iso(row.created_at) as string,
  } as PayslipDto;
}

interface RawPayslipItem {
  id: string;
  payslip_id: string;
  item_type: string;
  label: string;
  amount: string;
  sort_order: number;
  meta: Record<string, unknown> | null;
  created_at: Date | string;
}

/**
 * Dòng breakdown. `meta` (jsonb TỰ DO) đi **CÙNG CỔNG MASK** với `amount`: nó đứng ngay cạnh một
 * trường tiền đã che và rất dễ mang đơn giá/mức lương/hệ số — để nó bắt buộc là mở một kênh rò không
 * kiểm soát được.
 */
export function toPayslipItemDto(row: RawPayslipItem, actor: PayrollActor): PayslipItemDto {
  assertMoneyRoute(actor);
  return {
    id: row.id,
    payslipId: row.payslip_id,
    itemType: row.item_type as PayslipItemDto["itemType"],
    label: row.label,
    ...when(actor.canSeeMoney, {
      amount: num(row.amount),
      meta: row.meta,
    }),
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: iso(row.created_at) as string,
  } as PayslipItemDto;
}

export function toPayslipDetailDto(
  row: RawPayslip,
  items: readonly RawPayslipItem[],
  actor: PayrollActor,
): PayslipDetailDto {
  return {
    ...toPayslipDto(row, actor),
    items: items.map((i) => toPayslipItemDto(i, actor)),
    acknowledgedAt: iso(row.acknowledged_at),
  };
}

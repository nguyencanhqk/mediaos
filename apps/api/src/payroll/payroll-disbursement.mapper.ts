import type {
  PaymentBatchDto,
  PaymentLineDto,
  PayrollAdvanceDto,
  PayrollBudgetDto,
} from "@mediaos/contracts";
import type {
  PayrollAdvance,
  PayrollBudget,
  PayrollPaymentBatch,
  PayrollPaymentLine,
} from "../db/schema/payroll-disbursement";
import type { PayrollActor, PayrollPersonRef } from "./payroll.types";

/**
 * S15-PAYROLL-BE-4 — DTO track C + **MASKING Ở SERVER** (SPEC-11 §18, cùng khuôn `payroll.mapper.ts`):
 * biểu hiện của mask là **VẮNG KHOÁ** (spread có điều kiện `when(actor.canSeeMoney, …)`), không `null`, không `0`.
 *
 * 🔴 **Số tài khoản: chỉ `bankAccountLast4`, DẪN XUẤT từ SNAPSHOT của dòng chi** (`bank_account_snapshot` đóng băng lúc
 * lập đợt — KHÔNG phải settings hiện tại). Không hàm nào ở đây nhận/phát cột đầy đủ; bản đầy đủ chỉ rời server qua
 * tệp UNC (`PayrollPaymentExportService`, PAYROLL-API-071) + audit.
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

/** 4 ký tự cuối của snapshot; NULL/rỗng ⇒ `null`; ngắn hơn 4 ⇒ nguyên chuỗi (không đệm, không đoán). */
export function bankAccountLast4(snapshot: string | null | undefined): string | null {
  if (!snapshot) return null;
  return snapshot.length <= 4 ? snapshot : snapshot.slice(-4);
}

/**
 * Kỳ `Locked` DI SẢN (mig 0572, owner O-1 lối A): `paid_* := published_*` để CHECK `paid_pair` thoả — chưa hề có đợt
 * chi trả nào. FE/báo cáo KHÔNG được hiện «đã chi» cho kỳ như vậy (security DB-2 LOW-2). So BẰNG mốc thời gian (ms) VÀ
 * người: đợt chi thật luôn ghi `paid_at` SAU `published_at`, nên cùng mốc-cùng-người là dấu di sản.
 */
export function isLegacyPaidTrail(row: {
  paidAt: Date | string | null;
  paidBy: string | null;
  publishedAt: Date | string | null;
  publishedBy: string | null;
}): boolean {
  if (row.paidAt === null || row.paidBy === null) return false;
  if (row.publishedAt === null || row.publishedBy === null) return false;
  const ms = (v: Date | string) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
  return ms(row.paidAt) === ms(row.publishedAt) && row.paidBy === row.publishedBy;
}

export function toPayrollAdvanceDto(row: PayrollAdvance, actor: PayrollActor): PayrollAdvanceDto {
  return {
    id: row.id,
    companyId: row.companyId,
    userId: row.userId,
    ...when(actor.canSeeMoney, { amount: num(row.amount) }),
    deductPeriodMonth: row.deductPeriodMonth,
    reason: row.reason,
    status: row.status as PayrollAdvanceDto["status"],
    decidedBy: row.decidedBy,
    decidedAt: iso(row.decidedAt),
    decisionNote: row.decisionNote,
    payrollPeriodId: row.payrollPeriodId,
    consumedAt: iso(row.consumedAt),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  } as PayrollAdvanceDto;
}

/** Hàng đợt + ba số ĐẾM/TỔNG ghép ở câu đọc (`PayrollPaymentBatchesRepository.findWithStatsTx`/`listTx`). */
export interface PaymentBatchRow extends PayrollPaymentBatch {
  periodMonth: string;
  lineCount: number | string;
  paidLineCount: number | string;
  /** Σ `payslips.net` dòng sống — chuỗi numeric; `null` khi 0 dòng. */
  totalNet: string | number | null;
}

export function toPaymentBatchDto(row: PaymentBatchRow, actor: PayrollActor): PaymentBatchDto {
  return {
    id: row.id,
    payrollPeriodId: row.payrollPeriodId,
    periodMonth: row.periodMonth,
    code: row.code,
    method: row.method as PaymentBatchDto["method"],
    status: row.status as PaymentBatchDto["status"],
    payDate: row.payDate ? String(row.payDate) : null,
    note: row.note,
    lineCount: Number(row.lineCount ?? 0),
    paidLineCount: Number(row.paidLineCount ?? 0),
    ...when(actor.canSeeMoney, { totalNet: num(row.totalNet) }),
    createdBy: row.createdBy,
    createdAt: iso(row.createdAt) as string,
    completedBy: row.completedBy,
    completedAt: iso(row.completedAt),
    updatedAt: iso(row.updatedAt) as string,
  } as PaymentBatchDto;
}

/** Hàng dòng chi + `net` đọc từ `payslip_id` (một nguồn sự thật cho một khoản tiền). */
export interface PaymentLineRow extends PayrollPaymentLine {
  net: string | number;
}

export function toPaymentLineDto(
  row: PaymentLineRow,
  person: PayrollPersonRef | undefined,
  actor: PayrollActor,
): PaymentLineDto {
  return {
    id: row.id,
    userId: row.userId,
    employeeCode: person?.employeeCode ?? null,
    fullName: person?.displayName ?? null,
    payslipId: row.payslipId,
    ...when(actor.canSeeMoney, { net: num(row.net) }),
    bankAccountLast4: bankAccountLast4(row.bankAccountSnapshot),
    bankName: row.bankNameSnapshot,
    accountHolder: row.accountHolderSnapshot,
    paidAt: iso(row.paidAt),
    createdAt: iso(row.createdAt) as string,
  } as PaymentLineDto;
}

/** Hàng ngân sách + tên đơn vị + «thực hiện» tính LÚC GỌI (`PayrollBudgetsRepository.listTx`). */
export interface PayrollBudgetRow extends PayrollBudget {
  orgUnitName: string | null;
  actualAmount: string | number | null;
}

export function toPayrollBudgetDto(row: PayrollBudgetRow, actor: PayrollActor): PayrollBudgetDto {
  const planned = num(row.plannedAmount);
  const actual = num(row.actualAmount);
  return {
    id: row.id,
    fiscalYear: row.fiscalYear,
    orgUnitId: row.orgUnitId,
    orgUnitName: row.orgUnitName,
    ...when(actor.canSeeMoney, {
      plannedAmount: planned,
      actualAmount: actual,
      // Làm tròn 2 số để không rò sai số float (hai numeric(18,2) trừ nhau ở JS).
      variance: Math.round((planned - actual) * 100) / 100,
    }),
    note: row.note,
    createdAt: iso(row.createdAt) as string,
    updatedAt: iso(row.updatedAt) as string,
  } as PayrollBudgetDto;
}

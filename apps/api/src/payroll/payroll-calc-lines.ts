import type { SalaryComponentKind } from "@mediaos/contracts";
import type { PayrollStatutoryRate } from "../db/schema/payroll";
import { D, ZERO, type Dec } from "./formula/formula.decimal";
import { isFormulaError } from "./formula/formula.errors";
import { lineFingerprint } from "./formula/formula.fingerprint";
import { evaluateLine, type LineInput, type LineResult } from "./formula/formula.line";
import type { StatutoryValues } from "./formula/formula.statutory";
import { STATUTORY_REFS, SYS_REFS } from "./formula/formula.vocabulary";
import type {
  EffectiveProfileV2,
  LineParticipationRow,
} from "./payroll-calc-inputs.repository";
import type {
  PayrollLineWrite,
  PickedAdvance,
  PickedBonusPenalty,
} from "./payroll-calc.repository";
import type { UsableTemplate } from "./payroll-template-binding";
import type { TemplateComponentRow } from "./payroll-templates.repository";
import { formulaErrorToHttp } from "./payroll.errors";
import type { PayrollInputSnapshotMeta, PayrollUserInputs } from "./payroll.types";

/** Thứ chung cả kỳ — đọc/biên dịch MỘT lần trước vòng lặp dòng. */
export interface CalcLineContext {
  readonly usable: UsableTemplate;
  readonly formulaSetFingerprint: string;
  readonly rate: Pick<PayrollStatutoryRate, "id" | "effectiveFrom">;
  readonly statutory: StatutoryValues;
  readonly meta: PayrollInputSnapshotMeta;
}

/** Nguồn theo người — mọi `Map` đã đọc set-based ở service; ở đây KHÔNG truy vấn gì. */
export interface CalcLineSources {
  readonly userIds: readonly string[];
  readonly inputsByUser: ReadonlyMap<string, PayrollUserInputs>;
  readonly profiles: ReadonlyMap<string, EffectiveProfileV2>;
  readonly itemsByProfile: ReadonlyMap<string, Readonly<Record<string, string>>>;
  readonly participation: ReadonlyMap<string, LineParticipationRow>;
  readonly dependents: ReadonlyMap<string, number>;
  readonly picked: readonly PickedBonusPenalty[];
  readonly advances: readonly PickedAdvance[];
}

/** O-2 — vắng hàng `payroll_employee_settings` ⇒ cả hai cờ `false` (default cột DB). */
const NO_PARTICIPATION: LineParticipationRow = { socialInsurance: false, union: false };

/**
 * S15-PAYROLL-BE-3 — tầng service của máy tính lương: nguồn theo người → `LineInput` → `evaluateLine` (thuần) → hàng
 * ghi `payroll_period_lines` + snapshot `component_values_json` (plan §4.4 · §4.6).
 *
 * Tiền đi dạng CHUỖI scale 2 từ đầu tới câu SQL (`numeric` ép từ text — không qua số thực JSON). Ngày công là `number`
 * 2 chữ số thập phân từ `computeInputsTx` ⇒ `toFixed(2)` (khứ hồi double của chuỗi 2 chữ số là chính xác).
 * `FormulaError` của một dòng ⇒ 422 kèm `userId` — cả lượt tính rollback, 0 dòng được ghi.
 */
export function buildLineWrites(ctx: CalcLineContext, src: CalcLineSources): PayrollLineWrite[] {
  const bonus = sumByUser(src.picked.filter((p) => p.kind === "bonus"));
  const penalty = sumByUser(src.picked.filter((p) => p.kind === "penalty"));
  const advance = sumByUser(src.advances);
  const fingerprint = lineFingerprint(ctx.formulaSetFingerprint, ctx.rate.id);

  return src.userIds.map((userId) => {
    const profile = required(src.profiles.get(userId), "hồ sơ lương", userId);
    const days = required(src.inputsByUser.get(userId), "đầu vào công/phép", userId);
    const input: LineInput = {
      profile: {
        salaryType: profile.salaryType,
        baseSalary: profile.baseSalary,
        insuranceSalary: profile.insuranceSalary,
        probationSalary: profile.probationSalary,
        payRatioPct: profile.payRatioPct,
        pitPayer: profile.pitPayer,
      },
      days: {
        workDays: days.workDays.toFixed(2),
        presentDays: days.presentDays.toFixed(2),
        paidLeaveDays: days.paidLeaveDays.toFixed(2),
        unpaidLeaveDays: days.unpaidLeaveDays.toFixed(2),
        lateMinutes: String(days.lateMinutes),
      },
      profileItems: src.itemsByProfile.get(profile.id) ?? {},
      participation: src.participation.get(userId) ?? NO_PARTICIPATION,
      dependents: src.dependents.get(userId) ?? 0,
      bonusAmount: (bonus.get(userId) ?? ZERO).toFixed(2),
      penaltyAmount: (penalty.get(userId) ?? ZERO).toFixed(2),
      advanceAmount: (advance.get(userId) ?? ZERO).toFixed(2),
    };
    const result = evaluateOrThrow(ctx, input, userId);
    return {
      userId,
      salaryProfileId: profile.id,
      workDays: days.workDays,
      presentDays: days.presentDays,
      paidLeaveDays: days.paidLeaveDays,
      unpaidLeaveDays: days.unpaidLeaveDays,
      lateMinutes: days.lateMinutes,
      // Hình dạng v1 GIỮ NGUYÊN (meta §13.4 + `inputs`) — phiếu lương copy cột này.
      inputSnapshot: {
        ...ctx.meta,
        inputs: {
          user_id: userId,
          work_days: days.workDays,
          present_days: days.presentDays,
          paid_leave_days: days.paidLeaveDays,
          unpaid_leave_days: days.unpaidLeaveDays,
          late_minutes: days.lateMinutes,
        },
      },
      componentValues: snapshotOf(ctx, input, result),
      baseAmount: result.baseAmount.toFixed(2),
      allowanceAmount: result.allowanceAmount.toFixed(2),
      bonusAmount: result.bonusAmount.toFixed(2),
      penaltyAmount: result.penaltyAmount.toFixed(2),
      deductionAmount: result.deduction.toFixed(2),
      gross: result.gross.toFixed(2),
      templateFingerprint: fingerprint,
      grossUpIterations: result.grossUp?.iterations ?? null,
    };
  });
}

function evaluateOrThrow(ctx: CalcLineContext, input: LineInput, userId: string): LineResult {
  try {
    return evaluateLine(ctx.usable.graph, ctx.statutory, input);
  } catch (err) {
    if (isFormulaError(err)) throw formulaErrorToHttp(err, { userId });
    throw err;
  }
}

function sumByUser(rows: readonly { userId: string; amount: string }[]): Map<string, Dec> {
  const out = new Map<string, Dec>();
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? ZERO).plus(new D(r.amount)));
  return out;
}

/** Tập người đi vào đây DẪN XUẤT từ chính các `Map` này ở service — vắng là BUG ⇒ ném, KHÔNG coi là 0. */
function required<T>(value: T | undefined, what: string, userId: string): T {
  if (value === undefined) {
    throw new Error(`buildLineWrites: thiếu ${what} của nhân sự ${userId} — tập đủ điều kiện lệch nguồn đọc`);
  }
  return value;
}

/**
 * Snapshot `component_values_json` (plan §4.6) — đủ để GIẢI THÍCH một con số sau nhiều tháng mà KHÔNG cần mẫu/bản tỉ lệ
 * hiện tại (sửa công thức/tỉ lệ sau `Calculated` không đổi số). Mọi tiền là CHUỖI scale 2; khoá `components` là tín
 * hiệu «dòng v2» mà nhánh sinh phiếu đọc.
 */
function snapshotOf(ctx: CalcLineContext, input: LineInput, r: LineResult): Record<string, unknown> {
  const s = r.statutory;
  return {
    engine: "v2",
    templateId: ctx.usable.template.id,
    templateCode: ctx.usable.template.code,
    formulaSetFingerprint: ctx.formulaSetFingerprint,
    statutoryRateId: ctx.rate.id,
    statutoryEffectiveFrom: String(ctx.rate.effectiveFrom),
    salaryType: input.profile.salaryType,
    pitPayer: input.profile.pitPayer,
    participation: { ...input.participation },
    dependents: input.dependents,
    rates: Object.fromEntries(STATUTORY_REFS.map((k) => [k, s.refs[k].toFixed(2)])),
    caps: { BHXH: s.caps.BHXH.toFixed(2), BHYT: s.caps.BHYT.toFixed(2), BHTN: s.caps.BHTN.toFixed(2) },
    pitBrackets: s.pitBrackets.map((b) => ({
      upTo: b.upTo === null ? null : b.upTo.toFixed(2),
      rate: b.rate.toFixed(2),
    })),
    // `toFixed()` không tham số: ký hiệu thường, KHÔNG làm tròn (SYS_PRORATE mang scale 10).
    sys: Object.fromEntries(SYS_REFS.map((k) => [k, r.sys[k].toFixed()])),
    grossUp: r.grossUp
      ? {
          targetNet: r.grossUp.targetNet.toFixed(2),
          base: r.grossUp.base.toFixed(2),
          iterations: r.grossUp.iterations,
        }
      : null,
    components: ctx.usable.rows.map((row) => componentSnapshot(row, r.values)),
  };
}

function componentSnapshot(row: TemplateComponentRow, values: ReadonlyMap<string, Dec>) {
  const value = values.get(row.code);
  if (!value) {
    throw new Error(`buildLineWrites: thiếu giá trị thành phần ${row.code} — đồ thị và hàng mẫu lệch nhau`);
  }
  return {
    code: row.code,
    label: row.columnLabel ?? row.name,
    kind: row.kind as SalaryComponentKind,
    valueType: row.valueType,
    isVisible: row.isVisible,
    sortOrder: row.sortOrder,
    pitDeductible: row.pitDeductible,
    value: value.toFixed(2),
  };
}

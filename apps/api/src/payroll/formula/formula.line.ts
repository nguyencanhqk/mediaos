import { D, intermediate, ONE, toMoney, ZERO, type Dec } from "./formula.decimal";
import { FormulaError } from "./formula.errors";
import { Budget } from "./formula.evaluator";
import { evaluatePass, type CompiledGraph } from "./formula.graph";
import type { StatutoryValues } from "./formula.statutory";
import type { StatutoryRef, SysRef } from "./formula.vocabulary";

/**
 * S15-PAYROLL-BE-3 — máy tính MỘT dòng lương v2 (SPEC-11 §13.6 · §13.7 · §13.8 · plan §4.4–§4.6).
 *
 * THUẦN: không Nest, không DB, không đồng hồ. Service đọc đầu vào set-based cho CẢ kỳ rồi gọi `evaluateLine` từng dòng —
 * CẤM truy vấn trong vòng lặp dòng (NFR §19.1). Bảng đối soát tay: `docs/QA/evidence/S15-PAYROLL-BE-3-DOI-SOAT.md`.
 *
 * Luật tiền của file (census `payroll-formula-architecture-census`): số vào dạng CHUỖI numeric ⇒ `new D(str)`; không
 * `Number(`/`Math.`. `net` KHÔNG clamp ở đây — clamp là việc của câu SQL ghi dòng (`clamp-must-be-sql-not-js`).
 *
 * Quyết định owner 15/09/2026 đi vào code ở đây:
 *  - **O-2** không tham gia BH ⇒ 7 tỉ lệ BH/KPCĐ = 0; không đoàn viên ⇒ `TL_DOAN_PHI` = 0 (theo DÒNG, không đổi seed);
 *  - **O-4** gross-up lặp trên «công đủ» (công = chuẩn, nghỉ/trễ/thưởng/phạt/tạm ứng = 0, tỉ lệ hưởng 100) — NV đi làm
 *    nửa tháng KHÔNG lĩnh đủ NET; căn cứ BH vắng ⇒ `b`, không phải `N`.
 */

/** Trần vòng gross-up (§13.8) — khớp CHECK `payroll_period_lines_grossup_check` (0..30). */
export const GROSS_UP_MAX_ITERATIONS = 30;
/** Sai số hội tụ: `|N − F(b)| ≤ 1 đ`. */
export const GROSS_UP_TOLERANCE = ONE;

const HUNDRED = new D(100);

/** O-2 — KPCĐ gắn cờ BH (tính trên quỹ lương đóng BH), KHÔNG gắn cờ công đoàn (plan §3.3). */
export const SOCIAL_INSURANCE_RATE_REFS: readonly StatutoryRef[] = [
  "TL_BHXH_NV",
  "TL_BHYT_NV",
  "TL_BHTN_NV",
  "TL_BHXH_DN",
  "TL_BHYT_DN",
  "TL_BHTN_DN",
  "TL_KPCD",
];
export const UNION_RATE_REFS: readonly StatutoryRef[] = ["TL_DOAN_PHI"];

/** Hồ sơ lương hiệu lực — mọi số là chuỗi `numeric` từ driver. */
export interface LineProfile {
  readonly salaryType: "GROSS" | "NET";
  /** GROSS: lương cơ bản · NET: NET mục tiêu `N` (§13.8 — cột mang NET). */
  readonly baseSalary: string;
  readonly insuranceSalary: string | null;
  readonly probationSalary: string | null;
  readonly payRatioPct: string;
  readonly pitPayer: "EMPLOYEE" | "COMPANY";
}

/** Năm đại lượng công/phép (SPEC-11 §13.4) ở dạng CHUỖI scale 2 — service đổi `number` sang chuỗi ngoài `formula/`. */
export interface LineDays {
  readonly workDays: string;
  readonly presentDays: string;
  readonly paidLeaveDays: string;
  readonly unpaidLeaveDays: string;
  readonly lateMinutes: string;
}

export interface LineParticipation {
  readonly socialInsurance: boolean;
  readonly union: boolean;
}

export interface LineInput {
  readonly profile: LineProfile;
  readonly days: LineDays;
  /** `componentCode → amount` của item hồ sơ SỐNG + active. Mã ngoài mẫu đã bị service chặn (422 018) trước khi tới đây. */
  readonly profileItems: Readonly<Record<string, string>>;
  readonly participation: LineParticipation;
  /** Số NPT hiệu lực trong tháng — đếm theo NGƯỜI (`count(DISTINCT full_name)`, plan §3.9). */
  readonly dependents: number;
  readonly bonusAmount: string;
  readonly penaltyAmount: string;
  readonly advanceAmount: string;
}

export interface GrossUpResult {
  readonly targetNet: Dec;
  readonly base: Dec;
  readonly iterations: number;
}

export interface LineResult {
  /** Giá trị MỌI thành phần của mẫu (scale 2), kể cả ẩn — nguồn của snapshot `component_values_json`. */
  readonly values: ReadonlyMap<string, Dec>;
  /** `SYS_*` của lượt THẬT. */
  readonly sys: Readonly<Record<SysRef, Dec>>;
  /** Tỉ lệ luật định SAU khi zero theo tham gia (O-2). */
  readonly statutory: StatutoryValues;
  readonly grossUp: GrossUpResult | null;
  readonly gross: Dec;
  readonly deduction: Dec;
  /** Thông tin: lương cơ bản sau pro-rate (không phải nguồn của `gross`). */
  readonly baseAmount: Dec;
  readonly allowanceAmount: Dec;
  readonly bonusAmount: Dec;
  readonly penaltyAmount: Dec;
}

/** O-2 — object MỚI mỗi dòng; KHÔNG đột biến bản tỉ lệ dùng chung của kỳ. `caps`/`pitBrackets`/`GT_*` giữ nguyên. */
export function participationStatutory(
  base: StatutoryValues,
  participation: LineParticipation,
): StatutoryValues {
  const refs: Record<StatutoryRef, Dec> = { ...base.refs };
  if (!participation.socialInsurance) for (const k of SOCIAL_INSURANCE_RATE_REFS) refs[k] = ZERO;
  if (!participation.union) for (const k of UNION_RATE_REFS) refs[k] = ZERO;
  return { refs, caps: base.caps, pitBrackets: base.pitBrackets };
}

/**
 * `SYS_*` của một lượt. `full = true` ⇒ đầu vào «công đủ» của vòng gross-up (O-4); `false` ⇒ lượt THẬT.
 * `base` = lương cơ bản của lượt (GROSS: hồ sơ · NET: `b` đang lặp hoặc `b*`).
 */
export function lineSysInputs(input: LineInput, base: Dec, full: boolean): Record<SysRef, Dec> {
  const work = new D(input.days.workDays);
  if (work.lessThanOrEqualTo(ZERO)) {
    // Service chặn trước bằng 422 009 `no-work-days`; đây là phòng thủ chiều sâu — chia 0 KHÔNG được thành Infinity.
    throw new FormulaError("division-by-zero", "Kỳ lương không có ngày công chuẩn.", {
      component: "SYS_WORK_DAYS",
      reason: "work-days-zero",
    });
  }
  const probation =
    input.profile.probationSalary === null ? null : new D(input.profile.probationSalary);
  // §3.11 — COALESCE(probation_salary, insurance_salary, SYS_BASE_SALARY); NET vắng lương BH ⇒ `b` (O-4), không phải N.
  const insurance =
    probation ??
    (input.profile.insuranceSalary === null ? base : new D(input.profile.insuranceSalary));
  const present = full ? work : new D(input.days.presentDays);
  const unpaid = full ? ZERO : new D(input.days.unpaidLeaveDays);
  const prorate = intermediate(intermediate(present.plus(unpaid)).div(work));
  return {
    SYS_BASE_SALARY: base,
    SYS_INSURANCE_SALARY: insurance,
    SYS_PROBATION_SALARY: probation ?? ZERO,
    SYS_PAY_RATIO: full ? HUNDRED : new D(input.profile.payRatioPct),
    SYS_WORK_DAYS: work,
    SYS_PRESENT_DAYS: present,
    SYS_PAID_LEAVE_DAYS: full ? ZERO : new D(input.days.paidLeaveDays),
    SYS_UNPAID_LEAVE_DAYS: unpaid,
    SYS_LATE_MINUTES: full ? ZERO : new D(input.days.lateMinutes),
    SYS_PRORATE: prorate.greaterThan(ONE) ? ONE : prorate,
    SYS_DEPENDENTS: new D(input.dependents),
    SYS_DAILY_RATE: intermediate(base.div(work)),
    SYS_BONUS_AMOUNT: full ? ZERO : new D(input.bonusAmount),
    SYS_PENALTY_AMOUNT: full ? ZERO : new D(input.penaltyAmount),
    SYS_ADVANCE_AMOUNT: full ? ZERO : new D(input.advanceAmount),
  };
}

const profileItemsOf = (input: LineInput): Record<string, Dec> =>
  Object.fromEntries(Object.entries(input.profileItems).map(([k, v]) => [k, new D(v)]));

/** Nút tổng hợp bắt buộc — `compileGraph(requireEngineNodes)` đã bảo đảm có; vắng là BUG ⇒ ném, KHÔNG coi là 0. */
function need(values: ReadonlyMap<string, Dec>, code: "TONG_THU_NHAP" | "TONG_KHAU_TRU"): Dec {
  const v = values.get(code);
  if (!v) {
    throw new FormulaError("template-missing-engine-nodes", `Thiếu ${code} khi tính dòng lương.`, {
      component: code,
      missing: [code],
    });
  }
  return v;
}

const notConverged = (iterations: number, reason: "not-converged" | "non-positive-base") =>
  new FormulaError(
    "grossup-not-converged",
    reason === "not-converged"
      ? `Quy đổi lương NET không hội tụ sau ${iterations} vòng.`
      : `Quy đổi lương NET cho căn cứ lương không dương ở vòng ${iterations}.`,
    { iterations, reason },
  );

/**
 * §13.8 · O-4 — tìm `b*` sao cho `F(b*) = TONG_THU_NHAP − TONG_KHAU_TRU` (KHÔNG clamp, KHÔNG điều chỉnh tay) trên đầu
 * vào «công đủ» nằm trong ±1 đ của `N`. Mỗi vòng một `evaluatePass` trên CÙNG `budget` (hai trần đồng thời).
 */
export function grossUp(
  graph: CompiledGraph,
  statutory: StatutoryValues,
  input: LineInput,
  budget: Budget,
): GrossUpResult {
  const target = new D(input.profile.baseSalary);
  const profileItems = profileItemsOf(input);
  let b = target;
  for (let k = 1; k <= GROSS_UP_MAX_ITERATIONS; k++) {
    const values = evaluatePass(
      graph,
      {
        sys: lineSysInputs(input, b, true),
        profileItems,
        pitPayer: input.profile.pitPayer,
        statutory,
      },
      budget,
    );
    const gap = intermediate(
      target.minus(need(values, "TONG_THU_NHAP").minus(need(values, "TONG_KHAU_TRU"))),
    );
    if (gap.abs().lessThanOrEqualTo(GROSS_UP_TOLERANCE)) {
      return { targetNet: target, base: b, iterations: k };
    }
    // `b` luôn scale 2: N scale 2, gap là hiệu hai giá trị scale 2.
    b = toMoney(b.plus(gap));
    if (b.lessThanOrEqualTo(ZERO)) throw notConverged(k, "non-positive-base");
  }
  throw notConverged(GROSS_UP_MAX_ITERATIONS, "not-converged");
}

/** Lương cơ bản sau pro-rate — cùng THỨ TỰ phép với `LUONG_CO_BAN` (nhân tử số trước, chia MỘT lần, kẹp trần). */
function proratedBase(sys: Readonly<Record<SysRef, Dec>>): Dec {
  const base = sys.SYS_BASE_SALARY;
  const scaled = intermediate(
    intermediate(base.times(intermediate(sys.SYS_PRESENT_DAYS.plus(sys.SYS_UNPAID_LEAVE_DAYS)))).div(
      sys.SYS_WORK_DAYS,
    ),
  );
  return toMoney(scaled.greaterThan(base) ? base : scaled);
}

/**
 * Tính MỘT dòng: (NET ⇒ gross-up) → lượt THẬT → cổng tổng âm. Không đọc DB, không ghi gì; lỗi luôn là `FormulaError`
 * (service đổi sang 422 kèm `userId`).
 */
export function evaluateLine(
  graph: CompiledGraph,
  periodStatutory: StatutoryValues,
  input: LineInput,
  budget: Budget = new Budget(),
): LineResult {
  const statutory = participationStatutory(periodStatutory, input.participation);
  const gross_up =
    input.profile.salaryType === "NET" ? grossUp(graph, statutory, input, budget) : null;
  const base = gross_up ? gross_up.base : new D(input.profile.baseSalary);
  const sys = lineSysInputs(input, base, false);
  const profileItems = profileItemsOf(input);
  const values = evaluatePass(
    graph,
    { sys, profileItems, pitPayer: input.profile.pitPayer, statutory },
    budget,
  );

  const gross = need(values, "TONG_THU_NHAP");
  const deduction = need(values, "TONG_KHAU_TRU");
  // CHECK `payroll_period_lines_amounts_check` là lưới CUỐI — để nó bắn là 23514 ⇒ 500 ở vùng đỏ.
  for (const [code, v] of [
    ["TONG_THU_NHAP", gross],
    ["TONG_KHAU_TRU", deduction],
  ] as const) {
    if (v.lessThan(ZERO)) {
      throw new FormulaError("negative-total", `Giá trị ${code} của dòng lương âm.`, {
        component: code,
      });
    }
  }

  const allowance = Object.values(profileItems).reduce((acc, v) => acc.plus(v), ZERO);
  return {
    values,
    sys,
    statutory,
    grossUp: gross_up,
    gross,
    deduction,
    baseAmount: proratedBase(sys),
    allowanceAmount: toMoney(allowance),
    bonusAmount: toMoney(sys.SYS_BONUS_AMOUNT),
    penaltyAmount: toMoney(sys.SYS_PENALTY_AMOUNT),
  };
}

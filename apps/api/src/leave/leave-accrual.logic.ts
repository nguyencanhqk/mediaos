/**
 * S6-LEAVE-ACCRUAL-1 — LÕI THUẦN của engine cộng dồn phép (KHÔNG DB, KHÔNG Nest, KHÔNG `new Date()` ẩn).
 * Mọi ngày là chuỗi ISO `YYYY-MM-DD` và so sánh bằng so-sánh-chuỗi (ISO đã sắp thứ tự) — không đụng
 * timezone, đúng ADR-0008 UTC-at-rest và đúng kiểu `date` thuần của Postgres.
 *
 * Vì sao tách thuần: đây là chỗ QUYẾT ĐỊNH số ngày phép được cấp cho từng người (= quyền lợi có giá trị
 * tiền). Tách khỏi I/O để phủ được mọi ca biên bằng unit test không cần Postgres.
 *
 * Quy tắc nghiệp vụ (docs/plans/S6-LEAVE-ACCRUAL-1.md §3, chốt owner 2026-08-01):
 *   D-A1 chỉ cấp cho kỳ ĐÃ KẾT THÚC (ngày cuối kỳ < hôm nay) — tháng đang chạy KHÔNG cấp trước.
 *   D-A2 bù kỳ đã qua theo NGÀY VÀO LÀM từng người: chỉ tính kỳ nhân viên làm TRỌN.
 *   D-A4 bật/tắt THEO TỪNG chính sách qua `accrual_method`.
 */

/** Giá trị hợp lệ của `leave_policies.accrual_method` (CHECK chk_leave_policies_accrual_method). */
export const ACCRUAL_METHODS = ["None", "Monthly", "Yearly", "Manual", "Prorated"] as const;
export type AccrualMethod = (typeof ACCRUAL_METHODS)[number];

/** Phương thức engine THỰC SỰ cấp phép. `None`/`Manual` = engine không đụng vào (D-A4). */
export const ENGINE_ACCRUAL_METHODS: readonly AccrualMethod[] = ["Monthly", "Yearly", "Prorated"];

/** Nguồn sự thật DUY NHẤT cho câu hỏi "engine có chạy phương thức này không" (service + DTO cùng hỏi ở đây). */
export function isEngineAccrualMethod(method: string): boolean {
  return (ENGINE_ACCRUAL_METHODS as readonly string[]).includes(method);
}

/**
 * Cửa sổ ân hạn khi vắt qua giao thừa (plan §3.5). Sàn quét = 01/01 của năm chứa `hôm nay − 45 ngày`.
 *
 * · Thiếu nó: chạy lúc 00:00 ngày 01/01 chỉ xét "năm hiện tại" ⇒ MẤT tháng 12 năm cũ vĩnh viễn.
 * · Nới rộng (vd lấy `effective_from` = 2020 làm sàn): bù ngược 7 năm ⇒ nợ phép ảo khổng lồ.
 * 45 ngày = qua hết tháng 1 vẫn còn thấy tháng 12 năm cũ, nhưng không bao giờ chạm năm trước nữa.
 */
export const ACCRUAL_YEAR_GRACE_DAYS = 45;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AccrualPolicyInput {
  policyId: string;
  policyCode: string;
  leaveTypeId: string;
  accrualMethod: string;
  /** `numeric` từ Postgres về dạng chuỗi; NULL = chưa khai hạn mức. */
  yearlyQuotaDays: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AccrualEmployeeInput {
  employeeId: string;
  userId: string | null;
  employeeCode: string | null;
  startDate: string | null;
  endDate: string | null;
  /** `employee_profiles.status` — CHỮ THƯỜNG (CHECK emp_status_check). */
  status: string;
}

/** Trạng thái đã rời tổ chức — không còn tích luỹ phép sau ngày nghỉ (CHECK emp_status_check). */
export const TERMINAL_EMPLOYEE_STATUSES: readonly string[] = ["resigned", "terminated"];

/** Một kỳ cần cấp. `transactionDate` là KHOÁ idempotency ở DB (mig 0536) — xem `periodTransactionDate`. */
export interface AccrualPeriod {
  /** `2026-07` (tháng) hoặc `2026` (năm) — dùng cho `reason`/metadata, dễ đọc khi điều tra. */
  periodKey: string;
  year: number;
  transactionDate: string;
  amountDays: number;
}

export type AccrualSkipReason =
  | "METHOD_DISABLED"
  | "MISSING_QUOTA"
  | "MISSING_USER"
  | "MISSING_START_DATE"
  | "TERMINATED_WITHOUT_END_DATE";

export interface AccrualPlan {
  periods: AccrualPeriod[];
  /** Lý do KHÔNG cấp — luôn tường minh, KHÔNG bao giờ im lặng (đây là lỗi gốc WO đang vá). */
  skipReason: AccrualSkipReason | null;
}

// ─── Ngày tháng trên chuỗi ISO (không Date-local, không timezone) ──────────────────────────────

function assertIso(value: string, label: string): void {
  if (!ISO_DATE.test(value))
    throw new Error(`[leave.accrual] ${label} phải là YYYY-MM-DD, nhận "${value}"`);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`;
}

/** Số ngày của tháng (1..12) — `Date.UTC(y, m, 0)` = ngày cuối tháng m, đã đúng năm nhuận. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStart(year: number, month: number): string {
  return isoDate(year, month, 1);
}

export function monthEnd(year: number, month: number): string {
  return isoDate(year, month, lastDayOfMonth(year, month));
}

/** Cộng/trừ ngày trên lịch UTC rồi trả lại chuỗi ISO (chỉ dùng cho sàn cửa sổ). */
export function addDays(iso: string, days: number): string {
  assertIso(iso, "ngày");
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Sàn quét (plan §3.5): 01/01 của năm chứa `today − ACCRUAL_YEAR_GRACE_DAYS`. */
export function accrualFloorDate(today: string, graceDays = ACCRUAL_YEAR_GRACE_DAYS): string {
  const shifted = addDays(today, -graceDays);
  return isoDate(Number(shifted.slice(0, 4)), 1, 1);
}

// ─── Làm tròn theo MỐC CỘNG DỒN (plan §3.3 — chống lệch sổ cái ↔ số dư) ────────────────────────

/**
 * Làm tròn về 1 chữ số thập phân = độ chính xác của `leave_balances.total_days` (`numeric(5,1)`).
 * `+Number.EPSILON` để 1.0499999999999998 (sai số dấu phẩy động) không rơi xuống 1.0.
 */
export function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

/** Tổng ngày ĐÁNG LẼ đã cấp sau `months` tháng của năm (mốc cộng dồn). */
export function cumulativeTarget(quotaDays: number, months: number): number {
  return round1((quotaDays * months) / 12);
}

/**
 * Số ngày cấp cho tháng thứ `month` (1..12). Là HIỆU hai mốc, KHÔNG phải `quota/12`:
 * quota 15 ⇒ 1.3 · 1.2 · 1.3 … Σ12 tháng = 15.0 (chia đều rồi làm tròn sẽ ra 15.6 > quota).
 */
export function monthlyAccrualAmount(quotaDays: number, month: number): number {
  return round1(cumulativeTarget(quotaDays, month) - cumulativeTarget(quotaDays, month - 1));
}

// ─── Điều kiện & sinh kỳ ───────────────────────────────────────────────────────────────────────

function parseQuota(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Chính sách phủ TRỌN kỳ `[from, to]` (không cấp cho kỳ chỉ có hiệu lực một nửa). */
function policyCoversPeriod(policy: AccrualPolicyInput, from: string, to: string): boolean {
  if (from < policy.effectiveFrom) return false;
  return policy.effectiveTo === null || to <= policy.effectiveTo;
}

/**
 * Nhân viên làm TRỌN kỳ `[from, to]` (D-A2 + chặn `end_date`): vào làm trước/đúng ngày đầu kỳ VÀ chưa
 * nghỉ việc trước ngày cuối kỳ. `end_date` là chốt "data integrity" — thiếu nó thì người nghỉ việc từ
 * 2025 vẫn được cấp phép 2026 (đo PROD: 50/295 ngày là của người đã rời công ty).
 */
function employedThroughPeriod(employee: AccrualEmployeeInput, from: string, to: string): boolean {
  if (employee.startDate === null || employee.startDate > from) return false;
  return employee.endDate === null || employee.endDate >= to;
}

/** Số tháng nhân viên làm TRỌN trong năm `year` (dùng cho `Prorated`). */
export function fullMonthsInYear(employee: AccrualEmployeeInput, year: number): number {
  let count = 0;
  for (let m = 1; m <= 12; m += 1) {
    if (employedThroughPeriod(employee, monthStart(year, m), monthEnd(year, m))) count += 1;
  }
  return count;
}

export interface BuildAccrualPlanInput {
  policy: AccrualPolicyInput;
  employee: AccrualEmployeeInput;
  /** Hôm nay (ISO, UTC) — TRUYỀN VÀO, không đọc đồng hồ bên trong (test tái lập được). */
  today: string;
  graceDays?: number;
}

/**
 * Kỳ nào CẦN cấp cho 1 cặp (chính sách, nhân viên) tính đến `today`. Hàm này KHÔNG biết kỳ nào đã cấp
 * rồi — service lọc phần đã có trong sổ cái. Tách vậy để idempotency được chứng minh ở đúng nơi nó được
 * ép (DB + service) chứ không lẫn vào logic nghiệp vụ.
 */
export function buildAccrualPlan(input: BuildAccrualPlanInput): AccrualPlan {
  const { policy, employee, today } = input;
  assertIso(today, "today");
  const none: AccrualPlan = { periods: [], skipReason: null };

  const method = policy.accrualMethod as AccrualMethod;
  if (!isEngineAccrualMethod(method)) {
    return { periods: [], skipReason: "METHOD_DISABLED" };
  }
  const quota = parseQuota(policy.yearlyQuotaDays);
  if (quota === null) return { periods: [], skipReason: "MISSING_QUOTA" };
  // leave_balances.user_id NOT NULL ⇒ không có user thì không thể có dòng số dư.
  if (employee.userId === null) return { periods: [], skipReason: "MISSING_USER" };
  // KHÔNG suy đoán, KHÔNG mặc định 01/01 (done_when #4). HR điền xong → nhịp sau tự bù.
  if (employee.startDate === null) return { periods: [], skipReason: "MISSING_START_DATE" };
  // Đã nghỉ việc mà không có ngày nghỉ ⇒ KHÔNG biết dừng cộng dồn ở đâu. Cấp tiếp = cấp phép cho người
  // đã rời công ty (đúng lớp lỗi §1.1 F1); đoán ngày = bịa. Dừng lại và BÁO để HR điền `end_date`.
  if (TERMINAL_EMPLOYEE_STATUSES.includes(employee.status) && employee.endDate === null) {
    return { periods: [], skipReason: "TERMINATED_WITHOUT_END_DATE" };
  }

  const floor = accrualFloorDate(today, input.graceDays);
  const fromYear = Number(floor.slice(0, 4));
  const toYear = Number(today.slice(0, 4));
  const periods: AccrualPeriod[] = [];

  for (let year = fromYear; year <= toYear; year += 1) {
    if (method === "Monthly") {
      periods.push(...monthlyPeriods({ policy, employee, quota, year, today, floor }));
    } else {
      const period = yearlyPeriod({ policy, employee, quota, year, today, floor, method });
      if (period) periods.push(period);
    }
  }
  return periods.length > 0 ? { periods, skipReason: null } : none;
}

interface PeriodCtx {
  policy: AccrualPolicyInput;
  employee: AccrualEmployeeInput;
  quota: number;
  year: number;
  today: string;
  floor: string;
}

function monthlyPeriods(ctx: PeriodCtx): AccrualPeriod[] {
  const { policy, employee, quota, year, today, floor } = ctx;
  const out: AccrualPeriod[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const from = monthStart(year, month);
    const to = monthEnd(year, month);
    if (from < floor) continue;
    if (to >= today) continue; // D-A1: kỳ phải ĐÃ kết thúc
    if (!policyCoversPeriod(policy, from, to)) continue;
    if (!employedThroughPeriod(employee, from, to)) continue;
    const amountDays = monthlyAccrualAmount(quota, month);
    if (amountDays <= 0) continue;
    out.push({ periodKey: `${year}-${pad2(month)}`, year, transactionDate: to, amountDays });
  }
  return out;
}

/**
 * `Yearly`/`Prorated` — cấp TRƯỚC cho cả năm (cấp vào 31/12 thì vô dụng), ngày ghi sổ = 01/01 của năm.
 * 01/01 KHÔNG BAO GIỜ là ngày-cuối-tháng ⇒ không đụng khoá idempotency của nhánh `Monthly` kể cả khi HR
 * đổi `Monthly → Yearly` giữa năm (plan §3.4).
 *
 *   Yearly   — chỉ cho người đã vào làm TRƯỚC/ĐÚNG 01/01 năm đó; cấp trọn quota.
 *   Prorated — thêm người vào làm giữa năm: quota × (số tháng làm TRỌN / 12).
 *
 * ⚠️ HỆ QUẢ CỦA "CẤP TRƯỚC" (nói rõ, không giấu): người đang làm ngày 01/01 rồi nghỉ việc tháng 3 VẪN
 * nhận trọn quota năm — khác hẳn nhánh `Monthly` (chặn theo `end_date` từng tháng). Đó là bản chất của
 * cấp-trước-cả-năm, không phải sót điều kiện: phần thừa là việc của QUYẾT TOÁN khi thôi việc, không phải
 * việc của engine cộng dồn. Chọn `Monthly` nếu muốn quyền lợi bám sát thời gian làm việc thực tế.
 */
function yearlyPeriod(ctx: PeriodCtx & { method: AccrualMethod }): AccrualPeriod | null {
  const { policy, employee, quota, year, today, floor, method } = ctx;
  const from = monthStart(year, 1);
  const to = monthEnd(year, 12);
  if (from < floor) return null;
  if (from > today) return null; // năm chưa bắt đầu
  if (!policyCoversPeriod(policy, from, to)) return null;

  const startDate = employee.startDate as string;
  const employedAtYearStart =
    startDate <= from && (employee.endDate === null || employee.endDate >= from);
  let amountDays: number;
  if (employedAtYearStart) {
    amountDays = round1(quota);
  } else if (method === "Prorated" && startDate <= today && startDate <= to) {
    amountDays = round1((quota * fullMonthsInYear(employee, year)) / 12);
  } else {
    return null;
  }
  if (amountDays <= 0) return null;
  return { periodKey: String(year), year, transactionDate: from, amountDays };
}

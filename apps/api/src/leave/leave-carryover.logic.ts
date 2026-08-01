/**
 * S6-LEAVE-CARRYOVER-1 — LÕI THUẦN của engine chuyển tiếp + hết hạn phép (KHÔNG DB, KHÔNG Nest, KHÔNG
 * `new Date()` ẩn). Mọi ngày là chuỗi ISO `YYYY-MM-DD`, so sánh bằng so-sánh-chuỗi (ISO đã sắp thứ tự) —
 * không đụng timezone, đúng ADR-0008 UTC-at-rest và đúng kiểu `date` thuần của Postgres.
 *
 * Vì sao tách thuần: đây là chỗ QUYẾT ĐỊNH số ngày phép được chuyển sang năm sau và số ngày bị XOÁ khi hết
 * hạn — quyền lợi có giá trị tiền, và hướng "xoá" thì không có đường hoàn tác (sổ cái append-only). Tách
 * khỏi I/O để phủ được mọi ca biên bằng unit test không cần Postgres.
 *
 * Quy tắc nghiệp vụ: docs/plans/S6-LEAVE-CARRYOVER-1.md §3 (owner D-A3 2026-08-01).
 * BA điều dễ làm sai nhất, đều đã có unit test neo lại:
 *   1. `pending_days` PHẢI bị loại khỏi phần chuyển — không thì duyệt đơn sau đó vỡ CHECK ở tầng DB (F3).
 *   2. Chuyển chỉ mở từ MỐC CHỐT SỔ 01/02, không phải 01/01 — tháng 1 còn phải nhập đơn lùi ngày (F7).
 *   3. Ngày được chuyển vào SAU mốc hết hạn thì mốc đó KHÔNG áp dụng — không thì bật công tắc muộn sẽ
 *      xoá sạch phép vừa chuyển trong 60 giây.
 */

/**
 * Mốc CHỐT SỔ năm cũ: 01/02 của năm mới (F7). Tháng 1 để trống cho HR nhập nốt đơn nghỉ tháng 12 —
 * đường đặt đơn đọc dòng số dư theo `yearOf(startDate)` nên ghi nợ năm cũ quá sớm sẽ đẻ 422 oan.
 *
 * 31 ngày ân hạn KHÔNG tuỳ tiện: nó nằm gọn trong `ACCRUAL_YEAR_GRACE_DAYS = 45` của engine cộng dồn, nên
 * tại thời điểm chốt sổ, accrual vẫn còn thẩm quyền cấp bù cho năm cũ ⇒ hai engine không đá nhau.
 */
export const CARRYOVER_SETTLEMENT_MONTH = 2;
export const CARRYOVER_SETTLEMENT_DAY = 1;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CarryoverPolicyInput {
  policyId: string;
  policyCode: string;
  leaveTypeId: string;
  allowCarryForward: boolean;
  /** `numeric` từ Postgres về dạng chuỗi. NULL CÓ NGHĨA: **không trần** (owner D-A3). */
  maxCarryForwardDays: string | null;
  expiryMonth: number;
  expiryDay: number;
  /**
   * `false` ⇒ đường duyệt đơn KHÔNG cập nhật `used_days`/`pending_days`
   * (`leave-request.service.ts` trả `"None"`, `leave-approval.service.ts` chỉ quy đổi khi `Reserved`)
   * ⇒ con số "khả dụng" không đáng tin ⇒ engine DỪNG và BÁO, không đoán.
   */
  reserveBalanceOnPending: boolean;
}

export interface CarryoverBalanceInput {
  balanceId: string;
  /** `leave_balances.year` (khoá duy nhất cùng company/user/leave_type). */
  year: number;
  totalDays: string;
  /** Bốn cột dưới đây NULLABLE và **NULL trên mọi dòng `ensureBalanceTx` vừa tạo** ⇒ luôn qua `num()`. */
  usedDays: string | null;
  pendingDays: string | null;
  carriedOverDays: string | null;
  expiredDays: string | null;
}

export interface CarryoverEmployeeInput {
  employeeId: string;
  userId: string | null;
  employeeCode: string | null;
  endDate: string | null;
}

export type CarryoverSkipReason =
  | "BEFORE_SETTLEMENT"
  | "NOTHING_TO_CARRY"
  | "EMPLOYEE_LEFT"
  | "MISSING_EMPLOYEE"
  | "RESERVE_DISABLED"
  | "ACCRUAL_PENDING"
  | "CARRIED_AFTER_DEADLINE"
  | "CARRIED_NO_LEDGER"
  | "CAP_EXHAUSTED"
  | "ALREADY_WROTE_TODAY";

export interface CarryoverAmountPlan {
  amountDays: number;
  /** Lý do KHÔNG xử lý — luôn tường minh. `null` + `amountDays = 0` = "không có gì để làm, bình thường". */
  skipReason: CarryoverSkipReason | null;
}

// ─── Ngày tháng trên chuỗi ISO (không Date-local, không timezone) ──────────────────────────────

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

/**
 * Mốc hết hạn THẬT của một năm. Cặp (tháng, ngày) trong chính sách LẶP theo năm; ngày vượt số ngày của
 * tháng bị cắt về ngày cuối tháng — 29/02 ở năm không nhuận → 28/02. DTO đã chặn cặp vô nghĩa (31/02,
 * 31/04) ở biên nhập liệu; hàm này là lưới an toàn cho dữ liệu cũ và cho ca 29/02 hợp lệ.
 */
export function expiryDateFor(year: number, month: number, day: number): string {
  const safeMonth = Math.min(Math.max(Math.trunc(month), 1), 12);
  const safeDay = Math.min(Math.max(Math.trunc(day), 1), lastDayOfMonth(year, safeMonth));
  return isoDate(year, safeMonth, safeDay);
}

/** Mốc chốt sổ của năm nguồn `sourceYear` = 01/02 của năm kế tiếp. */
export function carryoverSettlementDate(sourceYear: number): string {
  return isoDate(sourceYear + 1, CARRYOVER_SETTLEMENT_MONTH, CARRYOVER_SETTLEMENT_DAY);
}

// ─── Số học tiền-phép ─────────────────────────────────────────────────────────────────────────

/**
 * Làm tròn XUỐNG 1 chữ số thập phân = độ chính xác của `leave_balances.total_days` (`numeric(5,1)`).
 *
 * Vì sao XUỐNG chứ không phải làm tròn gần nhất: số vào có thể lẻ 2 chữ số (`max_carry_forward_days` và
 * `pending_days` đều là `numeric(8,2)`). Làm tròn LÊN sẽ ghi nợ nhiều hơn phần thật sự khả dụng ⇒ vỡ
 * ràng buộc số ngày ở tầng DB (hoặc tệ hơn: vỡ CHECK `used_days <= total_days`). Phần lẻ ≤ 0.05 ngày ở
 * lại chỗ cũ, vẫn nằm trong sổ, không mất đi đâu.
 *
 * `+1e-9` để 7.199999999999999 (sai số dấu phẩy động của 7.2) không rơi xuống 7.1.
 */
export function floor1(value: number): number {
  return Math.floor(value * 10 + 1e-9) / 10;
}

/** `numeric` NULL từ Postgres ⇒ 0. Thiếu chỗ này thì `x − NULL = NULL` nuốt cả phép tính trong im lặng. */
export function num(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Phần còn khả dụng THẬT của một dòng số dư (F3: `pending` đã giữ chỗ, không được đem chuyển/xoá). */
export function availableDays(balance: CarryoverBalanceInput): number {
  return num(balance.totalDays) - num(balance.usedDays) - num(balance.pendingDays);
}

// ─── Chuyển tiếp ──────────────────────────────────────────────────────────────────────────────

export interface BuildCarryPlanInput {
  policy: CarryoverPolicyInput;
  /** Dòng số dư NĂM NGUỒN (năm cũ). */
  balance: CarryoverBalanceInput;
  employee: CarryoverEmployeeInput;
  /** Hôm nay (ISO, UTC) — TRUYỀN VÀO, không đọc đồng hồ bên trong (test tái lập được). */
  today: string;
  /** Tổng số ngày ĐÃ chuyển khỏi chính dòng này (từ sổ cái) — trần phải trừ phần này. */
  alreadyCarriedDays: number;
  /** Ngày ghi CARRY_OVER gần nhất trên chính dòng này; `= today` ⇒ hôm nay đã ghi rồi (xem §3.2c). */
  lastCarryTxDate?: string | null;
}

/**
 * Số ngày được chuyển khỏi dòng số dư năm cũ tại `today`. KHÔNG biết đã ghi sổ hay chưa ngoài
 * `alreadyCarriedDays` — service đọc sổ cái và truyền vào; repository ép lại cận trên ở tầng DB.
 */
export function buildCarryPlan(input: BuildCarryPlanInput): CarryoverAmountPlan {
  const { policy, balance, employee, today, alreadyCarriedDays, lastCarryTxDate } = input;
  assertIso(today, "today");
  const none: CarryoverAmountPlan = { amountDays: 0, skipReason: null };

  // Công tắc tắt = lựa chọn của HR (giống `None`/`Manual` của accrual), KHÔNG phải lỗi ⇒ không báo lý do,
  // nếu không mỗi nhịp sẽ đẻ vài chục dòng nhiễu che mất lý do thật.
  if (!policy.allowCarryForward) return none;
  if (employee.userId === null) return { amountDays: 0, skipReason: "MISSING_EMPLOYEE" };

  // F7 — chưa chốt sổ thì chưa đụng vào số dư năm cũ. Trạng thái BÌNH THƯỜNG suốt tháng 1.
  if (today < carryoverSettlementDate(balance.year)) {
    return { amountDays: 0, skipReason: "BEFORE_SETTLEMENT" };
  }
  // Rời công ty trước khi năm mới bắt đầu ⇒ chuyển tiếp là dựng quyền lợi cho người không còn làm việc.
  // Phần chưa nghỉ của họ thuộc QUYẾT TOÁN THÔI VIỆC, không phải việc của engine.
  if (employee.endDate !== null && employee.endDate < isoDate(balance.year + 1, 1, 1)) {
    return { amountDays: 0, skipReason: "EMPLOYEE_LEFT" };
  }
  // `used_days`/`pending_days` không được đường duyệt đơn cập nhật ⇒ "khả dụng" là số ảo. Dừng và BÁO.
  if (!policy.reserveBalanceOnPending) {
    return { amountDays: 0, skipReason: "RESERVE_DISABLED" };
  }

  const available = availableDays(balance);
  if (available <= 0) return { amountDays: 0, skipReason: "NOTHING_TO_CARRY" };

  const capRaw = policy.maxCarryForwardDays;
  const remainingCap =
    capRaw === null ? Number.POSITIVE_INFINITY : Math.max(0, num(capRaw) - alreadyCarriedDays);
  const amountDays = floor1(Math.min(available, remainingCap));
  // Trần đã dùng hết mà người ta VẪN còn ngày khả dụng — phải NÓI RA. Trả 0 lặng lẽ thì không ai phân
  // biệt được "không còn gì để chuyển" với "còn nhưng chính sách chặn", mà hai cái đó cần hành động khác
  // nhau (cái sau là câu hỏi cho HR: trần đặt đúng chưa).
  if (amountDays <= 0) return { amountDays: 0, skipReason: "CAP_EXHAUSTED" };

  // Sổ cái cho ĐÚNG MỘT dòng CARRY_OVER mỗi dòng-số-dư mỗi ngày (`uq_..._carryover_daily`, mig 0537).
  // Số khả dụng tăng lại NGAY TRONG NGÀY (HR từ chối đơn / điều chỉnh sau khi engine đã chạy sáng nay) là
  // chuyện thường; nếu cứ lên kế hoạch thì mỗi nhịp 60s sẽ đâm unique tới nửa đêm UTC — SAVEPOINT rollback
  // nên KHÔNG mất ngày phép nào, nhưng đẻ ~1440 run 'Failed' + 1440 dòng ERROR mỗi ngày, tức là giết phần
  // PHÁT HIỆN. Hoãn tới hôm sau: engine ghi bù ở nhịp đầu tiên của ngày mới, không mất gì.
  if (lastCarryTxDate != null && lastCarryTxDate >= today) {
    return { amountDays: 0, skipReason: "ALREADY_WROTE_TODAY" };
  }
  return { amountDays, skipReason: null };
}

// ─── Hết hạn ──────────────────────────────────────────────────────────────────────────────────

export interface BuildExpirePlanInput {
  policy: CarryoverPolicyInput;
  /** Dòng số dư ĐANG GIỮ phần chuyển tiếp (năm mới). */
  balance: CarryoverBalanceInput;
  today: string;
  /**
   * MỌI dòng ghi CÓ của CARRY_OVER trên chính dòng số dư này (ngày + số ngày).
   *
   * Vì sao phải là CẢ DANH SÁCH chứ không phải "ngày ghi có gần nhất": mốc hết hạn chỉ áp dụng cho phần
   * được chuyển vào TRƯỚC mốc. Rút gọn thành `MAX(ngày)` thì MỘT dòng ghi có sau mốc sẽ miễn nhiễm cho
   * TOÀN BỘ dòng số dư, VĨNH VIỄN — kể cả 12 ngày đã nằm đó từ tháng 2 và lẽ ra phải hết hạn ngày 31/03.
   */
  carryCredits: { transactionDate: string; amountDays: number }[];
  /** Ngày ghi EXPIRE gần nhất trên chính dòng này (cùng lý do chống-đâm-khoá như bên chuyển tiếp). */
  lastExpireTxDate?: string | null;
}

/**
 * Số ngày hết hạn tại `today`. FIFO — phần chuyển tiếp được TIÊU TRƯỚC (giả định của plan §3.5, có lợi
 * cho người lao động và là thông lệ: ngày sắp hết hạn thì dùng trước). LIFO sẽ làm hết hạn NHIỀU HƠN trên
 * cùng dữ liệu; đó là quyết định chính sách, không phải kỹ thuật ⇒ để owner lật (plan §9).
 *
 * KHÔNG phụ thuộc `allow_carry_forward`: tắt công tắc SAU khi đã chuyển mà cũng tắt luôn hết hạn thì số
 * ngày đó sống mãi.
 */
export function buildExpirePlan(input: BuildExpirePlanInput): CarryoverAmountPlan {
  const { policy, balance, today, carryCredits, lastExpireTxDate } = input;
  assertIso(today, "today");
  const none: CarryoverAmountPlan = { amountDays: 0, skipReason: null };

  const deadline = expiryDateFor(balance.year, policy.expiryMonth, policy.expiryDay);
  // "Hạn dùng" = dùng được HẾT ngày đó ⇒ chỉ hết hạn từ ngày kế tiếp.
  if (today <= deadline) return none;

  // Chỉ phần được chuyển vào TRƯỚC/ĐÚNG mốc mới thuộc diện hết hạn theo mốc đó. Ngày chuyển vào SAU mốc
  // chưa từng có cơ hội được dùng trong hạn ⇒ mốc năm nay không áp dụng cho chúng (chống ca: owner bật
  // công tắc ngày 01/06, nhịp sau xoá sạch 12 ngày vừa chuyển, không hoàn tác được vì sổ append-only).
  let pool = 0;
  for (const c of carryCredits) if (c.transactionDate <= deadline) pool += c.amountDays;

  const carriedNet = num(balance.carriedOverDays) - num(balance.expiredDays);
  if (carryCredits.length === 0) {
    // Có `carried_over_days` nhưng KHÔNG một dòng CARRY_OVER nào trong sổ (nhập liệu tay, import,
    // backfill, hay IMPORT/SYSTEM_RECALCULATE có sẵn trong CHECK union) ⇒ engine KHÔNG biết những ngày đó
    // được ghi có lúc nào, nên không biết mốc nào áp dụng. Đoán = xoá nhầm quyền lợi vĩnh viễn. Dừng và
    // BÁO — bỏ qua trong im lặng thì số ngày đó sống mãi mà không ai biết.
    return carriedNet > 0 ? { amountDays: 0, skipReason: "CARRIED_NO_LEDGER" } : none;
  }
  if (pool <= 0) {
    // Có ghi có, nhưng TẤT CẢ đều sau mốc ⇒ không có gì thuộc diện hết hạn kỳ này (không phải lỗi).
    return carriedNet > 0 ? { amountDays: 0, skipReason: "CARRIED_AFTER_DEADLINE" } : none;
  }

  // FIFO: phần chuyển tiếp được tiêu trước. Trừ phần đã hết hạn + đã dùng + đang giữ chỗ.
  const carriedLeft =
    pool - num(balance.expiredDays) - num(balance.usedDays) - num(balance.pendingDays);
  // Cận trên thứ hai: không bao giờ đẩy `total_days` xuống dưới `used + pending`
  // (giữ CẢ HAI CHECK `leave_bal_used_check` và `leave_bal_total_check`).
  const amountDays = floor1(Math.max(0, Math.min(carriedLeft, availableDays(balance))));
  if (amountDays <= 0) return none;
  // Cùng lý do chống-đâm-khoá như bên chuyển tiếp: `uq_..._expire_daily` cho ĐÚNG một dòng/ngày.
  if (lastExpireTxDate != null && lastExpireTxDate >= today) {
    return { amountDays: 0, skipReason: "ALREADY_WROTE_TODAY" };
  }
  return { amountDays, skipReason: null };
}

function assertIso(value: string, label: string): void {
  if (!ISO_DATE.test(value))
    throw new Error(`[leave.carryover] ${label} phải là YYYY-MM-DD, nhận "${value}"`);
}

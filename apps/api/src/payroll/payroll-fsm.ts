import { ConflictException } from "@nestjs/common";
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { PAYROLL_ERR, PAYROLL_ERR_CODE, payrollDetails } from "./payroll.errors";

/**
 * S13-PAYROLL-BE-1 — FSM kỳ lương (SPEC-01 §17.15 · SPEC-11 §13.1). **File thuần TS, 0 phụ thuộc Nest**
 * ngoài `ConflictException`.
 *
 * ⚠️ DB **KHÔNG** ép chuyển tiếp: mig `0564` đã DROP trigger `payroll_period_status_guard` (nó ép FSM
 * cũ 3 trạng thái chữ thường). CHECK chỉ ràng **tập giá trị** + **cặp cột vết duyệt**
 * (`check-cannot-enforce-fsm-transitions`) ⇒ ĐÂY là nơi duy nhất ép chuyển tiếp, và mọi hành động chạm
 * trạng thái phải mở transaction bắt đầu bằng `SELECT … FROM payroll_periods WHERE id = $1 FOR UPDATE`.
 *
 * 🔁 **v2 (S15-PAYROLL-DB-2, mig `0572`, PAY-DEC-017) — 8 trạng thái.** Hai đổi thay so với v1, không
 * hơn: `publish` dừng ở **`Published`** (không còn `Approved → Paid`), và cạnh MỚI **`complete-batch`
 * `Published → Paid`** là đường DUY NHẤT vào `Paid`. Cạnh đó KHÔNG có route trên `payroll-periods` —
 * route hoàn tất đợt chi trả (PAYROLL-API-072, S15-PAYROLL-BE-4) row-lock kỳ TRƯỚC · đợt SAU rồi gọi
 * chính `assertPeriodTransition` ở đây. Không dựng hàm FSM thứ hai.
 */

/** 10 action chạm trạng thái kỳ (SPEC-11 §13.1 bảng RESET có đúng 10 hàng ở v2). */
export type PeriodAction =
  | "collect"
  | "calculate"
  | "submit"
  | "approve"
  | "reject"
  | "generate-payslips"
  | "publish"
  | "complete-batch"
  | "lock"
  | "reopen";

/**
 * Cột vết duyệt trên `payroll_periods` — cặp `<name>_by` / `<name>_at`.
 *
 * ⚠️ `applyTransitionTx` ghi `patch[\`${col}By\`]` ĐỘNG và drizzle **bỏ qua im lặng** khoá không phải cột
 * ⇒ mỗi giá trị ở đây PHẢI có cặp cột thật trong `schema/payroll.ts` (census `payroll-fsm.spec.ts`).
 */
export type TrailCol =
  | "calculated"
  | "submitted"
  | "approved"
  | "payslipsGenerated"
  | "published"
  | "paid"
  | "locked";

export interface PeriodTransition {
  readonly action: PeriodAction;
  readonly from: PayrollPeriodStatus;
  readonly to: PayrollPeriodStatus;
}

/**
 * **11 chuyển tiếp ĐỔI trạng thái** — liệt kê tường minh từng ô, KHÔNG suy từ một con số đếm tay
 * (plan-review vòng 1 blocker #1: v1 của plan viết "11 ✓" và sai). v1 có 10; v2 đổi đích `publish` và
 * thêm `complete-batch`.
 *
 * ⚠️ `apps/app/src/routes/payroll/payroll-fsm-parity.spec.ts` đọc file này bằng REGEX theo hình dạng
 * object literal một dòng (khoá action · from · to, giá trị chuỗi) — giữ đúng hình dạng đó, đừng gom qua
 * helper. Và ĐỪNG viết ví dụ đúng hình dạng đó trong comment: regex không phân biệt comment, một ví dụ
 * minh hoạ thành cạnh thứ 12 và parity ĐỎ.
 */
export const PERIOD_TRANSITIONS: readonly PeriodTransition[] = [
  { action: "collect", from: "Draft", to: "CollectingData" },
  { action: "calculate", from: "CollectingData", to: "Calculated" },
  { action: "submit", from: "Calculated", to: "Reviewing" },
  { action: "reject", from: "Reviewing", to: "Calculated" },
  { action: "approve", from: "Reviewing", to: "Approved" },
  { action: "publish", from: "Approved", to: "Published" },
  // Đường DUY NHẤT vào `Paid` — chỉ khi lượt hoàn tất đợt làm PHỦ ĐỦ kỳ (luật PHỦ SPEC-11 §13.1, BE-4).
  { action: "complete-batch", from: "Published", to: "Paid" },
  { action: "lock", from: "Paid", to: "Locked" },
  // `reopen` — cặp quyền riêng + lý do bắt buộc + audit; điều kiện chặn ở `assertReopenAllowed`.
  { action: "reopen", from: "Calculated", to: "CollectingData" },
  { action: "reopen", from: "Reviewing", to: "CollectingData" },
  { action: "reopen", from: "Approved", to: "CollectingData" },
];

/**
 * **3 hành động chạy TẠI CHỖ** (đường chéo hợp lệ — không đổi trạng thái).
 *
 * ⚠️ SPEC tự mâu thuẫn: văn xuôi §13.1 viết "**Hai** hành động chạy TẠI CHỖ" nhưng **BẢNG** §13.1 hàng
 * `CollectingData` ghi "*(collect lại tại chỗ ✓)*". **BẢNG THẮNG** — `collect` lại là đường duy nhất
 * làm mới cảnh báo `readiness` sau khi dữ liệu công/phép đổi; cấm nó thì `Draft → CollectingData` chỉ
 * đi được đúng một lần. Đừng "sửa cho khớp văn xuôi".
 *
 * `Published` ghi «lập/sửa/hoàn tất đợt chi trả tại chỗ» ở bảng §13.1 — đó là thao tác trên BẢNG ĐỢT, không
 * phải action của kỳ, nên KHÔNG vào đây.
 */
export const IN_PLACE_ACTIONS: Readonly<Record<string, PayrollPeriodStatus>> = {
  collect: "CollectingData",
  calculate: "Calculated",
  "generate-payslips": "Approved",
};

/**
 * Bảng RESET vết duyệt — **10 hàng**, sao đúng SPEC-11 §13.1.
 *
 * Vì sao BẮT BUỘC, không phải chi tiết thi công: CHECK `payroll_periods_four_eyes_check` sống ở DB.
 * `reopen`/`reject` không xoá vết cũ ⇒ kịch bản thật (A duyệt → reopen → tính lại → **A gửi duyệt**)
 * vi phạm CHECK và trả `23514` = **500 ở vùng đỏ**. Xoá sai vế thì `approved_pair_check` nổ.
 *
 * `reopen` **KHÔNG** clear `published`/`paid`/`locked`: reopen bị chặn từ `Published` trở đi nên ba cặp đó
 * không bao giờ cần xoá — clear nhầm sẽ nổ `published_pair_check`/`paid_pair_check`.
 */
export const TRAIL_RESET: Readonly<
  Record<PeriodAction, { readonly clear: readonly TrailCol[]; readonly set: readonly TrailCol[] }>
> = {
  collect: { clear: ["calculated"], set: [] },
  calculate: { clear: ["submitted"], set: ["calculated"] },
  submit: { clear: [], set: ["submitted"] },
  reject: { clear: ["submitted"], set: [] },
  approve: { clear: [], set: ["approved"] },
  // Thiếu hàng này (lỗi của plan v1) ⇒ BE-2 tự chế cặp ghi và ăn 23514 từ `generated_pair_check`.
  "generate-payslips": { clear: [], set: ["payslipsGenerated"] },
  publish: { clear: [], set: ["published"] },
  // Thiếu `paid` ⇒ UPDATE status='Paid' không ghi paid_by/at ⇒ 23514 từ `paid_pair_check` (mig 0572).
  "complete-batch": { clear: [], set: ["paid"] },
  lock: { clear: [], set: ["locked"] },
  reopen: { clear: ["calculated", "submitted", "approved"], set: [] },
};

/** Trạng thái mà `reopen` KHÔNG BAO GIỜ mở lại được (`period-terminal`) — v2 thêm `Published`. */
const REOPEN_TERMINAL_STATUSES: ReadonlySet<PayrollPeriodStatus> = new Set<PayrollPeriodStatus>([
  "Published",
  "Paid",
  "Locked",
]);

const conflict = (message: string, kind: string) =>
  new ConflictException({
    code: PAYROLL_ERR_CODE.PERIOD_TRANSITION,
    message,
    details: payrollDetails(kind),
  });

/** Ô `(from, to)` có hợp lệ không — kể cả ô tại chỗ (`from === to`). */
export function isAllowedTransition(
  from: PayrollPeriodStatus,
  to: PayrollPeriodStatus,
  via: PeriodAction,
): boolean {
  if (from === to) return IN_PLACE_ACTIONS[via] === from;
  return PERIOD_TRANSITIONS.some((t) => t.action === via && t.from === from && t.to === to);
}

/**
 * ĐÚNG MỘT hàm ép chuyển tiếp — không controller nào tự kiểm (SPEC-11 §13.1).
 * Mọi ô cấm ⇒ **409 PAYROLL-ERR-001**, thông điệp nêu from/to.
 */
export function assertPeriodTransition(
  from: PayrollPeriodStatus,
  to: PayrollPeriodStatus,
  via: PeriodAction,
): void {
  if (isAllowedTransition(from, to, via)) return;
  throw conflict(PAYROLL_ERR.PERIOD_TRANSITION(from, to), "invalid-transition");
}

/**
 * Trạng thái đích của action từ `from`, **ném 409 khi action không áp dụng được** ở trạng thái đó.
 *
 * Vì sao tách khỏi `nextStatus`: caller viết `assertPeriodTransition(from, nextStatus(...) ?? from, via)`
 * sẽ tự tạo ra ô `from → from` và sinh thông điệp *"không thể chuyển từ X sang X"* — sai ngữ nghĩa
 * (nghe như người dùng tự chuyển vào chính trạng thái hiện tại), che mất nguyên nhân thật là
 * *"hành động này không áp dụng được ở X"*. `kind` cũng khác: `action-not-applicable` ≠
 * `invalid-transition`.
 */
export function resolveActionTarget(
  from: PayrollPeriodStatus,
  via: PeriodAction,
): PayrollPeriodStatus {
  const to = nextStatus(from, via);
  if (to === null) {
    throw conflict(PAYROLL_ERR.ACTION_NOT_APPLICABLE(via, from), "action-not-applicable");
  }
  return to;
}

/** Trạng thái đích của một action từ `from` — `null` nếu ô đó bị cấm. */
export function nextStatus(
  from: PayrollPeriodStatus,
  via: PeriodAction,
): PayrollPeriodStatus | null {
  const moved = PERIOD_TRANSITIONS.find((t) => t.action === via && t.from === from);
  if (moved) return moved.to;
  return IN_PLACE_ACTIONS[via] === from ? from : null;
}

/**
 * Cổng của `reopen` — **dữ liệu ≠ điều kiện**: `TRAIL_RESET.reopen` chỉ nói *xoá gì*.
 *
 * Cờ đã-sinh-phiếu đọc trên **chính hàng kỳ đang khoá** (`payslips_generated_at`), **KHÔNG đếm bảng
 * `payslips`** — bảng khác không được row-lock bảo vệ. Thiếu cổng này là đường vào trạng thái không
 * thoát được: kỳ về `CollectingData` trong khi đã có phiếu ⇒ mọi lần `generate` sau đều 409 vĩnh viễn
 * (phiếu append-only, không xoá được).
 *
 * v2: `Published` **bắt buộc** đã sinh phiếu nên vế một đã chặn nó; vế hai liệt kê `Published` là phòng
 * thủ chiều sâu cho hàng dữ liệu bất khả (kỳ `Published` mà cờ NULL) — không được lọt về `CollectingData`.
 *
 * BE-2 gọi hàm này ngay sau `SELECT … FOR UPDATE`, TRƯỚC `assertPeriodTransition`.
 */
export function assertReopenAllowed(period: {
  status: PayrollPeriodStatus;
  payslipsGeneratedAt: Date | string | null;
}): void {
  if (period.payslipsGeneratedAt !== null && period.payslipsGeneratedAt !== undefined) {
    throw new ConflictException({
      code: PAYROLL_ERR_CODE.REOPEN_BLOCKED,
      message: PAYROLL_ERR.REOPEN_PAYSLIP_GENERATED,
      details: payrollDetails("payslip-already-generated"),
    });
  }
  if (REOPEN_TERMINAL_STATUSES.has(period.status)) {
    throw new ConflictException({
      code: PAYROLL_ERR_CODE.REOPEN_BLOCKED,
      message: PAYROLL_ERR.REOPEN_TERMINAL(period.status),
      details: payrollDetails("period-terminal"),
    });
  }
}

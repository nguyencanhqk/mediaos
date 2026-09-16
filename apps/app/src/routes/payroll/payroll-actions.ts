/**
 * S13-PAYROLL-FE-1 — suy hành động hợp lệ trên kỳ lương từ **FSM ∩ quyền ∩ four-eyes** (SPEC-11 §13.1,
 * khuôn `recruit-actions.ts`).
 *
 * Ba bảng dưới đây MIRROR ĐÚNG `apps/api/src/payroll/payroll-fsm.ts` (nguồn sự thật — `apps/app` KHÔNG
 * import được `apps/api`, phải copy literal). `payroll-fsm-parity.spec.ts` đọc lại file BE bằng `fs` và
 * so từng ô; ở đây chỉ cần đúng THEO BẢNG. Hàm THUẦN, không đụng React — spec neo được toàn bộ ma trận
 * mà không cần dựng DOM.
 *
 * ── VÌ SAO FE PHẢI BIẾT FSM (SPEC-11 §14) ─────────────────────────────────────────────────────────
 * Yêu cầu là «**nút không hiện thay vì hiện rồi 409**». Nếu FE chỉ gate theo quyền, người có `approve`
 * vẫn thấy nút «Duyệt» trên kỳ `Draft` và ăn 409 — và quan trọng hơn, **chính người vừa gửi duyệt** vẫn
 * thấy nút «Duyệt» trên kỳ của mình rồi ăn `PAYROLL-ERR-005`. Four-eyes phải hiện ra ở UI, không chỉ ở
 * mã lỗi.
 *
 * ⚠️ FE là **tiện nghi**, KHÔNG phải cổng. BE ép cả ba tầng four-eyes (quyền · logic dưới row-lock ·
 * CHECK ở DB). Bảng này không được nới rộng hơn BE, nhưng hẹp hơn thì vô hại.
 */
import type { PayrollPeriodStatus } from "@mediaos/contracts";
import { PAYROLL_ENGINE_PAIRS, type PayrollEnginePair } from "./constants";

/** 9 hành động ghi trên kỳ lương (mã `via` gửi lên BE = tên route). */
export const PAYROLL_PERIOD_ACTIONS = [
  "collect",
  "calculate",
  "submit",
  "approve",
  "reject",
  "generate-payslips",
  "publish",
  "lock",
  "reopen",
] as const;
export type PayrollPeriodAction = (typeof PAYROLL_PERIOD_ACTIONS)[number];

/**
 * Action của FSM — rộng hơn `PayrollPeriodAction` đúng một phần tử: `complete-batch` (`Published → Paid`)
 * là cạnh của FSM kỳ nhưng KHÔNG phải nút trên thanh hành động kỳ — nó chạy từ màn Chi trả (hoàn tất đợt,
 * PAYROLL-API-072, S15-PAYROLL-FE-3). Mirror vào bảng để parity spec so ĐỦ cạnh với BE, nhưng KHÔNG thêm
 * vào `PAYROLL_PERIOD_ACTIONS`/`PERIOD_ACTION_PAIR`.
 */
type PeriodFsmAction = PayrollPeriodAction | "complete-batch";

interface PeriodTransition {
  readonly action: PeriodFsmAction;
  readonly from: PayrollPeriodStatus;
  readonly to: PayrollPeriodStatus;
}

/**
 * **11 chuyển tiếp ĐỔI trạng thái** — liệt kê tường minh từng ô (mirror `PERIOD_TRANSITIONS` của BE).
 * v2 (mig `0572`): `publish` dừng ở `Published`; `complete-batch` là đường DUY NHẤT vào `Paid`.
 */
export const PERIOD_TRANSITIONS: readonly PeriodTransition[] = [
  { action: "collect", from: "Draft", to: "CollectingData" },
  { action: "calculate", from: "CollectingData", to: "Calculated" },
  { action: "submit", from: "Calculated", to: "Reviewing" },
  { action: "reject", from: "Reviewing", to: "Calculated" },
  { action: "approve", from: "Reviewing", to: "Approved" },
  { action: "publish", from: "Approved", to: "Published" },
  { action: "complete-batch", from: "Published", to: "Paid" },
  { action: "lock", from: "Paid", to: "Locked" },
  { action: "reopen", from: "Calculated", to: "CollectingData" },
  { action: "reopen", from: "Reviewing", to: "CollectingData" },
  { action: "reopen", from: "Approved", to: "CollectingData" },
];

/**
 * **3 hành động chạy TẠI CHỖ** (đường chéo hợp lệ — không đổi trạng thái), mirror `IN_PLACE_ACTIONS`.
 *
 * `collect` lại tại `CollectingData` là đường DUY NHẤT làm mới cảnh báo `readiness` sau khi dữ liệu
 * công/phép đổi — SPEC §13.1 văn xuôi nói "hai", BẢNG nói ba và **BẢNG THẮNG** (ghi rõ ở BE). Đừng
 * "sửa cho khớp văn xuôi".
 */
export const IN_PLACE_ACTIONS: Readonly<Record<string, PayrollPeriodStatus>> = {
  collect: "CollectingData",
  calculate: "Calculated",
  "generate-payslips": "Approved",
};

/** Cặp quyền engine gác từng hành động — tra thẳng từ bảng 35 route, KHÔNG gõ lại literal. */
export const PERIOD_ACTION_PAIR: Readonly<Record<PayrollPeriodAction, PayrollEnginePair>> = {
  collect: PAYROLL_ENGINE_PAIRS.periodCollect,
  calculate: PAYROLL_ENGINE_PAIRS.periodCalculate,
  submit: PAYROLL_ENGINE_PAIRS.periodSubmit,
  approve: PAYROLL_ENGINE_PAIRS.periodApprove,
  reject: PAYROLL_ENGINE_PAIRS.periodReject,
  "generate-payslips": PAYROLL_ENGINE_PAIRS.periodGeneratePayslips,
  publish: PAYROLL_ENGINE_PAIRS.periodPublish,
  lock: PAYROLL_ENGINE_PAIRS.periodLock,
  reopen: PAYROLL_ENGINE_PAIRS.periodReopen,
};

/** Ô `(action, from)` có hợp lệ theo FSM không — kể cả ô tại chỗ (`from === to`). */
export function isPeriodActionAllowedByFsm(
  action: PayrollPeriodAction,
  from: PayrollPeriodStatus,
): boolean {
  if (IN_PLACE_ACTIONS[action] === from) return true;
  return PERIOD_TRANSITIONS.some((t) => t.action === action && t.from === from);
}

/** Trạng thái đích của một hành động tại `from`; `null` khi ô không hợp lệ. */
export function periodActionTarget(
  action: PayrollPeriodAction,
  from: PayrollPeriodStatus,
): PayrollPeriodStatus | null {
  const edge = PERIOD_TRANSITIONS.find((t) => t.action === action && t.from === from);
  if (edge) return edge.to;
  return IN_PLACE_ACTIONS[action] === from ? from : null;
}

/** Lát cắt tối thiểu của kỳ lương cần để suy nút — KHÔNG cần DTO đầy đủ (spec neo được bằng object trần). */
export interface PeriodActionSubject {
  readonly status: PayrollPeriodStatus;
  /** Cờ đã-sinh-phiếu. `!== null` ⇒ `reopen` bị chặn VĨNH VIỄN (phiếu append-only, không xoá được). */
  readonly payslipsGeneratedAt: string | null;
  /** Người gửi duyệt — vế four-eyes. */
  readonly submittedBy: string | null;
}

/**
 * `reopen` có bị chặn không — mirror `assertReopenAllowed` của BE.
 *
 * Hai vế, và vế ĐẦU quan trọng hơn: kỳ đã sinh phiếu mà quay về `CollectingData` thì mọi lần
 * `generate-payslips` sau đều 409 vĩnh viễn ⇒ trạng thái không thoát được. `Published`/`Paid`/`Locked` chặn
 * ở vế hai (v2 mig `0572` — mirror `REOPEN_TERMINAL_STATUSES` của BE).
 */
export function isReopenBlocked(period: PeriodActionSubject): boolean {
  if (period.payslipsGeneratedAt !== null) return true;
  return period.status === "Published" || period.status === "Paid" || period.status === "Locked";
}

/**
 * `approve` có bị four-eyes chặn không — mirror tầng 2 của BE (`payroll-approval.service.ts`).
 *
 * ⚠️ `currentUserId` **null** (chưa biết mình là ai) ⇒ trả `false`, tức KHÔNG chặn ở FE. Fail-open ở
 * đây là CỐ Ý và an toàn: BE vẫn chặn dưới row-lock + CHECK ở DB. Fail-closed sẽ giấu nút «Duyệt» khỏi
 * mọi người trong khoảnh khắc `/auth/me` chưa về — đúng thứ ẩn màn im lặng mà repo đã dính nhiều lần.
 */
export function isFourEyesBlocked(
  period: PeriodActionSubject,
  currentUserId: string | null,
): boolean {
  if (currentUserId === null) return false;
  return period.submittedBy !== null && period.submittedBy === currentUserId;
}

/** Vì sao một hành động không khả dụng — dùng để chọn tooltip, KHÔNG để render nút mờ. */
export type PeriodActionBlockReason = "fsm" | "permission" | "four-eyes" | "payslips-generated";

export interface PeriodActionAvailability {
  readonly action: PayrollPeriodAction;
  readonly available: boolean;
  readonly reason: PeriodActionBlockReason | null;
}

/**
 * Bảng khả dụng đầy đủ cho 9 hành động — thứ tự đánh giá CỐ ĐỊNH: FSM → quyền → chặn nghiệp vụ.
 *
 * Thứ tự có ý nghĩa cho tooltip: một kỳ `Draft` không nên nói «bạn không có quyền duyệt», nó nên nói
 * «kỳ chưa tới bước duyệt». Người thiếu quyền trên một ô FSM hợp lệ mới đáng nói về quyền.
 *
 * `hasPermission` do caller truyền vào (kết quả `useCanExact`/`useCan` theo `isSensitive` của cặp) —
 * hàm này KHÔNG tự gọi hook và KHÔNG tự suy quyền.
 */
export function periodActionAvailability(
  period: PeriodActionSubject,
  hasPermission: (action: PayrollPeriodAction) => boolean,
  currentUserId: string | null,
): readonly PeriodActionAvailability[] {
  return PAYROLL_PERIOD_ACTIONS.map((action) => {
    if (!isPeriodActionAllowedByFsm(action, period.status)) {
      return { action, available: false, reason: "fsm" as const };
    }
    if (!hasPermission(action)) {
      return { action, available: false, reason: "permission" as const };
    }
    if (action === "reopen" && isReopenBlocked(period)) {
      return { action, available: false, reason: "payslips-generated" as const };
    }
    if (action === "approve" && isFourEyesBlocked(period, currentUserId)) {
      return { action, available: false, reason: "four-eyes" as const };
    }
    return { action, available: true, reason: null };
  });
}

/** Chỉ những hành động THẬT SỰ bấm được — cái mà thanh hành động render. */
export function availablePeriodActions(
  period: PeriodActionSubject,
  hasPermission: (action: PayrollPeriodAction) => boolean,
  currentUserId: string | null,
): readonly PayrollPeriodAction[] {
  return periodActionAvailability(period, hasPermission, currentUserId)
    .filter((a) => a.available)
    .map((a) => a.action);
}

/** Hành động cần LÝ DO bắt buộc (BE ép `reason`/`decisionNote` NOT NULL — mirror CHECK). */
export const PERIOD_ACTIONS_NEEDING_REASON: ReadonlySet<PayrollPeriodAction> = new Set([
  "reject",
  "reopen",
]);

/**
 * Điều chỉnh tay một dòng chỉ mở khi kỳ còn `Calculated` (SPEC-11 §10 FUNC-007 — kỳ ≥ `Approved` ⇒
 * 409 `PAYROLL-ERR-003`). Tách khỏi bảng FSM vì nó KHÔNG phải hành động cấp kỳ.
 */
export function canAdjustLines(period: PeriodActionSubject, hasAdjustPermission: boolean): boolean {
  return hasAdjustPermission && period.status === "Calculated";
}

// ── Thưởng/phạt (SPEC-11 §13.3) ───────────────────────────────────────────────────────────────────

/** Lát cắt tối thiểu của một khoản thưởng/phạt cần để suy nút. */
export interface BonusPenaltyActionSubject {
  readonly status: "Pending" | "Approved" | "Rejected";
  /** `!== null` ⇒ đã vào kỳ lương — khoá sửa (409 `PAYROLL-ERR-013`). */
  readonly payrollPeriodId: string | null;
  readonly createdBy: string;
}

/** Sửa/xoá mềm chỉ khi còn `Pending` **và** chưa consume — mirror tiền-kiểm dưới `FOR UPDATE` của BE. */
export function canEditBonusPenalty(
  item: BonusPenaltyActionSubject,
  hasManagePermission: boolean,
): boolean {
  return hasManagePermission && item.status === "Pending" && item.payrollPeriodId === null;
}

/**
 * Duyệt/từ chối thưởng/phạt — four-eyes: người TẠO không tự duyệt được (409 `PAYROLL-ERR-012`).
 * `currentUserId` null ⇒ không chặn ở FE (cùng lý do fail-open như `isFourEyesBlocked`).
 */
export function canDecideBonusPenalty(
  item: BonusPenaltyActionSubject,
  hasApprovePermission: boolean,
  currentUserId: string | null,
): boolean {
  if (!hasApprovePermission || item.status !== "Pending") return false;
  return currentUserId === null || item.createdBy !== currentUserId;
}

// ── Tạm ứng (SPEC-11 §13 · PAYROLL-API-059..064) ──────────────────────────────────────────────────

/** Lát cắt tối thiểu của một khoản tạm ứng cần để suy nút. */
export interface PayrollAdvanceActionSubject {
  readonly status: "Pending" | "Approved" | "Rejected" | "Deducted";
  /** `!== null` ⇒ đã gắn vào kỳ lương (đã khấu trừ) — khoá sửa (409 `PAYROLL-ERR-025`). */
  readonly payrollPeriodId: string | null;
  /** Người TẠO phiếu tạm ứng. `null` khi hàng di sản không có `created_by`. */
  readonly createdBy: string | null;
  /** Người THỤ HƯỞNG khoản tạm ứng — vế thứ hai của four-eyes. */
  readonly userId: string;
}

/** Sửa/xoá mềm chỉ khi còn `Pending` **và** chưa khấu trừ — mirror tiền-kiểm dưới `FOR UPDATE` của BE. */
export function canEditAdvance(
  item: PayrollAdvanceActionSubject,
  hasManagePermission: boolean,
): boolean {
  return hasManagePermission && item.status === "Pending" && item.payrollPeriodId === null;
}

/**
 * Duyệt/từ chối tạm ứng — **four-eyes RỘNG HƠN thưởng/phạt**.
 *
 * ⚠️ BE chặn **CẢ HAI** vế (`payroll-advances.service.ts`: `before.createdBy === user.id ||
 * before.userId === user.id` ⇒ 409 `PAYROLL-ERR-025 self-approval`): người TẠO **hoặc** người THỤ
 * HƯỞNG đều không tự quyết định được. CHECK `payroll_advances_four_eyes_check` ở DB chỉ soi
 * `created_by` — vế thụ hưởng sống ở service, nên **không** suy luật từ CHECK.
 *
 * SPEC-11 §9.1 chỉ viết «ẩn với chính người tạo» — **hẹp hơn BE**. Theo BE: thiếu vế thụ hưởng thì
 * người được cấp tạm ứng vẫn thấy nút «Duyệt» trên khoản của chính mình rồi ăn 409.
 *
 * `currentUserId === null` ⇒ KHÔNG chặn ở FE (fail-open, cùng lý do `isFourEyesBlocked`: BE vẫn chặn,
 * còn fail-closed sẽ giấu nút khỏi mọi người trong khoảnh khắc `/auth/me` chưa về).
 */
export function canDecideAdvance(
  item: PayrollAdvanceActionSubject,
  hasApprovePermission: boolean,
  currentUserId: string | null,
): boolean {
  if (!hasApprovePermission || item.status !== "Pending") return false;
  if (currentUserId === null) return true;
  return item.createdBy !== currentUserId && item.userId !== currentUserId;
}

// ── Đợt chi trả (SPEC-11 §13.1 · PAYROLL-API-066..072) ────────────────────────────────────────────

/** Lát cắt tối thiểu của một đợt chi trả cần để suy nút. */
export interface PaymentBatchActionSubject {
  readonly status: "Draft" | "Ready" | "Completed";
  /** Số dòng còn hiệu lực (đã trừ dòng xoá mềm). */
  readonly lineCount: number;
  /** Số dòng đã đánh dấu `paid_at`. */
  readonly paidLineCount: number;
  /** Người LẬP đợt — vế four-eyes của 072 (`batch-four-eyes`). */
  readonly createdBy: string | null;
}

/** Sửa đợt (069) chỉ khi chưa hoàn tất — `Completed` là terminal, trigger DB đóng băng đợt. */
export function canEditPaymentBatch(
  batch: PaymentBatchActionSubject,
  hasManagePermission: boolean,
): boolean {
  return hasManagePermission && batch.status !== "Completed";
}

/**
 * Nút «Hoàn tất» (072) — **ẩn thay vì hiện rồi 409** (SPEC-11 §14 · UI-07 Lưu ý UX 1). Ba vế ẩn map
 * đúng ba lỗi BE: `batch-already-completed` (027) · `batch-empty` (028) · `batch-four-eyes`.
 *
 * ⚠️ **KHÔNG** ẩn khi còn dòng chưa chi. Đó là ca HỢP LỆ: 072 nhận `confirmAllPaid: true` để ghi
 * `paid_at` cho mọi dòng trong CÙNG tx. Ẩn ở đây sẽ khoá chết một đợt hợp lệ; `batch-incomplete` chỉ
 * phát khi người dùng cố hoàn tất mà KHÔNG tick ô xác nhận (xem `paymentBatchHasUnpaidLines`).
 *
 * ⚠️ Không cần tải trạng thái KỲ để suy nút: đợt chỉ lập được từ kỳ `Published`, và `Published` không
 * mở lại được (`REOPEN_TERMINAL_STATUSES`) ⇒ kỳ của một đợt đang tồn tại luôn ≥ `Published`.
 */
export function canCompletePaymentBatch(
  batch: PaymentBatchActionSubject,
  hasManagePermission: boolean,
  currentUserId: string | null,
): boolean {
  if (!hasManagePermission || batch.status === "Completed" || batch.lineCount === 0) return false;
  return currentUserId === null || batch.createdBy !== currentUserId;
}

/** Còn dòng chưa đánh dấu đã chi ⇒ hộp xác nhận phải hiện ô «Xác nhận đã chi tất cả» (`confirmAllPaid`). */
export function paymentBatchHasUnpaidLines(batch: PaymentBatchActionSubject): boolean {
  return batch.paidLineCount < batch.lineCount;
}

/**
 * S13-PAYROLL-BE-2 — payload outbox cho 4 event PAYROLL (SPEC-11 §17, seed mig `0566`).
 *
 * ⚠️ **TUYỆT ĐỐI KHÔNG SỐ TIỀN.** NOTI đi qua nhiều kênh và KHÔNG có tầng masking riêng (SPEC-11 §17,
 * §18) — ràng buộc mạnh hơn mọi module khác. Payload chỉ mang: kỳ (`period_month`) · tên người thao tác
 * · lý do từ chối (022) · id để deep-link · danh sách người nhận. Một khoá tiền lọt vào đây là rò lương
 * cho mọi người trong danh sách nhận.
 *
 * ⚠️ **BIẾN TEMPLATE PHẢI KHỚP NGUYÊN VĂN `variables_schema` của `0566`** (snake_case) — thiếu khoá thì
 * renderer giữ nguyên `{placeholder}` trong `target_url` ⇒ `assertInternalTargetUrl` từ chối ⇒ MỌI noti
 * PAYROLL dead-letter CÂM (đúng lớp lỗi RECRUIT đã dính 31/08). Khoá camelCase giữ SONG SONG cho
 * neo/dedupe của registrar.
 *
 * **Người nhận nằm TRONG payload, không resolve lại lúc giao** (khuôn `recruit.job_assigned`):
 *  · 020 — `approverUserIds` do CHÍNH `PayrollApproverReader` sinh ở `submit`, cùng lượt với cổng
 *    PAYROLL-ERR-017. Đọc lại DB lúc giao là **bộ giải thứ hai**, và hai bộ giải lệch nhau đẻ đúng cái
 *    thất bại mà 017 sinh ra để chặn (mig `0566` ghi rõ điều này).
 *  · 021/022 — `recipientUserId` = `submitted_by` đọc TRƯỚC `applyTransitionTx` (hàm này XOÁ
 *    `submitted_*` theo `TRAIL_RESET.reject`; đọc sau là mất người nhận).
 *  · 023 — `recipientUserId` = chủ phiếu, một event/phiếu.
 */

export const PAYROLL_EVENT_PERIOD_SUBMITTED = "payroll.period_submitted";
export const PAYROLL_EVENT_PERIOD_APPROVED = "payroll.period_approved";
export const PAYROLL_EVENT_PERIOD_REJECTED = "payroll.period_rejected";
export const PAYROLL_EVENT_PAYSLIP_PUBLISHED = "payroll.payslip_published";
// ── S15-PAYROLL-BE-4 — track C (NOTI-EVENT-024..027, seed mig 0573) ──
export const PAYROLL_EVENT_ADVANCE_SUBMITTED = "payroll.advance_submitted";
export const PAYROLL_EVENT_ADVANCE_APPROVED = "payroll.advance_approved";
export const PAYROLL_EVENT_ADVANCE_REJECTED = "payroll.advance_rejected";
export const PAYROLL_EVENT_PAYMENT_BATCH_COMPLETED = "payroll.payment_batch_completed";

/** Nhãn trung tính khi `users.full_name` NULL — không quy hành động cho "Hệ thống" (khuôn RECRUIT/ASSET). */
export const PAYROLL_ACTOR_FALLBACK = "Bộ phận nhân sự";

interface PayrollPeriodEventBase {
  /** Neo `sourceEntityId` + nửa đầu dedupeKey. */
  periodId: string;
  actorUserId: string;
  // Template `0566`: actor_name · period_month · payroll_period_id.
  actor_name: string;
  period_month: string;
  payroll_period_id: string;
  [key: string]: unknown;
}

/** 020 — NOTI-EVENT-020 `PAYROLL_PERIOD_SUBMITTED`. */
export interface PayrollPeriodSubmittedPayload extends PayrollPeriodEventBase {
  /** RETURNING `submitted_at` của CHÍNH câu `applyTransitionTx` — nửa sau dedupeKey (mỗi LẦN gửi là một sự kiện). */
  submittedAtIso: string;
  /** Người duyệt hợp lệ tại thời điểm gửi — cùng bộ giải với PAYROLL-ERR-017. Rỗng là KHÔNG THỂ (submit đã 422). */
  approverUserIds: string[];
}

/** 021 — NOTI-EVENT-021 `PAYROLL_PERIOD_APPROVED`. */
export interface PayrollPeriodApprovedPayload extends PayrollPeriodEventBase {
  approvedAtIso: string;
  /** `submitted_by` — người gửi duyệt. */
  recipientUserId: string;
}

/**
 * 022 — NOTI-EVENT-022 `PAYROLL_PERIOD_REJECTED`.
 *
 * `reject` KHÔNG có cột `rejected_at` (bảng RESET chỉ xoá `submitted_*`), nên nửa sau dedupeKey lấy
 * `updated_at` của chính câu UPDATE ⇒ từ chối lần hai sau khi gửi lại vẫn là khoá khác ⇒ vẫn báo.
 */
export interface PayrollPeriodRejectedPayload extends PayrollPeriodEventBase {
  updatedAtIso: string;
  /** `submitted_by` ĐỌC TRƯỚC `applyTransitionTx` — sau đó cột này đã bị xoá. */
  recipientUserId: string;
  // Template `0566` có thêm biến `reason`.
  reason: string;
}

/** 023 — NOTI-EVENT-023 `PAYSLIP_PUBLISHED`. Template chỉ dùng `period_month`; target_url tĩnh `/me/payslips`. */
export interface PayslipPublishedPayload {
  /** Neo + dedupeKey trọn vẹn: một phiếu báo đúng MỘT lần (append-only, không phát hành lại được). */
  payslipId: string;
  periodId: string;
  actorUserId: string;
  /** Chủ phiếu. */
  recipientUserId: string;
  period_month: string;
  [key: string]: unknown;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S15-PAYROLL-BE-4 — track C (SPEC-11 §17.1 · template mig 0573). ⚠️ 0 SỐ TIỀN — kể cả số tạm ứng của chính
// người nhận: NOTI đi qua nhiều kênh, không có tầng masking. Người nhận đi THEO PAYLOAD; producer KHÔNG enqueue khi
// danh sách rỗng (registrar `requireUserIds` NÉM ⇒ dead-letter câm — plan-review C7).
// ════════════════════════════════════════════════════════════════════════════════════════════════

interface PayrollAdvanceEventBase {
  /** Neo `sourceEntityId` + nửa đầu dedupeKey. */
  advanceId: string;
  actorUserId: string;
  /** Người nhận, resolve MỘT LẦN lúc ghi; KHÔNG rỗng (producer đã lọc). */
  recipientUserIds: string[];
  // Template 0573: actor_name · deduct_period_month · payroll_advance_id.
  actor_name: string;
  deduct_period_month: string;
  payroll_advance_id: string;
  [key: string]: unknown;
}

/** 024 — `PAYROLL_ADVANCE_SUBMITTED`: người nhận = holders(`approve:payroll-advance`) − actor. dedupe `{advanceId}:{createdAtIso}`. */
export interface PayrollAdvanceSubmittedPayload extends PayrollAdvanceEventBase {
  createdAtIso: string;
}

/** 025 — `PAYROLL_ADVANCE_APPROVED`: người nhận = uniq[user_id, created_by] − actor. dedupe `{advanceId}:{decidedAtIso}`. */
export interface PayrollAdvanceApprovedPayload extends PayrollAdvanceEventBase {
  decidedAtIso: string;
}

/** 026 — `PAYROLL_ADVANCE_REJECTED`: như 025 + biến template `reason`. */
export interface PayrollAdvanceRejectedPayload extends PayrollAdvanceEventBase {
  decidedAtIso: string;
  reason: string;
}

/**
 * 027 — `PAYROLL_PAYMENT_BATCH_COMPLETED`: CHỈ ở lượt hoàn tất làm kỳ CHUYỂN `Paid` (luật PHỦ). dedupe = `{periodId}`
 * — một KỲ báo đúng MỘT lần (khoá theo `batchId` thì kỳ nhiều đợt đẻ nhiều thông báo). Người nhận = holders
 * (`view:payment-batch`) − actor. `sourceEntity` là KỲ (`payroll_period`), không phải đợt.
 */
export interface PayrollPaymentBatchCompletedPayload {
  periodId: string;
  batchId: string;
  actorUserId: string;
  recipientUserIds: string[];
  period_month: string;
  payroll_period_id: string;
  [key: string]: unknown;
}

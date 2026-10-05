/**
 * S16-SOCIAL-FE-3 (L3) — lỗi của lời gọi GỬI báo cáo (`SOCIAL-API-027`, `POST /social/reports`): bảng
 * `mã → reason` RIÊNG của lời gọi này + cờ «gửi lại nguyên yêu cầu có thể thành công không».
 *
 * Bảng riêng (không dùng chung với 029) vì cùng một mã mang nghĩa khác: 404 `SOCIAL-ERR-001` ở 029 là
 * «báo cáo không còn», ở ĐÂY là «nội dung muốn báo cáo không còn» (bài và bình luận chung mã `001`); 409 ở
 * đây có HAI nghĩa ngược nhau — `REPORT-DUPLICATE-OPEN` là kết cục (đã có báo cáo đang mở của chính người
 * này), `IDEMPOTENCY-IN-PROGRESS` là tạm thời (lượt gửi trước cùng khoá còn đang chạy).
 *
 * MỌI lỗi của 027 đều GIỮ hộp thoại + nội dung đã nhập (plan §3 L3) — khác 029, ở đây không có gì ở trang
 * cần làm mới, nên hành vi chỉ còn một cờ `retryable`.
 *
 * `reason` thuộc tập đóng `ADMIN_ERROR_REASONS` ⇒ đưa thẳng vào `<AdminErrorNotice reason>`; `message` của
 * server không đi qua trường nào ở đây.
 */
import { IDEMPOTENCY_ERROR_CODES, SOCIAL_ERROR_CODES } from "@mediaos/contracts";
import {
  adminErrorReason,
  type AdminErrorReason,
  type AdminErrorTable,
} from "../../admin/lib/admin-errors";

/** `POST_NOT_FOUND` = `COMMENT_NOT_FOUND` = `SOCIAL-ERR-001`: một hàng phủ cả hai loại đích. */
export const CREATE_REPORT_ERROR_TABLE = {
  [SOCIAL_ERROR_CODES.REPORT_DUPLICATE_OPEN]: "reportDuplicate",
  [SOCIAL_ERROR_CODES.POST_NOT_FOUND]: "reportTargetGone",
  [IDEMPOTENCY_ERROR_CODES.IN_PROGRESS]: "busy",
} as const satisfies AdminErrorTable;

export interface CreateReportErrorOutcome {
  reason: AdminErrorReason;
  /**
   * `true` ⇒ vẽ «Thử lại» (gửi lại với CÙNG `attemptId` — plan D20). `false` ⇒ lỗi kết cục: không truyền
   * `onRetry` cho `AdminErrorNotice`, và câu chữ của reason đó cũng không hứa thử lại.
   */
  retryable: boolean;
}

/**
 * Reason thử lại được. `busy`: lượt trước xong thì cùng khoá sẽ nhận lại phản hồi của nó. `generic`: 5xx
 * / mạng. Mọi reason khác (trùng báo cáo · đích không còn · 403 · 400) gửi lại vẫn ra đúng lỗi đó.
 */
const RETRYABLE_REASONS: ReadonlySet<AdminErrorReason> = new Set(["busy", "generic"]);

export function describeCreateReportError(err: unknown): CreateReportErrorOutcome {
  const reason = adminErrorReason(err, CREATE_REPORT_ERROR_TABLE);
  return { reason, retryable: RETRYABLE_REASONS.has(reason) };
}

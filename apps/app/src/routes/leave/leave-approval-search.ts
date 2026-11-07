/**
 * S20-DASH-TODAY-1 — `?request=<uuid>` của `/leave/approvals`: mở sẵn dialog chi tiết đơn.
 *
 * Giá trị rác KHÔNG ném (không vỡ trang): router parse search bằng JSON.parse nên `?request=123` tới đây
 * là SỐ — bỏ khỏi search; chuỗi không phải UUID giữ nguyên để trang báo «không tìm thấy». Không bao giờ
 * thành lời gọi API (kiểm UUID TRƯỚC mọi request).
 */
export const LEAVE_APPROVAL_REQUEST_PARAM = "request";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLeaveRequestUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export interface LeaveApprovalSearch {
  request?: string;
}

export function validateLeaveApprovalSearch(search: Record<string, unknown>): LeaveApprovalSearch {
  const raw = search[LEAVE_APPROVAL_REQUEST_PARAM];
  // Không phải chuỗi (`?request=123` → số, object…) ⇒ BỎ khỏi search: router không viết lại URL thành
  // `?request=%22123%22`, trang không mở dialog, 0 lời gọi API.
  if (typeof raw !== "string" || raw === "") return {};
  return { request: raw };
}

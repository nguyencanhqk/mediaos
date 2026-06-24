/**
 * api-idempotency.ts — Tạo Idempotency-Key cho action quan trọng (FRONTEND-04 §11.2, §11.3).
 *
 * Các action cần idempotency key:
 * - Check-in / check-out
 * - Tạo đơn nghỉ / duyệt / từ chối
 * - Tạo nhân viên
 * - Tạo task / dự án
 * - Upload file (nếu backend hỗ trợ)
 *
 * Không cần: GET list/detail, login, mark notification read.
 */

/**
 * Tạo idempotency key: `<prefix>_<uuid>` hoặc `<uuid>` nếu không có prefix.
 *
 * Prefix giúp phân biệt loại action khi truy vết log:
 * - `attendance_check_in`
 * - `leave_request_create`
 * - `employee_create`
 * - `task_status_update`
 * - `file_upload`
 */
export function createIdempotencyKey(prefix?: string): string {
  let id: string;

  try {
    id = crypto.randomUUID();
  } catch {
    // Fallback cho môi trường test không có crypto shim đầy đủ
    id = `${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }

  return prefix ? `${prefix}_${id}` : id;
}

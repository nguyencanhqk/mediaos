/**
 * S16-SOCIAL-FE-3 — LÝ DO của một lỗi ở cụm quản trị bảng tin (Kiểm duyệt · Báo cáo; PR sau: Thống kê ·
 * Huy hiệu). Plan D5.
 *
 * ┌─ VÌ SAO KHÔNG DÙNG `ActionErrorBanner` + `groupErrorReason` ──────────────────────────────────┐
 * │ Cụm này có nhiều lời gọi mà CÙNG một mã mang nghĩa khác nhau: 404 `SOCIAL-ERR-001` là «báo cáo │
 * │ không còn» ở 029, «bài không còn» ở 006, «nội dung muốn báo cáo không còn» ở 027; 409 thì có   │
 * │ ba nghĩa (đã xử lý · đang bị người khác giữ · trùng báo cáo đang mở). Một hàm tra chung theo   │
 * │ status sẽ nói sai lý do. Nên: mỗi lời gọi khai MỘT bảng `mã → reason` của riêng nó, và hàm ở   │
 * │ đây chỉ làm phép tra + ba nhánh dự phòng theo status.                                          │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Thứ tự phân xử của `adminErrorReason`:
 *   1. MÃ có trong bảng của lời gọi ⇒ reason của bảng (thắng status: 403 `REPORT-ACTION-DENIED` là
 *      «không có quyền cho HÀNH ĐỘNG KÈM», không phải «không có quyền vào màn»).
 *   2. 403 ⇒ `forbidden` — MỌI mã, kể cả `SOCIAL-ERR-010` và `AUTH-ERR-FORBIDDEN`.
 *   3. 400 ⇒ `invalidRequest`.
 *   4. còn lại (5xx · mạng · ZodError · không phải Error) ⇒ `generic`.
 *
 * Kết quả LUÔN là một reason của tập đóng — `AdminErrorNotice` chỉ nhận reason, không nhận chuỗi, nên
 * `message` của server không có đường nào lên màn hình.
 */
import { ApiError } from "@mediaos/web-core";
import { socialErrorCode } from "../../groups/lib/group-errors";

/**
 * Tập ĐÓNG các lý do mà PR-A (lát L2 Kiểm duyệt + L3 Báo cáo) dùng. Mỗi phần tử có đúng một câu ở
 * `social:admin.error.<reason>`. Lát sau (Thống kê · Huy hiệu) tự nối reason của mình vào đây.
 */
export const ADMIN_ERROR_REASONS = [
  // Dùng chung.
  "generic",
  "forbidden",
  "invalidRequest",
  "busy",
  // 029 — kết thúc báo cáo.
  "reportAlreadyDecided",
  "reportBusy",
  "reportActionDenied",
  "reportActionInvalid",
  "reportTargetUnavailable",
  "reportGone",
  // 006 — hiện lại bài đang ẩn.
  "postGone",
  // 027 — gửi báo cáo.
  "reportDuplicate",
  "reportTargetGone",
] as const;
export type AdminErrorReason = (typeof ADMIN_ERROR_REASONS)[number];

/**
 * Bảng `mã lỗi trên dây → reason` của MỘT lời gọi. Khoá là `ApiError.code` — mã SOCIAL
 * (`SOCIAL_ERROR_CODES`) hoặc mã dùng chung (vd `IDEMPOTENCY_ERROR_CODES.IN_PROGRESS`).
 */
export type AdminErrorTable = Readonly<Record<string, AdminErrorReason>>;

const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;

/**
 * Mã dùng để tra bảng: mã SOCIAL nếu đọc được (kể cả hình dạng API cũ — mã chỉ nằm ở tiền tố `message`,
 * xem `socialErrorCode`), ngược lại là `code` nguyên văn (mã dùng chung như idempotency).
 */
function lookupCode(err: ApiError): string {
  return socialErrorCode(err) ?? err.code;
}

export function adminErrorReason(err: unknown, table: AdminErrorTable): AdminErrorReason {
  if (!(err instanceof ApiError)) return "generic";

  const code = lookupCode(err);
  // `Object.hasOwn`, KHÔNG `table[code]` trần: `code` đến từ server, và một mã trùng tên thuộc tính của
  // `Object.prototype` (`constructor`, `toString`…) sẽ tra ra một HÀM thay vì một reason.
  if (Object.hasOwn(table, code)) {
    const reason = table[code];
    if (reason !== undefined) return reason;
  }

  if (err.status === HTTP_FORBIDDEN) return "forbidden";
  if (err.status === HTTP_BAD_REQUEST) return "invalidRequest";
  return "generic";
}

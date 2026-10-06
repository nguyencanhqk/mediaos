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
 * ⚠️ `generic` gộp hai thứ KHÁC nhau: server ĐÃ TỪ CHỐI (4xx — kết cục xác định: chưa ghi) và KHÔNG có
 * gì chứng minh điều đó (5xx · mất phản hồi · hết hạn chờ · 2xx mà thân hỏng schema — server có thể đã
 * ghi). Lời gọi nào mà khác biệt đó đổi việc phải làm (lượt GHI không idempotent: 029 · 006) thì hỏi
 * `isDefiniteRefusal` TRƯỚC và dùng reason `outcomeUnknown` cho nhánh sau — xem `moderation-errors`.
 *
 * Kết quả LUÔN là một reason của tập đóng — `AdminErrorNotice` chỉ nhận reason, không nhận chuỗi, nên
 * `message` của server không có đường nào lên màn hình.
 */
import { ApiError } from "@mediaos/web-core";
import { socialErrorCode } from "../../groups/lib/group-errors";

/**
 * Tập ĐÓNG các lý do của cụm quản trị: PR-A (lát L2 Kiểm duyệt + L3 Báo cáo) + PR-B (lát L4 Huy hiệu).
 * Mỗi phần tử có đúng một câu ở `social:admin.error.<reason>`. Lát sau (Thống kê) tự nối reason của mình
 * vào đây.
 */
export const ADMIN_ERROR_REASONS = [
  // Dùng chung.
  "generic",
  "forbidden",
  "invalidRequest",
  "busy",
  // Lượt GHI không có câu trả lời đọc được: chưa rõ server đã ghi hay chưa (KHÔNG phải «không thực hiện được»).
  "outcomeUnknown",
  // Lượt ĐỌC danh sách hỏng — câu riêng, để không lẫn với lỗi của một lượt ghi đứng cạnh nó.
  "loadFailed",
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
  // 049 — tạo huy hiệu.
  "badgeCodeTaken",
  // 050 · 051 — sửa / ngừng dùng / bật lại huy hiệu.
  "badgeGone",
] as const;
export type AdminErrorReason = (typeof ADMIN_ERROR_REASONS)[number];

/**
 * Bảng `mã lỗi trên dây → reason` của MỘT lời gọi. Khoá là `ApiError.code` — mã SOCIAL
 * (`SOCIAL_ERROR_CODES`) hoặc mã dùng chung (vd `IDEMPOTENCY_ERROR_CODES.IN_PROGRESS`).
 */
export type AdminErrorTable = Readonly<Record<string, AdminErrorReason>>;

const HTTP_FORBIDDEN = 403;
const HTTP_BAD_REQUEST = 400;
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

/**
 * Mã dùng để tra bảng: mã SOCIAL nếu đọc được (kể cả hình dạng API cũ — mã chỉ nằm ở tiền tố `message`,
 * xem `socialErrorCode`), ngược lại là `code` nguyên văn (mã dùng chung như idempotency).
 */
function lookupCode(err: ApiError): string {
  return socialErrorCode(err) ?? err.code;
}

/**
 * Server ĐÃ TỪ CHỐI yêu cầu bằng một 4xx ⇒ kết cục xác định: chưa ghi. `false` = không có gì chứng minh
 * điều đó — với một lượt GHI, server có thể đã ghi:
 *   · không phải `ApiError`: lỗi mạng · hết hạn chờ · `ZodError` trên thân 2xx · thứ không phải `Error`;
 *   · `ApiError` 5xx: `api-client` biến MỌI phản hồi non-2xx thành `ApiError`, kể cả 502/503/504 do
 *     reverse proxy sinh khi API restart / treo (thân không phải envelope ⇒ mã `HTTP_ERROR`) — upstream có
 *     thể đã commit rồi mới mất đường về; 500 có envelope cũng có thể nổ SAU commit (lúc dựng phản hồi);
 *   · `ApiError` không mang status HTTP (0).
 * `instanceof ApiError` một mình KHÔNG trả lời được câu hỏi này.
 */
export function isDefiniteRefusal(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status >= HTTP_CLIENT_ERROR_MIN &&
    err.status < HTTP_SERVER_ERROR_MIN
  );
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

/**
 * Reason của một lượt GHI mà «đã ghi hay chưa» đổi việc phải làm (029 · 006 · 049 · 050 · 051): tách
 * «server đã TỪ CHỐI (4xx)» khỏi «không có gì chứng minh là chưa ghi» (5xx · không có câu trả lời đọc
 * được) TRƯỚC khi tra bảng — nhánh sau là `outcomeUnknown`, không được nói «Không thực hiện được».
 */
export function writeErrorReason(err: unknown, table: AdminErrorTable): AdminErrorReason {
  return isDefiniteRefusal(err) ? adminErrorReason(err, table) : "outcomeUnknown";
}

/**
 * Reason của một lượt ĐỌC danh sách: không bao giờ ra `generic` — «Không thực hiện được…» là câu của một
 * lượt ghi, mà dải lỗi tải có thể đứng ngay cạnh dải kết cục của lượt ghi vừa XONG. Mọi lỗi không khớp
 * bảng và không phải 403 / 400 ⇒ `loadFailed`.
 */
export function readErrorReason(err: unknown, table: AdminErrorTable): AdminErrorReason {
  const reason = adminErrorReason(err, table);
  return reason === "generic" ? "loadFailed" : reason;
}

/**
 * Bảng «việc phải làm sau lỗi» theo reason của MỘT lời gọi. Hàng `generic` BẮT BUỘC: reason không có
 * hàng riêng dùng hàng đó (giữ nguyên hiện trạng + cho thử lại).
 */
export type AdminBehaviorTable<B> = Readonly<Partial<Record<AdminErrorReason, B>>> & {
  readonly generic: B;
};

/** Hàng của `reason`; tra bằng `Object.hasOwn` như `adminErrorReason`. */
export function behaviorOf<B>(table: AdminBehaviorTable<B>, reason: AdminErrorReason): B {
  const rows: Readonly<Partial<Record<AdminErrorReason, B>>> = table;
  return (Object.hasOwn(rows, reason) ? rows[reason] : undefined) ?? table.generic;
}

/**
 * S16-SOCIAL-FILEDISPOSITION-1 — quy tắc kiểu nội dung của FileService (hàm THUẦN, không I/O, không Nest).
 *
 * `files.service.ts` chỉ GỌI các hàm ở đây; mọi quyết định "kiểu nào được đăng ký" và "object ở storage có
 * khớp khai báo không" nằm tại một chỗ để đọc và kiểm thử được mà không dựng service.
 *
 * Dùng lại quy tắc của tầng storage (`storage/content-serving.ts`) — KHÔNG có bản thứ hai của phép thường
 * hoá MIME, của nhóm kiểu bị từ chối, hay của tập đuôi chặn cứng.
 */
import { FOUNDATION_FILE_ERROR_CODES, type FoundationFileErrorCode } from "@mediaos/contracts";
import {
  fileNameExtension,
  servedFileName,
  servedFileNameExtensions,
} from "../../storage/content-disposition";
import {
  HARD_BLOCKED_EXTENSIONS,
  isActiveContentMime,
  normalizeMimeForCompare,
} from "../../storage/content-serving";

/**
 * Lý do một lượt confirm thất bại — ghi vào `files.metadata.confirmFailure` và `deniedReason`.
 * `content-type-mismatch` = storage CÓ trả kiểu và nó khác kiểu đã đăng ký; `content-type-unknown` = storage
 * KHÔNG trả kiểu nào. Tách hai lý do để khi storage đổi hành vi, dấu vết nói được là «vắng» hay «lệch».
 */
export type ConfirmFailureReason =
  | "object-absent"
  | "size-mismatch"
  | "content-type-mismatch"
  | "content-type-unknown";

/**
 * Lý do → mã lỗi ghi vào audit. `Record` trên kiểu hợp: thêm một lý do mà quên khai mã ⇒ KHÔNG biên dịch
 * (không còn nhánh "lý do lạ ⇒ mã mặc định").
 */
export const CONFIRM_FAILURE_ERROR_CODE: Record<ConfirmFailureReason, FoundationFileErrorCode> = {
  "object-absent": FOUNDATION_FILE_ERROR_CODES.CONFIRM_ABSENT,
  "size-mismatch": FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
  "content-type-mismatch": FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
  "content-type-unknown": FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
};

/** Kết quả so kiểu storage đang LƯU với kiểu đã ĐĂNG KÝ. Chỉ `match` mới được coi là khớp. */
export type StoredContentTypeVerdict = "match" | "mismatch" | "unknown";

/**
 * So kiểu storage đang LƯU cho object với kiểu đã ĐĂNG KÝ ở hàng `files`, sau thường hoá (`trim` · chữ thường
 * · bỏ tham số sau `;`).
 *   - `unknown`: storage KHÔNG trả kiểu (`null` hoặc rỗng sau `trim`);
 *   - `mismatch`: storage có trả mà khác — kể cả khi một trong hai vế sai dạng. Hai vế cùng sai dạng KHÔNG
 *     được coi là khớp;
 *   - `match`: hai vế thường hoá ra cùng một `type/subtype`.
 * Fail-closed: bên gọi chỉ đi tiếp với `match`.
 */
export function compareStoredContentType(
  registeredMimeType: string,
  storedContentType: string | null,
): StoredContentTypeVerdict {
  if (storedContentType === null || storedContentType.trim() === "") return "unknown";
  const registered = normalizeMimeForCompare(registeredMimeType);
  const stored = normalizeMimeForCompare(storedContentType);
  if (registered === null || stored === null) return "mismatch";
  return registered === stored ? "match" : "mismatch";
}

/** Số ký tự tối đa của MỘT giá trị ngoài được chép vào dòng log. */
const LOG_VALUE_MAX_CHARS = 120;
const LOG_CLIPPED_MARK = "...";
const NON_PRINTABLE_ASCII = /[^ -~]/g;

/**
 * Đưa một chuỗi do bên ngoài điều khiển (kiểu storage trả, kiểu client khai, thông điệp lỗi chứa chúng)
 * vào MỘT dòng log: cắt, `JSON.stringify` (bọc nháy, thoát nháy + ký tự điều khiển), rồi thay mọi ký tự
 * ngoài ASCII in được bằng `?`. Đầu ra không bao giờ chứa ký tự ngắt dòng ⇒ giá trị không tự mở được dòng
 * log mới; chữ có dấu trong giá trị cũng thành `?` — chấp nhận đổi lấy điều đó.
 */
export function quoteForLog(value: string | null): string {
  if (value === null) return "null";
  const clipped =
    value.length > LOG_VALUE_MAX_CHARS
      ? value.slice(0, LOG_VALUE_MAX_CHARS) + LOG_CLIPPED_MARK
      : value;
  return JSON.stringify(clipped).replace(NON_PRINTABLE_ASCII, "?");
}

/** Một lượt confirm bị từ chối vì kiểu nội dung: lý do để ghi, câu trả cho client, dòng cho log server. */
export interface ConfirmContentTypeFailure {
  reason: Extract<ConfirmFailureReason, "content-type-mismatch" | "content-type-unknown">;
  /** Câu cho người dùng — KHÔNG chép kiểu nào (cả kiểu đã đăng ký lẫn kiểu storage trả). */
  message: string;
  /** Dòng log: lý do · `fileId` · `companyId` · kiểu đã đăng ký · kiểu storage trả. Không khoá object, không URL. */
  logLine: string;
}

const CONTENT_TYPE_FAILURE_MESSAGE: Record<ConfirmContentTypeFailure["reason"], string> = {
  "content-type-mismatch": "kiểu nội dung ở storage khác kiểu đã đăng ký.",
  "content-type-unknown": "storage không trả kiểu nội dung của object.",
};

/**
 * Xét kiểu storage trả cho object của `row` lúc confirm. `null` = khớp, đi tiếp. Khác `null` = phải thất bại
 * (fail-closed) với lý do + dòng log trả về ở đây.
 */
export function confirmContentTypeFailure(
  row: { id: string; companyId: string; mimeType: string },
  storedContentType: string | null,
): ConfirmContentTypeFailure | null {
  const verdict = compareStoredContentType(row.mimeType, storedContentType);
  if (verdict === "match") return null;
  const reason = verdict === "unknown" ? "content-type-unknown" : "content-type-mismatch";
  return {
    reason,
    message: CONTENT_TYPE_FAILURE_MESSAGE[reason],
    logLine:
      `confirm rejected (${reason}): fileId=${row.id} companyId=${row.companyId} ` +
      `registeredType=${quoteForLog(row.mimeType)} storedType=${quoteForLog(storedContentType)}`,
  };
}

/**
 * Dòng log khi tầng ký từ chối một lượt đăng ký đã qua allowlist công ty (lệch giữa cấu hình công ty và
 * trần của tầng lưu trữ): `kind` · `companyId` · kiểu khai · thông điệp gốc của tầng ký.
 */
export function describeSignRejection(
  companyId: string,
  declaredMimeType: string,
  error: { kind: string; message: string },
): string {
  return (
    `upload signing rejected: kind=${error.kind} companyId=${companyId} ` +
    `declaredType=${quoteForLog(declaredMimeType)} detail=${quoteForLog(error.message)}`
  );
}

/** Vì sao một lượt đăng ký bị từ chối CỨNG (không phụ thuộc cấu hình công ty). */
export type RegisterContentRejection = "active-mime" | "hard-blocked-extension";

/**
 * Xét một lượt đăng ký theo hai lưới cứng trong code — không setting công ty nào mở được:
 *   - `active-mime`: kiểu khai thuộc nhóm trình duyệt tự dựng thành tài liệu (xét TRƯỚC);
 *   - `hard-blocked-extension`: đuôi thuộc tập chặn cứng. Tập này HỢP với `file.blocked_extensions` của
 *     công ty (bên gọi vẫn áp setting), không thay nó.
 * `null` = không lưới nào ở đây chặn. Kiểu SAI DẠNG không thuộc phạm vi hàm này — allowlist công ty và
 * trần của tầng storage chặn chúng.
 *
 * `fileExtension` là đuôi server đã suy từ tên; hàm tự hạ chữ thường + bỏ dấu chấm đầu để không phụ thuộc
 * bên gọi đã chuẩn hoá hay chưa. `null` = tệp không đuôi.
 */
export function registerContentRejection(
  declaredMimeType: string,
  fileExtension: string | null,
): RegisterContentRejection | null {
  if (isActiveContentMime(declaredMimeType)) return "active-mime";
  if (fileExtension === null) return null;
  return isHardBlockedExtension(fileExtension) ? "hard-blocked-extension" : null;
}

function isHardBlockedExtension(extension: string): boolean {
  return HARD_BLOCKED_EXTENSIONS.has(extension.replace(/^\./, "").toLowerCase());
}

/** Kết quả xét phần mở rộng của một tên tệp lúc đăng ký. */
export interface RegisterExtensionVerdict {
  /** Đuôi chính (của tên chuẩn sẽ phát ra): lưu cột `file_extension`, đối chiếu đuôi ↔ MIME. `null` = không đuôi. */
  fileExtension: string | null;
  /** Đuôi bị chặn ĐẦU TIÊN tìm thấy; `null` = không dạng tên nào mang đuôi bị chặn. */
  blockedExtension: string | null;
}

/**
 * Xét phần mở rộng của `fileName` (tên đã bỏ đường dẫn) trên CHÍNH các tên server sẽ phát ra khi tải về —
 * dạng Unicode lẫn dạng dự phòng ASCII (`storage/content-disposition.ts`) — chứ không trên tên thô. Đuôi của
 * BẤT KỲ dạng nào thuộc tập chặn cứng HOẶC `companyBlockedExtensions` ⇒ bị chặn; nhờ vậy đuôi mà một máy
 * khách lưu xuống luôn là đuôi đã qua phép so này.
 *
 * `companyBlockedExtensions`: chữ thường, không dấu chấm đầu (dạng `loadUploadLimits` đã chuẩn hoá).
 */
export function resolveRegisterExtension(
  fileName: string,
  companyBlockedExtensions: ReadonlySet<string>,
): RegisterExtensionVerdict {
  const blockedExtension = servedFileNameExtensions(fileName).find(
    (extension) => isHardBlockedExtension(extension) || companyBlockedExtensions.has(extension),
  );
  return {
    fileExtension: fileNameExtension(servedFileName(fileName)),
    blockedExtension: blockedExtension ?? null,
  };
}

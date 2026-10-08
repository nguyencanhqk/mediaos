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

/** Lý do một lượt confirm thất bại — ghi vào `files.metadata.confirmFailure` và `deniedReason`. */
export type ConfirmFailureReason = "object-absent" | "size-mismatch" | "content-type-mismatch";

/**
 * Lý do → mã lỗi ghi vào audit. `Record` trên kiểu hợp: thêm một lý do mà quên khai mã ⇒ KHÔNG biên dịch
 * (không còn nhánh "lý do lạ ⇒ mã mặc định").
 */
export const CONFIRM_FAILURE_ERROR_CODE: Record<ConfirmFailureReason, FoundationFileErrorCode> = {
  "object-absent": FOUNDATION_FILE_ERROR_CODES.CONFIRM_ABSENT,
  "size-mismatch": FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
  "content-type-mismatch": FOUNDATION_FILE_ERROR_CODES.CONFIRM_MISMATCH,
};

/**
 * `true` khi kiểu storage đang LƯU cho object khớp kiểu đã ĐĂNG KÝ ở hàng `files`, so sau thường hoá
 * (`trim` · chữ thường · bỏ tham số sau `;`).
 *
 * Fail-closed: storage không trả kiểu, hoặc BẤT KỲ vế nào thường hoá ra `null` (rỗng / sai dạng) ⇒ `false`
 * — hai vế cùng không dùng được KHÔNG được coi là khớp.
 */
export function storedContentTypeMatches(
  registeredMimeType: string,
  storedContentType: string | null,
): boolean {
  const registered = normalizeMimeForCompare(registeredMimeType);
  const stored = normalizeMimeForCompare(storedContentType);
  if (registered === null || stored === null) return false;
  return registered === stored;
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

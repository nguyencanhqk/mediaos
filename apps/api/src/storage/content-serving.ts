/**
 * S16-SOCIAL-FILEDISPOSITION-1 — quy tắc phục vụ nội dung (hàm THUẦN, không I/O, không phụ thuộc Nest).
 *
 * MỘT nơi quyết định storage trả một object về trình duyệt với kiểu nào và có kèm `attachment` hay không,
 * dựa trên MIME đã ĐĂNG KÝ ở hàng `files` (không dựa trên kiểu object đang lưu ở storage):
 *   - Hiển thị trực tiếp CHỈ cho danh sách tường minh {@link INLINE_SERVE_MIME_TYPES} — không theo tiền tố
 *     `image/` hay `video/`.
 *   - Mọi kiểu khác ⇒ `attachment` (trình duyệt tải xuống).
 *   - MIME rỗng · sai dạng · thuộc nhóm trình duyệt tự dựng ({@link isActiveContentMime}) ⇒ kiểu trả là
 *     {@link FALLBACK_SERVE_MIME} + `attachment` (fail-closed).
 * Kiểu trả LUÔN là `type/subtype` đã thường hoá — không bao giờ là chuỗi của hàng nguyên văn.
 */
import { buildAttachmentDisposition } from "./content-disposition";

/** Kiểu trả khi MIME đã đăng ký không dùng được để phục vụ. */
export const FALLBACK_SERVE_MIME = "application/octet-stream";

/** Các kiểu được trình duyệt hiển thị trực tiếp (không `attachment`). Danh sách TƯỜNG MINH. */
export const INLINE_SERVE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
]);

/**
 * Đuôi tệp bị từ chối CỨNG lúc đăng ký — HỢP với `file.blocked_extensions` của công ty, không thay nó.
 * Chữ thường, không dấu chấm.
 */
export const HARD_BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "xhtml",
  "xht",
  "shtml",
  "svg",
  "svgz",
  "xml",
  "xsl",
  "xslt",
]);

/** Kiểu trình duyệt tự dựng thành tài liệu. So bằng TẬP ĐÚNG các chuỗi này + hậu tố {@link ACTIVE_SUFFIX}. */
const ACTIVE_CONTENT_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
]);

/**
 * Hậu tố cấu trúc của họ XML. So bằng `endsWith` — KHÔNG so chuỗi con: các kiểu OOXML
 * (`application/vnd.openxmlformats-officedocument.*`) chứa chữ `xml` mà là tài liệu văn phòng hợp lệ.
 */
const ACTIVE_SUFFIX = "+xml";

/** `type/subtype` theo token của RFC 6838 (đã chữ thường). */
const MIME_SHAPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/**
 * Thường hoá MIME CHỈ ĐỂ SO: `trim` · chữ thường · bỏ phần tham số sau `;`.
 * Rỗng hoặc không khớp dạng `type/subtype` ⇒ `null`. KHÔNG dùng kết quả này để LƯU hay để ký PUT.
 */
export function normalizeMimeForCompare(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const [essence = ""] = raw.split(";");
  const normalized = essence.trim().toLowerCase();
  return MIME_SHAPE.test(normalized) ? normalized : null;
}

/** `true` khi MIME (sau thường hoá) thuộc nhóm trình duyệt tự dựng. MIME sai dạng ⇒ `false`. */
export function isActiveContentMime(raw: string): boolean {
  const normalized = normalizeMimeForCompare(raw);
  if (normalized === null) return false;
  return ACTIVE_CONTENT_MIME_TYPES.has(normalized) || normalized.endsWith(ACTIVE_SUFFIX);
}

/** Hai tham số `response-*` đưa vào URL GET đã ký. */
export interface ServeDirectives {
  responseContentType: string;
  /** `undefined` = hiển thị trực tiếp. KHÔNG dùng chuỗi rỗng (SDK vẫn sinh tham số rỗng). */
  responseContentDisposition: string | undefined;
}

/**
 * Quyết định kiểu trả + disposition cho một tệp theo MIME đã đăng ký và tên gốc của nó.
 * Hàm toàn phần — không ném với bất kỳ đầu vào nào.
 */
export function resolveServeDirectives(
  registeredMimeType: string,
  fileName: string,
): ServeDirectives {
  const normalized = normalizeMimeForCompare(registeredMimeType);
  if (normalized !== null && INLINE_SERVE_MIME_TYPES.has(normalized)) {
    return { responseContentType: normalized, responseContentDisposition: undefined };
  }
  const servable = normalized !== null && !isActiveContentMime(normalized);
  return {
    responseContentType: servable ? normalized : FALLBACK_SERVE_MIME,
    responseContentDisposition: buildAttachmentDisposition(fileName),
  };
}

/**
 * S16-SOCIAL-FILEDISPOSITION-1 — tự kiểm URL đã ký (hàm THUẦN, fail-closed).
 *
 * Sau khi SDK ký xong, tầng storage kiểm lại rằng URL mang đúng ràng buộc về kiểu nội dung:
 *   - URL PUT: `content-type` nằm trong `X-Amz-SignedHeaders`;
 *   - URL GET: có tham số `response-content-type`.
 * Thiếu ⇒ ném {@link StoragePresignInvariantError} và KHÔNG trả URL. Mục đích: một lần nâng SDK làm mất
 * ràng buộc sẽ nổ to thay vì lặng lẽ phát URL thiếu ràng buộc.
 *
 * Thông điệp lỗi KHÔNG chứa URL, khoá object hay chữ ký — an toàn để ghi log.
 */

export type PresignOperation = "PUT" | "GET";

export class StoragePresignInvariantError extends Error {
  readonly operation: PresignOperation;

  constructor(operation: PresignOperation, detail: string) {
    super(`URL ${operation} đã ký không đạt bất biến: ${detail}`);
    this.name = "StoragePresignInvariantError";
    this.operation = operation;
  }
}

const SIGNED_HEADERS_PARAM = "x-amz-signedheaders";
const RESPONSE_CONTENT_TYPE_PARAM = "response-content-type";
const CONTENT_TYPE_HEADER = "content-type";

/** Đọc một tham số query theo tên KHÔNG phân biệt hoa-thường; `null` khi URL không phân tích được / vắng. */
function readQueryParam(url: string, lowerCaseName: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  for (const [name, value] of params) {
    if (name.toLowerCase() === lowerCaseName) return value;
  }
  return null;
}

/** URL PUT phải ký header `content-type` — nếu không storage nhận mọi kiểu người gửi tự đặt. */
export function assertPresignedPutSignsContentType(url: string): void {
  const signedHeaders = readQueryParam(url, SIGNED_HEADERS_PARAM);
  const names = (signedHeaders ?? "").split(";").map((name) => name.trim().toLowerCase());
  if (!names.includes(CONTENT_TYPE_HEADER)) {
    throw new StoragePresignInvariantError("PUT", "content-type không nằm trong các header đã ký");
  }
}

/** URL GET phải mang `response-content-type` (khác rỗng) — kiểu trả được ghim vào chữ ký. */
export function assertPresignedGetPinsContentType(url: string): void {
  const pinned = readQueryParam(url, RESPONSE_CONTENT_TYPE_PARAM);
  if (pinned === null || pinned.trim() === "") {
    throw new StoragePresignInvariantError("GET", "thiếu tham số response-content-type");
  }
}

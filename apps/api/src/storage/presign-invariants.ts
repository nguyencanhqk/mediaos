/**
 * S16-SOCIAL-FILEDISPOSITION-1 — tự kiểm URL đã ký (hàm THUẦN, fail-closed).
 *
 * Sau khi SDK ký xong, tầng storage kiểm lại rằng URL mang đúng ràng buộc về kiểu nội dung:
 *   - URL PUT: `content-type` nằm trong `X-Amz-SignedHeaders`;
 *   - URL GET: `response-content-type` VÀ `response-content-disposition` có mặt đúng MỘT lần, TÊN đúng
 *     nguyên văn chữ thường, và BẰNG đúng giá trị server định ký (so sau khi giải mã tham số) — có mặt mà
 *     khác giá trị, hoặc tên viết hoa khác đi, cũng là không đạt.
 * Không đạt ⇒ ném {@link StoragePresignInvariantError} và KHÔNG trả URL. Mục đích: một lần nâng SDK làm mất
 * hoặc làm lệch ràng buộc sẽ nổ to thay vì lặng lẽ phát URL thiếu ràng buộc.
 *
 * Thông điệp lỗi KHÔNG chứa URL, khoá object, chữ ký hay GIÁ TRỊ của tham số (disposition mang tên tệp) —
 * chỉ nêu tên tham số; an toàn để ghi log.
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

/** Hai giá trị `response-*` mà URL GET đã ký PHẢI mang (đúng từng ký tự). */
export interface PresignedGetExpectation {
  responseContentType: string;
  responseContentDisposition: string;
}

const SIGNED_HEADERS_PARAM = "x-amz-signedheaders";
const RESPONSE_CONTENT_TYPE_PARAM = "response-content-type";
const RESPONSE_CONTENT_DISPOSITION_PARAM = "response-content-disposition";
const CONTENT_TYPE_HEADER = "content-type";

/** Một lần xuất hiện của tham số query: TÊN đúng như trên URL + giá trị đã giải mã. */
interface QueryParamOccurrence {
  name: string;
  value: string;
}

/**
 * Lần xuất hiện DUY NHẤT của một tham số query, dò tên KHÔNG phân biệt hoa-thường; `null` = vắng.
 * Dò không phân biệt hoa-thường là để bắt bản TRÙNG khác cách viết; bên gọi tự quyết có nhận tên viết khác
 * chữ thường hay không. URL không phân tích được, hoặc tham số xuất hiện hơn một lần (không rõ storage dùng
 * giá trị nào) ⇒ ném.
 */
function readSingleQueryParam(
  operation: PresignOperation,
  url: string,
  lowerCaseName: string,
): QueryParamOccurrence | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    throw new StoragePresignInvariantError(operation, "URL không phân tích được");
  }
  const occurrences: QueryParamOccurrence[] = [];
  for (const [name, value] of params) {
    if (name.toLowerCase() === lowerCaseName) occurrences.push({ name, value });
  }
  if (occurrences.length > 1) {
    throw new StoragePresignInvariantError(
      operation,
      `tham số ${lowerCaseName} xuất hiện ${occurrences.length} lần`,
    );
  }
  return occurrences[0] ?? null;
}

/** URL PUT phải ký header `content-type` — nếu không storage nhận mọi kiểu người gửi tự đặt. */
export function assertPresignedPutSignsContentType(url: string): void {
  const signedHeaders = readSingleQueryParam("PUT", url, SIGNED_HEADERS_PARAM)?.value ?? "";
  const names = signedHeaders.split(";").map((name) => name.trim().toLowerCase());
  if (!names.includes(CONTENT_TYPE_HEADER)) {
    throw new StoragePresignInvariantError("PUT", "content-type không nằm trong các header đã ký");
  }
}

/**
 * Một tham số `response-*` của URL GET phải có mặt với TÊN đúng nguyên văn chữ thường và bằng đúng giá trị
 * kỳ vọng. Tên viết hoa khác đi ⇒ coi như THIẾU: lớp tự kiểm chỉ nhận đúng dạng tên mà lớp ký phát ra.
 */
function assertGetParamEquals(url: string, lowerCaseName: string, expected: string): void {
  const occurrence = readSingleQueryParam("GET", url, lowerCaseName);
  if (occurrence === null || occurrence.name !== lowerCaseName) {
    throw new StoragePresignInvariantError("GET", `thiếu tham số ${lowerCaseName}`);
  }
  const actual = occurrence.value;
  if (actual !== expected) {
    throw new StoragePresignInvariantError(
      "GET",
      `tham số ${lowerCaseName} khác giá trị server định ký`,
    );
  }
}

/**
 * URL GET phải ghim CẢ kiểu trả lẫn disposition vào phần đã ký, đúng giá trị server đã quyết định. Thiếu
 * một trong hai thì storage trả giá trị đang lưu kèm object cho phần thiếu.
 */
export function assertPresignedGetPinsServeDirectives(
  url: string,
  expected: PresignedGetExpectation,
): void {
  assertGetParamEquals(url, RESPONSE_CONTENT_TYPE_PARAM, expected.responseContentType);
  assertGetParamEquals(
    url,
    RESPONSE_CONTENT_DISPOSITION_PARAM,
    expected.responseContentDisposition,
  );
}

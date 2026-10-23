/**
 * Trải chuỗi `Error.cause` thành object log được.
 *
 * Vì sao cần: Drizzle bọc lỗi PG và GIẤU mã lỗi (SQLSTATE) trong `cause`
 * (memory `drizzle-wraps-pg-error-code-in-cause`). Log mỗi `error.message` là vứt đúng thứ duy nhất
 * phân biệt được 42501 với cạn connection pool.
 *
 * Có TRẦN ĐỘ SÂU: chuỗi `cause` có thể tự tham chiếu vòng; không có trần thì hàm quan sát này tự
 * đệ quy vô hạn — tức một hàm sinh ra để chẩn đoán sự cố lại thành sự cố.
 *
 * Quy ước log của `PermissionService`: `{ error: serializeErrorChain(error), stack: error.stack }` —
 * Nest chỉ nhận stack khi nó là CHUỖI ở trường riêng, nên stack không nằm trong object này.
 * Tách khỏi `permission.service.ts` (S14-SEC-CAPWILDCARD-1, gate F4) để tệp đó không dài thêm.
 */
export function serializeErrorChain(error: unknown, depth = 0): unknown {
  if (depth >= 4) return "[cause chain truncated]";
  if (!(error instanceof Error)) return error === undefined ? undefined : String(error);
  return {
    name: error.name,
    message: error.message,
    code: (error as { code?: unknown }).code,
    cause: error.cause === undefined ? undefined : serializeErrorChain(error.cause, depth + 1),
  };
}

/**
 * api-request-id.ts — Tạo X-Request-Id cho mỗi API request (FRONTEND-04 §11.1).
 *
 * Mỗi request gửi header `X-Request-Id: req_<uuid>` để backend có thể correlate
 * log + trả lại trong meta.request_id của response (dùng khi cần hỗ trợ).
 */

/**
 * Tạo request ID duy nhất: `req_<uuid>`.
 *
 * Dùng `crypto.randomUUID()` — có sẵn trong browser (ES2022) và Node ≥ 14.17.
 * Nếu chạy trong môi trường không có crypto.randomUUID (test stub), fallback sang
 * Math.random để KHÔNG ném ở unit test.
 */
export function createRequestId(): string {
  try {
    return `req_${crypto.randomUUID()}`;
  } catch {
    // Fallback cho môi trường test không có crypto shim đầy đủ
    return `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  }
}

import type { CorsOptions } from "@nestjs/common/interfaces/external/cors-options.interface";

/**
 * S1-FND-CORS-EXPOSE-1 — tuỳ chọn CORS HTTP của API, tách khỏi `main.ts` thành hàm thuần để test được
 * (import `main.ts` sẽ khởi động server vì cuối tệp gọi `bootstrap()`).
 *
 * - `origin`: danh sách cố định lấy từ `CORS_ORIGIN` (tách dấu phẩy + trim) — KHÔNG nới.
 * - `credentials: true`: FE gửi cookie/Authorization cross-origin — KHÔNG đổi.
 * - `exposedHeaders`: header response JS phía FE được phép đọc khi cross-origin. Thiếu
 *   `Content-Disposition` ⇒ FE không thấy tên tệp server đặt cho file tải về (xuất CSV/XLSX…) và phải
 *   tự dựng tên dự phòng (tên dự phòng phía FE vẫn GIỮ làm lưới).
 */
export const CORS_EXPOSED_HEADERS: readonly string[] = ["Content-Disposition"];

export function buildCorsOptions(corsOrigin: string): CorsOptions {
  return {
    origin: corsOrigin.split(",").map((o) => o.trim()),
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS],
  };
}

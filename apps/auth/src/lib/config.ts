/**
 * Cấu hình apps/auth (đọc từ build env Vite). Tách `import.meta.env` ở app (KHÔNG vào package dùng chung).
 *
 * `DEFAULT_APP_URL`: landing mặc định khi đăng nhập xong mà `?redirect` vắng/không hợp lệ (server từ chối).
 * Dev = product app `web.localhost`. Prod đặt qua `VITE_DEFAULT_APP_URL`.
 */
export const DEFAULT_APP_URL: string =
  import.meta.env.VITE_DEFAULT_APP_URL ?? "http://web.localhost:5273";

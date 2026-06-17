import { ApiError, refreshAccessToken } from "./api-client";
import { authApi } from "./auth-api";
import { useAuthStore } from "../stores/auth";

/**
 * FS-1b — khởi tạo phiên SSO khi app load (silent-refresh). Gọi `refreshAccessToken()` (cookie-first,
 * single-flight) để lấy access token in-memory; nếu có phiên hợp lệ → gọi /me nạp profile + capabilities →
 * store sẵn sàng → trả true. Không có phiên (refresh fail) → false (caller điều hướng về apps/auth).
 *
 * /me thất bại SAU khi refresh thành công = lỗi tạm/không-phải-auth → xoá state cục bộ (KHÔNG gọi logout
 * endpoint, tránh phụ thuộc mạng thêm) + trả false. Dedupe cấp bootstrap (StrictMode dev double-invoke) để
 * /me cũng chỉ chạy 1 lần.
 */
let bootstrapInFlight: Promise<boolean> | null = null;

async function doBootstrap(): Promise<boolean> {
  const refreshed = await refreshAccessToken();
  if (!refreshed) return false;
  try {
    const me = await authApi.me();
    useAuthStore.getState().setUser(me, me.capabilities);
    return true;
  } catch (err) {
    // Refresh OK nhưng /me lỗi → xoá access token mồ côi (chỉ store action, không chạm mạng). Caller redirect.
    useAuthStore.getState().logout();
    // Phân biệt 401-thật (phiên bị từ chối — apiFetch đã refresh+replay 1 lần trước khi tới đây) với lỗi TẠM
    // (5xx/mạng). Cả hai vẫn false (không render được khi thiếu /me), nhưng lỗi-tạm phát tín hiệu cho operator:
    // mass-logout do hạ tầng ≠ phiên hỏng hàng loạt. Tránh "im lặng đăng xuất" khó chẩn đoán khi có sự cố.
    if (!(err instanceof ApiError) || err.status !== 401) {
      console.error("[web-core] bootstrap /me thất bại (không phải 401 — nghi sự cố tạm):", err);
    }
    return false;
  }
}

/** Silent-refresh khi load app — single-flight ở cấp bootstrap (StrictMode-safe). */
export function bootstrapSession(): Promise<boolean> {
  if (bootstrapInFlight === null) {
    bootstrapInFlight = doBootstrap().finally(() => {
      bootstrapInFlight = null;
    });
  }
  return bootstrapInFlight;
}

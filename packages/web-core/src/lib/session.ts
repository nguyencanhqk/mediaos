import { ApiError, refreshAccessToken } from "./api-client";
import { authApi } from "./auth-api";
import { meApi } from "./me-api";
import { applyTheme } from "./theme";
import { useAuthStore } from "../stores/auth";

/**
 * FS-1b — khởi tạo phiên SSO khi app load (silent-refresh). Gọi `refreshAccessToken()` (cookie-first,
 * single-flight) để lấy access token in-memory; nếu có phiên hợp lệ → gọi /me nạp profile + capabilities →
 * store sẵn sàng → trả true. Không có phiên (refresh fail) → false (caller điều hướng về apps/auth).
 *
 * /me thất bại SAU khi refresh thành công = lỗi tạm/không-phải-auth → xoá state cục bộ (KHÔNG gọi logout
 * endpoint, tránh phụ thuộc mạng thêm) + trả false. Dedupe cấp bootstrap (StrictMode dev double-invoke) để
 * /me cũng chỉ chạy 1 lần.
 *
 * S5-ME-FE-3 — sync theme SERVER→CLIENT ngay sau /me: gọi `meApi.getPreferences()` rồi `applyTheme()` nếu
 * có giá trị. FAIL-SOFT TUYỆT ĐỐI: lỗi/không có preference (chưa liên kết, network tạm, 403…) → GIỮ
 * NGUYÊN theme local đã lưu (localStorage qua app bootstrap script) — KHÔNG đổi giá trị trả về của
 * `bootstrapSession` (vẫn true khi /me OK), KHÔNG chặn render app vì 1 nguồn phụ (preferences) lỗi.
 */
let bootstrapInFlight: Promise<boolean> | null = null;

/** Đồng bộ theme từ server (best-effort) — KHÔNG BAO GIỜ throw ra ngoài, KHÔNG ảnh hưởng bootstrap. */
async function syncThemeFromServer(): Promise<void> {
  try {
    const prefs = await meApi.getPreferences();
    if (prefs.theme != null) applyTheme(prefs.theme);
  } catch {
    // Lỗi/không có preference → giữ nguyên theme local đã áp (bootstrap script / lần đăng nhập trước).
  }
}

async function doBootstrap(): Promise<boolean> {
  const refreshed = await refreshAccessToken();
  if (!refreshed) return false;
  try {
    const me = await authApi.me();
    useAuthStore.getState().setUser(me, me.capabilities);
    // Cờ ép-enroll-2FA (AUTH-003) — set RIÊNG (setUser giữ nguyên chữ ký cho các call site khác không đổi).
    useAuthStore.getState().setMustSetupTwoFactor(me.mustSetupTwoFactor);
    await syncThemeFromServer();
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

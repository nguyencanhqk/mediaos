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
 *
 * S10-PERF-LOADPATH-1 — theme-sync KHÔNG còn được `await` trong `doBootstrap`. Fail-soft trước đây chỉ
 * chặn theo LỖI; theo ĐỘ TRỄ thì nó vẫn chặn: `main.tsx` của cả ba SPA chỉ gọi `createRoot()` SAU khi
 * `bootstrapSession()` resolve, nên preferences là round-trip thứ BA nối tiếp (refresh → /me →
 * preferences) nằm trên đường render. Qua cloudflared mỗi call đo được 0.5–3.5s ⇒ nguồn PHỤ chỉ để đổi
 * theme kéo dài màn hình trắng thêm chừng ấy. Nay chạy nền: theme local (đã áp bởi bootstrap script
 * trong index.html) hiển thị ngay, giá trị server ghi đè khi về. Test/caller cần điểm đồng bộ thì dùng
 * `whenThemeSynced()` — KHÔNG đưa promise này vào đường render.
 */
let bootstrapInFlight: Promise<boolean> | null = null;

/** Promise của lần theme-sync gần nhất. Chỉ để test/caller chờ ĐIỂM ĐỒNG BỘ — không nằm trên đường render. */
let themeSyncInFlight: Promise<void> = Promise.resolve();

/**
 * Chờ lần theme-sync nền gần nhất xong. `syncThemeFromServer` nuốt mọi lỗi nên promise này KHÔNG BAO GIỜ
 * reject. Dùng trong test (và chỗ nào thật sự cần biết theme server đã áp xong), KHÔNG dùng khi mount app.
 */
export function whenThemeSynced(): Promise<void> {
  return themeSyncInFlight;
}

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
    // KHÔNG await — xem ghi chú S10-PERF-LOADPATH-1 ở đầu file. Gán vào `themeSyncInFlight` (thay vì thả
    // trôi) để `whenThemeSynced()` còn chỗ bám; `syncThemeFromServer` không bao giờ throw nên promise này
    // không thể thành unhandled rejection.
    themeSyncInFlight = syncThemeFromServer();
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

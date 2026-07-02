import { create } from "zustand";
import { normalizeUserStatus } from "../lib/registry";

interface User {
  id: string;
  companyId: string;
  email: string;
  fullName: string | null;
  status: string;
}

interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  /** @deprecated G1 mock compat only — use user.email after real login. */
  username: string | null;
  /** JWT access token. Null until real login completes. */
  accessToken: string | null;
  /** JWT refresh token. Null until real login completes. */
  refreshToken: string | null;
  /** Non-sensitive action:resourceType capabilities keyed for O(1) useCan() lookup. */
  capabilities: Record<string, boolean>;
  /**
   * true khi role/company ép 2FA (BE two-factor-enforcement.guard.ts) nhưng user CHƯA enroll — FE (apps/app
   * ProtectedShell) đọc cờ này để buộc điều hướng màn enroll TRƯỚC khi vào app (S2-FE-AUTH-6, AUTH-003).
   * Nguồn sự thật là server (/auth/me.mustSetupTwoFactor) — client KHÔNG tự suy luận.
   */
  mustSetupTwoFactor: boolean;
  /** Called after real /me to populate user profile + capabilities. */
  setUser: (user: User, capabilities: Record<string, boolean>) => void;
  /** Cập nhật cờ ép-enroll-2FA riêng (session.ts gọi kèm setUser sau mỗi /me — KHÔNG đổi chữ ký setUser). */
  setMustSetupTwoFactor: (mustSetupTwoFactor: boolean) => void;
  /**
   * FS-1b: lưu CHỈ access token in-memory (luồng SSO cookie). Refresh token nằm trong HttpOnly cookie,
   * JS KHÔNG bao giờ chạm → silent-refresh / refresh-on-401 dùng hàm này, KHÔNG `setTokens`.
   */
  setAccessToken: (accessToken: string) => void;
  /**
   * Lưu access + refresh token sau real-login (luồng Bearer cũ / mobile). ⚠️ Luồng SSO cookie KHÔNG dùng —
   * refresh token PHẢI ở HttpOnly cookie ngoài tầm với của JS (chống XSS). Dùng `setAccessToken` thay thế.
   */
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  username: null,
  accessToken: null,
  refreshToken: null,
  capabilities: {},
  mustSetupTwoFactor: false,
  // Chuẩn hoá status thô từ /me ('active'|'suspended') → canonical Title-case TẠI ĐÂY (chokepoint duy nhất
  // ghi `user` vào store) → mọi nơi đọc state.user.status (guard route, ProtectedShell, layouts) nhận giá trị
  // đã chuẩn, sửa 403 USER_INACTIVE oan do lệch hoa/thường.
  setUser: (user, capabilities) =>
    set({
      isAuthenticated: true,
      user: { ...user, status: normalizeUserStatus(user.status) },
      username: user.email,
      capabilities,
    }),
  setMustSetupTwoFactor: (mustSetupTwoFactor) => set({ mustSetupTwoFactor }),
  // CHỦ Ý: chỉ set access token, KHÔNG đặt isAuthenticated. Bất biến: `isAuthenticated === true` ⟺ đã có user
  // + capabilities (setUser). Access token đơn lẻ (sau silent-refresh, TRƯỚC /me) chưa đủ để render UI có quyền
  // → guard/useCan không bao giờ thấy trạng thái "authed nhưng user=null". setUser mới bật cờ.
  setAccessToken: (accessToken) => set({ accessToken }),
  setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
  logout: () =>
    set({
      isAuthenticated: false,
      user: null,
      username: null,
      accessToken: null,
      refreshToken: null,
      capabilities: {},
      mustSetupTwoFactor: false,
    }),
}));

/** Đọc access token hiện tại (cho api client gắn Authorization header). Trả null nếu chưa đăng nhập thật. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

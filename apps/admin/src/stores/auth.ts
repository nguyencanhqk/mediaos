import { create } from "zustand";

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
  /** JWT access token (operator). Null until login completes.
   *  AC-0b sẽ ràng buộc `aud=operator` ở tầng verify — store chỉ giữ token thô. */
  accessToken: string | null;
  /** JWT refresh token. Null until login completes. */
  refreshToken: string | null;
  /** Non-sensitive action:resourceType capabilities keyed for O(1) useCan() lookup. */
  capabilities: Record<string, boolean>;
  /** Called after /me to populate user profile + capabilities. */
  setUser: (user: User, capabilities: Record<string, boolean>) => void;
  /** Lưu access + refresh token sau login. */
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
}

/**
 * ⚠️ BẢO MẬT (control plane god-mode): token operator chỉ giữ TRONG BỘ NHỚ (heap).
 * CẤM thêm `persist` middleware (localStorage/sessionStorage) cho store này — sẽ phơi token
 * operator ra XSS. Hardening đầy đủ (httpOnly cookie + `credentials:"include"`, aud=operator,
 * step-up, session TTL ngắn) là việc của AC-0b theo ADR-0019. Không persist ở AC-0a.
 */
export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  accessToken: null,
  refreshToken: null,
  capabilities: {},
  setUser: (user, capabilities) => set({ isAuthenticated: true, user, capabilities }),
  setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
  logout: () =>
    set({
      isAuthenticated: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      capabilities: {},
    }),
}));

/** Đọc access token hiện tại (cho api client gắn Authorization header). Trả null nếu chưa đăng nhập. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

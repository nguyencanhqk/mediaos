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
  /** username kept for G1 mock compatibility */
  username: string | null;
  /**
   * Access token JWT cho các API cần xác thực (vd 2FA settings). DORMANT cho tới khi real-login FE land
   * (login hiện vẫn mock G1). `getAccessToken()` đọc giá trị này; `setTokens` set khi real-login xong.
   */
  accessToken: string | null;
  /** Non-sensitive action:resourceType capabilities from /me — keyed for O(1) useCan() lookup. */
  capabilities: Record<string, boolean>;
  /** G1 mock login — sets username only, no real auth. */
  login: (username: string) => void;
  /** Called after real /me response to populate user profile + capabilities. */
  setUser: (user: User, capabilities: Record<string, boolean>) => void;
  /** Lưu access token sau real-login (ready-to-wire). */
  setTokens: (accessToken: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  username: null,
  accessToken: null,
  capabilities: {},
  login: (username) => set({ isAuthenticated: true, username }),
  setUser: (user, capabilities) =>
    set({ isAuthenticated: true, user, username: user.email, capabilities }),
  setTokens: (accessToken) => set({ accessToken }),
  logout: () =>
    set({ isAuthenticated: false, user: null, username: null, accessToken: null, capabilities: {} }),
}));

/** Đọc access token hiện tại (cho api client gắn Authorization header). Trả null nếu chưa đăng nhập thật. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

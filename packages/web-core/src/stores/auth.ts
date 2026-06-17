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
  /** @deprecated G1 mock compat only — use user.email after real login. */
  username: string | null;
  /** JWT access token. Null until real login completes. */
  accessToken: string | null;
  /** JWT refresh token. Null until real login completes. */
  refreshToken: string | null;
  /** Non-sensitive action:resourceType capabilities keyed for O(1) useCan() lookup. */
  capabilities: Record<string, boolean>;
  /** Called after real /me to populate user profile + capabilities. */
  setUser: (user: User, capabilities: Record<string, boolean>) => void;
  /** Lưu access + refresh token sau real-login. */
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
  setUser: (user, capabilities) =>
    set({ isAuthenticated: true, user, username: user.email, capabilities }),
  setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
  logout: () =>
    set({
      isAuthenticated: false,
      user: null,
      username: null,
      accessToken: null,
      refreshToken: null,
      capabilities: {},
    }),
}));

/** Đọc access token hiện tại (cho api client gắn Authorization header). Trả null nếu chưa đăng nhập thật. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

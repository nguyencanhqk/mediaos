import { create } from "zustand";

/**
 * Auth state — MOCK ở G1 (chưa có backend auth, đó là G2-6).
 * Server là nguồn sự thật về quyền; store này chỉ giữ trạng thái UI tạm cho login mock.
 */
interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  login: (username: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  username: null,
  login: (username) => set({ isAuthenticated: true, username }),
  logout: () => set({ isAuthenticated: false, username: null }),
}));

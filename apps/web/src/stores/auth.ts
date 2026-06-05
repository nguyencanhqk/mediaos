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
  /** Non-sensitive action:resourceType capabilities from /me — keyed for O(1) useCan() lookup. */
  capabilities: Record<string, boolean>;
  /** G1 mock login — sets username only, no real auth. */
  login: (username: string) => void;
  /** Called after real /me response to populate user profile + capabilities. */
  setUser: (user: User, capabilities: Record<string, boolean>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  user: null,
  username: null,
  capabilities: {},
  login: (username) => set({ isAuthenticated: true, username }),
  setUser: (user, capabilities) =>
    set({ isAuthenticated: true, user, username: user.email, capabilities }),
  logout: () => set({ isAuthenticated: false, user: null, username: null, capabilities: {} }),
}));

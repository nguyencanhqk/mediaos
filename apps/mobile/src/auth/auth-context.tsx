import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { AuthTokens, MeResponse } from "@mediaos/contracts";
import { authApi } from "./auth-api";
import { clearTokens, getAccessToken, saveTokens } from "./token-storage";

interface AuthState {
  /** Loaded user profile; null = not logged in or not yet fetched. */
  user: MeResponse | null;
  /** True while restoring session or logging in/out. */
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  /** Save tokens and fetch /auth/me to populate user. */
  onLoginSuccess: (tokens: AuthTokens) => Promise<void>;
  /** Clear tokens and reset state. */
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, isLoading: true });

  /** Restore session on mount if an access token exists in SecureStore. */
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      try {
        const token = await getAccessToken();
        if (token) {
          const user = await authApi.me();
          if (!cancelled) setState({ user, isLoading: false });
        } else {
          if (!cancelled) setState({ user: null, isLoading: false });
        }
      } catch {
        // Token expired or invalid — clear and require re-login.
        await clearTokens();
        if (!cancelled) setState({ user: null, isLoading: false });
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLoginSuccess = useCallback(async (tokens: AuthTokens) => {
    setState((s) => ({ ...s, isLoading: true }));
    await saveTokens(tokens.accessToken, tokens.refreshToken);
    const user = await authApi.me();
    setState({ user, isLoading: false });
  }, []);

  const logout = useCallback(async () => {
    await clearTokens();
    setState({ user: null, isLoading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, onLoginSuccess, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

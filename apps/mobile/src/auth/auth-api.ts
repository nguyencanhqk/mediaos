import {
  authTokensSchema,
  loginResponseSchema,
  meResponseSchema,
  twoFactorVerifyRequestSchema,
  type AuthTokens,
  type LoginRequest,
  type LoginResponse,
  type MeResponse,
} from "@mediaos/contracts";
import { apiFetch } from "../api/client";

/**
 * Auth API client for mobile — mirrors apps/web/src/lib/auth-api.ts.
 * Endpoints:
 *   POST /auth/login        → LoginResponse (AuthTokens | TwoFactorChallenge)
 *   POST /auth/2fa/verify   → AuthTokens (step 2 when 2FA is enabled)
 *   GET  /auth/me           → MeResponse
 *   POST /auth/refresh      → AuthTokens
 */
export const authApi = {
  /**
   * Step 1 login: email + password + companySlug.
   * Returns AuthTokens directly (2FA off) or TwoFactorChallenge (2FA on).
   */
  login: (body: LoginRequest): Promise<LoginResponse> =>
    apiFetch("/auth/login", loginResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /**
   * Step 2 login (only when server returned TwoFactorChallenge).
   * challengeToken from step 1 + TOTP code (6 digits) or recovery code.
   */
  verifyTwoFactor: (challengeToken: string, code: string): Promise<AuthTokens> => {
    const payload = twoFactorVerifyRequestSchema.parse({ challengeToken, code });
    return apiFetch("/auth/2fa/verify", authTokensSchema, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  /** Fetch current user profile + capabilities. Requires valid access token in SecureStore. */
  me: (): Promise<MeResponse> =>
    apiFetch("/auth/me", meResponseSchema, { authenticated: true }),

  /** Refresh tokens using stored refresh token. */
  refresh: (refreshToken: string): Promise<AuthTokens> =>
    apiFetch("/auth/refresh", authTokensSchema, {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
};

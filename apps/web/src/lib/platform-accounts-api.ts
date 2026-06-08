import { z } from "zod";
import type {
  CreatePlatformAccountRequest,
  ReauthRequest,
  UpdatePlatformAccountSecretRequest,
} from "@mediaos/contracts";
import {
  reauthResponseSchema,
  revealSecretResponseSchema,
  safePlatformAccountSchema,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Platform Accounts API client (🔒 G6-2h) — crown-jewel reveal/edit surface.
 *
 * BẤT BIẾN client-side:
 *  - list/get/create/updateSecret parse qua `safePlatformAccountSchema` (masked 12 cột) — Zod STRIP
 *    mọi key lạ, nên dù server lỡ trả secret/recovery_* thì client cũng không giữ.
 *  - Plaintext CHỈ qua `reveal`/`revealWithReauth`, trả MỘT LẦN. Caller PHẢI giữ trong state ephemeral
 *    (KHÔNG query cache, KHÔNG zustand, KHÔNG localStorage). Xem secret-field.tsx / reauth-modal.tsx.
 */

/** Filter list (mirror ListPlatformAccountsQuery contract) — gửi sang `GET /platform-accounts`. */
export interface PlatformAccountFilters {
  platformId?: string;
  status?: string;
  q?: string;
}

function buildQuery(filters: PlatformAccountFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.platformId) qs.set("platformId", filters.platformId);
  if (filters.status) qs.set("status", filters.status);
  if (filters.q) qs.set("q", filters.q);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const platformAccountsApi = {
  // ── Read (masked projection) ────────────────────────────────────────────────
  list: (filters?: PlatformAccountFilters) =>
    apiFetch(`/platform-accounts${buildQuery(filters)}`, z.array(safePlatformAccountSchema)),

  get: (id: string) => apiFetch(`/platform-accounts/${id}`, safePlatformAccountSchema),

  // ── Mutations ───────────────────────────────────────────────────────────────
  create: (data: CreatePlatformAccountRequest) =>
    apiFetch("/platform-accounts", safePlatformAccountSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateSecret: (id: string, data: UpdatePlatformAccountSecretRequest) =>
    apiFetch(`/platform-accounts/${id}/secret`, safePlatformAccountSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // ── Step-up + reveal (ephemeral plaintext — KHÔNG cache) ────────────────────
  /** Mint per-(userId, accountId) re-auth window server-side (Valkey). Trả thời điểm hết hạn. */
  reauth: (data: ReauthRequest) =>
    apiFetch("/platform-accounts/reauth", reauthResponseSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Reveal plaintext MỘT LẦN. Caller PHẢI đã `reauth` trong cửa sổ còn hạn. KHÔNG cache kết quả. */
  reveal: (id: string) =>
    apiFetch(`/platform-accounts/${id}/reveal`, revealSecretResponseSchema, {
      method: "POST",
    }),

  /**
   * Step-up THEN reveal trong 1 lời gọi — đảm bảo thứ tự `reauth` → `reveal`.
   * Nếu `reauth` ném (sai mật khẩu / throttle), `reveal` KHÔNG được gọi (không lộ plaintext).
   * Trả plaintext thô; caller giữ trong state ephemeral và clear khi đóng/blur/unmount.
   */
  revealWithReauth: async (accountId: string, password: string, otp?: string): Promise<string> => {
    await platformAccountsApi.reauth({ accountId, password, otp });
    const { secret } = await platformAccountsApi.reveal(accountId);
    return secret;
  },
};

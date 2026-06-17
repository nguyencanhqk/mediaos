import { z } from "zod";
import { breakGlassGrantSchema, breakGlassRevealResponseSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * Break-glass API client (🔒 G6-2 PR-B ROUND 2) — emergency-access listing + JIT reveal.
 *
 * BẤT BIẾN client-side:
 *  - listMyGrants parse qua `breakGlassGrantSchema` (KHÔNG có secret/key field — Zod STRIP key lạ).
 *  - Plaintext CHỈ qua `reveal`, trả MỘT LẦN. Caller giữ trong state EPHEMERAL (SecretField) — KHÔNG query
 *    cache, KHÔNG zustand, KHÔNG localStorage. Reveal chỉ thành công khi caller có grant 'active' còn hạn
 *    của chính mình trên account đó (server ép cổng (a) permission + (b) active-grant; FE chỉ là gợi ý UI).
 */
export const breakGlassApi = {
  /** List the caller's OWN break-glass grants (status/approvalCount/expiresAt) — drives the reveal screen. */
  listMyGrants: () => apiFetch("/break-glass/grants", z.array(breakGlassGrantSchema)),

  /**
   * Reveal a platform_account secret via an active break-glass grant. Plaintext returned ONCE; the caller
   * must hold it only in ephemeral state and never cache it. `accountId` is the platform account to reveal.
   */
  reveal: (accountId: string) =>
    apiFetch(`/platform-accounts/${accountId}/break-glass-reveal`, breakGlassRevealResponseSchema, {
      method: "POST",
    }),
};

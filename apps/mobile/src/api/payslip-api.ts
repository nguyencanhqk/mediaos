import { z } from "zod";
import {
  payslipSchema,
  payslipSummarySchema,
  type PayslipDto,
  type PayslipSummaryDto,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Mobile payslip client — OWN self-service ONLY (employee views their own payslips). Mirrors the OWN
 * endpoints of apps/web/src/lib/payslip-api.ts (listOwn / reauthOwn / getOwn). Admin reveal routes are
 * intentionally NOT exposed on mobile.
 *
 * BẤT BIẾN #3 (lương nhạy cảm) — the security model this client must preserve:
 *  - The re-auth response is a STEP-UP WINDOW, not a token. The server stores the window in Valkey,
 *    keyed (userId, payslipId); the subsequent GET carries NO token — the server reads the window via
 *    PayslipReauthGuard. So `expiresAt` here is metadata only; it is NEVER stored as / used as an access
 *    token, and never persisted to SecureStore.
 *  - getOwn returns the FULL money snapshot. It is a DIRECT fetch — NEVER cached in React Query — so net
 *    /gross/base never enter the cache. The caller must keep the result in ephemeral component state and
 *    clear it on close/unmount.
 *  - listOwn returns a money-FREE projection (payslipSummarySchema has no monetary field). The server is
 *    the source of truth for the strip; this schema is defence-in-depth.
 *  - A lapsed window ⇒ getOwn returns 403 ⇒ caller re-prompts for the password (generic message, no leak).
 */

/** Step-up window response. Defined locally (NOT a contract / NOT a token) — mirror web reauthWindowSchema. */
export const reauthWindowSchema = z.object({ expiresAt: z.string().datetime() });
export type ReauthWindow = z.infer<typeof reauthWindowSchema>;

export const payslipApi = {
  /**
   * GET /payslips/me/list — money-FREE list of the caller's OWN payslips (view-own-payslip).
   * Ownership (user_id = self) is enforced SERVER-SIDE; the client passes no userId.
   */
  listOwn: (): Promise<PayslipSummaryDto[]> =>
    apiFetch("/payslips/me/list", z.array(payslipSummarySchema), { authenticated: true }),

  /**
   * POST /payslips/me/:id/reauth — opens a ~5-min step-up window for the caller's OWN payslip after
   * verifying the password. MUST precede getOwn. Returns the window metadata only (never a token).
   */
  reauthOwn: (id: string, password: string): Promise<ReauthWindow> =>
    apiFetch(`/payslips/me/${encodeURIComponent(id)}/reauth`, reauthWindowSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  /**
   * GET /payslips/me/:id — full money for the caller's OWN payslip, ONLY after reauthOwn opened the
   * window. DIRECT fetch (NOT via useQuery) so money never enters the cache. Keep the result ephemeral;
   * clear on close/unmount. Server enforces ownership + a valid re-auth window (else 403).
   */
  getOwn: (id: string): Promise<PayslipDto> =>
    apiFetch(`/payslips/me/${encodeURIComponent(id)}`, payslipSchema, { authenticated: true }),
};

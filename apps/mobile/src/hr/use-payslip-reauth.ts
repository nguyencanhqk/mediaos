import { useQuery } from "@tanstack/react-query";
import type { PayslipDto } from "@mediaos/contracts";
import { payslipApi } from "../api/payslip-api";

/** Query key for the money-FREE OWN payslip list. The list is safe to cache (no monetary field). */
export const OWN_PAYSLIPS_KEY = ["payslips", "mine", "summary"] as const;

/** GET /payslips/me/list — the caller's own money-FREE payslip summaries. */
export function useOwnPayslips() {
  return useQuery({ queryKey: OWN_PAYSLIPS_KEY, queryFn: payslipApi.listOwn });
}

/**
 * Step-up reveal of ONE payslip's full money, mirroring the web usePayslipReauthController:
 *  1. reauthOwn(id, password) — verify password → server opens a ~5-min window (Valkey).
 *  2. getOwn(id) — DIRECT fetch of the money snapshot (NEVER cached).
 *
 * INVARIANT: the PayslipDto returned here is plaintext money. It is returned to the caller ONCE and
 * never retained by this module, never written to the React Query cache, never persisted. The caller
 * MUST keep it in ephemeral component state and clear it on close/unmount. The re-auth response
 * (`expiresAt`) is a window, NOT a token — it is discarded here and never stored.
 *
 * Errors are intentionally NOT merged: a re-auth failure (wrong password / rate-limit / window not
 * durable) is distinct from a detail-load failure (e.g. window lapsed → 403), so the UI can tell the
 * user whether they were verified. Both surface generic messages via the caller (no leak).
 */
export async function revealOwnPayslip(payslipId: string, password: string): Promise<PayslipDto> {
  // Step 1: open the window. Throws on wrong password (401) / rate-limit (429) / outage (503).
  await payslipApi.reauthOwn(payslipId, password);
  // Step 2: fetch the money snapshot directly. Throws 403 if the window already lapsed.
  return payslipApi.getOwn(payslipId);
}

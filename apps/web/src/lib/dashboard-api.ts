import { dashboardSummarySchema } from "@mediaos/contracts";
import type { DashboardSummaryDto } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * GET /dashboard/summary — fetch role-filtered aggregate metrics.
 * Server returns only the data the caller is permitted to see (server-side masking).
 */
export async function getDashboardSummary(): Promise<DashboardSummaryDto> {
  return apiFetch("/dashboard/summary", dashboardSummarySchema);
}

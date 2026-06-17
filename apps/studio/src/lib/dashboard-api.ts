import { dashboardSummarySchema, reportResponseSchema } from "@mediaos/contracts";
import type { DashboardSummaryDto, ReportResponseDto } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * GET /dashboard/summary — fetch role-filtered aggregate metrics.
 * Server returns only the data the caller is permitted to see (server-side masking).
 */
export async function getDashboardSummary(): Promise<DashboardSummaryDto> {
  return apiFetch("/dashboard/summary", dashboardSummarySchema);
}

/**
 * GET /dashboard/report — fetch role-filtered report aggregate.
 * null fields = caller lacks the required permission for that section.
 */
export async function getDashboardReport(): Promise<ReportResponseDto> {
  return apiFetch("/dashboard/report", reportResponseSchema);
}

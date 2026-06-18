import { dashboardSummarySchema, reportResponseSchema } from "@mediaos/contracts";
import type { DashboardSummaryDto, ReportPeriod, ReportResponseDto } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * GET /dashboard/summary — fetch role-filtered aggregate metrics.
 * Server returns only the data the caller is permitted to see (server-side masking).
 */
export async function getDashboardSummary(): Promise<DashboardSummaryDto> {
  return apiFetch("/dashboard/summary", dashboardSummarySchema);
}

/**
 * GET /dashboard/report — fetch role-filtered report aggregate for the given period.
 * The server resolves `period` to a date range and computes the finance section over it; it also
 * re-validates the period (rejecting unknown values). null fields = caller lacks the required
 * permission for that section.
 */
export async function getDashboardReport(
  period: ReportPeriod = "thisMonth",
): Promise<ReportResponseDto> {
  return apiFetch(`/dashboard/report?period=${encodeURIComponent(period)}`, reportResponseSchema);
}

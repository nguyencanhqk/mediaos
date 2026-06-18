import {
  tenantUsageResponseSchema,
  type TenantUsageResponse,
  type UsageQuery,
} from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * CS-7 Usage API client cho apps/console.
 * GET /tenant/usage — tổng hợp tình hình sử dụng tenant (view:usage, is_sensitive=false).
 */

function buildUsageQuery(q: Partial<UsageQuery>): string {
  const qs = new URLSearchParams();
  if (q.dateFrom) qs.set("dateFrom", q.dateFrom);
  if (q.dateTo) qs.set("dateTo", q.dateTo);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const usageApi = {
  /** Tình hình sử dụng của tenant mình (company-admin, view:usage). */
  getTenantUsage: (q: Partial<UsageQuery> = {}): Promise<TenantUsageResponse> =>
    apiFetch(`/tenant/usage${buildUsageQuery(q)}`, tenantUsageResponseSchema),
};

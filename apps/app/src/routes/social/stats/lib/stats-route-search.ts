/** S16-SOCIAL-FE-3B (L5a) — KHUNG cho lượt RED: mọi hàm trả giá trị rỗng đúng kiểu, chưa có luật nào. */
import type { FeedEngagementParams } from "@mediaos/web-core";

export interface StatsDateRange {
  from: string;
  to: string;
}

export interface StatsRouteSearch {
  from?: string;
  to?: string;
  orgUnitId?: string;
}

export function validateStatsRouteSearch(_raw: Record<string, unknown>): StatsRouteSearch {
  return {};
}

export function hasCustomRange(_search: StatsRouteSearch): boolean {
  return false;
}

export function engagementParams(_search: StatsRouteSearch): FeedEngagementParams {
  return {};
}

export function searchForRange(
  _search: StatsRouteSearch,
  _range: StatsDateRange | null,
): StatsRouteSearch {
  return {};
}

export function searchForOrgUnit(
  _search: StatsRouteSearch,
  _orgUnitId: string | undefined,
): StatsRouteSearch {
  return {};
}

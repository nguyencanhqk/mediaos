/**
 * S16-SOCIAL-FE-3 (L2) — tham số URL của `/feed/moderation` (KHUNG — hiện thực ở commit kế tiếp).
 */
import type { ListFeedReportsQueryDto } from "@mediaos/contracts";

export const MODERATION_TABS = ["reports", "hidden"] as const;
export type ModerationTab = (typeof MODERATION_TABS)[number];

export const MODERATION_STATUS_FILTERS = ["open", "resolved", "dismissed", "all"] as const;
export type ModerationStatusFilter = (typeof MODERATION_STATUS_FILTERS)[number];

export const DEFAULT_MODERATION_TAB: ModerationTab = "reports";
export const DEFAULT_MODERATION_STATUS: ModerationStatusFilter = "open";
export const MODERATION_REPORTS_PAGE_SIZE = 20;

export interface ModerationRouteSearch {
  tab?: ModerationTab;
  status?: ModerationStatusFilter;
  page?: number;
}

export type ReportListParams = Pick<ListFeedReportsQueryDto, "page" | "limit"> &
  Partial<Pick<ListFeedReportsQueryDto, "status">>;

export function validateModerationRouteSearch(
  _raw: Record<string, unknown>,
): ModerationRouteSearch {
  return {};
}

export function activeModerationTab(_search: ModerationRouteSearch): ModerationTab {
  return "hidden";
}

export function activeStatusFilter(_search: ModerationRouteSearch): ModerationStatusFilter {
  return "all";
}

export function reportListParams(_search: ModerationRouteSearch): ReportListParams {
  return { page: 0, limit: 0 };
}

export function searchForStatusFilter(
  _search: ModerationRouteSearch,
  _status: ModerationStatusFilter,
): ModerationRouteSearch {
  return {};
}

export function searchForPage(
  _search: ModerationRouteSearch,
  _page: number,
): ModerationRouteSearch {
  return {};
}

export function searchForTab(
  _search: ModerationRouteSearch,
  _tab: ModerationTab,
): ModerationRouteSearch {
  return {};
}

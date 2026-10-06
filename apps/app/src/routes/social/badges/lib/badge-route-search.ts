/**
 * S16-SOCIAL-FE-3B (L4) — KHUNG (lượt RED): tham số URL của `/feed/kudos-badges`. Thân thật ở commit GREEN.
 */
import type { ListKudosBadgesAdminQueryDto } from "@mediaos/contracts";

export const BADGES_PAGE_SIZE = 0;

export interface BadgeRouteSearch {
  page?: number;
}

export type BadgeListParams = Pick<ListKudosBadgesAdminQueryDto, "page" | "limit">;

export function validateBadgeRouteSearch(_raw: Record<string, unknown>): BadgeRouteSearch {
  return {};
}

export function badgeListParams(_search: BadgeRouteSearch): BadgeListParams {
  return { page: 0, limit: 0 };
}

export function searchForBadgePage(_page: number): BadgeRouteSearch {
  return {};
}

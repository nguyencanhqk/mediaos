/** S16-SOCIAL-FE-3B (L5a) — KHUNG cho lượt RED: chưa vẽ gì. */
import type * as React from "react";
import type { FeedEngagementUnitDto } from "@mediaos/contracts";
import type { StatsRange } from "../lib/stats-range";
import type { StatsDateRange } from "../lib/stats-route-search";

export interface StatsFiltersProps {
  range: StatsRange;
  units: readonly FeedEngagementUnitDto[];
  orgUnitId: string | undefined;
  isCustomRange: boolean;
  onRangeChange: (range: StatsDateRange | null) => void;
  onOrgUnitChange: (orgUnitId: string | undefined) => void;
}

export function StatsFilters(_props: StatsFiltersProps): React.ReactElement | null {
  return null;
}

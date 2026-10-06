/** S16-SOCIAL-FE-3B (L5a) — KHUNG cho lượt RED: chưa vẽ gì, chưa gọi gì. */
import type * as React from "react";
import type { FeedEngagementParams } from "@mediaos/web-core";
import type { StatsDateRange } from "../lib/stats-route-search";

export interface ExportEngagementButtonProps {
  params: FeedEngagementParams;
  range: StatsDateRange | null;
}

export function ExportEngagementButton(
  _props: ExportEngagementButtonProps,
): React.ReactElement | null {
  return null;
}

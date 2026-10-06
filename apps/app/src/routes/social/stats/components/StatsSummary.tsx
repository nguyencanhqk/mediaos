/**
 * S16-SOCIAL-FE-3B (L5) — KHUNG của dải thẻ tổng quan màn Thống kê tương tác (lượt RED: chưa vẽ gì).
 */
import type * as React from "react";
import type { FeedEngagementWeekDto } from "@mediaos/contracts";

export interface StatsSummaryProps {
  weekTotals: readonly FeedEngagementWeekDto[];
}

export function StatsSummary(_props: StatsSummaryProps): React.ReactElement | null {
  return null;
}

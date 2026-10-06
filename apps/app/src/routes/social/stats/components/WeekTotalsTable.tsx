/**
 * S16-SOCIAL-FE-3B (L5) — bảng «Theo tuần» của màn Thống kê tương tác (`SOC-SCREEN-011`, nguồn `weekTotals`
 * của `SOCIAL-API-052`). `<table>` thuần trong khung cuộn ngang (plan D9).
 *
 * Chỉ TRÌNH BÀY: số lấy NGUYÊN từ server (`activeMembers` của một tuần là số người DISTINCT thật trên tập đã
 * lọc phạm vi — FE không tính lại được từ `rows`). `weekTotals` dày: tuần không hoạt động vẫn là một hàng số 0.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import type { FeedEngagementWeekDto } from "@mediaos/contracts";
import { formatCount } from "../lib/stats-aggregate";
import { useWeekLabel } from "../lib/use-stats-labels";

export interface WeekTotalsTableProps {
  weekTotals: readonly FeedEngagementWeekDto[];
}

const METRICS = ["posts", "comments", "reactions", "activeMembers"] as const;

const CELL = "px-3 py-2";
const NUMBER_CELL = cn(CELL, "text-right tabular-nums");

export function WeekTotalsTable({ weekTotals }: WeekTotalsTableProps): React.ReactElement {
  const { t } = useTranslation("social");
  const weekLabel = useWeekLabel();

  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid="stats-week-table">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <caption className="sr-only">{t("admin.stats.weekTable.caption")}</caption>
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th scope="col" className={cn(CELL, "text-left font-medium")}>
              {t("admin.stats.week.column")}
            </th>
            {METRICS.map((metric) => (
              <th key={metric} scope="col" className={cn(CELL, "text-right font-medium")}>
                {t(`admin.stats.metric.${metric}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekTotals.map((week) => (
            <tr key={week.weekStart} className="border-t border-border">
              <th scope="row" className={cn(CELL, "text-left font-medium text-foreground")}>
                {weekLabel(week.weekStart)}
              </th>
              {METRICS.map((metric) => (
                <td key={metric} className={NUMBER_CELL}>
                  {formatCount(week[metric])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

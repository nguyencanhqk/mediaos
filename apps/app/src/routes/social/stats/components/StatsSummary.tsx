/**
 * S16-SOCIAL-FE-3B (L5) — dải thẻ tổng quan của màn Thống kê tương tác (`SOC-SCREEN-011`, plan D12).
 *
 * Ba thẻ TỔNG (bài · bình luận · cảm xúc) = cộng `weekTotals` qua các tuần của khoảng đang xem.
 *
 * ┌─ 🔴 THẺ THÀNH VIÊN LÀ SỐ CỦA MỘT TUẦN ─────────────────────────────────────────────────────────────┐
 * │ `activeMembers` là số người DISTINCT của một tuần — cộng qua các tuần là đếm một người nhiều lần.    │
 * │ Thẻ lấy hàng `weekTotals` CUỐI (`latestWeek`) và ghi rõ đó là tuần nào. Tuần cuối không ai hoạt động │
 * │ thì thẻ là 0, không lùi về tuần có số.                                                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Chỉ TRÌNH BÀY: số lấy nguyên từ server, phép gộp ở `lib/stats-aggregate.ts`.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { StatCard } from "@mediaos/ui";
import type { FeedEngagementWeekDto } from "@mediaos/contracts";
import { formatCount, latestWeek, sumWeekTotals } from "../lib/stats-aggregate";
import { useWeekLabel } from "../lib/use-stats-labels";

export interface StatsSummaryProps {
  weekTotals: readonly FeedEngagementWeekDto[];
}

const TOTAL_METRICS = ["posts", "comments", "reactions"] as const;

export function StatsSummary({ weekTotals }: StatsSummaryProps): React.ReactElement {
  const { t } = useTranslation("social");
  const weekLabel = useWeekLabel();
  const totals = sumWeekTotals(weekTotals);
  const latest = latestWeek(weekTotals);

  return (
    <ul
      aria-label={t("admin.stats.page.summaryAria")}
      className="grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4"
    >
      {TOTAL_METRICS.map((metric) => (
        <li key={metric} data-metric={metric}>
          <StatCard
            label={t(`admin.stats.metric.${metric}`)}
            value={formatCount(totals[metric])}
            className="h-full"
          />
        </li>
      ))}
      <li data-metric="activeMembers">
        <StatCard
          label={t("admin.stats.page.latestWeekMembers")}
          value={formatCount(latest?.activeMembers ?? 0)}
          className="h-full"
        >
          {latest !== null && (
            <span className="text-xs text-muted-foreground">
              {t("admin.stats.page.latestWeekNote", { week: weekLabel(latest.weekStart) })}
            </span>
          )}
        </StatCard>
      </li>
    </ul>
  );
}

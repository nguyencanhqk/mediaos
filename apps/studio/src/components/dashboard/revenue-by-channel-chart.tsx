import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ReportSummaryDto } from "@mediaos/contracts";

interface RevenueByChannelChartProps {
  data: NonNullable<ReportSummaryDto["revenueByChannel"]>;
}

const BAR_COLOR = "#3b82f6";

function formatVnd(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

function buildTooltipFormatter(t: TFunction<"dashboard">) {
  return (v: unknown) => [
    new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(v as number),
    t("revenueByChannel.tooltipLabel"),
  ];
}

/**
 * RevenueByChannelChart — horizontal bar chart of monthly revenue per channel.
 * Receives server-filtered data; caller must check non-null before rendering.
 */
export function RevenueByChannelChart({ data }: RevenueByChannelChartProps) {
  const { t } = useTranslation("dashboard");
  const sorted = [...data].sort((a, b) => b.amount - a.amount).slice(0, 10);

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">
        {t("revenueByChannel.title")}
      </h3>
      <ResponsiveContainer width="100%" height={Math.max(120, sorted.length * 36)}>
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 0 }}
        >
          <XAxis
            type="number"
            tickFormatter={formatVnd}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="channelName"
            width={110}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip formatter={buildTooltipFormatter(t)} />
          <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
            {sorted.map((entry) => (
              <Cell key={entry.channelId} fill={BAR_COLOR} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

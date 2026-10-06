/**
 * S16-SOCIAL-FE-3B (L5) — biểu đồ xu hướng của màn Thống kê tương tác (`SOC-SCREEN-011`, plan D12).
 *
 * MỘT chuỗi: «tổng tương tác» mỗi tuần (bài + bình luận + cảm xúc). Không vẽ ba đường riêng: bảng màu của
 * `chart-theme` chỉ có hai màu chuỗi đã kiểm («chuỗi thứ 3 trở đi KHÔNG tự sinh màu»), và ba số đếm khác cỡ
 * nhau cả bậc thì đường nhỏ nằm bẹp sát trục. Ba thành phần vẫn tới được ở tooltip và ở BẢNG thay thế của
 * `ChartCard` (nút «Xem dạng bảng») — không giá trị nào chỉ đọc được bằng cách rê chuột.
 *
 * File này là nơi DUY NHẤT của cụm SOCIAL import `recharts`. Spec của trang MOCK file này: Recharts trong
 * jsdom không có layout (plan B13) — ca riêng của file chỉ là ca KHÓI.
 */
import type * as React from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FeedEngagementWeekDto } from "@mediaos/contracts";
import { ChartCard, type ChartTableView } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import {
  CHART_AXIS_TICK,
  CHART_COLORS,
  CHART_DOT,
  CHART_LINE_WIDTH,
} from "@/components/charts/chart-theme";
import { formatCount, weekInteractions } from "../lib/stats-aggregate";
import { formatStatsDate } from "../lib/stats-range";
import { useWeekLabel } from "../lib/use-stats-labels";

export interface EngagementTrendChartProps {
  weekTotals: readonly FeedEngagementWeekDto[];
}

interface TrendPoint {
  weekStart: string;
  /** Nhãn trục: ngày thứ Hai của tuần. */
  tick: string;
  interactions: number;
  posts: number;
  comments: number;
  reactions: number;
}

interface TooltipArgs {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

const BREAKDOWN = ["posts", "comments", "reactions"] as const;

const MARGIN = { top: 8, right: 16, bottom: 4, left: 4 } as const;
const AXIS = { tick: CHART_AXIS_TICK, axisLine: false, tickLine: false } as const;
const Y_AXIS_WIDTH = 48;

function toPoints(weekTotals: readonly FeedEngagementWeekDto[]): TrendPoint[] {
  return weekTotals.map((week) => ({
    weekStart: week.weekStart,
    tick: formatStatsDate(week.weekStart),
    interactions: weekInteractions(week),
    posts: week.posts,
    comments: week.comments,
    reactions: week.reactions,
  }));
}

function isTrendPoint(value: unknown): value is TrendPoint {
  return typeof value === "object" && value !== null && "weekStart" in value;
}

/** Điểm đang rê — `null` khi tooltip tắt. */
function activePoint(args: TooltipArgs): TrendPoint | null {
  if (args.active !== true) return null;
  const point = args.payload?.[0]?.payload;
  return isTrendPoint(point) ? point : null;
}

interface TrendTooltipProps {
  point: TrendPoint;
}

/** Tooltip của một tuần: tổng tương tác dẫn đầu (mang màu chuỗi), ba thành phần theo sau. */
function TrendTooltip({ point }: TrendTooltipProps): React.ReactElement {
  const { t } = useTranslation("social");
  const weekLabel = useWeekLabel();
  return (
    <ChartTooltip
      title={weekLabel(point.weekStart)}
      rows={[
        {
          key: "interactions",
          label: t("admin.stats.metric.interactions"),
          value: formatCount(point.interactions),
          color: CHART_COLORS.series1,
        },
        ...BREAKDOWN.map((metric) => ({
          key: metric,
          label: t(`admin.stats.metric.${metric}`),
          value: formatCount(point[metric]),
        })),
      ]}
    />
  );
}

function renderTooltip(args: TooltipArgs): React.ReactElement | null {
  const point = activePoint(args);
  return point === null ? null : <TrendTooltip point={point} />;
}

/** Bảng thay thế của `ChartCard`: mỗi tuần một hàng, tổng tương tác rồi ba thành phần. */
function useTrendTable(points: readonly TrendPoint[]): ChartTableView {
  const { t } = useTranslation("social");
  const weekLabel = useWeekLabel();
  return {
    columns: [
      t("admin.stats.week.column"),
      t("admin.stats.metric.interactions"),
      ...BREAKDOWN.map((metric) => t(`admin.stats.metric.${metric}`)),
    ],
    rows: points.map((point) => [
      weekLabel(point.weekStart),
      formatCount(point.interactions),
      ...BREAKDOWN.map((metric) => formatCount(point[metric])),
    ]),
  };
}

export function EngagementTrendChart({
  weekTotals,
}: EngagementTrendChartProps): React.ReactElement {
  const { t } = useTranslation("social");
  const points = toPoints(weekTotals);
  const table = useTrendTable(points);

  return (
    <ChartCard
      title={t("admin.stats.chart.title")}
      description={t("admin.stats.chart.description")}
      state={points.length === 0 ? "empty" : "ready"}
      emptyText={t("admin.stats.chart.empty")}
      table={table}
      testId="stats-trend-chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={MARGIN}>
          <CartesianGrid stroke={CHART_COLORS.grid} vertical={false} />
          <XAxis dataKey="tick" {...AXIS} />
          <YAxis allowDecimals={false} width={Y_AXIS_WIDTH} tickFormatter={formatCount} {...AXIS} />
          <Tooltip content={renderTooltip} />
          <Line
            type="monotone"
            dataKey="interactions"
            name={t("admin.stats.metric.interactions")}
            stroke={CHART_COLORS.series1}
            strokeWidth={CHART_LINE_WIDTH}
            dot={CHART_DOT}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

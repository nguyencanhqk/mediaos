import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_AREA_OPACITY,
  CHART_AXIS_TICK,
  CHART_BAR_MAX_SIZE,
  CHART_BAR_RADIUS_HORIZONTAL,
  CHART_COLORS,
  CHART_DOT,
  CHART_LINE_WIDTH,
  formatCompactMoney,
} from "@/components/charts/chart-theme";
import { ChartTooltip, type ChartTooltipRow } from "@/components/charts/ChartTooltip";
import { formatPayrollMoney } from "../../payroll-format";
import type { OrgUnitRow, StructureRow, TrendPoint } from "../../overview-data";

/**
 * S15-PAYROLL-FE-4 — 5 khối Recharts của PAY-SCREEN-015 (khối ngân sách là meter HTML — `BudgetMeter`).
 *
 * Dạng chọn theo VIỆC của dữ liệu (dataviz), có hai chỗ lệch chữ của `done_when` — ghi ở plan §2 D11:
 *  - Cơ cấu thu nhập = thanh ngang xếp hạng (MỘT màu) thay vì donut: 078 trả tới 8 khoản + «Khác» = 9 lớp,
 *    quá trần màu phân loại; thanh ngang đọc tỉ trọng chính xác hơn cung tròn.
 *  - Theo đơn vị = cột ngang thu nhập BQ, thấp nhất/cao nhất/số người ở tooltip + bảng — KHÔNG «cột + đường»
 *    hai trục (trục kép là lỗi biểu đồ số 1: hai thang đo cạnh nhau gợi tương quan không có thật).
 *
 * File này là nơi DUY NHẤT import `recharts` ⇒ thư viện nằm trong chunk lazy của trang Tổng quan.
 */

type TooltipArgs = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
};

/** Lấy hàng dữ liệu gốc của điểm đang rê — `null` khi tooltip tắt. */
function activeRow<T>(args: TooltipArgs): T | null {
  if (!args.active || !args.payload || args.payload.length === 0) return null;
  return (args.payload[0]?.payload as T | undefined) ?? null;
}

const GRID = { stroke: CHART_COLORS.grid, strokeDasharray: undefined } as const;
const AXIS = { tick: CHART_AXIS_TICK, axisLine: false, tickLine: false } as const;
const HOVER_CURSOR = { fill: "var(--muted)", opacity: 0.5 } as const;
const LABEL_STYLE = { fill: CHART_COLORS.axisText, fontSize: 12 } as const;

// ── Khối 1 — phân bố mức lương ────────────────────────────────────────────────────────────────────

export function SalaryDistributionChart({
  rows,
}: {
  rows: readonly { label: string; headcount: number }[];
}) {
  const { t } = useTranslation("payroll");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={[...rows]}
        layout="vertical"
        margin={{ top: 4, right: 32, bottom: 4, left: 4 }}
      >
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis type="category" dataKey="label" width={104} {...AXIS} />
        <Tooltip
          cursor={HOVER_CURSOR}
          content={(args: TooltipArgs) => {
            const row = activeRow<{ label: string; headcount: number }>(args);
            if (!row) return null;
            return (
              <ChartTooltip
                title={row.label}
                rows={[
                  {
                    key: "headcount",
                    label: t("overview.distribution.headcount"),
                    value: String(row.headcount),
                    color: CHART_COLORS.series1,
                  },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="headcount"
          fill={CHART_COLORS.series1}
          maxBarSize={CHART_BAR_MAX_SIZE}
          radius={CHART_BAR_RADIUS_HORIZONTAL}
          isAnimationActive={false}
        >
          <LabelList dataKey="headcount" position="right" style={LABEL_STYLE} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Khối 2 — cơ cấu thu nhập ──────────────────────────────────────────────────────────────────────

const pctLabel = (v: unknown) => (typeof v === "number" ? `${v.toLocaleString("vi-VN")} %` : "");

export function IncomeStructureChart({
  rows,
  otherLabel,
}: {
  rows: readonly StructureRow[];
  otherLabel: string;
}) {
  const { t } = useTranslation("payroll");
  const data = rows.map((r) => ({ ...r, name: r.isOther ? otherLabel : r.label }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" domain={[0, "dataMax"]} unit=" %" {...AXIS} />
        <YAxis type="category" dataKey="name" width={128} {...AXIS} />
        <Tooltip
          cursor={HOVER_CURSOR}
          content={(args: TooltipArgs) => {
            const row = activeRow<(typeof data)[number]>(args);
            if (!row) return null;
            return (
              <ChartTooltip
                title={row.name}
                rows={[
                  {
                    key: "amount",
                    label: t("overview.structure.amount"),
                    value: formatPayrollMoney(row.amount),
                    color: row.isOther ? CHART_COLORS.muted : CHART_COLORS.series1,
                  },
                  {
                    key: "share",
                    label: t("overview.structure.share"),
                    value: pctLabel(row.sharePct),
                  },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="sharePct"
          maxBarSize={CHART_BAR_MAX_SIZE}
          radius={CHART_BAR_RADIUS_HORIZONTAL}
          isAnimationActive={false}
        >
          {data.map((r) => (
            <Cell
              key={`${r.componentCode ?? ""}:${r.itemType}`}
              fill={r.isOther ? CHART_COLORS.muted : CHART_COLORS.series1}
            />
          ))}
          <LabelList dataKey="sharePct" position="right" style={LABEL_STYLE} formatter={pctLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Khối 4 — chi phí theo kỳ (một chuỗi ⇒ area) ───────────────────────────────────────────────────

export function CostTrendChart({ points }: { points: readonly TrendPoint[] }) {
  const { t } = useTranslation("payroll");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={[...points]} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis width={64} tickFormatter={formatCompactMoney} {...AXIS} />
        <Tooltip
          cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }}
          content={(args: TooltipArgs) => {
            const p = activeRow<TrendPoint>(args);
            if (!p) return null;
            const rows: ChartTooltipRow[] = [
              {
                key: "cost",
                label: t("overview.cost.totalCost"),
                value: formatPayrollMoney(p.totalCost),
                color: CHART_COLORS.series1,
              },
              {
                key: "gross",
                label: t("overview.cost.gross"),
                value: formatPayrollMoney(p.totalGross),
              },
              {
                key: "employer",
                label: t("overview.cost.employer"),
                value: formatPayrollMoney(p.employerStatutory),
              },
              { key: "headcount", label: t("overview.cost.headcount"), value: String(p.headcount) },
            ];
            return <ChartTooltip title={p.label} rows={rows} />;
          }}
        />
        <Area
          type="monotone"
          dataKey="totalCost"
          stroke={CHART_COLORS.series1}
          strokeWidth={CHART_LINE_WIDTH}
          fill={CHART_COLORS.series1}
          fillOpacity={CHART_AREA_OPACITY}
          activeDot={{ ...CHART_DOT, fill: CHART_COLORS.series1 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Khối 5 — thu nhập bình quân theo kỳ (hai chuỗi, có chú giải) ─────────────────────────────────

export function AverageIncomeChart({ points }: { points: readonly TrendPoint[] }) {
  const { t } = useTranslation("payroll");
  const grossLabel = t("overview.average.avgGross");
  const netLabel = t("overview.average.avgNet");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={[...points]} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis width={64} tickFormatter={formatCompactMoney} {...AXIS} />
        <Legend
          verticalAlign="top"
          align="left"
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, color: CHART_COLORS.axisText, paddingBottom: 8 }}
        />
        <Tooltip
          cursor={{ stroke: CHART_COLORS.grid, strokeWidth: 1 }}
          content={(args: TooltipArgs) => {
            const p = activeRow<TrendPoint>(args);
            if (!p) return null;
            return (
              <ChartTooltip
                title={p.label}
                rows={[
                  {
                    key: "avgGross",
                    label: grossLabel,
                    value: formatPayrollMoney(p.avgGross),
                    color: CHART_COLORS.series1,
                  },
                  {
                    key: "avgNet",
                    label: netLabel,
                    value: formatPayrollMoney(p.avgNet),
                    color: CHART_COLORS.series2,
                  },
                ]}
              />
            );
          }}
        />
        <Line
          type="monotone"
          dataKey="avgGross"
          name={grossLabel}
          stroke={CHART_COLORS.series1}
          strokeWidth={CHART_LINE_WIDTH}
          dot={false}
          activeDot={{ ...CHART_DOT, fill: CHART_COLORS.series1 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="avgNet"
          name={netLabel}
          stroke={CHART_COLORS.series2}
          strokeWidth={CHART_LINE_WIDTH}
          dot={false}
          activeDot={{ ...CHART_DOT, fill: CHART_COLORS.series2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Khối 6 — thu nhập bình quân theo đơn vị ───────────────────────────────────────────────────────

/** Chiều cao theo số đơn vị (mỗi hàng ~32 px) — nhiều đơn vị không bị nén cột. */
export function orgUnitChartHeight(count: number): number {
  return Math.max(240, count * 32 + 32);
}

export function OrgUnitIncomeChart({ rows }: { rows: readonly OrgUnitRow[] }) {
  const { t } = useTranslation("payroll");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={[...rows]}
        layout="vertical"
        margin={{ top: 4, right: 72, bottom: 4, left: 4 }}
      >
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" tickFormatter={formatCompactMoney} {...AXIS} />
        <YAxis type="category" dataKey="label" width={144} {...AXIS} />
        <Tooltip
          cursor={HOVER_CURSOR}
          content={(args: TooltipArgs) => {
            const row = activeRow<OrgUnitRow>(args);
            if (!row) return null;
            return (
              <ChartTooltip
                title={row.label}
                rows={[
                  {
                    key: "avg",
                    label: t("overview.orgUnit.avgGross"),
                    value: formatPayrollMoney(row.avgGross),
                    color: CHART_COLORS.series1,
                  },
                  {
                    key: "min",
                    label: t("overview.orgUnit.minGross"),
                    value: formatPayrollMoney(row.minGross),
                  },
                  {
                    key: "max",
                    label: t("overview.orgUnit.maxGross"),
                    value: formatPayrollMoney(row.maxGross),
                  },
                  {
                    key: "headcount",
                    label: t("overview.orgUnit.headcount"),
                    value: String(row.headcount),
                  },
                ]}
              />
            );
          }}
        />
        <Bar
          dataKey="avgGross"
          fill={CHART_COLORS.series1}
          maxBarSize={CHART_BAR_MAX_SIZE}
          radius={CHART_BAR_RADIUS_HORIZONTAL}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="avgGross"
            position="right"
            style={LABEL_STYLE}
            formatter={(v: unknown) => (typeof v === "number" ? formatCompactMoney(v) : "")}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

import { useMemo } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { History } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { KpiResultDto } from "@mediaos/contracts";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  KPI_TIER_VARIANT,
  clampPercent,
  formatScore,
  isConfirmed,
  kpiScoreTier,
} from "@/lib/kpi-format";

interface KpiHistoryProps {
  results: KpiResultDto[];
  isLoading?: boolean;
  isError?: boolean;
  /**
   * Map subjectUserId|subjectTeamId → tên hiển thị (tuỳ chọn). Thiếu → chỉ hiện nhãn loại chủ thể
   * (Nhân viên/Nhóm). Mask: KHÔNG bịa tên — chỉ render những gì được truyền vào.
   */
  subjectNames?: Record<string, string>;
}

/** Định dạng ngày kiểu vi-VN từ ISO; lỗi parse → trả nguyên chuỗi (không vỡ UI). */
function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("vi-VN");
}

/**
 * "Lịch sử KPI" — bảng kết quả KPI theo kỳ (mới nhất trước) + biểu đồ xu hướng điểm tổng. Dữ liệu đã
 * được SERVER lọc theo scope quyền (employee chỉ của-mình). RENDER ĐÚNG field server trả (BẤT BIẾN #2).
 */
export function KpiHistory({ results, isLoading, isError, subjectNames }: KpiHistoryProps) {
  const { t } = useTranslation("kpi");

  function subjectLabel(r: KpiResultDto): string {
    const id = r.subjectUserId ?? r.subjectTeamId ?? undefined;
    const name = id ? subjectNames?.[id] : undefined;
    const kind = r.subjectTeamId ? t("history.subjectTeam") : t("history.subjectUser");
    return name ? `${name}` : kind;
  }

  // Trend: điểm tổng theo kỳ, tăng dần theo periodStart (chart đọc trái→phải = cũ→mới).
  const trend = useMemo(
    () =>
      [...results]
        .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime())
        .map((r) => ({
          period: formatDate(r.periodStart),
          score: Number(clampPercent(r.totalScore).toFixed(1)),
        })),
    [results],
  );

  const columns = useMemo<ColumnDef<KpiResultDto>[]>(
    () => [
      {
        id: "period",
        header: t("history.columns.period"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-foreground">
            {formatDate(row.original.periodStart)} – {formatDate(row.original.periodEnd)}
          </span>
        ),
      },
      {
        id: "subject",
        header: t("history.columns.subject"),
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex items-center gap-2">
              <Badge variant={r.subjectTeamId ? "brand" : "muted"}>
                {r.subjectTeamId ? t("history.subjectTeam") : t("history.subjectUser")}
              </Badge>
              {subjectNames && <span className="truncate text-sm">{subjectLabel(r)}</span>}
            </div>
          );
        },
      },
      {
        id: "totalScore",
        header: t("history.columns.totalScore"),
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const score = row.original.totalScore;
          return (
            <Badge variant={KPI_TIER_VARIANT[kpiScoreTier(score)]} className="tabular-nums">
              {formatScore(score)}
            </Badge>
          );
        },
      },
      {
        id: "status",
        header: t("history.columns.status"),
        cell: ({ row }) => {
          const confirmed = isConfirmed(row.original.confirmedAt);
          return (
            <Badge variant={confirmed ? "brand" : "muted"}>
              {confirmed ? t("status.confirmed") : t("status.reference")}
            </Badge>
          );
        },
      },
      {
        id: "createdAt",
        header: t("history.columns.createdAt"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {formatDate(row.original.createdAt)}
          </span>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, subjectNames],
  );

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{t("history.section")}</h2>

      {isError ? (
        <EmptyState
          icon={History}
          title={t("common:errors.loadFailed")}
          description={t("history.loadHint")}
        />
      ) : (
        <>
          {trend.length >= 2 && (
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                {t("history.trendTitle")}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: unknown) => [formatScore(Number(v)), t("result.totalScore")]}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#4f46e5"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <DataTable
            columns={columns}
            data={results}
            isLoading={isLoading}
            emptyState={
              <EmptyState
                icon={History}
                title={t("history.empty")}
                description={t("history.emptyHint")}
              />
            }
          />
        </>
      )}
    </section>
  );
}

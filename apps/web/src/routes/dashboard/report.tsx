import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Building2, Lock, TrendingUp, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDashboardReport } from "@/lib/dashboard-api";
import { PageHeader } from "@mediaos/ui";
import { EmptyState } from "@mediaos/ui";
import { StatCard } from "@/components/dashboard/stat-card";
import { RevenueByChannelChart } from "@/components/dashboard/revenue-by-channel-chart";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton";

function formatVnd(value: number | null): string | number {
  if (value === null) return 0;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value;
}

const PERIOD_OPTIONS = ["thisMonth", "lastMonth", "thisQuarter"] as const;
type Period = (typeof PERIOD_OPTIONS)[number];

/**
 * ReportPage — G14-2 role-filtered report.
 * Server handles all permission masking — null sections are simply not rendered.
 *
 * Phase-2 redesign: chỉ đổi layout/trình bày (PageHeader + filter + section thẻ +
 * skeleton/empty). Filter kỳ báo cáo hiện chỉ là UI (chưa nối backend) — KHÔNG đổi query.
 */
export function ReportPage() {
  const { t } = useTranslation("dashboard");
  const [period, setPeriod] = useState<Period>("thisMonth");
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "report"],
    queryFn: getDashboardReport,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const filter = (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{t("report.filter.periodLabel")}</span>
      <select
        value={period}
        onChange={(e) => setPeriod(e.target.value as Period)}
        aria-label={t("report.filter.periodLabel")}
        className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>
            {t(`report.filter.period.${opt}`)}
          </option>
        ))}
      </select>
    </label>
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
        <PageHeader title={t("report.title")} description={t("report.subtitle")} icon={BarChart3} />
        <p className="sr-only">{t("loadingData")}</p>
        <DashboardSkeleton sections={2} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
        <PageHeader title={t("report.title")} description={t("report.subtitle")} icon={BarChart3} />
        <EmptyState
          icon={Lock}
          title={t("loadDataError")}
          description={error instanceof Error ? error.message : t("unknownError")}
        />
      </div>
    );
  }

  if (!data) return null;

  const { report } = data;
  const hasFinance = report.revenueThisMonth !== null;
  const hasEmployee = report.totalEmployees !== null;
  const hasAttendance = report.todayAttendanceRate !== null;
  const hasAny = hasFinance || hasEmployee || hasAttendance;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader title={t("report.title")} description={t("report.subtitle")} icon={BarChart3}>
        {hasAny && filter}
      </PageHeader>

      {/* ── Finance section — only rendered when server grants access ─── */}
      {hasFinance && (
        <DashboardSection title={t("report.finance.sectionTitle")} icon={TrendingUp}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard
              label={t("report.finance.revenue")}
              value={formatVnd(report.revenueThisMonth)}
              accent="green"
              sub="VND"
            />
            <StatCard
              label={t("report.finance.cost")}
              value={formatVnd(report.costThisMonth)}
              accent="red"
              sub="VND"
            />
            <StatCard
              label={t("report.finance.profit")}
              value={formatVnd(report.profitThisMonth)}
              accent={
                report.profitThisMonth !== null && report.profitThisMonth >= 0 ? "green" : "red"
              }
              sub="VND"
            />
          </div>

          {report.revenueByChannel !== null && report.revenueByChannel.length > 0 && (
            <div className="mt-4">
              <RevenueByChannelChart data={report.revenueByChannel} />
            </div>
          )}
        </DashboardSection>
      )}

      {/* ── HR / Employee section ────────────────────────────────────── */}
      {(hasEmployee || hasAttendance) && (
        <DashboardSection title={t("report.hr.sectionTitle")} icon={Users}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {hasEmployee && (
              <StatCard
                label={t("report.hr.totalEmployees")}
                value={report.totalEmployees ?? 0}
                accent="blue"
              />
            )}
            {hasAttendance && (
              <StatCard
                label={t("report.hr.attendanceRate")}
                value={`${report.todayAttendanceRate ?? 0}%`}
                accent={
                  report.todayAttendanceRate !== null && report.todayAttendanceRate >= 80
                    ? "green"
                    : "yellow"
                }
              />
            )}
          </div>
        </DashboardSection>
      )}

      {!hasAny && (
        <EmptyState icon={Building2} title={t("report.noPermission")} />
      )}

      <p className="text-xs text-muted-foreground">
        {t("updatedAt")}{" "}
        {new Date(data.asOf).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

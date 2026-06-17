import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertCircle, CalendarClock } from "lucide-react";
import { attendanceApi } from "@/lib/attendance-api";
import { AttendanceTodayCard } from "@/components/hr/attendance-today-card";
import { AttendanceMonthlyTable } from "@/components/hr/attendance-monthly-table";
import { FilterField } from "@/components/hr/filter-field";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { currentMonth } from "@/components/hr/constants";

interface AttendanceStat {
  label: string;
  value: number;
  tone: "default" | "warning" | "danger";
}

const STAT_TONE: Record<AttendanceStat["tone"], string> = {
  default: "text-foreground",
  warning: "text-orange-500",
  danger: "text-destructive",
};

/**
 * G11 — Màn hình Chấm công: card hôm nay + thống kê tháng + bảng công.
 */
export function AttendancePage() {
  const { t } = useTranslation("hr");
  const [month, setMonth] = useState<string>(currentMonth());

  const {
    data: records = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["attendance", "monthly", month],
    queryFn: () => attendanceApi.listMonthly({ month }),
  });

  const [y, m] = month.split("-");
  const displayMonth = `${m}/${y}`;

  const presentDays = records.filter(
    (r) => r.status === "present" || r.status === "approved_adjustment",
  ).length;
  const lateDays = records.filter((r) => r.status === "late").length;
  const absentDays = records.filter(
    (r) => r.status === "absent" || r.status === "missing_checkin",
  ).length;

  const stats: AttendanceStat[] = [
    { label: t("attendancePage.statOnTime"), value: presentDays, tone: "default" },
    { label: t("attendancePage.statLate"), value: lateDays, tone: "warning" },
    { label: t("attendancePage.statAbsent"), value: absentDays, tone: "danger" },
  ];

  const hasStats = !isLoading && !isError && records.length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("attendancePage.heading")}
        description={t("attendancePage.description")}
        icon={CalendarClock}
      >
        <FilterField label={t("attendancePage.filterMonth")} className="max-w-[12rem]">
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label={t("attendancePage.filterMonth")}
          />
        </FilterField>
      </PageHeader>

      <AttendanceTodayCard />

      {hasStats && (
        <div className="grid grid-cols-3 gap-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-border bg-card p-4 text-center shadow-sm"
            >
              <p className={`text-2xl font-semibold tabular-nums ${STAT_TONE[s.tone]}`}>
                {s.value}
              </p>
              <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-base font-medium text-foreground">
          {t("attendancePage.tableHeading", { month: displayMonth })}
        </h2>

        {isLoading && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4 shadow-sm">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {isError && (
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <EmptyState
              icon={AlertCircle}
              title={t("attendancePage.errorTitle")}
              description={t("attendancePage.errorHint")}
            />
          </div>
        )}
        {!isLoading && !isError && <AttendanceMonthlyTable records={records} />}
      </section>
    </div>
  );
}

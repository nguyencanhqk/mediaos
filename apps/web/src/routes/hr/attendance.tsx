import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { attendanceApi } from "@/lib/attendance-api";
import { AttendanceTodayCard } from "@/components/hr/attendance-today-card";
import { AttendanceMonthlyTable } from "@/components/hr/attendance-monthly-table";
import { Input } from "@/components/ui/input";
import { currentMonth } from "@/components/hr/constants";

/**
 * G11 — Màn hình Chấm công: card hôm nay + bảng tháng.
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
  const displayMonth = `Tháng ${m}/${y}`;

  // Summary stats
  const totalDays = records.length;
  const presentDays = records.filter((r) =>
    r.status === "present" || r.status === "approved_adjustment",
  ).length;
  const lateDays = records.filter((r) => r.status === "late").length;
  const absentDays = records.filter(
    (r) => r.status === "absent" || r.status === "missing_checkin",
  ).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold">{t("attendancePage.heading")}</h1>

      <AttendanceTodayCard />

      {/* Month picker + stats */}
      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">{t("attendancePage.filterMonth")}</label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
        </div>
        {!isLoading && !isError && totalDays > 0 && (
          <div className="flex gap-6 text-sm mt-4">
            <div className="text-center">
              <p className="text-2xl font-semibold tabular-nums">{presentDays}</p>
              <p className="text-xs text-muted-foreground">{t("attendancePage.statOnTime")}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold tabular-nums text-orange-500">{lateDays}</p>
              <p className="text-xs text-muted-foreground">{t("attendancePage.statLate")}</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold tabular-nums text-destructive">{absentDays}</p>
              <p className="text-xs text-muted-foreground">{t("attendancePage.statAbsent")}</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">{displayMonth}</h2>

        {isLoading && (
          <p className="text-sm text-muted-foreground">{t("attendancePage.loading")}</p>
        )}
        {isError && (
          <p className="text-sm text-destructive">{t("attendancePage.loadError")}</p>
        )}
        {!isLoading && !isError && (
          <AttendanceMonthlyTable records={records} />
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { attendanceApi } from "@/lib/attendance-api";
import { AttendanceTodayCard } from "@/components/hr/attendance-today-card";
import { AttendanceMonthlyTable } from "@/components/hr/attendance-monthly-table";
import { Input } from "@/components/ui/input";
import { currentMonth } from "@/components/hr/constants";

/**
 * G11 — Màn hình Chấm công: card hôm nay + bảng tháng.
 */
export function AttendancePage() {
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
      <h1 className="text-2xl font-semibold">Chấm công</h1>

      <AttendanceTodayCard />

      {/* Month picker + stats */}
      <div className="flex items-center gap-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground uppercase tracking-wide">Tháng</label>
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
              <p className="text-xs text-muted-foreground">Đúng giờ</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold tabular-nums text-orange-500">{lateDays}</p>
              <p className="text-xs text-muted-foreground">Trễ</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-semibold tabular-nums text-destructive">{absentDays}</p>
              <p className="text-xs text-muted-foreground">Vắng</p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-medium">{displayMonth}</h2>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Đang tải bảng công…</p>
        )}
        {isError && (
          <p className="text-sm text-destructive">Không tải được bảng công.</p>
        )}
        {!isLoading && !isError && (
          <AttendanceMonthlyTable records={records} />
        )}
      </div>
    </div>
  );
}

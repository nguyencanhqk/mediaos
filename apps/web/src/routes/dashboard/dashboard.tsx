import { useQuery } from "@tanstack/react-query";
import { getDashboardSummary } from "@/lib/dashboard-api";
import { StatCard } from "@/components/dashboard/stat-card";
import { TaskStatusChart } from "@/components/dashboard/task-status-chart";

/**
 * DashboardPage — G14-1 role-aware dashboard.
 * Renders only what the server returns — server handles all permission masking.
 * No client-side permission checks on data visibility (server is source of truth).
 * PermissionGate/useCan is used only for UI chrome (navigation links etc.), not data sections.
 */
export function DashboardPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: getDashboardSummary,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Đang tải dữ liệu…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-destructive">
          Không tải được dữ liệu:{" "}
          {error instanceof Error ? error.message : "Lỗi không xác định"}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const { tasks, attendance, leave } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {/* ── Task section ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Công việc</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Tổng task" value={tasks.total} accent="blue" />
          <StatCard label="Đang làm" value={tasks.inProgress} accent="blue" />
          <StatCard label="Chờ duyệt" value={tasks.waitingReview} accent="yellow" />
          <StatCard label="Hoàn thành" value={tasks.completed} accent="green" />
          <StatCard
            label="Quá hạn"
            value={tasks.overdue}
            accent={tasks.overdue > 0 ? "red" : "gray"}
            sub={tasks.overdue > 0 ? "Cần xử lý" : undefined}
          />
        </div>

        {/* Manager/leadership: breakdown chart — only when byStatus is present */}
        {tasks.byStatus && tasks.byStatus.length > 0 && (
          <div className="mt-4">
            <TaskStatusChart data={tasks.byStatus} />
          </div>
        )}
      </section>

      {/* ── Attendance section — only if server returned data (not null) ── */}
      {attendance.todayPresent !== null && (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">
            Chấm công hôm nay
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label="Có mặt" value={attendance.todayPresent} accent="green" />
            <StatCard
              label="Vắng"
              value={attendance.todayAbsent ?? 0}
              accent={attendance.todayAbsent ? "red" : "gray"}
            />
            <StatCard
              label="Đi trễ"
              value={attendance.todayLate ?? 0}
              accent={attendance.todayLate ? "yellow" : "gray"}
            />
          </div>

          {attendance.monthAttendanceDays !== null && (
            <>
              <h2 className="mb-4 mt-6 text-sm font-medium text-muted-foreground">
                Chấm công tháng này
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard
                  label="Ngày công"
                  value={attendance.monthAttendanceDays}
                  accent="blue"
                />
                <StatCard
                  label="Ngày vắng"
                  value={attendance.monthAbsentDays ?? 0}
                  accent={attendance.monthAbsentDays ? "red" : "gray"}
                />
                <StatCard
                  label="Ngày trễ"
                  value={attendance.monthLateDays ?? 0}
                  accent={attendance.monthLateDays ? "yellow" : "gray"}
                />
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Leave section — only if server returned data ─────────────── */}
      {leave.pendingRequests !== null && (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Nghỉ phép</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard
              label="Chờ duyệt"
              value={leave.pendingRequests}
              accent={leave.pendingRequests > 0 ? "yellow" : "gray"}
            />
            <StatCard
              label="Đã duyệt tháng này"
              value={leave.approvedThisMonth ?? 0}
              accent="green"
            />
            {leave.myAnnualBalanceDays !== null && (
              <StatCard
                label="Số ngày phép còn lại"
                value={leave.myAnnualBalanceDays}
                accent="blue"
                sub="Phép năm"
              />
            )}
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Cập nhật lúc:{" "}
        {new Date(data.asOf).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

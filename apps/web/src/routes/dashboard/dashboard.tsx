import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("dashboard");
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
        <p className="text-sm text-muted-foreground">{t("loadingData")}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-destructive">
          {t("loadDataError")}{" "}
          {error instanceof Error ? error.message : t("unknownError")}
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
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t("dashboard.tasks.sectionTitle")}</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label={t("dashboard.tasks.total")} value={tasks.total} accent="blue" />
          <StatCard label={t("dashboard.tasks.inProgress")} value={tasks.inProgress} accent="blue" />
          <StatCard label={t("dashboard.tasks.waitingReview")} value={tasks.waitingReview} accent="yellow" />
          <StatCard label={t("dashboard.tasks.completed")} value={tasks.completed} accent="green" />
          <StatCard
            label={t("dashboard.tasks.overdue")}
            value={tasks.overdue}
            accent={tasks.overdue > 0 ? "red" : "gray"}
            sub={tasks.overdue > 0 ? t("dashboard.tasks.overdueAction") : undefined}
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
            {t("dashboard.attendance.todayTitle")}
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard label={t("dashboard.attendance.present")} value={attendance.todayPresent} accent="green" />
            <StatCard
              label={t("dashboard.attendance.absent")}
              value={attendance.todayAbsent ?? 0}
              accent={attendance.todayAbsent ? "red" : "gray"}
            />
            <StatCard
              label={t("dashboard.attendance.late")}
              value={attendance.todayLate ?? 0}
              accent={attendance.todayLate ? "yellow" : "gray"}
            />
          </div>

          {attendance.monthAttendanceDays !== null && (
            <>
              <h2 className="mb-4 mt-6 text-sm font-medium text-muted-foreground">
                {t("dashboard.attendance.monthTitle")}
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <StatCard
                  label={t("dashboard.attendance.monthDays")}
                  value={attendance.monthAttendanceDays}
                  accent="blue"
                />
                <StatCard
                  label={t("dashboard.attendance.monthAbsent")}
                  value={attendance.monthAbsentDays ?? 0}
                  accent={attendance.monthAbsentDays ? "red" : "gray"}
                />
                <StatCard
                  label={t("dashboard.attendance.monthLate")}
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
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">{t("dashboard.leave.sectionTitle")}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard
              label={t("dashboard.leave.pending")}
              value={leave.pendingRequests}
              accent={leave.pendingRequests > 0 ? "yellow" : "gray"}
            />
            <StatCard
              label={t("dashboard.leave.approvedThisMonth")}
              value={leave.approvedThisMonth ?? 0}
              accent="green"
            />
            {leave.myAnnualBalanceDays !== null && (
              <StatCard
                label={t("dashboard.leave.annualBalance")}
                value={leave.myAnnualBalanceDays}
                accent="blue"
                sub={t("dashboard.leave.annualSub")}
              />
            )}
          </div>
        </section>
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

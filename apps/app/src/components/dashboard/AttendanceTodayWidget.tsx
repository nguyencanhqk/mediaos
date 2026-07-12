/**
 * AttendanceTodayWidget — DASH-WIDGET-001 "Chấm công hôm nay" (SPEC-07 §14.2, S4-FE-DASH-2 P1).
 * widget_code=ATTENDANCE_TODAY, slug=attendance-today, module nguồn ATT. Data: apps/api
 * dashboard-widget-handlers.service.ts fetchAttendanceToday() → { date, items, summary:{ total } }
 * (AttendanceReadService.listMyRecords, self-locked, mốc "hôm nay" theo TZ công ty).
 *
 * Gate: PermissionGate(view-own:attendance) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.ATTENDANCE_TODAY.
 */
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import { PermissionGate, formatTime } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { AttendanceStatusBadge } from "@/routes/attendance/AttendanceStatusBadge";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { attendanceTodayWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface AttendanceTodayWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function AttendanceTodayWidgetInner({ dashboardType }: AttendanceTodayWidgetProps) {
  const { t } = useTranslation("dashboard");
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.ATTENDANCE_TODAY,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? attendanceTodayWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("attendanceToday.title")}
      icon={Clock}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("attendanceToday.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <ul className="space-y-2">
          {parsed.data.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
              <p className="tabular-nums text-foreground">
                {item.checkInAt ? formatTime(item.checkInAt) : "—"}
                {" → "}
                {item.checkOutAt ? formatTime(item.checkOutAt) : "—"}
              </p>
              <AttendanceStatusBadge status={item.attendanceStatus ?? item.status} />
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu view-own:attendance ⇒ KHÔNG render (KHÔNG fetch). */
export function AttendanceTodayWidget(props: AttendanceTodayWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.ATTENDANCE_TODAY;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <AttendanceTodayWidgetInner {...props} />
    </PermissionGate>
  );
}

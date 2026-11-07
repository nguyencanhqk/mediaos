/**
 * PendingLeaveWidget — DASH-WIDGET-005 "Đơn nghỉ chờ duyệt" (SPEC-07 §14.2, S4-FE-DASH-2 P1). widget_code=
 * PENDING_LEAVE, slug=pending-leave, module nguồn LEAVE. Data: apps/api dashboard-widget-handlers.service.ts
 * fetchPendingLeave() → { items, summary:{ total } } (LeaveApprovalService.listPending, scope Team qua
 * data-scope resolver — KHÔNG phải "của tôi").
 *
 * Gate: PermissionGate(view:leave) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.PENDING_LEAVE.
 */
import { useTranslation } from "react-i18next";
import { CalendarClock } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { PermissionGate, formatDate, useCan } from "@mediaos/web-core";
import { LEAVE_ENGINE_PAIRS } from "@/routes/leave/constants";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { pendingLeaveWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface PendingLeaveWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function PendingLeaveWidgetInner({ dashboardType }: PendingLeaveWidgetProps) {
  const { t } = useTranslation("dashboard");
  const navigate = useNavigate();
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.PENDING_LEAVE,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? pendingLeaveWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("pendingLeave.title")}
      icon={CalendarClock}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("pendingLeave.empty.title")}
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
            <li key={item.id}>
              {/* S20-DASH-TODAY-1 — hàng = nút tới `/leave/approvals?request=<id>`: dialog đơn mở sẵn;
                  duyệt/từ chối vẫn phải bấm + xác nhận trong dialog. */}
              <button
                type="button"
                aria-label={t("openLeaveRequest", {
                  name: item.requester.fullName ?? t("pendingLeave.unknownRequester"),
                })}
                onClick={() =>
                  void navigate({ to: "/leave/approvals", search: { request: item.id } })
                }
                className="flex w-full items-center justify-between gap-2 rounded-md p-1 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {item.requester.fullName ?? t("pendingLeave.unknownRequester")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.leaveTypeName ?? "—"} · {formatDate(item.startDate)} –{" "}
                    {formatDate(item.endDate)}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {t("pendingLeave.totalDays", { count: item.totalDays })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/**
 * Gate ngoài — user thiếu view:leave (mirror BE) HOẶC approve:leave (widget dẫn tới dialog duyệt) ⇒ KHÔNG
 * render (KHÔNG fetch).
 */
export function PendingLeaveWidget(props: PendingLeaveWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.PENDING_LEAVE;
  const canApprove = useCan(
    LEAVE_ENGINE_PAIRS.APPROVE_REQUEST.action,
    LEAVE_ENGINE_PAIRS.APPROVE_REQUEST.resourceType,
  );
  if (!canApprove) return null;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <PendingLeaveWidgetInner {...props} />
    </PermissionGate>
  );
}

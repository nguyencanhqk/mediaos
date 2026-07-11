/**
 * NotificationsWidget — DASH-WIDGET-007 "Thông báo mới" (SPEC-07 §14.7). widget_code=NOTIFICATIONS,
 * slug=notifications, module nguồn NOTI. Data: apps/api dashboard-widget-handlers.service.ts
 * fetchNotifications() → { items, summary:{ total, unread } } (MyNotificationsService.list, đã
 * recipient-scoped + self-locked userId).
 *
 * Hành động: mở 1 thông báo điều hướng thẳng `targetUrl` (deep-link module gốc — mirror
 * NotificationTargetLink/NotificationDropdown, KHÔNG tự gọi mark-read ở widget này — xem "Xem tất cả thông
 * báo" quick action cho luồng đầy đủ mark-read/mark-all-read tại /notifications).
 *
 * Gate: PermissionGate(read:notification) — MIRROR đúng BE DASH_WIDGET_GATE_PAIR.NOTIFICATIONS.
 */
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { PermissionGate } from "@mediaos/web-core";
import { useDashboardWidgetData } from "./useDashboardWidget";
import { WidgetCard } from "./WidgetCard";
import { NotificationTargetLink } from "@/components/notifications/NotificationTargetLink";
import { DASH_WIDGET_CODE, DASH_WIDGET_GATE_PAIR } from "@/routes/dashboard/constants";
import { notificationsWidgetDataSchema, widgetMessageSchema } from "./widget-data-schemas";
import type { DashboardTypeValue } from "@mediaos/contracts";

interface NotificationsWidgetProps {
  dashboardType?: DashboardTypeValue;
}

function NotificationsWidgetInner({ dashboardType }: NotificationsWidgetProps) {
  const { t } = useTranslation("dashboard");
  const { data, isLoading, isError, refresh, isRefreshing } = useDashboardWidgetData(
    DASH_WIDGET_CODE.NOTIFICATIONS,
    { dashboardType },
  );

  const status = data?.status;
  const serverErrored = status === "Error" || status === "Degraded";
  const parsed =
    data && data.data !== null ? notificationsWidgetDataSchema.safeParse(data.data) : null;
  const parseFailed = parsed !== null && !parsed.success;
  const emptyMsg = widgetMessageSchema.safeParse(data?.empty_state);

  return (
    <WidgetCard
      title={t("notifications.title")}
      icon={Bell}
      isLoading={isLoading}
      isError={isError || serverErrored || parseFailed}
      isEmpty={status === "Empty"}
      emptyTitle={emptyMsg.success ? emptyMsg.data.message : t("notifications.empty.title")}
      errorTitle={data?.error_state?.message ?? t("widget.error.title")}
      errorDescription={t("widget.error.description")}
      lastUpdatedAt={data?.last_updated_at}
      onRefresh={refresh}
      isRefreshing={isRefreshing}
      quickActions={data?.quick_actions}
    >
      {parsed?.success && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("notifications.unreadSummary", {
              unread: parsed.data.summary.unread,
              total: parsed.data.summary.total,
            })}
          </p>
          <ul className="divide-y divide-border">
            {parsed.data.items.map((item) => (
              <li key={item.id}>
                <NotificationTargetLink
                  targetUrl={item.targetUrl}
                  className="flex w-full flex-col items-start gap-0.5 py-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    {!item.isRead && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title}
                    </span>
                  </span>
                  {item.shortContent && (
                    <span className="line-clamp-1 text-xs text-muted-foreground">
                      {item.shortContent}
                    </span>
                  )}
                </NotificationTargetLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

/** Gate ngoài (PermissionGate) — user thiếu read:notification ⇒ KHÔNG render (KHÔNG fetch, KHÔNG hiện shell rỗng). */
export function NotificationsWidget(props: NotificationsWidgetProps) {
  const pair = DASH_WIDGET_GATE_PAIR.NOTIFICATIONS;
  return (
    <PermissionGate action={pair.action} resourceType={pair.resourceType}>
      <NotificationsWidgetInner {...props} />
    </PermissionGate>
  );
}

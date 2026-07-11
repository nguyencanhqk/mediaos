/**
 * WidgetCard — shell dùng chung cho mọi widget dashboard (S4-FE-DASH-1, SPEC-07 §13.1/§16.6/§16.7).
 *
 * Đóng gói: header (icon + tiêu đề + nút "Làm mới") · body theo trạng thái (loading skeleton / forbidden /
 * error-hoặc-degraded / empty / active = children) · footer quick-action (chỉ NAVIGATE + enabled, §16.4:
 * "Quick action chỉ hiển thị nếu user có quyền thao tác"). Mỗi widget con (MyTasksWidget/TaskAlertsWidget/
 * NotificationsWidget) CHỈ cần cung cấp nội dung "Active" — tránh lặp lại 5 nhánh trạng thái ở mỗi widget.
 *
 * "Widget lỗi không làm sập toàn dashboard" (§13.1/§16.2.6): WidgetCard render lỗi CỤC BỘ bên trong chính
 * nó — không throw, không crash boundary — DashboardWidgetGrid vẫn render các widget khác bình thường.
 */
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RefreshCw, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Button,
  EmptyState,
} from "@mediaos/ui";
import type { QuickActionDto } from "@mediaos/contracts";
import {
  NotificationTargetLink,
  isSafeInternalTarget,
} from "@/components/notifications/NotificationTargetLink";

interface WidgetCardProps {
  title: string;
  icon: LucideIcon;
  /** true khi hook đang gọi lần đầu (KHÔNG phải refresh) — render skeleton. */
  isLoading: boolean;
  /** true khi fetch lỗi (network/parse) HOẶC server trả status Error/Degraded — cùng render error state. */
  isError: boolean;
  /** true khi server trả status Empty (mảng data rỗng, KHÔNG phải lỗi). */
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription?: string;
  errorTitle: string;
  errorDescription?: string;
  lastUpdatedAt?: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  quickActions?: readonly QuickActionDto[];
  /** Nội dung khi status=Active (KHÔNG loading/error/empty). */
  children?: React.ReactNode;
}

function WidgetSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function WidgetCard({
  title,
  icon: Icon,
  isLoading,
  isError,
  isEmpty,
  emptyTitle,
  emptyDescription,
  errorTitle,
  errorDescription,
  lastUpdatedAt,
  onRefresh,
  isRefreshing,
  quickActions,
  children,
}: WidgetCardProps) {
  const { t } = useTranslation("dashboard");
  const navigableActions = (quickActions ?? []).filter(
    (a) => a.enabled && a.method === "NAVIGATE" && isSafeInternalTarget(a.target_url),
  );

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-brand" />
          {title}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onRefresh}
          disabled={isLoading || isRefreshing}
          aria-label={t("widget.refresh")}
          title={t("widget.refresh")}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>

      <CardContent className="flex-1 pt-0">
        {isLoading ? (
          <WidgetSkeleton />
        ) : isError ? (
          <EmptyState
            icon={AlertTriangle}
            title={errorTitle}
            description={errorDescription}
            action={
              <Button variant="outline" size="sm" onClick={onRefresh}>
                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            }
            className="py-6"
          />
        ) : isEmpty ? (
          <EmptyState title={emptyTitle} description={emptyDescription} className="py-6" />
        ) : (
          children
        )}
      </CardContent>

      {(lastUpdatedAt || navigableActions.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-2.5">
          <span className="text-xs text-muted-foreground">
            {lastUpdatedAt
              ? t("widget.lastUpdated", {
                  time: new Date(lastUpdatedAt).toLocaleTimeString("vi-VN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })
              : null}
          </span>
          <div className="flex flex-wrap gap-2">
            {navigableActions.map((action) => (
              <NotificationTargetLink
                key={action.action_code}
                targetUrl={action.target_url}
                className="text-xs font-medium text-primary hover:underline"
              >
                {action.label}
              </NotificationTargetLink>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

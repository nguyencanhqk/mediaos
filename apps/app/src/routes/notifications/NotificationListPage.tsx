import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Bell, RefreshCw } from "lucide-react";
import type { MyNotificationListItem } from "@mediaos/contracts";
import { myNotificationApi, notificationKeys, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Select, Badge } from "@mediaos/ui";
import { AuthLogPagination } from "@/routes/system/auth-logs/AuthLogControls";
import { MarkReadButton } from "@/components/notifications/MarkReadButton";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { NOTI_ENGINE_PAIRS, NOTI_LIST_PAGE_SIZE, NOTI_PATHS, NOTI_STATUS } from "./constants";

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Low: "outline",
  Normal: "secondary",
  High: "default",
  Urgent: "destructive",
  Critical: "destructive",
};

function useColumns(
  t: ReturnType<typeof useTranslation<"notifications">>["t"],
  onView: (id: string) => void,
): ColumnDef<MyNotificationListItem>[] {
  return [
    {
      id: "title",
      header: t("list.columns.title"),
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => onView(row.original.notification_id)}
          className="block max-w-md text-left"
        >
          <span className={`text-sm ${row.original.is_read ? "" : "font-semibold"}`}>
            {row.original.title}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.original.short_content}
          </span>
        </button>
      ),
    },
    {
      accessorKey: "priority",
      header: t("list.columns.priority"),
      cell: ({ row }) => (
        <Badge variant={PRIORITY_VARIANT[row.original.priority] ?? "secondary"}>
          {t(`priority.${row.original.priority}`, { defaultValue: row.original.priority })}
        </Badge>
      ),
    },
    {
      accessorKey: "status",
      header: t("list.columns.status"),
      cell: ({ row }) => (
        <Badge variant={row.original.is_read ? "outline" : "default"}>
          {t(`status.${row.original.status}`, { defaultValue: row.original.status })}
        </Badge>
      ),
    },
    {
      accessorKey: "created_at",
      header: t("list.columns.createdAt"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("list.columns.actions"),
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <MarkReadButton
            notificationId={row.original.notification_id}
            status={row.original.status}
          />
          <Button variant="ghost" size="sm" onClick={() => onView(row.original.notification_id)}>
            {t("detail.title")}
          </Button>
        </div>
      ),
    },
  ];
}

/**
 * NotificationListPage (NOTI-SCREEN-LIST) — S4-FE-NOTI-1. GET /notifications (NOTI-API-001), phân trang
 * page-based server-side. Pagination heuristic (KHÔNG total chính xác — xem my-notification-api.ts) tái
 * dùng AuthLogPagination (cùng kỹ thuật FileAccessLogsPage). Gate = read:notification (Own).
 */
export function NotificationListPage() {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canView = useCan(NOTI_ENGINE_PAIRS.READ.action, NOTI_ENGINE_PAIRS.READ.resourceType);

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"" | "Unread">("");

  const query = {
    page,
    per_page: NOTI_LIST_PAGE_SIZE,
    ...(statusFilter ? { status: statusFilter } : {}),
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: notificationKeys.list(query),
    queryFn: () => myNotificationApi.list(query),
    enabled: canView,
    staleTime: 15_000,
  });

  const onView = (id: string) => void navigate({ to: NOTI_PATHS.DETAIL(id) as "/" });
  const columns = useColumns(t, onView);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("list.forbidden.title")}
          description={t("list.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("list.error.title")}
          description={t("list.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        icon={Bell}
        actions={<MarkAllReadButton />}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as "" | "Unread");
              setPage(1);
            }}
            className="w-48"
            aria-label={t("list.filters.allStatuses")}
          >
            <option value="">{t("list.filters.allStatuses")}</option>
            <option value={NOTI_STATUS.UNREAD}>{t("list.filters.unreadOnly")}</option>
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("list.empty.title")} description={t("list.empty.description")} />
        }
        pageSize={NOTI_LIST_PAGE_SIZE}
      />

      {!isLoading && (
        <AuthLogPagination
          page={page}
          currentCount={items.length}
          pageSize={NOTI_LIST_PAGE_SIZE}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

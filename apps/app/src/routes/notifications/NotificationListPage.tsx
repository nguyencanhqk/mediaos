import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Bell, RefreshCw } from "lucide-react";
import type { MyNotificationListItem } from "@mediaos/contracts";
import { myNotificationApi, notificationKeys, useCan } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Badge } from "@mediaos/ui";
import { AuthLogPagination } from "@/routes/system/auth-logs/AuthLogControls";
import { MarkReadButton } from "@/components/notifications/MarkReadButton";
import { NOTI_ENGINE_PAIRS, NOTI_LIST_PAGE_SIZE, NOTI_PATHS } from "./constants";
import { NotificationListFilters } from "./NotificationListPageFilters";
import { NotificationListMarkRead, NotificationRowLink } from "./NotificationListPageActions";
import {
  hasActiveNotificationListFilters,
  toNotificationListQuery,
  useNotificationListSearch,
} from "./notification-list-search";

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
      // S20-NOTI-LISTNAV-1 — bấm dòng ⇒ mark-read + đi thẳng target_url; đích rỗng/không an toàn ⇒ chi tiết.
      cell: ({ row }) => <NotificationRowLink item={row.original} onView={onView} />,
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
 *
 * S20-NOTI-LISTNAV-1 (US-X-13): bộ lọc nguồn/mức ưu tiên/trạng thái + trang sống trên URL
 * (`notification-list-search.ts`, cùng hàm `validateSearch` của route); bấm dòng đi thẳng đích.
 */
export function NotificationListPage() {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canView = useCan(NOTI_ENGINE_PAIRS.READ.action, NOTI_ENGINE_PAIRS.READ.resourceType);

  const { search, update, clearFilters } = useNotificationListSearch();
  const query = toNotificationListQuery(search, NOTI_LIST_PAGE_SIZE);
  const isFiltered = hasActiveNotificationListFilters(search);

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
  const emptyState = isFiltered ? (
    <EmptyState
      title={t("list.emptyFiltered.title")}
      action={
        <Button variant="outline" size="sm" onClick={clearFilters}>
          {t("list.emptyFiltered.clear")}
        </Button>
      }
    />
  ) : (
    <EmptyState title={t("list.empty.title")} description={t("list.empty.description")} />
  );

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        icon={Bell}
        actions={<NotificationListMarkRead search={search} items={items} />}
      >
        <NotificationListFilters search={search} onChange={update} />
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={emptyState}
        pageSize={NOTI_LIST_PAGE_SIZE}
      />

      {!isLoading && (
        <AuthLogPagination
          page={search.page ?? 1}
          currentCount={items.length}
          pageSize={NOTI_LIST_PAGE_SIZE}
          onPageChange={(page) => update({ page: page > 1 ? page : undefined })}
        />
      )}
    </div>
  );
}

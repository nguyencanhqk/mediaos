/**
 * NotificationEventsPage (UI-NOTI-SCREEN-004 · SPEC-08 §13.4 NOTI-SCREEN-005 "Quản lý loại thông báo")
 * — S4-FE-NOTI-2. Danh mục event thông báo hệ thống: search/filter theo module·trạng thái + toggle
 * bật/tắt (xác nhận trước khi ghi).
 *
 * Nối S4-NOTI-BE-3/BE-4 (notification-admin.controller.ts): GET /notifications/events (NOTI-API-301) ·
 * PATCH /notifications/events/:id (NOTI-API-302). Gate:
 *   - Xem   : useCanExact('view','notification-config')   — is_sensitive=true, fail-closed.
 *   - Toggle: useCanExact('update','notification-config') — is_sensitive=true, fail-closed.
 * CẢ 2 cặp đã ở SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) nên /auth/me phơi đúng
 * capability cho company-admin — KHÔNG dùng useCan (wildcard '*:*' KHÔNG mở cổng cặp sensitive),
 * mirror AttendanceRulesPage/RetentionPoliciesPage/UsersPage(delete/restore/reset-password).
 *
 * Catalog nhỏ (~53 event, NOTI_EVENT_COUNT ở BE) → fetch 1 lần per_page tối đa (NOTI_EVENT_PAGE_SIZE_MAX),
 * lọc module/trạng thái CLIENT-SIDE + search qua DataTable.globalFilter (mirror PermissionsPage — danh
 * mục nhỏ, KHÔNG cần AuthLogPagination server-side heuristic).
 *
 * Masking là việc của SERVER — trang chỉ render field nhận được từ notificationEventAdminItemSchema.
 * States: forbidden · loading · error · empty · list (+ confirm dialog trước khi PATCH).
 *
 * S4-FE-NOTI-4 — mỗi dòng có nút "Xem template" → điều hướng /notifications/templates?event=<event_code>
 * (SPEC-08 §13.4, deep-link đọc lại ở NotificationTemplatesPage qua window.location.search). Điều hướng
 * QUA `navigate()` (client-side, KHÔNG window.location.href) — route đích TỰ chạy beforeLoad/ProtectedRoute
 * lại (gate view:notification-template RIÊNG, mirror NotificationTargetLink). Nút này KHÔNG gate quyền ở
 * đây (chỉ là link điều hướng) — route đích tự chặn nếu thiếu quyền.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Bell, RefreshCw } from "lucide-react";
import type { NotificationEventAdminItem } from "@mediaos/contracts";
import {
  notificationAdminApi,
  notificationKeys,
  useCanExact,
  formatDateTime,
} from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Select, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  NOTI_EVENT_ENGINE_PAIRS,
  NOTI_EVENT_MODULE_CODES,
  NOTI_EVENT_PAGE_SIZE_MAX,
  NOTI_PATHS,
} from "./constants";

type TF = ReturnType<typeof useTranslation<"notifications">>["t"];

const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Low: "outline",
  Normal: "secondary",
  High: "default",
  Urgent: "destructive",
  Critical: "destructive",
};

interface ConfirmState {
  event: NotificationEventAdminItem;
  nextEnabled: boolean;
}

function useColumns(
  t: TF,
  onToggle: ((event: NotificationEventAdminItem) => void) | null,
  onViewTemplate: (event: NotificationEventAdminItem) => void,
): ColumnDef<NotificationEventAdminItem>[] {
  const cols: ColumnDef<NotificationEventAdminItem>[] = [
    {
      accessorKey: "module_code",
      header: t("events.columns.module"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.module_code}</span>
      ),
    },
    {
      accessorKey: "event_code",
      header: t("events.columns.eventCode"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.event_code}</span>,
    },
    {
      accessorKey: "event_name",
      header: t("events.columns.eventName"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.event_name}</span>,
    },
    {
      accessorKey: "default_priority",
      header: t("events.columns.priority"),
      cell: ({ row }) => (
        <Badge variant={PRIORITY_VARIANT[row.original.default_priority] ?? "secondary"}>
          {row.original.default_priority}
        </Badge>
      ),
    },
    {
      accessorKey: "is_enabled",
      header: t("events.columns.status"),
      cell: ({ row }) => (
        <Badge variant={row.original.is_enabled ? "success" : "muted"}>
          {row.original.is_enabled ? t("events.status.enabled") : t("events.status.disabled")}
        </Badge>
      ),
    },
    {
      accessorKey: "updated_at",
      header: t("events.columns.updatedAt"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(row.original.updated_at)}
        </span>
      ),
    },
    {
      id: "viewTemplate",
      header: t("events.columns.template"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          data-testid={`event-view-template-${row.original.id}`}
          onClick={() => onViewTemplate(row.original)}
        >
          {t("events.actions.viewTemplate")}
        </Button>
      ),
    },
  ];
  if (onToggle) {
    cols.push({
      id: "actions",
      header: t("events.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="outline"
          size="sm"
          data-testid={`event-toggle-${row.original.id}`}
          onClick={() => onToggle(row.original)}
        >
          {row.original.is_enabled ? t("events.actions.disable") : t("events.actions.enable")}
        </Button>
      ),
    });
  }
  return cols;
}

export function NotificationEventsPage() {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // NHẠY CẢM: useCanExact — KHÔNG wildcard fallback (view/update:notification-config is_sensitive).
  const canView = useCanExact(
    NOTI_EVENT_ENGINE_PAIRS.VIEW.action,
    NOTI_EVENT_ENGINE_PAIRS.VIEW.resourceType,
  );
  const canUpdate = useCanExact(
    NOTI_EVENT_ENGINE_PAIRS.UPDATE.action,
    NOTI_EVENT_ENGINE_PAIRS.UPDATE.resourceType,
  );

  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "enabled" | "disabled">("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: notificationKeys.events(),
    queryFn: () => notificationAdminApi.listEvents({ per_page: NOTI_EVENT_PAGE_SIZE_MAX }),
    enabled: canView,
    staleTime: 30_000,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ event, nextEnabled }: ConfirmState) =>
      notificationAdminApi.updateEvent(event.id, { is_enabled: nextEnabled }),
    onSuccess: () => {
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.events() });
    },
  });

  const items = data ?? [];
  const filteredItems = useMemo(
    () =>
      items.filter((ev) => {
        if (moduleFilter && ev.module_code !== moduleFilter) return false;
        if (statusFilter === "enabled" && !ev.is_enabled) return false;
        if (statusFilter === "disabled" && ev.is_enabled) return false;
        return true;
      }),
    [items, moduleFilter, statusFilter],
  );

  const openToggleConfirm = (event: NotificationEventAdminItem) =>
    setConfirm({ event, nextEnabled: !event.is_enabled });
  // Deep-link tới NotificationTemplatesPage lọc theo event_code — cast "as \"/\"" là pattern ĐÃ DÙNG
  // khắp router.tsx cho điều hướng path/search động (vd NotificationTargetLink).
  const goToTemplates = (event: NotificationEventAdminItem) =>
    void navigate({
      to: NOTI_PATHS.TEMPLATES as "/",
      search: { event: event.event_code } as never,
    });
  const columns = useColumns(t, canUpdate ? openToggleConfirm : null, goToTemplates);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("events.forbidden.title")}
          description={t("events.forbidden.description")}
          data-testid="events-forbidden"
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader title={t("events.title")} description={t("events.description")} icon={Bell} />
        <div className="mt-8">
          <EmptyState
            title={t("events.error.title")}
            description={t("events.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader title={t("events.title")} description={t("events.description")} icon={Bell}>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t("events.filters.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="w-44"
            aria-label={t("events.filters.allModules")}
          >
            <option value="">{t("events.filters.allModules")}</option>
            {NOTI_EVENT_MODULE_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | "enabled" | "disabled")}
            className="w-44"
            aria-label={t("events.filters.allStatuses")}
          >
            <option value="">{t("events.filters.allStatuses")}</option>
            <option value="enabled">{t("events.filters.enabledOnly")}</option>
            <option value="disabled">{t("events.filters.disabledOnly")}</option>
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={isLoading}
        globalFilter={search}
        emptyState={
          <EmptyState title={t("events.empty.title")} description={t("events.empty.description")} />
        }
        pageSize={20}
      />

      {confirm && (
        <ConfirmDialog
          open
          title={
            confirm.nextEnabled ? t("events.confirm.enableTitle") : t("events.confirm.disableTitle")
          }
          description={
            confirm.nextEnabled
              ? t("events.confirm.enableDescription", { name: confirm.event.event_name })
              : t("events.confirm.disableDescription", { name: confirm.event.event_name })
          }
          confirmLabel={
            confirm.nextEnabled ? t("events.actions.enable") : t("events.actions.disable")
          }
          cancelLabel={t("events.confirm.cancel")}
          busy={toggleMutation.isPending}
          busyLabel={t("events.confirm.submitting")}
          onConfirm={() => toggleMutation.mutate(confirm)}
          onCancel={() => {
            if (toggleMutation.isPending) return;
            toggleMutation.reset();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

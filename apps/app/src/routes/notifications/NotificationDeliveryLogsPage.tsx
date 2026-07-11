/**
 * NOTI-SCREEN-DELIVERY-LOGS (S4-FE-NOTI-3) — /notifications/delivery-logs (viewer, chỉ đọc).
 *
 * GET /notifications/delivery-logs (NOTI-API-401, NotificationAdminController.listDeliveryLogs,
 * S4-NOTI-BE-3) — filter channel/delivery_status/recipient_user_id/created_from-to + phân trang
 * page-based. Gate view:notification-delivery-log (is_sensitive=TRUE, seed THẬT mig 0481) → dùng
 * useCanExact (KHÔNG wildcard fallback — mirror BE fail-closed cho cặp sensitive).
 *
 * BẤT BIẾN #2 (APPEND-ONLY): KHÔNG có nút sửa/xoá/retry — server chỉ có route GET cho delivery-logs
 * (chưa có BE retry endpoint, out-of-scope WO này). BẤT BIẾN #3: DTO notificationDeliveryLogAdminItemSchema
 * WHITELIST — client chỉ render field server đã cho phép.
 *
 * States: loading · error · empty · forbidden. Phân trang server-side (page/per_page) tái dùng
 * AuthLogPagination (heuristic full-page ⇒ còn trang sau — total KHÔNG khả dụng ở client, cùng kỹ thuật
 * FileAccessLogsPage/NotificationListPage).
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Send } from "lucide-react";
import {
  notificationDeliveryLogApi,
  notificationKeys,
  useCanExact,
  type NotificationDeliveryLogAdminItem,
} from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, PageHeader, Select } from "@mediaos/ui";
import {
  AuthLogPagination,
  DateField,
  FilterShell,
  LabeledField,
  TextField,
} from "@/routes/system/auth-logs/AuthLogControls";
import {
  emptyToUndefined,
  useAuthLogFilters,
} from "@/routes/system/auth-logs/use-auth-log-filters";
import {
  NOTI_DELIVERY_LOG_CHANNELS,
  NOTI_DELIVERY_LOG_PAGE_SIZE,
  NOTI_DELIVERY_LOG_STATUSES,
  NOTI_ENGINE_PAIRS,
} from "./constants";

type LogFilters = {
  channel: string; // "" = mọi kênh
  deliveryStatus: string; // "" = mọi trạng thái
  recipientUserId: string;
  fromDate: string;
  toDate: string;
};

const INITIAL_FILTERS: LogFilters = {
  channel: "",
  deliveryStatus: "",
  recipientUserId: "",
  fromDate: "",
  toDate: "",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  Pending: "outline",
  Sent: "secondary",
  Delivered: "default",
  Failed: "destructive",
  Skipped: "outline",
  Cancelled: "outline",
};

function useColumns(
  t: ReturnType<typeof useTranslation<"notifications">>["t"],
): ColumnDef<NotificationDeliveryLogAdminItem>[] {
  return [
    {
      accessorKey: "created_at",
      header: t("deliveryLogs.columns.createdAt"),
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm text-muted-foreground">
          {new Date(row.original.created_at).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "channel",
      header: t("deliveryLogs.columns.channel"),
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono">
          {row.original.channel}
        </Badge>
      ),
    },
    {
      accessorKey: "delivery_status",
      header: t("deliveryLogs.columns.status"),
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.delivery_status] ?? "secondary"}>
          {t(`deliveryLogs.status.${row.original.delivery_status}`, {
            defaultValue: row.original.delivery_status,
          })}
        </Badge>
      ),
    },
    {
      accessorKey: "recipient_user_id",
      header: t("deliveryLogs.columns.recipient"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.recipient_user_id}
        </span>
      ),
    },
    {
      accessorKey: "attempt_no",
      header: t("deliveryLogs.columns.attempt"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.attempt_no}/{row.original.max_attempts}
        </span>
      ),
    },
    {
      accessorKey: "error_message",
      header: t("deliveryLogs.columns.error"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.error_message ?? row.original.error_code ?? "—"}
        </span>
      ),
    },
  ];
}

export function NotificationDeliveryLogsPage() {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const canView = useCanExact(
    NOTI_ENGINE_PAIRS.VIEW_DELIVERY_LOG.action,
    NOTI_ENGINE_PAIRS.VIEW_DELIVERY_LOG.resourceType,
  );

  const { page, draft, applied, setPage, setDraftField, applyFilters, resetFilters } =
    useAuthLogFilters<LogFilters>(INITIAL_FILTERS);

  const queryParams = {
    page,
    per_page: NOTI_DELIVERY_LOG_PAGE_SIZE,
    channel: emptyToUndefined(applied.channel),
    delivery_status: emptyToUndefined(applied.deliveryStatus),
    recipient_user_id: emptyToUndefined(applied.recipientUserId),
    created_from: emptyToUndefined(applied.fromDate),
    created_to: emptyToUndefined(applied.toDate),
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: notificationKeys.deliveryLogs(queryParams),
    queryFn: () => notificationDeliveryLogApi.list(queryParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useColumns(t);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("deliveryLogs.forbidden.title")}
          description={t("deliveryLogs.forbidden.description")}
          data-testid="notification-delivery-logs-forbidden"
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("deliveryLogs.title")}
          description={t("deliveryLogs.description")}
          icon={Send}
        />
        <div className="mt-8">
          <EmptyState
            title={t("deliveryLogs.error.title")}
            description={t("deliveryLogs.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const items = data ?? [];

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("deliveryLogs.title")}
        description={t("deliveryLogs.description")}
        icon={Send}
      />

      <FilterShell onApply={applyFilters} onReset={resetFilters}>
        <LabeledField label={t("deliveryLogs.filters.channel")}>
          <Select value={draft.channel} onChange={(e) => setDraftField("channel", e.target.value)}>
            <option value="">{t("authLogFilters.allStatuses")}</option>
            {NOTI_DELIVERY_LOG_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </LabeledField>
        <LabeledField label={t("deliveryLogs.filters.status")}>
          <Select
            value={draft.deliveryStatus}
            onChange={(e) => setDraftField("deliveryStatus", e.target.value)}
          >
            <option value="">{t("authLogFilters.allStatuses")}</option>
            {NOTI_DELIVERY_LOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`deliveryLogs.status.${s}`, { defaultValue: s })}
              </option>
            ))}
          </Select>
        </LabeledField>
        <TextField
          label={t("deliveryLogs.filters.recipient")}
          value={draft.recipientUserId}
          placeholder={t("deliveryLogs.filters.recipientPlaceholder")}
          onChange={(v) => setDraftField("recipientUserId", v)}
        />
        <DateField
          label={t("authLogFilters.fromDate")}
          value={draft.fromDate}
          onChange={(v) => setDraftField("fromDate", v)}
        />
        <DateField
          label={t("authLogFilters.toDate")}
          value={draft.toDate}
          onChange={(v) => setDraftField("toDate", v)}
        />
      </FilterShell>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("deliveryLogs.empty.title")}
            description={t("deliveryLogs.empty.description")}
          />
        }
        pageSize={NOTI_DELIVERY_LOG_PAGE_SIZE}
      />

      <AuthLogPagination
        page={page}
        currentCount={items.length}
        pageSize={NOTI_DELIVERY_LOG_PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}

/**
 * NotificationTemplatesPage (UI-NOTI-SCREEN-005 · SPEC-08 §13.4 NOTI-SCREEN-006 "Quản lý mẫu thông báo")
 * — S4-FE-NOTI-4. Bảng template theo event: filter event/channel + sửa title/body/short_body/action_label/
 * target_url (ghi company-override — server tự xử lý, KHÔNG bao giờ chạm hàng global).
 *
 * Nối S4-NOTI-BE-5 (GET /notifications/templates, NOTI-API-303 LIST) + BE-3/BE-4 (GET/PATCH
 * /notifications/templates/:id). Gate:
 *   - Xem : useCanExact('view','notification-template')   — is_sensitive=true, fail-closed.
 *   - Sửa : useCanExact('update','notification-template') — is_sensitive=true; nút "Sửa" ẨN nếu thiếu
 *           quyền, đồng thời bọc thêm <PermissionGate> (defense-in-depth, mirror DashboardConfigPage).
 * CẢ 2 cặp đã ở SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) — KHÔNG dùng useCan (wildcard
 * '*:*' KHÔNG mở cổng cặp sensitive).
 *
 * Cột "event_code" — response NOTI-API-303 chỉ mang `event_id` (KHÔNG join event_code, mirror BE-5 hiện
 * tại). Trang enrich BEST-EFFORT: nếu user CŨNG có view:notification-config (cặp RIÊNG, cùng allowlist)
 * thì fetch catalog GET /notifications/events (đã dùng ở NotificationEventsPage) để dựng map event_id→
 * event_code hiển thị; thiếu quyền đó vẫn hoạt động bình thường — cột hiện `event_id` thô (KHÔNG chặn
 * màn hình, KHÔNG tự leo quyền — chỉ gọi endpoint khi ĐÃ có đúng cặp).
 *
 * Deep-link `?event=<event_code>` từ NotificationEventsPage ("xem template") — đọc qua
 * `window.location.search` (mirror TaskCommentThread `?comment_id=`), gán làm filter event_code ban đầu.
 *
 * Masking là việc của SERVER — trang chỉ render field nhận được từ notificationTemplateAdminItemSchema.
 * States: forbidden · loading · error · empty · list (+ dialog sửa).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { FileText, RefreshCw, Pencil } from "lucide-react";
import type { NotificationTemplateAdminItem } from "@mediaos/contracts";
import {
  notificationAdminApi,
  notificationKeys,
  PermissionGate,
  useCanExact,
  formatDateTime,
} from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Input, Select, Badge } from "@mediaos/ui";
import { useNotificationTemplates } from "./hooks/useNotificationTemplates";
import { NotificationTemplateEditDialog } from "./NotificationTemplateEditDialog";
import {
  NOTI_TEMPLATE_ENGINE_PAIRS,
  NOTI_EVENT_ENGINE_PAIRS,
  NOTI_DELIVERY_LOG_CHANNELS,
} from "./constants";

type TF = ReturnType<typeof useTranslation<"notifications">>["t"];

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline" | "success" | "muted"
> = {
  Active: "success",
  Draft: "outline",
  Inactive: "muted",
  Archived: "destructive",
};

function initialEventFilter(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("event") ?? "";
}

function useColumns(
  t: TF,
  eventCodeByEventId: Map<string, string>,
  onEdit: ((template: NotificationTemplateAdminItem) => void) | null,
): ColumnDef<NotificationTemplateAdminItem>[] {
  const cols: ColumnDef<NotificationTemplateAdminItem>[] = [
    {
      accessorKey: "event_id",
      header: t("templates.columns.event"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {eventCodeByEventId.get(row.original.event_id) ?? row.original.event_id}
        </span>
      ),
    },
    {
      accessorKey: "template_code",
      header: t("templates.columns.templateCode"),
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.template_code}</span>,
    },
    {
      accessorKey: "channel",
      header: t("templates.columns.channel"),
      cell: ({ row }) => (
        <Badge variant="outline" className="font-mono">
          {row.original.channel}
        </Badge>
      ),
    },
    {
      accessorKey: "locale",
      header: t("templates.columns.locale"),
      cell: ({ row }) => <span className="text-sm">{row.original.locale}</span>,
    },
    {
      accessorKey: "status",
      header: t("templates.columns.status"),
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status] ?? "secondary"}>
          {t(`templates.status.${row.original.status}`, { defaultValue: row.original.status })}
        </Badge>
      ),
    },
    {
      accessorKey: "is_default",
      header: t("templates.columns.isDefault"),
      cell: ({ row }) =>
        row.original.is_default ? (
          <Badge variant="secondary">{t("templates.badges.default")}</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      accessorKey: "is_company_override",
      header: t("templates.columns.scope"),
      cell: ({ row }) => (
        <Badge variant={row.original.is_company_override ? "default" : "outline"}>
          {row.original.is_company_override
            ? t("templates.badges.override")
            : t("templates.badges.global")}
        </Badge>
      ),
    },
    {
      accessorKey: "version",
      header: t("templates.columns.version"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.version}</span>,
    },
    {
      accessorKey: "updated_at",
      header: t("templates.columns.updatedAt"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(row.original.updated_at)}
        </span>
      ),
    },
  ];
  if (onEdit) {
    cols.push({
      id: "actions",
      header: t("templates.columns.actions"),
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(row.original)}
          data-testid={`template-edit-btn-${row.original.id}`}
        >
          <Pencil className="mr-1 h-3.5 w-3.5" />
          {t("templates.actions.edit")}
        </Button>
      ),
    });
  }
  return cols;
}

function NotificationTemplatesPageInner() {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");

  const canUpdate = useCanExact(
    NOTI_TEMPLATE_ENGINE_PAIRS.UPDATE.action,
    NOTI_TEMPLATE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  // Enrichment BEST-EFFORT (cặp RIÊNG, KHÔNG bắt buộc để xem bảng template) — xem header block comment.
  const canViewEvents = useCanExact(
    NOTI_EVENT_ENGINE_PAIRS.VIEW.action,
    NOTI_EVENT_ENGINE_PAIRS.VIEW.resourceType,
  );

  const [eventFilter, setEventFilter] = useState<string>(initialEventFilter);
  const [channelFilter, setChannelFilter] = useState("");
  const [editing, setEditing] = useState<NotificationTemplateAdminItem | null>(null);

  const { data, isLoading, isError, refetch } = useNotificationTemplates({
    event_code: eventFilter || undefined,
    channel: channelFilter || undefined,
  });

  const { data: eventsCatalog } = useQuery({
    queryKey: notificationKeys.events({ per_page: 100 }),
    queryFn: () => notificationAdminApi.listEvents({ per_page: 100 }),
    enabled: canViewEvents,
    staleTime: 30_000,
  });
  const eventCodeByEventId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ev of eventsCatalog ?? []) map.set(ev.id, ev.event_code);
    return map;
  }, [eventsCatalog]);

  const items = data ?? [];
  const columns = useColumns(t, eventCodeByEventId, canUpdate ? (tpl) => setEditing(tpl) : null);

  if (isError) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("templates.title")}
          description={t("templates.description")}
          icon={FileText}
        />
        <div className="mt-8">
          <EmptyState
            title={t("templates.error.title")}
            description={t("templates.error.description")}
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
      <PageHeader
        title={t("templates.title")}
        description={t("templates.description")}
        icon={FileText}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder={t("templates.filters.eventPlaceholder")}
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
            className="w-56"
            aria-label={t("templates.filters.event")}
          />
          <Select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="w-44"
            aria-label={t("templates.filters.channel")}
          >
            <option value="">{t("templates.filters.allChannels")}</option>
            {NOTI_DELIVERY_LOG_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("templates.empty.title")}
            description={t("templates.empty.description")}
          />
        }
        pageSize={20}
      />

      {editing && (
        <PermissionGate
          action={NOTI_TEMPLATE_ENGINE_PAIRS.UPDATE.action}
          resourceType={NOTI_TEMPLATE_ENGINE_PAIRS.UPDATE.resourceType}
        >
          <NotificationTemplateEditDialog template={editing} onClose={() => setEditing(null)} />
        </PermissionGate>
      )}
    </div>
  );
}

export function NotificationTemplatesPage() {
  const { t } = useTranslation("notifications");
  const canView = useCanExact(
    NOTI_TEMPLATE_ENGINE_PAIRS.VIEW.action,
    NOTI_TEMPLATE_ENGINE_PAIRS.VIEW.resourceType,
  );

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("templates.forbidden.title")}
          description={t("templates.forbidden.description")}
          data-testid="templates-forbidden"
        />
      </div>
    );
  }

  return <NotificationTemplatesPageInner />;
}

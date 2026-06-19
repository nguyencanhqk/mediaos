import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Webhook } from "lucide-react";
import { useTranslation } from "react-i18next";
import { webhookEventTypeEnum, type WebhookEndpointDto } from "@mediaos/contracts";
import { useCan } from "@mediaos/web-core";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  Dialog,
  EmptyState,
  Select,
} from "@mediaos/ui";
import { webhooksApi } from "@/lib/webhooks-api";
import { CreateWebhookDialog } from "./create-webhook-dialog";
import { DeliveryLog } from "./delivery-log";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN");
}

/**
 * AC-6 Webhooks — tenant self-service (apps/console, aud=user). view:webhook để đọc (xem danh sách +
 * delivery log), manage:webhook để tạo/xoá/đăng ký (is_sensitive ở BE; UI chỉ ẩn/hiện affordance qua
 * useCan — KHÔNG hard-code permission). Secret hiển thị MỘT LẦN ở CreateWebhookDialog (state local).
 * loading/error/empty + pagination qua DataTable dùng chung.
 */
export function WebhooksPage() {
  const { t } = useTranslation("webhooks");
  const queryClient = useQueryClient();
  const canView = useCan("view", "webhook");
  const canManage = useCan("manage", "webhook");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<WebhookEndpointDto | null>(null);
  const [subscribeTarget, setSubscribeTarget] = React.useState<WebhookEndpointDto | null>(null);
  const [eventType, setEventType] = React.useState<string>(webhookEventTypeEnum.options[0]);
  const [deliveriesFor, setDeliveriesFor] = React.useState<WebhookEndpointDto | null>(null);
  const [flash, setFlash] = React.useState<string | null>(null);

  const endpointsQuery = useQuery({
    queryKey: ["webhooks", "endpoints"],
    queryFn: webhooksApi.listEndpoints,
    enabled: canView,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhooksApi.deleteEndpoint(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks", "endpoints"] });
      setDeleteTarget(null);
      setFlash(t("feedback.deleted"));
    },
  });

  const subscribeMutation = useMutation({
    mutationFn: ({ endpointId, evt }: { endpointId: string; evt: string }) =>
      webhooksApi.subscribe(endpointId, {
        eventType: evt as Parameters<typeof webhooksApi.subscribe>[1]["eventType"],
      }),
    onSuccess: () => {
      setSubscribeTarget(null);
      setFlash(t("subscribe.added"));
    },
  });

  if (!canView) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <EmptyState
          icon={Webhook}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  const columns: ColumnDef<WebhookEndpointDto>[] = [
    {
      accessorKey: "url",
      header: t("table.url"),
      cell: ({ row }) => <code className="text-xs">{row.original.url}</code>,
    },
    { accessorKey: "description", header: t("table.description") },
    {
      accessorKey: "active",
      header: t("table.active"),
      cell: ({ row }) => (
        <Badge variant={row.original.active ? "secondary" : "outline"}>
          {row.original.active ? t("table.activeYes") : t("table.activeNo")}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: t("table.created"),
      cell: ({ row }) => fmtDate(row.original.createdAt),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setDeliveriesFor(row.original)}>
            {t("actions.viewDeliveries")}
          </Button>
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={() => setSubscribeTarget(row.original)}>
                {t("actions.subscribe")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(row.original)}>
                {t("actions.delete")}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && <Button onClick={() => setCreateOpen(true)}>{t("actions.create")}</Button>}
      </header>

      {flash && (
        <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          {flash}
        </p>
      )}

      {endpointsQuery.isError && (
        <p
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t("feedback.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void endpointsQuery.refetch()}>
            {t("common:actions.retry")}
          </Button>
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <DataTable
            columns={columns}
            data={endpointsQuery.data ?? []}
            isLoading={endpointsQuery.isLoading}
            emptyState={
              <EmptyState icon={Webhook} title={t("table.empty")} description={t("subtitle")} />
            }
          />
        </CardContent>
      </Card>

      {deliveriesFor && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("deliveries.title")}</CardTitle>
            <CardDescription>
              <code className="text-xs">{deliveriesFor.url}</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeliveryLog endpointId={deliveriesFor.id} />
          </CardContent>
        </Card>
      )}

      {createOpen && (
        <CreateWebhookDialog
          open
          onClose={() => setCreateOpen(false)}
          onSuccess={() => setFlash(t("feedback.created"))}
        />
      )}

      {deleteTarget && (
        <Dialog
          open
          onClose={() => {
            deleteMutation.reset();
            setDeleteTarget(null);
          }}
          title={t("delete.title")}
          description={t("delete.description", { url: deleteTarget.url })}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteMutation.isPending}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
              >
                {t("delete.confirm")}
              </Button>
            </>
          }
        >
          {deleteMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("feedback.deleteFailed")}
            </p>
          )}
        </Dialog>
      )}

      {subscribeTarget && (
        <Dialog
          open
          onClose={() => {
            subscribeMutation.reset();
            setSubscribeTarget(null);
          }}
          title={t("subscribe.title")}
          footer={
            <>
              <Button
                variant="outline"
                onClick={() => setSubscribeTarget(null)}
                disabled={subscribeMutation.isPending}
              >
                {t("common:actions.cancel")}
              </Button>
              <Button
                onClick={() =>
                  subscribeMutation.mutate({ endpointId: subscribeTarget.id, evt: eventType })
                }
                disabled={subscribeMutation.isPending}
              >
                {t("subscribe.submit")}
              </Button>
            </>
          }
        >
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="wh-event">
              {t("subscribe.eventLabel")}
            </label>
            <Select id="wh-event" value={eventType} onChange={(e) => setEventType(e.target.value)}>
              {webhookEventTypeEnum.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
            {subscribeMutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t("feedback.subscribeFailed")}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  );
}

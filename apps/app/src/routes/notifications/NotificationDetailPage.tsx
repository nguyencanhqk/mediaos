import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import {
  myNotificationApi,
  notificationInvalidation,
  notificationKeys,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Badge } from "@mediaos/ui";
import { NotificationTargetLink } from "@/components/notifications/NotificationTargetLink";
import { NOTI_ENGINE_PAIRS, NOTI_PATHS } from "./constants";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

interface NotificationDetailPageProps {
  notificationId: string;
}

/**
 * NotificationDetailPage — S4-FE-NOTI-1. GET /notifications/:id?auto_mark_read=true (NOTI-API-004) —
 * mở chi tiết ⇒ server tự mark Read nếu đang Unread (đọc = ngầm định đã xem). Sau khi fetch thành công,
 * invalidate list/dropdown/unread-count 1 LẦN/notificationId (badge/dropdown tự cập nhật ở lần dùng sau —
 * TanStack Query v5 KHÔNG còn `onSuccess` trên useQuery, dùng useEffect + ref-guard chống lặp vô hạn).
 *
 * Deep link: nếu có `target.target_url` (module gốc — HR/ATT/LEAVE/TASK…) render nút điều hướng qua
 * `NotificationTargetLink` — route đích VẪN qua `beforeLoad`/`ProtectedRoute` của chính module đó (KHÔNG
 * bỏ qua guard, xem ghi chú trong NotificationTargetLink.tsx).
 */
export function NotificationDetailPage({ notificationId }: NotificationDetailPageProps) {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const invalidatedForId = useRef<string | null>(null);

  const canView = useCan(NOTI_ENGINE_PAIRS.READ.action, NOTI_ENGINE_PAIRS.READ.resourceType);
  const canDelete = useCan(NOTI_ENGINE_PAIRS.DELETE.action, NOTI_ENGINE_PAIRS.DELETE.resourceType);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: notificationKeys.detail(notificationId),
    queryFn: () => myNotificationApi.detail(notificationId, { auto_mark_read: true }),
    enabled: canView,
    staleTime: 15_000,
    retry: (count, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return count < 2;
    },
  });

  useEffect(() => {
    if (!data || invalidatedForId.current === data.notification_id) return;
    invalidatedForId.current = data.notification_id;
    for (const key of notificationInvalidation.markRead(data.notification_id)) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [data, queryClient]);

  const deleteMutation = useMutation({
    mutationFn: () => myNotificationApi.remove(notificationId),
    onSuccess: () => {
      for (const key of notificationInvalidation.remove(notificationId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      goBack();
    },
  });

  function goBack() {
    void navigate({ to: NOTI_PATHS.LIST as "/" });
  }

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("detail.forbidden.title")}
          description={t("detail.forbidden.description")}
          action={
            <Button variant="outline" size="sm" onClick={goBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("detail.backToList")}
            </Button>
          }
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // ── Not found / error ──────────────────────────────────────────────────────
  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="p-6">
        <EmptyState
          title={notFound ? t("detail.notFound.title") : t("detail.error.title")}
          description={notFound ? t("detail.notFound.description") : t("detail.error.description")}
          action={
            !notFound ? (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.backToList")}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={data.title}
        icon={undefined}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow
            label={t("detail.fields.status")}
            value={
              <Badge variant={data.is_read ? "outline" : "default"}>
                {t(`status.${data.status}`, { defaultValue: data.status })}
              </Badge>
            }
          />
          <FieldRow
            label={t("detail.fields.priority")}
            value={t(`priority.${data.priority}`, { defaultValue: data.priority })}
          />
          {data.source_module && (
            <FieldRow label={t("detail.fields.sourceModule")} value={data.source_module} />
          )}
          <FieldRow
            label={t("detail.fields.createdAt")}
            value={new Date(data.created_at).toLocaleString("vi-VN")}
          />
          {data.read_at && (
            <FieldRow
              label={t("detail.fields.readAt")}
              value={new Date(data.read_at).toLocaleString("vi-VN")}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-5">
          <p className="whitespace-pre-line text-sm leading-relaxed">{data.content}</p>
        </CardContent>
      </Card>

      {data.target.target_url ? (
        <NotificationTargetLink
          targetUrl={data.target.target_url}
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <ExternalLink className="h-4 w-4" />
          {t("detail.goToTarget")}
        </NotificationTargetLink>
      ) : (
        <p className="text-sm text-muted-foreground">{t("detail.noTarget")}</p>
      )}

      {canDelete && (
        <div className="flex justify-end gap-3 pt-2">
          {confirmingDelete ? (
            <>
              <span className="self-center text-sm text-muted-foreground">
                {t("actions.deleteConfirm")}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                {tc("actions.cancel")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("actions.delete")}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t("actions.delete")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * MeNotificationPreferencesPage — ME-SCREEN-013 "Tuỳ chọn thông báo" (SPEC-09 §8.1/§8.2/§10.7,
 * route "/me/preferences/notifications").
 *
 * Đọc `GET /notifications/preferences` (notificationPreferencesApi.list, own-scope) — endpoint chỉ trả về
 * các dòng user ĐÃ override; loại chưa có dòng mặc định `enabled=true` (opt-out model, mirror BE
 * `NotificationPreferencesRepository.isTypeEnabled`). Toggle kênh In-app gọi `PUT /notifications/
 * preferences {notificationType, enabled}`.
 *
 * NOTI-002 (mandatory): server chặn tắt loại mandatory bằng 400 — response KHÔNG lộ trước loại nào là
 * mandatory (repository chỉ check khi `enabled=false`), nên UI học được điều này REACTIVE (sau lần thử
 * tắt đầu tiên thất bại) — từ đó nhớ lại (`mandatoryTypes`) để: (1) hiển thị lại đúng trạng thái "đang bật"
 * (KHÔNG hiển thị tắt giả — cache KHÔNG cập nhật khi lỗi nên checkbox tự trở về giá trị cũ; RIÊNG loại đã
 * biết mandatory còn ép `checked=true` phòng trường hợp dòng cũ trong DB lưu `enabled=false` từ trước khi
 * rule trở thành mandatory — effective luôn là true, xem `isTypeEnabled`), (2) khoá checkbox + hiện giải
 * thích để người dùng không thử lại vô ích.
 *
 * Kênh Email/Push: SPEC-09 §10.7 "Nếu kênh chưa cấu hình thì UI hiển thị unavailable, không giả lập đã
 * bật" — BE chưa có cột lưu theo-kênh (chỉ 1 `enabled` per type, ngầm định In-app) nên render CỐ ĐỊNH
 * unchecked+disabled+nhãn "chưa hỗ trợ", KHÔNG suy diễn trạng thái.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, RefreshCw } from "lucide-react";
import {
  ApiError,
  notificationPreferenceKeys,
  notificationPreferencesApi,
  useCan,
} from "@mediaos/web-core";
import {
  EmptyState,
  Button,
  Skeleton,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Checkbox,
} from "@mediaos/ui";
import type { NotificationPreferenceDto, NotificationType } from "@mediaos/contracts";
import { ME_ACCESS_PAIR, ME_NOTIFICATION_PREFERENCE_GROUPS } from "./constants";

function MeNotificationPreferencesPageInner() {
  const { t } = useTranslation("me");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: notificationPreferenceKeys.list(),
    queryFn: notificationPreferencesApi.list,
    staleTime: 30_000,
  });

  // Học REACTIVE loại nào mandatory (KHÔNG có nguồn nào phơi trước — xem docstring trên).
  const [mandatoryTypes, setMandatoryTypes] = useState<ReadonlySet<NotificationType>>(new Set());
  const [genericErrorTypes, setGenericErrorTypes] = useState<ReadonlySet<NotificationType>>(
    new Set(),
  );

  const upsertMutation = useMutation({
    mutationFn: notificationPreferencesApi.upsert,
    onSuccess: (row) => {
      queryClient.setQueryData<NotificationPreferenceDto[]>(
        notificationPreferenceKeys.list(),
        (old) => [...(old ?? []).filter((p) => p.notificationType !== row.notificationType), row],
      );
      setGenericErrorTypes((prev) => {
        const next = new Set(prev);
        next.delete(row.notificationType);
        return next;
      });
    },
    onError: (error, variables) => {
      const type = variables.notificationType;
      if (error instanceof ApiError && error.status === 400) {
        setMandatoryTypes((prev) => new Set(prev).add(type));
        return;
      }
      setGenericErrorTypes((prev) => new Set(prev).add(type));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-56 w-full max-w-2xl rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("notificationPreferencesPage.error.title")}
          description={t("notificationPreferencesPage.error.description")}
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

  const rows = data ?? [];
  const isEnabled = (type: NotificationType): boolean => {
    // Loại đã biết mandatory: effective LUÔN true (mirror BE isTypeEnabled) — KHÔNG đọc dòng cache stale.
    if (mandatoryTypes.has(type)) return true;
    return rows.find((r) => r.notificationType === type)?.enabled ?? true;
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("notificationPreferencesPage.title")}
        description={t("notificationPreferencesPage.description")}
        icon={BellRing}
      />

      {ME_NOTIFICATION_PREFERENCE_GROUPS.map((group) => (
        <Card key={group.groupKey}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t(group.labelKey)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {group.types.map((type) => {
              const enabled = isEnabled(type);
              const isMandatory = mandatoryTypes.has(type);
              const hasGenericError = genericErrorTypes.has(type);

              return (
                <div
                  key={type}
                  className="space-y-1.5 border-b border-border pb-4 last:border-0 last:pb-0"
                >
                  <p className="text-sm font-medium text-foreground">
                    {t(`notificationPreferencesPage.types.${type}`)}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <label className="flex items-center gap-1.5">
                      <Checkbox
                        checked={enabled}
                        disabled={isMandatory || upsertMutation.isPending}
                        aria-label={t("notificationPreferencesPage.channels.inApp")}
                        onChange={(e) =>
                          upsertMutation.mutate({
                            notificationType: type,
                            enabled: e.target.checked,
                          })
                        }
                      />
                      {t("notificationPreferencesPage.channels.inApp")}
                    </label>
                    <span className="flex items-center gap-1.5 opacity-60">
                      <Checkbox checked={false} disabled aria-label="Email" />
                      {t("notificationPreferencesPage.channels.email")} (
                      {t("notificationPreferencesPage.unavailable")})
                    </span>
                    <span className="flex items-center gap-1.5 opacity-60">
                      <Checkbox checked={false} disabled aria-label="Push" />
                      {t("notificationPreferencesPage.channels.push")} (
                      {t("notificationPreferencesPage.unavailable")})
                    </span>
                  </div>
                  {isMandatory && (
                    <p className="text-xs text-warning">
                      {t("notificationPreferencesPage.mandatoryExplanation")}
                    </p>
                  )}
                  {hasGenericError && !isMandatory && (
                    <p className="text-xs text-danger">
                      {t("notificationPreferencesPage.genericError")}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function MeNotificationPreferencesPage() {
  const { t } = useTranslation("me");
  const canAccess = useCan(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType);

  if (!canAccess) {
    return (
      <div className="p-6">
        <EmptyState title={t("forbidden.title")} description={t("forbidden.description")} />
      </div>
    );
  }

  return <MeNotificationPreferencesPageInner />;
}

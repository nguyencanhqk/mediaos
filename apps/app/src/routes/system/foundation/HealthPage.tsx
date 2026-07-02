/**
 * SYSTEM-SCREEN-HEALTH (S2-FE-FND-4) — /system/health, đọc GET /health + /health/db, read-only.
 *
 * BE: HealthController @Public() (KHÔNG @RequirePermission — liveness/readiness probe cố ý mở). Không có
 * cặp quyền 'foundation-health' seed → gate màn hình bằng baseline "đang ở khu vực quản trị hệ thống"
 * (view:foundation-setting OR view:user, giống hệt route system.overview trong ROUTE_REGISTRY) thay vì
 * bịa cặp không tồn tại (xem constants.ts). Route-level cũng chặn qua ProtectedRoute (systemHealthMeta).
 *
 * States: forbidden · loading · error (mỗi probe độc lập) · ok/down.
 */
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, RefreshCw } from "lucide-react";
import { getHealth, getHealthDb, rootKeys, useCan } from "@mediaos/web-core";
import { PageHeader, EmptyState, Card, CardContent, Badge, Button } from "@mediaos/ui";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

function StatusBadge({
  t,
  isLoading,
  isError,
  ok,
}: {
  t: TF;
  isLoading: boolean;
  isError: boolean;
  ok: boolean;
}) {
  if (isLoading) return <Badge variant="secondary">{t("health.status.checking")}</Badge>;
  if (isError || !ok) return <Badge variant="danger">{t("health.status.down")}</Badge>;
  return <Badge variant="success">{t("health.status.ok")}</Badge>;
}

export function HealthPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");

  const canViewSetting = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_SETTING_BASELINE.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_SETTING_BASELINE.resourceType,
  );
  const canViewUser = useCan("view", "user");
  const canView = canViewSetting || canViewUser;

  const apiQuery = useQuery({
    queryKey: [...rootKeys.foundation, "health", "liveness"],
    queryFn: getHealth,
    enabled: canView,
    staleTime: 15_000,
    retry: false,
  });

  const dbQuery = useQuery({
    queryKey: [...rootKeys.foundation, "health", "readiness"],
    queryFn: getHealthDb,
    enabled: canView,
    staleTime: 15_000,
    retry: false,
  });

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("health.forbidden.title")}
          description={t("health.forbidden.description")}
        />
      </div>
    );
  }

  const anyError = apiQuery.isError || dbQuery.isError;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("health.title")}
        description={t("health.description")}
        icon={Activity}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void apiQuery.refetch();
              void dbQuery.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {tc("actions.retry")}
          </Button>
        }
      />

      {anyError && (
        <p role="alert" className="text-sm text-destructive">
          {t("health.error.description")}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                <Activity className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("health.cards.api.title")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("health.cards.api.description")}</p>
                <StatusBadge
                  t={t}
                  isLoading={apiQuery.isLoading}
                  isError={apiQuery.isError}
                  ok={apiQuery.data?.status === "ok"}
                />
                {apiQuery.data?.time && (
                  <p className="text-xs text-muted-foreground">
                    {t("health.cards.api.timestamp", { time: apiQuery.data.time })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 pt-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-muted text-brand">
                <Database className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {t("health.cards.db.title")}
                </h3>
                <p className="text-sm text-muted-foreground">{t("health.cards.db.description")}</p>
                <StatusBadge
                  t={t}
                  isLoading={dbQuery.isLoading}
                  isError={dbQuery.isError}
                  ok={dbQuery.data?.status === "ok"}
                />
                {dbQuery.data?.database?.latencyMs !== undefined && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {t("health.cards.db.latency", { ms: dbQuery.data.database.latencyMs })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

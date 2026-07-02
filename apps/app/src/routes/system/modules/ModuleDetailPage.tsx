/**
 * ModuleDetailPage — chi tiết 1 module trong catalog (SYSTEM-SCREEN-MODULES detail, S2-FE-FND-3).
 *
 * Nguồn: GET /foundation/modules/:code (S2-FND-BE-1, ModuleAdminController). Cổng quyền GIỐNG trang
 * list — useCan('view','foundation-module'); route-level guard (ProtectedRoute) đã chặn thiếu quyền
 * trước khi tới component này.
 *
 * Toggle enable/disable = CHỜ BE follow-up (chưa có endpoint mutation) — trang này CHỈ hiển thị
 * metadata/required-permissions/enabled, KHÔNG dựng nút mutation chết.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LayoutGrid, RefreshCw } from "lucide-react";
import { adminModuleDetailSchema } from "@mediaos/contracts";
import { apiFetch, ApiError } from "@mediaos/web-core";
import { Badge, Button, Card, CardContent, EmptyState, PageHeader } from "@mediaos/ui";
import { MODULES_PATH, MODULE_DETAIL_QUERY_KEY, moduleDetailApi } from "./constants";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value ?? "—"}</span>
    </div>
  );
}

interface ModuleDetailPageProps {
  moduleCode: string;
}

export function ModuleDetailPage({ moduleCode }: ModuleDetailPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();

  function goBack() {
    void navigate({ to: MODULES_PATH as "/" });
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...MODULE_DETAIL_QUERY_KEY, moduleCode] as const,
    queryFn: () => apiFetch(moduleDetailApi(moduleCode), adminModuleDetailSchema),
  });

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6" data-testid="module-detail-loading">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="h-40 rounded bg-muted" />
        </div>
      </div>
    );
  }

  // ── Error states (403 forbidden / 404 not-found / generic) ────────────────
  if (isError) {
    const isForbidden = error instanceof ApiError && error.status === 403;
    const isNotFound = error instanceof ApiError && error.status === 404;

    if (isForbidden) {
      return (
        <div className="p-6" data-testid="module-detail-forbidden">
          <EmptyState
            title={t("modules.forbidden.title")}
            description={t("modules.forbidden.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("modules.detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    if (isNotFound) {
      return (
        <div className="p-6" data-testid="module-detail-not-found">
          <EmptyState
            title={t("modules.detail.notFound.title")}
            description={t("modules.detail.notFound.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("modules.detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className="p-6" data-testid="module-detail-error">
        <EmptyState
          title={t("modules.error.title")}
          description={t("modules.error.description")}
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

  if (!data) return null;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("modules.detail.title")}
        icon={LayoutGrid}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("modules.detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("modules.columns.code")} value={data.module_code} />
          <FieldRow label={t("modules.columns.name")} value={data.name} />
          <FieldRow label={t("modules.detail.description")} value={data.description} />
          <FieldRow label={t("modules.columns.group")} value={data.group} />
          <FieldRow
            label={t("modules.columns.active")}
            value={
              <Badge variant={data.is_active ? "outline" : "muted"}>
                {data.is_active ? t("modules.active.yes") : t("modules.active.no")}
              </Badge>
            }
          />
          <FieldRow
            label={t("modules.columns.enabled")}
            value={
              <Badge variant={data.enabled ? "outline" : "muted"}>
                {data.enabled ? t("modules.enabled.yes") : t("modules.enabled.no")}
              </Badge>
            }
          />
          <FieldRow label={t("modules.detail.route")} value={data.route || "—"} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t("modules.detail.requiredPermissions")}
          </p>
          {data.required_permissions.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {data.required_permissions.map((code) => (
                <li key={code}>
                  <Badge variant="muted" className="font-mono text-xs">
                    {code}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("modules.detail.noPermissions")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            {t("modules.detail.toggleDeferredNotice")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

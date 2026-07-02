/**
 * AuditLogDetailPage — chi tiết 1 bản ghi audit (SYSTEM-SCREEN-AUDIT-LOGS detail, S2-FE-FND-2).
 *
 * Nguồn: GET /foundation/audit-logs/:id (Company scope). Cổng quyền GIỐNG trang list —
 * useCan('view','audit-log'); route-level guard (ProtectedRoute) đã chặn thiếu quyền trước khi tới
 * component này nên KHÔNG cần forbidden EmptyState riêng — chỉ xử lý loading/error/notFound.
 *
 * before/after/oldValues/newValues/metadata/deviceInfo ĐÃ redact phía server (object_type nhạy cảm
 * → null/{redacted:true}) — client render JSON.stringify an toàn, KHÔNG tự suy luận/unmask.
 */
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileClock, RefreshCw } from "lucide-react";
import { auditLogDtoSchema } from "@mediaos/contracts";
import { apiFetch, ApiError } from "@mediaos/web-core";
import { Badge, Button, Card, CardContent, EmptyState, PageHeader } from "@mediaos/ui";
import { AUDIT_LOGS_PATH, AUDIT_LOG_DETAIL_QUERY_KEY, auditLogDetailApi } from "./constants";
import { toDateFromIso } from "./audit-log-utils";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

interface AuditLogDetailPageProps {
  auditLogId: string;
}

export function AuditLogDetailPage({ auditLogId }: AuditLogDetailPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();

  function goBack() {
    void navigate({ to: AUDIT_LOGS_PATH as "/" });
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...AUDIT_LOG_DETAIL_QUERY_KEY, auditLogId] as const,
    queryFn: () => apiFetch(auditLogDetailApi(auditLogId), auditLogDtoSchema),
  });

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6" data-testid="audit-detail-loading">
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
        <div className="p-6" data-testid="audit-detail-forbidden">
          <EmptyState
            title={t("auditLogs.forbidden.title")}
            description={t("auditLogs.forbidden.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("auditLogs.detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    if (isNotFound) {
      return (
        <div className="p-6" data-testid="audit-detail-not-found">
          <EmptyState
            title={t("auditLogs.detail.notFound.title")}
            description={t("auditLogs.detail.notFound.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("auditLogs.detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className="p-6" data-testid="audit-detail-error">
        <EmptyState
          title={t("auditLogs.error.title")}
          description={t("auditLogs.error.description")}
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
        title={t("auditLogs.detail.title")}
        icon={FileClock}
        actions={
          <Button variant="ghost" size="sm" onClick={goBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("auditLogs.detail.backToList")}
          </Button>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow
            label={t("auditLogs.columns.createdAt")}
            value={toDateFromIso(data.createdAt)}
          />
          <FieldRow label={t("auditLogs.columns.module")} value={data.moduleCode} />
          <FieldRow
            label={t("auditLogs.columns.action")}
            value={
              <Badge variant="outline" className="font-mono">
                {data.action}
              </Badge>
            }
          />
          <FieldRow
            label={t("auditLogs.columns.entity")}
            value={data.entityType ?? data.objectType}
          />
          <FieldRow label={t("auditLogs.detail.entityId")} value={data.entityId ?? data.objectId} />
          <FieldRow label={t("auditLogs.columns.actor")} value={data.actorUserId} />
          <FieldRow label={t("auditLogs.detail.dataScope")} value={data.dataScope} />
          <FieldRow label={t("auditLogs.detail.ip")} value={data.ip ?? data.ipAddress} />
          <FieldRow label={t("auditLogs.detail.userAgent")} value={data.userAgent} />
          <FieldRow label={t("auditLogs.detail.requestId")} value={data.requestId} />
          {data.errorCode && (
            <FieldRow label={t("auditLogs.detail.errorCode")} value={data.errorCode} />
          )}
          {data.errorMessage && (
            <FieldRow label={t("auditLogs.detail.errorMessage")} value={data.errorMessage} />
          )}
          {data.changedFields && data.changedFields.length > 0 && (
            <FieldRow
              label={t("auditLogs.detail.changedFields")}
              value={data.changedFields.join(", ")}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              {t("auditLogs.detail.oldValues")}
            </p>
            <JsonBlock value={data.oldValues ?? data.before} />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
              {t("auditLogs.detail.newValues")}
            </p>
            <JsonBlock value={data.newValues ?? data.after} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * FileDetailPage — chi tiết metadata 1 file (SYSTEM-SCREEN-FILES detail, S2-FE-FND-2).
 *
 * Nguồn: GET /foundation/files/:id. Cổng quyền GIỐNG trang list — useCan('view','foundation-file');
 * route-level guard (ProtectedRoute) đã chặn thiếu quyền trước khi tới component này.
 *
 * Download: KHÔNG dùng <a href> trực tiếp (route yêu cầu Bearer header, không phải cookie) — gọi
 * GET /foundation/files/:id/download-url (qua apiFetch, tự gắn Bearer) rồi mở URL TTL-ngắn trả về
 * trong tab mới. Nút Download PermissionGate theo cặp `download:foundation-file` (SEPARATE với view —
 * FilePolicy.canDownload là chốt riêng ở BE, KHÔNG suy diễn từ view).
 *
 * BẤT BIẾN: DTO KHÔNG chứa storagePath/storageBucket/checksumSha256/signedUrl dài hạn — client chỉ
 * render field server trả; downloadUrl luôn có expiresAt (TTL ngắn), KHÔNG cache lâu dài.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, File as FileIcon, RefreshCw } from "lucide-react";
import { downloadUrlSchema, fileMetadataSchema } from "@mediaos/contracts";
import { apiFetch, ApiError, PermissionGate } from "@mediaos/web-core";
import { Badge, Button, Card, CardContent, EmptyState, PageHeader } from "@mediaos/ui";
import { FILES_PATH, FILE_DETAIL_QUERY_KEY, fileDetailApi, fileDownloadApi } from "./constants";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value ?? "—"}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

interface FileDetailPageProps {
  fileId: string;
}

export function FileDetailPage({ fileId }: FileDetailPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  function goBack() {
    void navigate({ to: FILES_PATH as "/" });
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [...FILE_DETAIL_QUERY_KEY, fileId] as const,
    queryFn: () => apiFetch(fileDetailApi(fileId), fileMetadataSchema),
  });

  async function handleDownload() {
    setDownloading(true);
    try {
      const { url } = await apiFetch(`${fileDownloadApi(fileId)}-url`, downloadUrlSchema);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setDownloading(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6" data-testid="file-detail-loading">
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
        <div className="p-6" data-testid="file-detail-forbidden">
          <EmptyState
            title={t("files.forbidden.title")}
            description={t("files.forbidden.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("files.detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    if (isNotFound) {
      return (
        <div className="p-6" data-testid="file-detail-not-found">
          <EmptyState
            title={t("files.detail.notFound.title")}
            description={t("files.detail.notFound.description")}
            action={
              <Button variant="outline" size="sm" onClick={goBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("files.detail.backToList")}
              </Button>
            }
          />
        </div>
      );
    }

    return (
      <div className="p-6" data-testid="file-detail-error">
        <EmptyState
          title={t("files.error.title")}
          description={t("files.error.description")}
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
        title={t("files.detail.title")}
        icon={FileIcon}
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate action="download" resourceType="foundation-file">
              <Button
                variant="outline"
                size="sm"
                disabled={downloading}
                onClick={() => void handleDownload()}
              >
                <Download className="mr-2 h-4 w-4" />
                {t("files.detail.download")}
              </Button>
            </PermissionGate>
            <Button variant="ghost" size="sm" onClick={goBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("files.detail.backToList")}
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="divide-y divide-border pt-4">
          <FieldRow label={t("files.columns.name")} value={data.originalName} />
          <FieldRow label={t("files.columns.mimeType")} value={data.mimeType} />
          <FieldRow label={t("files.columns.size")} value={formatBytes(data.sizeBytes)} />
          <FieldRow
            label={t("files.columns.visibility")}
            value={<Badge variant="outline">{t(`files.visibility.${data.visibility}`)}</Badge>}
          />
          <FieldRow
            label={t("files.columns.uploadStatus")}
            value={t(`files.uploadStatus.${data.uploadStatus}`)}
          />
          <FieldRow
            label={t("files.columns.scanStatus")}
            value={t(`files.scanStatus.${data.scanStatus}`)}
          />
          <FieldRow
            label={t("files.columns.uploadedAt")}
            value={new Date(data.uploadedAt).toLocaleString("vi-VN")}
          />
          <FieldRow label={t("files.detail.downloadCount")} value={data.downloadCount} />
          {data.ownerUserId != null && (
            <FieldRow label={t("files.detail.owner")} value={data.ownerUserId} />
          )}
          <FieldRow
            label={t("files.detail.isTemporary")}
            value={data.isTemporary ? t("files.detail.yes") : t("files.detail.no")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
            {t("files.detail.links")}
          </p>
          {data.links && data.links.length > 0 ? (
            <ul className="space-y-2">
              {data.links.map((link) => (
                <li key={link.id} className="text-sm">
                  <span className="font-medium">{link.moduleCode}</span> · {link.entityType} ·{" "}
                  <span className="font-mono text-xs text-muted-foreground">{link.entityId}</span> ·{" "}
                  <Badge variant="muted">{link.linkType}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("files.detail.noLinks")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * SYSTEM-SCREEN-FILES (S2-FE-FND-2) — viewer metadata file (Company scope, chỉ đọc).
 *
 * Nguồn: API-09 FOUNDATION GET /foundation/files (files metadata, RLS+FORCE). Cổng quyền:
 * useCan('view','foundation-file') — cặp ENGINE THỰC (seed mig 0435, is_sensitive=false, bulk-grant
 * company-admin). KHÔNG hard-code role.
 *
 * BẤT BIẾN: DTO KHÔNG chứa storagePath/storageBucket/checksumSha256/signedUrl dài hạn (packages/contracts
 * files.ts) — client CHỈ render field server trả, KHÔNG tự suy diễn đường dẫn lưu trữ.
 *
 * States: loading · error · empty · forbidden. Bộ lọc: module/entity/visibility. Phân trang server-side
 * page/limit — heuristic prev/next (trang đầy ⇒ còn trang sau) vì apiFetch/unwrapEnvelope chỉ giữ `data`.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { File as FileIcon, RefreshCw } from "lucide-react";
import { z } from "zod";
import { type FileMetadataDto, fileMetadataSchema, type FileVisibility } from "@mediaos/contracts";
import { apiFetch, buildQueryString, useCan } from "@mediaos/web-core";
import { Badge, Button, DataTable, EmptyState, Input, PageHeader, Select } from "@mediaos/ui";
import {
  FILES_API,
  FILES_PAGE_SIZE,
  FILES_QUERY_KEY,
  FOUNDATION_FILE_VIEW,
  fileDetailPath,
} from "./constants";

const filesListSchema = z.array(fileMetadataSchema);

const VISIBILITY_OPTIONS: readonly FileVisibility[] = ["Private", "Internal", "Public"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------
function useFileColumns(
  t: ReturnType<typeof useTranslation<"system">>["t"],
  onView: (id: string) => void,
): ColumnDef<FileMetadataDto>[] {
  return [
    {
      accessorKey: "originalName",
      header: t("files.columns.name"),
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.originalName}</span>
      ),
    },
    {
      accessorKey: "mimeType",
      header: t("files.columns.mimeType"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.mimeType}</span>
      ),
    },
    {
      accessorKey: "sizeBytes",
      header: t("files.columns.size"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatBytes(row.original.sizeBytes)}
        </span>
      ),
    },
    {
      accessorKey: "visibility",
      header: t("files.columns.visibility"),
      cell: ({ row }) => (
        <Badge variant="outline">{t(`files.visibility.${row.original.visibility}`)}</Badge>
      ),
    },
    {
      accessorKey: "uploadStatus",
      header: t("files.columns.uploadStatus"),
      cell: ({ row }) => (
        <span className="text-sm">{t(`files.uploadStatus.${row.original.uploadStatus}`)}</span>
      ),
    },
    {
      id: "actions",
      header: t("files.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original.id)}>
          {t("files.columns.viewDetail")}
        </Button>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export function FilesPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const canView = useCan(FOUNDATION_FILE_VIEW.action, FOUNDATION_FILE_VIEW.resourceType);

  const [page, setPage] = useState(1);
  const [moduleCode, setModuleCode] = useState("");
  const [entityType, setEntityType] = useState("");
  const [visibility, setVisibility] = useState<string>("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...FILES_QUERY_KEY, page, moduleCode, entityType, visibility] as const,
    queryFn: () => {
      const qs = buildQueryString({
        page,
        limit: FILES_PAGE_SIZE,
        moduleCode: moduleCode.trim() || undefined,
        entityType: entityType.trim() || undefined,
        visibility: visibility || undefined,
      });
      return apiFetch(`${FILES_API}${qs}`, filesListSchema);
    },
    enabled: canView,
    staleTime: 30_000,
  });

  const columns = useFileColumns(t, (id) => void navigate({ to: fileDetailPath(id) as "/" }));

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("files.forbidden.title")}
          description={t("files.forbidden.description")}
        />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <PageHeader title={t("files.title")} description={t("files.description")} icon={FileIcon} />
        <div className="mt-8">
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
      </div>
    );
  }

  const items: FileMetadataDto[] = data ?? [];
  const hasNext = items.length === FILES_PAGE_SIZE;
  const hasPrev = page > 1;

  return (
    <div className="space-y-5 p-6">
      <PageHeader title={t("files.title")} description={t("files.description")} icon={FileIcon} />

      <form
        className="rounded-xl border border-border bg-card p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("files.filters.moduleCode")}
            </span>
            <Input
              value={moduleCode}
              placeholder={t("files.filters.moduleCodePlaceholder")}
              onChange={(e) => setModuleCode(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("files.filters.entityType")}
            </span>
            <Input
              value={entityType}
              placeholder={t("files.filters.entityTypePlaceholder")}
              onChange={(e) => setEntityType(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("files.filters.visibility")}
            </span>
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
              <option value="">{t("files.filters.allVisibility")}</option>
              {VISIBILITY_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {t(`files.visibility.${v}`)}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <Button type="submit" size="sm">
            {t("files.filters.apply")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setModuleCode("");
              setEntityType("");
              setVisibility("");
              setPage(1);
            }}
          >
            {t("files.filters.reset")}
          </Button>
        </div>
      </form>

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState title={t("files.empty.title")} description={t("files.empty.description")} />
        }
        pageSize={FILES_PAGE_SIZE}
      />

      {(hasPrev || hasNext) && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {tc("pagination.prev")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
          >
            {tc("pagination.next")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * EmployeeFilesTab — tab "File hồ sơ" trong EmployeeDetailPage (S2-FE-HR-9, UI-HR-SCREEN-015).
 *
 * Danh sách file đính kèm hồ sơ nhân viên + Upload (2 pha register/PUT/confirm rồi link, có tiến độ) +
 * Download (qua filesApi.getDownloadUrl — TTL-ngắn, KHÔNG lộ storage_path, cùng cặp quyền
 * download:foundation-file đã dùng ở EmployeeContractsPage) + Xóa mềm (confirm dialog).
 *
 * Gate: PermissionGate/useCan theo EMPLOYEE_FILE_ENGINE_PAIRS (file-view/file-upload/file-delete:employee
 * — cặp seed thật mig 0477). Masking là việc của SERVER — component chỉ render field EmployeeFileDto trả
 * về (KHÔNG có storagePath/checksum/uploadedBy — DTO hiện KHÔNG có trường uploadedBy dù FRONTEND-08 §25.1
 * liệt kê, nên KHÔNG tự bịa hiển thị). Mọi state (loading/error/empty/forbidden) đều có.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Download, RefreshCw, Trash2, Upload } from "lucide-react";
import type { EmployeeFileDto } from "@mediaos/contracts";
import {
  employeeFilesApi,
  filesApi,
  hrKeys,
  hrInvalidation,
  useCan,
  PermissionGate,
  formatDate,
} from "@mediaos/web-core";
import { Badge, Button, DataTable, Dialog, EmptyState, Input } from "@mediaos/ui";
import { EMPLOYEE_FILE_ENGINE_PAIRS } from "./employee-file-constants";
// Cặp quyền tải file (foundation-file) — TÁI DÙNG cặp đã dùng ở EmployeeContractsPage (cùng cơ chế
// filesApi.getDownloadUrl + window.open, KHÔNG bịa cặp mới).
import { FILE_DOWNLOAD_PAIR } from "../contracts/constants";

/** 1024-based byte formatter — mirror system/files/FilesPage.tsx (không export dùng chung, tránh coupling). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function scanStatusVariant(
  status: EmployeeFileDto["scanStatus"],
): "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "Clean":
    case "NotRequired":
      return "success";
    case "Pending":
      return "warning";
    case "Infected":
    case "Failed":
      return "danger";
    default:
      return "muted";
  }
}

// ---------------------------------------------------------------------------
// Download button — GET download-url (TTL-ngắn) rồi mở tab mới (mirror EmployeeContractsPage).
// ---------------------------------------------------------------------------
function DownloadEmployeeFileButton({ fileId }: { fileId: string }) {
  const { t } = useTranslation("hr");
  const canDownload = useCan(FILE_DOWNLOAD_PAIR.action, FILE_DOWNLOAD_PAIR.resourceType);

  const mutation = useMutation({
    mutationFn: () => filesApi.getDownloadUrl(fileId),
    onSuccess: (dto) => {
      window.open(dto.url, "_blank", "noopener,noreferrer");
    },
  });

  if (!canDownload) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        aria-label={t("files.download")}
      >
        <Download className="mr-1 h-3.5 w-3.5" />
        {mutation.isPending ? t("files.downloading") : t("files.download")}
      </Button>
      {mutation.isError && (
        <span className="text-xs text-destructive">{t("files.downloadError")}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm dialog
// ---------------------------------------------------------------------------
function DeleteEmployeeFileDialog({
  employeeId,
  file,
  onClose,
}: {
  employeeId: string;
  file: EmployeeFileDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const noop = () => {};

  const mutation = useMutation({
    mutationFn: () => employeeFilesApi.deleteEmployeeFile(employeeId, file.fileId),
    onSuccess: async () => {
      await Promise.all(
        hrInvalidation
          .deleteEmployeeFile(employeeId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("files.delete.title")}
      description={t("files.delete.description", { name: file.originalName })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("files.delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="employee-file-delete-confirm"
          >
            {mutation.isPending ? t("files.delete.deleting") : t("files.delete.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("files.delete.error")}
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upload control — file picker ẩn + input phân loại tùy chọn + progress bar.
// ---------------------------------------------------------------------------
function UploadEmployeeFileControl({ employeeId }: { employeeId: string }) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: (file: File) =>
      employeeFilesApi.uploadEmployeeFile(employeeId, file, {
        category: category.trim() || undefined,
        onProgress: setProgress,
      }),
    onSuccess: async () => {
      await Promise.all(
        hrInvalidation
          .uploadEmployeeFile(employeeId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      setProgress(0);
      setCategory("");
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProgress(0);
    mutation.mutate(file);
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t("files.uploadCategoryPlaceholder")}
          className="max-w-xs"
          disabled={mutation.isPending}
          autoComplete="off"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={mutation.isPending}
        >
          <Upload className="mr-2 h-4 w-4" />
          {t("files.uploadButton")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onFileSelected}
          data-testid="employee-file-upload-input"
        />
      </div>
      {mutation.isPending && (
        <div className="space-y-1" role="status" aria-live="polite">
          <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-brand transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("files.uploading", { percent: progress })}
          </p>
        </div>
      )}
      {mutation.isError && <p className="text-xs text-destructive">{t("files.uploadError")}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------
export interface EmployeeFilesTabProps {
  employeeId: string;
}

export function EmployeeFilesTab({ employeeId }: EmployeeFilesTabProps) {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const canView = useCan(
    EMPLOYEE_FILE_ENGINE_PAIRS.VIEW.action,
    EMPLOYEE_FILE_ENGINE_PAIRS.VIEW.resourceType,
  );
  const canUpload = useCan(
    EMPLOYEE_FILE_ENGINE_PAIRS.UPLOAD.action,
    EMPLOYEE_FILE_ENGINE_PAIRS.UPLOAD.resourceType,
  );
  const canDelete = useCan(
    EMPLOYEE_FILE_ENGINE_PAIRS.DELETE.action,
    EMPLOYEE_FILE_ENGINE_PAIRS.DELETE.resourceType,
  );
  const [deleteTarget, setDeleteTarget] = useState<EmployeeFileDto | null>(null);

  const query = useQuery({
    queryKey: hrKeys.employees.files(employeeId),
    queryFn: () => employeeFilesApi.getEmployeeFiles(employeeId),
    enabled: canView && !!employeeId,
    staleTime: 30_000,
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <EmptyState
        title={t("files.forbidden.title")}
        description={t("files.forbidden.description")}
      />
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <EmptyState
        title={t("files.error.title")}
        description={t("files.error.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {tc("actions.retry")}
          </Button>
        }
      />
    );
  }

  const columns: ColumnDef<EmployeeFileDto>[] = [
    {
      accessorKey: "originalName",
      header: t("files.columns.name"),
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.originalName}</span>
      ),
    },
    {
      accessorKey: "mimeType",
      header: t("files.columns.type"),
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
      accessorKey: "category",
      header: t("files.columns.category"),
      cell: ({ row }) => <span className="text-sm">{row.original.category ?? "—"}</span>,
    },
    {
      accessorKey: "scanStatus",
      header: t("files.columns.scanStatus"),
      cell: ({ row }) => (
        <Badge variant={scanStatusVariant(row.original.scanStatus)}>
          {t(`files.scanStatus.${row.original.scanStatus}`)}
        </Badge>
      ),
    },
    {
      accessorKey: "uploadedAt",
      header: t("files.columns.uploadedAt"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatDate(row.original.uploadedAt)}</span>
      ),
    },
    {
      id: "actions",
      header: t("files.columns.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <DownloadEmployeeFileButton fileId={row.original.fileId} />
          <PermissionGate
            action={EMPLOYEE_FILE_ENGINE_PAIRS.DELETE.action}
            resourceType={EMPLOYEE_FILE_ENGINE_PAIRS.DELETE.resourceType}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t("files.delete.button")}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
              {t("files.delete.button")}
            </Button>
          </PermissionGate>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("files.description")}</p>

      {canUpload && <UploadEmployeeFileControl employeeId={employeeId} />}

      <DataTable
        columns={columns}
        data={query.data ?? []}
        isLoading={query.isLoading}
        emptyState={
          <EmptyState title={t("files.empty.title")} description={t("files.empty.description")} />
        }
        pageSize={10}
      />

      {deleteTarget && canDelete && (
        <DeleteEmployeeFileDialog
          employeeId={employeeId}
          file={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

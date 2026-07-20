/**
 * TaskFilePanel — "Tệp đính kèm" trong TaskDetailPage (S4-FE-TASK-4, SPEC-06 §16.1/§9, TASK-SCREEN-007).
 * Nối canonical `/tasks/:taskId/files` (S4-TASK-BE-5, PR #184 — FileService + file_links polymorphic;
 * route legacy `/attachments` đã 410 Gone, KHÔNG dùng ở đây).
 *
 * Danh sách file đính kèm công việc + Upload (4 pha register/PUT/confirm/link, có tiến độ, mirror
 * EmployeeFilesTab.tsx) + Download (taskFileApi.downloadTaskFile → apiFetchBlob theo redirect 302, KHÔNG
 * có route JSON download-url riêng cho task — xem task-file-api.ts) + Xóa mềm (confirm dialog).
 *
 * Gate: PermissionGate/useCan theo TASK_FILE_ENGINE_PAIRS (read/file-upload/file-delete:task — cặp seed
 * THẬT mig 0485, non-sensitive). Masking là việc của SERVER — component chỉ render field TaskFileDto trả
 * về (KHÔNG có storagePath/checksum). Mọi state (loading/error/empty/forbidden) đều có.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Download, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import type { TaskFileDto } from "@mediaos/contracts";
import {
  taskFileApi,
  taskKeys,
  taskFileInvalidation,
  useCan,
  PermissionGate,
  mapApiErrorToUi,
  formatDate,
} from "@mediaos/web-core";
import { Badge, Button, DataTable, Dialog, EmptyState, Input } from "@mediaos/ui";
import { TASK_FILE_ENGINE_PAIRS } from "./task-file-constants";
import { PanelBody } from "./PanelBody";
import { triggerBlobDownload } from "./download-blob";

/** 1024-based byte formatter — mirror EmployeeFilesTab.tsx (không export dùng chung, tránh coupling). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function scanStatusVariant(
  status: TaskFileDto["scanStatus"],
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
// Download button — taskFileApi.downloadTaskFile (blob qua redirect 302) rồi trigger tải nội bộ.
// ---------------------------------------------------------------------------
function DownloadTaskFileButton({ taskId, file }: { taskId: string; file: TaskFileDto }) {
  const { t } = useTranslation("tasks");

  const mutation = useMutation({
    mutationFn: () => taskFileApi.downloadTaskFile(taskId, file.fileId),
    onSuccess: ({ blob, filename }) => {
      triggerBlobDownload(blob, filename ?? file.originalName);
    },
  });

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        aria-label={t("tasks.detail.files.download")}
      >
        {mutation.isPending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
        )}
        {mutation.isPending
          ? t("tasks.detail.files.downloading")
          : t("tasks.detail.files.download")}
      </Button>
      {mutation.isError && (
        <span className="text-xs text-destructive">{mapApiErrorToUi(mutation.error).message}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delete confirm dialog
// ---------------------------------------------------------------------------
/**
 * S5-TASK-COVER-1 — nút "Đặt làm ảnh bìa" / "Gỡ ảnh bìa".
 *
 * CHỈ hiện trên tệp server sẽ CHẤP NHẬN làm bìa (ảnh + Uploaded + scan sạch). Hiện nút trên tệp không
 * đủ điều kiện rồi để người dùng bấm và ăn 415/409 là biến một quy tắc thành một lỗi bất ngờ.
 *
 * `isCover` do SERVER tính theo đúng bộ điều kiện của đường ký ảnh bìa (kể cả vị từ độc quyền), KHÔNG
 * phải cờ `is_primary` thô — nên nút "Gỡ" chỉ hiện khi board THẬT SỰ đang hiển thị bìa đó.
 */
function CoverToggleButton({
  taskId,
  projectId,
  file,
}: {
  taskId: string;
  projectId: string | null;
  file: TaskFileDto;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const isCover = file.isCover ?? false;

  const eligible =
    file.mimeType.startsWith("image/") &&
    file.uploadStatus === "Uploaded" &&
    (file.scanStatus === "Clean" || file.scanStatus === "NotRequired");

  const mutation = useMutation({
    // Chuẩn hoá về void: hai nhánh trả kiểu khác nhau (clear → void, set → TaskFileDto) nên union sẽ
    // không khớp MutationFunction. Không dùng giá trị trả về — nguồn sự thật là refetch sau invalidate.
    mutationFn: async (): Promise<void> => {
      if (isCover) await taskFileApi.clearTaskCover(taskId);
      else await taskFileApi.setTaskCover(taskId, file.fileId);
    },
    onSuccess: async () => {
      await Promise.all(
        taskFileInvalidation
          .cover(taskId, projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  // Tệp không đủ điều kiện VÀ cũng không phải bìa hiện tại ⇒ không có thao tác nào để chào mời.
  if (!eligible && !isCover) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      data-testid={`task-cover-toggle-${file.fileId}`}
    >
      {isCover ? t("tasks.detail.files.cover.clear") : t("tasks.detail.files.cover.set")}
    </Button>
  );
}

// ---------------------------------------------------------------------------
function DeleteTaskFileDialog({
  taskId,
  projectId,
  file,
  onClose,
}: {
  taskId: string;
  /** S5-TASK-COVER-1 — cần để invalidate board khi tệp bị xoá đang là ảnh bìa. */
  projectId: string | null;
  file: TaskFileDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const noop = () => {};

  const mutation = useMutation({
    mutationFn: () => taskFileApi.deleteTaskFile(taskId, file.fileId),
    onSuccess: async () => {
      // S5-TASK-COVER-1 — dùng bộ khoá `cover` (files + detail + kanban), KHÔNG chỉ `files`.
      // Server xử lý đúng: soft-delete `files` làm findVerifiedTaskCoversTx thôi trả tệp đó. Nhưng FE
      // không hỏi lại thì cache board/chi tiết vẫn giữ `coverUrl` CŨ — và URL đã ký ấy VẪN TẢI ĐƯỢC
      // (soft-delete chỉ ở DB, object trên storage còn nguyên) ⇒ xoá tệp xong quay ra board vẫn thấy
      // đúng tấm ảnh vừa xoá làm bìa. Trước WO này `files(taskId)` là đủ; chính WO này tạo ra ràng buộc.
      await Promise.all(
        taskFileInvalidation
          .cover(taskId, projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("tasks.detail.files.delete.title")}
      description={t("tasks.detail.files.delete.description", { name: file.originalName })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("tasks.detail.files.delete.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            data-testid="task-file-delete-confirm"
          >
            {mutation.isPending
              ? t("tasks.detail.files.delete.deleting")
              : t("tasks.detail.files.delete.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("tasks.detail.files.delete.error")}
        </p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Upload control — file picker ẩn + input phân loại tùy chọn + progress bar.
// ---------------------------------------------------------------------------
function UploadTaskFileControl({ taskId }: { taskId: string }) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [progress, setProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: (file: File) =>
      taskFileApi.uploadTaskFile(taskId, file, {
        category: category.trim() || undefined,
        onProgress: setProgress,
      }),
    onSuccess: async () => {
      await Promise.all(
        taskFileInvalidation
          .files(taskId)
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
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder={t("tasks.detail.files.uploadCategoryPlaceholder")}
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
          {t("tasks.detail.files.uploadButton")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={onFileSelected}
          data-testid="task-file-upload-input"
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
            {t("tasks.detail.files.uploading", { percent: progress })}
          </p>
        </div>
      )}
      {mutation.isError && (
        <p className="text-xs text-destructive">{t("tasks.detail.files.uploadError")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export interface TaskFilePanelProps {
  taskId: string;
  /** Trong tab ⇒ bỏ vỏ Card + tiêu đề (nhãn tab đã nói). Xem PanelBody. */
  embedded?: boolean;
  /**
   * S5-TASK-COVER-1 — dự án chứa task, để đặt/gỡ bìa còn invalidate được BOARD. `taskKeys.kanban`
   * KHÔNG nằm dưới prefix `tasks/list` nên không có id này thì thẻ trên board giữ ảnh cũ tới hết
   * staleTime. Nullable: task cá nhân ngoài dự án không có board nào để làm mới.
   */
  projectId?: string | null;
}

export function TaskFilePanel({ taskId, embedded = false, projectId = null }: TaskFilePanelProps) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_FILE_ENGINE_PAIRS.READ.action,
    TASK_FILE_ENGINE_PAIRS.READ.resourceType,
  );
  const canUpload = useCan(
    TASK_FILE_ENGINE_PAIRS.UPLOAD.action,
    TASK_FILE_ENGINE_PAIRS.UPLOAD.resourceType,
  );
  const canDelete = useCan(
    TASK_FILE_ENGINE_PAIRS.DELETE.action,
    TASK_FILE_ENGINE_PAIRS.DELETE.resourceType,
  );
  const [deleteTarget, setDeleteTarget] = useState<TaskFileDto | null>(null);

  const query = useQuery({
    queryKey: taskKeys.files(taskId),
    queryFn: () => taskFileApi.getTaskFiles(taskId),
    enabled: canView && !!taskId,
    staleTime: 30_000,
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <PanelBody embedded={embedded}>
        {!embedded && (
          <h3 className="text-sm font-semibold text-muted-foreground">
            {t("tasks.detail.files.title")}
          </h3>
        )}
        <EmptyState
          title={t("tasks.detail.files.forbidden.title")}
          description={t("tasks.detail.files.forbidden.description")}
        />
      </PanelBody>
    );
  }

  const columns: ColumnDef<TaskFileDto>[] = [
    {
      accessorKey: "originalName",
      header: t("tasks.detail.files.columns.name"),
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">{row.original.originalName}</span>
      ),
    },
    {
      accessorKey: "sizeBytes",
      header: t("tasks.detail.files.columns.size"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatBytes(row.original.sizeBytes)}
        </span>
      ),
    },
    {
      accessorKey: "category",
      header: t("tasks.detail.files.columns.category"),
      cell: ({ row }) => <span className="text-sm">{row.original.category ?? "—"}</span>,
    },
    {
      accessorKey: "scanStatus",
      header: t("tasks.detail.files.columns.scanStatus"),
      cell: ({ row }) => (
        <Badge variant={scanStatusVariant(row.original.scanStatus)}>
          {t(`tasks.detail.files.scanStatus.${row.original.scanStatus}`)}
        </Badge>
      ),
    },
    {
      accessorKey: "uploadedAt",
      header: t("tasks.detail.files.columns.uploadedAt"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{formatDate(row.original.uploadedAt)}</span>
      ),
    },
    {
      id: "actions",
      header: t("tasks.detail.files.columns.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <DownloadTaskFileButton taskId={taskId} file={row.original} />
          {/* Gate = cặp UPLOAD (file-upload:task) — mirror server. Thiếu quyền ⇒ KHÔNG render nút
              (PermissionGate), không phải nút disabled: UI-02 §5.3. */}
          <PermissionGate
            action={TASK_FILE_ENGINE_PAIRS.UPLOAD.action}
            resourceType={TASK_FILE_ENGINE_PAIRS.UPLOAD.resourceType}
          >
            <CoverToggleButton taskId={taskId} projectId={projectId} file={row.original} />
          </PermissionGate>
          <PermissionGate
            action={TASK_FILE_ENGINE_PAIRS.DELETE.action}
            resourceType={TASK_FILE_ENGINE_PAIRS.DELETE.resourceType}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row.original)}
              aria-label={t("tasks.detail.files.delete.button")}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5 text-destructive" />
              {t("tasks.detail.files.delete.button")}
            </Button>
          </PermissionGate>
        </div>
      ),
    },
  ];

  return (
    <PanelBody embedded={embedded}>
      {!embedded && (
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("tasks.detail.files.title")}
        </h3>
      )}

      {canUpload && <UploadTaskFileControl taskId={taskId} />}

      {query.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{t("tasks.detail.files.error.description")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={query.data ?? []}
          isLoading={query.isLoading}
          emptyState={
            <EmptyState
              title={t("tasks.detail.files.empty.title")}
              description={t("tasks.detail.files.empty.description")}
            />
          }
          pageSize={10}
        />
      )}

      {deleteTarget && canDelete && (
        <DeleteTaskFileDialog
          taskId={taskId}
          projectId={projectId}
          file={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </PanelBody>
  );
}

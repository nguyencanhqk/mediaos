import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { taskLabelsApi, taskKeys, useCan, ApiError } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import type { LabelDto, TaskCoreResponseDto, TaskLabelChipDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { normalizeSearchText } from "./workspace-constants";

/**
 * Gắn thẻ (labels) — UX kiểu Base Wework (benchmark owner gửi ảnh 2026-07-20): dialog "Gắn thẻ" có
 * tìm thẻ · "+ Thêm thẻ" tạo tại chỗ (tên + màu) · bấm dòng để GẮN/GỠ khỏi task · sửa/xoá thẻ per-row.
 *
 * Thẻ KHÁC cột pipeline: cột là VỊ TRÍ duy nhất của task trên board (quy trình); thẻ là NHÃN đánh dấu
 * tự do, gắn nhiều thẻ một task ("Đã cắt", "Thiếu thumbnail"…). Nhu cầu "trạng thái tuỳ ý" của người
 * dùng sống ở đây, KHÔNG phải ở cột.
 *
 * Quyền theo ĐÚNG cửa BE: danh sách read:label · tạo create:label · sửa update:label · xoá delete:label
 * (seed 0420) · GẮN/GỠ đi route /tasks/:id/labels/:labelId gate update:task. Mỗi control tự ẩn khi
 * thiếu pair (UI-02 §5.3) — server vẫn là người quyết cuối.
 *
 * Xoá thẻ = 2 BƯỚC TẠI CHỖ (bấm ✕ → nút đổi thành "Xoá?" → bấm lần nữa mới xoá): xoá lan ra MỌI task
 * đang gắn thẻ đó trong dự án, một cú lỡ tay không nên đủ; dialog-trong-dialog thì quá nặng.
 */

/** Màu mặc định khi tạo thẻ mới — vàng như Base; người dùng đổi được ngay ô màu bên cạnh. */
const NEW_LABEL_DEFAULT_COLOR = "#eab308";

function labelErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "tasks.labels.dialog.errors.duplicate";
    if (err.status === 403) return "tasks.labels.dialog.errors.forbidden";
    if (err.status === 400 || err.status === 422) return "tasks.labels.dialog.errors.validation";
  }
  return "tasks.labels.dialog.errors.generic";
}

/** Chip thẻ dùng chung cho panel chi tiết + thẻ board — chấm màu + tên, nền trung tính. */
export function TaskLabelChip({ label }: { label: TaskLabelChipDto }) {
  return (
    <span
      className="inline-flex max-w-40 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
      data-testid={`task-label-chip-${label.id}`}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/** Một dòng thẻ trong dialog: bấm thân dòng = gắn/gỡ; sửa/xoá lui về bên phải. */
function LabelRow({
  label,
  attached,
  busy,
  canAttach,
  canUpdate,
  canDelete,
  onToggle,
  onSaveEdit,
  onDelete,
  onError,
}: {
  label: LabelDto;
  attached: boolean;
  busy: boolean;
  canAttach: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onSaveEdit: (patch: { name: string; color: string }) => void;
  onDelete: () => void;
  onError: (key: string | null) => void;
}) {
  const { t } = useTranslation("tasks");
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <li className="flex items-center gap-2 rounded px-2 py-1.5">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label={t("tasks.labels.dialog.colorLabel")}
          className="h-7 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label={t("tasks.labels.dialog.namePlaceholder")}
          className="h-7 flex-1"
          autoFocus
        />
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={busy || name.trim().length === 0}
          onClick={() => {
            setEditing(false);
            if (name.trim() !== label.name || color !== label.color)
              onSaveEdit({ name: name.trim(), color });
          }}
          data-testid={`label-edit-save-${label.id}`}
        >
          {t("tasks.labels.dialog.saveAction")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 px-0"
          aria-label={t("tasks.labels.dialog.cancelAction")}
          onClick={() => {
            setEditing(false);
            setName(label.name);
            setColor(label.color);
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted">
      <button
        type="button"
        disabled={!canAttach || busy}
        onClick={onToggle}
        aria-pressed={attached}
        data-testid={`label-toggle-${label.id}`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left disabled:cursor-default"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 rounded"
          style={{ backgroundColor: label.color }}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{label.name}</span>
        {attached && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
      </button>
      {canUpdate && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 px-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t("tasks.labels.dialog.editAction", { name: label.name })}
          disabled={busy}
          onClick={() => {
            onError(null);
            setEditing(true);
          }}
          data-testid={`label-edit-${label.id}`}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
      {canDelete &&
        (confirmingDelete ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 px-2 text-xs"
            disabled={busy}
            onClick={onDelete}
            data-testid={`label-delete-confirm-${label.id}`}
          >
            {t("tasks.labels.dialog.deleteConfirm")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 px-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t("tasks.labels.dialog.deleteAction", { name: label.name })}
            disabled={busy}
            onClick={() => setConfirmingDelete(true)}
            data-testid={`label-delete-${label.id}`}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
          </Button>
        ))}
    </li>
  );
}

export function TaskLabelPickerDialog({
  task,
  onClose,
}: {
  task: TaskCoreResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const projectId = task.projectId ?? null;

  const canReadLabel = useCan("read", "label");
  const canCreateLabel = useCan("create", "label");
  const canUpdateLabel = useCan("update", "label");
  const canDeleteLabel = useCan("delete", "label");
  // Gắn/gỡ đi route /tasks/:id/labels/:labelId — BE gate update:task (KHÔNG phải pair label).
  const canAttach = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );

  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(NEW_LABEL_DEFAULT_COLOR);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const labelsQuery = useQuery({
    queryKey: taskKeys.labels(projectId ?? ""),
    queryFn: () => taskLabelsApi.listLabels(projectId ?? ""),
    enabled: projectId !== null && canReadLabel,
    staleTime: 60_000,
  });
  const labels = labelsQuery.data ?? [];
  const attachedIds = new Set((task.labels ?? []).map((l) => l.id));
  const filtered = search.trim()
    ? labels.filter((l) => normalizeSearchText(l.name).includes(normalizeSearchText(search.trim())))
    : labels;

  const invalidateTaskViews = () => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.id) });
    if (projectId) void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(projectId) });
  };
  const invalidateLabels = () => {
    if (projectId) void queryClient.invalidateQueries({ queryKey: taskKeys.labels(projectId) });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ labelId, attached }: { labelId: string; attached: boolean }) =>
      attached
        ? taskLabelsApi.removeLabelFromTask(task.id, labelId)
        : taskLabelsApi.addLabelToTask(task.id, labelId),
    onSuccess: () => setErrorKey(null),
    onError: (err) => setErrorKey(labelErrorKey(err)),
    onSettled: invalidateTaskViews,
  });

  // Tạo xong GẮN LUÔN vào task (nếu có quyền) — người dùng mở dialog này là để gắn thẻ, bắt bấm
  // thêm lần nữa vào thẻ vừa tạo là một cú click thừa cho thao tác lặp nhiều lần.
  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await taskLabelsApi.createLabel(projectId ?? "", {
        name: newName.trim(),
        color: newColor,
      });
      if (canAttach) await taskLabelsApi.addLabelToTask(task.id, created.id);
      return created;
    },
    onSuccess: () => {
      setErrorKey(null);
      setNewName("");
      setCreating(false);
    },
    onError: (err) => setErrorKey(labelErrorKey(err)),
    onSettled: () => {
      invalidateLabels();
      invalidateTaskViews();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ labelId, patch }: { labelId: string; patch: { name: string; color: string } }) =>
      taskLabelsApi.updateLabel(labelId, patch),
    onSuccess: () => setErrorKey(null),
    onError: (err) => setErrorKey(labelErrorKey(err)),
    // Tên/màu hiện trên chip của MỌI task ⇒ chạm cả detail + board, không chỉ list thẻ.
    onSettled: () => {
      invalidateLabels();
      invalidateTaskViews();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (labelId: string) => taskLabelsApi.deleteLabel(labelId),
    onSuccess: () => setErrorKey(null),
    onError: (err) => setErrorKey(labelErrorKey(err)),
    onSettled: () => {
      invalidateLabels();
      invalidateTaskViews();
    },
  });

  const busy =
    toggleMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("tasks.labels.dialog.title")}
      className="max-w-md"
      footer={
        <Button variant="outline" onClick={onClose}>
          {t("tasks.labels.dialog.close")}
        </Button>
      }
    >
      {errorKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(errorKey)}
        </p>
      )}

      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("tasks.labels.dialog.searchPlaceholder")}
        aria-label={t("tasks.labels.dialog.searchPlaceholder")}
        className="h-9"
        data-testid="label-search"
      />

      {canCreateLabel &&
        (creating ? (
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              aria-label={t("tasks.labels.dialog.colorLabel")}
              className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border bg-transparent"
            />
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("tasks.labels.dialog.namePlaceholder")}
              aria-label={t("tasks.labels.dialog.namePlaceholder")}
              className="h-8 flex-1"
              autoFocus
              data-testid="label-create-name"
            />
            <Button
              size="sm"
              disabled={busy || newName.trim().length === 0}
              onClick={() => createMutation.mutate()}
              data-testid="label-create-confirm"
            >
              {t("tasks.labels.dialog.createConfirm")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 px-0"
              aria-label={t("tasks.labels.dialog.cancelAction")}
              onClick={() => setCreating(false)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            data-testid="label-create-open"
            className="flex items-center gap-1 text-sm text-primary hover:underline"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("tasks.labels.dialog.addLink")}
          </button>
        ))}

      {!canReadLabel ? (
        <p className="text-sm text-muted-foreground">{t("tasks.labels.dialog.readHint")}</p>
      ) : labelsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("tasks.labels.dialog.errors.generic")}
        </p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto" data-testid="label-list">
          {labelsQuery.isLoading && (
            <li className="px-2 py-2">
              <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            </li>
          )}
          {!labelsQuery.isLoading &&
            filtered.map((label) => (
              <LabelRow
                key={label.id}
                label={label}
                attached={attachedIds.has(label.id)}
                busy={busy}
                canAttach={canAttach}
                canUpdate={canUpdateLabel}
                canDelete={canDeleteLabel}
                onToggle={() =>
                  toggleMutation.mutate({
                    labelId: label.id,
                    attached: attachedIds.has(label.id),
                  })
                }
                onSaveEdit={(patch) => updateMutation.mutate({ labelId: label.id, patch })}
                onDelete={() => deleteMutation.mutate(label.id)}
                onError={setErrorKey}
              />
            ))}
          {!labelsQuery.isLoading && labels.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">
              {t("tasks.labels.dialog.empty")}
            </li>
          )}
          {!labelsQuery.isLoading && labels.length > 0 && filtered.length === 0 && (
            <li className="px-2 py-3 text-sm text-muted-foreground">
              {t("tasks.labels.dialog.noMatch")}
            </li>
          )}
        </ul>
      )}
      {canReadLabel && !canAttach && (
        <p className="text-xs text-muted-foreground">{t("tasks.labels.dialog.attachHint")}</p>
      )}
    </Dialog>
  );
}

/**
 * Dải thẻ trên màn chi tiết task: chip các thẻ đã gắn + nút "Gắn thẻ" mở dialog. Không thẻ + không
 * quyền gắn ⇒ ẩn hẳn (không chừa hàng trống).
 */
export function TaskLabelStrip({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const [open, setOpen] = useState(false);
  const canAttach = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const labels = task.labels ?? [];
  if (labels.length === 0 && !canAttach) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="task-label-strip">
      {labels.map((label) => (
        <TaskLabelChip key={label.id} label={label} />
      ))}
      {canAttach && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="task-label-open"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Tag className="h-3 w-3" aria-hidden="true" />
          {t("tasks.labels.strip.addButton")}
        </button>
      )}
      {open && <TaskLabelPickerDialog task={task} onClose={() => setOpen(false)} />}
    </div>
  );
}

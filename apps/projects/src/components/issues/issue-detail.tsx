import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type {
  BoardTaskDto,
  LabelDto,
  PriorityDto,
  ProjectStateDto,
  UpdateTaskFieldsRequest,
} from "@mediaos/contracts";
import { Avatar, Select } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import { tasksApi } from "@/lib/tasks-api";
import { PrioritySelect } from "@/components/priority-select";
import { LabelChip } from "@/components/label-chip";
import { LabelPicker } from "@/components/label-picker";
import { CommentThread } from "./comment-thread";
import { useEmployeeOptions, employeeLabel, useEmployeeMap } from "@/lib/use-members";

interface IssueDetailProps {
  task: BoardTaskDto;
  projectId: string;
  states: ProjectStateDto[];
  labels: LabelDto[];
  onClose: () => void;
}

/** yyyy-mm-dd cho <input type="date"> từ ISO datetime. */
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Panel chi tiết work item (slide-over kiểu Plane). Inline-edit title + description (textarea phẳng,
 * KHÔNG Tiptap ở Phase 1) → PATCH /tasks/:id. Sidebar thuộc tính: state · priority · assignee · due ·
 * labels (POST/DELETE). Comments thread. Mọi field-edit gated update:task (ẩn nếu thiếu quyền);
 * server vẫn là sự thật. Invalidate board sau mutate để card phản ánh thay đổi.
 */
export function IssueDetail({ task, projectId, states, labels, onClose }: IssueDetailProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const canUpdate = useCan("update", "task");
  const { employees } = useEmployeeOptions();
  const { labelFor } = useEmployeeMap();

  // Bản nháp cục bộ cho field free-text (title/description) — commit khi blur. Reset khi đổi task.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
  }, [task.id, task.title, task.description]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["board", projectId] });
  };

  const patch = useMutation({
    mutationFn: (data: UpdateTaskFieldsRequest) => tasksApi.updateTask(task.id, data),
    onSuccess: invalidate,
  });

  const addLabel = useMutation({
    mutationFn: (labelId: string) => tasksApi.addLabel(task.id, labelId),
    onSuccess: invalidate,
  });
  const removeLabel = useMutation({
    mutationFn: (labelId: string) => tasksApi.removeLabel(task.id, labelId),
    onSuccess: invalidate,
  });

  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== task.title) patch.mutate({ title: next });
    else setTitle(task.title);
  };
  const commitDescription = () => {
    const next = description;
    if (next !== (task.description ?? "")) patch.mutate({ description: next || null });
  };

  const selectedLabelIds = new Set(task.labels.map((l) => l.id));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      {/* Overlay */}
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />

      {/* Panel */}
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border bg-background shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background px-5 py-3">
          <span className="font-mono text-xs font-medium text-muted-foreground">
            {task.displayId ?? task.id.slice(0, 8).toUpperCase()}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 px-5 py-4">
          {/* Title */}
          {canUpdate ? (
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              rows={2}
              aria-label={t("detail.title")}
              className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-lg font-semibold text-foreground hover:border-border focus:border-border focus:outline-none"
            />
          ) : (
            <h2 className="px-1 text-lg font-semibold text-foreground">{task.title}</h2>
          )}

          {/* Description */}
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("detail.descriptionLabel")}
            </h3>
            {canUpdate ? (
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={commitDescription}
                rows={5}
                placeholder={t("detail.descriptionPlaceholder")}
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : task.description ? (
              <p className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm text-foreground/90">
                {task.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t("detail.noDescription")}</p>
            )}
          </section>

          {/* Properties */}
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <PropRow label={t("detail.state")}>
              <Select
                value={task.stateId ?? ""}
                disabled={!canUpdate || patch.isPending}
                onChange={(e) =>
                  patch.mutate({ stateId: e.target.value ? e.target.value : null })
                }
                aria-label={t("detail.state")}
              >
                <option value="">{t("board.noStateColumn")}</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </PropRow>

            <PropRow label={t("detail.priority")}>
              <PrioritySelect
                value={task.priority}
                disabled={!canUpdate || patch.isPending}
                onChange={(p: PriorityDto) => patch.mutate({ priority: p })}
                aria-label={t("detail.priority")}
              />
            </PropRow>

            <PropRow label={t("detail.assignee")}>
              <div className="flex items-center gap-2">
                {task.assigneeUserId && (
                  <Avatar name={labelFor(task.assigneeUserId) ?? task.assigneeUserId} size="sm" />
                )}
                <Select
                  value={task.assigneeUserId ?? ""}
                  disabled={!canUpdate || patch.isPending}
                  onChange={(e) =>
                    patch.mutate({ assigneeUserId: e.target.value ? e.target.value : null })
                  }
                  aria-label={t("detail.assignee")}
                >
                  <option value="">{t("createIssue.unassigned")}</option>
                  {employees.map((emp) => (
                    <option key={emp.userId} value={emp.userId}>
                      {employeeLabel(emp)}
                    </option>
                  ))}
                </Select>
              </div>
            </PropRow>

            <PropRow label={t("detail.due")}>
              <input
                type="date"
                value={toDateInput(task.dueDate)}
                disabled={!canUpdate || patch.isPending}
                onChange={(e) =>
                  patch.mutate({
                    dueDate: e.target.value ? new Date(e.target.value).toISOString() : null,
                  })
                }
                aria-label={t("detail.due")}
                className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
            </PropRow>

            <PropRow label={t("detail.labels")}>
              <div className="flex flex-wrap items-center gap-1.5">
                {task.labels.map((label) => (
                  <LabelChip
                    key={label.id}
                    label={label}
                    onRemove={canUpdate ? (id) => removeLabel.mutate(id) : undefined}
                    removing={removeLabel.isPending}
                  />
                ))}
                {canUpdate && (
                  <LabelPicker
                    allLabels={labels}
                    selectedIds={selectedLabelIds}
                    onAdd={(id) => addLabel.mutate(id)}
                    disabled={addLabel.isPending}
                  />
                )}
                {task.labels.length === 0 && !canUpdate && (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </PropRow>
          </section>

          {patch.isError && (
            <p className="text-sm text-destructive">{t("detail.updateError")}</p>
          )}

          {/* Meta + comments */}
          <p className="text-[11px] text-muted-foreground">
            {t("detail.createdAt", { date: new Date(task.createdAt).toLocaleString("vi-VN") })} ·{" "}
            {t("detail.updatedAt", { date: new Date(task.updatedAt).toLocaleString("vi-VN") })}
          </p>

          <CommentThread taskId={task.id} />
        </div>
      </aside>
    </div>
  );
}

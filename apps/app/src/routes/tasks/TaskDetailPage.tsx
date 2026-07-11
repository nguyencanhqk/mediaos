import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw, Pencil, Trash2 } from "lucide-react";
import { taskCoreApi, taskKeys, useCan, useCanExact, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, Input } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { TaskStatusBadge, TaskPriorityBadge, TaskOverdueBadge } from "./TaskStatusBadge";
import { TaskStatusSelect } from "./TaskStatusSelect";
import { TaskAssignControl } from "./TaskAssignControl";
import { TaskFormDrawer } from "./TaskFormDrawer";
import { DeleteTaskDialog } from "./DeleteTaskDialog";

/**
 * TaskDetailPage — S4-FE-TASK-2 (SPEC-06 §13.7, TASK-SCREEN-007). Deep link /tasks/:taskId.
 *
 * Thành phần: tiêu đề/trạng thái/priority/assignee/reporter/project/deadline/mô tả (spec) + bình luận
 * (comment:task đã có route thật). Checklist/File đính kèm/Lịch sử hoạt động trong spec lý tưởng CHƯA
 * build ở đây — BE không có endpoint CRUD checklist (chỉ đọc nội bộ để gate chuyển Done) / không có GET
 * activity log cho task — KHÔNG tự chế client cho API không tồn tại (ghi backlog riêng).
 *
 * Nút cập nhật trạng thái/priority/deadline = TaskStatusSelect; đổi assignee/theo dõi = TaskAssignControl
 * (cả 2 tự gate finer bên trong qua useCan). Edit/Delete gate ở page này (update:task/delete:task).
 */
function CommentsSection({ taskId }: { taskId: string }) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const canComment = useCan(
    TASK_CORE_ENGINE_PAIRS.COMMENT.action,
    TASK_CORE_ENGINE_PAIRS.COMMENT.resourceType,
  );
  const [draft, setDraft] = useState("");

  const { data: comments, isLoading } = useQuery({
    queryKey: taskKeys.comments(taskId),
    queryFn: () => taskCoreApi.listComments(taskId),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: () => taskCoreApi.addComment(taskId, { body: draft.trim() }),
    onSuccess: async () => {
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) });
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-muted-foreground">
        {t("tasks.detail.comments.title")}
      </h3>
      {isLoading ? (
        <div className="h-10 animate-pulse rounded bg-muted" />
      ) : comments && comments.length > 0 ? (
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border p-2 text-sm">
              <p className="font-medium text-foreground">{c.userFullName ?? "—"}</p>
              <p className="text-foreground">{c.body}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(c.createdAt).toLocaleString("vi-VN")}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tasks.detail.comments.empty")}</p>
      )}
      {canComment && (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("tasks.detail.comments.placeholder")}
            disabled={mutation.isPending}
          />
          <Button
            type="button"
            size="sm"
            disabled={mutation.isPending || draft.trim().length === 0}
            onClick={() => mutation.mutate()}
          >
            {t("tasks.detail.comments.send")}
          </Button>
        </div>
      )}
      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {t("tasks.form.errors.generic")}
        </p>
      )}
    </Card>
  );
}

function OverviewCard({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const rows: Array<[string, ReactNode]> = [
    [t("tasks.detail.fields.project"), task.projectName ?? "—"],
    [t("tasks.detail.fields.assignee"), task.assigneeName ?? "—"],
    [t("tasks.detail.fields.creator"), task.creatorName ?? "—"],
    [t("tasks.detail.fields.priority"), <TaskPriorityBadge key="p" priority={task.priority} />],
    [t("tasks.detail.fields.status"), <TaskStatusBadge key="s" status={task.status} />],
    [
      t("tasks.detail.fields.dueAt"),
      <span key="d" className="flex items-center gap-2">
        {task.dueAt ? new Date(task.dueAt).toLocaleString("vi-VN") : "—"}
        <TaskOverdueBadge isOverdue={task.isOverdue} />
      </span>,
    ],
    [
      t("tasks.detail.fields.startAt"),
      task.startAt ? new Date(task.startAt).toLocaleString("vi-VN") : "—",
    ],
    [
      t("tasks.detail.fields.completedAt"),
      task.completedAt ? new Date(task.completedAt).toLocaleString("vi-VN") : "—",
    ],
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="space-y-3 p-4 md:col-span-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("tasks.detail.fields.description")}
        </h3>
        <p className="whitespace-pre-wrap text-sm text-foreground">{task.description ?? "—"}</p>
      </Card>
      {rows.map(([label, value]) => (
        <Card key={String(label)} className="space-y-1 p-4">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <div className="text-sm text-foreground">{value}</div>
        </Card>
      ))}
    </div>
  );
}

export function TaskDetailPage({ taskId, onBack }: { taskId: string; onBack: () => void }) {
  const { t } = useTranslation("tasks");
  const canView = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canDelete = useCanExact(
    TASK_CORE_ENGINE_PAIRS.DELETE.action,
    TASK_CORE_ENGINE_PAIRS.DELETE.resourceType,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => taskCoreApi.getTask(taskId),
    enabled: canView,
    staleTime: 30_000,
  });

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("tasks.detail.forbidden.title")}
          description={t("tasks.detail.forbidden.description")}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
    return (
      <div className="p-6">
        <EmptyState
          title={notFound ? t("tasks.detail.notFound.title") : t("tasks.detail.error.title")}
          description={
            notFound ? t("tasks.detail.notFound.description") : t("tasks.detail.error.description")
          }
          action={
            notFound ? undefined : (
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("actions.retry", { ns: "common" })}
              </Button>
            )
          }
        />
      </div>
    );
  }

  if (!data) return null;
  const task = data;

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t("tasks.detail.backToList")}
      </Button>

      <PageHeader
        title={task.title}
        description={task.projectName ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            {canUpdate && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t("tasks.detail.actions.edit")}
              </Button>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                {t("tasks.detail.actions.delete")}
              </Button>
            )}
          </div>
        }
      />

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("tasks.detail.quickActions.title")}
        </h3>
        <TaskStatusSelect task={task} />
        <TaskAssignControl task={task} />
      </Card>

      <OverviewCard task={task} />

      <CommentsSection taskId={task.id} />

      {editOpen && (
        <TaskFormDrawer
          mode="edit"
          task={task}
          onClose={() => setEditOpen(false)}
          onSuccess={() => setEditOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteTaskDialog task={task} onClose={() => setDeleteOpen(false)} onDeleted={onBack} />
      )}
    </div>
  );
}

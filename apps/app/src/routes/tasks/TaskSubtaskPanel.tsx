import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Plus, Pencil, Trash2 } from "lucide-react";
import {
  taskCoreApi,
  taskKeys,
  taskSubtaskInvalidation,
  useCan,
  useCanExact,
} from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import type { SubtaskListItemDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { PanelBody } from "./PanelBody";
import { TaskStatusBadge, TaskOverdueBadge } from "./TaskStatusBadge";
import { AddSubtaskDialog, EditSubtaskDialog, DeleteSubtaskConfirm } from "./TaskSubtaskDialogs";
import { SubtaskAssigneeControl, SubtaskDueControl } from "./SubtaskInlineControls";

/**
 * TaskSubtaskPanel — việc con (subtask) 1 cấp (S5-TASK-SUBTASK-1, DECISIONS-05 D-31, TASK-API-701/702).
 * Mount tại TaskDetailPage NGAY TRƯỚC TaskChecklistPanel — subtask là phân rã công việc, đứng trên
 * checklist (hạng mục trong đầu MỘT người, D-31 kéo theo). Props CHỈ `{ taskId }` như 4 panel còn lại
 * (checklist/comment/activity/file) — panel tự tra cha/dự án qua CHÍNH cache `taskKeys.detail(taskId)`
 * mà TaskDetailPage đã tải (cache-hit tức thời khi dùng thật; tự fetch khi mount độc lập, ví dụ test).
 *
 * Panel CHỈ quản lý con khi task đang xem LÀ GỐC (`parentTaskId == null`, D-33 "cây đúng 1 cấp") —
 * mở một VIỆC CON thì thay bằng dòng "Thuộc công việc cha: <link>", không mời gọi hành vi BE sẽ 400.
 *
 * D-39 (đọc thừa hưởng, GHI KHÔNG thừa hưởng): server trả `canOpen` cho mỗi dòng — con actor không có
 * phạm vi ĐỌC riêng (chỉ thấy qua thừa hưởng từ cha) render READ-ONLY: KHÔNG link (bấm vào
 * `GET /tasks/:childId` sẽ 404), KHÔNG nút sửa/xoá (sẽ 403). Nút lên/xuống (reorder) KHÔNG phụ thuộc
 * `canOpen` — TASK-API-702 chỉ kiểm phạm vi GHI trên CHA, không kiểm từng con (D-33 bảng khoá).
 *
 * Quyền theo ĐÚNG cặp BE dùng (KHÔNG 1 gate chung như TaskChecklistPanel — subtask tái dùng 3 pair
 * khác nhau của TASK core, không phải 1 gate riêng như checklist): thêm = create:task (TASK-API-202
 * với parentTaskId); sửa nhanh + đổi thứ tự = update:task (PATCH .../reorder); xoá = delete:task
 * (SENSITIVE, mirror canDelete của TaskDetailPage — useCanExact fail-closed).
 *
 * Optimistic reorder + rollback (onMutate cancelQueries → setQueryData; onError rollback; onSettled
 * invalidate) mirror TaskChecklistPanel. Invalidation của MỌI mutate chạm ĐỦ BA qua
 * `taskSubtaskInvalidation.afterMutate` (subtasks(parentId) · detail(parentId) · kanban(projectId)) —
 * thiếu vế kanban thì thẻ board đứng số cũ (badge tiến độ, TaskKanbanPage).
 *
 * Nút reorder disable thêm theo `isFetching` (bẫy đã biết #245) — spec phải chờ list settle trước click.
 */
function ProgressBar({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation("tasks");
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1" data-testid="subtask-progress">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("tasks.detail.subtasks.progress", { done, total, pct })}
      </p>
    </div>
  );
}

function SubtaskRow({
  item,
  index,
  total,
  parentTaskId,
  projectId,
  canEdit,
  canDelete,
  canReorder,
  reorderDisabled,
  onMoveUp,
  onMoveDown,
  onEditRequest,
  onDeleteRequest,
}: {
  item: SubtaskListItemDto;
  index: number;
  total: number;
  /** Cha + dự án — cần cho invalidation sau khi sửa nhanh trên dòng. */
  parentTaskId: string;
  projectId: string | null;
  canEdit: boolean;
  canDelete: boolean;
  canReorder: boolean;
  reorderDisabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEditRequest: (item: SubtaskListItemDto) => void;
  onDeleteRequest: (item: SubtaskListItemDto) => void;
}) {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();

  return (
    <li
      className="flex items-center gap-2 rounded-md border border-border p-2"
      data-testid={`subtask-row-${item.id}`}
    >
      <div className="flex flex-col gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("tasks.detail.subtasks.moveUp")}
          disabled={!canReorder || reorderDisabled || index === 0}
          onClick={onMoveUp}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("tasks.detail.subtasks.moveDown")}
          disabled={!canReorder || reorderDisabled || index === total - 1}
          onClick={onMoveDown}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="min-w-0 flex-1 space-y-0.5">
        {item.canOpen ? (
          <button
            type="button"
            className="truncate text-left font-medium text-foreground underline-offset-2 hover:underline"
            onClick={() => void navigate({ to: "/tasks/$taskId", params: { taskId: item.id } })}
          >
            {item.title}
          </button>
        ) : (
          <p
            className="truncate font-medium text-muted-foreground"
            title={t("tasks.detail.subtasks.outOfScopeHint")}
          >
            {item.title}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {/* S5-TASK-INLINE-1 — người thực hiện + hạn sửa NGAY trên dòng (bấm avatar / bấm ngày).
              `canOpen=false` (con ngoài phạm vi đọc riêng của actor, D-39) ⇒ chỉ-đọc: GHI không
              thừa hưởng, bấm sửa sẽ 403. */}
          <SubtaskAssigneeControl
            item={item}
            parentTaskId={parentTaskId}
            projectId={projectId}
            canEdit={item.canOpen && canEdit}
          />
          <span className="truncate">
            {item.assigneeName ?? t("tasks.detail.subtasks.unassigned")}
          </span>
          <SubtaskDueControl
            item={item}
            parentTaskId={parentTaskId}
            projectId={projectId}
            canEdit={item.canOpen && canEdit}
          />
          <TaskOverdueBadge isOverdue={item.isOverdue} />
        </div>
      </div>

      <TaskStatusBadge status={item.status} />

      {item.canOpen && canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("tasks.detail.subtasks.editAction")}
          onClick={() => onEditRequest(item)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
      {item.canOpen && canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("tasks.detail.subtasks.deleteAction")}
          onClick={() => onDeleteRequest(item)}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </li>
  );
}

export function TaskSubtaskPanel({
  taskId,
  embedded = false,
}: {
  taskId: string;
  /** Trong tab ⇒ bỏ vỏ Card + tiêu đề (nhãn tab đã nói). Xem PanelBody. */
  embedded?: boolean;
}) {
  const { t } = useTranslation("tasks");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canCreate = useCan(
    TASK_CORE_ENGINE_PAIRS.CREATE.action,
    TASK_CORE_ENGINE_PAIRS.CREATE.resourceType,
  );
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canDelete = useCanExact(
    TASK_CORE_ENGINE_PAIRS.DELETE.action,
    TASK_CORE_ENGINE_PAIRS.DELETE.resourceType,
  );

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SubtaskListItemDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SubtaskListItemDto | null>(null);

  const taskQuery = useQuery({
    queryKey: taskKeys.detail(taskId),
    queryFn: () => taskCoreApi.getTask(taskId),
    staleTime: 30_000,
  });

  const parentTaskId = taskQuery.data?.parentTaskId ?? null;
  const projectId = taskQuery.data?.projectId ?? null;
  // Chỉ task GỐC mới có mục việc con — task đang loading/error KHÔNG được coi là gốc (tránh gọi
  // GET /subtasks sớm cho một task rồi hoá ra là con, D-33 cây đúng 1 cấp).
  const isRoot = taskQuery.data != null && parentTaskId === null;

  const subtasksQuery = useQuery({
    queryKey: taskKeys.subtasks(taskId),
    queryFn: () => taskCoreApi.listSubtasks(taskId),
    enabled: isRoot,
    staleTime: 15_000,
  });

  const reorderMutation = useMutation({
    mutationFn: (subtaskIds: string[]) => taskCoreApi.reorderSubtasks(taskId, { subtaskIds }),
    onMutate: async (subtaskIds: string[]) => {
      const queryKey = taskKeys.subtasks(taskId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<SubtaskListItemDto[]>(queryKey);
      if (previous) {
        const byId = new Map(previous.map((item) => [item.id, item]));
        // flatMap (không filter+null) giữ kiểu SubtaskListItemDto[] chặt — id không khớp (không nên
        // xảy ra: subtaskIds luôn lấy từ CHÍNH `previous`) bị bỏ qua thay vì lẫn `null` vào mảng.
        const next: SubtaskListItemDto[] = subtaskIds.flatMap((id, idx) => {
          const found = byId.get(id);
          return found ? [{ ...found, sortOrder: idx }] : [];
        });
        queryClient.setQueryData<SubtaskListItemDto[]>(queryKey, next);
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(taskKeys.subtasks(taskId), context.previous);
    },
    onSettled: () => {
      for (const key of taskSubtaskInvalidation.afterMutate(taskId, projectId))
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const moveSubtask = (index: number, direction: -1 | 1) => {
    const list = subtasksQuery.data ?? [];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const reordered = [...list];
    const tmp = reordered[index];
    reordered[index] = reordered[targetIndex];
    reordered[targetIndex] = tmp;
    reorderMutation.mutate(reordered.map((item) => item.id));
  };

  // ── Đang xem MỘT VIỆC CON: đừng mời gọi hành vi BE sẽ 400 (D-33) — thay bằng dòng link cha ──
  if (taskQuery.data && parentTaskId !== null) {
    return (
      <PanelBody embedded={embedded} className="p-4" data-testid="subtask-parent-link">
        <p className="text-sm text-muted-foreground">
          {t("tasks.detail.subtasks.belongsToParent")}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline"
            onClick={() =>
              void navigate({ to: "/tasks/$taskId", params: { taskId: parentTaskId } })
            }
          >
            {t("tasks.detail.subtasks.viewParentAction")}
          </button>
        </p>
      </PanelBody>
    );
  }

  if (taskQuery.isLoading) {
    return (
      <PanelBody embedded={embedded} className="p-4">
        <div className="h-16 animate-pulse rounded bg-muted" />
      </PanelBody>
    );
  }

  if (taskQuery.isError) {
    return (
      <PanelBody embedded={embedded} className="space-y-2 p-4">
        <p className="text-sm text-destructive">{t("tasks.detail.subtasks.errors.loadFailed")}</p>
        <Button variant="outline" size="sm" onClick={() => void taskQuery.refetch()}>
          {t("actions.retry", { ns: "common" })}
        </Button>
      </PanelBody>
    );
  }

  if (!taskQuery.data) return null;

  const items = subtasksQuery.data ?? [];
  // Nguồn SỰ THẬT DUY NHẤT của tổng/hoàn thành là aggregate server (D-34, COUNTABLE_CHILD loại
  // Cancelled) — KHÔNG tự đếm lại từ `items` ở client (items có thể còn con Cancelled).
  const total = taskQuery.data.subtaskTotal ?? 0;
  const done = taskQuery.data.subtaskDone ?? 0;
  const reorderBusy = subtasksQuery.isFetching || reorderMutation.isPending;

  return (
    <PanelBody embedded={embedded}>
      <div className="flex items-center justify-between">
        {embedded ? (
          <span />
        ) : (
          <h3 className="text-sm font-semibold text-muted-foreground">
            {t("tasks.detail.subtasks.title")}
          </h3>
        )}
        {canCreate && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("tasks.detail.subtasks.addButton")}
          </Button>
        )}
      </div>

      {total > 0 && <ProgressBar done={done} total={total} />}

      {subtasksQuery.isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : subtasksQuery.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{t("tasks.detail.subtasks.errors.loadFailed")}</p>
          <Button variant="outline" size="sm" onClick={() => void subtasksQuery.refetch()}>
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      ) : items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((item, index) => (
            <SubtaskRow
              key={item.id}
              item={item}
              index={index}
              total={items.length}
              parentTaskId={taskId}
              projectId={projectId}
              canEdit={canUpdate}
              canDelete={canDelete}
              canReorder={canUpdate}
              reorderDisabled={reorderBusy}
              onMoveUp={() => moveSubtask(index, -1)}
              onMoveDown={() => moveSubtask(index, 1)}
              onEditRequest={setEditTarget}
              onDeleteRequest={setDeleteTarget}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tasks.detail.subtasks.empty")}</p>
      )}

      {addOpen && (
        <AddSubtaskDialog
          parentTaskId={taskId}
          projectId={projectId}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editTarget && (
        <EditSubtaskDialog
          parentTaskId={taskId}
          projectId={projectId}
          item={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteSubtaskConfirm
          parentTaskId={taskId}
          projectId={projectId}
          item={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </PanelBody>
  );
}

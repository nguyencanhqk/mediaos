import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  taskCollabApi,
  taskKeys,
  taskCollabInvalidation,
  useCan,
  ApiError,
} from "@mediaos/web-core";
import { Button, Checkbox, Input, Badge, Dialog } from "@mediaos/ui";
import type { TaskChecklistResponseDto, TaskChecklistItemResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";
import { PanelBody } from "./PanelBody";

/**
 * TaskChecklistPanel — nhóm checklist + item tick được (S4-FE-TASK-3, SPEC-06 §13.7/§14.16,
 * TASK-API-501..504 + item §17.5-17.7).
 *
 * Gate DUY NHẤT `update:task` cho MỌI mutate (checklist LẪN item, kể cả TICK) — mirror BE OWNER CHỐT
 * (task-checklists.controller "KHÔNG cặp checklist riêng, gate bằng update:task"). Từ 0501
 * (S5-TASK-PROJROLE-1) employee@Own + manager@Team ĐÃ có update:task ⇒ panel render tương tác được khi
 * useCan true; BE còn cap thêm theo project_role (D-24, mode 'collab' cho checklist). KHÔNG hard-code
 * role — chỉ theo useCan, BE là người quyết cuối.
 */
function checklistErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 422) return "tasks.detail.checklist.errors.validation";
    if (err.status === 403) return "tasks.detail.checklist.errors.forbidden";
    if (err.status === 404) return "tasks.detail.checklist.errors.notFound";
    if (err.status >= 500) return "tasks.detail.checklist.errors.server";
  }
  return "tasks.detail.checklist.errors.generic";
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation("tasks");
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1" data-testid="checklist-progress">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        {t("tasks.detail.checklist.progress", { done, total, pct })}
      </p>
    </div>
  );
}

function ChecklistItemRow({
  taskId,
  checklistId,
  item,
  canUpdate,
}: {
  taskId: string;
  checklistId: string;
  item: TaskChecklistItemResponseDto;
  canUpdate: boolean;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const queryKey = taskKeys.checklists(taskId);

  const tickMutation = useMutation({
    mutationFn: (isDone: boolean) =>
      taskCollabApi.updateChecklistItem(taskId, checklistId, item.id, { isDone }),
    onMutate: async (isDone: boolean) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TaskChecklistResponseDto[]>(queryKey);
      queryClient.setQueryData<TaskChecklistResponseDto[]>(queryKey, (old) =>
        old?.map((cl) =>
          cl.id === checklistId
            ? { ...cl, items: cl.items.map((i) => (i.id === item.id ? { ...i, isDone } : i)) }
            : cl,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      for (const key of taskCollabInvalidation.checklists(taskId))
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => taskCollabApi.deleteChecklistItem(taskId, checklistId, item.id),
    onSuccess: () => {
      for (const key of taskCollabInvalidation.checklists(taskId))
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <li className="flex items-center gap-2">
      <Checkbox
        checked={item.isDone}
        disabled={!canUpdate || tickMutation.isPending}
        aria-label={item.title}
        onChange={(e) => tickMutation.mutate(e.target.checked)}
      />
      <span
        className={
          item.isDone ? "flex-1 text-sm text-muted-foreground line-through" : "flex-1 text-sm"
        }
      >
        {item.title}
      </span>
      {canUpdate && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t("tasks.detail.checklist.deleteItemAction")}
          disabled={removeMutation.isPending}
          onClick={() => removeMutation.mutate()}
        >
          <Trash2 className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </li>
  );
}

function AddChecklistItemForm({ taskId, checklistId }: { taskId: string; checklistId: string }) {
  const { t } = useTranslation("tasks");
  const [title, setTitle] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskCollabApi.addChecklistItem(taskId, checklistId, { title: title.trim() }),
    onSuccess: async () => {
      setTitle("");
      for (const key of taskCollabInvalidation.checklists(taskId))
        await queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return (
    <div className="flex items-center gap-2">
      <Input
        value={title}
        disabled={mutation.isPending}
        placeholder={t("tasks.detail.checklist.addItemPlaceholder")}
        className="h-8 text-sm"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim()) {
            e.preventDefault();
            mutation.mutate();
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={mutation.isPending || title.trim().length === 0}
        onClick={() => mutation.mutate()}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ChecklistGroup({
  taskId,
  checklist,
  canUpdate,
  onDeleteRequest,
}: {
  taskId: string;
  checklist: TaskChecklistResponseDto;
  canUpdate: boolean;
  onDeleteRequest: (checklist: TaskChecklistResponseDto) => void;
}) {
  const { t } = useTranslation("tasks");
  const done = checklist.items.filter((i) => i.isDone).length;
  const total = checklist.items.length;

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {checklist.title}
          {checklist.isRequiredForDone && (
            <Badge variant="warning" className="ml-2">
              {t("tasks.detail.checklist.requiredBadge")}
            </Badge>
          )}
        </p>
        {canUpdate && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("tasks.detail.checklist.deleteAction")}
            onClick={() => onDeleteRequest(checklist)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </div>
      {total > 0 && <ProgressBar done={done} total={total} />}
      <ul className="space-y-1.5">
        {checklist.items.map((item) => (
          <ChecklistItemRow
            key={item.id}
            taskId={taskId}
            checklistId={checklist.id}
            item={item}
            canUpdate={canUpdate}
          />
        ))}
      </ul>
      {canUpdate && <AddChecklistItemForm taskId={taskId} checklistId={checklist.id} />}
    </div>
  );
}

function CreateChecklistDialog({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { t } = useTranslation("tasks");
  const [title, setTitle] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      taskCollabApi.createChecklist(taskId, {
        title: title.trim(),
        isRequiredForDone: false,
        items: [],
      }),
    onSuccess: async () => {
      for (const key of taskCollabInvalidation.checklists(taskId))
        await queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("tasks.detail.checklist.createDialog.title")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("tasks.detail.checklist.createDialog.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || title.trim().length === 0}
          >
            {t("tasks.detail.checklist.createDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(checklistErrorKey(mutation.error))}
        </p>
      )}
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("tasks.detail.checklist.createDialog.titlePlaceholder")}
      />
    </Dialog>
  );
}

function DeleteChecklistConfirm({
  taskId,
  checklist,
  onClose,
}: {
  taskId: string;
  checklist: TaskChecklistResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskCollabApi.deleteChecklist(taskId, checklist.id),
    onSuccess: async () => {
      for (const key of taskCollabInvalidation.checklists(taskId))
        await queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("tasks.detail.checklist.deleteDialog.title")}
      description={t("tasks.detail.checklist.deleteDialog.description", {
        title: checklist.title,
      })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("tasks.detail.checklist.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("tasks.detail.checklist.deleteDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(checklistErrorKey(mutation.error))}
        </p>
      )}
    </Dialog>
  );
}

export function TaskChecklistPanel({
  taskId,
  embedded = false,
}: {
  taskId: string;
  /** Trong tab ⇒ bỏ vỏ Card + tiêu đề (nhãn tab đã nói). Xem PanelBody. */
  embedded?: boolean;
}) {
  const { t } = useTranslation("tasks");
  const canUpdate = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TaskChecklistResponseDto | null>(null);

  const {
    data: checklists,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: taskKeys.checklists(taskId),
    queryFn: () => taskCollabApi.listChecklists(taskId),
    staleTime: 30_000,
  });

  const totalDone = (checklists ?? []).reduce(
    (sum, cl) => sum + cl.items.filter((i) => i.isDone).length,
    0,
  );
  const totalItems = (checklists ?? []).reduce((sum, cl) => sum + cl.items.length, 0);
  // Tổng hợp toàn task CHỈ hiện khi có ≥2 nhóm checklist — 1 nhóm thì trùng lặp với progress trong
  // chính ChecklistGroup bên dưới (KHÔNG hiển thị 2 lần cùng 1 số).
  const showOverallProgress = (checklists?.length ?? 0) > 1 && totalItems > 0;

  return (
    <PanelBody embedded={embedded}>
      <div className="flex items-center justify-between">
        {embedded ? (
          <span />
        ) : (
          <h3 className="text-sm font-semibold text-muted-foreground">
            {t("tasks.detail.checklist.title")}
          </h3>
        )}
        {canUpdate && (
          <Button type="button" size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("tasks.detail.checklist.addButton")}
          </Button>
        )}
      </div>

      {showOverallProgress && <ProgressBar done={totalDone} total={totalItems} />}

      {isLoading ? (
        <div className="h-16 animate-pulse rounded bg-muted" />
      ) : isError ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">
            {t("tasks.detail.checklist.errors.loadFailed")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t("actions.retry", { ns: "common" })}
          </Button>
        </div>
      ) : checklists && checklists.length > 0 ? (
        <div className="space-y-3">
          {checklists.map((cl) => (
            <ChecklistGroup
              key={cl.id}
              taskId={taskId}
              checklist={cl}
              canUpdate={canUpdate}
              onDeleteRequest={setDeleteTarget}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tasks.detail.checklist.empty")}</p>
      )}

      {createOpen && <CreateChecklistDialog taskId={taskId} onClose={() => setCreateOpen(false)} />}
      {deleteTarget && (
        <DeleteChecklistConfirm
          taskId={taskId}
          checklist={deleteTarget}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </PanelBody>
  );
}

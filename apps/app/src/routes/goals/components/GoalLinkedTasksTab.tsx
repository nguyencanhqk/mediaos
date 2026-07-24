import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Unlink } from "lucide-react";
import { ApiError, goalApi, goalInvalidation, goalKeys, useCan } from "@mediaos/web-core";
import type { GoalDetailResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { Button, EmptyState } from "@mediaos/ui";
import { TaskStatusBadge } from "@/routes/tasks/TaskStatusBadge";
import { GOAL_ENGINE_PAIRS, TASK_UPDATE_PAIR_FOR_GOAL_LINK } from "../constants";
import { formatDateOnly } from "../goal-format";
import { SimpleTable, TabError, TabSkeleton } from "./GoalTabPrimitives";
import { GoalTaskPickerDialog } from "./GoalTaskPickerDialog";

/**
 * S5-GOAL-FE-2 — tab "Công việc gắn" (GOAL-API-010): đọc + GẮN THÊM + THÁO từng dòng.
 *
 * TWO-GATE, KHÔNG PHẢI MỘT: ghi ở đây đòi CẢ `('update','goal')` (đổi tập đo của mục tiêu) VÀ
 * `('update','task')` (ghi cột `goal_id` trên hàng `tasks`) — đúng hai cổng của
 * `goal-tasks-link.service.ts`. Dựng thiếu cổng thứ hai thì trưởng đơn vị có `update:goal @Department`
 * sẽ thấy nút, bấm, rồi ăn 403 — hoặc tệ hơn, tưởng mình sửa được task ngoài phạm vi qua đường vòng.
 *
 * Mục tiêu ĐÃ CHỐT KỲ ⇒ mọi control ghi disabled (GOAL-ERR-005): kỳ đã đóng băng thì tập việc đóng góp
 * vào con số đó cũng phải đứng yên.
 */
export function GoalLinkedTasksTab({
  goal,
  active,
}: {
  goal: GoalDetailResponseDto;
  active: boolean;
}) {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const canUpdateGoal = useCan(
    GOAL_ENGINE_PAIRS.UPDATE.action,
    GOAL_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canUpdateTask = useCan(
    TASK_UPDATE_PAIR_FOR_GOAL_LINK.action,
    TASK_UPDATE_PAIR_FOR_GOAL_LINK.resourceType,
  );
  const canEditLinks = canUpdateGoal && canUpdateTask;
  const finalized = Boolean(goal.finalizedAt);

  const query = useQuery({
    queryKey: goalKeys.linkedTasks(goal.id),
    queryFn: () => goalApi.listLinkedTasks(goal.id),
    enabled: active,
    staleTime: 30_000,
  });

  const unlinkMutation = useMutation({
    mutationFn: (task: TaskCoreResponseDto) => goalApi.unlinkTask(goal.id, task.id),
    onSuccess: async (_result, task) => {
      // Tháo việc ⇒ % của mục tiêu này đổi, và phía TASK mất chip "Mục tiêu" (panel + thẻ board).
      await Promise.all(
        goalInvalidation
          .linkTasks({ goalIds: [goal.id], taskId: task.id, projectId: task.projectId })
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
    onError: (err: unknown) => {
      setUnlinkError(
        err instanceof ApiError && err.message ? err.message : t("linkedTasksActions.unlinkError"),
      );
    },
  });

  if (query.isLoading) return <TabSkeleton />;
  if (query.isError) return <TabError message={t("detail.linkedTasks.error")} />;
  const tasks = query.data ?? [];

  const addButton = canEditLinks ? (
    <Button
      size="sm"
      variant="outline"
      data-testid="goal-link-tasks-open"
      disabled={finalized}
      onClick={() => setPickerOpen(true)}
    >
      <Link2 className="mr-2 h-4 w-4" />
      {t("linkedTasksActions.add")}
    </Button>
  ) : null;

  const picker = pickerOpen ? (
    <GoalTaskPickerDialog goal={goal} onClose={() => setPickerOpen(false)} />
  ) : null;

  if (tasks.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex justify-end">{addButton}</div>
        <EmptyState
          title={t("detail.linkedTasks.empty.title")}
          description={t("detail.linkedTasks.empty.description")}
        />
        {picker}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {finalized && canEditLinks ? (
          <p className="text-xs text-warning">{t("linkedTasksActions.lockedFinalized")}</p>
        ) : (
          <span />
        )}
        {addButton}
      </div>

      <SimpleTable
        head={[
          t("detail.linkedTasks.columns.title"),
          t("detail.linkedTasks.columns.status"),
          t("detail.linkedTasks.columns.assignee"),
          t("detail.linkedTasks.columns.project"),
          t("detail.linkedTasks.columns.due"),
          ...(canEditLinks ? [""] : []),
        ]}
      >
        {tasks.map((task: TaskCoreResponseDto) => (
          <tr key={task.id} className="border-t border-border">
            <td className="px-3 py-2 text-sm text-foreground">{task.title}</td>
            {/* TaskStatusBadge (dùng chung tasks/) — nhãn ĐÃ i18n theo enum, KHÔNG in enum thô. */}
            <td className="px-3 py-2">
              <TaskStatusBadge status={task.status} />
            </td>
            <td className="px-3 py-2 text-sm text-muted-foreground">{task.assigneeName ?? "—"}</td>
            <td className="px-3 py-2 text-sm text-muted-foreground">{task.projectName ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-2 text-sm text-muted-foreground">
              {formatDateOnly(task.dueAt ? task.dueAt.slice(0, 10) : null)}
            </td>
            {canEditLinks && (
              <td className="px-3 py-2 text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`goal-unlink-task-${task.id}`}
                  disabled={finalized || unlinkMutation.isPending}
                  onClick={() => {
                    setUnlinkError(null);
                    unlinkMutation.mutate(task);
                  }}
                >
                  <Unlink className="mr-1.5 h-3.5 w-3.5" />
                  {t("linkedTasksActions.unlink")}
                </Button>
              </td>
            )}
          </tr>
        ))}
      </SimpleTable>

      {unlinkError && (
        <p className="text-sm text-destructive" role="alert">
          {unlinkError}
        </p>
      )}
      {picker}
    </div>
  );
}

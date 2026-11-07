import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Link2, Users } from "lucide-react";
import { ApiError, goalApi, goalInvalidation, goalKeys, useCan } from "@mediaos/web-core";
import type { GoalDetailResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { Button, EmptyState } from "@mediaos/ui";
import { TASK_CORE_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { readTaskDrawerParam, useTaskDrawer } from "@/routes/tasks/task-drawer-nav";
import {
  GOAL_ENGINE_PAIRS,
  TASK_CREATE_PAIR_FOR_DECOMPOSE,
  TASK_UPDATE_PAIR_FOR_GOAL_LINK,
} from "../constants";
import { groupLinkedTasksByAssignee, sortLinkedTasks } from "../goal-linked-tasks-view";
import {
  GoalAddTaskButton,
  GoalAddTaskDrawer,
  GoalAddTaskFailure,
  useGoalAddTask,
} from "./GoalAddTask";
import { GoalLinkedTaskTable } from "./GoalLinkedTaskTable";
import { TabError, TabSkeleton } from "./GoalTabPrimitives";
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
  // S20-TASK-DRAWER-1 — bấm tên việc mở drawer TẠI CHỖ (/goals/G?task=T), trang mục tiêu nằm dưới.
  const { openTask } = useTaskDrawer();
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
  // «Thêm việc» = TẠO việc rồi GẮN: đủ cả ba cặp (update:goal + phạm vi ghi update:task + create:task),
  // thiếu một ⇒ không có nút (không để người dùng tạo xong rồi ăn 403 ở bước gắn).
  const canCreateTask = useCan(
    TASK_CREATE_PAIR_FOR_DECOMPOSE.action,
    TASK_CREATE_PAIR_FOR_DECOMPOSE.resourceType,
  );
  const canAddTask = canEditLinks && canCreateTask;
  // Lối mở drawer gác CÙNG cặp drawer/route việc dùng (`read:task`): thiếu cặp này thì drawer chỉ báo
  // «Không mở được» ⇒ không vẽ nút, tên việc là chữ thường.
  const canOpenTask = useCan(
    TASK_CORE_ENGINE_PAIRS.READ.action,
    TASK_CORE_ENGINE_PAIRS.READ.resourceType,
  );
  const finalized = Boolean(goal.finalizedAt);
  const [grouped, setGrouped] = useState(false);
  const addTask = useGoalAddTask(goal);

  // Đóng drawer việc (`?task=` có → mất) ⇒ làm mới tiến độ mục tiêu: việc vừa đổi sang Done trong drawer
  // phải kéo % (mode tasks) theo, không cần F5. Chỉ chạy ở lượt CHUYỂN từ có → không có.
  const openedTaskId = useRouterState({
    select: (state) => readTaskDrawerParam(state.location.search),
  });
  const previousOpenedRef = useRef<string | null>(openedTaskId);
  useEffect(() => {
    const wasOpen = previousOpenedRef.current !== null;
    previousOpenedRef.current = openedTaskId;
    if (!wasOpen || openedTaskId !== null) return;
    void Promise.all(
      goalInvalidation
        .taskProgress(goal.id)
        .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  }, [openedTaskId, goal.id, queryClient]);

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

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {finalized && canEditLinks ? (
        <p className="text-xs text-warning">{t("linkedTasksActions.lockedFinalized")}</p>
      ) : (
        <span />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {tasks.length > 0 && (
          <Button
            size="sm"
            variant={grouped ? "default" : "outline"}
            data-testid="goal-linked-group-toggle"
            aria-pressed={grouped}
            onClick={() => setGrouped((v) => !v)}
          >
            <Users className="mr-2 h-4 w-4" />
            {t("linkedTasksActions.groupByAssignee")}
          </Button>
        )}
        {canAddTask && <GoalAddTaskButton state={addTask} disabled={finalized} />}
        {canEditLinks && (
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
        )}
      </div>
    </div>
  );

  const overlays = (
    <>
      <GoalAddTaskFailure state={addTask} />
      {pickerOpen && <GoalTaskPickerDialog goal={goal} onClose={() => setPickerOpen(false)} />}
      <GoalAddTaskDrawer goal={goal} state={addTask} />
    </>
  );

  if (tasks.length === 0) {
    return (
      <div className="space-y-3">
        {toolbar}
        <EmptyState
          title={t("detail.linkedTasks.empty.title")}
          description={t("detail.linkedTasks.empty.description")}
        />
        {overlays}
      </div>
    );
  }

  const tableProps = {
    canOpenTask,
    canEditLinks,
    locked: finalized || unlinkMutation.isPending,
    onOpen: openTask,
    onUnlink: (task: TaskCoreResponseDto) => {
      setUnlinkError(null);
      unlinkMutation.mutate(task);
    },
  };

  return (
    <div className="space-y-3">
      {toolbar}
      {grouped ? (
        <div className="space-y-4" data-testid="goal-linked-groups">
          {groupLinkedTasksByAssignee(tasks).map((group) => (
            <section
              key={group.key}
              data-testid={`goal-linked-group-${group.key}`}
              className="space-y-1.5"
            >
              <h3 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
                <span>{group.assigneeName ?? t("linkedTasksActions.unassigned")}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {t("linkedTasksActions.groupDone", {
                    done: group.doneCount,
                    total: group.tasks.length,
                  })}
                </span>
              </h3>
              <GoalLinkedTaskTable tasks={group.tasks} {...tableProps} />
            </section>
          ))}
        </div>
      ) : (
        <GoalLinkedTaskTable tasks={sortLinkedTasks(tasks)} {...tableProps} />
      )}

      {unlinkError && (
        <p className="text-sm text-destructive" role="alert">
          {unlinkError}
        </p>
      )}
      {overlays}
    </div>
  );
}

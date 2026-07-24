import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { ApiError, goalApi, goalInvalidation, goalKeys, useCan } from "@mediaos/web-core";
import { GOAL_PAGE_LIMIT_MAX } from "@mediaos/contracts";
import type { GoalCoreResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { Select } from "@mediaos/ui";
import { GOAL_ENGINE_PAIRS } from "@/routes/goals/constants";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

/**
 * S5-GOAL-FE-2 — ô "Mục tiêu" trong panel chi tiết công việc (GOAL-API-010, SPEC-10 §9).
 *
 * TWO-GATE: sửa được khi có CẢ `('update','goal')` VÀ `('update','task')` — đúng hai cổng của
 * `goal-tasks-link.service.ts` (gắn task vào mục tiêu vừa là SỬA mục tiêu, vừa là GHI cột `goal_id`
 * trên hàng `tasks`). Thiếu một cổng ⇒ CHỈ ĐỌC: không mount picker, KHÔNG gọi `GET /goals` (đỡ 1 request
 * chắc chắn vô ích) — ẩn còn hơn hiện-rồi-403.
 *
 * ỨNG VIÊN LỌC Ở CLIENT, VÌ SAO: `GET /goals` chỉ nhận MỘT neo mỗi lần (level/departmentId/projectId/
 * employeeId) chứ không có OR-filter đa-neo, mà một task hợp lệ với NHIỀU neo cùng lúc (mục tiêu phòng
 * của nó, mục tiêu dự án của nó, mục tiêu cá nhân của người phụ trách). Nên tải một trang goal `Active`
 * rồi lọc theo đúng luật GOAL-ERR-008:
 *   · `employee` → CHỈ khi `employeeId` === người phụ trách chính của task (server CHẶN 422 nếu lệch);
 *   · `project`  → CHỈ khi `projectId` === dự án của task                    (server CHẶN 422);
 *   · `department` → cho hiện (server chỉ CẢNH BÁO MỀM, không chặn — §12), ưu tiên đúng phòng của task.
 *
 * ĐỔI mục tiêu = gọi `linkTasks(goalMới)`: server tự gỡ khỏi mục tiêu cũ và recompute CẢ HAI. Vì vậy
 * invalidate phải phủ CẢ goal mới lẫn goal CŨ (goalInvalidation.linkTasks) + phía task (panel + board),
 * nếu không % sai đọng lại trên màn người khác cho tới khi F5 (bài học PR #250, nhân đôi).
 */
export function TaskGoalField({ task }: { task: TaskCoreResponseDto }) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canUpdateGoal = useCan(
    GOAL_ENGINE_PAIRS.UPDATE.action,
    GOAL_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canUpdateTask = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canEdit = canUpdateGoal && canUpdateTask;

  const currentGoalId = task.goalId ?? null;

  const goalsQuery = useQuery({
    queryKey: goalKeys.list({ status: "Active", limit: GOAL_PAGE_LIMIT_MAX }),
    queryFn: () => goalApi.listGoals({ status: "Active", limit: GOAL_PAGE_LIMIT_MAX }),
    enabled: canEdit,
    staleTime: 60_000,
  });

  const options = useMemo(
    () => (goalsQuery.data ?? []).filter((goal) => matchesTaskAnchor(goal, task)),
    [goalsQuery.data, task],
  );

  const mutation = useMutation({
    mutationFn: async (nextGoalId: string) => {
      if (nextGoalId === "") {
        if (!currentGoalId) return;
        await goalApi.unlinkTask(currentGoalId, task.id);
        return;
      }
      await goalApi.linkTasks(nextGoalId, { taskIds: [task.id] });
    },
    onMutate: () => setErrorMessage(null),
    onError: (err: unknown) => {
      // 422 GOAL-ERR-008 (sai neo employee/project) là CHẶN CỨNG — hiện verbatim thông điệp server đã
      // viết cho người đọc. KHÔNG optimistic-set value ở đây nên "rollback" = select tự về giá trị
      // trong cache task (chưa đổi) khi render lại.
      setErrorMessage(
        err instanceof ApiError && err.message ? err.message : t("tasks.detail.goal.error"),
      );
    },
    onSettled: async (_data, _err, nextGoalId) => {
      const nextId = nextGoalId === "" ? null : nextGoalId;
      await Promise.all(
        goalInvalidation
          .linkTasks({
            goalIds: [nextId, currentGoalId],
            taskId: task.id,
            projectId: task.projectId,
          })
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  const label = t("tasks.detail.fields.goal");

  if (!canEdit) {
    return (
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p data-testid="task-goal-readonly" className="flex items-center gap-1.5 text-sm">
          <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {task.goalCode ? (
            <span className="truncate text-foreground">
              {task.goalCode}
              {task.goalName ? ` — ${task.goalName}` : ""}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor="task-goal-picker" className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select
        id="task-goal-picker"
        data-testid="task-goal-picker"
        value={currentGoalId ?? ""}
        disabled={mutation.isPending || goalsQuery.isLoading}
        onChange={(e) => {
          // Chọn lại đúng giá trị đang có ⇒ KHÔNG gọi API (gắn lại mục tiêu cũ là request vô nghĩa
          // nhưng vẫn ghi audit + recompute ở server).
          if (e.target.value === (currentGoalId ?? "")) return;
          mutation.mutate(e.target.value);
        }}
      >
        <option value="">{t("tasks.detail.goal.none")}</option>
        {/* Mục tiêu ĐANG gắn có thể nằm ngoài trang goal vừa tải (hoặc đã Completed) — vẫn phải hiện
            để select không "nhảy" về "—" và tự gợi ý tháo mục tiêu mà người dùng không hề bấm. */}
        {currentGoalId && !options.some((goal) => goal.id === currentGoalId) && (
          <option value={currentGoalId}>
            {task.goalCode ?? currentGoalId}
            {task.goalName ? ` — ${task.goalName}` : ""}
          </option>
        )}
        {options.map((goal) => (
          <option key={goal.id} value={goal.id}>
            {goal.goalCode} — {goal.name}
          </option>
        ))}
      </Select>
      {goalsQuery.isError && (
        <p className="text-xs text-destructive">{t("tasks.detail.goal.loadError")}</p>
      )}
      {errorMessage && (
        <p className="text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

/**
 * Luật neo GOAL-ERR-008 nhìn từ phía TASK (helper THUẦN, không React — dễ suy luận + test).
 * Trả về `true` khi gắn task này vào mục tiêu đó KHÔNG bị server chặn cứng.
 */
function matchesTaskAnchor(goal: GoalCoreResponseDto, task: TaskCoreResponseDto): boolean {
  if (goal.status !== "Active" || goal.finalizedAt) return false;
  switch (goal.level) {
    case "employee":
      return goal.employeeId !== null && goal.employeeId === task.mainAssigneeEmployeeId;
    case "project":
      return goal.projectId !== null && goal.projectId === task.projectId;
    case "department":
      // Server KHÔNG chặn (chỉ cảnh báo mềm) — nhưng gợi ý đúng phòng của task thì danh sách mới dùng
      // được; task chưa có phòng thì để nguyên mọi mục tiêu phòng cho người dùng tự quyết.
      return task.departmentId == null || goal.departmentId === task.departmentId;
    default:
      // `company`: MVP không tạo được (GOAL-ERR-004) — không đưa vào picker.
      return false;
  }
}

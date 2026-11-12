import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { ApiError, goalApi, goalInvalidation, useCan } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { Select } from "@mediaos/ui";
import { GOAL_ENGINE_PAIRS } from "@/routes/goals/constants";
import { useGoalSuggestions } from "@/routes/goals/use-goal-suggestions";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

/**
 * S5-GOAL-FE-2 — ô "Mục tiêu" trong panel chi tiết công việc (GOAL-API-010, SPEC-10 §9).
 *
 * TWO-GATE: sửa được khi có CẢ `('update','goal')` VÀ `('update','task')` — đúng hai cổng của
 * `goal-tasks-link.service.ts` (gắn task vào mục tiêu vừa là SỬA mục tiêu, vừa là GHI cột `goal_id`
 * trên hàng `tasks`). Thiếu một cổng ⇒ CHỈ ĐỌC: không mount picker, KHÔNG gọi `GET /goals` (đỡ 1 request
 * chắc chắn vô ích) — ẩn còn hơn hiện-rồi-403.
 *
 * ỨNG VIÊN (S20-GOAL-SUGGEST-1): hook `useGoalSuggestions` — tối đa 3 truy vấn GET /goals hẹp lọc Ở SERVER
 * theo từng neo (cá nhân/dự án/phòng của việc) + kỳ chứa hạn việc, rồi lọc luật GOAL-ERR-008 +
 * cách đo «theo việc gắn» ở `goal-suggest.ts`. Việc CHƯA gắn + đúng 1 ứng viên ⇒ chip một chạm.
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
  // S20-SEC-GOALNAMEDTO-1 — server chỉ trả cờ (không id/mã/tên) khi người xem không đọc được mục tiêu
  // đang gắn ⇒ chip trung tính, KHÔNG picker (đổi/gỡ mục tiêu mình không thấy là thao tác mù). Chỉ cờ
  // TƯỜNG MINH của server mới bật nhánh này: phản hồi API cũ (không cờ) giữ nguyên hành vi trước.
  const isRestricted = task.hasGoal === true && !task.goalCode;

  // S20-GOAL-SUGGEST-1 — ứng viên do hook chung lọc Ở SERVER theo neo + kỳ (không còn cắt ở 200 mục
  // tiêu đầu) và CHỈ mục tiêu đo «theo việc gắn» (việc gắn vào manual/children/project không đổi số).
  const suggestions = useGoalSuggestions(
    {
      projectId: task.projectId,
      assigneeEmployeeId: task.mainAssigneeEmployeeId,
      departmentId: task.departmentId,
      dueAt: task.dueAt,
    },
    { enabled: !isRestricted },
  );
  const options = suggestions.candidates;
  // Việc CHƯA gắn mà có đúng 1 ứng viên ⇒ chip một chạm. Việc đang gắn mục tiêu khác: KHÔNG gợi ý chuyển.
  const offered = !currentGoalId && options.length === 1 ? (options[0] ?? null) : null;

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

  if (isRestricted) {
    return (
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p data-testid="task-goal-restricted" className="flex items-center gap-1.5 text-sm">
          <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{t("goalRef.restricted")}</span>
        </p>
        <p className="text-xs text-muted-foreground">{t("goalRef.restrictedHint")}</p>
      </div>
    );
  }

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
        disabled={mutation.isPending || suggestions.isLoading}
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
      {offered && (
        <button
          type="button"
          data-testid="task-goal-offer"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(offered.id)}
          className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground hover:bg-muted disabled:opacity-60"
        >
          {t("goalSuggest.chipOffer", { goal: `${offered.goalCode} — ${offered.name}` })}
        </button>
      )}
      {suggestions.isError && (
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

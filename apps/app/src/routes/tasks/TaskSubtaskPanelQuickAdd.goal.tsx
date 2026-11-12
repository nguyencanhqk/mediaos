import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { goalApi, goalKeys, useCan } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import type { GoalCoreResponseDto, TaskCoreResponseDto } from "@mediaos/contracts";
import { GOAL_ENGINE_PAIRS } from "@/routes/goals/constants";
import {
  GOAL_SUGGEST_STALE_MS,
  GOAL_SUGGEST_SUBTASK_PRESELECT,
  isSubtaskGoalOffered,
  subtaskGoalLock,
  type SubtaskGoalLock,
} from "@/routes/goals/goal-suggest";
import { useCanLinkGoalTasks } from "@/routes/goals/use-goal-suggestions";
import { useGoalSuggestLink } from "@/routes/goals/use-goal-suggestions-link";

/**
 * S20-GOAL-SUGGEST-1 (US-GOAL-NV-93) — ô «Tính vào ‹mục tiêu của việc cha›» ở ô thêm việc con (không tự
 * gắn; mặc định theo Q28 = `GOAL_SUGGEST_SUBTASK_PRESELECT`, hiện KHÔNG chọn sẵn).
 *
 * Hiện khi: có `update:goal` + `update:task` + `view:goal`, việc cha đang gắn mục tiêu và mục tiêu đó còn
 * nhận việc (Active, chưa chốt kỳ, đo «theo việc gắn»). Khoá kèm lý do (không ẩn) khi server chắc chắn
 * chặn: mục tiêu cá nhân (việc con thêm nhanh chưa có người phụ trách — GOAL-ERR-008) hoặc ngoài phạm vi
 * ghi (không người phụ trách + cha ngoài dự án). Thiếu quyền / mục tiêu đã chốt-huỷ ⇒ ẩn, không gọi
 * bước gắn; việc con vẫn tạo như cũ.
 */
export interface SubtaskGoalOption {
  readonly goal: GoalCoreResponseDto | null;
  readonly lock: SubtaskGoalLock | null;
  readonly checked: boolean;
  readonly setChecked: (next: boolean) => void;
  /** Gắn việc con vừa tạo nếu ô đang bật; lỗi ⇒ toast «chưa gắn» + «Thử gắn lại». */
  readonly afterCreate: (task: TaskCoreResponseDto) => void;
  readonly reset: () => void;
}

export function useSubtaskGoalOption(
  parentGoalId: string | null,
  parentHasProject: boolean,
): SubtaskGoalOption {
  const { t: tg } = useTranslation("goals");
  const canLink = useCanLinkGoalTasks();
  const canView = useCan(GOAL_ENGINE_PAIRS.VIEW.action, GOAL_ENGINE_PAIRS.VIEW.resourceType);
  const { link, describeFailure } = useGoalSuggestLink();
  const [override, setOverride] = useState<boolean | null>(null);

  const { data } = useQuery({
    queryKey: goalKeys.detail(parentGoalId ?? ""),
    queryFn: () => goalApi.getGoal(parentGoalId ?? ""),
    enabled: canLink && canView && parentGoalId !== null,
    staleTime: GOAL_SUGGEST_STALE_MS,
  });
  const goal = data && isSubtaskGoalOffered(data) ? data : null;
  const lock = goal
    ? subtaskGoalLock(goal, { parentHasProject, subtaskAssigneeEmployeeId: null })
    : null;
  const checked = goal !== null && lock === null && (override ?? GOAL_SUGGEST_SUBTASK_PRESELECT);

  const attempt = useCallback(
    (task: TaskCoreResponseDto, target: GoalCoreResponseDto): void => {
      const code = task.title;
      link({
        goalId: target.id,
        goalCode: target.goalCode,
        taskId: task.id,
        projectId: task.projectId,
      }).catch((err: unknown) => {
        toast.error(tg("goalSuggest.unlinkedAfterCreate", { code, reason: describeFailure(err) }), {
          key: `goal-suggest-subtask-failed:${task.id}`,
          action: { label: tg("goalSuggest.retry"), onClick: () => attempt(task, target) },
        });
      });
    },
    [link, describeFailure, tg],
  );

  const afterCreate = useCallback(
    (task: TaskCoreResponseDto) => {
      if (goal && checked) attempt(task, goal);
    },
    [goal, checked, attempt],
  );

  return {
    goal,
    lock,
    checked,
    setChecked: setOverride,
    afterCreate,
    reset: () => setOverride(null),
  };
}

export function SubtaskGoalCheckbox({ option }: { option: SubtaskGoalOption }) {
  const { t } = useTranslation("tasks");
  const { goal, lock, checked, setChecked } = option;
  if (!goal) return null;
  const lockedId = "subtask-goal-locked";
  return (
    <div className="space-y-0.5" data-testid="subtask-goal-option">
      <label className="flex items-center gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={checked}
          disabled={lock !== null}
          aria-describedby={lock ? lockedId : undefined}
          onChange={(e) => setChecked(e.target.checked)}
        />
        {t("goalSuggest.subtask.label", { goal: `${goal.goalCode} — ${goal.name}` })}
      </label>
      {lock ? (
        <p id={lockedId} className="text-xs text-muted-foreground">
          {t(
            `goalSuggest.subtask.locked${lock === "personalOwner" ? "PersonalOwner" : "NoWriteScope"}`,
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("goalSuggest.subtask.note")}</p>
      )}
    </div>
  );
}

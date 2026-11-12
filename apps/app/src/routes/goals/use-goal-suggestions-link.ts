import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError, goalApi, goalInvalidation, taskCoreInvalidation } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { GOAL_ERR_ANCHOR_MISMATCH, GOAL_ERR_PERIOD_FINALIZED } from "./goal-suggest";

/**
 * S20-GOAL-SUGGEST-1 — bước GẮN (POST /goals/:id/tasks) sau khi việc đã tạo (khuôn hai lời gọi, Q13 = A) +
 * toast «Đã gắn vào ‹G› · Gỡ». `link` ném lỗi nguyên vẹn để phía gọi hiện «Đã tạo việc ‹mã› nhưng chưa
 * gắn: ‹lý do›» + «Thử gắn lại» — KHÔNG bao giờ báo thành công giả.
 */
export interface LinkTarget {
  readonly goalId: string;
  readonly goalCode: string;
  readonly taskId: string;
  readonly projectId: string | null;
}

async function refresh(queryClient: QueryClient, target: LinkTarget): Promise<void> {
  const keys = [
    ...goalInvalidation.linkTasks({
      goalIds: [target.goalId],
      taskId: target.taskId,
      projectId: target.projectId,
    }),
    ...taskCoreInvalidation.detail(target.taskId),
    ...taskCoreInvalidation.list(),
    ...taskCoreInvalidation.my(),
  ];
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

/** Khoá i18n (ns goals) cho lý do bước gắn thất bại. */
export function linkFailureReasonKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === GOAL_ERR_PERIOD_FINALIZED) return "goalSuggest.reason.finalized";
    if (err.code === GOAL_ERR_ANCHOR_MISMATCH) return "goalSuggest.reason.anchor";
    if (err.status === 404) return "goalSuggest.reason.outOfScope";
    if (err.status === 403) return "goalSuggest.reason.forbidden";
  }
  return "goalSuggest.reason.generic";
}

export function useGoalSuggestLink() {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();

  /** Lý do người-đọc: 403 hiện thông điệp server (đã viết cho người đọc), còn lại theo khoá. */
  const describeFailure = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError && err.status === 403 && err.message) return err.message;
      return t(linkFailureReasonKey(err));
    },
    [t],
  );

  const undo = useCallback(
    async (target: LinkTarget) => {
      try {
        await goalApi.unlinkTask(target.goalId, target.taskId);
        await refresh(queryClient, target);
      } catch {
        toast.error(t("goalSuggest.undoFailed", { goal: target.goalCode }), {
          key: `goal-suggest-undo-failed:${target.taskId}`,
        });
      }
    },
    [queryClient, t],
  );

  /** Gắn rồi báo toast «Đã gắn · Gỡ». Ném lỗi khi server từ chối (không toast thành công). */
  const link = useCallback(
    async (target: LinkTarget): Promise<void> => {
      await goalApi.linkTasks(target.goalId, { taskIds: [target.taskId] });
      await refresh(queryClient, target);
      toast.success(t("goalSuggest.linked", { goal: target.goalCode }), {
        key: `goal-suggest-linked:${target.taskId}`,
        action: { label: t("goalSuggest.undo"), onClick: () => void undo(target) },
      });
    },
    [queryClient, t, undo],
  );

  return { link, describeFailure };
}

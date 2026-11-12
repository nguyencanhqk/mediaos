import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
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

/** k có phải tiền tố (theo từng phần tử, so JSON) của other — invalidate theo tiền tố đã phủ other. */
function isPrefixOf(k: QueryKey, other: QueryKey): boolean {
  return (
    k.length <= other.length &&
    k.every((part, i) => JSON.stringify(part) === JSON.stringify(other[i]))
  );
}

/**
 * Khử trùng khoá: bỏ khoá trùng và khoá đã được một khoá tiền tố khác phủ (invalidateQueries khớp theo tiền tố)
 * — mỗi truy vấn chỉ bị invalidate một lần (tránh hủy-và-nạp-lại trùng).
 */
export function uniqueKeys(keys: readonly QueryKey[]): QueryKey[] {
  const out: QueryKey[] = [];
  for (const k of keys) {
    if (out.some((o) => isPrefixOf(o, k))) continue;
    for (let i = out.length - 1; i >= 0; i -= 1) if (isPrefixOf(k, out[i])) out.splice(i, 1);
    out.push(k);
  }
  return out;
}

export async function refresh(queryClient: QueryClient, target: LinkTarget): Promise<void> {
  const keys = uniqueKeys([
    ...goalInvalidation.linkTasks({
      goalIds: [target.goalId],
      taskId: target.taskId,
      projectId: target.projectId,
    }),
    ...taskCoreInvalidation.detail(target.taskId),
    ...taskCoreInvalidation.list(),
    ...taskCoreInvalidation.my(),
  ]);
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
      const result = await goalApi.linkTasks(target.goalId, { taskIds: [target.taskId] });
      await refresh(queryClient, target);
      const goal = target.goalCode;
      const key = `goal-suggest-linked:${target.taskId}`;
      if (result.linked === 0) {
        toast.warning(t("goalSuggest.alreadyLinked", { goal }), { key });
        return;
      }
      const warnings = result.warnings.map((w) => w.message).join(" ");
      const action = { label: t("goalSuggest.undo"), onClick: () => void undo(target) };
      if (warnings) {
        toast.warning(t("goalSuggest.linkedWarning", { goal, warning: warnings }), { key, action });
        return;
      }
      toast.success(t("goalSuggest.linked", { goal }), { key, action });
    },
    [queryClient, t, undo],
  );

  return { link, describeFailure };
}

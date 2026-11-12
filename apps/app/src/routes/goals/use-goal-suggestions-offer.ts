import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@mediaos/ui";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { fetchGoalCandidates, useCanLinkGoalTasks } from "./use-goal-suggestions";
import { useGoalSuggestLink } from "./use-goal-suggestions-link";

/**
 * S20-GOAL-SUGGEST-1 (US-GOAL-NV-92) — sau «tạo nhanh một dòng» / KanbanQuickCreate: không có ô để gắn, nên
 * khi có ĐÚNG 1 ứng viên hiện toast «Đã tạo ‹mã› · Tính vào ‹G›?» (chạm «Tính vào» mới gắn — không tự
 * gắn). 0 hoặc nhiều ứng viên, thiếu quyền, lỗi tải ứng viên ⇒ im lặng (việc đã tạo xong, gợi ý là phần
 * thêm). Chạm mà server từ chối ⇒ toast lỗi «Đã tạo việc … nhưng chưa gắn: …» (không báo thành công giả).
 */
export function useGoalOfferAfterCreate(): (task: TaskCoreResponseDto) => void {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const canLink = useCanLinkGoalTasks();
  const { link, describeFailure } = useGoalSuggestLink();

  return useCallback(
    (task: TaskCoreResponseDto) => {
      if (!canLink) return;
      void (async () => {
        const candidates = await fetchGoalCandidates(queryClient, {
          projectId: task.projectId,
          assigneeEmployeeId: task.mainAssigneeEmployeeId,
          departmentId: task.departmentId,
          dueAt: task.dueAt,
        });
        const [only] = candidates;
        if (candidates.length !== 1 || !only) return;
        const code = task.title;
        toast.success(t("goalSuggest.offer", { code, goal: `${only.goalCode} — ${only.name}` }), {
          key: `goal-suggest-offer:${task.id}`,
          action: {
            label: t("goalSuggest.offerAction"),
            onClick: () => {
              link({
                goalId: only.id,
                goalCode: only.goalCode,
                taskId: task.id,
                projectId: task.projectId,
              }).catch((err: unknown) => {
                toast.error(
                  t("goalSuggest.unlinkedAfterCreate", { code, reason: describeFailure(err) }),
                  { key: `goal-suggest-offer-failed:${task.id}` },
                );
              });
            },
          },
        });
      })();
    },
    [canLink, queryClient, link, describeFailure, t],
  );
}

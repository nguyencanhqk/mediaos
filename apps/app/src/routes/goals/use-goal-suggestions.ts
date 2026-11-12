import { useMemo } from "react";
import { useQueries, type QueryClient } from "@tanstack/react-query";
import { goalApi, goalKeys, useCan } from "@mediaos/web-core";
import type { GoalCoreResponseDto, ListGoalsQueryRequest } from "@mediaos/contracts";
import { useMyEmployeeLink } from "@/routes/tasks/use-my-employee";
import { TASK_CORE_ENGINE_PAIRS } from "@/routes/tasks/constants";
import { GOAL_ENGINE_PAIRS } from "./constants";
import {
  GOAL_SUGGEST_STALE_MS,
  goalQueryParams,
  rankCandidates,
  suggestionDate,
  suggestionMode,
  type GoalSuggestContext,
  type SuggestionMode,
} from "./goal-suggest";

/**
 * S20-GOAL-SUGGEST-1 — hook ứng viên mục tiêu để gắn một việc. Tối đa 3 truy vấn GET /goals HẸP, LỌC Ở
 * SERVER (neo + status=Active + kỳ chứa ngày + limit 50) ⇒ không còn cắt ở 200 mục tiêu đầu; phần server
 * chưa lọc được (`progressMode`, chưa chốt kỳ) lọc ở client trong `rankCandidates` (nợ: API GOAL chưa có
 * bộ lọc progressMode — xem docs/plans/S20-GOAL-SUGGEST-1.md).
 *
 * Chỉ bật khi có CẢ `update:goal` và `update:task` (hai cổng của GOAL-API-010) — thiếu một ⇒ KHÔNG gọi
 * GET /goals (ẩn còn hơn hiện-rồi-403) và KHÔNG ứng viên nào.
 */
export interface GoalSuggestions {
  readonly enabled: boolean;
  readonly candidates: readonly GoalCoreResponseDto[];
  readonly mode: SuggestionMode;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly myEmployeeId: string | null;
}

interface Combined {
  goals: GoalCoreResponseDto[];
  isLoading: boolean;
  isError: boolean;
}

// Hàm module-level ⇒ `combine` ổn định giữa các lần render.
function combineResults(
  results: Array<{ data?: GoalCoreResponseDto[]; isLoading: boolean; isError: boolean }>,
): Combined {
  return {
    goals: results.flatMap((r) => r.data ?? []),
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
  };
}

/** Hai cổng ghi của GOAL-API-010 — dùng chung cho hook và hàm đề xuất sau tạo nhanh. */
export function useCanLinkGoalTasks(): boolean {
  const canUpdateGoal = useCan(
    GOAL_ENGINE_PAIRS.UPDATE.action,
    GOAL_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const canUpdateTask = useCan(
    TASK_CORE_ENGINE_PAIRS.UPDATE.action,
    TASK_CORE_ENGINE_PAIRS.UPDATE.resourceType,
  );
  return canUpdateGoal && canUpdateTask;
}

export function useGoalSuggestions(
  ctx: GoalSuggestContext,
  options: { enabled?: boolean } = {},
): GoalSuggestions {
  const canLink = useCanLinkGoalTasks();
  const { projectId, assigneeEmployeeId, departmentId, dueAt } = ctx;
  const date = useMemo(() => suggestionDate({ dueAt }), [dueAt]);
  const paramsList = useMemo(
    () => goalQueryParams({ projectId, assigneeEmployeeId, departmentId, dueAt }, date),
    [projectId, assigneeEmployeeId, departmentId, dueAt, date],
  );
  const enabled = canLink && (options.enabled ?? true);

  const combined = useQueries({
    queries: paramsList.map((params) => ({
      queryKey: goalKeys.list(params),
      queryFn: () => goalApi.listGoals(params),
      enabled,
      staleTime: GOAL_SUGGEST_STALE_MS,
    })),
    combine: combineResults,
  });

  const me = useMyEmployeeLink(enabled);
  const myEmployeeId = me.status === "linked" ? me.employeeId : null;

  const candidates = useMemo(
    () =>
      enabled && !combined.isError
        ? rankCandidates(
            combined.goals,
            { projectId, assigneeEmployeeId, departmentId, dueAt },
            date,
          )
        : [],
    [
      enabled,
      combined.isError,
      combined.goals,
      projectId,
      assigneeEmployeeId,
      departmentId,
      dueAt,
      date,
    ],
  );

  return {
    enabled,
    candidates,
    mode: suggestionMode(candidates, myEmployeeId),
    isLoading: enabled && combined.isLoading,
    isError: enabled && combined.isError,
    myEmployeeId,
  };
}

/**
 * Bản mệnh lệnh của cùng truy vấn (dùng sau «tạo nhanh», khi chưa có ô nào mount): cùng khoá cache ⇒ ấm
 * thì không gọi lại. Một truy vấn lỗi ⇒ mảng rỗng (gợi ý là phần thêm — không được làm hỏng việc vừa tạo).
 */
export async function fetchGoalCandidates(
  queryClient: QueryClient,
  ctx: GoalSuggestContext,
): Promise<GoalCoreResponseDto[]> {
  const date = suggestionDate(ctx);
  const settled = await Promise.allSettled(
    goalQueryParams(ctx, date).map((params: Partial<ListGoalsQueryRequest>) =>
      queryClient.fetchQuery({
        queryKey: goalKeys.list(params),
        queryFn: () => goalApi.listGoals(params),
        staleTime: GOAL_SUGGEST_STALE_MS,
      }),
    ),
  );
  // Một truy vấn neo hỏng ⇒ không biết có ứng viên khác hay không ⇒ KHÔNG đề xuất (tránh «chỉ một» sai).
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) {
    console.warn("[goal-suggest] tải ứng viên lỗi — bỏ qua đề xuất", failed.reason);
    return [];
  }
  const lists = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  return rankCandidates(lists.flat(), ctx, date);
}

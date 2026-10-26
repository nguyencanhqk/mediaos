/**
 * S20-GOAL-QUICKSTART-1 (US-GOAL-NV-02) — đổi trạng thái mục tiêu MỘT chạm, dùng chung cho header chi
 * tiết, thẻ «Mục tiêu của tôi» ở /me và kích hoạt hàng loạt về sau (S20-GOAL-BULKACTIVATE-1).
 *
 * Đường ghi = `PATCH /goals/:id {status}` SẴN CÓ (cặp `update:goal`, audit như mọi PATCH; BE không có
 * FSM trạng thái mục tiêu và chạy lại validate toàn bộ sau merge). Hook không thêm request nào khác.
 *
 * Lạc quan: đổi `status` ngay trong mọi cache đang giữ mục tiêu đó (chi tiết · danh sách · /me/goals) để
 * Check-in bật lên tức thì; server từ chối (403 ngoài phạm vi, 422 theo mã) ⇒ trả mục tiêu đó về trạng
 * thái cũ + toast lỗi theo mã. Dù thành hay bại đều làm mới các cache đó từ server.
 *
 * `{ notify: false }` (S20-GOAL-BULKACTIVATE-1): KHÔNG toast từng mục — bên gọi tự tổng kết cả lô từ kết
 * quả `settleStatus` (lạc quan + rollback + làm mới cache vẫn y nguyên).
 */
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useMutation,
  useMutationState,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  ApiError,
  goalApi,
  goalInvalidation,
  goalKeys,
  mapApiErrorToUi,
  meKeys,
} from "@mediaos/web-core";
import { goalStatusSchema, type GoalCoreResponseDto, type GoalStatusDto } from "@mediaos/contracts";
import { toast } from "@mediaos/ui";

/** Một lần đổi trạng thái (toast thành công dùng tên mục tiêu server trả về). */
export interface GoalStatusChange {
  readonly goalId: string;
  readonly status: GoalStatusDto;
}

/** Kết quả một lần đổi: mục tiêu server đã lưu, hoặc lỗi GỐC (để bên gọi phân loại từ chối / mất mạng). */
export type GoalStatusSettled =
  | { readonly ok: true; readonly goal: GoalCoreResponseDto }
  | { readonly ok: false; readonly error: unknown };

export interface GoalStatusMutationOptions {
  /** Toast thành công/lỗi cho TỪNG lần đổi (mặc định true). */
  readonly notify?: boolean;
}

export interface GoalStatusMutation {
  /** Đổi trạng thái; KHÔNG ném — trả mục tiêu đã lưu, hoặc null khi server từ chối (đã rollback + toast). */
  readonly changeStatus: (change: GoalStatusChange) => Promise<GoalCoreResponseDto | null>;
  /** Như `changeStatus` nhưng giữ lỗi gốc; KHÔNG ném (lỗi đã rollback). */
  readonly settleStatus: (change: GoalStatusChange) => Promise<GoalStatusSettled>;
  /**
   * Mọi mục tiêu đang chờ server (để khoá đúng nút đó) — gồm MỌI lần đổi đang bay, kể cả nhiều mục tiêu
   * cùng lúc trên một hook (kích hoạt hàng loạt) và lần đổi từ hook khác (thẻ /me · header chi tiết).
   */
  readonly pendingGoalIds: ReadonlySet<string>;
}

/** Khoá chung của mọi lần đổi trạng thái — để đếm các lần đang chờ qua `useMutationState`. */
const GOAL_STATUS_MUTATION_KEY = [...goalKeys.all, "status-change"] as const;

/** Prefix các cache có thể giữ bản sao mục tiêu ở dạng phẳng (một mục · mảng · trang `{items}`). */
const optimisticPrefixes = (goalId: string): readonly QueryKey[] => [
  goalKeys.detail(goalId),
  [...goalKeys.all, "list"],
  [...meKeys.all, "goals"],
];

/** Mã 422 có thông điệp riêng; mã khác ⇒ thông điệp server qua error-mapper. */
const STATUS_ERROR_KEYS: Readonly<Record<string, string>> = {
  "GOAL-ERR-005": "statusChange.errors.finalized",
};
const HTTP_FORBIDDEN = 403;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function patchList(list: readonly unknown[], goalId: string, status: GoalStatusDto): unknown[] {
  return list.map((item) =>
    isRecord(item) && item.id === goalId && item.status !== status ? { ...item, status } : item,
  );
}

function listHasGoal(list: readonly unknown[], goalId: string): boolean {
  return list.some((item) => isRecord(item) && item.id === goalId);
}

/**
 * Bản sao cache với `status` của mục tiêu `goalId` đã đổi — THUẦN, không sửa tại chỗ. Không chứa mục
 * tiêu đó hoặc dữ liệu lạ ⇒ trả NGUYÊN tham chiếu (react-query không re-render vô cớ).
 */
export function patchGoalStatusInCache(
  data: unknown,
  goalId: string,
  status: GoalStatusDto,
): unknown {
  if (Array.isArray(data))
    return listHasGoal(data, goalId) ? patchList(data, goalId, status) : data;
  if (!isRecord(data)) return data;
  if (Array.isArray(data.items)) {
    return listHasGoal(data.items, goalId)
      ? { ...data, items: patchList(data.items, goalId, status) }
      : data;
  }
  return data.id === goalId ? { ...data, status } : data;
}

/**
 * Trạng thái hiện có của mục tiêu trong một cache (một mục · mảng · trang `{items}`). Không thấy, hoặc giá
 * trị không thuộc `GoalStatusDto` (cache lạ) ⇒ undefined — không bao giờ dùng giá trị lạ làm trạng thái
 * rollback.
 */
function findGoalStatus(data: unknown, goalId: string): GoalStatusDto | undefined {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : [data];
  const found = list.find((item) => isRecord(item) && item.id === goalId);
  if (!isRecord(found)) return undefined;
  const parsed = goalStatusSchema.safeParse(found.status);
  return parsed.success ? parsed.data : undefined;
}

/** Thông điệp lỗi người đọc: 403 ⇒ thiếu quyền trên mục tiêu này; 422 theo mã; còn lại ⇒ error-mapper. */
export function goalStatusErrorMessage(error: unknown, t: (key: string) => string): string {
  if (error instanceof ApiError && error.status === HTTP_FORBIDDEN) {
    return t("statusChange.errors.forbidden");
  }
  const codeKey = error instanceof ApiError ? STATUS_ERROR_KEYS[error.code] : undefined;
  if (codeKey) return t(codeKey);
  const mapped = error instanceof ApiError ? mapApiErrorToUi(error).message : "";
  return mapped || t("statusChange.errors.generic");
}

/**
 * Mọi mục tiêu đang chờ server đổi trạng thái (mọi hook, mọi màn). Nút ghi PHỤ THUỘC trạng thái mới —
 * Check-in — khoá trong khoảng chờ: bản lạc quan đã hiện Active nhưng server vẫn có thể từ chối (403/422),
 * khi đó một lần check-in bấm trong khoảng này sẽ bị BE trả lỗi.
 */
export function useGoalStatusPendingIds(): ReadonlySet<string> {
  const pendingIds = useMutationState({
    filters: { mutationKey: GOAL_STATUS_MUTATION_KEY, status: "pending" },
    select: (pending) => {
      const variables = pending.state.variables;
      return isRecord(variables) && typeof variables.goalId === "string" ? variables.goalId : null;
    },
  });
  return useMemo<ReadonlySet<string>>(
    () => new Set(pendingIds.filter((id): id is string => id !== null)),
    [pendingIds],
  );
}

export function useGoalStatusMutation({
  notify = true,
}: GoalStatusMutationOptions = {}): GoalStatusMutation {
  const { t } = useTranslation("goals");
  const queryClient = useQueryClient();
  const patchAll = (goalId: string, status: GoalStatusDto) => {
    for (const queryKey of optimisticPrefixes(goalId)) {
      queryClient.setQueriesData({ queryKey }, (old: unknown) =>
        patchGoalStatusInCache(old, goalId, status),
      );
    }
  };

  const mutation = useMutation<
    GoalCoreResponseDto,
    unknown,
    GoalStatusChange,
    { previousStatus: GoalStatusDto | undefined }
  >({
    mutationKey: GOAL_STATUS_MUTATION_KEY,
    mutationFn: ({ goalId, status }) => goalApi.updateGoal(goalId, { status }),
    onMutate: async ({ goalId, status }) => {
      const prefixes = optimisticPrefixes(goalId);
      await Promise.all(prefixes.map((queryKey) => queryClient.cancelQueries({ queryKey })));
      const previousStatus = prefixes
        .flatMap((queryKey) => queryClient.getQueriesData({ queryKey }))
        .map(([, data]) => findGoalStatus(data, goalId))
        .find((found) => found !== undefined);
      patchAll(goalId, status);
      return { previousStatus };
    },
    onError: (error, { goalId }, context) => {
      // Trả về trạng thái CŨ của riêng mục tiêu này (không khôi phục cả ảnh chụp cache: nhiều lần đổi
      // song song — vd kích hoạt hàng loạt — không được đè lên nhau khi một lần bị từ chối).
      if (context?.previousStatus) patchAll(goalId, context.previousStatus);
      if (notify) toast.error(goalStatusErrorMessage(error, t));
    },
    onSuccess: (saved, { status }) => {
      if (notify) toast.success(t(`statusChange.success.${status}`, { name: saved.name }));
    },
    onSettled: (_saved, _error, { goalId }) => {
      for (const queryKey of [...goalInvalidation.update(goalId), [...meKeys.all, "goals"]]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const { mutateAsync } = mutation;
  // Lỗi đã rollback (+ toast khi notify) ở onError — ở đây chỉ chuyển thành giá trị, không ném.
  const settleStatus = useCallback(
    (change: GoalStatusChange): Promise<GoalStatusSettled> =>
      mutateAsync(change).then(
        (goal) => ({ ok: true, goal }),
        (error: unknown) => ({ ok: false, error }),
      ),
    [mutateAsync],
  );
  const changeStatus = useCallback(
    (change: GoalStatusChange) =>
      settleStatus(change).then((settled) => (settled.ok ? settled.goal : null)),
    [settleStatus],
  );

  const pendingGoalIds = useGoalStatusPendingIds();
  return { changeStatus, settleStatus, pendingGoalIds };
}

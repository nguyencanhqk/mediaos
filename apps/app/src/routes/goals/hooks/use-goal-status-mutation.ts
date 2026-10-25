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
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  ApiError,
  goalApi,
  goalInvalidation,
  goalKeys,
  mapApiErrorToUi,
  meKeys,
} from "@mediaos/web-core";
import type { GoalCoreResponseDto, GoalStatusDto } from "@mediaos/contracts";
import { toast } from "@mediaos/ui";

/** Một lần đổi trạng thái (toast thành công dùng tên mục tiêu server trả về). */
export interface GoalStatusChange {
  readonly goalId: string;
  readonly status: GoalStatusDto;
}

export interface GoalStatusMutation {
  /** Đổi trạng thái; KHÔNG ném — trả mục tiêu đã lưu, hoặc null khi server từ chối (đã rollback + toast). */
  readonly changeStatus: (change: GoalStatusChange) => Promise<GoalCoreResponseDto | null>;
  /** Mục tiêu đang chờ server (để khoá đúng nút đó), null khi rảnh. */
  readonly pendingGoalId: string | null;
}

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

/** Trạng thái hiện có của mục tiêu trong một cache (một mục · mảng · trang `{items}`); không thấy ⇒ undefined. */
function findGoalStatus(data: unknown, goalId: string): GoalStatusDto | undefined {
  const list = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : [data];
  const found = list.find((item) => isRecord(item) && item.id === goalId);
  return isRecord(found) ? (found.status as GoalStatusDto) : undefined;
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

export function useGoalStatusMutation(): GoalStatusMutation {
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
      toast.error(goalStatusErrorMessage(error, t));
    },
    onSuccess: (saved, { status }) => {
      toast.success(t(`statusChange.success.${status}`, { name: saved.name }));
    },
    onSettled: (_saved, _error, { goalId }) => {
      for (const queryKey of [...goalInvalidation.update(goalId), [...meKeys.all, "goals"]]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  const { mutateAsync } = mutation;
  const changeStatus = useCallback(
    (change: GoalStatusChange) => mutateAsync(change).catch(() => null), // lỗi đã rollback + toast ở onError
    [mutateAsync],
  );

  return {
    changeStatus,
    pendingGoalId: mutation.isPending ? (mutation.variables?.goalId ?? null) : null,
  };
}

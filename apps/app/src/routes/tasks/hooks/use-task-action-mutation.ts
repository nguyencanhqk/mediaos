import { useMutation, useQueryClient } from "@tanstack/react-query";
import { taskKeys, taskCoreInvalidation } from "@mediaos/web-core";
import type { TaskCoreResponseDto, TaskActionResponseDto } from "@mediaos/contracts";

/**
 * useTaskActionMutation — optimistic update CÓ rollback cho action mutate vòng đời task (S4-FE-TASK-2,
 * SPEC-06 §14: change-status/change-priority/change-deadline/assign). Dùng chung bởi TaskStatusSelect
 * (status/priority/deadline) + TaskAssignControl (assignee) — tránh trôi logic rollback giữa 2 component.
 *
 * Cơ chế (mirror TanStack Query optimistic-update pattern chuẩn):
 *   1. onMutate: hủy query đang bay (tránh ghi đè optimistic bởi response cũ) → snapshot cache hiện tại
 *      → ghi đè lạc quan bằng `toPatch(vars)` → trả `{previous}` làm context rollback.
 *   2. onError: API lỗi (403/409/500/network) → restore snapshot NGUYÊN VẸN từ context (rollback thật,
 *      KHÔNG chỉ retry) → UI trở lại trạng thái trước khi user thao tác.
 *   3. onSuccess: server trả `{task, warnings}` → ghi ĐÈ cache bằng dữ liệu THẬT từ server (nguồn sự
 *      thật, có thể khác optimistic patch nếu server tính toán thêm — vd completedAt khi Done).
 *   4. onSettled: invalidate list/my (prefix) để đồng bộ các view khác đang hiển thị task này.
 */
export function useTaskActionMutation<TVariables>({
  taskId,
  mutationFn,
  toPatch,
}: {
  taskId: string;
  mutationFn: (vars: TVariables) => Promise<TaskActionResponseDto>;
  toPatch: (vars: TVariables) => Partial<TaskCoreResponseDto>;
}) {
  const queryClient = useQueryClient();
  const queryKey = taskKeys.detail(taskId);

  return useMutation({
    mutationFn,
    onMutate: async (vars: TVariables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TaskCoreResponseDto>(queryKey);
      if (previous) {
        queryClient.setQueryData<TaskCoreResponseDto>(queryKey, { ...previous, ...toPatch(vars) });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result.task);
    },
    onSettled: () => {
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

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
      // HỢP NHẤT, KHÔNG ghi đè. `respond()` (task-actions.service.ts) trả về `toTaskCoreDto(row)` — DTO
      // này KHÔNG mang `subtaskTotal`/`subtaskDone` (hai field đó chỉ `getTask` gắn thêm, và chúng
      // `.optional()` trong contract nên tsc KHÔNG bắt được). Ghi đè thẳng `result.task` là XOÁ chúng
      // khỏi cache chi tiết, mà `onSettled` lại không invalidate `detail` ⇒ không có refetch sửa lại,
      // `setQueryData` còn làm cache "tươi" thêm staleTime nữa. Hệ quả THẬT sau MỘT lần đổi ưu tiên:
      //   · TaskSubtaskPanel mất thanh tiến độ dù danh sách việc con vẫn đó;
      //   · TaskMoveProjectDialog đọc `subtaskTotal ?? 0` → 0 → mở khoá nút "Đổi dự án" cho task CÓ
      //     việc con ⇒ bấm là ăn 400 SUBTASK_PARENT_PROJECT_LOCKED, đúng thứ D-36a hứa chặn sớm.
      // Spread giữ nguyên ngữ nghĩa "server là nguồn sự thật": field nào server TRẢ (kể cả null tường
      // minh) vẫn thắng; chỉ field server KHÔNG trả mới giữ lại từ cache.
      queryClient.setQueryData<TaskCoreResponseDto>(queryKey, (prev) =>
        prev ? { ...prev, ...result.task } : result.task,
      );
    },
    onSettled: (data, _err, _vars, context) => {
      for (const key of taskCoreInvalidation.list())
        void queryClient.invalidateQueries({ queryKey: key });
      for (const key of taskCoreInvalidation.my())
        void queryClient.invalidateQueries({ queryKey: key });
      // `taskKeys.kanban` KHÔNG nằm dưới prefix `tasks/list` ⇒ list() ở trên KHÔNG chạm tới board.
      // Thiếu vế này: mở panel trượt TỪ board → đổi trạng thái → đóng panel, thẻ vẫn nằm cột cũ với
      // badge cũ tới 15s (staleTime, refetchOnWindowFocus tắt). Trước S5-TASK-BOARD-UX-1 lỗi bị che
      // vì chi tiết là TRANG riêng; panel-đè-board làm nó lộ ra ngay sau lưng người dùng.
      // projectId không đổi qua action mutate ⇒ lấy từ response, fallback snapshot khi lỗi/rollback.
      const projectId = data?.task.projectId ?? context?.previous?.projectId ?? null;
      if (projectId) void queryClient.invalidateQueries({ queryKey: taskKeys.kanban(projectId) });
    },
  });
}

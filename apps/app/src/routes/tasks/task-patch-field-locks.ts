import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { taskKeys, useCan, useCanExact } from "@mediaos/web-core";
import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { TASK_CORE_ENGINE_PAIRS } from "./constants";

/**
 * S20-SEC-TASKPATCHGATE-1 — trường của `PATCH /tasks/:id` có cặp quyền chuyên trách RIÊNG.
 *
 * Server: đổi hạn ↔ `update-deadline:task` · ưu tiên ↔ `update-priority:task` · người phụ trách ↔
 * `assign:task`; giá trị ĐỔI mà thiếu cặp ⇒ 403 cho CẢ request (không bỏ trường). FE khoá ô theo
 * đúng cặp server trả (`useCan`), không hard-code vai trò — server vẫn là cổng thật. Bảng ánh xạ ở
 * server: `apps/api/src/tasks/task-patch-field-gate.ts` (`TASK_PATCH_GATED_FIELDS`).
 *
 * `true` = khoá (thiếu cặp). Chỉ áp cho đường SỬA; tạo mới đi `create:task`. Là `type` (không phải
 * `interface`) để gán được vào bản đồ cờ theo tên trường của form (`editableDirtyFields`).
 */
export type TaskPatchFieldLocks = {
  assigneeEmployeeId: boolean;
  priority: boolean;
  dueAt: boolean;
};

export function useTaskPatchFieldLocks(): TaskPatchFieldLocks {
  const { ASSIGN, UPDATE_PRIORITY, UPDATE_DEADLINE } = TASK_CORE_ENGINE_PAIRS;
  const canAssign = useCan(ASSIGN.action, ASSIGN.resourceType);
  const canPriority = useCan(UPDATE_PRIORITY.action, UPDATE_PRIORITY.resourceType);
  const canDeadline = useCan(UPDATE_DEADLINE.action, UPDATE_DEADLINE.resourceType);
  return { assigneeEmployeeId: !canAssign, priority: !canPriority, dueAt: !canDeadline };
}

/**
 * S20-TASK-ALLOWEDACTIONS-1 — khả năng thao tác trên MỘT việc, theo `allowedActions` do server trả cho
 * chi tiết việc. Server THẮNG khi có khoá (kể cả khi `useCan` nói khác); thiếu khoá/thiếu trường (server
 * cũ, dòng danh sách) ⇒ quay về `useCan` như trước. CHỈ để trình bày — KHÔNG thay cổng server: quyền vừa
 * bị thu hồi ⇒ server vẫn 403, mutation rollback.
 *
 * `useCan` gọi VÔ ĐIỀU KIỆN (quy tắc hook) rồi mới chọn.
 */
export type TaskActionKey = Exclude<
  keyof NonNullable<TaskCoreResponseDto["allowedActions"]>,
  "lockReason"
>;

const ACTION_PAIRS: Record<
  Exclude<TaskActionKey, "delete">,
  { action: string; resourceType: string }
> = {
  changeStatus: TASK_CORE_ENGINE_PAIRS.UPDATE_STATUS,
  changeState: TASK_CORE_ENGINE_PAIRS.UPDATE_STATE,
  changeDeadline: TASK_CORE_ENGINE_PAIRS.UPDATE_DEADLINE,
  changePriority: TASK_CORE_ENGINE_PAIRS.UPDATE_PRIORITY,
  assign: TASK_CORE_ENGINE_PAIRS.ASSIGN,
  edit: TASK_CORE_ENGINE_PAIRS.UPDATE,
};

type WithActions = Pick<TaskCoreResponseDto, "allowedActions">;

export function useTaskActionAllowed(
  task: WithActions,
  key: Exclude<TaskActionKey, "delete">,
): boolean {
  const pair = ACTION_PAIRS[key];
  const byPair = useCan(pair.action, pair.resourceType);
  return task.allowedActions?.[key] ?? byPair;
}

export function useTaskDeleteAllowed(task: WithActions): boolean {
  const byPair = useCanExact(
    TASK_CORE_ENGINE_PAIRS.DELETE.action,
    TASK_CORE_ENGINE_PAIRS.DELETE.resourceType,
  );
  return task.allowedActions?.delete ?? byPair;
}

/** `"watcher"` ⇒ chỉ theo dõi việc: ô bị khoá hiện «Bạn chỉ theo dõi việc này» thay lời chung. */
export function taskLockReason(task: WithActions): "watcher" | null {
  return task.allowedActions?.lockReason ?? null;
}

/**
 * Làm mới cache CHI TIẾT sau thao tác có thể đổi vòng đời/phạm vi ghi (đổi trạng thái/cột/người phụ
 * trách): `allowedActions` trong cache là bản chụp CŨ nếu chỉ hợp nhất phản hồi action.
 */
export function useInvalidateTaskDetail(taskId: string): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  }, [queryClient, taskId]);
}

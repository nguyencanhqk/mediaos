import { useCan } from "@mediaos/web-core";
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

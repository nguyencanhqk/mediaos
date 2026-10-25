import type { TaskCoreStatusDto } from "@mediaos/contracts";
import { TASK_CORE_STATUS_OPTIONS } from "./constants";

/**
 * S20-TASK-QUICKEDIT-1 (US-TASK-NV-03) — bảng chuyển trạng thái phía FE, chỉ để LỌC MENU.
 *
 * Bản gốc là `TRANSITIONS` trong `apps/api/src/tasks/task-fsm.ts` (SPEC-06 §6.10.1, DECISIONS-03
 * D-18: bốn trạng thái hoạt động thông nhau mọi hướng, Done mở lại được; Cancelled chỉ khôi phục về
 * Todo/In Progress). `@mediaos/contracts` chưa có bảng này và `apps/app` không import được
 * `apps/api`, nên đây là bản sao CÓ RATCHET: `task-status-transitions.parity.spec.ts` đọc file nguồn
 * của API và so TỪNG cặp — lệch một cặp là đỏ.
 *
 * Server vẫn là lưới: menu chỉ bớt lựa chọn chắc chắn bị 409, không mở thêm quyền nào.
 */
export const TASK_STATUS_TRANSITIONS: Readonly<
  Record<TaskCoreStatusDto, readonly TaskCoreStatusDto[]>
> = {
  Todo: ["In Progress", "In Review", "Done", "Cancelled"],
  "In Progress": ["Todo", "In Review", "Done", "Cancelled"],
  "In Review": ["Todo", "In Progress", "Done", "Cancelled"],
  Done: ["Todo", "In Progress", "In Review", "Cancelled"],
  Cancelled: ["Todo", "In Progress"],
};

/** Trạng thái NULL (hàng cũ chưa backfill) được server coi là Todo — FE theo cùng quy ước. */
const NULL_STATUS_AS: TaskCoreStatusDto = "Todo";

export function canTransitionTaskStatus(
  from: TaskCoreStatusDto | null,
  to: TaskCoreStatusDto,
): boolean {
  const source = from ?? NULL_STATUS_AS;
  return source === to || TASK_STATUS_TRANSITIONS[source].includes(to);
}

/**
 * Lựa chọn của menu trạng thái: trạng thái HIỆN TẠI (đánh dấu đang chọn, chọn lại là no-op) cùng các
 * trạng thái chuyển tới được, giữ thứ tự chuẩn của `TASK_CORE_STATUS_OPTIONS`.
 */
export function statusMenuOptions(current: TaskCoreStatusDto | null): TaskCoreStatusDto[] {
  return TASK_CORE_STATUS_OPTIONS.filter(
    (status) => status === current || canTransitionTaskStatus(current, status),
  );
}

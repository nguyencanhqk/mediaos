/**
 * S20-TASK-LEAVEHANDOFF-1 (US-TASK-NV-93) — quy tắc THUẦN cho khối «Việc đến hạn trong kỳ nghỉ».
 *
 * Khối chỉ hiện với đơn CỦA CHÍNH TÔI đang Pending/Approved mà kỳ nghỉ CHƯA qua (`endDate ≥ hôm nay`
 * theo giờ công ty). Việc lọc CLIENT từ `GET /tasks/my`: nguồn «Được giao», chưa đóng, ngày hạn địa
 * phương (giờ công ty) nằm trong `[startDate, endDate]`.
 */
import type { MyTaskItemDto } from "@mediaos/contracts";
import { localDateOf, todayLocal } from "@mediaos/web-core";
import { TASK_CORE_CLOSED_STATUSES } from "../tasks/constants";
import { LEAVE_STATUS } from "./constants";

const HANDOFF_LEAVE_STATUSES: ReadonlySet<string> = new Set([
  LEAVE_STATUS.PENDING,
  LEAVE_STATUS.APPROVED,
]);

export interface LeavePeriod {
  readonly status: string;
  readonly startDate: string;
  readonly endDate: string;
}

/** Đơn có đủ điều kiện hiện khối (chưa xét quyền `read:task`). */
export function isLeaveHandoffEligible(req: LeavePeriod, now: Date, timeZone: string): boolean {
  return HANDOFF_LEAVE_STATUSES.has(req.status) && req.endDate >= todayLocal(now, timeZone);
}

/** Việc của tôi đến hạn trong kỳ nghỉ — giữ thứ tự server. */
export function tasksDueDuringLeave(
  tasks: readonly MyTaskItemDto[],
  period: Pick<LeavePeriod, "startDate" | "endDate">,
  timeZone: string,
): MyTaskItemDto[] {
  return tasks.filter((task) => {
    if (task.source !== "assigned") return false;
    if (task.status !== null && TASK_CORE_CLOSED_STATUSES.includes(task.status)) return false;
    if (!task.dueAt) return false;
    const due = localDateOf(new Date(task.dueAt), timeZone);
    return due >= period.startDate && due <= period.endDate;
  });
}

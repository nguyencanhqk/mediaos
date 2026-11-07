import type { TaskCoreResponseDto } from "@mediaos/contracts";
import { companyTimeZone, localDateOf } from "@mediaos/web-core";
import { GOAL_LINKED_TASK_DONE_STATUS, GOAL_LINKED_TASK_UNASSIGNED_KEY } from "./constants";

/**
 * S20-GOAL-LINKEDTASKS-1 — phần THUẦN của tab «Công việc gắn»: sắp xếp (quá hạn lên đầu) và nhóm theo người.
 *
 * «Quá hạn» = cờ `isOverdue` của SERVER (đã tính theo giờ công ty, đã loại Done/Cancelled) — FE không tự
 * suy lại để khỏi lệch với các màn việc khác. Hạn HIỂN THỊ thì quy về ngày theo giờ công ty (không cắt
 * chuỗi UTC: 17:30 UTC ngày 5 là sáng ngày 6 ở giờ công ty).
 */

function dueTime(task: TaskCoreResponseDto): number {
  if (!task.dueAt) return Number.POSITIVE_INFINITY;
  const t = new Date(task.dueAt).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/** Quá hạn đứng đầu; trong mỗi hạng: hạn sớm trước, không hạn cuối. Ổn định, không đổi mảng gốc. */
export function sortLinkedTasks(tasks: readonly TaskCoreResponseDto[]): TaskCoreResponseDto[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const overdue = Number(b.task.isOverdue) - Number(a.task.isOverdue);
      if (overdue !== 0) return overdue;
      const due = dueTime(a.task) - dueTime(b.task);
      if (due !== 0 && !Number.isNaN(due)) return due;
      return a.index - b.index;
    })
    .map((x) => x.task);
}

export interface LinkedTaskGroup {
  readonly key: string;
  /** `null` = nhóm «Chưa giao» (tên hiển thị do UI i18n). */
  readonly assigneeName: string | null;
  readonly tasks: readonly TaskCoreResponseDto[];
  readonly doneCount: number;
  readonly hasOverdue: boolean;
}

/** Nhóm theo người phụ trách: nhóm có việc quá hạn lên đầu, rồi theo tên; «Chưa giao» luôn cuối. */
export function groupLinkedTasksByAssignee(
  tasks: readonly TaskCoreResponseDto[],
): LinkedTaskGroup[] {
  const buckets = new Map<string, TaskCoreResponseDto[]>();
  for (const task of sortLinkedTasks(tasks)) {
    const key = task.mainAssigneeEmployeeId ?? GOAL_LINKED_TASK_UNASSIGNED_KEY;
    buckets.set(key, [...(buckets.get(key) ?? []), task]);
  }
  const groups = [...buckets.entries()].map(([key, items]): LinkedTaskGroup => {
    const first = items[0];
    return {
      key,
      assigneeName: key === GOAL_LINKED_TASK_UNASSIGNED_KEY ? null : (first?.assigneeName ?? null),
      tasks: items,
      doneCount: items.filter((x) => x.status === GOAL_LINKED_TASK_DONE_STATUS).length,
      hasOverdue: items.some((x) => x.isOverdue),
    };
  });
  const rank = (g: LinkedTaskGroup) =>
    g.key === GOAL_LINKED_TASK_UNASSIGNED_KEY ? 2 : g.hasOverdue ? 0 : 1;
  return groups.sort(
    (a, b) => rank(a) - rank(b) || (a.assigneeName ?? "").localeCompare(b.assigneeName ?? "", "vi"),
  );
}

/** `DD/MM/YYYY` của hạn theo giờ công ty; `—` khi không có/hỏng. */
export function formatLinkedTaskDue(dueAt: string | null): string {
  if (!dueAt) return "—";
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return "—";
  const [y, m, d] = localDateOf(date, companyTimeZone()).split("-");
  return `${d}/${m}/${y}`;
}

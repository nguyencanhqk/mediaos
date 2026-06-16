import type { TaskDto } from "@mediaos/contracts";
import { OPEN_TASK_STATUSES } from "./task-constants";

/** True when the task has a due date in the past. `now` is injectable for deterministic tests. */
export function isOverdue(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < now.getTime();
}

/** True when the due date falls on the same calendar day as `now`. */
export function isDueToday(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const d = new Date(dueDate);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Vietnamese-formatted due date, or a "no deadline" placeholder. */
export function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "Không có hạn";
  return new Date(dueDate).toLocaleDateString("vi-VN");
}

/** Counts for the home summary: open tasks, those due today, and those overdue (open only). */
export function summarizeTasks(
  tasks: readonly TaskDto[],
  now: Date = new Date(),
): { open: number; dueToday: number; overdue: number } {
  let open = 0;
  let dueToday = 0;
  let overdue = 0;
  for (const t of tasks) {
    if (!OPEN_TASK_STATUSES.has(t.status)) continue;
    open += 1;
    if (isDueToday(t.dueDate, now)) dueToday += 1;
    if (isOverdue(t.dueDate, now)) overdue += 1;
  }
  return { open, dueToday, overdue };
}

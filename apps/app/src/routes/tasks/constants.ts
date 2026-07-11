/**
 * Hằng quyền module TASK (Project) — S4-FE-TASK-1.
 * Cấu trúc: TASK.RESOURCE.ACTION (SPEC-06 §8 + CLAUDE.md §5 quy ước mã) — dùng với
 * useCan(action, resourceType) qua PERMISSION_CODE_TO_PAIR (registry.ts). KHÔNG so sánh role trực tiếp.
 *
 * Cặp engine (action:resourceType) PIN theo seed THẬT mig 0485 + apps/api/src/tasks/projects.controller.ts
 * (chống pair-drift — bài học s1-fnd-module): read/create/update:project non-sensitive,
 * close/delete/manage-member:project is_sensitive=true (owner-check khi scope < Company ở BE).
 */
export const TASK_ENGINE_PAIRS = {
  READ_PROJECT: { action: "read", resourceType: "project" },
  CREATE_PROJECT: { action: "create", resourceType: "project" },
  UPDATE_PROJECT: { action: "update", resourceType: "project" },
  CLOSE_PROJECT: { action: "close", resourceType: "project" },
  DELETE_PROJECT: { action: "delete", resourceType: "project" },
  MANAGE_MEMBER_PROJECT: { action: "manage-member", resourceType: "project" },
} as const;

/**
 * Cặp engine TASK core (Task, KHÁC Project) — S4-FE-TASK-2 (SPEC-06 §7/§9/§13.5-13.9/§14). PIN theo
 * seed THẬT mig 0485 (task-permissions.const.ts) + apps/api/src/tasks/tasks.controller.ts (chống
 * pair-drift). is_sensitive=true CHỈ delete/export:task + view:task-audit-log (0485 bước (b)) — dùng
 * useCanExact cho DELETE; các cặp còn lại non-sensitive dùng useCan (wildcard fallback OK).
 */
export const TASK_CORE_ENGINE_PAIRS = {
  READ: { action: "read", resourceType: "task" },
  CREATE: { action: "create", resourceType: "task" },
  UPDATE: { action: "update", resourceType: "task" },
  DELETE: { action: "delete", resourceType: "task" },
  ASSIGN: { action: "assign", resourceType: "task" },
  COMMENT: { action: "comment", resourceType: "task" },
  WATCH: { action: "watch", resourceType: "task" },
  UPDATE_STATUS: { action: "update-status", resourceType: "task" },
  UPDATE_PRIORITY: { action: "update-priority", resourceType: "task" },
  UPDATE_DEADLINE: { action: "update-deadline", resourceType: "task" },
  // S4-FE-TASK-3 — Kanban board (view-kanban:task, non-sensitive) + Activity feed
  // (view:task-audit-log, resourceType RIÊNG "task-audit-log", is_sensitive=true — seed 0485).
  VIEW_KANBAN: { action: "view-kanban", resourceType: "task" },
  VIEW_ACTIVITY_LOG: { action: "view", resourceType: "task-audit-log" },
} as const;

export const TASK_CORE_STATUS_OPTIONS = [
  "Todo",
  "In Progress",
  "In Review",
  "Done",
  "Cancelled",
] as const;

export const TASK_CORE_PRIORITY_OPTIONS = ["Low", "Medium", "High", "Urgent"] as const;

/** <input type="datetime-local"> string (giờ LOCAL trình duyệt) → ISO string (offset) cho contract body.
 * Mirror apps/app/src/routes/attendance/adjustment/constants.ts localDatetimeToIso — input datetime-local
 * KHÔNG khớp `.datetime({offset:true})` ISO của contracts (thiếu offset). */
export function localDatetimeToIso(local: string | undefined | null): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** ISO datetime → <input type="datetime-local"> value (giờ LOCAL trình duyệt) cho hiển thị/prefill. */
export function isoToLocalDatetime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

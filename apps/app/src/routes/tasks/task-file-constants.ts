/**
 * Cặp quyền Task File (đính kèm công việc) + báo cáo dự án — S4-FE-TASK-4 (SPEC-06 §16.1, TASK-SCREEN-007).
 *
 * Cặp seed THẬT (migration 0485, apps/api/src/tasks/task-files.controller.ts):
 * ('read'|'file-upload'|'file-delete','task') — non-sensitive (dùng useCan, wildcard fallback OK).
 * Đặt file constant riêng trong thư mục tasks/ (KHÔNG sửa constants.ts — hot-file dùng chung, tránh đụng
 * lane khác) — cùng kỹ thuật EMPLOYEE_FILE_ENGINE_PAIRS ở routes/hr/employees/employee-file-constants.ts.
 *
 * PROJECT_REPORT_PAIR ('view-report','project') — SENSITIVE (is_sensitive=true, seed 0485,
 * projects.controller.ts getReport) — dùng useCanExact fail-closed (mirror EXPORT_EMPLOYEE ở
 * ExportEmployeesButton.tsx), KHÔNG useCan wildcard-aware.
 */
export const TASK_FILE_ENGINE_PAIRS = {
  READ: { action: "read", resourceType: "task" },
  UPLOAD: { action: "file-upload", resourceType: "task" },
  DELETE: { action: "file-delete", resourceType: "task" },
} as const;

export const PROJECT_REPORT_PAIR = { action: "view-report", resourceType: "project" } as const;

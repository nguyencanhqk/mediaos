/**
 * S20-DASH-QUICKACTION-1 — đích điều hướng (`target_url`) của quick action NAVIGATE trên widget dashboard.
 *
 * Nguồn sự thật DÙNG CHUNG hai phía:
 * - API phát đích này trong `quick_actions` (`apps/api/src/dashboard/dashboard-widget-quick-actions.const.ts`);
 * - FE đối chiếu từng đích với cây route THẬT của apps/app (`quick-action-targets.spec.ts`): đường dẫn phải
 *   mở đúng một màn (không rơi vào 404, không bị route tham số nuốt — vd `/tasks/new` thành việc id «new»),
 *   và mọi tham số `?…` phải được `validateSearch` của route đích giữ lại.
 *
 * Thêm/sửa đích = sửa ở đây; test FE đỏ khi đích không khớp route nào.
 */
export const DASH_QUICK_ACTION_TARGET_URLS = {
  /** «Việc của tôi» + ô tạo nhanh có focus (`create` — validateMyTasksSearch). */
  CREATE_TASK: "/tasks/my-tasks?create=1",
  OPEN_MY_TASKS: "/tasks/my-tasks",
  OPEN_TASK_ALERTS: "/tasks/overdue",
  /** Nhóm «Sắp đến hạn» — khoá nhóm thật là `upcoming` (MY_TASK_GROUP_KEYS). */
  OPEN_TASKS_DUE_SOON: "/tasks/my-tasks?group=upcoming",
  OPEN_NOTIFICATIONS: "/notifications",
  /** Màn duyệt mặc định lọc «Chờ duyệt»; route không đọc tham số nào. */
  OPEN_PENDING_LEAVE_APPROVAL: "/leave/approvals",
  OPEN_PROJECT: "/tasks/projects",
  OPEN_HR_DIRECTORY: "/hr/employees",
} as const satisfies Record<string, string>;

export type DashQuickActionNavigateCode = keyof typeof DASH_QUICK_ACTION_TARGET_URLS;

/** Action có `projectScoped` — API nối `/${projectId}` vào đích khi widget có ngữ cảnh dự án. */
export const DASH_QUICK_ACTION_PROJECT_SCOPED_CODES: readonly DashQuickActionNavigateCode[] = [
  "OPEN_PROJECT",
];

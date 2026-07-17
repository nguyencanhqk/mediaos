/**
 * Hằng module ME (SPEC-09) — S5-ME-FE-1.
 *
 * `ME_ACCESS_PAIR` mirror BE `apps/api/src/me/me.constants.ts` (mig 0495: action='access',
 * resourceType='me', non-sensitive) — dùng trong `useCan()` để page tự gate lại (defense-in-depth, mirror
 * `DASH_READ_PAIR`/`DashboardMePage`) — route-level đã gate qua ROUTE_REGISTRY['me.overview'].
 *
 * `ME_QUICK_ACTION_PATHS` — route module gốc ĐÃ build mà Tổng quan ME deep-link tới (§10.1/§12.5). Route
 * đích tự guard/permission lại — ME KHÔNG bypass. Hằng hoá để tránh magic string rải trong component.
 */
export const ME_ACCESS_PAIR = { action: "access", resourceType: "me" } as const;

export const ME_QUICK_ACTION_PATHS = {
  EDIT_PROFILE: "/hr/me",
  CHANGE_PASSWORD: "/account/change-password",
  CHECK_IN_OUT: "/attendance/today",
  // S5-ME-FE-3 — deep-link ME-SCREEN-009 (Chấm công của tôi) tới bảng công đầy đủ (route thật đã build).
  MY_ATTENDANCE_RECORDS: "/attendance/my-records",
  CREATE_LEAVE: "/leave/me/requests/new",
  MY_LEAVE_REQUESTS: "/leave/me/requests",
  MY_TASKS: "/tasks/my-tasks",
  NOTIFICATIONS: "/notifications",
} as const;

/**
 * S5-ME-FE-3 — nhóm loại thông báo cho ME-SCREEN-013 (Tuỳ chọn thông báo, SPEC-09 §10.7). `notification_
 * type` thực tế lưu ở bảng `notification_preferences`/`notification_rules` dùng ENUM CŨ (G10, xem
 * `notificationTypeSchema` @mediaos/contracts) — KHÔNG phải enum TitleCase System/HR/Attendance/Leave/Task
 * hiện tại của bảng `notifications`. Vì enum cũ KHÔNG có type nào thuộc HR/ATT/LEAVE, nhóm dưới đây là ánh
 * xạ HEURISTIC theo ngữ nghĩa tên type SẴN CÓ (task/workflow-era) — KHÔNG khớp 1:1 5 nhóm ví dụ §10.7
 * (Công việc/Nghỉ phép/Chấm công/Hồ sơ/Hệ thống). Ghi rõ để tránh hiểu lầm đây là bug của lane này — hạn
 * chế nằm ở schema, cần BE bổ sung notification_type mới nếu muốn nhóm đúng theo module nguồn.
 */
export const ME_NOTIFICATION_PREFERENCE_GROUPS = [
  {
    groupKey: "task",
    labelKey: "notificationPreferencesPage.groups.task",
    types: ["task_assigned", "task_submitted", "mentioned"],
  },
  {
    groupKey: "approval",
    labelKey: "notificationPreferencesPage.groups.approval",
    types: ["approval_requested", "approved", "revision_requested"],
  },
  {
    groupKey: "collaboration",
    labelKey: "notificationPreferencesPage.groups.collaboration",
    types: ["chat_message", "meeting_invited", "meeting_action_assigned"],
  },
  {
    groupKey: "general",
    labelKey: "notificationPreferencesPage.groups.general",
    types: ["general"],
  },
] as const;

/** Số thông báo gần đây hiển thị preview ở ME-SCREEN-012 (KHÔNG phân trang — xem "Xem tất cả" deep-link). */
export const ME_NOTIFICATIONS_PREVIEW_LIMIT = 5;

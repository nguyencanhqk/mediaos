/**
 * S4-INT-2 — DashboardCacheInvalidationMap: NGUỒN SỰ THẬT cho POST /internal/v1/dashboard/cache/invalidate
 * (event → widget cần invalidate). Naive table nháp ở IMPLEMENTATION-07 §11.5 dùng vài mã KHÔNG có producer
 * thật (TASK_CREATED, ATTENDANCE_CHECKED_IN, ATTENDANCE_CHECKED_OUT, EMPLOYEE_CREATED, CONTRACT_UPDATED) —
 * §11.5 tự ghi chú "chỉ được dùng mã do một producer thực sự phát ra" + trỏ về registry canonical §9.5 (dòng
 * 562-580 cùng doc) TRÙNG 1-1 với foundation/seed/notification-event-catalog.const.ts (NOTI_EVENT_CATALOG,
 * mig 0481+0490 — nguồn build DB thật). File này RECONCILE lại theo đúng registry đó, KHÔNG chép nguyên §11.5.
 *
 * Đối chiếu real-producer (grep eventCode: trong service — 2026-07-12):
 *   TASK_ASSIGNED, TASK_ASSIGNEE_CHANGED  — task-actions.service.ts (outbox eventType task.assigned,
 *                                            task.assignee_changed) → TaskNotiBridgeRegistrar → engine.intake.
 *   TASK_STATUS_CHANGED                   — task-actions.service.ts (task.status_changed).
 *   TASK_DUE_DATE_CHANGED                 — task-actions.service.ts (task.due_date_changed).
 *   TASK_DUE_SOON, TASK_OVERDUE           — task-reminder.job-handler.ts (intake trực tiếp, job quét due date).
 *   LEAVE_REQUEST_SUBMITTED               — leave-request.service.ts line 508.
 *   LEAVE_REQUEST_APPROVED                — leave-approval.service.ts line 188.
 *   LEAVE_REQUEST_REJECTED                — leave-approval.service.ts line 264.
 *   LEAVE_REQUEST_CANCELLED               — leave-request.service.ts line 351, leave-revoke.service.ts line 95.
 *   LEAVE_REQUEST_REVOKED                 — leave-revoke.service.ts line 136.
 *
 * LOẠI KHỎI bảng (không có producer thật, đối chiếu registry + grep 2026-07-12 — ghi rõ theo yêu cầu Đội 3):
 *   - TASK_CREATED: KHÔNG có trong NOTI_EVENT_CATALOG lẫn không producer nào emit — §11.5 tự ghi chú thay
 *     bằng TASK_ASSIGNED (đã làm ở đây).
 *   - ATTENDANCE_CHECKED_IN, ATTENDANCE_CHECKED_OUT: ATT module CHỈ emit outbox eventType nội bộ
 *     attendance.checked_in, attendance.checked_out (attendance.service.ts) — đây là outbox eventType cho
 *     LEAVE-ATT sync/audit, KHÔNG có eventCode NOTI tương ứng trong registry (ATT chỉ có các mã bắt đầu bằng
 *     ATT_MISSING_CHECKOUT, ATT_LATE_DETECTED, ATT_ABSENT_DETECTED, ATT_ADJUSTMENT_, ATT_AUTO_ATTENDANCE_
 *     CREATED, ATT_REMOTE_REQUEST_). KHÔNG bịa mã mới ở lane này (out of scope DB/registry) ⇒ loại khỏi bảng.
 *   - EMPLOYEE_CREATED, CONTRACT_UPDATED: thuộc HR — WO S4-INT-2 chỉ trong phạm vi TASK/NOTI/ATT/LEAVE.
 *   - NOTIFICATION_CREATED, NOTIFICATION_READ: GIỮ (yêu cầu Đội 3, có trong registry SPEC §9.5 dòng 578-579
 *     "NOTI tự phát khi tạo notification"/"mark read") NHƯNG hiện CHƯA có lệnh emit thật trong module
 *     notifications (notification-engine.service.ts, my-notifications.service.ts) — wiring producer nằm
 *     NGOÀI paths lane này (apps/api/src/dashboard, apps/api/src/events, apps/api/test/integration). Map vẫn
 *     nhận 2 mã này làm input HỢP LỆ cho endpoint (đúng contract Đội 3 chốt) — VIỆC CÒN NỢ: wire NOTI producer
 *     gọi endpoint này (hoặc outbox eventType tương ứng) ở lane module notifications kế tiếp.
 *
 * Widget đích PHẢI có trong catalog ĐÃ SEED (DASH_WIDGET_CATALOG, dashboard-widget-catalog.const.ts) — KHÔNG
 * trỏ tới widget DASH_WIDGETS_NOT_SEEDED (TEAM_TASKS_TODAY, CONFIG_WARNINGS).
 */
export const DASH_CACHE_INVALIDATION_MAP: Readonly<Record<string, readonly string[]>> = {
  // ── TASK (task-actions.service.ts + task-reminder job — real producer) ──────────────────────────────
  TASK_ASSIGNED: ["MY_TASKS", "TASK_ALERTS"],
  TASK_ASSIGNEE_CHANGED: ["MY_TASKS", "TASK_ALERTS"],
  TASK_STATUS_CHANGED: ["MY_TASKS", "TASK_ALERTS", "PROJECT_PROGRESS"],
  TASK_DUE_DATE_CHANGED: ["TASK_ALERTS", "MY_TASKS"],
  TASK_DUE_SOON: ["TASK_ALERTS"],
  TASK_OVERDUE: ["TASK_ALERTS"],
  // ── NOTI (registry §9.5 — producer wiring HOÃN, xem doc-block trên) ─────────────────────────────────
  NOTIFICATION_CREATED: ["NOTIFICATIONS"],
  NOTIFICATION_READ: ["NOTIFICATIONS"],
  // ── LEAVE (leave-request/leave-approval/leave-revoke service — real producer) ───────────────────────
  LEAVE_REQUEST_SUBMITTED: ["PENDING_LEAVE", "LEAVE_CALENDAR"],
  LEAVE_REQUEST_APPROVED: ["PENDING_LEAVE", "LEAVE_CALENDAR", "LEAVE_BALANCE", "ATTENDANCE_TODAY"],
  LEAVE_REQUEST_REJECTED: ["PENDING_LEAVE"],
  LEAVE_REQUEST_CANCELLED: ["PENDING_LEAVE", "LEAVE_CALENDAR"],
  LEAVE_REQUEST_REVOKED: ["PENDING_LEAVE", "LEAVE_CALENDAR", "LEAVE_BALANCE", "ATTENDANCE_TODAY"],
} as const;

/** eventCode hợp lệ (khớp registry, có mapping widget) — dùng để reject mã lạ TRƯỚC khi đụng DB. */
export function widgetsForInvalidationEvent(eventCode: string): readonly string[] | undefined {
  return DASH_CACHE_INVALIDATION_MAP[eventCode];
}

export const DASH_CACHE_INVALIDATE_ERR = {
  /** eventCode KHÔNG nằm trong DASH_CACHE_INVALIDATION_MAP (registry §9.5 reconciled) → 400 (loud, KHÔNG no-op-200). */
  UNKNOWN_EVENT: "DASH-ERR-UNKNOWN_INVALIDATION_EVENT",
} as const;

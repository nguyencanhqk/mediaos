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
 *   ATT_ADJUSTMENT_APPROVED                — attendance-adjustment.apply.ts:186-194 (`emitAdjustmentApproved`,
 *                                            outbox eventType attendance.adjustment_approved) — GHI THẬT
 *                                            attendance_records (audit "AttendanceRecordAdjusted" cùng hàm,
 *                                            payload có `userId`) ⇒ MAP ATTENDANCE_TODAY (đây là fix nhánh ATT
 *                                            của lane FIX, Đội 3 finding #1).
 *
 * S4-INT-2-FIX-ATT — Đối chiếu ĐẦY ĐỦ 11 mã ATT_* đang `isEnabled:true` trong NOTI_EVENT_CATALOG
 * (foundation/seed/notification-event-catalog.const.ts dòng 69-79, grep 2026-07-12) — map hoặc loại, MỖI mã
 * kèm lý do cụ thể (không chỉ dừng ở ATTENDANCE_CHECKED_IN/OUT như audit trước):
 *   - ATT_ADJUSTMENT_APPROVED    → MAP (xem trên).
 *   - ATT_ADJUSTMENT_SUBMITTED   → LOẠI. Producer thật: attendance-adjustment.apply.ts:153
 *     (`emitAdjustmentRequested`, eventType attendance.adjustment_requested) NHƯNG chỉ tạo request Pending —
 *     KHÔNG ghi attendance_records nào (chỉ audit "AttendanceAdjustmentRequested" + insert
 *     attendance_adjustment_requests). Không có widget "pending adjustment" nào trong DASH_WIDGET_CATALOG để
 *     trỏ tới ⇒ không có gì để invalidate.
 *   - ATT_ADJUSTMENT_REJECTED    → LOẠI. Producer thật: attendance-adjustment.service.ts:376-379 (`reject()`,
 *     eventType attendance.adjustment_rejected) NHƯNG chỉ UPDATE attendance_adjustment_requests.status —
 *     KHÔNG đụng attendance_records (không gọi applyToRecord/emitRecordAdjustedDirect). Không có dữ liệu
 *     ATTENDANCE_TODAY nào thay đổi ⇒ không map (khác ATT_ADJUSTMENT_APPROVED — approve MỚI ghi record).
 *   - ATT_AUTO_ATTENDANCE_CREATED → LOẠI. KHÔNG có producer nào emit mã/eventType này (grep toàn
 *     apps/api/src xác nhận 2026-07-12) — "AutoAttendance"/"auto_attendance" trong code CHỈ là cấu hình
 *     (attendance_mode CHECK constraint + policy.autoAttendanceEnabled flag), KHÔNG có job/service nào tạo
 *     bản ghi rồi phát event. VIỆC CÒN NỢ: cần job auto-attendance thật trước khi wire được.
 *   - ATT_MISSING_CHECKOUT, ATT_LATE_DETECTED, ATT_ABSENT_DETECTED → LOẠI (cả 3). KHÔNG có producer nào
 *     (không outbox.enqueue, không job-handler gọi intake trực tiếp kiểu task-reminder.job-handler.ts — grep
 *     toàn attendance/** xác nhận 2026-07-12, không có file *job* nào trong module ATT). Đích tự nhiên (nếu có
 *     producer sau này) là widget ATTENDANCE_ALERTS (đã seed, dashboard-widget-handlers.service.ts:215 filter
 *     Late/Absent/Missing) — VIỆC CÒN NỢ: cần detector job phát 3 mã này trước khi wire.
 *   - ATT_REMOTE_REQUEST_SUBMITTED → LOẠI. Producer thật: remote-work-request.service.ts:214-215 (`submit()`)
 *     NHƯNG chỉ chuyển request Draft→Pending — KHÔNG ghi attendance_records (applyCalcAffect chỉ chạy ở
 *     approve()). Không có widget đích ⇒ loại.
 *   - ATT_REMOTE_REQUEST_APPROVED → LOẠI (có ghi nợ). Producer thật: remote-work-request.service.ts:361-362
 *     (`approve()`) GỌI `applyCalcAffect()` → `upsertRemoteAffectedRecordTx` GHI THẬT attendance_records cho
 *     từng ngày trong [startDate,endDate] — cùng phạm vi ảnh hưởng widget ATTENDANCE_TODAY như
 *     ATT_ADJUSTMENT_APPROVED. KHÔNG map được ở lane này vì payload outbox
 *     `{requestId, employeeId, approvedBy}` KHÔNG có field `userId` (chỉ `employeeId`) — registrar
 *     (dashboard-cache-invalidation.registrar.ts) đọc userId THẲNG từ payload, KHÔNG tra DB employeeId→userId
 *     (chủ đích, mirror TASK/LEAVE, tránh audience-reader query thêm). Sửa payload thêm `userId` đụng
 *     apps/api/src/attendance/** — NGOÀI paths lane này. VIỆC CÒN NỢ cho lane sau: (a) thêm `userId` vào
 *     payload attendance.remote_request_approved (producer, lane khác), (b) sau đó map ATT_REMOTE_REQUEST_
 *     APPROVED → ATTENDANCE_TODAY + đăng ký registrar mapping `userIdsOf: p => pickUserIds(p,'userId')`.
 *   - ATT_REMOTE_REQUEST_REJECTED, ATT_REMOTE_REQUEST_CANCELLED → LOẠI (cả 2). reject() chỉ UPDATE status
 *     (remote-work-request.service.ts:453-454, KHÔNG applyCalcAffect). cancelOwn() chỉ cho phép huỷ khi status
 *     Draft/Pending (`isCancellable()`, remote-work-request.logic.ts:38-40 — KHÔNG BAO GIỜ Approved), nên
 *     KHÔNG có attendance_records nào cần revert. Cả 2 KHÔNG đụng attendance_records ⇒ loại.
 *   (2 mã ATT_CHECKIN_REMINDER/ATT_CHECKOUT_REMINDER isEnabled:false trong catalog — ngoài phạm vi đối chiếu
 *   này theo định nghĩa WO "đang isEnabled".)
 *
 * Quyết định đầy đủ (kể cả các mã đã đúng từ trước) LƯU SONG SONG ở docs/plans/S4-INT-2.md — theo yêu cầu Đội
 * 3 "ghi rõ trong plan" (không chỉ code comment).
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
 *   - NOTIFICATION_CREATED, NOTIFICATION_READ: GIỮ (yêu cầu Đội 3) — SỬA LẠI (Đội 3 finding #3, 2026-07-12).
 *     (1) 2 mã này KHÔNG có trong NOTI_EVENT_CATALOG THẬT (foundation/seed/notification-event-catalog.const.ts,
 *     nguồn build DB) — CHỈ tồn tại ở bảng NHÁP IMPLEMENTATION-07 §9.5, CHƯA sync vào seed. Ghi chú cũ "có
 *     trong registry SPEC §9.5" là SAI (lẫn bảng nháp doc với catalog thật).
 *     (2) NOTIFICATION_CREATED: notifications.service.ts:137 (module legacy, KHÔNG phải my-notifications/
 *     notification-engine) CÓ `outbox.enqueue(eventType:'notification.created')` THẬT — nhưng MỒ CÔI (0
 *     consumer đăng ký nghe eventType này, grep xác nhận 2026-07-12) nên KHÔNG đổi kết luận wiring. Ghi chú
 *     cũ "hiện CHƯA có lệnh emit thật" là SAI (có emit, chỉ là không ai nghe).
 *     (3) NOTIFICATION_READ (mark-read): my-notifications.service.ts KHÔNG enqueue outbox nào — 0 producer
 *     thật, đúng như ghi chú cũ. Map vẫn
 *     nhận 2 mã này làm input HỢP LỆ cho endpoint (đúng contract Đội 3 chốt) — VIỆC CÒN NỢ (ngoài paths lane
 *     này): (a) sync catalog thật cho 2 eventCode; (b) đăng ký consumer nghe 'notification.created' (module
 *     notifications, KHÔNG phải dashboard); (c) thêm outbox.enqueue cho mark-read trước khi wire được.
 *
 *   - TASK_DUE_SOON, TASK_OVERDUE: dù CÓ producer thật (task-reminder.job-handler.ts, xem trên) NHƯNG job gọi
 *     `NotificationEngineService.intake()` TRỰC TIẾP trong-process — KHÔNG qua `outbox.enqueue` — nên KHÔNG có
 *     eventType nào phát lên EventBus để `dashboard-cache-invalidation.registrar.ts` đăng ký consumer (registrar
 *     chỉ nghe được outbox eventType thật). VIỆC CÒN NỢ (ngoài paths lane này): sửa `task-reminder.job-handler.
 *     ts` gọi thêm `DashboardCacheInvalidationService.invalidate()` trực tiếp, HOẶC đổi job sang outbox.enqueue
 *     trước khi wire được qua EventBus. Map dưới GIỮ 2 mã này (endpoint vẫn hợp lệ khi gọi tay/HTTP nội bộ) —
 *     chỉ KHÔNG có đường tự động từ job.
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
  // ── ATT (attendance-adjustment.apply.ts emitAdjustmentApproved — real producer, ghi attendance_records) ──
  ATT_ADJUSTMENT_APPROVED: ["ATTENDANCE_TODAY"],
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

/**
 * S4-INT-2-FIX-1 (Đội 3 finding #4) — widget mà cache LUÔN per-user (shareScope='user' KHÔNG ĐIỀU KIỆN, đối
 * chiếu `dashboard-widget-handlers.service.ts`: mọi widget dưới đây route qua `gateSelf()` → `ownIdentity()`
 * (MY_TASKS/TASK_ALERTS/NOTIFICATIONS/PENDING_LEAVE/LEAVE_BALANCE/LEAVE_CALENDAR/ATTENDANCE_TODAY) hoặc
 * `gateProjectProgress()` (PROJECT_PROGRESS) — CẢ 2 luôn trả `shareScope:'user'`, KHÔNG BAO GIỜ sinh hàng
 * cache company-shared (`user_id IS NULL`) cho các widget này — kiểm 2026-07-12).
 *
 * RAIL chống blanket-wipe: DashboardWidgetCacheService.invalidateByWidgetId SKIP (trả 0, KHÔNG UPDATE) khi
 * widget thuộc set này mà `userIds` rỗng/thiếu, thay vì xoá TOÀN BỘ cache active của widget trong company
 * (tương đương xoá cache riêng của MỌI user chỉ vì 1 event chỉ ảnh hưởng 1-2 người) — vi phạm tinh thần
 * "không invalidate cache user khác ngoài phạm vi event". Widget KHÔNG có trong set này (company-shared, vd
 * HR_OVERVIEW khi scope=Company/System) vẫn giữ nguyên hành vi blanket-wipe khi userIds vắng (đúng thiết kế —
 * cache đó vốn CHIA SẺ chung, không thuộc về 1 user cụ thể).
 */
export const DASH_PER_USER_ONLY_WIDGET_CODES: ReadonlySet<string> = new Set([
  "MY_TASKS",
  "TASK_ALERTS",
  "NOTIFICATIONS",
  "PENDING_LEAVE",
  "LEAVE_CALENDAR",
  "LEAVE_BALANCE",
  "PROJECT_PROGRESS",
  "ATTENDANCE_TODAY",
]);

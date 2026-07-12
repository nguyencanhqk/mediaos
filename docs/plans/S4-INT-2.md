# Plan S4-INT-2 — DASH cache invalidate từ event TASK/NOTI/ATT/LEAVE (§11.5 reconciled)

> Zone LIGHT gate (cache invalidate, KHÔNG đụng permission/RLS/secret/schema). Zero-migration.
> Trạng thái: implement + verify xong trong lane `S4-INT-2` (worktree `../mediaos-s4-int-2`, branch `auto/S4-INT-2`).
> Vòng FIX-ATT (2026-07-12): đóng gap Đội 3 tìm thấy — nhánh ATT của reconcile chưa phủ hết registry §9.5.

## 1. Phạm vi

`POST /internal/v1/dashboard/cache/invalidate` (endpoint nội bộ, trust-boundary Bearer + `x-internal-key`) +
`DashboardCacheInvalidationRegistrar` (`OnModuleInit`, đăng ký consumer lên `EventBus` — event THẬT tự
invalidate, không cần gọi tay endpoint). Nguồn sự thật mapping = `DASH_CACHE_INVALIDATION_MAP`
(`apps/api/src/dashboard/dashboard-cache-invalidation.const.ts`) — **RECONCILE lại** bảng nháp §11.5
(IMPLEMENTATION-07) theo registry canonical §9.5 (`NOTI_EVENT_CATALOG`,
`foundation/seed/notification-event-catalog.const.ts`), **CHỈ dùng mã có producer thật** (outbox.enqueue thật
+ có ảnh hưởng dữ liệu widget đích).

## 2. Quyết định map/loại — ĐẦY ĐỦ (mọi mã đã đối chiếu, không chỉ nhánh mới sửa)

### TASK (task-actions.service.ts + task-reminder.job-handler.ts)

| eventCode | Quyết định | Lý do |
| --- | --- | --- |
| TASK_ASSIGNED | MAP → MY_TASKS, TASK_ALERTS | outbox `task.assigned` thật, payload có `assigneeUserId`. |
| TASK_ASSIGNEE_CHANGED | MAP → MY_TASKS, TASK_ALERTS | outbox `task.assignee_changed` thật. |
| TASK_STATUS_CHANGED | MAP → MY_TASKS, TASK_ALERTS, PROJECT_PROGRESS | outbox `task.status_changed` thật. |
| TASK_DUE_DATE_CHANGED | MAP → TASK_ALERTS, MY_TASKS | outbox `task.due_date_changed` thật. |
| TASK_DUE_SOON, TASK_OVERDUE | MAP (map giữ, KHÔNG có wire tự động qua registrar) → TASK_ALERTS | producer thật (`task-reminder.job-handler.ts`) nhưng gọi `NotificationEngineService.intake()` TRỰC TIẾP, KHÔNG qua `outbox.enqueue` ⇒ KHÔNG có eventType lên `EventBus` để registrar nghe. Endpoint vẫn nhận mã này khi gọi tay/HTTP nội bộ. VIỆC CÒN NỢ: sửa job-handler gọi thêm `DashboardCacheInvalidationService.invalidate()` trực tiếp, hoặc đổi job sang outbox. |
| TASK_CREATED | LOẠI | KHÔNG có trong `NOTI_EVENT_CATALOG`, KHÔNG producer nào emit — §11.5 tự ghi chú thay bằng TASK_ASSIGNED. |

### NOTI

| eventCode | Quyết định | Lý do |
| --- | --- | --- |
| NOTIFICATION_CREATED | MAP (giữ, wiring HOÃN) → NOTIFICATIONS | Endpoint nhận mã hợp lệ. `notifications.service.ts:137` (module LEGACY, không phải notification-engine) CÓ `outbox.enqueue('notification.created')` thật nhưng MỒ CÔI (0 consumer đăng ký nghe) — registrar KHÔNG wire tự động. |
| NOTIFICATION_READ | MAP (giữ, wiring HOÃN) → NOTIFICATIONS | `my-notifications.service.ts` (mark-read) KHÔNG enqueue outbox nào — 0 producer thật. Endpoint vẫn nhận mã (contract), không có đường tự động. |

VIỆC CÒN NỢ (NOTI, ngoài phạm vi lane): (a) sync catalog thật cho 2 mã trên nếu cần; (b) đăng ký consumer nghe
`notification.created` (module `notifications`, KHÔNG phải `dashboard`); (c) thêm `outbox.enqueue` cho
mark-read trước khi wire registrar được.

### LEAVE (leave-request/leave-approval/leave-revoke.service.ts)

| eventCode | Quyết định | Lý do |
| --- | --- | --- |
| LEAVE_REQUEST_SUBMITTED | MAP → PENDING_LEAVE, LEAVE_CALENDAR | outbox `leave.request.submitted` thật. |
| LEAVE_REQUEST_APPROVED | MAP → PENDING_LEAVE, LEAVE_CALENDAR, LEAVE_BALANCE, ATTENDANCE_TODAY | outbox `leave.request.approved` thật, đổi số dư + ghi nhận nghỉ vào ngày công. |
| LEAVE_REQUEST_REJECTED | MAP → PENDING_LEAVE | outbox `leave.request.rejected` thật. |
| LEAVE_REQUEST_CANCELLED | MAP → PENDING_LEAVE, LEAVE_CALENDAR | outbox `leave.request.cancelled` thật. |
| LEAVE_REQUEST_REVOKED | MAP → PENDING_LEAVE, LEAVE_CALENDAR, LEAVE_BALANCE, ATTENDANCE_TODAY | outbox `leave.request.revoked` thật. |

Giới hạn đã biết (PENDING_LEAVE/LEAVE_CALENDAR): cache 2 widget này keyed theo VIEWER (approver/HR xem lịch
team), nhưng payload LEAVE_* chỉ có `userId` = người XIN nghỉ. Registrar dùng payload trực tiếp (không
audience-resolver) ⇒ lời gọi invalidate ở registrar thường 0 rows cho 2 widget này (harmless, rail
`DASH_PER_USER_ONLY_WIDGET_CODES` chặn thêm nếu rỗng) — cache approver tự làm mới theo TTL. VIỆC CÒN NỢ: cần
resolver audience đầy đủ (mọi approver/HR/CA có quyền xem) ngoài phạm vi lane.

### ATT — đối chiếu ĐẦY ĐỦ 11 mã `isEnabled:true` (NOTI_EVENT_CATALOG dòng 69-79) — vòng FIX-ATT 2026-07-12

| eventCode | Quyết định | Lý do |
| --- | --- | --- |
| ATT_ADJUSTMENT_APPROVED | **MAP** → ATTENDANCE_TODAY | `attendance-adjustment.apply.ts:186-194` (`emitAdjustmentApproved`) — outbox `attendance.adjustment_approved` THẬT, payload có `userId`, ghi THẬT `attendance_records` (audit `AttendanceRecordAdjusted` cùng hàm). Đúng phạm vi widget self-locked ATTENDANCE_TODAY. Registrar mapping thêm (`dash-cache-invalidate:attendance.adjustment_approved`). |
| ATT_ADJUSTMENT_SUBMITTED | LOẠI | Producer thật (`attendance-adjustment.apply.ts:153`, `attendance.adjustment_requested`) nhưng chỉ tạo request Pending — KHÔNG ghi `attendance_records`. Không có widget "pending adjustment" trong catalog để trỏ tới. |
| ATT_ADJUSTMENT_REJECTED | LOẠI | Producer thật (`attendance-adjustment.service.ts:376-379`, `reject()`) nhưng chỉ UPDATE status request — KHÔNG gọi `applyToRecord`/`emitRecordAdjustedDirect` ⇒ KHÔNG đụng `attendance_records`. |
| ATT_AUTO_ATTENDANCE_CREATED | LOẠI | KHÔNG có producer nào emit (grep toàn `apps/api/src` xác nhận) — "AutoAttendance" trong code chỉ là cấu hình (`attendance_mode` CHECK + `autoAttendanceEnabled` policy flag), không có job/service tạo bản ghi rồi phát event. VIỆC CÒN NỢ: cần job auto-attendance thật. |
| ATT_MISSING_CHECKOUT | LOẠI | KHÔNG có producer (không outbox, không job-handler kiểu `task-reminder.job-handler.ts`) — module ATT không có file `*job*` nào. Đích tự nhiên (nếu có producer sau) = widget `ATTENDANCE_ALERTS` (đã seed, filter Late/Absent/Missing). VIỆC CÒN NỢ: cần detector job. |
| ATT_LATE_DETECTED | LOẠI | Như trên — KHÔNG có producer. |
| ATT_ABSENT_DETECTED | LOẠI | Như trên — KHÔNG có producer. |
| ATT_REMOTE_REQUEST_SUBMITTED | LOẠI | Producer thật (`remote-work-request.service.ts:214-215`, `submit()`) nhưng chỉ chuyển Draft→Pending — `applyCalcAffect()` (ghi attendance_records) CHỈ chạy ở `approve()`. Không có widget đích cho trạng thái Pending. |
| ATT_REMOTE_REQUEST_APPROVED | LOẠI (có nợ) | Producer thật (`remote-work-request.service.ts:361-362`, `approve()`) GỌI `applyCalcAffect()` → `upsertRemoteAffectedRecordTx` GHI THẬT `attendance_records` — cùng phạm vi ảnh hưởng ATTENDANCE_TODAY như ATT_ADJUSTMENT_APPROVED. **KHÔNG map được ở lane này** vì payload outbox `{requestId, employeeId, approvedBy}` KHÔNG có field `userId` (chỉ `employeeId`) — registrar đọc userId THẲNG từ payload (chủ đích, tránh audience-reader query DB thêm, mirror TASK/LEAVE). Sửa payload đụng `apps/api/src/attendance/**` — NGOÀI paths lane. VIỆC CÒN NỢ: (a) thêm `userId` vào payload `attendance.remote_request_approved` (lane khác, đụng producer); (b) map ATT_REMOTE_REQUEST_APPROVED → ATTENDANCE_TODAY + đăng ký registrar `userIdsOf: p => pickUserIds(p,'userId')`. |
| ATT_REMOTE_REQUEST_REJECTED | LOẠI | `reject()` chỉ UPDATE status (không `applyCalcAffect`) — KHÔNG đụng `attendance_records`. |
| ATT_REMOTE_REQUEST_CANCELLED | LOẠI | `cancelOwn()` chỉ cho phép huỷ khi status Draft/Pending (`isCancellable()`) — KHÔNG BAO GIỜ Approved, nên không có `attendance_records` nào cần revert. |
| ATT_CHECKIN_REMINDER, ATT_CHECKOUT_REMINDER | Ngoài phạm vi đối chiếu | `isEnabled:false` trong catalog — WO chỉ yêu cầu đối chiếu mã đang `isEnabled`. |

Ngoài registry §9.5, ATT module còn phát 2 outbox eventType KHÔNG có eventCode NOTI tương ứng:
`attendance.checked_in`, `attendance.checked_out` (`attendance.service.ts`) — dùng nội bộ cho LEAVE-ATT
sync/audit, KHÔNG map tới eventCode nào trong catalog ⇒ endpoint vẫn từ chối (`ATTENDANCE_CHECKED_IN`/`_OUT`
→ 400 UNKNOWN_EVENT, test giữ nguyên).

### HR (ngoài phạm vi WO)

`EMPLOYEE_CREATED`, `CONTRACT_UPDATED` — LOẠI, thuộc module HR, WO S4-INT-2 chỉ trong phạm vi TASK/NOTI/ATT/LEAVE.

## 3. Registrar (wiring THẬT qua EventBus, KHÔNG cần gọi tay endpoint)

10 consumer đăng ký `OnModuleInit` (`DashboardCacheInvalidationRegistrar`), mỗi consumer 1 outbox `eventType`
thật → `DashboardCacheInvalidationService.invalidate(companyId, eventCode, userIds)`. Boot-guard fail-loud nếu
`eventCode` wire nhầm không có trong `DASH_CACHE_INVALIDATION_MAP`. `userIds` đọc THẲNG từ payload producer
(KHÔNG audience-reader/DB lookup thêm — giữ registrar nhẹ, mirror `TaskNotiBridgeRegistrar` chỉ ở phần
KHÔNG cần resolver).

Rail chống blanket-wipe (`DASH_PER_USER_ONLY_WIDGET_CODES`): widget luôn `shareScope:'user'`
(MY_TASKS/TASK_ALERTS/NOTIFICATIONS/PENDING_LEAVE/LEAVE_CALENDAR/LEAVE_BALANCE/PROJECT_PROGRESS/ATTENDANCE_TODAY)
mà `userIds` rỗng/thiếu → SKIP (0 rows), KHÔNG xoá toàn bộ cache active của widget trong company.

## 4. Test — `apps/api/test/integration/dashboard-cache-invalidate.int-spec.ts`

Describe 1 (contract endpoint, supertest POST trực tiếp): trust-boundary (401/403 fail-closed) · unknown-event
400 (gồm cả mã CÓ producer nhưng bị loại có lý do, vd `ATT_ADJUSTMENT_REJECTED`) · company-mismatch 400 ·
happy-path mapping đúng bảng §2 (thêm `ATT_ADJUSTMENT_APPROVED → ATTENDANCE_TODAY`) · userIds scoping · cross-
tenant · rail per-user-only SKIP.

Describe 2 (wiring thật, event → OutboxWorker claim → registrar consumer → invalidate DB thật): TASK_ASSIGNED
qua `POST /tasks/:id/assign` thật · TASK_STATUS_CHANGED qua `POST /tasks/:id/change-status` thật · LEAVE +
ATT mirror payload producer thật qua `outbox_events` insert trực tiếp (producer nằm ngoài paths lane) rồi
drain qua CÙNG `OutboxWorker.processBatch()`. ATT_ADJUSTMENT_APPROVED thêm assert cross-tenant tường minh
(company khác cùng widget/userId vẫn KHÔNG đụng).

## 5. Việc còn nợ (ngoài phạm vi lane này — liệt kê lại cho rõ)

- TASK_DUE_SOON/TASK_OVERDUE: chưa có đường tự động qua EventBus (job gọi intake trực tiếp, không outbox).
- NOTIFICATION_CREATED/READ: chưa sync catalog thật + chưa có consumer/producer đầy đủ.
- LEAVE PENDING_LEAVE/LEAVE_CALENDAR: audience-resolver cho approver/HR/CA (hiện dùng payload requester).
- ATT_REMOTE_REQUEST_APPROVED: producer ghi attendance_records thật nhưng payload thiếu `userId` — cần lane
  khác sửa `remote-work-request.service.ts` (đụng `apps/api/src/attendance/**`, ngoài paths lane này) trước
  khi map được.
- ATT_MISSING_CHECKOUT/ATT_LATE_DETECTED/ATT_ABSENT_DETECTED/ATT_AUTO_ATTENDANCE_CREATED: chưa có producer
  nào (detector/job) — cần xây trước khi có gì để wire.

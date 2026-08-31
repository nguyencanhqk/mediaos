/**
 * S4-NOTI-SEED-1 — NGUỒN SỰ THẬT (registry) cho danh mục NOTI: event-catalog + template-contract +
 * 7 cặp quyền (read:notification + 6 config) + ma trận role→data_scope.
 *
 * File này là bản khai báo TĨNH (không chạm DB) mà migration 0481_s4_notiseed1_event_template_perms.sql
 * PHẢI khớp 1-1. Test noti-seed-catalog-permissions.int-spec.ts dùng nó làm mốc: catalog DB == registry
 * (thiếu-mã ĐỎ, thừa-mã ĐỎ), is_enabled đúng từng mã, template coverage cho mọi event enabled, và grant
 * đúng ma trận. Tránh drift đã gặp ở S1-FND-MODULE / S3-FE pair-drift (FE/BE/seed lệch cặp engine).
 *
 * Nguồn: UNION DB-07 §14.1 (tập seed MVP — is_enabled=true) ∪ SPEC-08 §15.1–15.6 (danh mục event đầy đủ —
 * phần dư is_enabled=false) + DB-02 §9.7 (6 cặp quyền NOTI config, is_sensitive=true). Khi DB-07 vs SPEC-08
 * mâu thuẫn SYSTEM_* → docs/DB thắng (CLAUDE.md §1): tập enabled = DB-07 §14.1; UNION KHÔNG bỏ mã nào.
 *   event_code VERBATIM: TASK_MENTIONED + TASK_COMMENT_CREATED (KHÔNG TASK_COMMENT_MENTIONED).
 */

/** module_code hợp lệ (CHECK chk_notification_events_module_code — 0479 + 'GOAL' 0507 + 'LMS' 0529 + 'CHAT' 0538 + 'ASSET' 0551 + 'ROOM' 0555 + 'RECRUIT' 0561). */
export type NotiModuleCode =
  | "AUTH"
  | "HR"
  | "ATT"
  | "LEAVE"
  | "TASK"
  | "DASH"
  | "NOTI"
  | "SYSTEM"
  | "GOAL"
  | "LMS"
  | "CHAT"
  | "ASSET"
  | "ROOM"
  | "RECRUIT";

/** notification_type hợp lệ (CHECK chk_notification_events_type — 0479 + 'Goal' 0507 + 'Training' 0529 + 'Chat' 0538 + 'Asset' 0551 + 'Room' 0555 + 'Recruit' 0561). */
export type NotiType =
  | "System"
  | "Account"
  | "HR"
  | "Attendance"
  | "Leave"
  | "Task"
  | "Project"
  | "Approval"
  | "Reminder"
  | "Warning"
  | "Error"
  | "Goal"
  | "Training"
  | "Chat"
  | "Asset"
  | "Room"
  | "Recruit";

/** default_priority hợp lệ (CHECK chk_notification_events_priority — 0479). */
export type NotiPriority = "Low" | "Normal" | "High" | "Urgent" | "Critical";

/** data_scope §13 (permission engine). */
export type NotiScope = "Own" | "Team" | "Department" | "Company" | "System";

/** Role canonical (system role, company_id NULL) được enumerate trong seed 0481. super-admin KHÔNG có
 *  (company-scoped, nhận qua SuperAdminBootstrap runtime — KHÔNG enumerate ở migration). */
export type NotiRoleSlug = "employee" | "manager" | "hr" | "company-admin";

/** 1 event trong danh mục notification_events GLOBAL (company_id NULL). */
export interface NotiEventCatalogEntry {
  readonly module: NotiModuleCode;
  readonly eventCode: string;
  readonly type: NotiType;
  readonly priority: NotiPriority;
  /** MVP set (DB-07 §14.1) = true; phần dư SPEC-08 §15 = false (giữ trong catalog, chưa bật). */
  readonly isEnabled: boolean;
  /** SYSTEM/DASH-widget = true (is_system_event). */
  readonly isSystemEvent: boolean;
}

/**
 * UNION danh mục event (59 mã). ĐỒNG BỘ 1-1 với migration 0481 bước (1) ∪ 0490 (S4-NOTI-SEED-2) ∪ 0507
 * (S5-GOAL-DB-1: GOAL_ASSIGNED + GOAL_FINALIZED) ∪ 0529 (S5-LMS-NOTI-1: 4 mã LMS_*). Thứ tự nhóm theo
 * module để dễ đối chiếu; test so SÁNH THEO TẬP (set), không theo thứ tự.
 */
export const NOTI_EVENT_CATALOG: readonly NotiEventCatalogEntry[] = [
  // ===== MVP set (DB-07 §14.1) ∪ TASK BE-3 canonical (0490) ∪ GOAL (0507) ∪ LMS (0529) — isEnabled = true (45 mã) =====
  { module: "AUTH", eventCode: "AUTH_USER_CREATED", type: "Account", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "AUTH", eventCode: "AUTH_USER_LOCKED", type: "Account", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "AUTH", eventCode: "AUTH_PASSWORD_RESET_REQUESTED", type: "Account", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_EMPLOYEE_CREATED", type: "HR", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_PROFILE_CHANGE_SUBMITTED", type: "Approval", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_PROFILE_CHANGE_APPROVED", type: "HR", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_PROFILE_CHANGE_REJECTED", type: "HR", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_CONTRACT_EXPIRING", type: "Reminder", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_MISSING_CHECKOUT", type: "Attendance", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_LATE_DETECTED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_ABSENT_DETECTED", type: "Warning", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_ADJUSTMENT_SUBMITTED", type: "Approval", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_ADJUSTMENT_APPROVED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_ADJUSTMENT_REJECTED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_AUTO_ATTENDANCE_CREATED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_REMOTE_REQUEST_SUBMITTED", type: "Approval", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_REMOTE_REQUEST_APPROVED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_REMOTE_REQUEST_REJECTED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_REMOTE_REQUEST_CANCELLED", type: "Attendance", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_REQUEST_SUBMITTED", type: "Approval", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_REQUEST_APPROVED", type: "Leave", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_REQUEST_REJECTED", type: "Leave", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_REQUEST_CANCELLED", type: "Leave", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_REQUEST_REVOKED", type: "Leave", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_BALANCE_ADJUSTED", type: "Leave", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_BALANCE_LOW", type: "Warning", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_SYNC_TO_ATT_FAILED", type: "Error", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_ASSIGNED", type: "Task", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_STATUS_CHANGED", type: "Task", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_COMMENT_CREATED", type: "Task", priority: "Low", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_MENTIONED", type: "Task", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_DUE_SOON", type: "Reminder", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_OVERDUE", type: "Warning", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "PROJECT_MEMBER_ADDED", type: "Project", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  // S4-NOTI-SEED-2 (mig 0490) — 3 mã canonical BE-3 bật thêm (task-actions.service.ts Producer §9.4).
  { module: "TASK", eventCode: "TASK_ASSIGNEE_CHANGED", type: "Task", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_PRIORITY_CHANGED", type: "Task", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_DUE_DATE_CHANGED", type: "Task", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_CONFIG_WARNING", type: "Warning", priority: "High", isEnabled: true, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_ERROR_DETECTED", type: "Error", priority: "Critical", isEnabled: true, isSystemEvent: true }, // prettier-ignore
  // S5-GOAL-DB-1 (mig 0507) — 2 mã GOAL (SPEC-10 §18): giao mục tiêu + chốt kỳ. payload chỉ goal name/mã + link.
  { module: "GOAL", eventCode: "GOAL_ASSIGNED", type: "Goal", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "GOAL", eventCode: "GOAL_FINALIZED", type: "Goal", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  // S5-LMS-NOTI-1 (mig 0529) — 4 mã LMS (docs/plans/S5-LMS-NOTI-1.md §3.1). Caller là LMS ở NGOÀI tiến trình
  // api (POST /internal/v1/notifications/lms-events), KHÔNG qua OutboxNotificationBridge. Đây ĐỒNG THỜI là
  // ALLOWLIST của token máy: LMS_SERVICE_EVENT_CODES suy từ đúng khối này ⇒ token LMS không mint được mã khác.
  // DEADLINE_NEAR dùng type 'Reminder' theo quy ước nhắc hạn sẵn có (TASK_DUE_SOON, HR_CONTRACT_EXPIRING).
  { module: "LMS", eventCode: "LMS_ENROLLMENT_APPROVED", type: "Training", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LMS", eventCode: "LMS_COURSE_ASSIGNED", type: "Training", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LMS", eventCode: "LMS_EXAM_GRADED", type: "Training", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "LMS", eventCode: "LMS_COURSE_DEADLINE_NEAR", type: "Reminder", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  // ===== CHAT (SPEC-15 §17 · mig 0538 · S7-CHAT-DB-1) =====
  // CHAT-DEC-010: CHỈ mention + DM có notification; phòng nhóm/phòng ban/dự án chỉ có badge chưa đọc.
  // CHAT-DEC-011: payload KHÔNG chứa nội dung tin nhắn — template chỉ có tên người gửi / tên phòng / số đếm.
  // CHAT_DIRECT_MESSAGE = DedupeKey vì S7-CHAT-BE-6 gộp lô 15 phút theo
  // dedupeKey 'chat:{roomId}:{recipientUserId}:{bucket15m}'; CHAT_MENTIONED gửi ngay nên None.
  { module: "CHAT", eventCode: "CHAT_MENTIONED", type: "Chat", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "CHAT", eventCode: "CHAT_DIRECT_MESSAGE", type: "Chat", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  // ===== ASSET (SPEC-13 §17 · NOTI-EVENT-010..012 · mig 0551 · S11-ASSET-DB-1) =====
  // Cả 3 dedupe_strategy='DedupeKey' (catalog thắng DEFAULT_DEDUPE — KHÔNG thêm entry notification-dedupe.const.ts):
  //   assigned/revoked: dedupeKey 'asset:assigned|revoked:{assignmentId}' · maint-due: 'asset:maint-due:{assetId}:{dueDate}'
  //   (cùng hạn không nhắc lại; đổi hạn ⇒ khoá mới). Payload CHỈ mã + tên tài sản + tên người + link — KHÔNG giá/chi phí.
  //   012 người nhận resolve theo ROLE (user_roles của asset-manager/company-admin, mode 'UserIds') — SPEC-13 §17.
  { module: "ASSET", eventCode: "ASSET_ASSIGNED", type: "Asset", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ASSET", eventCode: "ASSET_REVOKED", type: "Asset", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ASSET", eventCode: "ASSET_MAINTENANCE_DUE", type: "Asset", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  // ===== ROOM (SPEC-14 §17 · NOTI-EVENT-013..015 · mig 0555 · S11-ROOM-DB-1) =====
  // Cả 3 dedupe_strategy='DedupeKey' (catalog thắng DEFAULT_DEDUPE — KHÔNG thêm entry notification-dedupe.const.ts):
  //   confirmed/cancelled: dedupeKey 'room:confirmed|cancelled:{bookingId}' · reminder: 'room:reminder:{bookingId}:{startsAt}'
  //   (job quét mỗi nhịp, nhắc đúng 1 lần/lượt). Người nhận = organizer ∪ attendees theo id CÓ SẴN trong lượt (mode UserIds);
  //   013/014 trừ actor (isSystemEvent=false); 015 do job phát, KHÔNG có actor ⇒ isSystemEvent=true (không loại ai).
  //   Payload CHỈ tiêu đề · tên phòng · khung giờ · tên người · deep-link /me/room-bookings?focus={bookingId}.
  { module: "ROOM", eventCode: "ROOM_BOOKING_CONFIRMED", type: "Room", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ROOM", eventCode: "ROOM_BOOKING_CANCELLED", type: "Room", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "ROOM", eventCode: "ROOM_BOOKING_REMINDER", type: "Room", priority: "High", isEnabled: true, isSystemEvent: true }, // prettier-ignore
  // ===== RECRUIT (SPEC-12 §17 · NOTI-EVENT-016..019 · mig 0561 · S12-RECRUIT-DB-1) =====
  // Cả 4 dedupe_strategy='DedupeKey' (catalog thắng DEFAULT_DEDUPE — KHÔNG thêm entry notification-dedupe.const.ts):
  //   016 'RECRUIT_JOB_ASSIGNED:{jobOpeningId}:{auditLogId}' — mỗi LẦN GÁN là một sự kiện (khoá {jobId}:{userId}
  //   là once-ever: A→B→A thì A không được báo lại) · 017 ':{interviewId}' (huỷ + tạo lại = id mới) ·
  //   018 ':{stageEventId}' · 019 ':{candidateId}'. is_system_event=false CẢ 4 (RECRUIT v1 không có system job).
  //   Người nhận (BE-1, mode UserIds): 016/018 = recruiter_user_id (trừ actor) · 017 = user của participants ·
  //   019 = user giữ role 'hr' (KHÔNG hr-manager — role đó không có grant RECRUIT v1). Payload CHỈ tên ứng viên ·
  //   tên vị trí · stage/khung giờ · tên người thao tác · deep-link — KHÔNG email/phone/lương (SPEC-12 §18).
  { module: "RECRUIT", eventCode: "RECRUIT_JOB_ASSIGNED", type: "Recruit", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "RECRUIT", eventCode: "RECRUIT_INTERVIEW_SCHEDULED", type: "Recruit", priority: "High", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "RECRUIT", eventCode: "RECRUIT_STAGE_CHANGED", type: "Recruit", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  { module: "RECRUIT", eventCode: "RECRUIT_CANDIDATE_HIRED", type: "Recruit", priority: "Normal", isEnabled: true, isSystemEvent: false }, // prettier-ignore
  // ===== Phần dư SPEC-08 §15 (ngoài MVP) — isEnabled = false, GIỮ trong catalog (14 mã) =====
  { module: "AUTH", eventCode: "AUTH_PASSWORD_CHANGED", type: "Account", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "AUTH", eventCode: "AUTH_USER_UNLOCKED", type: "Account", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_PROBATION_ENDING", type: "Reminder", priority: "High", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_EMPLOYEE_STATUS_CHANGED", type: "HR", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_CHECKIN_REMINDER", type: "Reminder", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_CHECKOUT_REMINDER", type: "Reminder", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_START_REMINDER", type: "Reminder", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_UPDATED", type: "Task", priority: "Low", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  // TASK_ASSIGNEE_CHANGED + TASK_DEADLINE_CHANGED→TASK_DUE_DATE_CHANGED đã CHUYỂN sang khối enabled (mig 0490).
  { module: "TASK", eventCode: "PROJECT_CLOSED", type: "Project", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "DASH", eventCode: "DASH_WIDGET_ERROR", type: "Error", priority: "High", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_CONFIG_CHANGED", type: "System", priority: "Normal", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_MAINTENANCE_NOTICE", type: "System", priority: "Normal", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_IMPORT_FAILED", type: "Error", priority: "High", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_JOB_FAILED", type: "Error", priority: "High", isEnabled: false, isSystemEvent: true }, // prettier-ignore
] as const;

/** Tổng số event UNION (pin để test bắt thiếu/thừa mã). */
export const NOTI_EVENT_COUNT = NOTI_EVENT_CATALOG.length; // 71 (59 + 2 CHAT 0538 + 3 ASSET 0551 + 3 ROOM 0555 + 4 RECRUIT 0561)

/** Danh mục event ENABLED (MVP set DB-07 §14.1) — mỗi mã PHẢI có đúng 1 template IN_APP/vi-VN. */
export const NOTI_ENABLED_EVENTS: readonly NotiEventCatalogEntry[] = NOTI_EVENT_CATALOG.filter(
  (e) => e.isEnabled,
);

export const NOTI_ENABLED_EVENT_COUNT = NOTI_ENABLED_EVENTS.length; // 57 (45 + 2 CHAT 0538 + 3 ASSET 0551 + 3 ROOM 0555 + 4 RECRUIT 0561)

/**
 * S5-LMS-NOTI-1 — ALLOWLIST eventCode mà token máy LMS (`LMS_NOTI_TOKEN`) được phép đẩy vào intake.
 * SUY TỪ registry (module 'LMS' + isEnabled), KHÔNG viết tay danh sách thứ hai — thêm mã LMS mới ở
 * NOTI_EVENT_CATALOG là tự động vào allowlist, không có đường để hai nơi trôi khỏi nhau.
 *
 * Đây là điểm least-privilege của kênh: khoá LMS bị lộ vẫn KHÔNG mint được mã LEAVE_ · HR_ · AUTH_.
 * Dùng prefix 'LMS_' làm allowlist thay cho tập này sẽ nới quyền cho mọi mã LMS_* tương lai kể cả khi
 * mã đó CHƯA được bật — nên ở đây khớp CHÍNH XÁC theo tập.
 */
export const LMS_SERVICE_EVENT_CODES: ReadonlySet<string> = new Set(
  NOTI_EVENT_CATALOG.filter((e) => e.module === "LMS" && e.isEnabled).map((e) => e.eventCode),
);

/** template_code chuẩn hoá (mirror 0481 bước (2)): `<EVENT_CODE>__IN_APP__vi-VN`. */
export const NOTI_TEMPLATE_CHANNEL = "IN_APP" as const;
export const NOTI_TEMPLATE_LOCALE = "vi-VN" as const;
export const NOTI_TEMPLATE_STATUS = "Active" as const;

export function notiTemplateCode(eventCode: string): string {
  return `${eventCode}__${NOTI_TEMPLATE_CHANNEL}__${NOTI_TEMPLATE_LOCALE}`;
}

/** 1 cặp quyền engine (action, resource_type) của NOTI + is_sensitive + ma trận grant role→scope. */
export interface NotiPermissionPair {
  readonly action: string;
  readonly resourceType: string;
  /** is_sensitive trong catalog `permissions` (DB-02 §9.7). config = true; read:notification = false. */
  readonly sensitive: boolean;
  /** role slug → data_scope. Role KHÔNG có mặt = KHÔNG grant (deny — least privilege). */
  readonly grants: Readonly<Partial<Record<NotiRoleSlug, NotiScope>>>;
}

/** resource_type của 6 cặp NOTI config (nhạy cảm). KHÔNG có 'channel'/'notification-channel' (phantom). */
export const NOTI_CONFIG_RESOURCE_TYPES: readonly string[] = [
  "notification-config",
  "notification-template",
  "notification-delivery-log",
  "notification-audit-log",
] as const;

/**
 * 7 cặp quyền NOTI — ĐỒNG BỘ 1-1 với migration 0481 bước (3)+(4).
 *   • read:notification (0005, non-sensitive) → @Own cho 4 role (thông báo = dữ liệu CÁ NHÂN của recipient).
 *   • 6 cặp config (is_sensitive=true) → @Company CHỈ cho company-admin. employee/manager/hr = 0 grant (deny).
 */
export const NOTI_PERMISSION_PAIRS: readonly NotiPermissionPair[] = [
  {
    action: "read",
    resourceType: "notification",
    sensitive: false,
    grants: { employee: "Own", manager: "Own", hr: "Own", "company-admin": "Own" },
  },
  {
    action: "view",
    resourceType: "notification-config",
    sensitive: true,
    grants: { "company-admin": "Company" },
  },
  {
    action: "update",
    resourceType: "notification-config",
    sensitive: true,
    grants: { "company-admin": "Company" },
  },
  {
    action: "view",
    resourceType: "notification-template",
    sensitive: true,
    grants: { "company-admin": "Company" },
  },
  {
    action: "update",
    resourceType: "notification-template",
    sensitive: true,
    grants: { "company-admin": "Company" },
  },
  {
    action: "view",
    resourceType: "notification-delivery-log",
    sensitive: true,
    grants: { "company-admin": "Company" },
  },
  {
    action: "view",
    resourceType: "notification-audit-log",
    sensitive: true,
    grants: { "company-admin": "Company" },
  },
] as const;

/** 6 cặp config nhạy cảm (loại read:notification) — pin để test đúng số lượng + is_sensitive. */
export const NOTI_CONFIG_PAIRS: readonly NotiPermissionPair[] = NOTI_PERMISSION_PAIRS.filter(
  (p) => p.sensitive,
);

export const NOTI_CONFIG_PAIR_COUNT = NOTI_CONFIG_PAIRS.length; // 6

/** Cặp read:notification (non-sensitive, @Own cho 4 role). */
export const NOTI_READ_PAIR: NotiPermissionPair = NOTI_PERMISSION_PAIRS.find(
  (p) => p.action === "read" && p.resourceType === "notification",
)!;

/**
 * Hành động OWN-SCOPE trên resource 'notification' — mig 0481 block (3b)+(4b) grant @Own cho MỌI
 * NOTI_CANONICAL_ROLES. S4-NOTI-BE-1 PHẢI @RequirePermission đúng các tuple này (action, 'notification'):
 * lệch một ký tự ⇒ 403 im lặng cho mọi role, không test nào bắt được.
 *
 * Convention SNAKE, bám cặp legacy 'mark_read' có sẵn trong catalog từ mig 0051 (media-era) — KHÔNG tạo bản
 * gạch-nối 'mark-read' song song (đúng bài học pair-drift đã phải mở WO S4-TASK-RECON-1 để dọn).
 * ⚠️ apps/api/src/notifications/notifications.service.ts (legacy) cũng tham chiếu mark_read — S4-NOTI-BE-1
 * phải đối soát, KHÔNG để hai đường gate song song.
 */
export const NOTI_OWN_ACTIONS = ["read", "mark_read", "mark_all_read", "hide"] as const;

/** Role canonical enumerate trong seed 0481 (super-admin KHÔNG có — runtime bootstrap). */
export const NOTI_CANONICAL_ROLES: readonly NotiRoleSlug[] = [
  "employee",
  "manager",
  "hr",
  "company-admin",
] as const;

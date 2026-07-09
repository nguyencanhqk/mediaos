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

/** module_code hợp lệ (CHECK chk_notification_events_module_code — 0479). */
export type NotiModuleCode = "AUTH" | "HR" | "ATT" | "LEAVE" | "TASK" | "DASH" | "NOTI" | "SYSTEM";

/** notification_type hợp lệ (CHECK chk_notification_events_type — 0479). */
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
  | "Error";

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
 * UNION danh mục event (52 mã). ĐỒNG BỘ 1-1 với migration 0481 bước (1).
 * Thứ tự nhóm theo module để dễ đối chiếu; test so SÁNH THEO TẬP (set), không theo thứ tự.
 */
export const NOTI_EVENT_CATALOG: readonly NotiEventCatalogEntry[] = [
  // ===== MVP set (DB-07 §14.1) — isEnabled = true (36 mã) =====
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
  { module: "SYSTEM", eventCode: "SYSTEM_CONFIG_WARNING", type: "Warning", priority: "High", isEnabled: true, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_ERROR_DETECTED", type: "Error", priority: "Critical", isEnabled: true, isSystemEvent: true }, // prettier-ignore
  // ===== Phần dư SPEC-08 §15 (ngoài MVP) — isEnabled = false, GIỮ trong catalog (16 mã) =====
  { module: "AUTH", eventCode: "AUTH_PASSWORD_CHANGED", type: "Account", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "AUTH", eventCode: "AUTH_USER_UNLOCKED", type: "Account", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_PROBATION_ENDING", type: "Reminder", priority: "High", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "HR", eventCode: "HR_EMPLOYEE_STATUS_CHANGED", type: "HR", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_CHECKIN_REMINDER", type: "Reminder", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "ATT", eventCode: "ATT_CHECKOUT_REMINDER", type: "Reminder", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "LEAVE", eventCode: "LEAVE_START_REMINDER", type: "Reminder", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_UPDATED", type: "Task", priority: "Low", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_ASSIGNEE_CHANGED", type: "Task", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "TASK_DEADLINE_CHANGED", type: "Task", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "TASK", eventCode: "PROJECT_CLOSED", type: "Project", priority: "Normal", isEnabled: false, isSystemEvent: false }, // prettier-ignore
  { module: "DASH", eventCode: "DASH_WIDGET_ERROR", type: "Error", priority: "High", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_CONFIG_CHANGED", type: "System", priority: "Normal", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_MAINTENANCE_NOTICE", type: "System", priority: "Normal", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_IMPORT_FAILED", type: "Error", priority: "High", isEnabled: false, isSystemEvent: true }, // prettier-ignore
  { module: "SYSTEM", eventCode: "SYSTEM_JOB_FAILED", type: "Error", priority: "High", isEnabled: false, isSystemEvent: true }, // prettier-ignore
] as const;

/** Tổng số event UNION (pin để test bắt thiếu/thừa mã). */
export const NOTI_EVENT_COUNT = NOTI_EVENT_CATALOG.length; // 52

/** Danh mục event ENABLED (MVP set DB-07 §14.1) — mỗi mã PHẢI có đúng 1 template IN_APP/vi-VN. */
export const NOTI_ENABLED_EVENTS: readonly NotiEventCatalogEntry[] = NOTI_EVENT_CATALOG.filter(
  (e) => e.isEnabled,
);

export const NOTI_ENABLED_EVENT_COUNT = NOTI_ENABLED_EVENTS.length; // 36

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

/** Role canonical enumerate trong seed 0481 (super-admin KHÔNG có — runtime bootstrap). */
export const NOTI_CANONICAL_ROLES: readonly NotiRoleSlug[] = [
  "employee",
  "manager",
  "hr",
  "company-admin",
] as const;

/**
 * Hằng quyền module LEAVE — S3-FE-LEAVE-1.
 * Cấu trúc: LEAVE.RESOURCE.ACTION (SPEC-05 §9.1 + CLAUDE.md §5).
 * Sử dụng trong useCan(action, resourceType) qua PERMISSION_CODE_TO_PAIR.
 * KHÔNG dùng chuỗi inline / so sánh role trực tiếp.
 */
export const LEAVE_PERMS = {
  REQUEST: {
    VIEW_OWN: "LEAVE.REQUEST.VIEW_OWN",
    VIEW: "LEAVE.REQUEST.VIEW",
    CREATE: "LEAVE.REQUEST.CREATE",
    SUBMIT: "LEAVE.REQUEST.SUBMIT",
    UPDATE_DRAFT: "LEAVE.REQUEST.UPDATE_DRAFT",
    CANCEL_OWN: "LEAVE.REQUEST.CANCEL_OWN",
    APPROVE: "LEAVE.REQUEST.APPROVE",
    REJECT: "LEAVE.REQUEST.REJECT",
    CANCEL_ANY: "LEAVE.REQUEST.CANCEL_ANY",
    REVOKE: "LEAVE.REQUEST.REVOKE",
  },
  BALANCE: {
    VIEW_OWN: "LEAVE.BALANCE.VIEW_OWN",
    VIEW: "LEAVE.BALANCE.VIEW",
    ADJUST: "LEAVE.BALANCE.ADJUST",
  },
  TYPE: {
    VIEW: "LEAVE.TYPE.VIEW",
  },
  CALENDAR: {
    VIEW_OWN: "LEAVE.CALENDAR.VIEW_OWN",
    VIEW_TEAM: "LEAVE.CALENDAR.VIEW_TEAM",
    VIEW_COMPANY: "LEAVE.CALENDAR.VIEW_COMPANY",
  },
} as const;

/**
 * Cặp engine (action:resourceType) dùng trong useCan() — khớp ĐÚNG với seed DB (mig 0455).
 * Nguồn sự thật: apps/api/src/leave/leave-permissions.const.ts LEAVE_RESOURCES + LEAVE_PERMISSIONS.
 * KHÔNG dùng `read:leave` legacy — đó là cặp cũ (mig 0063) không được grant cho canonical roles mới.
 */
export const LEAVE_ENGINE_PAIRS = {
  VIEW_OWN_REQUEST: { action: "view-own", resourceType: "leave" },
  VIEW_REQUEST: { action: "view", resourceType: "leave" },
  CREATE_REQUEST: { action: "create", resourceType: "leave" },
  SUBMIT_REQUEST: { action: "submit", resourceType: "leave" },
  UPDATE_DRAFT: { action: "update-draft", resourceType: "leave" },
  CANCEL_OWN: { action: "cancel-own", resourceType: "leave" },
  APPROVE_REQUEST: { action: "approve", resourceType: "leave" },
  REJECT_REQUEST: { action: "reject", resourceType: "leave" },
  CANCEL_ANY: { action: "cancel-any", resourceType: "leave" },
  REVOKE_REQUEST: { action: "revoke", resourceType: "leave" },
  VIEW_OWN_BALANCE: { action: "view-own", resourceType: "leave-balance" },
  VIEW_BALANCE: { action: "view", resourceType: "leave-balance" },
  VIEW_LEAVE_TYPE: { action: "view", resourceType: "leave-type" },
  VIEW_OWN_CALENDAR: { action: "view-own", resourceType: "leave-calendar" },
  VIEW_TEAM_CALENDAR: { action: "view-team", resourceType: "leave-calendar" },
  VIEW_COMPANY_CALENDAR: { action: "view-company", resourceType: "leave-calendar" },
  // S3-FE-LEAVE-5 — admin (LEAVE-SCREEN-010/011/012/013). Cặp SEED THẬT (apps/api/src/leave/
  // leave-permissions.const.ts, mig 0455) — view:leave-type KHÔNG sensitive; mọi cặp còn lại SENSITIVE
  // (Company-scope, chỉ hr/company-admin) → gate bằng useCanExact (KHÔNG useCan wildcard-fallback).
  CREATE_LEAVE_TYPE: { action: "create", resourceType: "leave-type" },
  UPDATE_LEAVE_TYPE: { action: "update", resourceType: "leave-type" },
  DELETE_LEAVE_TYPE: { action: "delete", resourceType: "leave-type" },
  VIEW_LEAVE_POLICY: { action: "view", resourceType: "leave-policy" },
  CREATE_LEAVE_POLICY: { action: "create", resourceType: "leave-policy" },
  UPDATE_LEAVE_POLICY: { action: "update", resourceType: "leave-policy" },
  DELETE_LEAVE_POLICY: { action: "delete", resourceType: "leave-policy" },
  VIEW_TRANSACTION_BALANCE: { action: "view-transaction", resourceType: "leave-balance" },
  ADJUST_BALANCE: { action: "adjust", resourceType: "leave-balance" },
  // S3-FE-LEAVE-6 — báo cáo tổng hợp nghỉ + audit log LEAVE. CẶP SEED THẬT mig 0455 (apps/api/src/leave/
  // leave-permissions.const.ts): export:leave (Company-scope, CHỈ hr/company-admin — LEAST-PRIVILEGE,
  // manager KHÔNG có grant) · view:leave-audit-log (RIÊNG, KHÔNG tái dùng foundation view:audit-log).
  // CẢ HAI SENSITIVE ⇒ phơi qua /auth/me nhờ S2-AUTH-CAP-1 (allowlist) ⇒ gate bằng useCanExact.
  // Mã 'LEAVE.REQUEST.EXPORT' (LEAVE_PERMS) KHÔNG có trong PERMISSION_CODE_TO_PAIR — dùng cặp THẬT trực tiếp.
  EXPORT_LEAVE: { action: "export", resourceType: "leave" },
  VIEW_AUDIT_LOG: { action: "view", resourceType: "leave-audit-log" },
} as const;

/** Trạng thái đơn nghỉ — SPEC-05 §8 + API-05 §10.1 (TitleCase). */
export const LEAVE_STATUS = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  REVOKED: "Revoked",
} as const;

export type LeaveStatus = (typeof LEAVE_STATUS)[keyof typeof LEAVE_STATUS];

/** Loại thời lượng nghỉ — khớp schema contracts (TitleCase). */
export const LEAVE_DURATION_TYPE = {
  FULL_DAY: "FullDay",
  HALF_DAY: "HalfDay",
  HOURLY: "Hourly",
  MULTIPLE_DAYS: "MultipleDays",
} as const;

export type LeaveDurationTypeConst = (typeof LEAVE_DURATION_TYPE)[keyof typeof LEAVE_DURATION_TYPE];

/** Buổi trong ngày khi nghỉ nửa ngày. */
export const LEAVE_HALF_DAY_SESSION = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
} as const;

export type LeaveHalfDaySessionConst =
  (typeof LEAVE_HALF_DAY_SESSION)[keyof typeof LEAVE_HALF_DAY_SESSION];

/** Routes trong module LEAVE. */
export const LEAVE_PATHS = {
  OVERVIEW: "/leave",
  // S3-FE-LEAVE-7 — số dư phép self-service DỜI khỏi /leave (nay là LeaveOverviewPage) → /leave/me/balances.
  MY_BALANCES: "/leave/me/balances",
  MY_REQUESTS: "/leave/me/requests",
  CREATE: "/leave/me/requests/new",
  DETAIL: (id: string) => `/leave/me/requests/${id}`,
  APPROVALS: "/leave/approvals",
  // S3-FE-LEAVE-3: LEAVE-SCREEN-006 (tất cả đơn nghỉ, HR/Admin) + edit đơn nháp (Draft-only).
  ALL_REQUESTS: "/leave/requests",
  EDIT: (id: string) => `/leave/requests/${id}/edit`,
  // S3-FE-LEAVE-4: LEAVE-SCREEN-007/008/009 (lịch nghỉ own/team/company).
  CALENDAR: "/leave/calendar",
  // S3-FE-LEAVE-5: admin (LEAVE-SCREEN-010/011/012/013).
  TYPES: "/leave/types",
  POLICIES: "/leave/policies",
  BALANCES: "/leave/balances",
  BALANCE_TRANSACTIONS: (balanceId: string) => `/leave/balances/${balanceId}/transactions`,
  // S3-FE-LEAVE-6: báo cáo tổng hợp nghỉ (LEAVE-SCREEN-013) + audit log nghỉ phép (LEAVE-SCREEN-014A).
  REPORTS: "/leave/reports",
  AUDIT_LOGS: "/leave/audit-logs",
  // S5-LEAVE-HOLIDAYS-MOVE-1 — Ngày nghỉ lễ RE-HOME từ /system/public-holidays (FE-only; gate + BE
  // giữ nguyên FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS). Đường dẫn cũ redirect sang đây (router.tsx).
  PUBLIC_HOLIDAYS: "/leave/public-holidays",
} as const;

/** Page size mặc định cho báo cáo/audit LEAVE (mirror ATT_RECORDS_PAGE_SIZE). */
export const LEAVE_REPORT_PAGE_SIZE = 20;
export const LEAVE_AUDIT_PAGE_LIMIT = 50;

/**
 * S3-FE-LEAVE-7 — LeaveOverviewPage (LEAVE-SCREEN-001).
 * Số dòng "gần đây" nạp cho hub tổng quan (dùng page/pageSize — KHÔNG per_page: contract
 * leaveRequestListQuerySchema/pendingLeaveRequestListQuerySchema chỉ có page/pageSize,
 * per_page bị Zod strip → server trả full 20 dòng).
 */
export const LEAVE_OVERVIEW_RECENT_SIZE = 5;
/** Ngưỡng cảnh báo số dư phép sắp hết (ngày còn lại ≤ ngưỡng). */
export const LEAVE_LOW_BALANCE_THRESHOLD = 2;
/** Đơn chờ duyệt quá hạn: submittedAt cũ hơn N ngày → cảnh báo (cross-read, gate view:leave). */
export const LEAVE_OVERDUE_PENDING_DAYS = 3;

/**
 * Filter tháng → fromDate / toDate INCLUSIVE [đầu tháng, cuối tháng] cho GET /leave/reports
 * (leaveReportQuerySchema refine `toDate >= fromDate`, toDate INCLUSIVE — KHÁC half-open của ATT).
 */
export function monthToInclusiveRange(month: string): { fromDate: string; toDate: string } {
  const [year, mon] = month.split("-").map(Number);
  const from = new Date(year, mon - 1, 1);
  const to = new Date(year, mon, 0); // ngày cuối cùng của tháng
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { fromDate: fmt(from), toDate: fmt(to) };
}

/** Tháng hiện tại dạng 'YYYY-MM'. */
export function currentMonth(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Phạm vi lịch nghỉ (khớp leaveCalendarScopeSchema — contracts). */
export const LEAVE_CALENDAR_SCOPE = {
  OWN: "own",
  TEAM: "team",
  COMPANY: "company",
} as const;

export type LeaveCalendarScopeConst =
  (typeof LEAVE_CALENDAR_SCOPE)[keyof typeof LEAVE_CALENDAR_SCOPE];

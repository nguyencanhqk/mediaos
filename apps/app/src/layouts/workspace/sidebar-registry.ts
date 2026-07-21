/**
 * Sidebar registry MVP — khai báo NavItem[] cho mỗi module.
 *
 * Quy tắc (FRONTEND-05 §16):
 * - Label tiếng Việt trực tiếp (sidebar render nhanh, không qua i18n key).
 * - requiredAnyPermissions theo hằng MODULE.RESOURCE.ACTION (SPEC-01 §9).
 * - Không hard-code role — filterSidebarItems() lọc theo permission + module status.
 * - Tối đa 2 cấp trong MVP.
 */
import { type SidebarItemMeta } from "@mediaos/web-core";
import { AUDIT_LOG_VIEW_PERMISSION } from "@/routes/system/auth-logs/constants";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";
import { HR_AUDIT_LOG_VIEW_PERMISSION } from "@/routes/hr/audit-logs/constants";
import {
  EMPLOYEE_CODE_CONFIG_PATH,
  EMPLOYEE_CODE_CONFIG_VIEW_PERMISSION,
} from "@/routes/hr/settings/constants";
import { FOUNDATION_FILE_VIEW_PERMISSION } from "@/routes/system/files/constants";
import { FOUNDATION_MODULE_VIEW_PERMISSION } from "@/routes/system/modules/constants";
// S2-FE-FND-7 — 4 màn wired sẵn (S2-FE-FND-4/6): visibility trong sidebar. requiredAnyPermissions
// dùng CHUNG route-meta (nguồn foundation/constants) → sidebar pair === route-meta pair (chống drift).
import {
  // S5-LEAVE-HOLIDAYS-MOVE-1 — gate GIỮ NGUYÊN, dùng cho entry "leave.public-holidays" (LEAVE_SIDEBAR),
  // KHÔNG còn entry system.public-holidays ở SYSTEM_SIDEBAR (xem khối LEAVE bên dưới).
  FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS,
  SYSTEM_HEALTH_ROUTE_META,
  SYSTEM_RETENTION_ROUTE_META,
  SYSTEM_FILE_ACCESS_LOGS_ROUTE_META,
  SYSTEM_SETTINGS_ROUTE_META,
  SYSTEM_JOBS_ROUTE_META,
  FOUNDATION_PATH,
} from "@/routes/system/foundation/constants";
import {
  PCR_CREATE_PERMISSION,
  PCR_APPROVE_PERMISSION,
  PCR_ME_PATH,
  PCR_LIST_PATH,
} from "@/routes/hr/profile-change-requests/constants";

const HR_ORG_CHART_VIEW_PERMISSION = `${HR_ENGINE_PAIRS.ORG_CHART_VIEW.action}:${HR_ENGINE_PAIRS.ORG_CHART_VIEW.resourceType}`;

// ---------------------------------------------------------------------------
// DASH
// ---------------------------------------------------------------------------
export const DASH_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "dash.overview",
    moduleCode: "DASH",
    label: "Tổng quan",
    path: "/dashboard",
    icon: "layout-dashboard",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["DASH.DASHBOARD.VIEW"],
  },
];

// ---------------------------------------------------------------------------
// HR
// ---------------------------------------------------------------------------
export const HR_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "hr.overview",
    moduleCode: "HR",
    label: "Tổng quan",
    path: "/hr",
    icon: "users",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
  },
  // "Hồ sơ của tôi" (/hr/me) GỠ khỏi sidebar HR — trùng với ME "Hồ sơ của tôi" (/me/profile,
  // sidebarKey me.profile) sau S5-ME-FE-2. Route /hr/me GIỮ đăng ký trong router.tsx để link/bookmark
  // cũ không gãy; chỉ ẩn lối vào ở menu.
  {
    sidebarKey: "hr.employees",
    moduleCode: "HR",
    label: "Nhân viên",
    path: "/hr/employees",
    icon: "users",
    group: "operation",
    order: 30,
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
  },
  // S2-FE-HR-4 — cặp seed THẬT mig 0444 (create/approve:profile-change-request) — literal, KHÔNG
  // qua PERMISSION_CODE_TO_PAIR (tránh drift, cùng kỹ thuật system.login-logs/system.files).
  {
    sidebarKey: "hr.me-change-request",
    moduleCode: "HR",
    label: "Yêu cầu sửa hồ sơ",
    path: PCR_ME_PATH,
    icon: "file-edit",
    group: "operation",
    order: 40,
    requiredAnyPermissions: [PCR_CREATE_PERMISSION],
  },
  // S2-FE-HR-6 — Sơ đồ tổ chức. Gate = read:department (cặp seed thật, CÙNG cặp "phòng ban" HR).
  {
    sidebarKey: "hr.org-chart",
    moduleCode: "HR",
    label: "Sơ đồ tổ chức",
    path: "/hr/org-chart",
    icon: "network",
    group: "operation",
    order: 45,
    requiredAnyPermissions: [HR_ORG_CHART_VIEW_PERMISSION],
  },
  {
    sidebarKey: "hr.profile-change-requests",
    moduleCode: "HR",
    label: "Duyệt yêu cầu hồ sơ",
    path: PCR_LIST_PATH,
    icon: "clipboard-check",
    group: "management",
    order: 50,
    requiredAnyPermissions: [PCR_APPROVE_PERMISSION],
  },
  // S2-FE-HR-6 — Lịch sử thay đổi HR (tái dùng /foundation/audit-logs?moduleCode=HR). Gate =
  // view:audit-log (cặp seed thật mig 0340, sensitive) — literal, KHÔNG qua PERMISSION_CODE_TO_PAIR
  // (tránh drift, cùng kỹ thuật system.login-logs).
  {
    sidebarKey: "hr.audit-logs",
    moduleCode: "HR",
    label: "Lịch sử thay đổi",
    path: "/hr/audit-logs",
    icon: "history",
    group: "report",
    order: 50,
    requiredAnyPermissions: [HR_AUDIT_LOG_VIEW_PERMISSION],
  },
  // S2-FE-HR-8 — Cấu hình mã nhân viên. Gate = view:employee-code-config (cặp seed thật mig 0459).
  {
    sidebarKey: "hr.employee-code-config",
    moduleCode: "HR",
    label: "Cấu hình mã nhân viên",
    path: EMPLOYEE_CODE_CONFIG_PATH,
    icon: "hash",
    group: "admin",
    order: 60,
    requiredAnyPermissions: [EMPLOYEE_CODE_CONFIG_VIEW_PERMISSION],
  },
  // S2-FE-HR-5 — dữ liệu gốc HR. Gate theo cặp SEED THẬT (qua PERMISSION_CODE_TO_PAIR):
  // phòng ban/chức vụ = cặp ĐỌC; cấp bậc/loại hợp đồng = manage:master-data DUY NHẤT (SPEC-03 §13.12b/c).
  {
    sidebarKey: "hr.departments",
    moduleCode: "HR",
    label: "Phòng ban",
    path: "/hr/departments",
    icon: "building-2",
    group: "master-data",
    order: 70,
    requiredAnyPermissions: ["HR.DEPARTMENT.VIEW"],
  },
  {
    sidebarKey: "hr.positions",
    moduleCode: "HR",
    label: "Chức vụ",
    path: "/hr/positions",
    icon: "briefcase",
    group: "master-data",
    order: 71,
    requiredAnyPermissions: ["HR.POSITION.VIEW"],
  },
  {
    sidebarKey: "hr.job-levels",
    moduleCode: "HR",
    label: "Cấp bậc",
    path: "/hr/job-levels",
    icon: "layers",
    group: "master-data",
    order: 72,
    requiredAnyPermissions: ["HR.MASTER_DATA.MANAGE"],
  },
  {
    sidebarKey: "hr.contract-types",
    moduleCode: "HR",
    label: "Loại hợp đồng",
    path: "/hr/contract-types",
    icon: "file-text",
    group: "master-data",
    order: 73,
    requiredAnyPermissions: ["HR.MASTER_DATA.MANAGE"],
  },
  // S2-FE-HR-7 — Hợp đồng lao động (đọc, theo data-scope Own/Team/Company qua cặp view:contract).
  {
    sidebarKey: "hr.contracts",
    moduleCode: "HR",
    label: "Hợp đồng lao động",
    path: "/hr/contracts",
    icon: "file-signature",
    group: "operation",
    order: 50,
    requiredAnyPermissions: ["HR.CONTRACT.VIEW"],
  },
];

// ---------------------------------------------------------------------------
// ATT — Chấm công
// ---------------------------------------------------------------------------
export const ATT_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "att.today",
    moduleCode: "ATT",
    label: "Chấm công hôm nay",
    path: "/attendance/today",
    icon: "clock",
    group: "overview",
    order: 10,
    requiredAnyPermissions: [
      "ATT.ATTENDANCE.VIEW_OWN",
      "ATT.ATTENDANCE.VIEW_TEAM",
      "ATT.ATTENDANCE.VIEW_COMPANY",
    ],
  },
  {
    sidebarKey: "att.my-records",
    moduleCode: "ATT",
    label: "Bảng công của tôi",
    path: "/attendance/my-records",
    icon: "calendar",
    group: "operation",
    order: 20,
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_OWN"],
  },
  // Scoped records — pair-as-gate (VIEW_TEAM/VIEW_COMPANY là cặp is_sensitive RIÊNG). filterSidebarItems ẩn
  // theo requiredAny cặp ĐÚNG; KHÔNG hard-code role. Employee (chỉ view-own) không thấy 2 item dưới đây.
  {
    sidebarKey: "att.team-records",
    moduleCode: "ATT",
    label: "Bảng công nhóm",
    path: "/attendance/team-records",
    icon: "users",
    group: "management",
    order: 30,
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_TEAM"],
  },
  {
    sidebarKey: "att.records",
    moduleCode: "ATT",
    label: "Bảng công toàn công ty",
    path: "/attendance/records",
    icon: "table",
    group: "management",
    order: 40,
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_COMPANY"],
  },
  // S3-FE-ATT-5 — ca làm việc / gán ca / rule (admin, read-only minimum). Gate = CẶP ENGINE THỰC trực
  // tiếp (KHÔNG FE code qua PERMISSION_CODE_TO_PAIR — tránh drift, cùng kỹ thuật system.login-logs).
  {
    sidebarKey: "att.shifts",
    moduleCode: "ATT",
    label: "Ca làm việc",
    path: "/attendance/shifts",
    icon: "clock",
    group: "management",
    order: 50,
    requiredAnyPermissions: ["view:shift"],
  },
  {
    sidebarKey: "att.shift-assignments",
    moduleCode: "ATT",
    label: "Gán ca",
    path: "/attendance/shift-assignments",
    icon: "calendar-clock",
    group: "management",
    order: 60,
    requiredAnyPermissions: ["view:shift-assignment"],
  },
  {
    sidebarKey: "att.rules",
    moduleCode: "ATT",
    label: "Rule chấm công",
    path: "/attendance/rules",
    icon: "shield-check",
    group: "management",
    order: 70,
    requiredAnyPermissions: ["view:attendance-rule"],
  },
  // S3-FE-ATT-3 — Đơn điều chỉnh công. view-own/view-team/view-company:adjustment là cặp SENSITIVE
  // KHÔNG allowlisted (permission.service.ts) → dùng cặp ALLOWLISTED liên quan (view-own/team/company:
  // attendance) làm reach-permission gợi ý ẩn/hiện menu — cổng thật vẫn ở server (xem adjustment/constants.ts).
  {
    sidebarKey: "att.adjustment-requests.my",
    moduleCode: "ATT",
    label: "Đơn điều chỉnh của tôi",
    path: "/attendance/adjustment-requests/my",
    icon: "file-edit",
    group: "operation",
    order: 25,
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_OWN"],
  },
  {
    sidebarKey: "att.adjustment-requests",
    moduleCode: "ATT",
    label: "Đơn điều chỉnh cần duyệt",
    path: "/attendance/adjustment-requests",
    icon: "check-circle",
    group: "management",
    order: 45,
    requiredAnyPermissions: ["ATT.ATTENDANCE.VIEW_TEAM", "ATT.ATTENDANCE.VIEW_COMPANY"],
  },
  // S3-FE-ATT-4 — đơn làm việc từ xa/công tác. Gate = requiredAny CẶP ENGINE THỰC (mỗi scope-level
  // RIÊNG) — ai có ÍT NHẤT 1 trong 4 (tạo/xem-own/xem-team/xem-company) đều thấy mục.
  {
    sidebarKey: "att.remote-work-requests",
    moduleCode: "ATT",
    label: "Làm việc từ xa/công tác",
    path: "/attendance/remote-work-requests",
    icon: "plane",
    group: "operation",
    order: 25,
    requiredAnyPermissions: [
      "create-own:remote-request",
      "view-own:remote-request",
      "view-team:remote-request",
      "view-company:remote-request",
    ],
  },
  // S3-FE-ATT-6 — báo cáo tổng hợp công + audit log ATT (report dùng chung cặp view-team/view-company:
  // attendance; audit log là cặp RIÊNG view:attendance-audit-log, KHÔNG chung với foundation audit-log).
  {
    sidebarKey: "att.reports",
    moduleCode: "ATT",
    label: "Báo cáo tổng hợp công",
    path: "/attendance/reports",
    icon: "bar-chart-3",
    group: "management",
    order: 80,
    requiredAnyPermissions: ["view-team:attendance", "view-company:attendance"],
  },
  {
    sidebarKey: "att.audit-logs",
    moduleCode: "ATT",
    label: "Audit log chấm công",
    path: "/attendance/audit-logs",
    icon: "file-clock",
    group: "management",
    order: 90,
    requiredAnyPermissions: ["view:attendance-audit-log"],
  },
];

// ---------------------------------------------------------------------------
// LEAVE — Nghỉ phép
// ---------------------------------------------------------------------------
export const LEAVE_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "leave.overview",
    moduleCode: "LEAVE",
    label: "Tổng quan",
    path: "/leave",
    icon: "calendar-days",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN", "LEAVE.REQUEST.VIEW"],
  },
  {
    sidebarKey: "leave.my-requests",
    moduleCode: "LEAVE",
    label: "Đơn nghỉ của tôi",
    path: "/leave/me/requests",
    icon: "file-text",
    group: "operation",
    order: 20,
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN"],
  },
  // S3-FE-LEAVE-7 — Số dư phép của tôi DỜI khỏi /leave (nay là hub tổng quan) → /leave/me/balances.
  // Gate = VIEW_OWN (mọi role có Own); route REUSE meta leave.overview (KHÔNG LEAVE.BALANCE.VIEW_OWN chưa map).
  {
    sidebarKey: "leave.my-balances",
    moduleCode: "LEAVE",
    label: "Số dư phép của tôi",
    path: "/leave/me/balances",
    icon: "wallet",
    group: "operation",
    order: 25,
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW_OWN"],
  },
  // S3-FE-LEAVE-2 PIN CỔNG: gate sidebar = CHỈ view:leave (LEAVE.REQUEST.VIEW) — khớp route
  // leave.approvals + BE GET /leave/requests (VIEW_LEAVE, SENSITIVE, mig 0455). KHÔNG gate
  // LEAVE.REQUEST.APPROVE: người chỉ có approve mà thiếu view sẽ 403 ở list-load ⇒ menu phải đòi
  // ĐÚNG cặp đọc chéo (manager/hr/company-admin có view:leave; employee KHÔNG → ẩn).
  {
    sidebarKey: "leave.approvals",
    moduleCode: "LEAVE",
    label: "Đơn cần duyệt",
    path: "/leave/approvals",
    icon: "check-circle",
    group: "operation",
    order: 30,
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW"],
  },
  // S3-FE-LEAVE-3 — LEAVE-SCREEN-006. Gate sidebar = CÙNG cặp view:leave với leave.approvals
  // (BE GET /leave/requests dùng chung endpoint) — màn hình này chỉ ĐỌC toàn bộ đơn trong phạm vi.
  {
    sidebarKey: "leave.all-requests",
    moduleCode: "LEAVE",
    label: "Tất cả đơn nghỉ",
    path: "/leave/requests",
    icon: "clipboard-list",
    group: "management",
    order: 40,
    requiredAnyPermissions: ["LEAVE.REQUEST.VIEW"],
  },
  // S3-FE-LEAVE-4 — LEAVE-SCREEN-007/008/009. Gate sidebar = CHỈ VIEW_OWN (mọi role có Own) — mọi
  // người thấy menu "Lịch nghỉ" (own luôn khả dụng); toggle team/company gate TINH hơn TRONG page.
  {
    sidebarKey: "leave.calendar",
    moduleCode: "LEAVE",
    label: "Lịch nghỉ",
    path: "/leave/calendar",
    icon: "calendar-days",
    group: "overview",
    order: 15,
    requiredAnyPermissions: ["LEAVE.CALENDAR.VIEW_OWN"],
  },
  // S5-LEAVE-HOLIDAYS-MOVE-1 — Ngày nghỉ lễ RE-HOME từ /system/public-holidays (đã gỡ khỏi SYSTEM_SIDEBAR).
  // Gate GIỮ NGUYÊN FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS (view:foundation-holiday, seed mig 0435) —
  // KHÔNG đổi permission/BE, chỉ đổi chỗ hiển thị: đây là dữ liệu nền cho tính công nghỉ phép nên hợp lý
  // hơn ở nhóm quản trị LEAVE (cạnh Loại/Chính sách nghỉ phép) thay vì Hệ thống.
  {
    sidebarKey: "leave.public-holidays",
    moduleCode: "LEAVE",
    label: "Ngày nghỉ lễ",
    path: "/leave/public-holidays",
    icon: "calendar-days",
    group: "admin",
    order: 59,
    requiredAnyPermissions: FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS,
  },
  // S3-FE-LEAVE-5 — admin (LEAVE-SCREEN-010/011/012). Gate = CẶP ENGINE THỰC trực tiếp (KHÔNG qua
  // PERMISSION_CODE_TO_PAIR — cùng kỹ thuật att.shifts/hr.org-chart, tránh drift). view:leave-type
  // KHÔNG sensitive (mọi role đọc được danh mục); view:leave-policy/view:leave-balance SENSITIVE
  // (Company-scope, chỉ hr/company-admin có grant thật).
  {
    sidebarKey: "leave.types",
    moduleCode: "LEAVE",
    label: "Loại nghỉ phép",
    path: "/leave/types",
    icon: "list-checks",
    group: "admin",
    order: 60,
    requiredAnyPermissions: ["view:leave-type"],
  },
  {
    sidebarKey: "leave.policies",
    moduleCode: "LEAVE",
    label: "Chính sách nghỉ phép",
    path: "/leave/policies",
    icon: "shield-check",
    group: "admin",
    order: 61,
    requiredAnyPermissions: ["view:leave-policy"],
  },
  {
    sidebarKey: "leave.balances",
    moduleCode: "LEAVE",
    label: "Số dư phép nhân viên",
    path: "/leave/balances",
    icon: "wallet",
    group: "admin",
    order: 62,
    requiredAnyPermissions: ["view:leave-balance"],
  },
  // S3-FE-LEAVE-6 — báo cáo tổng hợp nghỉ + audit log LEAVE. Gate = CẶP ENGINE THỰC trực tiếp (KHÔNG qua
  // PERMISSION_CODE_TO_PAIR): export:leave (Company-scope hr/company-admin) · view:leave-audit-log RIÊNG
  // (KHÔNG chung foundation view:audit-log). Cả 2 SENSITIVE → phơi qua /auth/me nhờ S2-AUTH-CAP-1.
  {
    sidebarKey: "leave.reports",
    moduleCode: "LEAVE",
    label: "Báo cáo tổng hợp nghỉ",
    path: "/leave/reports",
    icon: "bar-chart-3",
    group: "admin",
    order: 63,
    requiredAnyPermissions: ["export:leave"],
  },
  {
    sidebarKey: "leave.audit-logs",
    moduleCode: "LEAVE",
    label: "Audit log nghỉ phép",
    path: "/leave/audit-logs",
    icon: "file-clock",
    group: "admin",
    order: 64,
    requiredAnyPermissions: ["view:leave-audit-log"],
  },
];

// ---------------------------------------------------------------------------
// TASK — Công việc
//
// Doc CHUẨN sidebar TASK = FRONTEND-11 §8.1 (bản hợp nhất S5-TASK-NAV-TREE-1 — UI-09 §11.2 và
// UI-02 §9.8 trỏ về đó, KHÔNG tự khai bố cục riêng). 4 item tĩnh dưới đây + section ĐỘNG "Dự án
// theo phòng ban" (TaskSidebarTree, đăng ký ở sidebar-extensions.ts — cần React Query nên không
// khai được ở registry data thuần). ROUTE_REGISTRY (web-core) đồng bộ 4 routeKey cùng tên;
// showInSidebar ở đó là metadata chết — ModuleSidebar CHỈ đọc registry này.
// ---------------------------------------------------------------------------
export const TASK_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "task.overview",
    moduleCode: "TASK",
    // S5-FE-TASK-NAV-1: /tasks render TaskListPage (TASK-SCREEN-005) — label cũ "Tổng quan" gây hiểu nhầm.
    label: "Danh sách công việc",
    path: "/tasks",
    icon: "kanban-square",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["TASK.TASK.VIEW", "TASK.PROJECT.VIEW"],
  },
  {
    sidebarKey: "task.my-tasks",
    moduleCode: "TASK",
    label: "Việc của tôi",
    path: "/tasks/my-tasks",
    icon: "check-square",
    group: "operation",
    order: 20,
    requiredAnyPermissions: ["TASK.TASK.VIEW"],
  },
  // S5-FE-TASK-6 — Task quá hạn (TASK-SCREEN-010). Gate TASK.TASK.VIEW (như danh sách). icon
  // "alert-triangle" CÓ trong DynamicIcon.ICON_MAP (tránh fallback Circle).
  {
    sidebarKey: "task.overdue",
    moduleCode: "TASK",
    label: "Task quá hạn",
    path: "/tasks/overdue",
    icon: "alert-triangle",
    group: "operation",
    order: 25,
    requiredAnyPermissions: ["TASK.TASK.VIEW"],
  },
  // S5-FE-TASK-NAV-1: route task.projects.list có trong ROUTE_REGISTRY web-core (showInSidebar) nhưng
  // ModuleSidebar dựng menu từ registry NÀY — phải khai item ở đây mới thấy (SCREEN-001 trước đó mồ côi).
  {
    sidebarKey: "task.projects",
    moduleCode: "TASK",
    label: "Dự án",
    path: "/tasks/projects",
    icon: "folder-kanban",
    group: "operation",
    order: 30,
    requiredAnyPermissions: ["TASK.PROJECT.VIEW"],
  },
];

// ---------------------------------------------------------------------------
// NOTI — Thông báo
// ---------------------------------------------------------------------------
export const NOTI_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "noti.list",
    moduleCode: "NOTI",
    label: "Tất cả thông báo",
    path: "/notifications",
    icon: "bell",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["NOTI.NOTIFICATION.VIEW_OWN"],
  },
  // S4-FE-NOTI-4 follow-up: route đã có trong web-core ROUTE_REGISTRY (noti.templates/delivery-logs,
  // showInSidebar) nhưng ModuleSidebar dựng menu từ sidebar-registry NÀY — showInSidebar bên kia không
  // được đọc, nên phải khai item ở đây mới thấy trên UI. Gate = cặp engine literal đồng bộ route-meta
  // (mẫu HR_ORG_CHART); cặp sensitive chỉ vào capabilities khi grant explicit → thiếu quyền item tự ẩn.
  {
    sidebarKey: "noti.events",
    moduleCode: "NOTI",
    label: "Sự kiện thông báo",
    path: "/notifications/events",
    icon: "sliders-horizontal",
    group: "admin",
    order: 61,
    requiredAnyPermissions: ["view:notification-config"],
  },
  {
    sidebarKey: "noti.templates",
    moduleCode: "NOTI",
    label: "Template thông báo",
    path: "/notifications/templates",
    icon: "file-text",
    group: "admin",
    order: 62,
    requiredAnyPermissions: ["view:notification-template"],
  },
  {
    sidebarKey: "noti.delivery-logs",
    moduleCode: "NOTI",
    label: "Nhật ký gửi",
    path: "/notifications/delivery-logs",
    icon: "file-clock",
    group: "admin",
    order: 63,
    requiredAnyPermissions: ["view:notification-delivery-log"],
  },
];

// ---------------------------------------------------------------------------
// FOUNDATION — Hệ thống
// ---------------------------------------------------------------------------
export const SYSTEM_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "system.overview",
    moduleCode: "FOUNDATION",
    label: "Tổng quan hệ thống",
    path: "/system",
    icon: "settings",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW", "AUTH.USER.VIEW"],
  },
  // S2-FE-FND-1 (FND1-APP) — ADDITIVE. Gate theo cặp seed THẬT mig 0435 (FOUNDATION.COMPANY.VIEW →
  // view:foundation-company; FOUNDATION.SETTING.VIEW → view:foundation-setting). filterSidebarItems ẩn
  // khi thiếu — KHÔNG hard-code role.
  {
    sidebarKey: "system.company",
    moduleCode: "FOUNDATION",
    label: "Hồ sơ công ty",
    path: "/system/company",
    icon: "building-2",
    group: "admin",
    order: 15,
    requiredAnyPermissions: ["FOUNDATION.COMPANY.VIEW"],
  },
  {
    sidebarKey: "system.company-settings",
    moduleCode: "FOUNDATION",
    label: "Cấu hình công ty",
    path: "/system/company/settings",
    icon: "sliders-horizontal",
    group: "admin",
    order: 16,
    requiredAnyPermissions: ["FOUNDATION.SETTING.VIEW"],
  },
  {
    sidebarKey: "system.users",
    moduleCode: "FOUNDATION",
    label: "Người dùng",
    path: "/system/users",
    icon: "users",
    group: "admin",
    order: 20,
    requiredAnyPermissions: ["AUTH.USER.VIEW"],
  },
  {
    sidebarKey: "system.roles",
    moduleCode: "FOUNDATION",
    label: "Vai trò",
    path: "/system/roles",
    icon: "shield",
    group: "admin",
    order: 30,
    requiredAnyPermissions: ["AUTH.ROLE.VIEW"],
  },
  // S2-FE-AUTH-4 (lane FE batch C) — danh mục quyền toàn cục (đọc).
  {
    sidebarKey: "system.permissions",
    moduleCode: "FOUNDATION",
    label: "Danh mục quyền",
    path: "/system/permissions",
    icon: "key-round",
    group: "admin",
    order: 31,
    requiredAnyPermissions: ["AUTH.PERMISSION.VIEW"],
  },
  // S2-FE-FND-2: gate theo cặp ENGINE THỰC ('view:audit-log', seed mig 0340, grant company-admin) —
  // literal pair (cùng kỹ thuật system.login-logs), KHÔNG dùng mã FE FOUNDATION.AUDIT_LOG.VIEW qua
  // PERMISSION_CODE_TO_PAIR (bài học drift: cặp map cũ 'view:foundation-audit-log' KHÔNG được
  // AuditController enforce — sẽ tạo hố FE-hiện-BE-403).
  {
    sidebarKey: "system.audit-logs",
    moduleCode: "FOUNDATION",
    label: "Audit log",
    path: "/system/audit-logs",
    icon: "file-clock",
    group: "report",
    order: 40,
    requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  },
  // S2-AUTH-BE-5 — viewer nhật ký bảo mật. Gate theo cặp ENGINE THỰC ('view:audit-log',
  // seed mig 0340, grant company-admin), KHÔNG mã FE → filterSidebarItems khớp trực tiếp
  // capabilities (tránh drift PERMISSION_CODE_TO_PAIR).
  {
    sidebarKey: "system.login-logs",
    moduleCode: "FOUNDATION",
    label: "Nhật ký đăng nhập",
    path: "/system/login-logs",
    icon: "log-in",
    group: "report",
    order: 41,
    requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  },
  {
    sidebarKey: "system.security-events",
    moduleCode: "FOUNDATION",
    label: "Sự kiện bảo mật",
    path: "/system/security-events",
    icon: "shield-alert",
    group: "report",
    order: 42,
    requiredAnyPermissions: [AUDIT_LOG_VIEW_PERMISSION],
  },
  // S2-FE-FND-2 — viewer file metadata. Cặp seed THẬT view:foundation-file (mig 0435, is_sensitive=false,
  // bulk-grant company-admin qua LIKE 'foundation-%').
  {
    sidebarKey: "system.files",
    moduleCode: "FOUNDATION",
    label: "Tệp tin",
    path: "/system/files",
    icon: "file",
    group: "report",
    order: 43,
    requiredAnyPermissions: [FOUNDATION_FILE_VIEW_PERMISSION],
  },
  // S2-FE-FND-3 — Module Catalog admin. Cặp seed THẬT view:foundation-module (mig 0435 dòng 338,
  // is_sensitive=false, bulk-grant company-admin qua LIKE 'foundation-%') — cặp ModuleAdminController
  // thật sự @RequirePermission (S2-FND-BE-1).
  {
    sidebarKey: "system.modules",
    moduleCode: "FOUNDATION",
    label: "Danh mục module",
    path: "/system/modules",
    icon: "layout-grid",
    group: "admin",
    order: 21,
    requiredAnyPermissions: [FOUNDATION_MODULE_VIEW_PERMISSION],
  },
  // S2-FE-FND-5 (lane FE batch C) — Sequence counters + Seed status (ops admin). Gate theo cặp SEED
  // THẬT mig 0435 (view:foundation-sequence / view:foundation-seed) qua PERMISSION_CODE_TO_PAIR.
  {
    sidebarKey: "system.sequences",
    moduleCode: "FOUNDATION",
    label: "Bộ đếm mã",
    path: "/system/sequences",
    icon: "hash",
    group: "admin",
    order: 35,
    requiredAnyPermissions: ["FOUNDATION.SEQUENCE.VIEW"],
  },
  {
    sidebarKey: "system.seeds",
    moduleCode: "FOUNDATION",
    label: "Trạng thái Seed",
    path: "/system/seeds",
    icon: "database",
    group: "admin",
    order: 36,
    requiredAnyPermissions: ["FOUNDATION.SEED.VIEW"],
  },
  // S2-FE-FND-7 (H8/§7) — 3 màn System đã wired (S2-FE-FND-4/6) nhưng THIẾU visibility trong sidebar.
  // requiredAnyPermissions = CHÍNH mảng của route-meta (foundation/constants) → sidebar pair ===
  // route-meta pair, chống pair-drift. filterSidebarItems ẩn theo cặp — KHÔNG hard-code role.
  //
  // S5-LEAVE-HOLIDAYS-MOVE-1: entry "system.public-holidays" (Ngày nghỉ lễ) ĐÃ GỠ khỏi đây — màn RE-HOME
  // sang LEAVE_SIDEBAR bên dưới (path /leave/public-holidays, cùng gate FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS).
  // Retention: gate view:foundation-retention (KHÔNG manage — manage sensitive, ẩn nhầm company-admin).
  {
    sidebarKey: "system.retention",
    moduleCode: "FOUNDATION",
    label: "Chính sách lưu trữ",
    path: FOUNDATION_PATH.RETENTION,
    icon: "archive",
    group: "admin",
    order: 37,
    requiredAnyPermissions: SYSTEM_RETENTION_ROUTE_META.requiredAnyPermissions,
  },
  // Health: gate ĐỦ CẢ 2 cặp [view:foundation-setting, view:user] khớp systemHealthMeta (1 cặp = mismatch).
  {
    sidebarKey: "system.health",
    moduleCode: "FOUNDATION",
    label: "Tình trạng hệ thống",
    path: FOUNDATION_PATH.HEALTH,
    icon: "activity",
    group: "report",
    order: 44,
    requiredAnyPermissions: SYSTEM_HEALTH_ROUTE_META.requiredAnyPermissions,
  },
  {
    sidebarKey: "system.file-access-logs",
    moduleCode: "FOUNDATION",
    label: "Nhật ký truy cập tệp",
    path: FOUNDATION_PATH.FILE_ACCESS_LOGS,
    icon: "file-search",
    group: "report",
    order: 45,
    requiredAnyPermissions: SYSTEM_FILE_ACCESS_LOGS_ROUTE_META.requiredAnyPermissions,
  },
  // S5-FND-JOBS-OBS-1 — /system/jobs (System Jobs observability, READ-ONLY). Gate view:foundation-job
  // (KHÔNG sensitive, company-admin có sẵn qua bulk-grant mig 0435).
  {
    sidebarKey: "system.jobs",
    moduleCode: "FOUNDATION",
    label: "Nhật ký system job",
    path: FOUNDATION_PATH.SYSTEM_JOBS,
    icon: "activity",
    group: "report",
    order: 46,
    requiredAnyPermissions: SYSTEM_JOBS_ROUTE_META.requiredAnyPermissions,
  },
  // S2-FE-FND-8 — /system/settings (System Settings admin, UI-SYSTEM-SCREEN-004). Trước đây gộp vào
  // "Cấu hình công ty" (system.company-settings) chờ BE endpoint riêng — BE đã ship (S2-FND-BE-8), tách
  // entry riêng. requiredAnyPermissions dùng CHUNG route-meta (chống pair-drift, giống 4 entry S2-FE-FND-7).
  {
    sidebarKey: "system.settings",
    moduleCode: "FOUNDATION",
    label: "Cấu hình hệ thống",
    path: FOUNDATION_PATH.SYSTEM_SETTINGS,
    icon: "shield-alert",
    group: "admin",
    order: 17,
    requiredAnyPermissions: SYSTEM_SETTINGS_ROUTE_META.requiredAnyPermissions,
  },
];

// ---------------------------------------------------------------------------
// ME — Trung tâm cá nhân (S5-ME-FE-1, SPEC-09 §8.1)
// ---------------------------------------------------------------------------
//
// SPEC-09 §8.1 liệt kê 6 nhóm (Tổng quan/Hồ sơ của tôi/Tài khoản & bảo mật/Công việc của tôi/Thông báo/
// Cài đặt cá nhân) — WO này CHỈ build màn Tổng quan (ME-SCREEN-001, route "/me"); 5 nhóm còn lại do
// S5-ME-FE-2/FE-3 APPEND theo route thật của họ (tránh sidebar trỏ vào route chưa tồn tại = link chết).
// Gate = cặp engine THẬT `access:me` trực tiếp (mirror ROUTE_REGISTRY "me.overview" — cùng cặp, không drift).
//
// S5-ME-FE-3 — APPEND 3 nhóm "Công việc của tôi"/"Thông báo"/"Cài đặt cá nhân" (§8.1, ME-SCREEN-009..014).
// `group` dùng NGUYÊN VĂN nhãn tiếng Việt (KHÔNG phải key enum như overview/operation/…): ModuleSidebar.tsx
// (NGOÀI phạm vi lane này — chỉ sửa file registry) render `GROUP_LABELS[group] ?? group`; group lạ (không
// có trong GROUP_LABELS) fallback IN NGUYÊN chuỗi — đặt group = nhãn hiển thị THẬT nên hiện đúng chữ mà
// KHÔNG cần đụng ModuleSidebar.tsx. Thứ tự nhóm hiển thị theo thứ tự XUẤT HIỆN LẦN ĐẦU trong mảng này
// (Object.keys giữ thứ tự chèn ở ModuleSidebar.grouped).
export const ME_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "me.overview",
    moduleCode: "ME",
    label: "Tổng quan",
    path: "/me",
    icon: "user-circle",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.attendance",
    moduleCode: "ME",
    label: "Chấm công",
    path: "/me/attendance",
    icon: "clock",
    group: "Công việc của tôi",
    order: 20,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.leave",
    moduleCode: "ME",
    label: "Nghỉ phép",
    path: "/me/leave",
    icon: "calendar-days",
    group: "Công việc của tôi",
    order: 21,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.tasks",
    moduleCode: "ME",
    label: "Task của tôi",
    path: "/me/tasks",
    icon: "kanban-square",
    group: "Công việc của tôi",
    order: 22,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.notifications",
    moduleCode: "ME",
    label: "Thông báo của tôi",
    path: "/me/notifications",
    icon: "bell",
    group: "Thông báo",
    order: 30,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.preferences.notifications",
    moduleCode: "ME",
    label: "Tuỳ chọn thông báo",
    path: "/me/preferences/notifications",
    icon: "sliders-horizontal",
    group: "Thông báo",
    order: 31,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.preferences.appearance",
    moduleCode: "ME",
    label: "Giao diện",
    path: "/me/preferences/appearance",
    // "palette" KHÔNG có trong DynamicIcon.ICON_MAP (file NGOÀI phạm vi lane này) — dùng "settings" (đã
    // map sẵn) để tránh fallback Circle vô nghĩa.
    icon: "settings",
    group: "Cài đặt cá nhân",
    order: 40,
    requiredAnyPermissions: ["access:me"],
  },
  // S5-ME-FE-2 — APPEND 2 nhóm "Hồ sơ của tôi"/"Tài khoản & bảo mật" (§8.1, ME-SCREEN-002..008). 5 màn
  // TÁI DÙNG page sẵn có (MyProfilePage/MyChangeRequestPage/AccountProfilePage/ChangePasswordPage/
  // AccountSessionsPage) mount trong ME workspace qua ROUTE_REGISTRY "me.profile"/…; icon CHỌN TRONG
  // DynamicIcon.ICON_MAP đã có sẵn (tránh fallback Circle, cùng ghi chú "Giao diện" ở trên) — KHÔNG
  // "file-edit" (dùng ở HR_SIDEBAR/ATT_SIDEBAR nhưng KHÔNG map trong ICON_MAP, ngoài phạm vi lane này).
  {
    sidebarKey: "me.profile",
    moduleCode: "ME",
    label: "Hồ sơ của tôi",
    path: "/me/profile",
    icon: "user",
    group: "Hồ sơ của tôi",
    order: 45,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.profile.change-requests",
    moduleCode: "ME",
    label: "Yêu cầu cập nhật hồ sơ",
    path: "/me/profile/change-requests",
    icon: "clipboard-list",
    group: "Hồ sơ của tôi",
    order: 46,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.account",
    moduleCode: "ME",
    label: "Tài khoản",
    path: "/me/account",
    icon: "user-circle",
    group: "Tài khoản & bảo mật",
    order: 47,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.security.password",
    moduleCode: "ME",
    label: "Đổi mật khẩu",
    path: "/me/security/password",
    icon: "key-round",
    group: "Tài khoản & bảo mật",
    order: 48,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.security.sessions",
    moduleCode: "ME",
    label: "Phiên đăng nhập",
    path: "/me/security/sessions",
    icon: "log-in",
    group: "Tài khoản & bảo mật",
    order: 49,
    requiredAnyPermissions: ["access:me"],
  },
  {
    sidebarKey: "me.security.activity",
    moduleCode: "ME",
    label: "Hoạt động bảo mật",
    path: "/me/security/activity",
    icon: "shield-alert",
    group: "Tài khoản & bảo mật",
    order: 50,
    requiredAnyPermissions: ["access:me"],
  },
  // Tích hợp LMS Giai đoạn A: mở LMS qua cầu SSO (/lms fetch sso-link rồi chuyển trang).
  // Gate access:lms (KHÔNG access:me) — nhất quán với card Trang chủ + endpoint BE: ai bị thu quyền
  // KHÔNG thấy link này. (mig 0508 cấp mặc định cho 4 role canonical.)
  {
    sidebarKey: "me.lms",
    moduleCode: "ME",
    label: "Đào tạo (LMS)",
    path: "/lms",
    icon: "graduation-cap",
    group: "Đào tạo",
    order: 60,
    requiredAnyPermissions: ["access:lms"],
  },
];

// ---------------------------------------------------------------------------
// Map moduleCode → sidebar items
// ---------------------------------------------------------------------------
import { type ModuleCode } from "@mediaos/web-core";

export const SIDEBAR_REGISTRY: Partial<Record<ModuleCode, readonly SidebarItemMeta[]>> = {
  DASH: DASH_SIDEBAR,
  HR: HR_SIDEBAR,
  ATT: ATT_SIDEBAR,
  LEAVE: LEAVE_SIDEBAR,
  TASK: TASK_SIDEBAR,
  NOTI: NOTI_SIDEBAR,
  FOUNDATION: SYSTEM_SIDEBAR,
  ME: ME_SIDEBAR,
};

export function getSidebarItems(moduleCode: ModuleCode): readonly SidebarItemMeta[] {
  return SIDEBAR_REGISTRY[moduleCode] ?? [];
}

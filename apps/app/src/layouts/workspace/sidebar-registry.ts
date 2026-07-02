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
  {
    sidebarKey: "hr.me",
    moduleCode: "HR",
    label: "Hồ sơ của tôi",
    path: "/hr/me",
    icon: "user",
    group: "operation",
    order: 20,
    requiredAnyPermissions: ["HR.EMPLOYEE.VIEW"],
  },
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
];

// ---------------------------------------------------------------------------
// TASK — Công việc
// ---------------------------------------------------------------------------
export const TASK_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "task.overview",
    moduleCode: "TASK",
    label: "Tổng quan",
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
};

export function getSidebarItems(moduleCode: ModuleCode): readonly SidebarItemMeta[] {
  return SIDEBAR_REGISTRY[moduleCode] ?? [];
}

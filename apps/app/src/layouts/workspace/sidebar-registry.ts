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
  {
    sidebarKey: "leave.approvals",
    moduleCode: "LEAVE",
    label: "Đơn cần duyệt",
    path: "/leave/approvals",
    icon: "check-circle",
    group: "operation",
    order: 30,
    requiredAnyPermissions: ["LEAVE.REQUEST.APPROVE", "LEAVE.REQUEST.VIEW"],
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
  {
    sidebarKey: "system.audit-logs",
    moduleCode: "FOUNDATION",
    label: "Audit log",
    path: "/system/audit-logs",
    icon: "file-clock",
    group: "report",
    order: 40,
    requiredAnyPermissions: ["FOUNDATION.AUDIT_LOG.VIEW"],
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

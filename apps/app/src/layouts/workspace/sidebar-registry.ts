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
  // S2-FE-HR-5 — dữ liệu gốc HR. Gate theo cặp SEED THẬT (qua PERMISSION_CODE_TO_PAIR):
  // phòng ban/chức vụ = cặp ĐỌC; cấp bậc/loại hợp đồng = manage:master-data DUY NHẤT (SPEC-03 §13.12b/c).
  {
    sidebarKey: "hr.departments",
    moduleCode: "HR",
    label: "Phòng ban",
    path: "/hr/departments",
    icon: "building-2",
    group: "master-data",
    order: 40,
    requiredAnyPermissions: ["HR.DEPARTMENT.VIEW"],
  },
  {
    sidebarKey: "hr.positions",
    moduleCode: "HR",
    label: "Chức vụ",
    path: "/hr/positions",
    icon: "briefcase",
    group: "master-data",
    order: 41,
    requiredAnyPermissions: ["HR.POSITION.VIEW"],
  },
  {
    sidebarKey: "hr.job-levels",
    moduleCode: "HR",
    label: "Cấp bậc",
    path: "/hr/job-levels",
    icon: "layers",
    group: "master-data",
    order: 42,
    requiredAnyPermissions: ["HR.MASTER_DATA.MANAGE"],
  },
  {
    sidebarKey: "hr.contract-types",
    moduleCode: "HR",
    label: "Loại hợp đồng",
    path: "/hr/contract-types",
    icon: "file-text",
    group: "master-data",
    order: 43,
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

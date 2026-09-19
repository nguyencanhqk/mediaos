import { type SidebarItemMeta } from "@mediaos/web-core";
import { HR_AUDIT_LOG_VIEW_PERMISSION } from "@/routes/hr/audit-logs/constants";
import { HR_ENGINE_PAIRS } from "@/routes/hr/constants";
import {
  PCR_APPROVE_PERMISSION,
  PCR_LIST_PATH,
} from "@/routes/hr/profile-change-requests/constants";
import {
  EMPLOYEE_CODE_CONFIG_PATH,
  EMPLOYEE_CODE_CONFIG_VIEW_PERMISSION,
} from "@/routes/hr/settings/constants";

const HR_ORG_CHART_VIEW_PERMISSION = `${HR_ENGINE_PAIRS.ORG_CHART_VIEW.action}:${HR_ENGINE_PAIRS.ORG_CHART_VIEW.resourceType}`;

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
  // "Yêu cầu sửa hồ sơ" (/hr/me/change-request) GỠ khỏi sidebar HR 2026-07-21 — trùng với ME
  // "Yêu cầu cập nhật hồ sơ" (/me/profile/change-requests, sidebarKey me.profile.change-requests)
  // sau S5-ME-FE-2. Route cũ trong router.tsx giờ REDIRECT sang đường dẫn ME để bookmark không gãy.
  // Màn HR duyệt (hr.profile-change-requests bên dưới) GIỮ NGUYÊN.
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

import { type SidebarItemMeta } from "@mediaos/web-core";
import { FOUNDATION_HOLIDAY_ROUTE_PERMISSIONS } from "@/routes/system/foundation/constants";

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

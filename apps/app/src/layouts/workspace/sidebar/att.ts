import { type SidebarItemMeta } from "@mediaos/web-core";

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

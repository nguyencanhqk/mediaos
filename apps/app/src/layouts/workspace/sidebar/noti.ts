import { type SidebarItemMeta } from "@mediaos/web-core";

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

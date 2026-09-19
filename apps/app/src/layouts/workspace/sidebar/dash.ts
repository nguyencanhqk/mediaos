import { type SidebarItemMeta } from "@mediaos/web-core";

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

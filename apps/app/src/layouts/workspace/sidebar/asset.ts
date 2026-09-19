import { type SidebarItemMeta } from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// ASSET — Quản lý tài sản (S11-ASSET-FE-1, SPEC-13, wave S11-OFFICE)
// ---------------------------------------------------------------------------
//
// Gate ĐỦ CẢ HAI cặp engine LITERAL `access:asset` + `view:asset` (seed 0550) — KHÔNG qua
// PERMISSION_CODE_TO_PAIR (họ access:me/access:goal). Vì sao cả hai: cả hai mục đều tải dữ liệu qua
// `view:asset`, nên gate mục PHẢI khớp gate đường tải — thu `view:asset` per-role thì mục biến mất,
// không phải hiện ra rồi đâm vào trang lỗi (read-path-gate-pair-must-match-download-pair).
//
// Quyền GHI (create/update/assign/revoke/dispose/manage-*) KHÔNG gate ở đây: sidebar là cổng nav.
// Màn quản trị loại (ASSET-SCREEN-007) là hộp thoại TRONG /assets, không phải mục riêng.
export const ASSET_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "asset.list",
    moduleCode: "ASSET",
    label: "Danh sách tài sản",
    path: "/assets",
    icon: "package",
    group: "overview",
    order: 10,
    requiredPermissions: ["access:asset", "view:asset"],
  },
  {
    sidebarKey: "asset.inventories",
    moduleCode: "ASSET",
    label: "Kiểm kê",
    path: "/assets/inventories",
    icon: "clipboard-list",
    group: "overview",
    order: 20,
    requiredPermissions: ["access:asset", "view:asset"],
  },
];

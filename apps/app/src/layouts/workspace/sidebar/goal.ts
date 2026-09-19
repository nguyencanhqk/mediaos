import { type SidebarItemMeta } from "@mediaos/web-core";

// ---------------------------------------------------------------------------
// GOAL — Mục tiêu (S5-GOAL-FE-1, SPEC-10, GOAL-DEC-002 module RIÊNG)
// ---------------------------------------------------------------------------
//
// Menu "Mục tiêu" đứng RIÊNG (KHÔNG chôn trong Task). Gate cặp engine THẬT `access:goal` (mig 0506,
// non-sensitive, grant Own cho 4 role canonical) — literal (KHÔNG PERMISSION_CODE_TO_PAIR, giống ME).
// filterSidebarItems ẩn khi thiếu quyền — KHÔNG hard-code role. Chi tiết/tạo/sửa vào từ trang list
// (không sidebar item riêng — mirror HR employees detail/edit).
export const GOAL_SIDEBAR: readonly SidebarItemMeta[] = [
  {
    sidebarKey: "goal.list",
    moduleCode: "GOAL",
    label: "Mục tiêu",
    path: "/goals",
    icon: "target",
    group: "overview",
    order: 10,
    requiredAnyPermissions: ["access:goal"],
  },
];

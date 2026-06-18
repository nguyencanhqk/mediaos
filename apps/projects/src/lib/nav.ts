import { FolderKanban } from "lucide-react";
import { type NavItem } from "@mediaos/web-core";

/**
 * NAV registry của apps/projects (Dự án — tenant, aud=user) — SUBSET category `work`.
 * Dùng chung bởi app-shell (sidebar) và trang chủ launcher của riêng app này.
 *
 * Types + danh mục category + helper gom nhóm đến từ @mediaos/web-core (dùng chung mọi app);
 * file này CHỈ khai NAV_ITEMS subset của app Dự án.
 */
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
} from "@mediaos/web-core";

export const NAV_ITEMS: readonly NavItem[] = [
  // — Công việc — danh sách dự án (mỗi dự án có Board/List/Settings riêng ở route con).
  {
    id: "projectsList",
    labelKey: "projectsList",
    to: "/",
    icon: FolderKanban,
    tile: "bg-violet-500/12 text-violet-600",
    category: "work",
  },
] as const;

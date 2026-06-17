import { KeyRound, Settings, ShieldAlert } from "lucide-react";
import { type NavItem } from "@mediaos/web-core";

/**
 * NAV registry của apps/web (monolith đang teo dần) — nguồn sự thật điều hướng của phần CÒN LẠI trên web.
 * Dùng chung bởi app-shell (sidebar) và trang chủ launcher.
 *
 * Types + danh mục category + helper gom nhóm đến từ @mediaos/web-core (dùng chung mọi app);
 * file này CHỈ khai NAV_ITEMS đầy đủ. Khi tách app (Wave 2) mỗi app khai subset riêng.
 *
 * FS-2 dời `hr`/`attendance`/`payroll` (→apps/people); FS-3 dời `work`/`process`/`goals` (→apps/studio).
 * Chỉ còn `system` (→apps/console ở FS-4). Wave 3 xoá apps/web.
 */
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
} from "@mediaos/web-core";

export const NAV_ITEMS: readonly NavItem[] = [
  // — Hệ thống —
  { id: "platformAccounts", labelKey: "platformAccounts", to: "/settings/platform-accounts", icon: KeyRound, tile: "bg-slate-500/12 text-slate-600", category: "system" },
  { id: "breakGlass", labelKey: "breakGlass", to: "/settings/break-glass", icon: ShieldAlert, tile: "bg-red-500/12 text-red-600", category: "system" },
  { id: "companySettings", labelKey: "companySettings", to: "/settings/company", icon: Settings, tile: "bg-slate-500/12 text-slate-600", category: "system" },
] as const;

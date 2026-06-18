import {
  BarChart2,
  Briefcase,
  Building2,
  ClipboardList,
  KeyRound,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { type NavItem } from "@mediaos/web-core";

/**
 * NAV registry của apps/console (Hệ thống — tenant, aud=user) — SUBSET category `system`.
 * Dùng chung bởi app-shell (sidebar) và trang chủ launcher của riêng app này.
 *
 * Types + danh mục category + helper gom nhóm đến từ @mediaos/web-core (dùng chung mọi app);
 * file này CHỈ khai NAV_ITEMS subset của app Hệ thống. TÁCH BẠCH operator plane apps/admin.
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
  // Self-service — authGuard only, KHÔNG permission-gate (mỗi user tự quản 2FA của mình, giống đổi mật khẩu).
  { id: "accountSecurity", labelKey: "accountSecurity", to: "/settings/security", icon: ShieldCheck, tile: "bg-emerald-500/12 text-emerald-600", category: "system" },
  { id: "companySettings", labelKey: "companySettings", to: "/settings/company", icon: Settings, tile: "bg-slate-500/12 text-slate-600", category: "system" },
  // CS-1: Nhật ký hoạt động — subcategory "Kiểm toán" mở khoá sidebar 2 cấp cho console.
  { id: "activityLog", labelKey: "activityLog", to: "/system/activity-log", icon: ClipboardList, tile: "bg-violet-500/12 text-violet-600", category: "system", subcategory: "Kiểm toán" },
  // CS-3: Quản lý danh mục — Cơ cấu tổ chức + Vị trí công việc.
  { id: "orgStructure", labelKey: "orgStructure", to: "/system/org-structure", icon: Building2, tile: "bg-blue-500/12 text-blue-600", category: "system", subcategory: "Quản lý danh mục" },
  { id: "positions", labelKey: "positions", to: "/system/positions", icon: Briefcase, tile: "bg-indigo-500/12 text-indigo-600", category: "system", subcategory: "Quản lý danh mục" },
  // CS-4: Đối tượng — danh bạ Người dùng / Nhân viên — subcategory "Quản lý danh mục".
  { id: "objects", labelKey: "objects", to: "/system/objects", icon: Users, tile: "bg-blue-500/12 text-blue-600", category: "system", subcategory: "Quản lý danh mục" },
  // CS-2: Phân quyền (RBAC) — nhóm riêng "Phân quyền" theo IA (gán/thu vai trò + quyền theo đối tượng).
  { id: "permissions", labelKey: "permissions", to: "/system/permissions", icon: Shield, tile: "bg-amber-500/12 text-amber-600", category: "system", subcategory: "Phân quyền" },
  // CS-7: Tình hình sử dụng — thống kê login, last-login, task per-tenant (nhóm riêng theo IA, KHÔNG gộp Kiểm toán).
  { id: "usageStats", labelKey: "usageStats", to: "/system/usage", icon: BarChart2, tile: "bg-blue-500/12 text-blue-600", category: "system", subcategory: "Tình hình sử dụng" },
] as const;

import {
  BarChart2,
  Briefcase,
  Building2,
  ClipboardList,
  KeyRound,
  Mail,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  UserCircle,
  UserCog,
  Users,
  Webhook,
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

// Bảng màu ô icon launcher — nền tint /15 giữ nguyên cả 2 theme; chữ icon đậm hơn ở
// light (-700) và sáng hơn ở dark (-300) để giữ nhận diện màu per-mục mà vẫn đọc được.
// Mục trung tính (slate/zinc) đổi hẳn sang token bg-muted/text-muted-foreground.
export const NAV_ITEMS: readonly NavItem[] = [
  // — Hệ thống —
  {
    id: "platformAccounts",
    labelKey: "platformAccounts",
    to: "/settings/platform-accounts",
    icon: KeyRound,
    tile: "bg-muted text-muted-foreground",
    category: "system",
  },
  {
    id: "breakGlass",
    labelKey: "breakGlass",
    to: "/settings/break-glass",
    icon: ShieldAlert,
    tile: "bg-red-500/15 text-red-700 dark:text-red-400",
    category: "system",
  },
  // Self-service — authGuard only, KHÔNG permission-gate (mỗi user tự quản tài khoản của mình).
  // ACCT-1 (Module 2a): Tài khoản của tôi — hồ sơ + đổi mật khẩu. Bảo mật (2FA) tách riêng bên dưới.
  {
    id: "myAccount",
    labelKey: "myAccount",
    to: "/settings/account",
    icon: UserCircle,
    tile: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    category: "system",
  },
  {
    id: "accountSecurity",
    labelKey: "accountSecurity",
    to: "/settings/security",
    icon: ShieldCheck,
    tile: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    category: "system",
  },
  {
    id: "companySettings",
    labelKey: "companySettings",
    to: "/settings/company",
    icon: Settings,
    tile: "bg-muted text-muted-foreground",
    category: "system",
  },
  // CS-8: Cấu hình mail server (SMTP, secret) — tenant self-service, permission configure-mail:company.
  {
    id: "mailConfig",
    labelKey: "mailConfig",
    to: "/settings/mail-config",
    icon: Mail,
    tile: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    category: "system",
  },
  // CS-9: Bảo mật nâng cao — chính sách bảo mật per-company (IP/giờ/email-domain/2FA). Gate quyền
  // configure-security-policy:company xử lý trong component (mirror activity-log/usage).
  {
    id: "securityPolicy",
    labelKey: "securityPolicy",
    to: "/settings/security-policy",
    icon: ShieldCheck,
    tile: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    category: "system",
  },
  // CS-1: Nhật ký hoạt động — subcategory "Kiểm toán" mở khoá sidebar 2 cấp cho console.
  {
    id: "activityLog",
    labelKey: "activityLog",
    to: "/system/activity-log",
    icon: ClipboardList,
    tile: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
    category: "system",
    subcategory: "Kiểm toán",
  },
  // CS-3: Quản lý danh mục — Cơ cấu tổ chức + Vị trí công việc.
  {
    id: "orgStructure",
    labelKey: "orgStructure",
    to: "/system/org-structure",
    icon: Building2,
    tile: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    category: "system",
    subcategory: "Quản lý danh mục",
  },
  {
    id: "positions",
    labelKey: "positions",
    to: "/system/positions",
    icon: Briefcase,
    tile: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400",
    category: "system",
    subcategory: "Quản lý danh mục",
  },
  // CS-4: Đối tượng — danh bạ Người dùng / Nhân viên — subcategory "Quản lý danh mục".
  {
    id: "objects",
    labelKey: "objects",
    to: "/system/objects",
    icon: Users,
    tile: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    category: "system",
    subcategory: "Quản lý danh mục",
  },
  // ACCT-2-FE: Quản lý người dùng (admin) — manage:user. Gate quyền trong component.
  {
    id: "adminUsers",
    labelKey: "adminUsers",
    to: "/system/users",
    icon: UserCog,
    tile: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    category: "system",
    subcategory: "Phân quyền",
  },
  // CS-2: Phân quyền (RBAC) — nhóm riêng "Phân quyền" theo IA (gán/thu vai trò + quyền theo đối tượng).
  {
    id: "permissions",
    labelKey: "permissions",
    to: "/system/permissions",
    icon: Shield,
    tile: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    category: "system",
    subcategory: "Phân quyền",
  },
  // CS-7: Tình hình sử dụng — thống kê login, last-login, task per-tenant (nhóm riêng theo IA, KHÔNG gộp Kiểm toán).
  {
    id: "usageStats",
    labelKey: "usageStats",
    to: "/system/usage",
    icon: BarChart2,
    tile: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    category: "system",
    subcategory: "Tình hình sử dụng",
  },
  // CS-6: Thùng rác — khôi phục nhân viên bị xoá mềm (restore:employee sensitive).
  {
    id: "recycleBin",
    labelKey: "recycleBin",
    to: "/recycle-bin",
    icon: Trash2,
    tile: "bg-muted text-muted-foreground",
    category: "system",
  },
  // DevOps (hút từ apps/admin tenant-plane sang console — aud=user, KHÔNG cross-tenant):
  // API key/PAT (manage:api-key) + Webhooks (view/manage:webhook). Gate quyền xử lý trong component.
  {
    id: "apiKeys",
    labelKey: "apiKeys",
    to: "/system/api-keys",
    icon: Terminal,
    tile: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    category: "system",
    subcategory: "DevOps",
  },
  {
    id: "webhooks",
    labelKey: "webhooks",
    to: "/system/webhooks",
    icon: Webhook,
    tile: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    category: "system",
    subcategory: "DevOps",
  },
] as const;

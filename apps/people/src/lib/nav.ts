import {
  BadgeDollarSign,
  Briefcase,
  Building2,
  CalendarPlus,
  CalendarRange,
  Fingerprint,
  Plane,
  ReceiptText,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { type NavItem } from "@mediaos/web-core";

/**
 * NAV registry của apps/people (Nhân sự–Lương) — SUBSET các category `hr` + `attendance` + `payroll`.
 * Dùng chung bởi app-shell (sidebar) và trang chủ launcher của riêng app này.
 *
 * Types + danh mục category + helper gom nhóm đến từ @mediaos/web-core (dùng chung mọi app);
 * file này CHỈ khai NAV_ITEMS subset của app Nhân sự.
 */
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
} from "@mediaos/web-core";

export const NAV_ITEMS: readonly NavItem[] = [
  // — Nhân sự —
  { id: "employees", labelKey: "employees", to: "/org/employees", icon: Users, tile: "bg-sky-500/12 text-sky-600", category: "hr" },
  { id: "departments", labelKey: "departments", to: "/org/departments", icon: Building2, tile: "bg-blue-500/12 text-blue-600", category: "hr" },
  { id: "teams", labelKey: "teams", to: "/org/teams", icon: UsersRound, tile: "bg-purple-500/12 text-purple-600", category: "hr" },
  { id: "positions", labelKey: "positions", to: "/org/positions", icon: Briefcase, tile: "bg-fuchsia-500/12 text-fuchsia-600", category: "hr" },

  // — Chấm công —
  { id: "attendance", labelKey: "attendance", to: "/hr/attendance", icon: Fingerprint, tile: "bg-emerald-500/12 text-emerald-600", category: "attendance" },
  { id: "adjustments", labelKey: "adjustments", to: "/hr/adjustments", icon: CalendarPlus, tile: "bg-lime-500/12 text-lime-600", category: "attendance" },
  { id: "leave", labelKey: "leave", to: "/hr/leave", icon: Plane, tile: "bg-orange-500/12 text-orange-600", category: "attendance" },

  // — Tiền lương —
  { id: "salaryProfiles", labelKey: "salaryProfiles", to: "/payroll/salary-profiles", icon: Wallet, tile: "bg-green-500/12 text-green-600", category: "payroll" },
  { id: "payrollPeriods", labelKey: "payrollPeriods", to: "/payroll/periods", icon: CalendarRange, tile: "bg-teal-500/12 text-teal-600", category: "payroll" },
  { id: "payslips", labelKey: "payslips", to: "/payroll/payslips", icon: ReceiptText, tile: "bg-cyan-500/12 text-cyan-600", category: "payroll" },
  { id: "bonusPenalties", labelKey: "bonusPenalties", to: "/payroll/bonus-penalties", icon: BadgeDollarSign, tile: "bg-amber-500/12 text-amber-600", category: "payroll" },
] as const;

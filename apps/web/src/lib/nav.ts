import {
  Activity,
  BadgeDollarSign,
  Bell,
  Briefcase,
  Building2,
  CalendarPlus,
  CalendarRange,
  Columns3,
  FileText,
  Fingerprint,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Plane,
  Radio,
  ReceiptText,
  Settings,
  ShieldAlert,
  Target,
  Users,
  UsersRound,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * NAV REGISTRY — nguồn sự thật DUY NHẤT cho điều hướng.
 * Dùng chung bởi app-shell (sidebar) và trang chủ launcher.
 *
 * - `labelKey`: khóa i18n trong namespace "nav".
 * - `icon`: lucide icon component.
 * - `tile`: bộ class màu cho ô icon vuông ở launcher (mỗi module 1 sắc thái).
 * - `category`: gom nhóm cho chip lọc ở launcher + section ở sidebar.
 */
export type NavCategory =
  | "work"
  | "goals"
  | "process"
  | "hr"
  | "attendance"
  | "payroll"
  | "system";

export interface NavItem {
  /** Định danh ổn định (key). */
  id: string;
  /** Khóa i18n (namespace nav). */
  labelKey: string;
  /** Đường dẫn route. */
  to: string;
  icon: LucideIcon;
  /** Class màu ô icon ở launcher (nền + chữ icon). */
  tile: string;
  category: NavCategory;
}

export interface NavCategoryMeta {
  id: NavCategory;
  /** Khóa i18n (namespace nav, tiền tố "group."). */
  labelKey: string;
}

export const NAV_CATEGORIES: readonly NavCategoryMeta[] = [
  { id: "work", labelKey: "group.work" },
  { id: "goals", labelKey: "group.goals" },
  { id: "process", labelKey: "group.process" },
  { id: "hr", labelKey: "group.hr" },
  { id: "attendance", labelKey: "group.attendance" },
  { id: "payroll", labelKey: "group.payroll" },
  { id: "system", labelKey: "group.system" },
] as const;

export const NAV_ITEMS: readonly NavItem[] = [
  // — Công việc & nội dung —
  { id: "tasks", labelKey: "tasks", to: "/tasks", icon: ListTodo, tile: "bg-emerald-500/12 text-emerald-600", category: "work" },
  { id: "taskBoard", labelKey: "taskBoard", to: "/tasks/board", icon: Columns3, tile: "bg-teal-500/12 text-teal-600", category: "work" },
  { id: "projects", labelKey: "projects", to: "/projects", icon: FolderKanban, tile: "bg-violet-500/12 text-violet-600", category: "work" },
  { id: "content", labelKey: "content", to: "/content", icon: FileText, tile: "bg-amber-500/12 text-amber-600", category: "work" },
  { id: "channels", labelKey: "channels", to: "/channels", icon: Radio, tile: "bg-rose-500/12 text-rose-600", category: "work" },
  { id: "dashboard", labelKey: "dashboard", to: "/dashboard", icon: LayoutDashboard, tile: "bg-blue-500/12 text-blue-600", category: "work" },

  // — KPI / Mục tiêu —
  { id: "kpi", labelKey: "kpi", to: "/kpi", icon: Target, tile: "bg-indigo-500/12 text-indigo-600", category: "goals" },

  // — Quy trình —
  { id: "workflows", labelKey: "workflows", to: "/workflows/templates", icon: Workflow, tile: "bg-indigo-500/12 text-indigo-600", category: "process" },
  { id: "workflowInstances", labelKey: "workflowInstances", to: "/workflows/instances", icon: Activity, tile: "bg-cyan-500/12 text-cyan-600", category: "process" },

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

  // — Hệ thống —
  { id: "platformAccounts", labelKey: "platformAccounts", to: "/settings/platform-accounts", icon: KeyRound, tile: "bg-slate-500/12 text-slate-600", category: "system" },
  { id: "breakGlass", labelKey: "breakGlass", to: "/settings/break-glass", icon: ShieldAlert, tile: "bg-red-500/12 text-red-600", category: "system" },
  { id: "companySettings", labelKey: "companySettings", to: "/settings/company", icon: Settings, tile: "bg-slate-500/12 text-slate-600", category: "system" },
] as const;

/** Gom NAV_ITEMS theo category, giữ thứ tự khai báo trong NAV_CATEGORIES. */
export function navItemsByCategory(): { meta: NavCategoryMeta; items: NavItem[] }[] {
  return NAV_CATEGORIES.map((meta) => ({
    meta,
    items: NAV_ITEMS.filter((it) => it.category === meta.id),
  }));
}

export { Bell };

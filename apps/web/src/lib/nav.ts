import {
  Activity,
  Columns3,
  FileText,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  ListTodo,
  Radio,
  Settings,
  ShieldAlert,
  Target,
  Workflow,
} from "lucide-react";
import { type NavItem } from "@mediaos/web-core";

/**
 * NAV registry của apps/web (monolith hiện tại) — nguồn sự thật DUY NHẤT cho điều hướng.
 * Dùng chung bởi app-shell (sidebar) và trang chủ launcher.
 *
 * Types + danh mục category + helper gom nhóm đến từ @mediaos/web-core (dùng chung mọi app);
 * file này CHỈ khai NAV_ITEMS đầy đủ. Khi tách app (Wave 2) mỗi app khai subset riêng.
 *
 * FS-2: các nav item category `hr`/`attendance`/`payroll` đã DỜI sang apps/people.
 */
export {
  NAV_CATEGORIES,
  navItemsByCategory,
  type NavCategory,
  type NavItem,
  type NavCategoryMeta,
} from "@mediaos/web-core";

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

  // — Hệ thống —
  { id: "platformAccounts", labelKey: "platformAccounts", to: "/settings/platform-accounts", icon: KeyRound, tile: "bg-slate-500/12 text-slate-600", category: "system" },
  { id: "breakGlass", labelKey: "breakGlass", to: "/settings/break-glass", icon: ShieldAlert, tile: "bg-red-500/12 text-red-600", category: "system" },
  { id: "companySettings", labelKey: "companySettings", to: "/settings/company", icon: Settings, tile: "bg-slate-500/12 text-slate-600", category: "system" },
] as const;

import { type LucideIcon } from "lucide-react";

/**
 * NAV types + helper dùng chung — nguồn sự thật cho KIỂU điều hướng.
 * Mỗi app tự khai `NAV_ITEMS` (subset) của mình rồi đưa qua `navItemsByCategory(items)`.
 * web-core CHỈ giữ types + danh mục category + helper gom nhóm (KHÔNG giữ NAV_ITEMS cụ thể).
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

/** Gom các nav item (do app truyền vào) theo category, giữ thứ tự khai báo trong NAV_CATEGORIES. */
export function navItemsByCategory(
  items: readonly NavItem[],
): { meta: NavCategoryMeta; items: NavItem[] }[] {
  return NAV_CATEGORIES.map((meta) => ({
    meta,
    items: items.filter((it) => it.category === meta.id),
  }));
}

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
  /**
   * Nhóm con tùy chọn trong category (sidebar 2 cấp).
   * Nếu KHÔNG truyền — item gom 1 cấp dưới category như cũ (tương thích ngược toàn bộ app).
   */
  subcategory?: string;
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

/**
 * Mục con trong một subcategory (sidebar 2 cấp).
 * Nếu subcategory là undefined thì item hiển thị phẳng dưới category (tương thích ngược).
 */
export interface NavSubgroup {
  /** Tên subcategory (string tự do, dùng làm label i18n key hoặc hiện thẳng). */
  subcategory: string;
  items: NavItem[];
}

/**
 * Một nhóm category đã gom con theo subcategory (sidebar 2 cấp).
 * - `flat`: items KHÔNG có subcategory → hiển thị thẳng dưới category header.
 * - `subgroups`: items CÓ subcategory → lồng thêm 1 cấp header nhỏ bên dưới category.
 * App không dùng subcategory → `flat` = mọi item, `subgroups` = [] (hành vi giống v1).
 */
export interface NavCategoryGroup {
  meta: NavCategoryMeta;
  flat: NavItem[];
  subgroups: NavSubgroup[];
}

/**
 * Gom nav items theo category + subcategory (2 cấp).
 * Item không có `subcategory` gom vào `flat`; item có `subcategory` gom vào `subgroups`.
 * Thứ tự xuất hiện: `flat` trước, rồi từng subgroup theo thứ tự subcategory xuất hiện đầu tiên.
 * Tương thích ngược: app không dùng subcategory → flat = items, subgroups = [].
 */
export function navItemsGrouped(items: readonly NavItem[]): NavCategoryGroup[] {
  return NAV_CATEGORIES.map((meta) => {
    const categoryItems = items.filter((it) => it.category === meta.id);
    const flat: NavItem[] = [];
    const subgroupMap = new Map<string, NavItem[]>();
    const subgroupOrder: string[] = [];

    for (const item of categoryItems) {
      if (!item.subcategory) {
        flat.push(item);
      } else {
        if (!subgroupMap.has(item.subcategory)) {
          subgroupMap.set(item.subcategory, []);
          subgroupOrder.push(item.subcategory);
        }
        subgroupMap.get(item.subcategory)!.push(item);
      }
    }

    const subgroups: NavSubgroup[] = subgroupOrder.map((sub) => ({
      subcategory: sub,
      items: subgroupMap.get(sub)!,
    }));

    return { meta, flat, subgroups };
  });
}

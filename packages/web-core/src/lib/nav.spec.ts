import { describe, expect, it } from "vitest";
import { navItemsByCategory, navItemsGrouped } from "./nav";
import type { NavItem } from "./nav";
import { LayoutDashboard } from "lucide-react";

const makeItem = (overrides: Partial<NavItem> & Pick<NavItem, "id" | "category">): NavItem => ({
  labelKey: overrides.id,
  to: `/${overrides.id}`,
  icon: LayoutDashboard,
  tile: "bg-slate-500/12 text-slate-600",
  ...overrides,
});

const ITEMS_NO_SUBCAT: readonly NavItem[] = [
  makeItem({ id: "tasks", category: "work" }),
  makeItem({ id: "channels", category: "work" }),
  makeItem({ id: "platformAccounts", category: "system" }),
  makeItem({ id: "companySettings", category: "system" }),
];

const ITEMS_WITH_SUBCAT: readonly NavItem[] = [
  makeItem({ id: "platformAccounts", category: "system" }),
  makeItem({ id: "companySettings", category: "system" }),
  makeItem({ id: "activityLog", category: "system", subcategory: "Kiểm toán" }),
];

describe("navItemsByCategory — backward compat (1-level)", () => {
  it("gom đúng items theo category", () => {
    const groups = navItemsByCategory(ITEMS_NO_SUBCAT);
    const work = groups.find((g) => g.meta.id === "work")!;
    const system = groups.find((g) => g.meta.id === "system")!;
    expect(work.items).toHaveLength(2);
    expect(system.items).toHaveLength(2);
  });

  it("category trống trả items=[]", () => {
    const groups = navItemsByCategory(ITEMS_NO_SUBCAT);
    const payroll = groups.find((g) => g.meta.id === "payroll")!;
    expect(payroll.items).toHaveLength(0);
  });

  it("item có subcategory VẪN xuất hiện trong navItemsByCategory (tương thích ngược)", () => {
    const groups = navItemsByCategory(ITEMS_WITH_SUBCAT);
    const system = groups.find((g) => g.meta.id === "system")!;
    expect(system.items).toHaveLength(3);
  });
});

describe("navItemsGrouped — 2-level sidebar", () => {
  it("item không có subcategory vào flat, không vào subgroups", () => {
    const groups = navItemsGrouped(ITEMS_NO_SUBCAT);
    const work = groups.find((g) => g.meta.id === "work")!;
    expect(work.flat).toHaveLength(2);
    expect(work.subgroups).toHaveLength(0);
  });

  it("item có subcategory vào subgroups, không vào flat", () => {
    const groups = navItemsGrouped(ITEMS_WITH_SUBCAT);
    const system = groups.find((g) => g.meta.id === "system")!;
    expect(system.flat).toHaveLength(2); // platformAccounts + companySettings
    expect(system.subgroups).toHaveLength(1);
    expect(system.subgroups[0].subcategory).toBe("Kiểm toán");
    expect(system.subgroups[0].items).toHaveLength(1);
    expect(system.subgroups[0].items[0].id).toBe("activityLog");
  });

  it("nhiều item cùng subcategory gom vào 1 subgroup", () => {
    const items: readonly NavItem[] = [
      makeItem({ id: "a", category: "system", subcategory: "Kiểm toán" }),
      makeItem({ id: "b", category: "system", subcategory: "Kiểm toán" }),
    ];
    const groups = navItemsGrouped(items);
    const system = groups.find((g) => g.meta.id === "system")!;
    expect(system.subgroups).toHaveLength(1);
    expect(system.subgroups[0].items).toHaveLength(2);
  });

  it("category trống: flat=[], subgroups=[]", () => {
    const groups = navItemsGrouped(ITEMS_NO_SUBCAT);
    const payroll = groups.find((g) => g.meta.id === "payroll")!;
    expect(payroll.flat).toHaveLength(0);
    expect(payroll.subgroups).toHaveLength(0);
  });

  it("navItemsByCategory không bị ảnh hưởng khi item có subcategory (4 app khác không vỡ)", () => {
    // Thêm subcategory vào 1 item, kiểm tra navItemsByCategory vẫn trả đúng count
    const groups = navItemsByCategory(ITEMS_WITH_SUBCAT);
    const system = groups.find((g) => g.meta.id === "system")!;
    expect(system.items.map((i) => i.id)).toContain("activityLog");
  });
});

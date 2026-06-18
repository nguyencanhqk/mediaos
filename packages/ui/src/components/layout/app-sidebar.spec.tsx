import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayoutDashboard, Settings } from "lucide-react";
import type { NavItem, NavCategoryGroup } from "@mediaos/web-core";

// Stub @mediaos/web-core entirely to avoid i18n.init side-effect from dist
vi.mock("@mediaos/web-core", () => {
  // Minimal stub of navItemsGrouped — real logic tested in web-core/nav.spec.ts
  function navItemsGrouped(items: readonly NavItem[]): NavCategoryGroup[] {
    const categories = ["work", "goals", "process", "hr", "attendance", "payroll", "system"] as const;
    return categories.map((cat) => {
      const catItems = items.filter((it) => it.category === cat);
      const flat: NavItem[] = [];
      const subgroupMap = new Map<string, NavItem[]>();
      const subgroupOrder: string[] = [];
      for (const item of catItems) {
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
      return {
        meta: { id: cat, labelKey: `group.${cat}` },
        flat,
        subgroups: subgroupOrder.map((sub) => ({ subcategory: sub, items: subgroupMap.get(sub)! })),
      };
    });
  }
  return { navItemsGrouped };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { AppSidebar } from "./app-sidebar";

const makeItem = (
  overrides: Partial<NavItem> & Pick<NavItem, "id" | "category">,
): NavItem => ({
  labelKey: overrides.id,
  to: `/${overrides.id}`,
  icon: LayoutDashboard,
  tile: "bg-slate-500/12 text-slate-600",
  ...overrides,
});

const FLAT_ITEMS: readonly NavItem[] = [
  makeItem({ id: "tasks", category: "work" }),
  makeItem({ id: "channels", category: "work" }),
  makeItem({ id: "platformAccounts", category: "system", icon: Settings }),
];

const SUBCAT_ITEMS: readonly NavItem[] = [
  makeItem({ id: "platformAccounts", category: "system", icon: Settings }),
  makeItem({ id: "companySettings", category: "system", icon: Settings }),
  makeItem({ id: "activityLog", category: "system", icon: Settings, subcategory: "Kiểm toán" }),
];

describe("AppSidebar — 1-level (không có subcategory)", () => {
  it("render item phẳng trong category đúng", () => {
    render(<AppSidebar items={FLAT_ITEMS} />);
    expect(screen.getByText("tasks")).toBeInTheDocument();
    expect(screen.getByText("channels")).toBeInTheDocument();
    expect(screen.getByText("platformAccounts")).toBeInTheDocument();
  });

  it("KHÔNG render header subcategory khi không có subcategory", () => {
    render(<AppSidebar items={FLAT_ITEMS} />);
    expect(screen.queryByText("Kiểm toán")).not.toBeInTheDocument();
  });
});

describe("AppSidebar — 2-level (có subcategory)", () => {
  it("render item flat VÀ item trong subgroup", () => {
    render(<AppSidebar items={SUBCAT_ITEMS} />);
    expect(screen.getByText("platformAccounts")).toBeInTheDocument();
    expect(screen.getByText("companySettings")).toBeInTheDocument();
    expect(screen.getByText("activityLog")).toBeInTheDocument();
  });

  it("render header subgroup với tên subcategory", () => {
    render(<AppSidebar items={SUBCAT_ITEMS} />);
    expect(screen.getByText("Kiểm toán")).toBeInTheDocument();
  });

  it("item phẳng xuất hiện trước item trong subgroup (DOM order)", () => {
    render(<AppSidebar items={SUBCAT_ITEMS} />);
    const all = screen.getAllByRole("link");
    const paIdx = all.findIndex((el) => el.textContent?.includes("platformAccounts"));
    const alIdx = all.findIndex((el) => el.textContent?.includes("activityLog"));
    expect(paIdx).toBeGreaterThanOrEqual(0);
    expect(alIdx).toBeGreaterThan(paIdx);
  });
});

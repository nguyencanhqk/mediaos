import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LayoutDashboard } from "lucide-react";
import type { NavItem } from "@mediaos/web-core";

/**
 * Render-smoke (QA-02 matrix) — AppShell: mount không throw.
 * AppShell phụ thuộc @tanstack/react-router (Link, useNavigate),
 * @mediaos/web-core (useAuthStore), react-i18next (useTranslation) —
 * stub toàn bộ để test độc lập ngữ cảnh router/auth.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    className,
    "aria-label": ariaLabel,
    title,
  }: {
    to: string;
    children?: React.ReactNode;
    className?: string;
    "aria-label"?: string;
    title?: string;
  }) => (
    <a href={to} className={className} aria-label={ariaLabel} title={title}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  // AppShell dùng pathname để reset scroll của <main> khi đổi route
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/" } }),
}));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...mod,
    useAuthStore: Object.assign(
      (selector: (s: { username: string; logout: () => void }) => unknown) =>
        selector({ username: "Nguyễn Văn An", logout: vi.fn() }),
      { getState: () => ({ isAuthenticated: true }) },
    ),
    navItemsGrouped: (items: readonly NavItem[]) =>
      items.length > 0
        ? [
            {
              meta: { id: "work", labelKey: "group.work" },
              flat: items as NavItem[],
              subgroups: [],
            },
          ]
        : [],
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { AppShell } from "./app-shell";

const NAV: readonly NavItem[] = [
  {
    id: "dashboard",
    labelKey: "nav:dashboard",
    to: "/",
    icon: LayoutDashboard,
    category: "work",
    tile: "bg-slate-500/12 text-slate-600",
  },
];

describe("AppShell", () => {
  it("render children bên trong (mount không throw)", () => {
    render(
      <AppShell navItems={NAV}>
        <div>Trang chính</div>
      </AppShell>,
    );
    expect(screen.getByText("Trang chính")).toBeInTheDocument();
  });

  it("render brand slot khi truyền vào", () => {
    render(
      <AppShell navItems={NAV} brand={<span>MediaOS</span>}>
        <div>nội dung</div>
      </AppShell>,
    );
    expect(screen.getByText("MediaOS")).toBeInTheDocument();
  });

  it("render tên người dùng từ authStore", () => {
    render(
      <AppShell navItems={NAV}>
        <div>nội dung</div>
      </AppShell>,
    );
    expect(screen.getByText("Nguyễn Văn An")).toBeInTheDocument();
  });

  it("render notifications slot khi truyền vào", () => {
    render(
      <AppShell navItems={NAV} notifications={<button aria-label="Thông báo">🔔</button>}>
        <div>nội dung</div>
      </AppShell>,
    );
    expect(screen.getByRole("button", { name: "Thông báo" })).toBeInTheDocument();
  });
});

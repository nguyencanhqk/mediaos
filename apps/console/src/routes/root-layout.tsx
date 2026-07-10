import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@mediaos/ui";
import { NAV_ITEMS } from "@/lib/nav";
import { BrandLogo } from "@/components/brand/brand-mark";
import { BRAND } from "@/lib/brand";

/** Route hiển thị toàn màn, KHÔNG bọc app-shell (tự lo chrome riêng). Login đã externalize sang apps/auth. */
const BARE_ROUTES = new Set<string>(["/"]);

/** Khối thương hiệu góc trái shell — app này cấp branding Funtime Media của nó. */
const brand = (
  <Link to="/" className="flex items-center pr-2" aria-label={BRAND.name}>
    <BrandLogo size="md" wordmarkText={BRAND.shortName} wordmarkClassName="hidden sm:inline" />
  </Link>
);

export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (BARE_ROUTES.has(pathname)) {
    return <Outlet />;
  }

  // Slot `notifications` bỏ trống — console không có chuông NOTI; SPEC-08/FRONTEND-12 chỉ định NOTI
  // cho apps/app (owner chốt 2026-07-10).
  return (
    <AppShell navItems={NAV_ITEMS} brand={brand}>
      <Outlet />
    </AppShell>
  );
}

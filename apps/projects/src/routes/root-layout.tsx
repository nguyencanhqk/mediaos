import { Link, Outlet } from "@tanstack/react-router";
import { AppShell, NotificationBell } from "@mediaos/ui";
import { NAV_ITEMS } from "@/lib/nav";
import { BrandLogo } from "@/components/brand/brand-mark";
import { BRAND } from "@/lib/brand";

/** Khối thương hiệu góc trái shell — app này cấp branding Funtime Media của nó. */
const brand = (
  <Link to="/" className="flex items-center pr-2" aria-label={BRAND.name}>
    <BrandLogo size="md" wordmarkText={BRAND.shortName} wordmarkClassName="hidden sm:inline" />
  </Link>
);

/**
 * Layout app Dự án (tenant) — bọc app-shell (sidebar + brand + chuông thông báo). KHÁC console: trang chủ
 * `/` (danh sách dự án) NẰM TRONG shell (không bare) vì là màn chính của app, không phải launcher root-domain.
 */
export function RootLayout() {
  return (
    <AppShell navItems={NAV_ITEMS} brand={brand} notifications={<NotificationBell />}>
      <Outlet />
    </AppShell>
  );
}

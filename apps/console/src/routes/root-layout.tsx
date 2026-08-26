import React from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell, Skeleton } from "@mediaos/ui";
import { useFavicon } from "@mediaos/web-core";
import { useConsoleBranding } from "@/lib/use-console-branding";
import { useConsoleNavItems } from "@/lib/nav";
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

/**
 * Ranh giới Suspense DUY NHẤT cho 17 trang lazy của console (S10-PERF-LOADPATH-1).
 *
 * Đặt ở đây thay vì bọc từng route: router console gắn thẳng `component: XPage` nên không có chỗ chung
 * nào khác, và một boundary trên `<Outlet/>` phủ hết — kể cả route thêm sau này. Thiếu nó thì trang lazy
 * đầu tiên ném thẳng "A component suspended while responding to synchronous input".
 */
function RouteSuspenseFallback(): React.ReactElement {
  return (
    <div className="space-y-4 p-2" aria-busy="true" data-testid="route-loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // S7-CHAT-FE-5 — sidebar đọc bản ĐÃ LỌC QUYỀN (mục đọc-vượt CHAT chỉ hiện với cặp
  // `view:chat-oversight` khớp CHÍNH XÁC). Hook gọi TRƯỚC nhánh BARE_ROUTES để thứ tự hook ổn định.
  const navItems = useConsoleNavItems();

  // S5-BRAND-FE-2 — favicon động theo thương hiệu công ty (áp cho CẢ route bare lẫn route có shell).
  // Fail-soft: chưa đặt/lỗi → giữ favicon tĩnh /favicon.svg. Console CỐ Ý không đổi logo góc trái:
  // đây là app quản trị hệ thống, brand Funtime của nó là chủ đích (khác vỏ nghiệp vụ apps/app).
  useFavicon(useConsoleBranding().data?.favicon?.url ?? null);

  if (BARE_ROUTES.has(pathname)) {
    return (
      <React.Suspense fallback={<RouteSuspenseFallback />}>
        <Outlet />
      </React.Suspense>
    );
  }

  // Slot `notifications` bỏ trống — console không có chuông NOTI; SPEC-08/FRONTEND-12 chỉ định NOTI
  // cho apps/app (owner chốt 2026-07-10).
  return (
    <AppShell navItems={navItems} brand={brand}>
      <React.Suspense fallback={<RouteSuspenseFallback />}>
        <Outlet />
      </React.Suspense>
    </AppShell>
  );
}

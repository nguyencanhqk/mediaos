/**
 * Hook: lấy RouteMeta của route hiện tại từ ROUTE_REGISTRY dựa trên pathname.
 *
 * TanStack Router không cung cấp meta object tự do ở route context (chỉ có params/search),
 * nên hook này so khớp pathname với ROUTE_REGISTRY bằng prefix-match đơn giản.
 * Đủ cho MVP (không có dynamic segments trong layout-level checks).
 */
import { useRouterState } from "@tanstack/react-router";
import { ROUTE_REGISTRY, type RouteMeta } from "@mediaos/web-core";

function matchRoute(pathname: string): RouteMeta | undefined {
  // Exact match trước, sau đó prefix match dài nhất
  const exact = ROUTE_REGISTRY.find((r) => r.path === pathname);
  if (exact) return exact;

  // Prefix match — lấy route dài nhất để tránh /hr khớp nhầm /hr/employees
  let best: RouteMeta | undefined;
  let bestLen = 0;
  for (const r of ROUTE_REGISTRY) {
    if (r.path !== "/" && pathname.startsWith(r.path) && r.path.length > bestLen) {
      best = r;
      bestLen = r.path.length;
    }
  }
  return best;
}

/**
 * Trả về RouteMeta của route hiện tại, hoặc undefined nếu không tìm thấy.
 * Component dùng hook này để lấy moduleCode, layout, titleKey, breadcrumb, v.v.
 */
export function useCurrentRouteMeta(): RouteMeta | undefined {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return matchRoute(pathname);
}

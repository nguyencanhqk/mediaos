import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/app-shell";

/** Route hiển thị toàn màn, KHÔNG bọc app-shell (tự lo chrome riêng). */
const BARE_ROUTES = new Set<string>(["/", "/login"]);

export function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (BARE_ROUTES.has(pathname)) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

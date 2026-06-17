import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { HomePage } from "@/routes/home";
import { RootLayout } from "@/routes/root-layout";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";

const rootRoute = createRootRoute({ component: RootLayout });

// FS-1b: login đã externalize sang app đăng nhập trung tâm (apps/auth). Guard không còn route `/login` nội bộ
// → chưa đăng nhập thì `throw redirect({ href })` RA NGOÀI (TanStack tự suy `reloadDocument` cho absolute href).
// Boot (main.tsx) silent-refresh trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
//
// WAVE 2 ĐÃ HOÀN TẤT: mọi route nghiệp vụ đã DỜI sang app riêng — org/hr/payroll→apps/people,
// tasks/media/chat/workflows/dashboard/kpi→apps/studio, settings(system)→apps/console. apps/web giờ chỉ còn
// trang chủ launcher (/). Wave 3 (FS-cutover) sẽ XOÁ apps/web.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
  },
  component: HomePage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

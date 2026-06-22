import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { getAuthRedirectUrl, useAuthStore } from "@mediaos/web-core";
import { HomePage } from "@/routes/home";

const rootRoute = createRootRoute();

// SSO: login externalize sang app đăng nhập trung tâm (apps/auth). Guard không có route `/login` nội bộ
// → chưa đăng nhập thì `throw redirect({ href })` RA NGOÀI (TanStack tự suy `reloadDocument` cho absolute
// href: điều hướng cả trang về auth.<domain>?redirect=<đích> + DỪNG pipeline router). Boot (main.tsx)
// silent-refresh trước khi mount nên đây chủ yếu là backstop khi store bị xoá giữa phiên.
const authGuard = () => {
  if (!useAuthStore.getState().isAuthenticated) throw redirect({ href: getAuthRedirectUrl() });
};

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: authGuard,
  component: HomePage,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

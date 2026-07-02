import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { configureApiBaseUrl, configureClientVersion, i18n } from "@mediaos/web-core";
import { LoginPage } from "@/routes/login";
import { ForgotPasswordPage } from "@/routes/forgot-password";
import { ResetPasswordPage } from "@/routes/reset-password";
import { SessionExpiredPage } from "@/routes/session-expired";
import "@/index.css";

// Cấp base URL của API cho web-core (import.meta.env ở lại app Vite). Dev SSO: trỏ `api.localhost` để cookie
// `Domain=.localhost` đính kèm (xem .env.example). apps/auth dùng chung instance i18n (common/auth) của web-core.
//
// ⚠️ BẤT BIẾN apps/auth: app này CHƯA có phiên (đang đăng nhập) → MỌI lệnh gọi API phải `skipAuth:true`
// (authApi.login · authApi.forgotPassword · authApi.resetPassword · twoFactorApi.verifyLogin ·
// authApi.checkRedirect đều đã set). Nếu gọi authed → 401 sẽ kích refresh-on-401 → redirectToAuth() → tự điều
// hướng về CHÍNH apps/auth = vòng lặp. KHÔNG configureAuthAppUrl ở đây.
configureApiBaseUrl(import.meta.env.VITE_API_URL);
configureClientVersion(import.meta.env.VITE_APP_VERSION);

// App đăng nhập trung tâm = SPA mỏng nhiều trang tĩnh (login/forgot/reset/session-expired) — KHÔNG có route
// nội bộ cần bootstrapSession/TanStack Query (chưa có phiên để bootstrap). Router chỉ để điều hướng qua lại
// giữa các trang public này (Link/redirect), không guard quyền.
const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: LoginPage,
});

const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forgot-password",
  component: ForgotPasswordPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPasswordPage,
});

const sessionExpiredRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/session-expired",
  component: SessionExpiredPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  sessionExpiredRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>
  </StrictMode>,
);

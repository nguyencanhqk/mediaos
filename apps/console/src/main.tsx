import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import {
  bootstrapSession,
  configureApiBaseUrl,
  configureAuthAppUrl,
  configureClientVersion,
  redirectToAuth,
  shouldRetryQuery,
} from "@mediaos/web-core";
import i18n from "@/i18n";
import { router } from "@/router";
import "@/index.css";

// Cấp base URL của API + URL app đăng nhập trung tâm cho web-core (import.meta.env ở lại app Vite, không vào
// package dùng chung). Dev SSO trỏ `api.localhost` / `auth.localhost` để cookie `Domain=.localhost` chạy.
configureApiBaseUrl(import.meta.env.VITE_API_URL);
configureAuthAppUrl(import.meta.env.VITE_AUTH_APP_URL);
configureClientVersion(import.meta.env.VITE_APP_VERSION);

// TanStack Query defaults (FRONTEND-04 §16.1): chỉ retry lỗi tạm (shouldRetryQuery — bỏ qua
// 401/403/422/404…), staleTime 30s, gcTime 5'; mutation KHÔNG retry (dùng Idempotency-Key chống trùng).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}
const root = rootElement;

/**
 * FS-4 SSO: silent-refresh KHI LOAD (giống apps/web). Có phiên (refresh cookie hợp lệ) → nạp access token +
 * /me vào store → mount app Hệ thống (tenant). Không có phiên → điều hướng về app đăng nhập trung tâm
 * (apps/auth) kèm `?redirect=<đích>`. KHÔNG render UI khi chưa có phiên. Hết phiên giữa chừng do api-client
 * xử lý (refresh-on-401 → redirect). App này TENANT (aud=user) — KHÁC operator plane apps/admin (aud=operator).
 */
async function boot(): Promise<void> {
  const authed = await bootstrapSession();
  if (!authed) {
    redirectToAuth();
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>
    </StrictMode>,
  );
}

// `boot()` không NÊN ném (bootstrapSession nuốt lỗi mạng → trả false), nhưng nếu có lỗi bất ngờ
// (vd store throw) thì điều hướng về app đăng nhập thay vì để màn hình trắng câm lặng (silent-failure gate).
boot().catch((err: unknown) => {
  console.error("[console] boot() lỗi không mong đợi → điều hướng về app đăng nhập:", err);
  redirectToAuth();
});

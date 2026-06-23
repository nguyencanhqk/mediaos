import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { configureApiBaseUrl, configureClientVersion, i18n } from "@mediaos/web-core";
import { LoginPage } from "@/routes/login";
import "@/index.css";

// Cấp base URL của API cho web-core (import.meta.env ở lại app Vite). Dev SSO: trỏ `api.localhost` để cookie
// `Domain=.localhost` đính kèm (xem .env.example). apps/auth dùng chung instance i18n (common/auth) của web-core.
//
// ⚠️ BẤT BIẾN apps/auth: app này CHƯA có phiên (đang đăng nhập) → MỌI lệnh gọi API phải `skipAuth:true`
// (authApi.login · twoFactorApi.verifyLogin · authApi.checkRedirect đều đã set). Nếu gọi authed → 401 sẽ kích
// refresh-on-401 → redirectToAuth() → tự điều hướng về CHÍNH apps/auth = vòng lặp. KHÔNG configureAuthAppUrl ở đây.
configureApiBaseUrl(import.meta.env.VITE_API_URL);
configureClientVersion(import.meta.env.VITE_APP_VERSION);

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

// App đăng nhập trung tâm = SPA mỏng 1 trang: credentials → 2FA → đặt cookie SSO (server) → điều hướng về app
// đích đã whitelist. KHÔNG cần router/query (không có route nội bộ ngoài /login).
createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <LoginPage />
    </I18nextProvider>
  </StrictMode>,
);

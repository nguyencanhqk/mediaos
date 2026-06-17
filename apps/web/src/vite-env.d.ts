/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** URL app đăng nhập trung tâm (apps/auth) — silent-refresh redirect. */
  readonly VITE_AUTH_APP_URL?: string;
  /** URL tuyệt đối các product app cho launcher (subdomain riêng). Default dev *.localhost:<port>. */
  readonly VITE_STUDIO_URL?: string;
  readonly VITE_PEOPLE_URL?: string;
  readonly VITE_CONSOLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "./locales/vi/common";
import nav from "./locales/vi/nav";
import auth from "./locales/vi/auth";

/**
 * Shared i18n instance (react-i18next) cho mọi FE app.
 *
 * web-core sở hữu init ĐỒNG BỘ + 3 namespace dùng chung `common`/`nav`/`auth` (nhúng sẵn,
 * không backend async) → `t()` trả đúng chuỗi vi ngay từ render đầu, kể cả trong test.
 *
 * Mỗi app gọi `registerI18nResources()` để nạp namespace feature của riêng nó (vd `payroll`,
 * `tasks`) lên cùng instance — không có registry tập trung nên các app/feature thêm song song
 * không đụng nhau.
 *
 * Tiếng Việt là ngôn ngữ mặc định. Thêm ngôn ngữ = đăng ký thêm resource bundle.
 */

const DEFAULT_LANGUAGE = "vi";

const CORE_RESOURCES: Record<string, Record<string, unknown>> = {
  common,
  nav,
  auth,
};

void i18n.use(initReactI18next).init({
  resources: { [DEFAULT_LANGUAGE]: CORE_RESOURCES },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: "common",
  ns: Object.keys(CORE_RESOURCES),
  interpolation: {
    // React đã tự escape → tránh double-escape ký tự tiếng Việt/HTML entity.
    escapeValue: false,
  },
  // Key thiếu trả về chính key (dễ phát hiện), KHÔNG render null.
  returnNull: false,
  react: {
    // Init đồng bộ → không cần Suspense.
    useSuspense: false,
  },
});

/**
 * Đăng ký các namespace feature của app lên instance dùng chung.
 * `resources` = map `{ [namespace]: catalog }`. `deep=true`, `overwrite=true` để merge sâu.
 */
export function registerI18nResources(
  lang: string,
  resources: Record<string, Record<string, unknown>>,
): void {
  for (const [namespace, bundle] of Object.entries(resources)) {
    i18n.addResourceBundle(lang, namespace, bundle, true, true);
  }
}

export default i18n;

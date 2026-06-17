import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * FE i18n cho app admin (react-i18next) — port từ apps/web (GX-7 pattern).
 *
 * Tiếng Việt là ngôn ngữ mặc định. Kiến trúc đã sẵn sàng đa ngôn ngữ: thêm
 * `locales/<lang>/<namespace>.json` là đủ — KHÔNG cần sửa file này.
 *
 * Namespace tự khám phá qua `import.meta.glob` (eager) → mỗi feature sở hữu 1 file
 * catalog độc lập, không có registry tập trung nên các lane (AC-*) sửa song song
 * không đụng nhau.
 *
 * Init ĐỒNG BỘ (resources nhúng sẵn, không dùng backend async) → `t()` trả đúng
 * chuỗi vi ngay từ render đầu tiên, kể cả trong test (không cần provider).
 */

type Catalog = Record<string, unknown>;

function loadResources(lang: string): Record<string, Catalog> {
  // Vite thay thế glob lúc build/transform (cả vitest) → bundle đồng bộ, không I/O.
  const modules = import.meta.glob<{ default: Catalog }>("./locales/*/*.json", {
    eager: true,
  });

  const byNamespace: Record<string, Catalog> = {};
  for (const [filePath, mod] of Object.entries(modules)) {
    // filePath dạng "./locales/vi/common.json"
    const match = filePath.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;
    const [, fileLang, namespace] = match;
    if (fileLang !== lang) continue;
    byNamespace[namespace] = mod.default;
  }
  return byNamespace;
}

const DEFAULT_LANGUAGE = "vi";
const viResources = loadResources(DEFAULT_LANGUAGE);

void i18n.use(initReactI18next).init({
  resources: { [DEFAULT_LANGUAGE]: viResources },
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: "common",
  ns: Object.keys(viResources),
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

export default i18n;

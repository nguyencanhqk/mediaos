import { i18n, registerI18nResources } from "@mediaos/web-core";

/**
 * App-level i18n — dùng lại instance dùng chung của @mediaos/web-core (đã init đồng bộ với
 * namespace `common`/`nav`/`auth`/`notifications`) và đăng ký thêm namespace FEATURE của riêng
 * app Dự án (`projects` / `board` / `settings` / `home`).
 *
 * Namespace `nav` ĐÃ tồn tại ở web-core — file `locales/vi/nav.json` ở đây MERGE thêm key (vd
 * `projects`, `projectBoard`…) vào namespace đó (addResourceBundle deep+overwrite) để sidebar/launcher
 * hiển thị đúng nhãn.
 *
 * Init đồng bộ (resources nhúng sẵn) → `t()` trả đúng chuỗi vi ngay từ render đầu (kể cả test).
 */

const DEFAULT_LANGUAGE = "vi";

type Catalog = Record<string, unknown>;

function loadFeatureResources(lang: string): Record<string, Catalog> {
  // Vite thay thế glob lúc build/transform (cả vitest) → bundle đồng bộ, không I/O.
  const modules = import.meta.glob<{ default: Catalog }>("./locales/*/*.json", {
    eager: true,
  });

  const byNamespace: Record<string, Catalog> = {};
  for (const [filePath, mod] of Object.entries(modules)) {
    // filePath dạng "./locales/vi/projects.json"
    const match = filePath.match(/\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;
    const [, fileLang, namespace] = match;
    if (fileLang !== lang) continue;
    byNamespace[namespace] = mod.default;
  }
  return byNamespace;
}

registerI18nResources(DEFAULT_LANGUAGE, loadFeatureResources(DEFAULT_LANGUAGE));

export default i18n;

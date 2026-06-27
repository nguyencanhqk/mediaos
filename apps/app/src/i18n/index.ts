// App-level i18n — dùng lại instance dùng chung của @mediaos/web-core (đã init đồng bộ với
// namespace `common`/`nav`/`auth`/`notifications`). Đăng ký namespace feature của app qua
// `registerI18nResources` → cùng instance, không tách riêng.
import { i18n, registerI18nResources } from "@mediaos/web-core";
import hrVi from "./locales/vi/hr";
import systemVi from "./locales/vi/system";

registerI18nResources("vi", { hr: hrVi, system: systemVi });

export default i18n;

// App-level i18n — dùng lại instance dùng chung của @mediaos/web-core (đã init đồng bộ với
// namespace `common`/`nav`/`auth`/`notifications`). Đăng ký namespace feature của app qua
// `registerI18nResources` → cùng instance, không tách riêng.
import { i18n, registerI18nResources } from "@mediaos/web-core";
import hrVi from "./locales/vi/hr";
import systemVi from "./locales/vi/system";
import leaveVi from "./locales/vi/leave";
import attendanceVi from "./locales/vi/attendance";
// S2-FE-AUTH-5 (lane FE batch C) — /account/sessions.
import accountVi from "./locales/vi/account";
// S4-FE-NOTI-1 — Badge/Dropdown/List/Detail. Deep-merge THÊM khoá vào bundle "notifications" đã có sẵn
// ở @mediaos/web-core (title/ariaLabel/markAllRead/empty/types) — KHÔNG ghi đè (addResourceBundle deep=true).
import notificationsVi from "./locales/vi/notifications";

registerI18nResources("vi", {
  hr: hrVi,
  system: systemVi,
  leave: leaveVi,
  attendance: attendanceVi,
  account: accountVi,
  notifications: notificationsVi,
});

export default i18n;

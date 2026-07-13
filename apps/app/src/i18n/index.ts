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
// S4-FE-TASK-1 — Project List/Detail/Form/Member (namespace mới "tasks").
import tasksVi from "./locales/vi/tasks";
// S4-FE-DASH-1 — DashboardMePage + WidgetCard + widget P0 (namespace mới "dashboard").
import dashboardVi from "./locales/vi/dashboard";

registerI18nResources("vi", {
  hr: hrVi,
  system: systemVi,
  leave: leaveVi,
  attendance: attendanceVi,
  account: accountVi,
  notifications: notificationsVi,
  tasks: tasksVi,
  dashboard: dashboardVi,
  // S4-FE-NOTI-2 — ĐÈ THÊM 1 khoá routeTitle.notiEvents vào bundle "nav" đã nhúng sẵn ở @mediaos/web-core
  // (deep-merge, KHÔNG đụng khoá cũ) — route noti.events (ROUTE_REGISTRY) cần titleKey này.
  // S4-FE-NOTI-4 — THÊM notiTemplates (route noti.templates, MỚI) + notificationDeliveryLogs (route
  // noti.delivery-logs, chuyển từ RouteMeta cục bộ router.tsx vào ROUTE_REGISTRY — titleKey trước đây
  // KHÔNG có bản dịch, hiển thị nguyên key; vá kèm khi dời).
  nav: {
    routeTitle: {
      notiEvents: "Quản lý loại thông báo",
      notiTemplates: "Quản lý mẫu thông báo",
      notificationDeliveryLogs: "Nhật ký gửi thông báo",
    },
  },
});

export default i18n;

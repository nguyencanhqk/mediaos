/**
 * i18n (vi) — namespace "dashboard", module DASH — S4-FE-DASH-1 (SPEC-07 §13.1/§14.2/§14.3/§14.7).
 *
 * DashboardMePage (shell) + WidgetCard (shell dùng chung) + 3 widget P0 (MyTasks/TaskAlerts/Notifications).
 * Copy trạng thái rỗng theo SPEC-07 §16.6 (bảng "Quy tắc empty state"); error copy theo §16.7. Server có thể
 * trả `empty_state.message`/`error_state.message` riêng (đã localized) — component ưu tiên message SERVER,
 * copy ở đây chỉ là fallback khi field đó vắng (KHÔNG trôi khỏi §16.6/§16.7 nếu BE đổi câu chữ).
 */
export default {
  page: {
    title: "Bảng điều khiển",
    description: "Tổng quan việc cần xử lý, cảnh báo và thông báo hôm nay.",
  },
  shell: {
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem bảng điều khiển. Liên hệ quản trị viên nếu cần hỗ trợ.",
    },
    error: {
      title: "Không thể tải bảng điều khiển",
      description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
    },
    empty: {
      title: "Chưa có widget nào để hiển thị",
      description: "Liên hệ quản trị viên công ty nếu bạn cho rằng đây là nhầm lẫn.",
    },
  },
  widget: {
    refresh: "Làm mới",
    lastUpdated: "Cập nhật lúc {{time}}",
    forbidden: "Bạn không có quyền xem widget này.",
    error: {
      title: "Không thể tải dữ liệu",
      description: "Đã xảy ra lỗi khi tải widget. Vui lòng thử lại.",
    },
  },
  myTasks: {
    title: "Việc của tôi hôm nay",
    empty: { title: "Hôm nay bạn chưa có task cần xử lý" },
    noProject: "Không thuộc dự án",
  },
  taskAlerts: {
    title: "Task cần chú ý",
    summary: "{{overdue}} quá hạn · {{dueSoon}} sắp đến hạn",
    empty: { title: "Không có task cần chú ý" },
  },
  notifications: {
    title: "Thông báo mới",
    unreadSummary: "{{unread}}/{{total}} chưa đọc",
    empty: { title: "Bạn không có thông báo mới" },
  },
};

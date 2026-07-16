/**
 * i18n (vi) — namespace "me", module ME — S5-ME-FE-1 (SPEC-09 §9 ME-SCREEN-001 · §10.1 · §13).
 *
 * MeOverviewPage (Tổng quan cá nhân): banner chào + 5 section (hr/attendance/leave/task/notification) +
 * khối "Cần thực hiện"/"Chờ người khác duyệt" + "Tiện ích" quick actions. Copy trạng thái section theo §13
 * (loading/ok/empty/error/forbidden/module_disabled/unlinked_employee) — mirror namespace "dashboard".
 */
export default {
  page: {
    title: "Tổng quan",
    description: "Không gian cá nhân của bạn — thông tin, việc cần làm và tiện ích nhanh.",
  },
  error: {
    title: "Không thể tải trang tổng quan",
    description: "Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.",
  },
  forbidden: {
    title: "Không có quyền truy cập",
    description: "Bạn không có quyền xem trung tâm cá nhân. Liên hệ quản trị viên nếu cần hỗ trợ.",
  },
  banner: {
    greeting: "Xin chào,",
    unlinkedTitle: "Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.",
    unlinkedDescription: "Vui lòng liên hệ HR hoặc quản trị viên để được liên kết.",
  },
  // Copy trạng thái DÙNG CHUNG cho mọi section (mirror WidgetCard §16.6/§16.7) — §13 SPEC-09.
  section: {
    loading: "Đang tải…",
    error: {
      title: "Không tải được dữ liệu",
      description: "Đã xảy ra lỗi khi tải mục này.",
    },
    forbidden: "Bạn không có quyền xem mục này.",
    moduleDisabled: "Chức năng này hiện chưa được bật cho công ty của bạn.",
    unlinkedEmployee: "Cần liên kết hồ sơ nhân viên để xem mục này.",
  },
  hr: {
    title: "Hồ sơ công việc",
    empty: "Chưa có dữ liệu hồ sơ.",
    startDate: "Ngày vào làm: {{date}}",
  },
  attendance: {
    title: "Chấm công hôm nay",
    empty: "Chưa check-in hôm nay.",
    checkedInAt: "Giờ vào: {{time}}",
    checkedOutAt: "Giờ ra: {{time}}",
    notCheckedOut: "Chưa check-out",
    late: "Đi muộn",
    earlyLeave: "Về sớm",
  },
  leave: {
    title: "Phép còn lại",
    empty: "Chưa có số dư phép.",
    pendingRequests: "{{count}} đơn đang chờ duyệt",
    noPendingRequests: "Không có đơn nào đang chờ duyệt.",
  },
  task: {
    title: "Công việc của tôi",
    empty: "Bạn chưa có công việc nào.",
    assigned: "{{count}} được giao",
    dueToday: "{{count}} đến hạn hôm nay",
    overdue: "{{count}} quá hạn",
    noneToday: "Không có việc cần chú ý hôm nay.",
  },
  notification: {
    title: "Thông báo",
    empty: "Không có thông báo mới.",
    unread: "{{count}} chưa đọc",
  },
  actionNeeded: {
    title: "Cần thực hiện",
    viewAll: "Xem tất cả",
  },
  pendingApproval: {
    title: "Chờ người khác duyệt",
    viewAll: "Xem tất cả",
  },
  quickActions: {
    title: "Tiện ích",
    editProfile: "Chỉnh sửa hồ sơ",
    changePassword: "Đổi mật khẩu",
    checkInOut: "Check-in / Check-out",
    createLeave: "Tạo đơn nghỉ",
    myTasks: "Task của tôi",
    notifications: "Thông báo",
  },
  // ─── S5-ME-FE-3 — 6 trang "Công việc của tôi/Thông báo/Cài đặt cá nhân" (ME-SCREEN-009..014) ───────
  attendancePage: {
    title: "Chấm công của tôi",
    description: "Trạng thái chấm công hôm nay — xem chi tiết ở Bảng công của tôi.",
    error: {
      title: "Không tải được dữ liệu chấm công",
      description: "Đã xảy ra lỗi khi tải trạng thái chấm công. Vui lòng thử lại.",
    },
    linksTitle: "Xem thêm",
    myRecords: "Bảng công của tôi",
  },
  leavePage: {
    title: "Nghỉ phép của tôi",
    description: "Số dư phép hiện tại và số đơn đang chờ duyệt.",
    error: {
      title: "Không tải được dữ liệu nghỉ phép",
      description: "Đã xảy ra lỗi khi tải số dư phép. Vui lòng thử lại.",
    },
    columns: {
      type: "Loại phép",
      remaining: "Còn lại",
    },
    linksTitle: "Xem thêm",
    myRequests: "Đơn nghỉ của tôi",
  },
  tasksPage: {
    title: "Công việc của tôi",
    description: "Tổng số công việc được giao, đến hạn hôm nay và quá hạn.",
    error: {
      title: "Không tải được dữ liệu công việc",
      description: "Đã xảy ra lỗi khi tải công việc của bạn. Vui lòng thử lại.",
    },
    linksTitle: "Xem thêm",
  },
  notificationsPage: {
    title: "Thông báo của tôi",
    description: "Số thông báo chưa đọc và các thông báo gần đây.",
    error: {
      title: "Không tải được thông báo",
      description: "Đã xảy ra lỗi khi tải thông báo. Vui lòng thử lại.",
    },
    recentTitle: "Gần đây",
    list: {
      error: {
        title: "Không tải được danh sách gần đây",
        description: "Đã xảy ra lỗi khi tải thông báo gần đây. Vui lòng thử lại.",
      },
      empty: "Không có thông báo nào.",
    },
    linksTitle: "Xem thêm",
    viewAll: "Xem tất cả thông báo",
  },
  notificationPreferencesPage: {
    title: "Tuỳ chọn thông báo",
    description: "Bật/tắt loại thông báo bạn muốn nhận theo từng kênh.",
    error: {
      title: "Không tải được tuỳ chọn thông báo",
      description: "Đã xảy ra lỗi khi tải cấu hình. Vui lòng thử lại.",
    },
    // Nhóm HEURISTIC theo enum notification_type CŨ hiện có — xem ghi chú giới hạn ở constants.ts
    // (ME_NOTIFICATION_PREFERENCE_GROUPS).
    groups: {
      task: "Công việc & cộng tác",
      approval: "Phê duyệt",
      collaboration: "Trò chuyện & cuộc họp",
      general: "Khác",
    },
    types: {
      task_assigned: "Giao task",
      task_submitted: "Nộp task",
      mentioned: "Được nhắc đến",
      approval_requested: "Yêu cầu duyệt",
      approved: "Đã duyệt",
      revision_requested: "Yêu cầu chỉnh sửa",
      chat_message: "Tin nhắn trò chuyện",
      meeting_invited: "Mời họp",
      meeting_action_assigned: "Giao việc trong cuộc họp",
      general: "Thông báo chung",
    },
    channels: {
      inApp: "Trong ứng dụng",
      email: "Email",
      push: "Di động (push)",
    },
    unavailable: "chưa hỗ trợ",
    mandatoryExplanation: "Đây là thông báo bắt buộc — không thể tắt vì lý do bảo mật/vận hành.",
    genericError: "Không thể cập nhật, vui lòng thử lại.",
  },
  appearancePage: {
    title: "Giao diện",
    description: "Chọn giao diện hiển thị cho ứng dụng.",
    themeSectionTitle: "Chế độ hiển thị",
    theme: {
      system: "Theo hệ thống",
      light: "Sáng",
      dark: "Tối",
    },
    syncError: "Không lưu được trên máy chủ — giao diện vẫn được áp dụng trên máy này.",
    readOnlySectionTitle: "Ngôn ngữ & múi giờ",
    language: "Ngôn ngữ",
    timezone: "Múi giờ",
    localeVi: "Tiếng Việt",
    localeEn: "English",
    inherited: "Theo mặc định hệ thống",
    readOnlyNote: "Chưa thể tuỳ chỉnh ở giai đoạn này — tính năng sẽ mở khi công ty cho phép.",
  },
};

/**
 * Namespace "notifications" (vi) — S4-FE-NOTI-1 (NotificationBadge/Dropdown/List/Detail, apps/app).
 *
 * ĐÈ THÊM (deep-merge, KHÔNG ghi đè) lên bundle "notifications" đã nhúng sẵn ở @mediaos/web-core
 * (title/ariaLabel/markAllRead/empty/types — chuông chrome dùng chung, packages/ui/notification-bell.tsx).
 * File này CHỈ thêm khoá MỚI (list/detail/badge/dropdown/actions/status/priority) — KHÔNG đụng khoá cũ.
 */
export default {
  badge: {
    ariaLabel: "Thông báo",
    loadError: "Không thể tải số thông báo chưa đọc",
  },
  dropdown: {
    title: "Thông báo",
    viewAll: "Xem tất cả",
    empty: "Bạn chưa có thông báo mới",
    loadError: "Không thể tải thông báo. Vui lòng thử lại.",
  },
  list: {
    title: "Thông báo của tôi",
    description: "Danh sách thông báo gửi tới bạn.",
    filters: {
      allStatuses: "Tất cả trạng thái",
      unreadOnly: "Chỉ chưa đọc",
    },
    columns: {
      title: "Nội dung",
      type: "Loại",
      priority: "Mức ưu tiên",
      status: "Trạng thái",
      createdAt: "Thời gian",
      actions: "Thao tác",
    },
    empty: {
      title: "Không có thông báo",
      description: "Bạn chưa có thông báo mới",
    },
    error: {
      title: "Không thể tải danh sách thông báo",
      description: "Có lỗi khi tải danh sách. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền xem thông báo",
      description: "Bạn không có quyền truy cập màn hình này.",
    },
  },
  detail: {
    title: "Chi tiết thông báo",
    backToList: "Quay lại danh sách",
    fields: {
      status: "Trạng thái",
      priority: "Mức ưu tiên",
      sourceModule: "Nguồn",
      createdAt: "Thời gian tạo",
      readAt: "Đã đọc lúc",
    },
    goToTarget: "Đi tới nội dung liên quan",
    noTarget: "Thông báo này không có liên kết đi kèm.",
    notFound: {
      title: "Không tìm thấy thông báo",
      description: "Thông báo có thể đã bị xoá hoặc không tồn tại.",
    },
    error: {
      title: "Không thể tải chi tiết thông báo",
      description: "Có lỗi khi tải thông báo. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền xem thông báo",
      description: "Bạn không có quyền truy cập thông báo này.",
    },
  },
  actions: {
    markRead: "Đánh dấu đã đọc",
    markAllRead: "Đánh dấu tất cả đã đọc",
    markingAllRead: "Đang xử lý…",
    delete: "Xoá",
    deleteConfirm: "Xoá thông báo này?",
  },
  status: {
    Unread: "Chưa đọc",
    Read: "Đã đọc",
    Hidden: "Đã ẩn",
    Archived: "Đã lưu trữ",
    Deleted: "Đã xoá",
    Failed: "Lỗi gửi",
  },
  priority: {
    Low: "Thấp",
    Normal: "Bình thường",
    High: "Cao",
    Urgent: "Khẩn cấp",
    Critical: "Nghiêm trọng",
  },
  // S4-FE-NOTI-2 (UI-NOTI-SCREEN-004) — Quản lý loại thông báo (admin). ĐÈ THÊM, KHÔNG đụng khoá cũ.
  events: {
    title: "Quản lý loại thông báo",
    description: "Danh mục sự kiện thông báo hệ thống — bật/tắt theo công ty.",
    filters: {
      searchPlaceholder: "Tìm theo mã hoặc tên sự kiện…",
      allModules: "Tất cả module",
      allStatuses: "Tất cả trạng thái",
      enabledOnly: "Đang bật",
      disabledOnly: "Đang tắt",
    },
    columns: {
      module: "Module",
      eventCode: "Mã sự kiện",
      eventName: "Tên sự kiện",
      type: "Loại",
      priority: "Mức ưu tiên",
      status: "Trạng thái",
      updatedAt: "Cập nhật gần nhất",
      actions: "Thao tác",
      // S4-FE-NOTI-4 — cột link "Xem template" (SPEC-08 §13.4).
      template: "Mẫu thông báo",
    },
    status: {
      enabled: "Đang bật",
      disabled: "Đang tắt",
    },
    actions: {
      enable: "Bật",
      disable: "Tắt",
      // S4-FE-NOTI-4 — điều hướng /notifications/templates?event=<event_code>.
      viewTemplate: "Xem template",
    },
    confirm: {
      enableTitle: "Bật sự kiện thông báo?",
      enableDescription: 'Sự kiện "{{name}}" sẽ được gửi tới người dùng liên quan.',
      disableTitle: "Tắt sự kiện thông báo?",
      disableDescription: 'Sự kiện "{{name}}" sẽ ngừng gửi cho tới khi được bật lại.',
      cancel: "Huỷ",
      submitting: "Đang xử lý…",
    },
    empty: {
      title: "Chưa có sự kiện thông báo nào",
      description: "Danh mục sự kiện thông báo trống hoặc không khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải danh mục sự kiện",
      description: "Có lỗi khi tải danh mục. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền xem cấu hình thông báo",
      description: "Bạn không có quyền truy cập màn hình này.",
    },
    feedback: {
      updateOk: "Đã cập nhật trạng thái sự kiện.",
      updateFailed: "Cập nhật thất bại. Vui lòng thử lại.",
      dismiss: "Đóng",
    },
  },
  // S4-FE-NOTI-3 — NOTI-SCREEN-DELIVERY-LOGS (/notifications/delivery-logs, viewer append-only).
  deliveryLogs: {
    title: "Nhật ký gửi thông báo",
    description:
      "Lịch sử gửi thông báo theo kênh (IN_APP, EMAIL, PUSH, REALTIME, INTEGRATION) — chỉ đọc",
    columns: {
      createdAt: "Thời gian",
      channel: "Kênh",
      status: "Trạng thái",
      recipient: "Người nhận",
      attempt: "Số lần thử",
      error: "Lỗi",
    },
    // Trạng thái gửi (delivery_status) — KHÔNG trùng namespace `status` (trạng thái đọc/chưa đọc của
    // thông báo My-Notification) — tách riêng vì cùng có key "Failed" nhưng ý nghĩa khác nhau.
    status: {
      Pending: "Đang chờ",
      Sent: "Đã gửi",
      Delivered: "Đã nhận",
      Failed: "Thất bại",
      Skipped: "Bỏ qua",
      Cancelled: "Đã huỷ",
    },
    filters: {
      channel: "Kênh gửi",
      status: "Trạng thái gửi",
      recipient: "Người nhận",
      recipientPlaceholder: "UUID người dùng",
    },
    empty: {
      title: "Không có nhật ký gửi thông báo",
      description: "Chưa có bản ghi gửi thông báo nào khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải nhật ký gửi thông báo",
      description: "Có lỗi khi tải nhật ký gửi thông báo. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem nhật ký gửi thông báo.",
    },
  },
  // S4-FE-NOTI-4 (UI-NOTI-SCREEN-005 / SPEC-08 §13.4 NOTI-SCREEN-006) — Quản lý mẫu thông báo (admin).
  templates: {
    title: "Quản lý mẫu thông báo",
    description: "Danh mục mẫu thông báo theo sự kiện — sửa tiêu đề/nội dung theo công ty.",
    filters: {
      event: "Sự kiện",
      eventPlaceholder: "Mã sự kiện…",
      channel: "Kênh gửi",
      allChannels: "Tất cả kênh",
    },
    columns: {
      event: "Sự kiện",
      templateCode: "Mã mẫu",
      channel: "Kênh",
      locale: "Ngôn ngữ",
      status: "Trạng thái",
      isDefault: "Mặc định",
      scope: "Phạm vi",
      version: "Phiên bản",
      updatedAt: "Cập nhật gần nhất",
      actions: "Thao tác",
    },
    status: {
      Draft: "Nháp",
      Active: "Đang dùng",
      Inactive: "Ngừng dùng",
      Archived: "Đã lưu trữ",
    },
    badges: {
      default: "Mặc định",
      override: "Riêng công ty",
      global: "Toàn hệ thống",
    },
    actions: {
      edit: "Sửa",
    },
    empty: {
      title: "Chưa có mẫu thông báo nào",
      description: "Danh mục mẫu thông báo trống hoặc không khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải danh mục mẫu thông báo",
      description: "Có lỗi khi tải danh mục. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền xem mẫu thông báo",
      description: "Bạn không có quyền truy cập màn hình này.",
    },
    form: {
      title: "Sửa mẫu thông báo",
      cancel: "Huỷ",
      save: "Lưu",
      saving: "Đang lưu…",
      fields: {
        title: "Tiêu đề",
        body: "Nội dung",
        shortBody: "Nội dung rút gọn",
        actionLabel: "Nhãn nút hành động",
        targetUrl: "Đường dẫn liên kết",
        status: "Trạng thái",
      },
      errors: {
        titleRequired: "Vui lòng nhập tiêu đề.",
        titleTooLong: "Tiêu đề tối đa 255 ký tự.",
        bodyRequired: "Vui lòng nhập nội dung.",
        shortBodyTooLong: "Nội dung rút gọn tối đa 500 ký tự.",
        actionLabelTooLong: "Nhãn nút tối đa 100 ký tự.",
        targetUrlTooLong: "Đường dẫn tối đa 500 ký tự.",
        forbidden: "Bạn không có quyền sửa mẫu thông báo này.",
        conflict: "Dữ liệu đã thay đổi — vui lòng tải lại và thử lại.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        server: "Có lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Cập nhật thất bại. Vui lòng thử lại.",
      },
    },
  },
};

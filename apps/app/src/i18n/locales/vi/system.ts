/**
 * Namespace "system" (vi) — màn hình quản trị hệ thống (S2-FE-HR-3).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("system.*").
 */
export default {
  users: {
    title: "Người dùng",
    description: "Danh sách tài khoản người dùng trong hệ thống",
    sprint3Notice: "Chức năng quản lý đầy đủ sẽ có trong Sprint 3",
    columns: {
      email: "Email",
      fullName: "Họ tên",
      status: "Trạng thái",
      lastLogin: "Lần đăng nhập cuối",
    },
    status: {
      active: "Đang hoạt động",
      suspended: "Đã tạm khóa",
    },
    empty: {
      title: "Không có người dùng",
      description: "Chưa có tài khoản người dùng nào trong hệ thống.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách người dùng. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh sách người dùng.",
    },
  },
  roles: {
    title: "Vai trò",
    description: "Danh sách vai trò phân quyền trong hệ thống",
    sprint3Notice: "Quản lý quyền chi tiết theo vai trò sẽ có trong Sprint 3",
    columns: {
      name: "Tên vai trò",
      id: "ID",
    },
    empty: {
      title: "Không có vai trò",
      description: "Chưa có vai trò nào được định nghĩa.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách vai trò. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh sách vai trò.",
    },
  },

  // S2-AUTH-BE-5 — bộ lọc dùng chung cho 2 trang nhật ký bảo mật.
  authLogFilters: {
    fromDate: "Từ ngày",
    toDate: "Đến ngày",
    userId: "Mã người dùng",
    userIdPlaceholder: "UUID người dùng",
    apply: "Lọc",
    reset: "Xóa lọc",
    allStatuses: "Mọi trạng thái",
    allSeverities: "Mọi mức độ",
    eventType: "Loại sự kiện",
    eventTypePlaceholder: "VD: PASSWORD_CHANGED",
    page: "Trang {{page}}",
  },

  loginLogs: {
    title: "Nhật ký đăng nhập",
    description: "Lịch sử các lần đăng nhập (thành công, thất bại, bị chặn) — chỉ đọc",
    columns: {
      createdAt: "Thời gian",
      user: "Người dùng",
      status: "Kết quả",
      ipAddress: "Địa chỉ IP",
      userAgent: "Thiết bị / Trình duyệt",
      failureReason: "Lý do thất bại",
    },
    status: {
      success: "Thành công",
      failed: "Thất bại",
      blocked: "Bị chặn",
    },
    empty: {
      title: "Không có nhật ký đăng nhập",
      description: "Chưa có bản ghi đăng nhập nào khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải nhật ký đăng nhập",
      description: "Có lỗi khi tải nhật ký đăng nhập. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem nhật ký bảo mật của hệ thống.",
    },
  },

  securityEvents: {
    title: "Sự kiện bảo mật",
    description: "Các sự kiện bảo mật của tài khoản (đổi mật khẩu, khóa, gán vai trò…) — chỉ đọc",
    columns: {
      createdAt: "Thời gian",
      eventType: "Loại sự kiện",
      severity: "Mức độ",
      user: "Người dùng",
      actor: "Người thực hiện",
      ipAddress: "Địa chỉ IP",
    },
    severity: {
      info: "Thông tin",
      low: "Thấp",
      medium: "Trung bình",
      high: "Cao",
      critical: "Nghiêm trọng",
    },
    empty: {
      title: "Không có sự kiện bảo mật",
      description: "Chưa có sự kiện bảo mật nào khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải sự kiện bảo mật",
      description: "Có lỗi khi tải sự kiện bảo mật. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem nhật ký bảo mật của hệ thống.",
    },
  },
};

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

  // S2-FE-FND-1 (FND1-APP) — 3 màn System/Foundation.
  overview: {
    title: "Tổng quan hệ thống",
    description: "Cấu hình, hồ sơ công ty và tình trạng dịch vụ",
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền truy cập khu vực quản trị hệ thống.",
    },
    cards: {
      company: {
        title: "Hồ sơ công ty",
        description: "Thông tin pháp lý, liên hệ và định danh của công ty",
        manage: "Xem & chỉnh sửa",
      },
      settings: {
        title: "Cấu hình công ty",
        description: "Múi giờ, ngôn ngữ, giới hạn tệp và các tham số hệ thống",
        manage: "Quản lý cấu hình",
      },
      users: {
        title: "Người dùng",
        description: "Tài khoản người dùng trong hệ thống",
        manage: "Xem người dùng",
      },
      roles: {
        title: "Vai trò",
        description: "Vai trò phân quyền",
        manage: "Xem vai trò",
      },
      health: {
        title: "Tình trạng dịch vụ",
        description: "Trạng thái API backend",
        ok: "Hoạt động bình thường",
        error: "Không kết nối được dịch vụ",
        checking: "Đang kiểm tra…",
      },
    },
  },

  company: {
    title: "Hồ sơ công ty",
    description: "Thông tin định danh, pháp lý và liên hệ của công ty",
    edit: "Chỉnh sửa",
    cancel: "Huỷ",
    save: "Lưu thay đổi",
    saving: "Đang lưu…",
    readOnlyNote: "Các trường mã/định danh do hệ thống quản lý, không chỉnh sửa tại đây.",
    fields: {
      name: "Tên công ty",
      shortName: "Tên viết tắt",
      companyCode: "Mã công ty",
      slug: "Slug",
      status: "Trạng thái",
      taxCode: "Mã số thuế",
      businessType: "Loại hình",
      address: "Địa chỉ",
      phone: "Điện thoại",
      email: "Email",
      website: "Website",
    },
    confirm: {
      title: "Xác nhận cập nhật hồ sơ công ty",
      description: "Bạn có chắc muốn lưu các thay đổi cho hồ sơ công ty?",
      confirmLabel: "Xác nhận lưu",
      cancelLabel: "Xem lại",
    },
    validation: {
      nameRequired: "Tên công ty là bắt buộc",
      email: "Email không hợp lệ",
    },
    empty: {
      title: "Chưa có hồ sơ công ty",
      description: "Không tìm thấy thông tin công ty cho tài khoản hiện tại.",
    },
    error: {
      title: "Không thể tải hồ sơ công ty",
      description: "Có lỗi khi tải hồ sơ công ty. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem hồ sơ công ty.",
    },
    saveError: "Không thể lưu thay đổi. Vui lòng thử lại.",
  },

  settings: {
    title: "Cấu hình công ty",
    description: "Tham số hệ thống áp dụng cho toàn công ty",
    columns: {
      key: "Khoá",
      value: "Giá trị",
      category: "Nhóm",
      scope: "Phạm vi",
    },
    scope: {
      company: "Công ty",
      system: "Hệ thống",
      default: "Mặc định",
    },
    maskedHint: "Giá trị nhạy cảm — được che bởi máy chủ, không hiển thị nội dung thật.",
    edit: "Sửa",
    editValue: "Giá trị mới",
    reason: "Lý do thay đổi",
    reasonPlaceholder: "Ghi chú cho nhật ký kiểm toán (tuỳ chọn)",
    save: "Lưu",
    saving: "Đang lưu…",
    cancel: "Huỷ",
    confirm: {
      title: "Xác nhận thay đổi cấu hình",
      description: "Thay đổi giá trị cấu hình sẽ áp dụng cho toàn công ty. Tiếp tục?",
      sensitiveDescription:
        "Đây là giá trị NHẠY CẢM. Thay đổi sẽ áp dụng cho toàn công ty và được ghi vào nhật ký kiểm toán. Tiếp tục?",
      confirmLabel: "Lưu cấu hình",
      cancelLabel: "Xem lại",
    },
    empty: {
      title: "Không có cấu hình",
      description: "Chưa có tham số cấu hình nào khớp danh sách khoá.",
    },
    error: {
      title: "Không thể tải cấu hình",
      description: "Có lỗi khi tải cấu hình. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem cấu hình hệ thống.",
    },
    saveError: "Không thể lưu cấu hình. Vui lòng thử lại.",
  },

  // /system/settings (SYSTEM_MANAGE) — DEFER: chưa có BE endpoint. KHÔNG nút mutation chết.
  systemSettings: {
    title: "Cấu hình hệ thống",
    description: "Tham số cấp hệ thống (vượt phạm vi công ty)",
    deferredTitle: "Sắp ra mắt",
    deferredDescription:
      "Màn hình cấu hình cấp hệ thống đang chờ endpoint backend (SYSTEM_MANAGE). Sẽ được bổ sung trong đợt tiếp theo.",
  },
};

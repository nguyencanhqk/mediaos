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
    addRole: "Tạo vai trò",
    search: "Tìm theo tên vai trò…",
    columns: {
      name: "Tên vai trò",
      id: "ID",
      description: "Mô tả",
      type: "Loại",
      actions: "Thao tác",
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

  // S2-FE-AUTH-4 (lane FE batch C) — role create/detail/edit + assign-permission + permission catalog.
  roleForm: {
    createTitle: "Tạo vai trò",
    createDescription: "Tạo một vai trò mới cho công ty",
    editTitle: "Sửa vai trò",
    editDescription: "Cập nhật tên/mô tả vai trò",
    fields: {
      name: "Tên vai trò",
      description: "Mô tả",
    },
    cancel: "Huỷ",
    submitCreate: "Tạo vai trò",
    submitSave: "Lưu thay đổi",
    submitting: "Đang lưu…",
    systemLockedNotice: "Vai trò hệ thống — không thể chỉnh sửa.",
    forbidden: {
      description: "Bạn không có quyền tạo/sửa vai trò.",
    },
    errors: {
      nameRequired: "Tên vai trò là bắt buộc",
      nameTooLong: "Tên vai trò tối đa 100 ký tự",
      descriptionTooLong: "Mô tả tối đa 500 ký tự",
      systemRole: "Vai trò hệ thống không thể chỉnh sửa.",
      conflict: "Tên vai trò đã tồn tại.",
      forbidden: "Bạn không có quyền thực hiện thao tác này.",
      validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
      server: "Có lỗi hệ thống. Vui lòng thử lại sau.",
      generic: "Không thể lưu. Vui lòng thử lại.",
    },
  },

  roleDetail: {
    backToList: "Quay lại danh sách",
    edit: "Sửa vai trò",
    managePermissions: "Quản lý quyền",
    systemBadge: "Hệ thống",
    systemRole: "Vai trò hệ thống",
    companyRole: "Vai trò công ty",
    assignedPermissionsNotice:
      "Chưa thể hiển thị danh sách quyền đã gán trực tiếp tại đây — dùng công cụ Quản lý quyền để gán/thu hồi quyền cho vai trò này.",
    fields: {
      name: "Tên vai trò",
      description: "Mô tả",
      type: "Loại",
    },
    error: {
      title: "Không tìm thấy vai trò",
      description: "Vai trò không tồn tại hoặc có lỗi khi tải. Vui lòng thử lại.",
    },
  },

  rolePermissions: {
    title: "Quản lý quyền — {{role}}",
    description: "Gán hoặc thu hồi quyền cho vai trò này theo danh mục quyền hệ thống",
    search: "Tìm theo action/resource…",
    dataScope: "Phạm vi dữ liệu",
    assign: "Gán",
    revoke: "Thu hồi",
    assignedListNotice:
      "Backend hiện chưa cung cấp API xem danh sách quyền ĐÃ gán cho vai trò — bảng dưới đây là danh mục quyền toàn hệ thống để gán/thu hồi, KHÔNG phản ánh trạng thái đã gán.",
    assignSuccess: 'Đã gán quyền "{{pair}}" phạm vi {{scope}} cho vai trò.',
    revokeSuccess: 'Đã thu hồi quyền "{{pair}}" khỏi vai trò.',
    scope: {
      Own: "Cá nhân",
      Team: "Nhóm",
      Department: "Phòng ban",
      Company: "Công ty",
    },
    columns: {
      actions: "Thao tác",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền gán/thu hồi quyền cho vai trò.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải vai trò hoặc danh mục quyền. Vui lòng thử lại.",
    },
    errors: {
      badPair: "Cặp quyền không hợp lệ hoặc không tồn tại trong danh mục.",
      forbidden: "Bạn không có quyền thực hiện thao tác này.",
      notFound: "Vai trò chưa có quyền này để thu hồi.",
      server: "Có lỗi hệ thống. Vui lòng thử lại sau.",
      generic: "Thao tác thất bại. Vui lòng thử lại.",
    },
  },

  permissions: {
    title: "Danh mục quyền",
    description: "Danh sách toàn bộ quyền (action/resource) trong hệ thống — chỉ đọc",
    search: "Tìm theo action/resource…",
    sensitive: "Nhạy cảm",
    columns: {
      resourceType: "Đối tượng",
      action: "Hành động",
      sensitive: "Nhạy cảm",
    },
    empty: {
      title: "Không có quyền",
      description: "Chưa có quyền nào trong danh mục.",
    },
    error: {
      title: "Không thể tải danh mục quyền",
      description: "Có lỗi khi tải danh mục quyền. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh mục quyền.",
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

  // S2-FE-FND-5 (lane FE batch C) — Sequence counters (/system/sequences) + Seed status (/system/seeds).
  sequences: {
    title: "Bộ đếm mã (Sequence)",
    description: "Danh sách bộ đếm sinh mã tự động (nhân sự, hợp đồng…) — xem trước mã kế tiếp",
    search: "Tìm theo module/khoá…",
    preview: "Xem mã kế tiếp",
    previewing: "Đang tính…",
    edit: "Sửa cấu hình",
    columns: {
      moduleCode: "Module",
      sequenceKey: "Khoá",
      scopeType: "Phạm vi",
      lastGeneratedCode: "Mã gần nhất",
      status: "Trạng thái",
      resetPolicy: "Chu kỳ reset",
    },
    status: {
      Active: "Đang dùng",
      Inactive: "Ngừng dùng",
    },
    previewResult: 'Mã kế tiếp: "{{code}}"',
    previewError: "Không thể tính mã kế tiếp. Vui lòng thử lại.",
    form: {
      title: "Sửa cấu hình bộ đếm",
      fields: {
        prefix: "Tiền tố",
        suffix: "Hậu tố",
        datePattern: "Mẫu ngày",
        paddingLength: "Độ dài đệm số",
        incrementBy: "Bước tăng",
        resetPolicy: "Chu kỳ reset",
        status: "Trạng thái",
      },
      cancel: "Huỷ",
      save: "Lưu",
      saving: "Đang lưu…",
      confirm: {
        title: "Xác nhận đổi cấu hình bộ đếm",
        description: "Thay đổi cấu hình bộ đếm sẽ ảnh hưởng đến mã sinh ra kế tiếp. Tiếp tục?",
        confirmLabel: "Lưu cấu hình",
        cancelLabel: "Xem lại",
      },
      errors: {
        forbidden: "Bạn không có quyền sửa cấu hình bộ đếm.",
        conflict: "Cấu hình xung đột. Vui lòng tải lại.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        server: "Có lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Không thể lưu cấu hình. Vui lòng thử lại.",
      },
    },
    empty: {
      title: "Không có bộ đếm",
      description: "Chưa có bộ đếm mã nào được cấu hình.",
    },
    error: {
      title: "Không thể tải danh sách bộ đếm",
      description: "Có lỗi khi tải danh sách bộ đếm. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem bộ đếm mã.",
    },
  },

  seeds: {
    title: "Trạng thái Seed dữ liệu",
    description: "Lịch sử chạy seed dữ liệu gốc (chỉ đọc)",
    search: "Tìm theo khoá/phiên bản seed…",
    columns: {
      seedKey: "Khoá seed",
      seedVersion: "Phiên bản",
      environment: "Môi trường",
      status: "Trạng thái",
      checksum: "Checksum",
      startedAt: "Bắt đầu",
      finishedAt: "Kết thúc",
    },
    status: {
      Pending: "Chờ chạy",
      Running: "Đang chạy",
      Success: "Thành công",
      Failed: "Thất bại",
      Skipped: "Đã bỏ qua",
      RolledBack: "Đã hoàn tác",
    },
    empty: {
      title: "Không có dữ liệu seed",
      description: "Chưa có batch seed nào được ghi nhận cho công ty này.",
    },
    error: {
      title: "Không thể tải trạng thái seed",
      description: "Có lỗi khi tải trạng thái seed. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem trạng thái seed (yêu cầu quyền cấp hệ thống).",
    },
  },
};

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
      invited: "Chờ kích hoạt",
      suspended: "Đã tạm khóa",
      locked: "Đã khoá",
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
    actions: {
      create: "Tạo người dùng",
    },

    // S2-FE-AUTH-3 — form tạo/sửa user (/system/users/new · /system/users/:id/edit)
    form: {
      createTitle: "Tạo người dùng",
      createDescription: "Tạo tài khoản người dùng mới cho công ty",
      editTitle: "Chỉnh sửa người dùng",
      editDescription: "Cập nhật thông tin tài khoản người dùng",
      cancel: "Huỷ",
      submitCreate: "Tạo người dùng",
      submitSave: "Lưu thay đổi",
      submitting: "Đang xử lý…",
      fields: {
        email: "Email",
        fullName: "Họ tên",
        initialPassword: "Mật khẩu ban đầu",
      },
      hints: {
        initialPassword: "Tối thiểu 10 ký tự, có chữ hoa, chữ thường và số.",
        emailImmutable: "Email là định danh, không thể thay đổi sau khi tạo.",
      },
      forbidden: {
        description: "Bạn không có quyền tạo hoặc chỉnh sửa người dùng.",
      },
      validation: {
        emailRequired: "Vui lòng nhập email.",
        emailInvalid: "Email không hợp lệ.",
        fullNameRequired: "Vui lòng nhập họ tên.",
        fullNameTooLong: "Họ tên tối đa 200 ký tự.",
        passwordTooShort: "Mật khẩu tối thiểu 10 ký tự.",
        passwordTooLong: "Mật khẩu tối đa 128 ký tự.",
        passwordNeedsLower: "Mật khẩu phải có chữ thường.",
        passwordNeedsUpper: "Mật khẩu phải có chữ hoa.",
        passwordNeedsDigit: "Mật khẩu phải có chữ số.",
      },
      errors: {
        conflict: "Email đã tồn tại trong công ty.",
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        server: "Có lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Có lỗi xảy ra. Vui lòng thử lại.",
      },
    },

    // S2-FE-AUTH-3 — chi tiết user (/system/users/:id)
    detail: {
      backToList: "Quay lại danh sách",
      fields: {
        email: "Email",
        fullName: "Họ tên",
        status: "Trạng thái",
        lastLogin: "Lần đăng nhập cuối",
        lockedReason: "Lý do khoá",
        createdAt: "Ngày tạo",
      },
      actions: {
        edit: "Chỉnh sửa",
        lock: "Khoá tài khoản",
        unlock: "Mở khoá",
        manageRoles: "Quản lý vai trò",
      },
      confirm: {
        lockTitle: "Xác nhận khoá tài khoản",
        lockDescription:
          "Người dùng sẽ không thể đăng nhập cho đến khi được mở khoá. Bạn có chắc muốn tiếp tục?",
        unlockTitle: "Xác nhận mở khoá tài khoản",
        unlockDescription: "Người dùng sẽ có thể đăng nhập trở lại. Bạn có chắc muốn tiếp tục?",
      },
      error: {
        title: "Không thể tải thông tin người dùng",
        description: "Có lỗi khi tải thông tin người dùng. Vui lòng thử lại.",
      },
      errors: {
        badRequest:
          "Không thể thực hiện: tài khoản đã ở trạng thái này hoặc bạn đang thao tác trên chính mình.",
        notFound: "Không tìm thấy tài khoản (có thể đã bị xoá).",
        conflict: "Không thể thực hiện: trạng thái đã thay đổi. Vui lòng tải lại.",
      },

      // S2-FE-SYS-SEC-1 — card xác thực 2 lớp (2FA). CHỈ hiển thị trạng thái + nguồn ép; KHÔNG secret.
      twoFactor: {
        title: "Xác thực 2 lớp (2FA)",
        enabled: "Đã bật",
        disabled: "Chưa bật",
        enforcement: "Bắt buộc:",
        notRequired: "Không bắt buộc",
        byRole: "Theo vai trò",
        byUser: "Theo tài khoản",
        forceLabel: "Ép 2FA tài khoản này",
        forceHint: "Người dùng phải bật 2FA mới đăng nhập được, không phụ thuộc vai trò.",
        reset: "Đặt lại 2FA",
        resetHint: "Gỡ 2FA khỏi tài khoản và thu hồi mọi phiên đăng nhập hiện có.",
        resetSuccess: "Đã đặt lại 2FA. Đã thu hồi {{count}} phiên đăng nhập.",
        confirm: {
          resetTitle: "Xác nhận đặt lại 2FA",
          resetDescription:
            "Tài khoản sẽ bị gỡ xác thực 2 lớp và mọi phiên đăng nhập hiện có sẽ bị thu hồi. Bạn có chắc muốn tiếp tục?",
        },
      },
    },

    // S2-FE-AUTH-3 — gán/gỡ role (/system/users/:id/roles)
    roles: {
      title: "Quản lý vai trò",
      description: "Gán hoặc gỡ vai trò phân quyền cho người dùng này",
      limitationNotice:
        "Màn hình hiện chưa hiển thị được vai trò ĐANG giữ (backend chưa có API đọc role theo user) — chỉ hỗ trợ thao tác Gán/Gỡ trên danh mục vai trò bên dưới; kết quả thao tác hiển thị ở nhật ký phiên.",
      systemRole: "Vai trò hệ thống",
      forbidden: {
        description: "Bạn không có quyền gán vai trò cho người dùng.",
      },
      empty: {
        title: "Không có vai trò",
        description: "Chưa có vai trò nào trong danh mục.",
      },
      error: {
        title: "Không thể tải danh mục vai trò",
        description: "Có lỗi khi tải danh mục vai trò. Vui lòng thử lại.",
      },
      actions: {
        assign: "Gán",
        revoke: "Gỡ",
      },
      sessionLog: {
        title: "Nhật ký thao tác (phiên này)",
        assigned: 'Đã gán vai trò "{{role}}".',
        revoked: 'Đã gỡ vai trò "{{role}}".',
        error: 'Lỗi với vai trò "{{role}}": {{detail}}',
      },
      errors: {
        notAssigned: "Người dùng chưa có vai trò này — không thể gỡ.",
        conflict: "Vai trò này đã được gán trước đó.",
        badRequest: "Yêu cầu không hợp lệ (có thể bạn đang thao tác trên chính mình).",
      },
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
      requiresTwoFactor: "Bắt buộc 2FA",
      requiresTwoFactorHint:
        "Mọi người dùng mang vai trò này phải bật xác thực 2 lớp mới đăng nhập được.",
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
    tabs: {
      info: "Thông tin",
      members: "Thành viên",
    },
  },

  // S2-AUTH-ROLEMEM-1 — tab Thành viên trên trang chi tiết vai trò.
  roleMembers: {
    count: "{{count}} thành viên đang giữ vai trò này",
    expiresAt: "hết hạn {{date}}",
    forbidden: {
      title: "Không có quyền xem",
      description: "Bạn cần quyền xem người dùng để xem danh sách thành viên của vai trò.",
    },
    error: {
      title: "Không tải được danh sách thành viên",
      description: "Có lỗi khi tải danh sách thành viên. Vui lòng thử lại.",
    },
    empty: {
      title: "Chưa có thành viên",
      description: "Chưa có tài khoản nào được gán vai trò này.",
    },
    actions: {
      addPerson: "Thêm người",
      addOrgUnit: "Thêm theo phòng ban",
      remove: "Gỡ",
    },
    removeConfirm: {
      title: "Gỡ thành viên khỏi vai trò?",
      description: "Tài khoản {{email}} sẽ mất các quyền do vai trò này cấp.",
    },
    addPerson: {
      title: "Thêm người vào vai trò",
      description: "Tìm và chọn tài khoản để gán vai trò này. Tài khoản đã là thành viên không hiển thị.",
      searchPlaceholder: "Tìm theo email hoặc tên...",
      empty: "Không có tài khoản phù hợp (hoặc tất cả đã là thành viên).",
      submit: "Gán {{count}} tài khoản",
    },
    addOrgUnit: {
      title: "Thêm cả phòng ban vào vai trò",
      description:
        "Chọn phòng ban/đội — mọi nhân viên ĐÃ có tài khoản và chưa giữ vai trò sẽ được gán.",
      selectLabel: "Phòng ban",
      selectPlaceholder: "— Chọn phòng ban —",
      preview: {
        toAssign: "Sẽ gán: {{count}} tài khoản",
        alreadyMembers: "Bỏ qua (đã là thành viên): {{count}}",
        unlinked: "Không gán được (nhân viên chưa liên kết tài khoản): {{count}}",
        pageCap: "Phòng ban có ≥100 nhân viên — chỉ xử lý 100 người đầu, chạy lại để gán phần còn lại.",
      },
      submit: "Gán {{count}} tài khoản",
    },
    batch: {
      running: "Đang gán...",
      ok: "✓ {{label}} — đã gán",
      error: "✗ {{label}} — {{detail}}",
    },
    errors: {
      forbiddenRow: "Không đủ quyền (hoặc không thể tự gán cho chính mình)",
      notFound: "Không tìm thấy (tài khoản/vai trò hoặc chưa giữ vai trò)",
      conflict: "Xung đột — đã được gán song song",
    },
  },

  // S2-AUTH-PERMUX-1 (#3) — nhân bản vai trò.
  roleClone: {
    button: "Nhân bản",
    title: "Nhân bản vai trò — {{source}}",
    description:
      "Tạo vai trò mới sao chép toàn bộ quyền ALLOW từ vai trò nguồn (bỏ qua quyền DENY và phạm vi Hệ thống).",
    namePlaceholder: "Tên vai trò mới...",
    submit: "Tạo + sao chép quyền",
    openNewRole: "Mở vai trò mới",
    copiedFrom: "Sao chép từ {{source}}",
    skipDeny: "quyền DENY — không sao chép",
    skipSystemScope: "phạm vi Hệ thống — vượt trần gán qua API",
    skippedLine: "⊘ {{label}} — {{detail}}",
    errors: {
      nameConflict: "Tên vai trò đã tồn tại",
    },
  },

  rolePermissions: {
    title: "Quản lý quyền — {{role}}",
    description: "Gán hoặc thu hồi quyền cho vai trò này theo danh mục quyền hệ thống",
    search: "Tìm theo action/resource…",
    dataScope: "Phạm vi dữ liệu",
    assign: "Gán",
    revoke: "Thu hồi",
    // S2-AUTH-PERMUX-1 v2 — trang đã hiện trạng thái ĐÃ GÁN thật (GET :id/permissions).
    summaryAssigned: "Vai trò đang có {{count}} quyền được gán",
    groupAssigned: "đã gán {{assigned}}/{{total}}",
    assignedBadge: "Đã gán · {{scope}}",
    bulk: {
      selected: "Đã chọn {{count}} quyền",
      assign: "Gán {{count}} quyền",
      checkboxLabel: "Chọn quyền {{pair}}",
    },
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
      holidays: {
        title: "Ngày nghỉ lễ",
        description: "Danh sách ngày nghỉ lễ công ty và hệ thống",
        manage: "Quản lý ngày nghỉ",
      },
      retention: {
        title: "Chính sách lưu trữ",
        description: "Số ngày lưu trữ dữ liệu và hành động dọn dẹp theo module",
        manage: "Quản lý chính sách",
      },
      fileAccessLogs: {
        title: "Nhật ký truy cập tệp",
        description: "Lịch sử truy cập tệp — chỉ đọc",
        manage: "Xem nhật ký",
      },
      // S2-FE-FND-7 (RC2) — thẻ audit-log để persona chỉ view:audit-log không rơi soft-403.
      auditLogs: {
        title: "Nhật ký kiểm toán",
        description: "Lịch sử thao tác quan trọng trong hệ thống — chỉ đọc",
        manage: "Xem nhật ký kiểm toán",
      },
      health: {
        title: "Tình trạng dịch vụ",
        description: "Trạng thái API backend",
        ok: "Hoạt động bình thường",
        error: "Không kết nối được dịch vụ",
        checking: "Đang kiểm tra…",
        manage: "Xem chi tiết",
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

  // S2-FE-FND-4 — /system/public-holidays (list + CRUD).
  publicHolidays: {
    title: "Ngày nghỉ lễ",
    description: "Danh sách ngày nghỉ lễ công ty và hệ thống, dùng cho chấm công và tính phép",
    columns: {
      date: "Ngày",
      name: "Tên ngày nghỉ",
      code: "Mã",
      type: "Loại",
      scope: "Phạm vi",
    },
    scope: {
      company: "Công ty",
      global: "Hệ thống",
    },
    actions: {
      columnHeader: "Thao tác",
      create: "Thêm ngày nghỉ",
      edit: "Sửa",
      delete: "Xoá",
    },
    form: {
      createTitle: "Thêm ngày nghỉ lễ",
      editTitle: "Sửa ngày nghỉ lễ",
      code: "Mã ngày nghỉ",
      name: "Tên ngày nghỉ",
      date: "Ngày",
      type: "Loại",
      description: "Ghi chú",
      isPaidHoliday: "Nghỉ có lương",
      affectsAttendance: "Ảnh hưởng chấm công",
      affectsLeaveCalculation: "Ảnh hưởng tính phép",
      cancel: "Huỷ",
      save: "Lưu",
      saving: "Đang lưu…",
      errors: {
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        conflict: "Ngày nghỉ trùng (mã + ngày đã tồn tại trong công ty).",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        server: "Có lỗi hệ thống. Vui lòng thử lại.",
        generic: "Không thể lưu ngày nghỉ. Vui lòng thử lại.",
      },
      validation: {
        dateFormat: "Ngày phải đúng định dạng YYYY-MM-DD",
      },
    },
    confirmDelete: {
      title: "Xác nhận xoá ngày nghỉ",
      description:
        'Bạn có chắc muốn xoá ngày nghỉ "{{name}}"? Hành động này có thể ảnh hưởng chấm công/tính phép liên quan.',
      confirmLabel: "Xoá",
      cancelLabel: "Huỷ",
      busyLabel: "Đang xoá…",
    },
    empty: {
      title: "Chưa có ngày nghỉ lễ",
      description: "Chưa có ngày nghỉ lễ nào trong năm hiện tại.",
    },
    error: {
      title: "Không thể tải danh sách ngày nghỉ",
      description: "Có lỗi khi tải danh sách ngày nghỉ lễ. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh sách ngày nghỉ lễ.",
    },
  },

  // S2-FE-FND-4 — /system/health (read-only, liveness + readiness).
  health: {
    title: "Tình trạng hệ thống",
    description: "Trạng thái dịch vụ backend và kết nối cơ sở dữ liệu — chỉ đọc",
    status: {
      checking: "Đang kiểm tra…",
      ok: "Hoạt động bình thường",
      down: "Không hoạt động",
    },
    cards: {
      api: {
        title: "Dịch vụ API",
        description: "Trạng thái liveness của backend",
        timestamp: "Cập nhật lúc {{time}}",
      },
      db: {
        title: "Cơ sở dữ liệu",
        description: "Trạng thái kết nối đến PostgreSQL",
        latency: "Độ trễ: {{ms}}ms",
      },
    },
    error: {
      title: "Không thể kiểm tra tình trạng hệ thống",
      description: "Có lỗi khi kiểm tra tình trạng dịch vụ. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem tình trạng hệ thống.",
    },
  },

  // S2-FE-FND-6 — /system/retention (config data-retention, governs purge).
  retention: {
    title: "Chính sách lưu trữ",
    description: "Số ngày lưu trữ dữ liệu và hành động dọn dẹp theo từng module/loại dữ liệu",
    columns: {
      module: "Module",
      entity: "Loại dữ liệu",
      retentionDays: "Số ngày lưu",
      cleanupAction: "Hành động dọn dẹp",
      status: "Trạng thái",
    },
    cleanupAction: {
      None: "Không dọn dẹp",
      Archive: "Lưu trữ",
      Delete: "Xoá",
      Anonymize: "Ẩn danh hoá",
    },
    status: {
      enabled: "Đang áp dụng",
      disabled: "Tạm tắt",
    },
    actions: {
      columnHeader: "Thao tác",
      edit: "Sửa",
    },
    form: {
      editTitle: "Sửa chính sách lưu trữ — {{module}} / {{entity}}",
      retentionDays: "Số ngày lưu trữ",
      cleanupAction: "Hành động dọn dẹp",
      archiveAfterDays: "Lưu trữ sau (ngày)",
      deleteAfterDays: "Xoá sau (ngày)",
      isEnabled: "Đang áp dụng chính sách này",
      description: "Ghi chú",
      cancel: "Huỷ",
      save: "Lưu",
      saving: "Đang lưu…",
      errors: {
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        notFound: "Không tìm thấy chính sách lưu trữ.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        server: "Có lỗi hệ thống. Vui lòng thử lại.",
        generic: "Không thể lưu chính sách lưu trữ. Vui lòng thử lại.",
      },
    },
    confirm: {
      title: "Xác nhận thay đổi chính sách lưu trữ",
      description:
        "Chính sách lưu trữ chi phối việc dọn dẹp/xoá dữ liệu (retention governs purge). Thay đổi có thể ảnh hưởng dữ liệu module liên quan. Tiếp tục?",
      confirmLabel: "Xác nhận lưu",
      cancelLabel: "Xem lại",
    },
    empty: {
      title: "Chưa có chính sách lưu trữ",
      description: "Chưa có chính sách lưu trữ nào được cấu hình.",
    },
    error: {
      title: "Không thể tải chính sách lưu trữ",
      description: "Có lỗi khi tải danh sách chính sách lưu trữ. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem chính sách lưu trữ.",
    },
  },

  // S2-FE-FND-6 — /system/file-access-logs (viewer, append-only).
  fileAccessLogs: {
    title: "Nhật ký truy cập tệp",
    description: "Lịch sử truy cập tệp (tải lên, tải xuống, xem, xoá…) — chỉ đọc",
    columns: {
      createdAt: "Thời gian",
      action: "Hành động",
      result: "Kết quả",
      deniedReason: "Lý do từ chối",
      actor: "Người thực hiện",
      module: "Module / Đối tượng",
    },
    result: {
      granted: "Cho phép",
      denied: "Từ chối",
    },
    filters: {
      action: "Hành động",
      fileId: "Mã tệp",
      fileIdPlaceholder: "UUID tệp",
    },
    empty: {
      title: "Không có nhật ký truy cập tệp",
      description: "Chưa có bản ghi truy cập tệp nào khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải nhật ký truy cập tệp",
      description: "Có lỗi khi tải nhật ký truy cập tệp. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem nhật ký truy cập tệp.",
    },
  },

  // S2-FE-FND-2 — bộ lọc dùng cho viewer Audit log.
  auditLogFilters: {
    module: "Module",
    modulePlaceholder: "VD: HR, ATT, AUTH",
    action: "Hành động",
    actionPlaceholder: "VD: create, update, delete",
    actor: "Người thực hiện",
    actorPlaceholder: "UUID người dùng",
    entity: "Đối tượng",
    entityPlaceholder: "VD: Employee, LeaveRequest",
    fromDate: "Từ ngày",
    toDate: "Đến ngày",
    apply: "Lọc",
    reset: "Xóa lọc",
    page: "Trang {{page}}",
  },

  // S2-FE-FND-2 — SYSTEM-SCREEN-AUDIT-LOGS (/system/audit-logs + /:id).
  auditLogs: {
    title: "Audit log",
    description: "Nhật ký thay đổi dữ liệu của công ty (chỉ đọc, append-only)",
    columns: {
      createdAt: "Thời gian",
      module: "Module",
      action: "Hành động",
      entity: "Đối tượng",
      actor: "Người thực hiện",
      actions: "",
      viewDetail: "Xem chi tiết",
    },
    empty: {
      title: "Không có audit log",
      description: "Chưa có bản ghi audit nào khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải audit log",
      description: "Có lỗi khi tải audit log. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem audit log của công ty.",
    },
    detail: {
      title: "Chi tiết audit log",
      backToList: "Quay lại danh sách",
      entityId: "Mã đối tượng",
      dataScope: "Phạm vi dữ liệu",
      ip: "Địa chỉ IP",
      userAgent: "Thiết bị / Trình duyệt",
      requestId: "Mã yêu cầu",
      errorCode: "Mã lỗi",
      errorMessage: "Thông báo lỗi",
      changedFields: "Trường đã đổi",
      oldValues: "Giá trị cũ",
      newValues: "Giá trị mới",
      notFound: {
        title: "Không tìm thấy bản ghi",
        description: "Bản ghi audit log này không tồn tại hoặc đã bị xoá.",
      },
    },
  },

  // S2-FE-FND-2 — SYSTEM-SCREEN-FILES (/system/files + /:id).
  files: {
    title: "Tệp tin",
    description: "Metadata tệp tin đã tải lên hệ thống (chỉ đọc)",
    columns: {
      name: "Tên tệp",
      mimeType: "Loại tệp",
      size: "Dung lượng",
      visibility: "Hiển thị",
      uploadStatus: "Trạng thái",
      scanStatus: "Quét virus",
      uploadedAt: "Ngày tải lên",
      actions: "",
      viewDetail: "Xem chi tiết",
    },
    visibility: {
      Private: "Riêng tư",
      Internal: "Nội bộ",
      Public: "Công khai",
    },
    uploadStatus: {
      Pending: "Đang xử lý",
      Uploaded: "Đã tải lên",
      Failed: "Thất bại",
      Deleted: "Đã xoá",
    },
    scanStatus: {
      NotRequired: "Không yêu cầu",
      Pending: "Đang quét",
      Clean: "Sạch",
      Infected: "Nhiễm mã độc",
      Failed: "Quét lỗi",
    },
    empty: {
      title: "Không có tệp tin",
      description: "Chưa có tệp tin nào khớp bộ lọc.",
    },
    error: {
      title: "Không thể tải danh sách tệp tin",
      description: "Có lỗi khi tải danh sách tệp tin. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem tệp tin của công ty.",
    },
    filters: {
      moduleCode: "Module",
      moduleCodePlaceholder: "VD: HR, ATT, TASK",
      entityType: "Đối tượng",
      entityTypePlaceholder: "VD: Employee, Task",
      visibility: "Hiển thị",
      allVisibility: "Mọi mức hiển thị",
      apply: "Lọc",
      reset: "Xóa lọc",
    },
    detail: {
      title: "Chi tiết tệp tin",
      backToList: "Quay lại danh sách",
      downloadCount: "Số lần tải",
      owner: "Chủ sở hữu",
      isTemporary: "Tệp tạm",
      yes: "Có",
      no: "Không",
      links: "Liên kết đối tượng",
      noLinks: "Chưa gắn với đối tượng nào.",
      download: "Tải xuống",
      notFound: {
        title: "Không tìm thấy tệp tin",
        description: "Tệp tin này không tồn tại hoặc đã bị xoá.",
      },
    },
  },

  // S2-FE-FND-3 — SYSTEM-SCREEN-MODULES (/system/modules + /:code). Read-only trước (toggle chờ BE).
  modules: {
    title: "Danh mục module",
    description: "Toàn bộ module của hệ thống — tên, nhóm, trạng thái kích hoạt (chỉ đọc)",
    columns: {
      code: "Mã module",
      name: "Tên module",
      group: "Nhóm",
      active: "Trạng thái",
      enabled: "Bật/Tắt",
      actions: "",
      viewDetail: "Xem chi tiết",
    },
    active: {
      yes: "Đang hoạt động",
      no: "Ngừng hoạt động",
    },
    enabled: {
      yes: "Đã bật",
      no: "Đã tắt",
    },
    empty: {
      title: "Không có module",
      description: "Chưa có module nào khớp tìm kiếm.",
    },
    error: {
      title: "Không thể tải danh mục module",
      description: "Có lỗi khi tải danh mục module. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh mục module của hệ thống.",
    },
    filters: {
      search: "Tìm kiếm",
      searchPlaceholder: "Tìm theo mã hoặc tên module",
    },
    detail: {
      title: "Chi tiết module",
      backToList: "Quay lại danh sách",
      description: "Mô tả",
      route: "Đường dẫn",
      requiredPermissions: "Quyền yêu cầu",
      noPermissions: "Module này không yêu cầu quyền riêng — mọi user đều thấy được.",
      toggleDeferredNotice:
        "Bật/tắt module sẽ được bổ sung ở đợt sau (backend chưa có API thao tác). Trạng thái hiển thị ở đây chỉ để tham khảo.",
      notFound: {
        title: "Không tìm thấy module",
        description: "Module này không tồn tại hoặc đã bị xoá.",
      },
    },
  },
};

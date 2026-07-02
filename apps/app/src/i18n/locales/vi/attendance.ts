/**
 * Namespace "attendance" (vi) — màn hình chấm công (S3-FE-ATT-1).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("attendance.*").
 * Khớp ATT-SCREEN-001 (Chấm công hôm nay) + SPEC-04 §9 + §11.
 */
export default {
  pageTitle: "Chấm công",

  // ── Trạng thái chấm công — SPEC-04 §9 ────────────────────────────────────────
  status: {
    "Not Checked-in": "Chưa chấm công",
    "Checked-in": "Đã check-in",
    "Checked-out": "Đã check-out",
    Present: "Có mặt",
    Late: "Đi muộn",
    "Early Leave": "Về sớm",
    "Missing Hours": "Thiếu giờ",
    "Missing Check-in": "Thiếu check-in",
    "Missing Check-out": "Thiếu check-out",
    Absent: "Vắng mặt",
    Leave: "Nghỉ phép",
    "Remote Work": "Làm remote",
    "Auto Attendance": "Tự động chấm công",
    Adjusted: "Đã điều chỉnh",
    "Pending Adjustment": "Chờ điều chỉnh",
    Invalid: "Không hợp lệ",
  },

  // ── Màn chấm công hôm nay (ATT-SCREEN-001) ────────────────────────────────
  today: {
    title: "Chấm công hôm nay",
    description: "Trạng thái chấm công ngày {{date}}",
    noEmployee: "Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.",

    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem thông tin chấm công.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải trạng thái chấm công. Vui lòng thử lại.",
    },
    empty: {
      title: "Chưa có dữ liệu chấm công hôm nay",
      description: "Bạn chưa bắt đầu chấm công hôm nay.",
    },
    periodLocked: "Kỳ công đã được khoá. Bạn không thể thay đổi dữ liệu chấm công.",

    // Card trạng thái
    statusCard: {
      title: "Trạng thái hôm nay",
      checkIn: "Check-in",
      checkOut: "Check-out",
      workedMinutes: "Đã làm: {{minutes}} phút",
      requiredMinutes: "Yêu cầu: {{minutes}} phút",
      lateMinutes: "Đi muộn: {{minutes}} phút",
      earlyLeaveMinutes: "Về sớm: {{minutes}} phút",
      missingMinutes: "Thiếu: {{minutes}} phút",
      shift: {
        title: "Ca làm việc",
        startEnd: "{{start}} — {{end}}",
        noShift: "Không có ca làm việc",
      },
    },

    // Hành động check-in/out
    actions: {
      checkIn: "Check-in",
      checkOut: "Check-out",
      checking: "Đang xử lý…",
      successCheckIn: "Check-in thành công!",
      successCheckOut: "Check-out thành công!",
      errorCheckIn: "Không thể check-in. Vui lòng thử lại.",
      errorCheckOut: "Không thể check-out. Vui lòng thử lại.",
      disabledReason: {
        label: "Lý do:",
      },
    },
  },

  // ── Bảng công của tôi (ATT-SCREEN-002) ────────────────────────────────────────
  records: {
    title: "Bảng công của tôi",
    description: "Lịch sử chấm công theo tháng",
    columns: {
      date: "Ngày",
      shift: "Ca",
      checkIn: "Check-in",
      checkOut: "Check-out",
      totalHours: "Tổng giờ",
      status: "Trạng thái",
      source: "Nguồn",
      actions: "Hành động",
    },
    filters: {
      month: "Tháng",
      fromDate: "Từ ngày",
      toDate: "Đến ngày",
      allStatuses: "Tất cả trạng thái",
    },
    empty: {
      title: "Không có dữ liệu",
      description: "Chưa có bản ghi chấm công trong khoảng thời gian này.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải bảng công. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem bảng công.",
    },
  },

  // ── Bảng công nhóm (ATT-SCREEN-003) ──────────────────────────────────────────
  team: {
    title: "Bảng công nhóm",
    description: "Chấm công theo nhóm/phòng ban",
    empty: {
      title: "Không có dữ liệu",
      description: "Chưa có bản ghi chấm công cho nhóm trong khoảng thời gian này.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải bảng công nhóm. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem bảng công nhóm.",
    },
  },

  // ── Bảng công toàn công ty (S3-FE-ATT-5) ─────────────────────────────────────
  company: {
    title: "Bảng công toàn công ty",
    description: "Chấm công toàn bộ nhân viên trong công ty",
    empty: {
      title: "Không có dữ liệu",
      description: "Chưa có bản ghi chấm công trong khoảng thời gian này.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải bảng công công ty. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem bảng công toàn công ty.",
    },
  },

  // ── Form CRUD dùng chung (S3-FE-ATT-5) ────────────────────────────────────────
  form: {
    buttons: {
      save: "Lưu",
      cancel: "Huỷ",
      saving: "Đang lưu…",
    },
    errors: {
      forbidden: "Bạn không có quyền thực hiện thao tác này.",
      conflict: "Dữ liệu bị trùng hoặc xung đột. Vui lòng kiểm tra lại.",
      validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
      server: "Lỗi máy chủ. Vui lòng thử lại sau.",
      generic: "Không thể lưu. Vui lòng thử lại.",
      // S3-FE-ATT-3 — thông điệp validate form đơn điều chỉnh (adjustment-form-schema.ts).
      workDateRequired: "Vui lòng chọn ngày làm việc.",
      reasonMin: "Lý do phải có ít nhất 3 ký tự.",
      reasonMax: "Lý do tối đa 1000 ký tự.",
      checkInRequired: "Loại yêu cầu này bắt buộc nhập giờ check-in đề nghị.",
      checkOutRequired: "Loại yêu cầu này bắt buộc nhập giờ check-out đề nghị.",
    },
  },

  // ── Ca làm việc (S3-FE-ATT-5) ─────────────────────────────────────────────────
  shifts: {
    title: "Ca làm việc",
    description: "Danh mục ca làm việc của công ty",
    actions: {
      create: "Thêm ca",
      edit: "Sửa",
      columnHeader: "Thao tác",
    },
    form: {
      createTitle: "Thêm ca làm việc",
      editTitle: "Sửa ca làm việc",
      code: "Mã ca",
      name: "Tên ca",
      type: "Loại ca",
      startTime: "Giờ bắt đầu",
      endTime: "Giờ kết thúc",
      requiredMinutes: "Số phút yêu cầu",
      breakMinutes: "Phút nghỉ",
      status: "Trạng thái",
      isDefault: "Đặt làm ca mặc định",
    },
    columns: {
      code: "Mã ca",
      name: "Tên ca",
      type: "Loại ca",
      time: "Giờ làm việc",
      requiredMinutes: "Số phút yêu cầu",
      status: "Trạng thái",
    },
    empty: {
      title: "Chưa có ca làm việc",
      description: "Công ty chưa cấu hình ca làm việc nào.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải danh mục ca làm việc. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem ca làm việc.",
    },
  },

  // ── Gán ca (S3-FE-ATT-5) ───────────────────────────────────────────────────────
  shiftAssignments: {
    title: "Gán ca",
    description: "Danh sách gán ca theo công ty / phòng ban / nhân viên",
    actions: {
      create: "Thêm gán ca",
    },
    form: {
      createTitle: "Thêm gán ca",
      shift: "Ca làm việc",
      scope: "Phạm vi",
      scopeTarget: "Phạm vi Phòng ban/Nhân viên cần chọn đối tượng.",
      departmentId: "ID phòng ban",
      employeeId: "ID nhân viên",
      effectiveFrom: "Hiệu lực từ",
      effectiveTo: "Hiệu lực đến",
      priority: "Độ ưu tiên",
    },
    columns: {
      shift: "Ca làm việc",
      scope: "Phạm vi",
      target: "Đối tượng",
      effectiveFrom: "Hiệu lực từ",
      effectiveTo: "Hiệu lực đến",
      priority: "Độ ưu tiên",
      status: "Trạng thái",
    },
    empty: {
      title: "Chưa có gán ca",
      description: "Công ty chưa cấu hình gán ca nào.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải danh sách gán ca. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem gán ca.",
    },
  },

  // ── Rule chấm công (S3-FE-ATT-5) ───────────────────────────────────────────────
  rules: {
    title: "Rule chấm công",
    description: "Danh sách rule chấm công theo phạm vi",
    actions: {
      create: "Thêm rule",
      edit: "Sửa",
      columnHeader: "Thao tác",
    },
    form: {
      createTitle: "Thêm rule chấm công",
      editTitle: "Sửa rule chấm công",
      code: "Mã rule",
      name: "Tên rule",
      scope: "Phạm vi",
      scopeTarget: "Phạm vi Phòng ban/Nhân viên cần chọn đối tượng.",
      departmentId: "ID phòng ban",
      employeeId: "ID nhân viên",
      effectiveFrom: "Hiệu lực từ",
      effectiveTo: "Hiệu lực đến",
      priority: "Độ ưu tiên",
      requireCheckIn: "Bắt buộc check-in",
      requireCheckOut: "Bắt buộc check-out",
      status: "Trạng thái",
    },
    columns: {
      code: "Mã rule",
      name: "Tên rule",
      scope: "Phạm vi",
      effectiveFrom: "Hiệu lực từ",
      effectiveTo: "Hiệu lực đến",
      priority: "Độ ưu tiên",
      status: "Trạng thái",
    },
    empty: {
      title: "Chưa có rule chấm công",
      description: "Công ty chưa cấu hình rule chấm công nào.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải danh sách rule chấm công. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem rule chấm công.",
    },
  },

  // ── Chi tiết bản ghi (ATT-SCREEN-004) ────────────────────────────────────────
  detail: {
    title: "Chi tiết chấm công",
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem chi tiết bản ghi này.",
    },
    notFound: {
      title: "Không tìm thấy",
      description: "Bản ghi chấm công không tồn tại hoặc đã bị xoá.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải chi tiết chấm công. Vui lòng thử lại.",
    },
    backToList: "Quay lại danh sách",
    fields: {
      date: "Ngày làm việc",
      shift: "Ca làm việc",
      checkIn: "Check-in",
      checkOut: "Check-out",
      totalHours: "Tổng giờ",
      status: "Trạng thái",
      source: "Nguồn chấm công",
      location: "Vị trí",
      employee: "Nhân viên",
      department: "Phòng ban",
    },
    actions: {
      adjustDirect: "Điều chỉnh trực tiếp",
    },
  },

  // ── Đơn điều chỉnh công (ATT-SCREEN-006..010, S3-FE-ATT-3, ATT-FUNC-018..022) ───
  adjustment: {
    myTitle: "Đơn điều chỉnh của tôi",
    myDescription: "Danh sách đơn điều chỉnh công bạn đã gửi",
    manageTitle: "Đơn điều chỉnh cần duyệt",
    manageDescription: "Duyệt đơn điều chỉnh công theo phạm vi nhóm/công ty",

    status: {
      Draft: "Nháp",
      Pending: "Chờ duyệt",
      Approved: "Đã duyệt",
      Rejected: "Từ chối",
      Cancelled: "Đã huỷ",
    },

    requestType: {
      MISSING_CHECK_IN: "Thiếu check-in",
      MISSING_CHECK_OUT: "Thiếu check-out",
      UPDATE_CHECK_IN: "Sửa giờ check-in",
      UPDATE_CHECK_OUT: "Sửa giờ check-out",
      EXPLAIN_LATE: "Giải trình đi muộn",
      EXPLAIN_EARLY_LEAVE: "Giải trình về sớm",
      UPDATE_STATUS: "Sửa trạng thái công",
      REMOTE_CORRECTION: "Điều chỉnh làm remote",
      OTHER: "Khác",
    },

    scope: {
      team: "Nhóm",
      company: "Công ty",
    },

    columns: {
      requester: "Người gửi",
      workDate: "Ngày làm việc",
      requestType: "Loại yêu cầu",
      reason: "Lý do",
      status: "Trạng thái",
      submittedAt: "Ngày gửi",
      actions: "Hành động",
      view: "Xem",
    },

    filters: {
      allTypes: "Tất cả loại yêu cầu",
      allStatuses: "Tất cả trạng thái",
    },

    actions: {
      create: "Tạo đơn điều chỉnh",
      approve: "Duyệt",
      reject: "Từ chối",
      dismiss: "Đóng",
    },

    empty: {
      title: "Không có đơn điều chỉnh",
      description: "Chưa có đơn điều chỉnh công nào trong danh sách này.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải danh sách đơn điều chỉnh. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem đơn điều chỉnh công.",
    },

    form: {
      titleCreate: "Tạo đơn điều chỉnh công",
      descriptionCreate: "Gửi yêu cầu điều chỉnh giờ công / trạng thái cho 1 ngày làm việc",
      submit: "Gửi đơn",
      submitting: "Đang gửi…",
      forbidden: {
        title: "Không có quyền tạo đơn",
        description: "Bạn không có quyền tạo đơn điều chỉnh công.",
      },
      fields: {
        requestType: "Loại yêu cầu",
        workDate: "Ngày làm việc",
        requestedCheckInAt: "Giờ check-in đề nghị",
        requestedCheckOutAt: "Giờ check-out đề nghị",
        reason: "Lý do",
        reasonPlaceholder: "Mô tả lý do cần điều chỉnh…",
      },
    },

    approve: {
      title: "Duyệt đơn điều chỉnh",
      confirm: "Xác nhận duyệt đơn điều chỉnh này? Bản ghi công sẽ được cập nhật ngay.",
      note: "Ghi chú (tuỳ chọn)",
      notePlaceholder: "Ghi chú khi duyệt…",
      submit: "Xác nhận duyệt",
      submitting: "Đang duyệt…",
      forbidden: "Bạn không có quyền duyệt đơn này.",
      error: "Không thể duyệt đơn. Vui lòng thử lại.",
    },

    reject: {
      title: "Từ chối đơn điều chỉnh",
      reasonPlaceholder: "Nhập lý do từ chối…",
      reasonRequired: "Lý do từ chối là bắt buộc.",
      submit: "Xác nhận từ chối",
      submitting: "Đang từ chối…",
      forbidden: "Bạn không có quyền từ chối đơn này.",
      error: "Không thể từ chối đơn. Vui lòng thử lại.",
    },

    detail: {
      title: "Chi tiết đơn điều chỉnh",
      backToList: "Quay lại danh sách",
      itemsTitle: "Lịch sử điều chỉnh (từng trường)",
      itemsEmpty: "Chưa có điều chỉnh nào được ghi nhận.",
      applied: "Đã áp dụng",
      notApplied: "Chưa áp dụng",
      itemsColumns: {
        field: "Trường",
        oldValue: "Giá trị cũ",
        newValue: "Giá trị mới",
        applied: "Trạng thái",
      },
      fields: {
        requestCode: "Mã đơn",
        employee: "Nhân viên",
        workDate: "Ngày làm việc",
        requestType: "Loại yêu cầu",
        status: "Trạng thái",
        reason: "Lý do",
        requestedCheckInAt: "Giờ check-in đề nghị",
        requestedCheckOutAt: "Giờ check-out đề nghị",
        submittedAt: "Ngày gửi",
        reviewedAt: "Ngày xử lý",
        reviewNote: "Ghi chú xử lý",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem đơn điều chỉnh này.",
      },
      notFound: {
        title: "Không tìm thấy",
        description: "Đơn điều chỉnh không tồn tại hoặc đã bị xoá.",
      },
      error: {
        title: "Không thể tải dữ liệu",
        description: "Có lỗi khi tải chi tiết đơn điều chỉnh. Vui lòng thử lại.",
      },
    },

    directAdjust: {
      title: "Điều chỉnh trực tiếp",
      description: "Sửa giờ công NGAY (không qua vòng duyệt) — cần lý do",
      currentCheckIn: "Check-in hiện tại",
      currentCheckOut: "Check-out hiện tại",
      newCheckIn: "Check-in mới",
      newCheckOut: "Check-out mới",
      reason: "Lý do điều chỉnh",
      reasonPlaceholder: "Mô tả lý do điều chỉnh trực tiếp…",
      atLeastOne: "Cần thay đổi ít nhất 1 giá trị (check-in hoặc check-out).",
      submit: "Áp dụng điều chỉnh",
      submitting: "Đang áp dụng…",
      forbidden: "Bạn không có quyền điều chỉnh trực tiếp bản ghi này.",
    },
  },
} as const;

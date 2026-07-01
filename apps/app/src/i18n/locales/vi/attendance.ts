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
  },
} as const;

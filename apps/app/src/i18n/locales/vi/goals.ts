/**
 * S5-GOAL-FE-1 — namespace "goals" (vi). Đăng ký trong apps/app/src/i18n/index.ts. Nhãn enum (level/
 * mode/status/period/measure) + chrome màn hình GOAL-SCREEN-001/002/003. Text người-đọc TÁCH khỏi code.
 */
export default {
  title: "Mục tiêu",
  description: "Quản lý mục tiêu phòng ban, dự án và nhân viên theo kỳ.",

  level: {
    department: "Phòng ban",
    project: "Dự án",
    employee: "Nhân viên",
    company: "Công ty",
  },
  status: {
    Draft: "Nháp",
    Active: "Đang chạy",
    Completed: "Hoàn thành",
    Cancelled: "Đã hủy",
  },
  periodType: {
    quarter: "Theo quý",
    year: "Theo năm",
    custom: "Tùy chỉnh",
  },
  measureType: {
    percent: "Phần trăm (%)",
    number: "Con số",
    boolean: "Có/Không",
  },
  mode: {
    manual: {
      label: "Nhập tay",
      desc: "Tiến độ lấy từ giá trị check-in gần nhất bạn nhập.",
    },
    project: {
      label: "Theo dự án",
      desc: "Tiến độ = tỉ lệ task Done trên toàn dự án (chỉ dùng cho mục tiêu cấp dự án).",
    },
    tasks: {
      label: "Theo công việc gắn",
      desc: "Tiến độ = tỉ lệ task Done trong các task được gắn trực tiếp vào mục tiêu này.",
    },
    children: {
      label: "Theo mục tiêu con",
      desc: "Tiến độ = trung bình có trọng số tiến độ của các mục tiêu con.",
    },
  },
  progress: {
    unmeasured: "—",
    unmeasuredWarning: "Chưa có dữ liệu đo (chưa gắn việc / chưa có mục tiêu con đo được).",
    label: "Tiến độ",
  },

  finalizedBadge: "Đã chốt kỳ",

  list: {
    create: "Tạo mục tiêu",
    view: {
      tree: "Cây",
      list: "Danh sách",
    },
    filters: {
      periodFrom: "Từ ngày",
      periodTo: "Đến ngày",
      level: "Cấp",
      department: "Phòng ban",
      status: "Trạng thái",
      owner: "Người phụ trách",
      allLevels: "Tất cả cấp",
      allStatuses: "Tất cả trạng thái",
      allDepartments: "Tất cả phòng ban",
      ownerPlaceholder: "Lọc theo người phụ trách",
      clear: "Xóa lọc",
    },
    columns: {
      code: "Mã",
      name: "Tên mục tiêu",
      level: "Cấp",
      owner: "Phụ trách",
      period: "Kỳ",
      progress: "Tiến độ",
      status: "Trạng thái",
    },
    empty: {
      title: "Chưa có mục tiêu kỳ này",
      description: "Chưa có mục tiêu nào khớp bộ lọc. Tạo mục tiêu mới để bắt đầu.",
    },
    error: {
      title: "Không tải được danh sách mục tiêu",
      description: "Đã có lỗi khi tải mục tiêu. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Bạn không có quyền xem mục tiêu",
      description: "Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là nhầm lẫn.",
    },
  },

  form: {
    createTitle: "Tạo mục tiêu",
    editTitle: "Sửa mục tiêu",
    sections: {
      basic: "Thông tin cơ bản",
      anchor: "Neo mục tiêu",
      period: "Kỳ mục tiêu",
      measure: "Cách đo tiến độ",
    },
    fields: {
      name: "Tên mục tiêu",
      description: "Mô tả",
      level: "Cấp mục tiêu",
      department: "Phòng ban",
      project: "Dự án",
      employee: "Nhân viên",
      parentGoal: "Mục tiêu cha",
      owner: "Người phụ trách",
      periodType: "Loại kỳ",
      periodStart: "Bắt đầu kỳ",
      periodEnd: "Kết thúc kỳ",
      measureType: "Đơn vị đo",
      targetValue: "Giá trị mục tiêu",
      unit: "Đơn vị",
      progressMode: "Nguồn đo tiến độ",
      weight: "Trọng số",
      status: "Trạng thái",
    },
    placeholders: {
      name: "Ví dụ: Tăng doanh thu phòng Kinh doanh 20%",
      description: "Mô tả ngắn về mục tiêu (không bắt buộc)",
      selectDepartment: "Chọn phòng ban",
      selectProject: "Chọn dự án",
      selectParent: "Không có (mục tiêu gốc)",
      unit: "Ví dụ: %, đơn, triệu VNĐ",
    },
    hints: {
      ownerAuto: "Bỏ trống để hệ thống tự gán (mục tiêu nhân viên = chính nhân viên đó).",
      parentOptional: "Chọn mục tiêu cấp cao hơn để tạo cây (không bắt buộc).",
      projectModeOnlyProject: "Chỉ dùng được cho mục tiêu cấp dự án.",
    },
    errors: {
      nameRequired: "Tên mục tiêu là bắt buộc.",
      levelRequired: "Vui lòng chọn cấp mục tiêu.",
      anchorRequired: "Vui lòng chọn đúng đối tượng neo cho cấp đã chọn.",
      periodRequired: "Vui lòng chọn ngày bắt đầu và kết thúc kỳ.",
      periodOrder: "Ngày kết thúc phải sau ngày bắt đầu.",
      weightPositive: "Trọng số phải lớn hơn 0.",
      targetRequired: "Cần nhập giá trị mục tiêu khi đo bằng con số.",
      // Fallback khi server trả 422 GOAL-ERR-XXX không map riêng.
      generic: "Không lưu được mục tiêu. Vui lòng kiểm tra lại thông tin.",
    },
    submitCreate: "Tạo mục tiêu",
    submitSave: "Lưu thay đổi",
    finalizedLocked: "Mục tiêu đã chốt kỳ — cần mở lại (reopen) trước khi sửa.",
    loadError: "Không tải được mục tiêu để sửa.",
  },

  detail: {
    breadcrumbBack: "Danh sách mục tiêu",
    notFound: {
      title: "Không tìm thấy mục tiêu",
      description: "Mục tiêu không tồn tại hoặc bạn không có quyền xem.",
    },
    error: {
      title: "Không tải được mục tiêu",
      description: "Đã có lỗi khi tải chi tiết mục tiêu. Vui lòng thử lại.",
    },
    finalizedNote: "Mục tiêu đã chốt kỳ — số liệu đóng băng, mọi thao tác ghi bị khóa.",
    actions: {
      edit: "Sửa",
      delete: "Xóa",
      deleteConfirm: "Xóa mục tiêu này? Thao tác là xóa mềm và có thể ảnh hưởng mục tiêu con.",
      deleteError: "Không xóa được mục tiêu.",
    },
    tabs: {
      overview: "Tổng quan",
      linkedTasks: "Công việc gắn",
      children: "Mục tiêu con",
      checkins: "Lịch sử check-in",
    },
    overview: {
      code: "Mã mục tiêu",
      level: "Cấp",
      owner: "Người phụ trách",
      period: "Kỳ",
      measure: "Đơn vị đo",
      target: "Giá trị mục tiêu",
      current: "Giá trị hiện tại",
      progressMode: "Nguồn đo",
      weight: "Trọng số",
      status: "Trạng thái",
      parent: "Mục tiêu cha",
      childCount: "Số mục tiêu con",
      description: "Mô tả",
      noDescription: "Chưa có mô tả.",
    },
    linkedTasks: {
      columns: {
        title: "Công việc",
        status: "Trạng thái",
        assignee: "Phụ trách",
        project: "Dự án",
        due: "Hạn",
      },
      empty: {
        title: "Chưa gắn công việc",
        description: "Mục tiêu này chưa gắn công việc nào. Gắn việc từ màn công việc (sắp có).",
      },
      error: "Không tải được danh sách công việc gắn.",
    },
    children: {
      empty: {
        title: "Chưa có mục tiêu con",
        description: "Mục tiêu này chưa có mục tiêu con nào.",
      },
      error: "Không tải được mục tiêu con.",
    },
    checkins: {
      type: {
        checkin: "Check-in",
        finalize: "Chốt kỳ",
        reopen: "Mở lại",
      },
      columns: {
        type: "Loại",
        progress: "Tiến độ",
        confidence: "Độ tự tin",
        note: "Ghi chú",
        at: "Thời điểm",
      },
      empty: {
        title: "Chưa có lịch sử check-in",
        description: "Mục tiêu này chưa có bản ghi check-in / chốt kỳ nào.",
      },
      error: "Không tải được lịch sử check-in.",
    },
  },
} as const;

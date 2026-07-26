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

  // ─── S5-GOAL-FE-2 (APPEND) — vòng đo: check-in · chốt kỳ/mở lại · gắn-tháo việc ────────────────
  // KHỐI THÊM MỚI, KHÔNG sửa khóa cũ ở trên (file HOT — lane khác cũng đang thêm khóa).
  checkinDialog: {
    title: "Check-in tiến độ",
    description: "Ghi nhận số liệu mới, mức tự tin và ghi chú cho kỳ đang chạy.",
    fields: {
      progressPercent: "Tiến độ (%)",
      currentValue: "Giá trị hiện tại",
      achieved: "Đã đạt mục tiêu",
      confidence: "Mức tự tin (%)",
      note: "Ghi chú",
    },
    hints: {
      target: "Mục tiêu: {{target}}",
      noTarget: "Chưa đặt giá trị mục tiêu.",
      // Mode đo tự động: số do hệ thống tính, người dùng chỉ ghi cảm nhận + ghi chú.
      autoMeasured:
        "Tiến độ mục tiêu này do hệ thống tính tự động — check-in chỉ ghi mức tự tin và ghi chú.",
      valueOptional: "Bỏ trống nếu chỉ muốn ghi mức tự tin / ghi chú.",
    },
    placeholders: {
      note: "Điều gì đang cản trở hoặc hỗ trợ mục tiêu này?",
    },
    submit: "Ghi nhận check-in",
    submitting: "Đang ghi nhận…",
    errors: {
      generic: "Không ghi nhận được check-in. Vui lòng thử lại.",
      confidenceRange: "Mức tự tin phải nằm trong khoảng 0–100.",
      progressRange: "Tiến độ phải nằm trong khoảng 0–100.",
      valueInvalid: "Giá trị nhập không hợp lệ.",
    },
    locked: {
      finalized: "Mục tiêu đã chốt kỳ — cần mở lại trước khi check-in.",
      notActive: "Chỉ mục tiêu đang chạy mới check-in được.",
    },
  },

  finalizeDialog: {
    title: "Chốt kỳ mục tiêu",
    description:
      "Chốt kỳ sẽ ĐÓNG BĂNG số liệu hiện tại: tiến độ ngừng tính lại, mọi thao tác ghi (sửa, check-in, gắn/tháo việc) bị khóa cho tới khi mở lại.",
    noteLabel: "Ghi chú chốt kỳ",
    notePlaceholder: "Tóm tắt kết quả kỳ này (không bắt buộc)",
    submit: "Chốt kỳ",
    submitting: "Đang chốt kỳ…",
    error: "Không chốt kỳ được mục tiêu.",
  },

  reopenDialog: {
    title: "Mở lại mục tiêu",
    description:
      "Mở lại sẽ bỏ đóng băng: tiến độ tính lại theo dữ liệu thực tế và các thao tác ghi được mở khóa. Hành động này được ghi vào sổ lịch sử.",
    noteLabel: "Lý do mở lại",
    notePlaceholder: "Vì sao cần mở lại kỳ này? (không bắt buộc)",
    submit: "Mở lại",
    submitting: "Đang mở lại…",
    error: "Không mở lại được mục tiêu.",
  },

  taskPicker: {
    title: "Gắn công việc vào mục tiêu",
    description: "Chọn các công việc thuộc phạm vi của mục tiêu để tính tiến độ.",
    // S5-TASK-DEPTFILTER-1 — cấp phòng neo thẳng theo departmentId (không còn phải chọn dự án); ô tìm
    // theo tiêu đề để lọc thêm. Cấp công ty không có neo tự nhiên ⇒ bắt buộc nhập từ khoá mới liệt kê.
    searchLabel: "Tìm công việc",
    searchPlaceholder: "Nhập tiêu đề công việc…",
    enterSearchTerm: "Nhập từ khoá để tìm công việc.",
    noAnchor: "Không xác định được phạm vi công việc cho mục tiêu này.",
    tasksError: "Không tải được danh sách công việc.",
    empty: "Không còn công việc nào để gắn.",
    selectedCount: "Đã chọn {{count}} công việc",
    submit: "Gắn công việc",
    submitting: "Đang gắn…",
    error: "Không gắn được công việc vào mục tiêu.",
    warningsTitle: "Đã gắn xong, nhưng có cảnh báo:",
    close: "Đóng",
  },

  linkedTasksActions: {
    add: "Gắn thêm việc",
    unlink: "Tháo",
    unlinkError: "Không tháo được công việc khỏi mục tiêu.",
    lockedFinalized: "Mục tiêu đã chốt kỳ — không sửa được danh sách công việc.",
  },

  checkinActions: {
    open: "Check-in",
    finalize: "Chốt kỳ",
    reopen: "Mở lại",
  },

  pagination: {
    prev: "Trước",
    next: "Sau",
    page: "Trang {{page}}",
  },

  // ─── S5-GOAL-TPL-1 — Đợt D: danh mục việc mẫu (GOAL-SCREEN-006) + wizard phân rã (GOAL-SCREEN-004) ──

  /** Ưu tiên của việc mẫu — LOWERCASE (CHECK mig 0526), KHÁC nhãn ưu tiên của việc (TitleCase). */
  templatePriority: {
    urgent: "Rất gấp",
    high: "Cao",
    medium: "Trung bình",
    low: "Thấp",
    none: "Không đặt",
  },

  templates: {
    title: "Danh mục việc mẫu",
    description:
      "Bộ việc mẫu dùng để phân rã mục tiêu thành công việc. Danh mục của phòng chỉ phòng đó dùng; danh mục dùng chung áp cho toàn công ty.",
    create: "Thêm danh mục",
    sharedLabel: "Dùng chung toàn công ty",
    active: "Đang dùng",
    inactive: "Đã tắt",
    deleteConfirm: 'Xoá danh mục "{{name}}"? Việc mẫu bên trong cũng bị xoá theo.',
    deleteError: "Không xoá được danh mục việc mẫu.",
    columns: {
      name: "Tên danh mục",
      department: "Phòng ban",
      itemCount: "Số việc mẫu",
      status: "Trạng thái",
    },
    filters: {
      search: "Tìm kiếm",
      searchPlaceholder: "Tên danh mục…",
      department: "Phòng ban",
      allDepartments: "Tất cả phòng ban",
      status: "Trạng thái",
      allStatuses: "Tất cả trạng thái",
    },
    actions: {
      items: "Việc mẫu",
      edit: "Sửa danh mục",
      delete: "Xoá danh mục",
    },
    forbidden: {
      title: "Bạn không có quyền quản lý danh mục việc mẫu",
      description: "Cần quyền quản lý danh mục việc mẫu (manage:task-template). Liên hệ quản trị.",
    },
    error: {
      title: "Không tải được danh mục",
      description: "Đã có lỗi khi tải danh mục việc mẫu. Thử lại.",
    },
    empty: {
      title: "Chưa có danh mục việc mẫu",
      description: "Tạo danh mục đầu tiên để phân rã mục tiêu nhanh hơn.",
    },
    form: {
      createTitle: "Thêm danh mục việc mẫu",
      editTitle: "Sửa danh mục việc mẫu",
      description: "Việc mẫu bên trong quản lý ở hộp thoại riêng.",
      save: "Lưu",
      saving: "Đang lưu…",
      error: "Không lưu được danh mục việc mẫu.",
    },
    fields: {
      name: "Tên danh mục",
      namePlaceholder: "VD: Quy trình ra mắt sản phẩm",
      description: "Mô tả",
      department: "Phòng ban áp dụng",
      departmentShared: "Dùng chung toàn công ty (cần quyền cấp công ty)",
      isActive: "Đang dùng",
    },
    items: {
      title: 'Việc mẫu — "{{name}}"',
      description:
        "Mỗi dòng sẽ thành một công việc khi phân rã. Giờ ước lượng chỉ để lập kế hoạch (không ghi vào công việc).",
      empty: "Danh mục này chưa có việc mẫu nào.",
      loadError: "Không tải được danh sách việc mẫu.",
      error: "Không lưu được việc mẫu.",
      addTitle: "Thêm việc mẫu",
      editingTitle: "Sửa việc mẫu",
      add: "Thêm",
      saveEdit: "Lưu thay đổi",
      cancelEdit: "Huỷ sửa",
      edit: "Sửa việc mẫu",
      delete: "Xoá việc mẫu",
      close: "Đóng",
      titleLabel: "Tiêu đề việc mẫu",
      titlePlaceholder: "Tiêu đề việc mẫu",
      priorityLabel: "Ưu tiên mặc định",
      estimateLabel: "Giờ ước lượng",
      estimatePlaceholder: "Giờ ước lượng (tuỳ chọn)",
      checklistLabel: "Checklist",
      checklistPlaceholder: "Checklist, phân tách bằng dấu ; (VD: Wireframe; Review)",
      hours: "{{value}} giờ",
      checklistCount: "{{count}} mục checklist",
    },
  },

  decompose: {
    open: "Phân rã từ mẫu",
    title: "Phân rã mục tiêu thành công việc",
    description:
      "Chọn danh mục việc mẫu, xem trước và sửa danh sách, rồi áp dụng. Toàn bộ được tạo cùng lúc — lỗi giữa chừng thì không việc nào được tạo.",
    templateLabel: "Danh mục việc mẫu",
    templatePlaceholder: "Chọn danh mục…",
    templatesError: "Không tải được danh mục việc mẫu.",
    noTemplates: "Chưa có danh mục việc mẫu đang dùng. Tạo ở trang Danh mục việc mẫu.",
    itemCount: "{{count}} việc",
    previewLabel: "Xem trước công việc sẽ tạo",
    addRow: "Thêm việc",
    removeRow: "Xoá dòng này",
    detailError: "Không tải được việc mẫu của danh mục này.",
    emptyTemplate: "Danh mục này chưa có việc mẫu — thêm việc ở bên dưới hoặc chọn danh mục khác.",
    checklistPreview: "Checklist ({{count}}): {{items}}",
    employeeNote: "Mục tiêu cá nhân: mọi việc tạo ra đều giao cho chủ thể của mục tiêu.",
    departmentNote:
      "Mục tiêu cấp phòng: nên chọn người thực hiện cho từng việc — nếu phạm vi giao việc của bạn hẹp, để trống sẽ bị từ chối.",
    overLimit: "Tối đa {{max}} việc mỗi lần phân rã — bớt bớt hoặc chia thành nhiều lần.",
    submit: "Tạo {{count}} công việc",
    submitting: "Đang tạo…",
    error: "Không phân rã được mục tiêu.",
    fields: {
      title: "Tiêu đề việc {{index}}",
      titlePlaceholder: "Tiêu đề công việc",
      priority: "Ưu tiên",
      assignee: "Người thực hiện",
      assigneePlaceholder: "Chưa gán người",
      state: "Cột board",
      statePlaceholder: "Cột mặc định",
      dueAt: "Hạn hoàn thành",
    },
  },
} as const;

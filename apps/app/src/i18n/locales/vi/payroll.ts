/**
 * S13-PAYROLL-FE-1 — namespace "payroll" (PAY-SCREEN-001..006, SPEC-11 §9/§14).
 *
 * Quy ước (khuôn recruit.ts): khoá enum giữ ĐÚNG giá trị server (contracts payroll.ts —
 * payrollPeriodStatus/payslipDerivedStatus/bonusPenaltyStatus/bonusKind/payslipItemType) để tra thẳng
 * `t(`payroll:periodStatus.${x}`)` — KHÔNG slug-hoá.
 *
 * `errors.*` — 25 khoá `kind` PAYROLL (đo TỪ CODE BE theo BA hình dạng, xem docblock `payroll-errors.ts`)
 * + 2 khoá idempotency + `generic`. `states.*` dùng CHUNG cho mọi màn.
 *
 * ⚠️ Chữ trong `errors.*` phải nói ĐIỀU NGƯỜI DÙNG LÀM ĐƯỢC TIẾP, không dịch nguyên mã lỗi. Ví dụ
 * `fourEyes` không phải "vi phạm four-eyes" mà là "người gửi duyệt không tự duyệt được — cần người khác".
 */
export default {
  title: "Tiền lương",

  states: {
    loading: "Đang tải…",
    error: "Không tải được dữ liệu.",
    retry: "Tải lại",
  },

  // ── Enum trạng thái (SPEC-01 §17.15–17.17) ──────────────────────────────────────────────────────
  periodStatus: {
    Draft: "Nháp",
    CollectingData: "Đang gom dữ liệu",
    Calculated: "Đã tính",
    Reviewing: "Chờ duyệt",
    Approved: "Đã duyệt",
    Paid: "Đã phát hành",
    Locked: "Đã khoá",
  },
  payslipStatus: {
    Generated: "Đã sinh",
    Published: "Đã phát hành",
    Acknowledged: "Đã xác nhận",
    // `null` từ server = không nhánh nào khớp (fail-closed) — KHÔNG được hiện thành "Đã sinh".
    unknown: "Chưa xác định",
  },
  bonusStatus: {
    Pending: "Chờ duyệt",
    Approved: "Đã duyệt",
    Rejected: "Đã từ chối",
  },
  bonusKind: {
    bonus: "Thưởng",
    penalty: "Phạt",
  },
  payslipItemType: {
    earning: "Lương cơ bản",
    allowance: "Phụ cấp",
    bonus: "Thưởng",
    penalty: "Phạt",
    attendance: "Nghỉ không lương",
    deduction: "Khấu trừ khác",
    adjustment: "Điều chỉnh",
  },

  // ── Hành động cấp kỳ ────────────────────────────────────────────────────────────────────────────
  actions: {
    cancel: "Huỷ",
    back: "Quay lại",
    confirm: "Xác nhận",
    reasonLabel: "Lý do",
    reasonHint: "Bắt buộc — lý do được ghi vào nhật ký kiểm toán.",
    reopenWarning:
      "Mở lại đưa kỳ về «Đang gom dữ liệu» và xoá vết duyệt. Chỉ làm được khi kỳ CHƯA sinh phiếu lương.",
    period: {
      collect: "Gom dữ liệu",
      calculate: "Tính lương",
      submit: "Gửi duyệt",
      approve: "Duyệt",
      reject: "Từ chối",
      "generate-payslips": "Sinh phiếu lương",
      publish: "Phát hành",
      lock: "Khoá kỳ",
      reopen: "Mở lại",
    },
    done: {
      collect: "Đã gom dữ liệu công/phép.",
      calculate: "Đã tính xong {{count}} dòng lương.",
      submit: "Đã gửi duyệt.",
      approve: "Đã duyệt kỳ lương.",
      reject: "Đã từ chối — kỳ quay lại «Đã tính».",
      "generate-payslips": "Đã sinh {{count}} phiếu lương.",
      publish: "Đã phát hành phiếu lương cho nhân viên.",
      lock: "Đã khoá kỳ lương.",
      reopen: "Đã mở lại kỳ về «Đang gom dữ liệu».",
    },
  },

  // ── PAY-SCREEN-001 ──────────────────────────────────────────────────────────────────────────────
  periodList: {
    title: "Kỳ lương",
    description:
      "Danh sách kỳ lương theo tháng. Mở một kỳ để xem bảng lương và thực hiện quy trình.",
    create: "+ Kỳ lương",
    monthPlaceholder: "2026-09",
    filterMonth: "Lọc theo tháng",
    filterStatus: "Lọc theo trạng thái",
    filterAll: "Tất cả",
    clearFilters: "Xoá bộ lọc",
    linked: "Đã gắn",
    notLinked: "Chưa gắn",
    empty: "Chưa có kỳ lương nào.",
    emptyFiltered: "Không có kỳ lương khớp bộ lọc.",
    columns: {
      month: "Tháng",
      status: "Trạng thái",
      payDate: "Ngày trả",
      attendancePeriod: "Kỳ công",
      note: "Ghi chú",
    },
  },
  periodForm: {
    title: "Tạo kỳ lương",
    description: "Mỗi tháng chỉ có một kỳ lương.",
    monthLabel: "Tháng (YYYY-MM)",
    monthInvalid: "Tháng phải có dạng YYYY-MM, ví dụ 2026-09.",
    attendanceLabel: "Kỳ công",
    attendanceNone: "— Chưa gắn —",
    attendanceHint: "Chỉ liệt kê kỳ công ĐÃ khoá — kỳ chưa khoá thì không tính lương được.",
    attendanceEmpty: "Chưa có kỳ công nào đã khoá. Khoá kỳ công trước rồi quay lại.",
    noteLabel: "Ghi chú",
    submit: "Tạo kỳ",
  },

  // ── PAY-SCREEN-002 ──────────────────────────────────────────────────────────────────────────────
  periodDetail: {
    title: "Kỳ lương {{month}}",
    description: "Bảng lương theo nhân sự, quy trình duyệt và phát hành phiếu lương.",
    export: "Xuất Excel",
    payDate: "Ngày trả: {{date}}",
  },
  readiness: {
    loading: "Đang kiểm tra dữ liệu đầu vào…",
    error: "Không kiểm tra được dữ liệu đầu vào.",
    allReady: "{{count}} nhân sự đủ điều kiện tính lương.",
    noEligible: "Không có nhân sự nào đủ điều kiện tính lương — chưa tính được kỳ này.",
    title: "{{count}} nhân sự đủ điều kiện · {{warnings}} cảnh báo",
    softHint: "Cảnh báo không chặn việc tính lương — nhân sự thiếu dữ liệu sẽ không có dòng lương.",
    kind: {
      "missing-salary-profile": "chưa có hồ sơ lương hiệu lực",
      "missing-attendance": "chưa có bản ghi chấm công",
    },
  },
  lines: {
    noPermission: "Bạn không có quyền xem bảng lương của kỳ này.",
    empty: "Kỳ chưa có dòng lương nào — hãy gom dữ liệu rồi tính lương.",
    moneyMasked: "Bạn xem được bảng lương nhưng không xem được số tiền.",
    columns: {
      employee: "Nhân sự",
      days: "Công thực tế / công chuẩn",
      unpaidLeave: "Nghỉ không lương",
      lateMinutes: "Phút trễ",
      gross: "Tổng thu nhập",
      deduction: "Khấu trừ",
      adjustment: "Điều chỉnh",
      net: "Thực nhận",
    },
  },
  adjust: {
    title: "Điều chỉnh dòng lương",
    description: "Chỉ điều chỉnh được khi kỳ còn ở trạng thái «Đã tính».",
    amountLabel: "Số tiền điều chỉnh",
    amountHint: "Số dương = truy lĩnh (cộng thêm) · số âm = truy thu (trừ đi).",
    reasonLabel: "Lý do",
    reasonLabelRequired: "Lý do (bắt buộc)",
    reasonRequired: "Số tiền khác 0 thì phải ghi lý do.",
    submit: "Lưu điều chỉnh",
  },
  periodPayslips: {
    title: "Phiếu lương của kỳ ({{count}})",
    empty: "Kỳ chưa có phiếu lương nào.",
    truncated: "Đang hiện {{shown}} trong tổng {{total}} phiếu.",
  },

  // ── PAY-SCREEN-003 + 006 (dùng chung PayslipBreakdown) ──────────────────────────────────────────
  payslip: {
    title: "Phiếu lương — {{name}}",
    description: "Bản ghi phiếu lương không sửa được sau khi phát hành.",
    acknowledgedAt: "Đã xác nhận lúc {{at}}",
    moneyMasked: "Bạn không có quyền xem số tiền trên phiếu này.",
    inputsTitle: "Dữ liệu công/phép",
    workDays: "Công chuẩn",
    presentDays: "Công thực tế",
    paidLeaveDays: "Nghỉ có lương",
    unpaidLeaveDays: "Nghỉ không lương",
    lateMinutes: "Phút trễ",
    breakdownTitle: "Diễn giải",
    breakdownEmpty: "Phiếu không có dòng diễn giải nào.",
    itemType: "Khoản mục",
    itemLabel: "Nội dung",
    itemAmount: "Số tiền",
    totalsTitle: "Tổng hợp",
    gross: "Tổng thu nhập",
    deduction: "Khấu trừ",
    adjustment: "Điều chỉnh",
    net: "Thực nhận",
  },
  mePayslips: {
    title: "Phiếu lương của tôi",
    description: "Phiếu lương của các kỳ đã phát hành.",
    empty: "Bạn chưa có phiếu lương nào đã phát hành.",
    selectHint: "Chọn một phiếu lương để xem diễn giải.",
    acknowledge: "Xác nhận đã xem",
  },

  // ── PAY-SCREEN-004 ──────────────────────────────────────────────────────────────────────────────
  salaryProfiles: {
    title: "Hồ sơ lương",
    description:
      "Mỗi lần đổi lương là một phiên bản mới theo ngày hiệu lực — phiên bản cũ được giữ nguyên.",
    create: "+ Phiên bản lương",
    noPermission: "Bạn không có quyền xem hồ sơ lương.",
    allowanceCount: "{{count}} khoản",
    filterEmployee: "Lọc theo nhân sự",
    filterAll: "Tất cả nhân sự",
    clearFilters: "Xoá bộ lọc",
    empty: "Chưa có hồ sơ lương nào.",
    emptyFiltered: "Nhân sự này chưa có phiên bản hồ sơ lương nào.",
    columns: {
      employee: "Nhân sự",
      effectiveDate: "Hiệu lực từ",
      baseSalary: "Lương cơ bản",
      allowances: "Phụ cấp",
    },
  },
  salaryProfileForm: {
    title: "Thêm phiên bản hồ sơ lương",
    description: "Không sửa phiên bản cũ — tạo phiên bản mới hiệu lực từ ngày bạn chọn.",
    employeeLabel: "Nhân sự",
    employeePlaceholder: "— Chọn nhân sự —",
    pickerNoPermission: "Bạn không có quyền mở danh bạ nhân sự.",
    effectiveDateLabel: "Hiệu lực từ ngày",
    effectiveDateHint: "Mỗi nhân sự chỉ có một phiên bản cho một ngày hiệu lực.",
    baseSalaryLabel: "Lương cơ bản",
    baseSalaryInvalid: "Lương cơ bản phải lớn hơn 0.",
    allowanceLegend: "Phụ cấp (tuỳ chọn)",
    allowanceName: "Tên phụ cấp",
    allowanceAmount: "Số tiền",
    allowanceInvalid: "Điền cả tên và số tiền phụ cấp, hoặc để trống cả hai.",
    noteLabel: "Ghi chú",
    submit: "Tạo phiên bản",
  },

  // ── PAY-SCREEN-005 ──────────────────────────────────────────────────────────────────────────────
  bonus: {
    title: "Thưởng / phạt",
    description:
      "Khoản thưởng, phạt và khấu trừ theo tháng — được gộp vào kỳ lương khi tính lương.",
    create: "+ Khoản thưởng/phạt",
    noPermission: "Bạn không có quyền xem thưởng/phạt.",
    consumed: "đã vào kỳ lương",
    approve: "Duyệt",
    reject: "Từ chối",
    rejectTitle: "Từ chối khoản thưởng/phạt",
    filterMonth: "Lọc theo tháng",
    filterStatus: "Lọc theo trạng thái",
    filterKind: "Lọc theo loại",
    filterAll: "Tất cả",
    clearFilters: "Xoá bộ lọc",
    empty: "Chưa có khoản thưởng/phạt nào.",
    emptyFiltered: "Không có khoản nào khớp bộ lọc.",
    columns: {
      employee: "Nhân sự",
      kind: "Loại",
      amount: "Số tiền",
      month: "Tháng",
      reason: "Lý do",
      status: "Trạng thái",
    },
  },
  bonusForm: {
    title: "Thêm khoản thưởng/phạt",
    description: "Khoản được gộp vào kỳ lương của tháng tương ứng khi tính lương.",
    employeeLabel: "Nhân sự",
    employeePlaceholder: "— Chọn nhân sự —",
    pickerNoPermission: "Bạn không có quyền mở danh bạ nhân sự.",
    kindLabel: "Loại",
    amountLabel: "Số tiền",
    amountHint: "Luôn nhập số dương — loại «Phạt» đã mang dấu trừ.",
    amountInvalid: "Số tiền phải lớn hơn 0.",
    monthLabel: "Tháng (YYYY-MM)",
    reasonLabel: "Lý do",
    reasonRequired: "Lý do là bắt buộc.",
    submit: "Tạo khoản",
  },

  // ── Mã lỗi nghiệp vụ ────────────────────────────────────────────────────────────────────────────
  errors: {
    actionNotApplicable: "Hành động này không áp dụng cho trạng thái hiện tại của kỳ.",
    alreadyAcknowledged: "Bạn đã xác nhận phiếu lương này rồi.",
    alreadyConsumed: "Khoản này đã được gộp vào một kỳ lương — không sửa được nữa.",
    attendanceNotLocked:
      "Kỳ công của tháng này chưa được khoá — khoá kỳ công trước khi tính lương.",
    attendancePeriodMissing: "Kỳ lương chưa gắn kỳ công. Hãy gắn kỳ công rồi thử lại.",
    bonusFrozenRace: "Khoản vừa bị thay đổi ở nơi khác — tải lại rồi thử lại.",
    effectiveDateExists: "Nhân sự này đã có phiên bản hồ sơ lương cho ngày hiệu lực đó.",
    exportLimit: "Kỳ vượt quá 10.000 dòng — hãy lọc bớt trước khi xuất Excel.",
    fourEyes: "Người gửi duyệt không tự duyệt được — cần một người khác duyệt kỳ này.",
    invalidTransition: "Không chuyển được kỳ sang trạng thái đó.",
    noEligibleApprover:
      "Chưa có ai đủ quyền duyệt kỳ lương ngoài bạn — cấp quyền duyệt cho một người khác trước khi gửi.",
    noEligibleEmployee: "Không có nhân sự nào đủ điều kiện tính lương trong kỳ này.",
    noLineToGenerate: "Kỳ chưa có dòng lương nào để sinh phiếu.",
    noPayslip: "Kỳ chưa sinh phiếu lương — sinh phiếu trước khi phát hành.",
    noWorkDays: "Kỳ không có ngày công chuẩn nào — kiểm tra lịch làm việc và ngày lễ.",
    notFound: "Không tìm thấy dữ liệu.",
    notPending: "Chỉ sửa hoặc quyết định được khoản đang «Chờ duyệt».",
    notPublished: "Phiếu lương chưa được phát hành.",
    payslipAlreadyGenerated: "Kỳ đã sinh phiếu lương — không mở lại được nữa.",
    payslipDuplicate: "Phiếu lương của kỳ này đã được sinh rồi.",
    periodFrozen: "Kỳ đã duyệt — không tính lại hay điều chỉnh dòng được nữa.",
    periodMonthExists: "Tháng này đã có kỳ lương.",
    periodTerminal: "Kỳ đã phát hành hoặc đã khoá — không mở lại được.",
    selfApproval: "Không thể tự duyệt khoản do chính bạn tạo.",
    trailPairViolation: "Dữ liệu duyệt của kỳ không nhất quán — tải lại rồi thử lại.",
    idempotencyInProgress: "Yêu cầu đang được xử lý — vui lòng đợi.",
    idempotencyKeyReused: "Yêu cầu trước đã dùng khoá này cho nội dung khác — thử lại.",
    generic: "Có lỗi xảy ra, vui lòng thử lại.",
  },
};

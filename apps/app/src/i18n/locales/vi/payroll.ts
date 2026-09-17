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
import payrollCatalog from "./payroll-catalog";

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
    Published: "Đã phát hành",
    Paid: "Đã chi trả",
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
    close: "Đóng",
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
    // S15-PAYROLL-FE-2 (D13)
    templateLabel: "Mẫu bảng lương",
    templateNone: "— Chọn sau —",
    templateHint:
      "Chỉ liệt kê mẫu đang dùng, phạm vi toàn công ty. Kỳ chưa gắn mẫu thì chưa tính lương được — gắn sau ở chi tiết kỳ cũng được.",
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
    // S15-PAYROLL-FE-2 (D9 · D11)
    total: "Tổng",
    pageTotal: "Tổng trang này",
    templateDrift:
      "Mẫu bảng lương đã thay đổi sau lần tính gần nhất — tính lại để áp dụng cách tính mới.",
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
    // S15-PAYROLL-FE-2 (D12) — breakdown theo thành phần
    group: {
      income: "Thu nhập",
      deduction: "Khấu trừ",
      adjustment: "Điều chỉnh",
    },
    hiddenComponent: "(không hiện trên bảng lương)",
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
      salaryType: "Loại lương",
      allowances: "Phụ cấp",
    },
  },
  salaryProfileForm: {
    title: "Thêm phiên bản hồ sơ lương",
    description: "Không sửa phiên bản cũ — tạo phiên bản mới hiệu lực từ ngày bạn chọn.",
    employeeLabel: "Nhân sự",
    employeePlaceholder: "— Chọn nhân sự —",
    employeeRequired: "Chọn nhân sự trước.",
    pickerNoPermission: "Bạn không có quyền mở danh bạ nhân sự.",
    effectiveDateLabel: "Hiệu lực từ ngày",
    effectiveDateHint: "Mỗi nhân sự chỉ có một phiên bản cho một ngày hiệu lực.",
    effectiveDateInvalid: "Chọn ngày hiệu lực.",
    baseSalaryLabel: "Lương cơ bản",
    baseSalaryInvalid: "Lương cơ bản phải lớn hơn 0.",
    noteLabel: "Ghi chú",
    submit: "Tạo phiên bản",
    // ── S15-PAYROLL-FE-1 — form v2 (SPEC-11 §8.2 A · DB-13 §12.1) ──
    sectionBasic: "Mức lương",
    sectionStatutory: "Bảo hiểm · thuế",
    sectionItems: "Phụ cấp / khấu trừ có định mức",
    salaryTypeLabel: "Loại lương",
    salaryTypeHint: "NET: hệ thống gross-up để tính ngược lương GROSS và các khoản luật định.",
    pitPayerLabel: "Đối tượng chịu thuế TNCN",
    insuranceSalaryLabel: "Lương đóng bảo hiểm",
    insuranceSalaryHint: "Để trống = dùng lương cơ bản.",
    probationSalaryLabel: "Lương thử việc",
    probationSalaryHint: "Để trống nếu không áp dụng.",
    payRatioLabel: "Tỉ lệ hưởng (%)",
    payRatioHint: "Từ trên 0 đến 100. Mặc định 100.",
    payRatioInvalid: "Tỉ lệ hưởng phải lớn hơn 0 và không quá 100.",
    moneyInvalid: "Lương đóng bảo hiểm / lương thử việc phải là số không âm.",
    itemsCatalogNoPermission:
      "Bạn không có quyền mở danh mục thành phần lương — phiên bản này sẽ được tạo không kèm phụ cấp/khấu trừ.",
    itemsCatalogError: "Không tải được danh mục thành phần lương.",
    itemsCatalogEmpty: "Danh mục chưa có thành phần nào cấp theo hồ sơ lương.",
    itemsCatalogTruncated:
      "Danh mục lớn (trên 100 mã, tính mọi loại) — ô chọn có thể chưa đủ toàn bộ mã phụ cấp/khấu trừ.",
    itemsEmpty: "Chưa có khoản nào.",
    itemAdd: "+ Thêm khoản",
    itemComponent: "Thành phần",
    itemComponentPlaceholder: "— Chọn thành phần —",
    itemAmount: "Định mức",
    itemActive: "Áp dụng",
    itemNote: "Ghi chú",
    itemRemove: "Bỏ khoản",
    itemIncomplete: "Mỗi khoản cần chọn thành phần và định mức không âm.",
    itemDuplicate: "Mỗi thành phần chỉ khai một dòng.",
  },
  salaryType: {
    GROSS: "GROSS",
    NET: "NET",
  },
  pitPayer: {
    EMPLOYEE: "Nhân viên chịu",
    COMPANY: "Công ty chịu",
  },

  // ── S15-PAYROLL-FE-1 — PAY-SCREEN-007 ───────────────────────────────────────────────────────────
  employeeStatus: {
    active: "Đang làm việc",
    inactive: "Tạm nghỉ",
    resigned: "Đã nghỉ việc",
    terminated: "Chấm dứt HĐ",
  },
  relationship: {
    Child: "Con",
    Spouse: "Vợ/chồng",
    Parent: "Cha/mẹ",
    Other: "Khác",
  },
  unitSelector: {
    label: "Đơn vị",
    all: "Tất cả đơn vị",
  },
  employees: {
    title: "Nhân viên hưởng lương",
    description:
      "Hồ sơ nhân sự chiếu từ HR bó hẹp cho tiền lương — mã · họ tên · đơn vị · vị trí · trạng thái.",
    noPermission: "Bạn không có quyền xem nhân viên hưởng lương.",
    searchPlaceholder: "Tìm theo họ tên hoặc mã nhân viên",
    filterProfile: "Hồ sơ lương",
    filterProfileAll: "Tất cả",
    filterProfileHas: "Đã có hồ sơ lương",
    filterProfileMissing: "Chưa có hồ sơ lương",
    clearFilters: "Xoá bộ lọc",
    empty: "Chưa có nhân sự nào.",
    emptyFiltered: "Không có nhân sự nào khớp bộ lọc.",
    hasProfile: "Đã có",
    noProfile: "Chưa có",
    columns: {
      employee: "Nhân sự",
      orgUnit: "Đơn vị",
      position: "Vị trí",
      status: "Trạng thái",
      hasSalaryProfile: "Hồ sơ lương",
      taxCode: "Mã số thuế",
    },
  },
  employeeDetail: {
    noPermission: "Bạn không có quyền xem nhân viên hưởng lương.",
    tabs: {
      general: "Thông tin chung",
      salaryHistory: "Lịch sử lương",
      insurance: "Bảo hiểm – Công đoàn",
      tax: "Thuế TNCN",
      dependents: "Gia đình",
    },
    general: {
      employeeCode: "Mã nhân viên",
      fullName: "Họ tên",
      orgUnit: "Đơn vị",
      position: "Vị trí",
      status: "Trạng thái",
      startDate: "Ngày vào làm",
      hasSalaryProfile: "Hồ sơ lương",
      note: "Chiếu HR bó hẹp: không email, không số điện thoại, không lương (SPEC-11 §18).",
    },
  },
  salaryHistory: {
    empty: "Nhân sự chưa có phiên bản hồ sơ lương nào.",
    addVersion: "+ Phiên bản lương",
    truncated: "Chỉ hiển thị 100 phiên bản gần nhất.",
    effectiveFrom: "Hiệu lực từ {{date}}",
    current: "Hiện hành",
    expand: "Xem chi tiết",
    collapse: "Thu gọn",
    loadingDetail: "Đang tải chi tiết…",
    detailError: "Không tải được chi tiết phiên bản.",
    baseSalary: "Lương cơ bản",
    salaryType: "Loại lương",
    pitPayer: "Đối tượng TNCN",
    insuranceSalary: "Lương đóng BH",
    insuranceUseBase: "= lương cơ bản",
    probationSalary: "Lương thử việc",
    probationNone: "Không áp dụng",
    payRatio: "Tỉ lệ hưởng",
    note: "Ghi chú",
    items: "Phụ cấp / khấu trừ có định mức",
    itemsEmpty: "Không có khoản định mức nào.",
    legacyAllowances: "{{count}} khoản phụ cấp di sản (v1) chưa chuyển sang danh mục.",
    itemColumns: {
      component: "Thành phần",
      amount: "Định mức",
      source: "Nguồn",
      status: "Trạng thái",
    },
    itemSource: {
      catalog: "Danh mục",
      legacy: "Mã tạm (di sản)",
    },
    itemStatus: {
      active: "Đang áp dụng",
      inactive: "Tạm ngưng",
    },
  },
  insurance: {
    description:
      "Bảo hiểm xã hội · công đoàn · tài khoản nhận lương. Số tài khoản chỉ hiện 4 số cuối.",
    notSet: "Chưa thiết lập",
    yes: "Có",
    no: "Không",
    joinsSocialInsurance: "Tham gia BHXH",
    socialInsuranceNo: "Số sổ BHXH",
    joinsUnion: "Tham gia công đoàn",
    bankSection: "Tài khoản ngân hàng",
    bankAccount: "Số tài khoản",
    bankAccountMasked: "•••• {{last4}}",
    bankAccountNone: "Chưa khai số tài khoản",
    bankAccountNumberNew: "Số tài khoản mới",
    bankAccountNumberHint:
      "Để trống để giữ số hiện tại. Số đầy đủ chỉ xuất ra tệp UNC của đợt chi trả.",
    bankName: "Ngân hàng",
    bankBranch: "Chi nhánh",
    accountHolder: "Chủ tài khoản",
    clearBank: "Xoá tài khoản ngân hàng của nhân sự này",
    bankPairError: "Có số tài khoản thì phải nhập cả tên ngân hàng lẫn chủ tài khoản.",
    edit: "Sửa thiết lập",
    save: "Lưu thiết lập",
    saved: "Đã lưu thiết lập.",
  },
  tax: {
    taxCode: "Mã số thuế cá nhân",
    taxCodeHidden: "Bạn không có quyền xem mã số thuế.",
    taxCodeEmpty: "Chưa có mã số thuế.",
    dependentsEffective: "Người phụ thuộc đang giảm trừ",
    dependentsNone: "Không có người phụ thuộc nào đang giảm trừ.",
    dependentsHint: "Quản lý ở tab «Gia đình».",
  },
  dependents: {
    empty: "Chưa khai người phụ thuộc nào.",
    add: "+ Người phụ thuộc",
    ongoing: "đang hiệu lực",
    columns: {
      fullName: "Họ tên",
      relationship: "Quan hệ",
      taxCode: "MST NPT",
      dateOfBirth: "Ngày sinh",
      effectiveFrom: "Giảm trừ từ",
      effectiveTo: "Đến",
    },
  },
  dependentForm: {
    titleCreate: "Thêm người phụ thuộc",
    titleEdit: "Sửa người phụ thuộc",
    description: "Khoảng hiệu lực giảm trừ của cùng một người không được chồng nhau.",
    fullName: "Họ tên",
    relationship: "Quan hệ",
    taxCode: "Mã số thuế NPT",
    dateOfBirth: "Ngày sinh",
    effectiveFrom: "Giảm trừ từ ngày",
    effectiveTo: "Đến ngày",
    effectiveToHint: "Để trống nếu chưa có ngày kết thúc.",
    fullNameRequired: "Nhập họ tên người phụ thuộc.",
    effectiveFromInvalid: "Chọn ngày bắt đầu giảm trừ.",
    dateInvalid: "Ngày không hợp lệ.",
    dateOrder: "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.",
    submitCreate: "Thêm",
    submitEdit: "Lưu",
    delete: "Xoá người phụ thuộc",
    deleteConfirm: "Bấm lần nữa để xác nhận xoá",
  },

  // ── S15-PAYROLL-FE-1 — PAY-SCREEN-008 (tab của chi tiết kỳ) ─────────────────────────────────────
  periodTabs: {
    lines: "Bảng lương",
    timesheet: "Bảng công",
  },
  timesheet: {
    description:
      "Bảng công tổng hợp per nhân sự của kỳ — nguồn chấm công, chỉ đọc, không có số tiền.",
    noPermission: "Bạn không có quyền xem bảng công của kỳ.",
    empty: "Kỳ chưa có dữ liệu công nào.",
    attendanceLock: {
      locked: "Kỳ công đã khoá",
      open: "Kỳ công đang mở",
      unlinked: "Chưa gắn kỳ công",
      unknown: "Kỳ công: không rõ trạng thái",
    },
    columns: {
      employee: "Nhân sự",
      workDays: "Công chuẩn",
      presentDays: "Công thực tế",
      paidLeaveDays: "Phép có lương",
      unpaidLeaveDays: "Nghỉ không lương",
      lateMinutes: "Phút trễ",
    },
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

  // ── S15-PAYROLL-FE-3 — track C: tạm ứng · chi trả · ngân sách · import ──────────────────────────
  advanceStatus: {
    Pending: "Chờ duyệt",
    Approved: "Đã duyệt",
    Rejected: "Đã từ chối",
    Deducted: "Đã khấu trừ",
  },
  paymentBatchStatus: {
    Draft: "Nháp",
    Ready: "Sẵn sàng",
    Completed: "Đã hoàn tất",
  },
  paymentBatchMethod: {
    bank: "Chuyển khoản",
    cash: "Tiền mặt",
  },

  advances: {
    title: "Tạm ứng",
    description: "Khoản tạm ứng được khấu trừ vào kỳ lương của tháng đã chọn.",
    create: "Tạo tạm ứng",
    empty: "Chưa có khoản tạm ứng nào.",
    emptyFiltered: "Không có khoản tạm ứng nào khớp bộ lọc.",
    noPermission: "Bạn không có quyền xem danh sách tạm ứng.",
    filterMonth: "Lọc theo tháng khấu trừ",
    filterStatus: "Lọc theo trạng thái",
    filterAll: "Tất cả",
    clearFilters: "Xoá bộ lọc",
    approve: "Duyệt",
    reject: "Từ chối",
    rejectTitle: "Từ chối khoản tạm ứng",
    edit: "Sửa",
    consumed: "Đã khấu trừ vào kỳ {{month}}",
    recalculateRequired:
      "Kỳ lương đích đã tính xong — hãy tính lại kỳ để khoản tạm ứng này vào phiếu.",
    columns: {
      employee: "Nhân sự",
      amount: "Số tiền",
      month: "Tháng khấu trừ",
      reason: "Lý do",
      status: "Trạng thái",
      decision: "Quyết định",
    },
  },
  advanceForm: {
    title: "Tạo khoản tạm ứng",
    editTitle: "Sửa khoản tạm ứng",
    employeeLabel: "Nhân sự",
    employeePlaceholder: "— Chọn nhân sự —",
    pickerNoPermission: "Bạn không có quyền mở danh bạ nhân sự.",
    amountLabel: "Số tiền",
    amountInvalid: "Số tiền phải lớn hơn 0.",
    monthLabel: "Tháng khấu trừ (YYYY-MM)",
    monthInvalid: "Tháng phải theo dạng YYYY-MM.",
    reasonLabel: "Lý do",
    reasonRequired: "Lý do là bắt buộc.",
    submit: "Tạo khoản",
    save: "Lưu thay đổi",
  },

  paymentBatches: {
    title: "Chi trả",
    description: "Lập đợt chi trả từ kỳ lương đã phát hành, xuất tệp chuyển khoản rồi hoàn tất.",
    create: "Lập đợt chi trả",
    empty: "Chưa có đợt chi trả nào.",
    emptyFiltered: "Không có đợt chi trả nào khớp bộ lọc.",
    noPermission: "Bạn không có quyền xem danh sách đợt chi trả.",
    filterStatus: "Lọc theo trạng thái",
    filterMethod: "Lọc theo hình thức",
    filterAll: "Tất cả",
    clearFilters: "Xoá bộ lọc",
    open: "Mở đợt",
    columns: {
      code: "Mã đợt",
      period: "Kỳ lương",
      method: "Hình thức",
      status: "Trạng thái",
      lineCount: "Số dòng",
      paidLineCount: "Đã chi",
      totalNet: "Tổng thực nhận",
      payDate: "Ngày chi",
    },
  },
  paymentBatchForm: {
    title: "Lập đợt chi trả",
    periodLabel: "Kỳ lương",
    periodPlaceholder: "— Chọn kỳ đã phát hành —",
    periodHint: "Chỉ kỳ ở trạng thái «Đã phát hành» mới lập được đợt chi trả.",
    periodEmpty: "Không có kỳ lương nào đã phát hành.",
    methodLabel: "Hình thức chi trả",
    codeLabel: "Mã đợt (tuỳ chọn)",
    codeHint: "Để trống thì hệ thống tự sinh mã. Chỉ dùng chữ, số, gạch ngang, gạch dưới.",
    payDateLabel: "Ngày chi (tuỳ chọn)",
    noteLabel: "Ghi chú",
    submit: "Lập đợt",
    noBankAccount: "{{count}} nhân sự chưa khai tài khoản ngân hàng — đã bỏ qua.",
    zeroNet: "{{count}} phiếu có thực nhận bằng 0 — đã bỏ qua.",
    noEligiblePayees:
      "Không có phiếu lương nào đủ điều kiện — đợt được tạo rỗng và sẽ không hoàn tất được.",
  },
  paymentBatchDetail: {
    back: "Về danh sách đợt chi trả",
    export: "Xuất tệp chuyển khoản",
    exportNoPermission:
      "Xuất tệp chuyển khoản cần đủ ba quyền: quản lý đợt chi trả, xuất dữ liệu lương và xem phiếu lương.",
    complete: "Hoàn tất đợt",
    completeTitle: "Hoàn tất đợt chi trả",
    completeDescription:
      "Sau khi hoàn tất, đợt bị khoá vĩnh viễn và kỳ lương chuyển sang «Đã chi trả» nếu mọi phiếu đã được chi.",
    confirmAllPaid: "Xác nhận đã chi tất cả {{count}} dòng còn lại",
    completeSubmit: "Hoàn tất",
    cancel: "Huỷ",
    linesTitle: "Dòng chi trả",
    linesNoPermission: "Bạn không có quyền xem dòng chi trả của đợt này.",
    linesEmpty: "Đợt này chưa có dòng chi trả nào.",
    periodNowPaid: "Đã hoàn tất. Kỳ lương chuyển sang «Đã chi trả».",
    periodStillPublished:
      "Đã hoàn tất đợt này. Kỳ lương vẫn còn {{count}} phiếu chưa chi ở đợt khác.",
    columns: {
      employee: "Nhân sự",
      net: "Thực nhận",
      bankAccount: "Số tài khoản",
      bankName: "Ngân hàng",
      accountHolder: "Chủ tài khoản",
      paidAt: "Đã chi lúc",
    },
  },

  budgets: {
    title: "Ngân sách lương",
    description: "Ngân sách theo năm và đơn vị; cột thực hiện đọc từ phiếu lương đã phát hành.",
    create: "Thêm ngân sách",
    empty: "Chưa có ngân sách nào cho năm này.",
    noPermission: "Bạn không có quyền xem ngân sách lương.",
    yearLabel: "Năm tài chính",
    companyWide: "Toàn công ty",
    edit: "Sửa",
    columns: {
      unit: "Đơn vị",
      planned: "Kế hoạch",
      actual: "Thực hiện",
      variance: "Chênh lệch",
      note: "Ghi chú",
    },
  },
  budgetForm: {
    title: "Thêm ngân sách lương",
    editTitle: "Sửa ngân sách lương",
    yearLabel: "Năm tài chính",
    yearInvalid: "Năm phải trong khoảng 2000–2100.",
    unitLabel: "Đơn vị",
    unitAll: "Toàn công ty",
    unitHint: "Năm và đơn vị không đổi được sau khi tạo — muốn khác thì tạo hàng mới.",
    plannedLabel: "Ngân sách kế hoạch",
    plannedInvalid: "Ngân sách kế hoạch không được âm.",
    noteLabel: "Ghi chú",
    submit: "Thêm ngân sách",
    save: "Lưu thay đổi",
  },

  adjustmentImport: {
    title: "Nạp thu nhập/khấu trừ khác",
    description:
      "Tải tệp mẫu, điền theo đúng thứ tự cột rồi nạp. Hệ thống kiểm tra toàn tệp trước khi ghi.",
    downloadTemplate: "Tải tệp mẫu",
    chooseFile: "Chọn tệp",
    fileHint: "Tệp .xlsx, tối đa 5 MB và 5.000 dòng.",
    preview: "Kiểm tra tệp",
    apply: "Áp dụng",
    previewOk: "{{count}} dòng hợp lệ, sẵn sàng ghi.",
    duplicateWarning:
      "{{count}} dòng trùng với khoản đang chờ duyệt của cùng kỳ — kiểm tra lại trước khi áp dụng.",
    applied: "Đã ghi {{count}} dòng vào kỳ lương.",
    rowErrorsTitle: "Dòng lỗi",
    rowErrorsTruncated: "Tổng cộng {{count}} dòng lỗi (chỉ hiện 50 dòng đầu).",
    allOrNothing: "Toàn tệp hoặc không dòng nào — chưa dòng nào được ghi.",
    columns: {
      row: "Dòng",
      message: "Lỗi",
    },
    close: "Đóng",
  },

  meAdvances: {
    title: "Tạm ứng của tôi",
    description: "Các khoản tạm ứng của bạn và trạng thái duyệt.",
    empty: "Bạn chưa có khoản tạm ứng nào.",
    columns: {
      amount: "Số tiền",
      month: "Tháng khấu trừ",
      reason: "Lý do",
      status: "Trạng thái",
      decidedAt: "Quyết định lúc",
    },
  },

  // ── Mã lỗi nghiệp vụ ────────────────────────────────────────────────────────────────────────────
  // S15-PAYROLL-FE-2 — track B (009/010/011 + khối mẫu của chi tiết kỳ) tách file: `payroll-catalog.ts`.
  ...payrollCatalog,

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
    // ── S15-PAYROLL-BE-1 (track A) ──
    // Thông điệp phải nói PHẢI LÀM GÌ, không chỉ "sai" — đây là đường người dùng gặp nhiều nhất khi
    // chuyển hồ sơ lương v1 (mã `PC_nnn` do backfill) sang mã catalog thật.
    profileItemUnknownComponent:
      "Mã thành phần lương không có trong danh mục — chọn lại mã từ danh mục thành phần lương của công ty (hồ sơ cũ có thể mang mã tạm cần thay).",
    profileItemWrongType:
      "Thành phần lương này không thuộc loại cấp theo hồ sơ — chỉ thành phần có «giá trị theo hồ sơ lương» mới đặt được định mức.",
    profileItemDuplicate: "Mỗi thành phần lương chỉ được khai một dòng trong cùng phiên bản hồ sơ.",
    dependentOverlap:
      "Người phụ thuộc này đã có bản ghi trùng khoảng thời gian hiệu lực — chỉnh lại ngày bắt đầu/kết thúc để hai khoảng không chồng nhau.",
    bankPairIncomplete:
      "Có số tài khoản thì phải nhập cả tên ngân hàng lẫn tên chủ tài khoản — nếu muốn xoá tài khoản, xoá cả ba trường cùng lúc.",
    idempotencyInProgress: "Yêu cầu đang được xử lý — vui lòng đợi.",
    idempotencyKeyReused: "Yêu cầu trước đã dùng khoá này cho nội dung khác — thử lại.",
    componentCodeExists: "Mã thành phần lương này đã tồn tại — chọn mã khác.",
    componentCodeReserved:
      "Mã này thuộc không gian tên hệ thống (tiền tố SYS_/TL_/GT_, mã hệ thống, tên hàm) — chọn mã khác.",
    componentInUse:
      "Thành phần đang nằm trong mẫu bảng lương — gỡ khỏi các mẫu đó trước khi ngưng dùng hoặc xoá.",
    componentValuePair:
      "Kiểu giá trị không khớp dữ liệu: công thức cần chuỗi công thức, cố định cần số tiền, theo hồ sơ thì để trống cả hai.",
    formulaOverrideNotAllowed:
      "Không ghi đè công thức được cho thành phần tổng hợp hoặc thành phần lấy theo hồ sơ — bỏ phần ghi đè.",
    formulaTooLong:
      "Công thức dài quá 500 ký tự{{component}} — rút gọn hoặc tách thành thành phần trung gian.",
    rateEffectiveDateExists:
      "Đã có bản tỉ lệ luật định cùng ngày hiệu lực — sửa bản đó hoặc chọn ngày khác.",
    rateInUse:
      "Bản tỉ lệ đã được kỳ lương tính dùng — không sửa tại chỗ được; tạo bản mới với ngày hiệu lực mới.",
    systemComponentImmutable:
      "Thành phần hệ thống chỉ đổi được tên và thứ tự — muốn đổi công thức, ghi đè trong mẫu bảng lương.",
    templateCodeExists: "Mã mẫu bảng lương này đã tồn tại — chọn mã khác.",
    templateComponentDuplicate: "Một thành phần xuất hiện hai lần trong mẫu — bỏ dòng trùng.",
    templateComponentUnknown:
      "Mẫu chứa thành phần không còn trong danh mục (đã ngưng dùng hoặc xoá) — cập nhật lại danh sách thành phần của mẫu.",
    templateScopePair: "Phạm vi theo đơn vị cần chọn đơn vị; phạm vi toàn công ty thì bỏ đơn vị.",
    templateTooManyComponents: "Mẫu vượt quá 120 thành phần — bớt thành phần.",
    // S15-PAYROLL-BE-3 — máy tính lương v2
    templateMissing:
      "Kỳ lương chưa gắn mẫu bảng lương (hoặc mẫu đã bị xoá) — chọn mẫu cho kỳ trước khi tính.",
    templateInactive: "Mẫu bảng lương của kỳ đang ngưng dùng — bật lại mẫu hoặc chọn mẫu khác.",
    templateLocked: "Kỳ lương đã tính — chỉ đổi được mẫu khi kỳ còn ở Nháp hoặc Thu thập dữ liệu.",
    templateScopeUnsupported: "Mẫu theo đơn vị chưa gắn được vào kỳ lương — chọn mẫu toàn công ty.",
    templateInputMissing:
      "Mẫu thiếu thành phần hệ thống bắt buộc (thưởng, phạt, tạm ứng, nghỉ không lương) hoặc đang ghi đè công thức của chúng.",
    systemComponentDrift:
      "Thành phần lương hệ thống bị sửa lệch cách tính chuẩn — liên hệ quản trị hệ thống trước khi tính lương.",
    statutoryRateMissing:
      "Chưa có bản tỉ lệ luật định hiệu lực tại ngày cuối kỳ — tạo bản tỉ lệ ở Thiết lập lương trước.",
    // S15-PAYROLL-BE-4 — track C: tạm ứng · đợt chi trả · ngân sách · import
    advanceNotPending: "Chỉ sửa hoặc quyết định được tạm ứng đang «Chờ duyệt».",
    advanceAlreadyDeducted:
      "Tạm ứng này đã được khấu trừ vào một kỳ lương — không sửa/xoá được; tạo đề nghị mới nếu cần.",
    advancePeriodFrozen:
      "Kỳ lương chỉ định đã tính hoặc đã duyệt — chọn kỳ khấu trừ khác hoặc mở lại kỳ trước khi thêm tạm ứng.",
    periodNotPublished: "Chỉ lập đợt chi trả từ kỳ lương đã phát hành phiếu.",
    batchIncomplete:
      "Đợt còn dòng chưa đánh dấu đã chi — đánh dấu từng dòng hoặc chọn «Xác nhận đã chi tất cả» khi hoàn tất.",
    batchAlreadyCompleted: "Đợt chi trả đã hoàn tất — không sửa hay hoàn tất lại được.",
    payeeAlreadyInBatch:
      "Phiếu lương của nhân sự này đã nằm ở một đợt chi trả khác — gỡ khỏi đợt đó trước.",
    batchCodeExists: "Mã đợt chi trả đã tồn tại — chọn mã khác hoặc để trống để hệ thống tự sinh.",
    batchFourEyes:
      "Người hoàn tất đợt phải khác người lập đợt — cần một người khác có quyền quản lý đợt chi trả xác nhận.",
    payeeNoBankAccount:
      "Có nhân sự chưa khai số tài khoản ngân hàng — khai ở Nhân sự hưởng lương hoặc lập đợt tiền mặt cho họ.",
    lineAlreadyPaid:
      "Dòng đã đánh dấu đã chi thì không gỡ khỏi đợt được — phiên bản này không có đường bỏ đánh dấu.",
    batchEmpty: "Đợt chi trả không còn dòng nào — thêm dòng trước khi hoàn tất.",
    budgetExists: "Đã có ngân sách cho năm và đơn vị này — sửa hàng đó thay vì tạo mới.",
    importInvalid:
      "Tệp import không đúng khuôn — tải tệp mẫu, giữ đúng thứ tự cột rồi nạp lại. Không dòng nào được ghi.",
    importTooLarge: "Tệp vượt trần 5.000 dòng — tách tệp rồi nạp từng phần.",
    importUnknownUser:
      "Có dòng mang mã nhân viên không có trong công ty — sửa mã hoặc bỏ dòng. Không dòng nào được ghi.",
    templateInUse:
      "Mẫu bảng lương đang được kỳ lương sử dụng — đổi mẫu cho các kỳ đó trước khi ngưng dùng hoặc xoá.",
    noEligibleCompleter:
      "Chưa có ai khác bạn giữ quyền quản lý đợt chi trả — đợt lập ra sẽ không hoàn tất được (bốn mắt). Cấp quyền cho người thứ hai trước.",
    // S15-PAYROLL-FE-2 — kind của MÁY CÔNG THỨC (`formula.errors.ts`). Nội suy qua `formulaErrorParams`:
    // `at` = « (ký tự thứ N)» hoặc rỗng · `ref`/`func` = token gây lỗi · `cycle` = «A → B → A» ·
    // `missing` = mã còn thiếu · `component` = « (thành phần X)» hoặc rỗng.
    formulaSyntax:
      "Công thức sai cú pháp{{at}}{{component}} — kiểm tra dấu ngoặc, toán tử và mã viết HOA không dấu.",
    formulaUnknownRef:
      "Không có thành phần hay biến hệ thống tên «{{ref}}»{{at}}{{component}} — chọn mã từ gợi ý.",
    formulaUnknownFunction:
      "Hàm «{{func}}» không được hỗ trợ{{at}} — chỉ dùng IF, MIN, MAX, ROUND, ABS, CEIL, FLOOR, TNCN_LUY_TIEN, BH_TRAN_BHXH/BHYT/BHTN.",
    formulaArity:
      "Hàm «{{func}}» nhận sai số tham số{{at}} (ROUND chỉ nhận chữ số làm tròn là số nguyên từ −6 đến 6).",
    formulaTooDeep: "Công thức lồng quá sâu{{component}} — tách bớt thành thành phần trung gian.",
    formulaTooManyNodes:
      "Công thức quá dài (quá nhiều phép tính){{component}} — tách thành thành phần trung gian.",
    templateMissingEngineNodes:
      "Mẫu thiếu thành phần tổng hợp bắt buộc ({{missing}}) — thêm lại các thành phần tổng hợp của hệ thống.",
    formulaCycle:
      "Công thức tạo vòng tham chiếu: {{cycle}} — một thành phần không được tự phụ thuộc vào chính nó.",
    formulaBudgetExceeded:
      "Công thức tính quá nặng trên dữ liệu thật{{component}} — đơn giản hoá công thức rồi tính lại.",
    divisionByZero:
      "Công thức chia cho 0{{component}} — thường do ngày công chuẩn bằng 0; dùng IF để chặn mẫu số bằng 0.",
    numericOverflow:
      "Kết quả công thức vượt giới hạn số tiền{{component}} — kiểm tra lại công thức.",
    negativeTotal:
      "Tổng thu nhập hoặc tổng khấu trừ ra số âm{{component}} — kiểm tra dấu của các thành phần.",
    statutoryRateIncomplete:
      "Bảng tỉ lệ luật định chưa đủ: cần đúng 7 bậc thuế, ngưỡng tăng dần, chỉ bậc cuối để trống, thuế suất 0–100% ({{reason}}).",
    grossupNotConverged:
      "Không quy đổi được lương NET sang GROSS cho một nhân sự — kiểm tra lương thoả thuận và các khoản khấu trừ.",
    generic: "Có lỗi xảy ra, vui lòng thử lại.",
  },
};

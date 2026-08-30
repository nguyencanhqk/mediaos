/**
 * S11-ASSET-FE-1 — namespace "assets" (vi). Đăng ký trong apps/app/src/i18n/index.ts.
 *
 * Nhãn enum (trạng thái tài sản/lượt/bảo trì/kiểm kê) + chrome màn ASSET-SCREEN-001..007. Text
 * người-đọc TÁCH khỏi code. Khoá enum giữ ĐÚNG giá trị server (`"In Stock"`, `"Not Checked"`…) để tra
 * thẳng `t(\`assets:status.${asset.status}\`)` — KHÔNG slug hoá, tránh một bảng ánh xạ thứ hai trôi khỏi
 * contracts (assetLifecycleStatusSchema).
 */
export default {
  title: "Tài sản",
  description: "Danh mục tài sản, cấp phát, thu hồi, bảo trì và kiểm kê theo đợt.",

  // Trạng thái vòng đời (SPEC-13 §13.1 FSM · contracts assetLifecycleStatusSchema)
  status: {
    "In Stock": "Trong kho",
    Assigned: "Đang cấp phát",
    "Under Maintenance": "Đang bảo trì",
    Disposed: "Đã thanh lý",
    Lost: "Mất",
  },
  assignmentStatus: {
    Active: "Đang giữ",
    Returned: "Đã trả",
  },
  issueCondition: {
    Good: "Tốt",
    Damaged: "Hỏng hóc",
  },
  returnCondition: {
    Good: "Tốt",
    Damaged: "Hỏng hóc",
    Lost: "Mất",
  },
  maintenanceStatus: {
    Open: "Đang mở",
    Closed: "Đã đóng",
  },
  inventoryStatus: {
    Open: "Đang mở",
    Closed: "Đã đóng",
  },
  inventoryResult: {
    Found: "Đã thấy",
    Missing: "Không thấy",
    "Not Checked": "Chưa kiểm",
  },
  disposeKind: {
    Disposed: "Thanh lý",
    Lost: "Ghi nhận mất",
  },

  // ASSET-SCREEN-001 — danh sách
  list: {
    title: "Danh sách tài sản",
    create: "Thêm tài sản",
    manageCategories: "Quản trị loại",
    searchPlaceholder: "Tìm theo mã, tên hoặc số serial…",
    filterCategory: "Loại tài sản",
    filterStatus: "Trạng thái",
    filterHolder: "Người giữ",
    filterAll: "Tất cả",
    clearFilters: "Xoá bộ lọc",
    empty: "Chưa có tài sản nào.",
    emptyFiltered: "Không có tài sản nào khớp bộ lọc.",
    maintenanceDueSoon_one: "{{count}} tài sản sắp đến hạn bảo trì",
    maintenanceDueSoon_other: "{{count}} tài sản sắp đến hạn bảo trì",
    columns: {
      assetCode: "Mã tài sản",
      name: "Tên tài sản",
      category: "Loại",
      status: "Trạng thái",
      serialNumber: "Số serial",
      holder: "Người giữ",
      location: "Vị trí",
      nextMaintenanceDue: "Hạn bảo trì",
    },
  },

  // ASSET-SCREEN-002 — chi tiết
  detail: {
    back: "Danh sách tài sản",
    tabInfo: "Thông tin",
    tabAssignments: "Lịch sử cấp phát",
    tabMaintenances: "Bảo trì",
    qrHint: "Quét mã để tra cứu nhanh tài sản này.",
    notFound: "Không tìm thấy tài sản.",
    fields: {
      assetCode: "Mã tài sản",
      name: "Tên tài sản",
      category: "Loại tài sản",
      status: "Trạng thái",
      serialNumber: "Số serial",
      brand: "Thương hiệu",
      model: "Model",
      location: "Vị trí",
      purchaseDate: "Ngày mua",
      purchasePrice: "Giá mua",
      supplier: "Nhà cung cấp",
      warrantyEndDate: "Hết bảo hành",
      nextMaintenanceDue: "Hạn bảo trì kế tiếp",
      conditionNote: "Ghi chú tình trạng",
      statusReason: "Lý do đổi trạng thái",
      statusChangedAt: "Đổi trạng thái lúc",
      description: "Mô tả",
      currentHolder: "Người đang giữ",
      assignedAt: "Cấp phát từ",
    },
    emptyAssignments: "Chưa có lượt cấp phát nào.",
    emptyMaintenances: "Chưa có lượt bảo trì nào.",
  },

  // Hành động (ẩn theo FSM ∩ quyền — SPEC-13 §14)
  actions: {
    assign: "Cấp phát",
    revoke: "Thu hồi",
    openMaintenance: "Mở bảo trì",
    closeMaintenance: "Đóng bảo trì",
    dispose: "Thanh lý",
    markLost: "Ghi nhận mất",
    recover: "Tìm thấy lại",
    edit: "Sửa",
    delete: "Xoá hồ sơ",
    printHandover: "In biên bản",
  },

  // ASSET-SCREEN-003 — form tạo/sửa
  form: {
    createTitle: "Thêm tài sản",
    editTitle: "Sửa tài sản",
    assetCodeHint: "Mã tài sản do hệ thống sinh sau khi tạo.",
    submitCreate: "Tạo tài sản",
    submitEdit: "Lưu thay đổi",
    cancel: "Huỷ",
  },

  // ASSET-SCREEN-004 — cấp phát / thu hồi
  assign: {
    title: "Cấp phát tài sản",
    employee: "Nhân viên nhận",
    employeePlaceholder: "Chọn nhân viên…",
    issueCondition: "Tình trạng lúc giao",
    issueNote: "Ghi chú lúc giao",
    expectedReturnDate: "Ngày dự kiến trả",
    submit: "Cấp phát",
  },
  revoke: {
    title: "Thu hồi tài sản",
    returnCondition: "Tình trạng lúc thu",
    returnNote: "Ghi chú lúc thu",
    lostWarning: "Chọn «Mất» sẽ chuyển tài sản sang trạng thái Mất thay vì về kho.",
    submit: "Thu hồi",
  },

  // Bảo trì
  maintenance: {
    openTitle: "Mở lượt bảo trì",
    closeTitle: "Đóng lượt bảo trì",
    reason: "Lý do bảo trì",
    vendor: "Đơn vị bảo trì",
    resultNote: "Kết quả",
    cost: "Chi phí",
    nextDueDate: "Hạn bảo trì kế tiếp",
    openedAt: "Mở lúc",
    closedAt: "Đóng lúc",
    submitOpen: "Mở lượt",
    submitClose: "Đóng lượt",
  },

  // Thanh lý / mất / tìm thấy lại
  dispose: {
    disposeTitle: "Thanh lý tài sản",
    lostTitle: "Ghi nhận mất tài sản",
    recoverTitle: "Tìm thấy lại tài sản",
    reason: "Lý do",
    reasonHint: "Tối thiểu 3 ký tự.",
    submit: "Xác nhận",
  },

  // ASSET-SCREEN-005 — kiểm kê
  inventory: {
    listTitle: "Kiểm kê tài sản",
    open: "Mở đợt kiểm kê",
    name: "Tên đợt",
    scope: "Phạm vi",
    scopeAll: "Toàn bộ tài sản",
    scopeCategory: "Theo loại tài sản",
    note: "Ghi chú",
    emptyList: "Chưa có đợt kiểm kê nào.",
    emptyItems: "Đợt này chưa có dòng nào.",
    detailTitle: "Chi tiết đợt kiểm kê",
    markFound: "Đánh dấu Đã thấy",
    markMissing: "Đánh dấu Không thấy",
    bulkMark: "Đánh dấu {{count}} dòng đã chọn",
    close: "Đóng đợt",
    closeConfirm: "Đóng đợt kiểm kê? Dòng chưa đánh dấu sẽ giữ trạng thái «Chưa kiểm».",
    missingHint: "Dòng «Không thấy» — mở chi tiết tài sản để ghi nhận mất nếu cần.",
    summary: {
      total: "Tổng dòng",
      found: "Đã thấy",
      missing: "Không thấy",
      notChecked: "Chưa kiểm",
    },
    columns: {
      assetCode: "Mã tài sản",
      name: "Tên tài sản",
      expectedStatus: "Trạng thái lúc chụp",
      result: "Kết quả",
      note: "Ghi chú",
      checkedAt: "Kiểm lúc",
    },
  },

  // ASSET-SCREEN-006 — tài sản của tôi
  me: {
    title: "Tài sản của tôi",
    holding: "Đang giữ",
    returned: "Đã trả",
    showReturned: "Hiện cả tài sản đã trả",
    empty: "Bạn chưa được cấp tài sản nào.",
    emptyReturned: "Bạn chưa trả tài sản nào.",
  },

  // ASSET-SCREEN-007 — quản trị loại
  category: {
    title: "Quản trị loại tài sản",
    create: "Thêm loại",
    code: "Mã loại",
    name: "Tên loại",
    codePrefix: "Tiền tố mã",
    codePrefixHint: "2–6 ký tự A–Z hoặc 0–9. Khoá lại sau khi loại đã sinh mã tài sản đầu tiên.",
    codePrefixLocked: "Loại đã sinh mã tài sản — không đổi được tiền tố.",
    maintenanceIntervalDays: "Chu kỳ bảo trì (ngày)",
    isActive: "Đang dùng",
    showDeleted: "Hiện loại đã xoá",
    restore: "Khôi phục",
    deletedAt: "Đã xoá lúc",
    empty: "Chưa có loại tài sản nào.",
    deleteConfirm: "Xoá loại này? Chỉ xoá được khi không còn tài sản đang dùng.",
    prefixTakenByDeleted:
      "Tiền tố «{{prefix}}» đang thuộc một loại ĐÃ XOÁ. Khôi phục loại đó thay vì tạo mới.",
  },

  // Trạng thái UI bắt buộc (SPEC-13 §14)
  states: {
    loading: "Đang tải…",
    error: "Không tải được dữ liệu tài sản.",
    retry: "Thử lại",
    saving: "Đang lưu…",
    conflictReloaded: "Dữ liệu vừa đổi ở nơi khác — đã tải lại. Vui lòng kiểm tra rồi thử lại.",
  },

  // Mã lỗi nghiệp vụ — 19 `kind` ĐO TỪ CODE BE THẬT (không chép bảng SPEC-13 §12: bảng đó liệt kê 3 kind
  // không bao giờ được phát ra). Xem ghi chú đầu asset-errors.ts.
  errors: {
    // Vòng đời / FSM
    stale: "Tài sản đang ở trạng thái «{{from}}» — không {{action}} được.",
    // ASSET-ERR-001 mang details `from`/`to`/`action` (rule "asset-fsm"), KHÔNG có `kind` — nội suy được.
    fsm: "Tài sản đang ở trạng thái «{{from}}» — không {{action}} được.",
    notInStock: "Chỉ xoá được hồ sơ đang ở trong kho (hiện tại: {{status}}).",
    hasHistory: "Hồ sơ đã có lịch sử cấp phát hoặc bảo trì — dùng «Thanh lý» thay vì xoá.",
    deleteBlocked: "Hồ sơ đã có lịch sử — dùng «Thanh lý» thay vì xoá.",
    // Cấp phát / thu hồi
    employeeInactive: "Nhân viên này không còn hoạt động ({{status}}) — không cấp phát được.",
    expectedReturnBeforeIssue: "Ngày dự kiến trả không được trước ngày cấp phát.",
    activeAssignment: "Còn người đang giữ tài sản — phải thu hồi trước.",
    activeAssignmentExists: "Tài sản đã có một lượt cấp phát đang hiệu lực.",
    noActiveAssignment: "Tài sản không có lượt cấp phát đang hiệu lực.",
    disposeHasActiveAssignment: "Còn người đang giữ tài sản — phải thu hồi trước khi thanh lý.",
    returnConditionRequired: "Phải chọn tình trạng lúc thu hồi.",
    // Bảo trì
    maintenanceAlreadyOpen: "Tài sản đã có một lượt bảo trì đang mở.",
    alreadyClosed: "Lượt/đợt này đã đóng.",
    nextDueNotAfterClose: "Hạn bảo trì kế tiếp phải sau ngày đóng lượt.",
    // Kiểm kê
    inventoryAlreadyOpen: "Công ty đã có một đợt kiểm kê đang mở.",
    inventoryClosed: "Đợt kiểm kê đã đóng.",
    snapshotDuplicate: "Ảnh chụp đợt kiểm kê bị trùng dòng — liên hệ quản trị hệ thống.",
    // Loại tài sản
    codeTaken: "Mã loại này đã được dùng.",
    prefixTaken: "Tiền tố này đã được dùng.",
    prefixLocked: "Loại đã sinh mã tài sản — không đổi được tiền tố.",
    hasAssets: "Loại này còn {{count}} tài sản — không xoá/vô hiệu được.",
    categoryInactive: "Loại tài sản này đang bị vô hiệu — chọn loại khác.",
    // Hồ sơ / ngày tháng
    serialTaken: "Số serial này đã tồn tại trong công ty.",
    purchaseInFuture: "Ngày mua không được ở tương lai.",
    warrantyBeforePurchase: "Ngày hết bảo hành không được trước ngày mua.",
    dateInvalid: "Ngày không hợp lệ.",
    reasonRequired: "Lý do phải có tối thiểu 3 ký tự.",
    readonlyField: "Không sửa được mã tài sản hoặc trạng thái qua form này.",
    // Sentinel / hạ tầng
    notFound: "Không tìm thấy tài sản.",
    counterMissing: "Loại tài sản này chưa có bộ đếm mã — liên hệ quản trị hệ thống.",
    idempotencyInProgress: "Yêu cầu trước đang xử lý — vui lòng đợi rồi thử lại.",
    idempotencyKeyReused: "Khoá gửi lại đã dùng cho nội dung khác — đã làm mới, vui lòng gửi lại.",
    generic: "Thao tác không thành công.",
  },
};

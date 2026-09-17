/**
 * S15-PAYROLL-FE-3 — phần namespace "payroll" của track C (PAY-SCREEN-012 «Tạm ứng» · 013 «Chi trả» · 014
 * «Ngân sách lương» · dialog import thu nhập/khấu trừ · 017 «Tạm ứng của tôi»). Tách khỏi `payroll.ts`
 * (S15-PAYROLL-DEBT-1 — file đã vượt 800 dòng) và SPREAD vào đó như `payroll-catalog.ts` — khoá vẫn ở GỐC
 * namespace (`t("advances.title")`), không thêm tiền tố.
 *
 * Khoá enum giữ ĐÚNG giá trị server (`advanceStatus.*` · `paymentBatchStatus.*` · `paymentBatchMethod.*` —
 * contracts `payroll-disbursement.ts`).
 */
export default {
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
    delete: "Xoá ngân sách",
    deleteConfirm: "Bấm lần nữa để xác nhận xoá",
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
};

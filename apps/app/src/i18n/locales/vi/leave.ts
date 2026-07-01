/**
 * Namespace "leave" (vi) — màn hình nghỉ phép (S3-FE-LEAVE-1).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("leave.*").
 */
export default {
  pageTitle: "Nghỉ phép",

  // ── Trạng thái đơn nghỉ ────────────────────────────────────────────────────
  status: {
    Draft: "Nháp",
    Pending: "Chờ duyệt",
    Approved: "Đã duyệt",
    Rejected: "Từ chối",
    Cancelled: "Đã hủy",
    Revoked: "Đã thu hồi",
  },

  // ── Loại thời lượng nghỉ ──────────────────────────────────────────────────
  durationType: {
    FullDay: "Cả ngày",
    HalfDay: "Nửa ngày",
    Hourly: "Theo giờ",
    MultipleDays: "Nhiều ngày",
  },

  // ── Buổi trong ngày ────────────────────────────────────────────────────────
  halfDaySession: {
    Morning: "Buổi sáng",
    Afternoon: "Buổi chiều",
  },

  // ── Tổng quan nghỉ phép (LEAVE-SCREEN-001) ────────────────────────────────
  overview: {
    title: "Tổng quan nghỉ phép",
    description: "Tình trạng ngày phép và đơn nghỉ của tôi",
    createRequest: "Tạo đơn nghỉ",
    viewAllRequests: "Xem tất cả đơn",
    currentYear: "Năm {{year}}",
    balance: {
      title: "Số dư phép",
      remaining: "Còn lại",
      used: "Đã dùng",
      reserved: "Chờ duyệt",
      opening: "Được cấp",
      adjusted: "Điều chỉnh",
      unit: {
        Day: "ngày",
        Hour: "giờ",
      },
    },
    warning: {
      lowBalance: "Số ngày phép còn lại thấp (còn {{days}} ngày)",
      pendingRequest: "Có {{count}} đơn đang chờ duyệt",
    },
    empty: {
      title: "Chưa có số dư phép",
      description: "HR chưa khởi tạo số ngày phép cho bạn. Vui lòng liên hệ phòng nhân sự.",
    },
    error: {
      title: "Không thể tải dữ liệu",
      description: "Có lỗi khi tải tổng quan nghỉ phép. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem thông tin nghỉ phép.",
    },
  },

  // ── Danh sách đơn nghỉ của tôi (LEAVE-SCREEN-003) ────────────────────────
  myRequests: {
    title: "Đơn nghỉ của tôi",
    description: "Toàn bộ đơn nghỉ phép tôi đã tạo",
    newRequest: "Tạo đơn mới",
    columns: {
      leaveType: "Loại nghỉ",
      period: "Thời gian",
      days: "Số ngày",
      status: "Trạng thái",
      submittedAt: "Ngày gửi",
      actions: "Hành động",
    },
    filters: {
      search: "Tìm theo lý do…",
      allStatuses: "Tất cả trạng thái",
      allTypes: "Tất cả loại",
      fromDate: "Từ ngày",
      toDate: "Đến ngày",
    },
    actions: {
      view: "Xem chi tiết",
      cancel: "Hủy đơn",
    },
    empty: {
      title: "Chưa có đơn nghỉ",
      description: "Bạn chưa tạo đơn nghỉ nào. Bấm 'Tạo đơn mới' để bắt đầu.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách đơn nghỉ. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem đơn nghỉ.",
    },
  },

  // ── Form tạo đơn nghỉ (LEAVE-SCREEN-002) ─────────────────────────────────
  form: {
    titleCreate: "Tạo đơn nghỉ phép",
    titleEdit: "Chỉnh sửa đơn nghỉ",
    descriptionCreate: "Điền thông tin để tạo đơn nghỉ phép",
    descriptionEdit: "Chỉnh sửa đơn nghỉ đang ở trạng thái nháp",
    sections: {
      basic: "Thông tin nghỉ",
      timing: "Thời gian nghỉ",
      detail: "Chi tiết bổ sung",
    },
    fields: {
      leaveType: "Loại nghỉ",
      leaveTypePlaceholder: "Chọn loại nghỉ…",
      durationType: "Hình thức nghỉ",
      startDate: "Ngày bắt đầu",
      endDate: "Ngày kết thúc",
      halfDaySession: "Buổi nghỉ",
      startTime: "Giờ bắt đầu",
      endTime: "Giờ kết thúc",
      reason: "Lý do nghỉ",
      reasonPlaceholder: "Nhập lý do nghỉ…",
      handoverNote: "Ghi chú bàn giao",
      handoverNotePlaceholder: "Mô tả công việc đã bàn giao…",
      contactDuringLeave: "Liên hệ khi nghỉ",
      contactPlaceholder: "Số điện thoại / email liên hệ khi cần…",
    },
    validation: {
      leaveTypeRequired: "Vui lòng chọn loại nghỉ",
      durationTypeRequired: "Vui lòng chọn hình thức nghỉ",
      startDateRequired: "Vui lòng chọn ngày bắt đầu",
      endDateRequired: "Vui lòng chọn ngày kết thúc",
      endDateBeforeStart: "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu",
      crossYear: "Đơn nghỉ không được vắt qua 2 năm (tách thành 2 đơn)",
      halfDayOneDay: "Nghỉ nửa ngày chỉ áp dụng cho đúng 1 ngày",
      halfDaySessionRequired: "Vui lòng chọn buổi (Sáng/Chiều)",
      hourlyOneDay: "Nghỉ theo giờ chỉ áp dụng cho đúng 1 ngày",
      startTimeRequired: "Vui lòng nhập giờ bắt đầu",
      endTimeRequired: "Vui lòng nhập giờ kết thúc",
      endTimeBeforeStart: "Giờ kết thúc phải sau giờ bắt đầu",
      reasonRequired: "Loại nghỉ này yêu cầu nhập lý do",
    },
    preview: {
      title: "Xem trước",
      calculatedDays: "Số ngày nghỉ",
      calculatedHours: "Số giờ nghỉ",
      balanceBefore: "Số dư trước",
      requested: "Số ngày yêu cầu",
      balanceAfter: "Số dư sau",
      insufficient: "Không đủ số ngày phép",
      noBalance: "Loại nghỉ này không trừ số dư phép",
      warnings: "Lưu ý",
      loading: "Đang tính toán…",
    },
    buttons: {
      saveDraft: "Lưu nháp",
      submit: "Gửi đơn",
      saveChanges: "Lưu thay đổi",
      cancel: "Hủy",
      submitting: "Đang gửi…",
      saving: "Đang lưu…",
    },
    errors: {
      createFailed: "Tạo đơn nghỉ thất bại. Vui lòng thử lại.",
      updateFailed: "Cập nhật đơn nghỉ thất bại. Vui lòng thử lại.",
      submitFailed: "Gửi đơn thất bại. Vui lòng thử lại.",
      overlap: "Trùng với đơn nghỉ đã có trong khoảng thời gian này.",
      insufficientBalance: "Số ngày phép không đủ để thực hiện đơn này.",
      forbidden: "Bạn không có quyền tạo đơn nghỉ.",
      conflict: "Có xung đột dữ liệu. Vui lòng kiểm tra lại.",
      validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
      server: "Lỗi máy chủ. Vui lòng thử lại sau.",
      generic: "Đã có lỗi xảy ra. Vui lòng thử lại.",
      draftLocked: "Đơn không còn ở trạng thái nháp nên không thể sửa. Vui lòng tải lại trang.",
      notFoundDraft: "Không tìm thấy đơn nháp này. Có thể đơn đã bị hủy hoặc đã được gửi.",
    },
    dirty: "Bạn có thay đổi chưa lưu trong form đơn nghỉ. Nếu rời trang, dữ liệu sẽ bị mất.",
    forbidden: {
      title: "Không có quyền tạo đơn",
      description: "Bạn không có quyền tạo đơn nghỉ phép.",
    },
    editForbidden: {
      title: "Không có quyền sửa đơn",
      description: "Bạn không có quyền sửa đơn nghỉ nháp.",
    },
    editLocked: {
      title: "Không thể sửa đơn nghỉ",
      description: "Đơn không còn ở trạng thái nháp (đã gửi/hủy) nên không thể sửa.",
    },
    typeLoading: {
      title: "Đang tải loại nghỉ…",
      description: "",
    },
  },

  // ── Chi tiết đơn nghỉ (LEAVE-SCREEN-004) ─────────────────────────────────
  detail: {
    title: "Chi tiết đơn nghỉ",
    backToList: "Quay lại danh sách",
    fields: {
      requestCode: "Mã đơn",
      leaveType: "Loại nghỉ",
      durationType: "Hình thức",
      period: "Thời gian",
      calculatedDays: "Số ngày nghỉ",
      calculatedHours: "Số giờ nghỉ",
      status: "Trạng thái",
      reason: "Lý do",
      handoverNote: "Ghi chú bàn giao",
      contact: "Liên hệ khi nghỉ",
      submittedAt: "Ngày gửi",
      createdAt: "Ngày tạo",
    },
    balanceSnapshot: {
      title: "Số dư phép",
      before: "Trước khi nghỉ",
      requested: "Yêu cầu",
      after: "Sau khi nghỉ",
    },
    approvalHistory: {
      title: "Lịch sử xử lý",
      empty: "Chưa có thao tác nào",
      actions: {
        Submitted: "Gửi đơn",
        Approved: "Duyệt",
        Rejected: "Từ chối",
        Cancelled: "Hủy",
        Revoked: "Thu hồi",
        Comment: "Bình luận",
      },
    },
    dayBreakdown: {
      title: "Chi tiết ngày nghỉ",
      columns: {
        date: "Ngày",
        dayType: "Loại",
        leaveDays: "Ngày phép",
        leaveHours: "Giờ phép",
      },
    },
    actions: {
      cancel: "Hủy đơn",
      cancelConfirm: "Bạn có chắc muốn hủy đơn nghỉ này không?",
      cancelReason: "Lý do hủy",
      cancelReasonPlaceholder: "Nhập lý do hủy (không bắt buộc)…",
      cancelSubmit: "Xác nhận hủy",
      cancelDismiss: "Đóng",
      cancelling: "Đang hủy…",
      editDraft: "Sửa nháp",
    },
    statusStepper: {
      Draft: "Nháp",
      Pending: "Chờ duyệt",
      Approved: "Đã duyệt",
      Rejected: "Từ chối",
      Cancelled: "Đã hủy",
      Revoked: "Đã thu hồi",
    },
    error: {
      title: "Không thể tải chi tiết",
      description: "Có lỗi khi tải chi tiết đơn nghỉ. Vui lòng thử lại.",
    },
    notFound: {
      title: "Không tìm thấy đơn nghỉ",
      description: "Đơn nghỉ không tồn tại hoặc bạn không có quyền xem.",
    },
    cancelError: "Hủy đơn nghỉ thất bại. Vui lòng thử lại.",
    cancelSuccess: "Đơn nghỉ đã được hủy thành công.",
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem chi tiết đơn nghỉ này.",
    },
  },

  // ── Duyệt / từ chối đơn nghỉ (LEAVE-SCREEN-APPROVALS · S3-FE-LEAVE-2) ─────────
  approval: {
    title: "Đơn nghỉ cần duyệt",
    description: "Danh sách đơn nghỉ chờ phê duyệt",
    columns: {
      requester: "Người gửi",
      leaveType: "Loại nghỉ",
      period: "Thời gian",
      days: "Số ngày",
      status: "Trạng thái",
      actions: "Hành động",
    },
    filters: {
      allStatuses: "Tất cả trạng thái",
      allTypes: "Tất cả loại",
    },
    actions: {
      view: "Xem chi tiết",
      approve: "Duyệt",
      reject: "Từ chối",
      back: "Quay lại",
    },
    detail: {
      title: "Chi tiết đơn nghỉ",
      requester: "Người gửi",
      employeeCode: "Mã nhân viên",
      department: "Phòng ban",
      leaveType: "Loại nghỉ",
      period: "Thời gian",
      totalDays: "Số ngày",
      totalHours: "Số giờ",
      status: "Trạng thái",
      reason: "Lý do nghỉ",
      submittedAt: "Ngày gửi",
    },
    approve: {
      title: "Xác nhận duyệt đơn",
      confirm: "Bạn có chắc muốn duyệt đơn nghỉ này không?",
      note: "Ghi chú (không bắt buộc)",
      notePlaceholder: "Nhập ghi chú cho người gửi…",
      submit: "Xác nhận duyệt",
      submitting: "Đang duyệt…",
      error: "Duyệt đơn thất bại. Vui lòng thử lại.",
      forbidden: "Bạn không có quyền duyệt đơn nghỉ này.",
    },
    reject: {
      title: "Từ chối đơn nghỉ",
      reason: "Lý do từ chối",
      reasonPlaceholder: "Nhập lý do từ chối (bắt buộc)…",
      reasonRequired: "Lý do từ chối là bắt buộc.",
      submit: "Xác nhận từ chối",
      submitting: "Đang từ chối…",
      error: "Từ chối đơn thất bại. Vui lòng thử lại.",
      forbidden: "Bạn không có quyền từ chối đơn nghỉ này.",
    },
    empty: {
      title: "Không có đơn cần duyệt",
      description: "Hiện không có đơn nghỉ nào chờ phê duyệt.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách đơn cần duyệt. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem đơn nghỉ cần duyệt.",
    },
  },

  // ── Tất cả đơn nghỉ phép (LEAVE-SCREEN-006 · S3-FE-LEAVE-3) ──────────────────
  allRequests: {
    title: "Tất cả đơn nghỉ phép",
    description: "Toàn bộ đơn nghỉ phép trong phạm vi quyền của bạn",
    columns: {
      requester: "Người gửi",
      leaveType: "Loại nghỉ",
      period: "Thời gian",
      days: "Số ngày",
      status: "Trạng thái",
      submittedAt: "Ngày gửi",
      actions: "Hành động",
    },
    filters: {
      allStatuses: "Tất cả trạng thái",
      allTypes: "Tất cả loại",
      allDepartments: "Tất cả phòng ban",
      fromDate: "Từ ngày",
      toDate: "Đến ngày",
    },
    actions: {
      view: "Xem chi tiết",
    },
    detail: {
      title: "Chi tiết đơn nghỉ",
      requester: "Người gửi",
      employeeCode: "Mã nhân viên",
      department: "Phòng ban",
      leaveType: "Loại nghỉ",
      period: "Thời gian",
      totalDays: "Số ngày",
      totalHours: "Số giờ",
      status: "Trạng thái",
      reason: "Lý do nghỉ",
      submittedAt: "Ngày gửi",
      close: "Đóng",
    },
    empty: {
      title: "Không có đơn nghỉ nào",
      description: "Không tìm thấy đơn nghỉ phép nào khớp bộ lọc hiện tại.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách đơn nghỉ. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem tất cả đơn nghỉ phép.",
    },
  },
};

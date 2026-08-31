/**
 * S12-RECRUIT-FE-1 — namespace "recruit" (REC-SCREEN-001..006, SPEC-12 §9/§14).
 *
 * Quy ước (khuôn assets.ts): khoá enum giữ ĐÚNG giá trị server (contracts recruit.ts — candidateStage/
 * jobOpeningStatus/interviewStatus/offerStatus/recommendation) để tra thẳng
 * `t(`recruit:stage.${x}`)` — KHÔNG slug-hoá. Giá trị có khoảng trắng ("No Hire") để nguyên trong ngoặc.
 *
 * `errors.*` — 27 khoá `kind` RECRUIT (đo TỪ CODE BE, xem `recruit-errors.ts`) + 2 khoá idempotency +
 * `generic`. `states.*` dùng CHUNG cho mọi màn (loading/error/empty/saving) — tránh lặp chuỗi rải rác.
 */
export default {
  title: "Tuyển dụng",
  description: "Vị trí tuyển, pipeline ứng viên, phỏng vấn, offer và chuyển thành nhân viên.",

  // candidateStageSchema — SPEC-01 §17.11
  stage: {
    New: "Mới",
    Screening: "Sàng lọc",
    Interview: "Phỏng vấn",
    Offer: "Offer",
    Hired: "Đã tuyển",
    Rejected: "Từ chối",
  },

  // jobOpeningStatusSchema — SPEC-01 §17.12
  jobStatus: {
    Draft: "Nháp",
    Open: "Đang tuyển",
    Paused: "Tạm dừng",
    Closed: "Đã đóng",
  },

  // interviewStatusSchema — SPEC-01 §17.13
  interviewStatus: {
    Scheduled: "Đã lên lịch",
    Completed: "Hoàn thành",
    Cancelled: "Đã huỷ",
  },

  // offerStatusSchema — SPEC-01 §17.14
  offerStatus: {
    Draft: "Nháp",
    Sent: "Đã gửi",
    Accepted: "Đã nhận",
    Declined: "Từ chối",
    Withdrawn: "Đã rút",
  },

  // interviewRecommendationSchema
  recommendation: {
    Hire: "Tuyển",
    "No Hire": "Không tuyển",
    Consider: "Cân nhắc",
  },

  states: {
    loading: "Đang tải…",
    error: "Không tải được dữ liệu.",
    retry: "Thử lại",
    saving: "Đang lưu…",
    empty: "Chưa có dữ liệu.",
    cancel: "Huỷ",
    save: "Lưu",
  },

  // REC-SCREEN-001 — danh sách vị trí tuyển
  list: {
    title: "Vị trí tuyển dụng",
    create: "+ Vị trí tuyển",
    searchPlaceholder: "Tìm theo tên vị trí…",
    filterAll: "Tất cả",
    filterStatus: "Trạng thái",
    clearFilters: "Xoá bộ lọc",
    empty: "Chưa có vị trí tuyển nào.",
    emptyFiltered: "Không có vị trí nào khớp bộ lọc.",
    columns: {
      title: "Vị trí",
      orgUnit: "Đơn vị",
      recruiter: "Người phụ trách",
      headcount: "Chỉ tiêu",
      status: "Trạng thái",
    },
  },

  jobForm: {
    createTitle: "Tạo vị trí tuyển",
    editTitle: "Sửa vị trí tuyển",
    fields: {
      title: "Tên vị trí",
      description: "Mô tả",
      orgUnit: "Đơn vị",
      position: "Chức danh (tuỳ chọn)",
      headcount: "Chỉ tiêu",
      recruiter: "Người phụ trách",
    },
    selectOrgUnit: "— chọn đơn vị —",
    selectRecruiter: "— chưa gán —",
    submitCreate: "Tạo vị trí",
    submitEdit: "Lưu thay đổi",
    changeStatus: "Đổi trạng thái",
    changeStatusTitle: "Đổi trạng thái vị trí tuyển",
    reasonOptional: "Lý do (tuỳ chọn)",
    noTransition: "Không còn trạng thái nào để chuyển tới.",
    errors: {
      headcountInvalid: "Chỉ tiêu phải là số nguyên ≥ 1.",
      lookupFailed:
        "Không tải được danh sách đơn vị/chức danh (cần quyền HR read:department) — liên hệ quản trị viên.",
    },
  },

  // REC-SCREEN-002 — pipeline ứng viên
  pipeline: {
    title: "Pipeline ứng viên",
    filterJob: "Vị trí tuyển",
    filterAllJobs: "Tất cả vị trí",
    searchPlaceholder: "Tìm theo tên ứng viên…",
    addCandidate: "+ Thêm ứng viên",
    exportCsv: "Xuất CSV",
    emptyColumn: "Không có ứng viên",
    collapsedHint: "Thu gọn — bấm để xem",
    moveStage: "Chuyển giai đoạn",
    moveDialogTitle: "Chuyển giai đoạn ứng viên",
    targetStage: "Giai đoạn đích",
    reasonLabel: "Lý do",
    reasonHint: "Tối thiểu 3 ký tự — bắt buộc cho mọi lần chuyển.",
    submitMove: "Xác nhận chuyển",
    noTargets: "Ứng viên đã ở giai đoạn cuối — không thể chuyển tiếp từ đây.",
    piiMaskedBadge: "Đã che theo quyền",
  },

  // REC-SCREEN-004 — form ứng viên
  candidateForm: {
    createTitle: "Thêm ứng viên",
    editTitle: "Sửa hồ sơ ứng viên",
    fields: {
      jobOpening: "Vị trí ứng tuyển",
      fullName: "Họ và tên",
      email: "Email",
      phone: "Điện thoại",
      source: "Nguồn ứng viên",
      note: "Ghi chú",
    },
    selectJobOpening: "— chọn vị trí —",
    submitCreate: "Thêm ứng viên",
    submitEdit: "Lưu thay đổi",
    duplicateWarningTitle: "Có thể trùng ứng viên đã tồn tại:",
    duplicateEntry: "{{fullName}} — giai đoạn {{stage}} — vị trí {{job}}",
    duplicateDeletedHint: "(hồ sơ đã xoá)",
    errors: {
      required: "Bắt buộc nhập.",
      invalidEmail: "Email không hợp lệ.",
      selectJobOpening: "Chọn vị trí tuyển.",
    },
  },

  // REC-SCREEN-003 — chi tiết ứng viên
  detail: {
    back: "Quay lại",
    edit: "Sửa hồ sơ",
    notFound: "Không tìm thấy ứng viên.",
    tabs: {
      profile: "Hồ sơ",
      timeline: "Lịch sử",
      interviews: "Phỏng vấn",
      notes: "Ghi chú",
      offers: "Offer & chuyển NV",
      cv: "CV",
    },
    fields: {
      fullName: "Họ tên",
      email: "Email",
      phone: "Điện thoại",
      source: "Nguồn",
      stage: "Giai đoạn",
      jobOpening: "Vị trí ứng tuyển",
      note: "Ghi chú",
    },
    piiMaskedNote: "Email/điện thoại đã được che theo quyền của bạn.",
  },

  timeline: {
    empty: "Chưa có lịch sử chuyển giai đoạn.",
    entry: "{{from}} → {{to}}",
    reason: "Lý do",
    actedAt: "Thời điểm",
    actionMove: "Chuyển tay",
    actionConvert: "Chuyển NV",
  },

  notes: {
    empty: "Chưa có ghi chú nào.",
    add: "Thêm ghi chú",
    placeholder: "Nhập ghi chú…",
    edit: "Sửa",
    delete: "Xoá",
    submit: "Lưu ghi chú",
    editSubmit: "Lưu",
    deleted: "(ghi chú đã bị xoá)",
  },

  // REC-SCREEN-005 — phỏng vấn
  interviews: {
    listTitle: "Lịch phỏng vấn",
    create: "+ Tạo lịch phỏng vấn",
    edit: "Sửa",
    changeStatus: "Đổi trạng thái",
    filterFrom: "Từ ngày",
    filterTo: "Đến ngày",
    filterStatus: "Trạng thái",
    filterAll: "Tất cả",
    empty: "Chưa có lượt phỏng vấn nào.",
    columns: {
      candidate: "Ứng viên",
      round: "Vòng",
      time: "Thời gian",
      location: "Địa điểm",
      status: "Trạng thái",
    },
    formTitle: {
      create: "Tạo lịch phỏng vấn",
      edit: "Sửa lịch phỏng vấn",
    },
    fields: {
      candidate: "Ứng viên",
      round: "Vòng",
      startsAt: "Bắt đầu",
      endsAt: "Kết thúc",
      location: "Địa điểm",
      note: "Ghi chú",
      participants: "Người phỏng vấn",
    },
    selectCandidate: "— chọn ứng viên —",
    searchParticipant: "Tìm theo tên nhân viên…",
    noParticipants: "Chưa chọn người phỏng vấn nào.",
    errors: {
      endBeforeStart: "Giờ kết thúc phải sau giờ bắt đầu.",
    },
    submitCreate: "Tạo lịch",
    submitEdit: "Lưu thay đổi",
    statusDialogTitle: "Đổi trạng thái lượt phỏng vấn",
    statusNote: "Ghi chú (tuỳ chọn)",
    detailTitle: "Chi tiết lượt phỏng vấn",
    feedbackTitle: "Đánh giá của người phỏng vấn",
    feedbackEmpty: "Chưa có đánh giá nào.",
    myFeedback: "Đánh giá của tôi",
    addFeedback: "Ghi đánh giá",
    editFeedback: "Sửa đánh giá",
    rating: "Điểm (1–5)",
    recommendationLabel: "Khuyến nghị",
    comment: "Nhận xét",
    submitFeedback: "Lưu đánh giá",
  },

  // REC-SCREEN-006 — offer & convert (tab trong chi tiết ứng viên)
  offers: {
    title: "Offer",
    create: "+ Tạo offer",
    edit: "Sửa",
    changeStatus: "Đổi trạng thái",
    empty: "Chưa có offer nào.",
    columns: {
      title: "Chức danh",
      startDate: "Ngày vào làm",
      salary: "Lương",
      status: "Trạng thái",
    },
    salaryHidden: "🔒 Ẩn theo quyền",
    formTitle: {
      create: "Tạo offer",
      edit: "Sửa offer",
    },
    fields: {
      title: "Chức danh",
      startDate: "Ngày vào làm",
      salary: "Lương (VND)",
      note: "Ghi chú",
    },
    statusDialogTitle: "Đổi trạng thái offer",
    statusNote: "Ghi chú (tuỳ chọn)",
    submitCreate: "Tạo offer",
    submitEdit: "Lưu thay đổi",
    convert: {
      title: "Chuyển thành nhân viên",
      hint: 'Cần offer đang "Đã nhận" và ứng viên ở giai đoạn Offer, chưa được chuyển trước đó.',
      button: "Chuyển thành nhân viên",
      confirmTitle: "Xác nhận chuyển ứng viên thành nhân viên",
      confirmBody: "Thao tác này tạo hồ sơ nhân viên mới và không thể hoàn tác.",
      confirm: "Xác nhận chuyển",
      success: "Đã chuyển thành nhân viên — mã NV: {{employeeCode}}",
    },
  },

  cv: {
    title: "CV / Tài liệu",
    empty: "Chưa có tài liệu nào được đính kèm.",
    upload: "Tải CV lên",
    uploading: "Đang tải lên…",
    download: "Tải xuống",
    noPermission: "Bạn không có quyền xem tài liệu của ứng viên này.",
    gapNote:
      "Ghi chú vận hành: một số vai trò (recruiter/hr) hiện chưa được cấp quyền foundation-file trong seed — xem docblock candidate-file-api.ts.",
  },

  actions: {
    save: "Lưu",
    cancel: "Huỷ",
    close: "Đóng",
    confirm: "Xác nhận",
  },

  errors: {
    alreadyConverted: "Ứng viên này đã được chuyển thành nhân viên trước đó.",
    employeeCodeConflict: "Mã nhân viên vừa cấp bị trùng — thử lại thao tác.",
    employeeInactive: "Nhân sự được chọn hiện không còn hoạt động.",
    employeeNotFound: "Không tìm thấy nhân sự tương ứng.",
    exportTooLarge: "Kết quả xuất vượt trần cho phép — thu hẹp bộ lọc trước khi xuất.",
    feedbackDuplicate: "Bạn đã ghi đánh giá cho lượt phỏng vấn này rồi.",
    hiredViaConvertOnly:
      'Không thể chuyển tay sang "Đã tuyển" — dùng chức năng Chuyển thành nhân viên.',
    interviewCancelled: "Lượt phỏng vấn đã bị huỷ — không thể thao tác tiếp.",
    invalidInterviewTransition: "Không thể chuyển trạng thái lượt phỏng vấn này.",
    invalidJobOpeningTransition: "Không thể chuyển trạng thái vị trí tuyển này.",
    invalidOfferTransition: "Không thể chuyển trạng thái offer này.",
    invalidStageTransition: "Không thể chuyển ứng viên sang giai đoạn này.",
    invalidStartDate: "Ngày vào làm không được ở quá khứ.",
    invalidTimeRange: "Giờ kết thúc phải sau giờ bắt đầu.",
    jobClosed: "Vị trí tuyển đã đóng — không thể thêm/chuyển ứng viên vào.",
    noOffer: "Ứng viên chưa có offer nào.",
    notDraft: "Chỉ sửa được offer đang ở trạng thái Nháp.",
    notFound: "Không tìm thấy dữ liệu.",
    notInInterviewStage: "Ứng viên chưa ở giai đoạn Phỏng vấn.",
    notInOfferStage: "Ứng viên chưa ở giai đoạn Offer.",
    notParticipant: "Bạn không nằm trong danh sách phỏng vấn của lượt này.",
    notScheduled: "Chỉ sửa được lượt đang ở trạng thái Đã lên lịch.",
    offerNotAccepted: "Chưa có offer nào được chấp nhận.",
    offerOpenExists: "Ứng viên đã có một offer đang sống (Nháp/Đã gửi).",
    orgUnitInvalid: "Đơn vị được chọn không hợp lệ hoặc đã ngừng hoạt động.",
    positionInvalid: "Chức danh được chọn không hợp lệ hoặc đã ngừng hoạt động.",
    recruiterInvalid: "Người phụ trách được chọn không hợp lệ.",
    idempotencyInProgress: "Yêu cầu đang được xử lý — vui lòng đợi.",
    idempotencyKeyReused: "Yêu cầu trước đã dùng khoá này cho nội dung khác — thử lại.",
    generic: "Có lỗi xảy ra, vui lòng thử lại.",
  },
};

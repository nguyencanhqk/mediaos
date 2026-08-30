/**
 * S11-ROOM-FE-1 — namespace "rooms" (vi). Đăng ký trong apps/app/src/i18n/index.ts.
 *
 * Nhãn trạng thái + chrome màn ROOM-SCREEN-001..005. Khoá `status.*` KHÔNG giữ nguyên giá trị server
 * (khác `assets`) vì tập hiển thị có thêm `Completed` — trạng thái DẪN XUẤT không tồn tại trong DB
 * (SPEC-14 §10 ROOM-FUNC-010); bảng ánh xạ nằm ở `routes/rooms/constants.ts`.
 *
 * `errors.*` là đích của `roomErrorI18nKey()` — spec `room-errors.spec.ts` neo rằng MỌI kind BE phát ra
 * có một khoá RIÊNG ở đây, và không hai kind nào dùng chung một khoá.
 */
export default {
  title: "Phòng họp",
  description: "Lịch phòng, đặt phòng và quản trị phòng họp của công ty.",

  status: {
    confirmed: "Đã đặt",
    completed: "Đã diễn ra",
    cancelled: "Đã huỷ",
  },
  roomStatus: {
    active: "Đang hoạt động",
    inactive: "Vô hiệu",
  },

  // ── ROOM-SCREEN-001 — Lịch phòng ───────────────────────────────────────────
  calendar: {
    title: "Lịch phòng",
    view: { day: "Ngày", week: "Tuần" },
    today: "Hôm nay",
    prev: "Kỳ trước",
    next: "Kỳ sau",
    book: "+ Đặt phòng",
    filterCapacity: "Sức chứa tối thiểu",
    filterRooms: "Phòng",
    allRooms: "Tất cả phòng",
    capacityUnit: "{{count}} chỗ",
    empty: "Chưa có phòng họp nào. Người quản trị cần tạo phòng trước khi đặt lịch.",
    emptyBookings: "Không có lịch nào trong khoảng này.",
    slotFree: "Trống — bấm để đặt",
    clippedBefore: "Bắt đầu trước khung giờ hiển thị",
    clippedAfter: "Kết thúc sau khung giờ hiển thị",
    organizedBy: "Người tổ chức: {{name}}",
    unknownPerson: "Không rõ",
  },

  // ── ROOM-SCREEN-002 — Form đặt phòng ───────────────────────────────────────
  form: {
    title: "Đặt phòng họp",
    room: "Phòng",
    roomPlaceholder: "Chọn phòng",
    subject: "Chủ đề",
    subjectHint: "Tiêu đề này hiển thị cho toàn công ty trên lịch phòng.",
    description: "Mô tả",
    date: "Ngày",
    startsAt: "Bắt đầu",
    endsAt: "Kết thúc",
    attendees: "Người tham dự",
    attendeesHint: "Tối đa {{max}} người. Người tổ chức đã được tính, không cần chọn lại.",
    onBehalf: "Đặt hộ cho",
    onBehalfHint: "Để trống nếu bạn là người tổ chức.",
    submit: "Đặt phòng",
    cancel: "Đóng",
    submitting: "Đang gửi…",
    noBookableRoom: "Không có phòng nào nhận đặt trong khung giờ này.",
    headcount: "{{headcount}}/{{capacity}} người",
    conflictWarning:
      "Khung giờ này đã có lịch theo dữ liệu đang hiển thị. Bạn vẫn gửi được — máy chủ sẽ chốt lần cuối.",
    conflictList: "Đang bận:",
    nextFreeFrom: "Còn trống từ {{time}}.",
    nextFreeNone: "Không còn khung trống phù hợp trong ngày.",
    success: "Đã đặt phòng.",
    noAccount: "Chưa có tài khoản",
    alreadyPicked: "Đã chọn",
  },

  // ── ROOM-SCREEN-003 — Đặt phòng của tôi ────────────────────────────────────
  me: {
    title: "Đặt phòng của tôi",
    tabs: { upcoming: "Sắp tới", past: "Đã qua", cancelled: "Đã huỷ" },
    role: { organizer: "Tôi tổ chức", attendee: "Tôi tham dự" },
    empty: {
      upcoming: "Bạn chưa có lịch phòng nào sắp tới.",
      past: "Không có lịch nào trong 31 ngày qua.",
      cancelled: "Không có lịch nào đã huỷ trong khoảng này.",
    },
  },

  // ── ROOM-SCREEN-004 — Quản trị phòng họp ───────────────────────────────────
  manage: {
    title: "Quản trị phòng họp",
    tabs: { rooms: "Phòng họp", usage: "Lịch sử sử dụng" },
    create: "+ Thêm phòng",
    edit: "Sửa",
    deactivate: "Vô hiệu",
    activate: "Kích hoạt",
    delete: "Xoá",
    showInactive: "Hiện cả phòng vô hiệu",
    search: "Tìm theo tên hoặc vị trí",
    empty: "Chưa có phòng họp nào.",
    columns: {
      name: "Tên phòng",
      capacity: "Sức chứa",
      equipment: "Thiết bị",
      location: "Vị trí",
      status: "Trạng thái",
      actions: "",
    },
    usage: {
      from: "Từ ngày",
      to: "Đến ngày",
      room: "Phòng",
      bookings: "Số lượt",
      hours: "Tổng giờ",
      cancelled: "Đã huỷ",
      empty: "Không có lượt đặt nào trong khoảng đã chọn.",
      rangeTooWide: "Khoảng tra cứu tối đa {{max}} ngày.",
    },
    deleteConfirm: "Xoá phòng «{{name}}»? Lịch sử các lượt đã đặt vẫn được giữ.",
  },

  // ── Form phòng (tạo/sửa, trong màn 004) ────────────────────────────────────
  roomForm: {
    createTitle: "Thêm phòng họp",
    editTitle: "Sửa phòng họp",
    name: "Tên phòng",
    capacity: "Sức chứa",
    location: "Vị trí",
    equipment: "Thiết bị",
    equipmentHint: "Mỗi thiết bị một dòng, tối đa {{max}} mục.",
    description: "Mô tả",
    requiresApproval: "Yêu cầu duyệt trước khi đặt",
    requiresApprovalHint:
      "Phiên bản hiện tại chưa có luồng duyệt — phòng bật cờ này sẽ không nhận đặt.",
    isActive: "Đang hoạt động",
    sortOrder: "Thứ tự hiển thị",
    submit: "Lưu",
    cancel: "Huỷ",
  },

  // ── ROOM-SCREEN-005 — Chi tiết lượt đặt ────────────────────────────────────
  detail: {
    title: "Chi tiết lượt đặt",
    room: "Phòng",
    time: "Thời gian",
    organizer: "Người tổ chức",
    bookedBy: "Người đặt hộ",
    attendees: "Người tham dự",
    noAttendees: "Không có người tham dự nào được thêm.",
    status: "Trạng thái",
    cancelledAt: "Huỷ lúc",
    cancelledBy: "Người huỷ",
    cancelReason: "Lý do huỷ",
    cancel: "Huỷ lượt đặt",
    close: "Đóng",
  },

  cancelDialog: {
    title: "Huỷ lượt đặt phòng",
    body: "Người tổ chức và người tham dự sẽ nhận thông báo huỷ.",
    reason: "Lý do (không bắt buộc)",
    confirm: "Xác nhận huỷ",
    cancel: "Quay lại",
    success: "Đã huỷ lượt đặt.",
  },

  // ── Lỗi (SPEC-14 §12) — đích của roomErrorI18nKey() ────────────────────────
  errors: {
    generic: "Không thực hiện được thao tác. Vui lòng thử lại.",
    notFound: "Không tìm thấy phòng họp hoặc lượt đặt.",
    scopeDenied: "Bạn không có quyền thực hiện thao tác này.",

    overlap: "Phòng đã có lịch trong khung giờ này.",

    windowInvalid: "Khung giờ không hợp lệ.",
    endBeforeStart: "Giờ kết thúc phải sau giờ bắt đầu.",
    inPast: "Không thể đặt lịch trong quá khứ.",
    tooShort: "Lượt đặt tối thiểu 15 phút.",
    tooLong: "Lượt đặt tối đa 8 giờ.",
    tooFar: "Chỉ đặt trước tối đa 90 ngày.",
    rangeTooWide: "Khoảng tra cứu không hợp lệ (tối đa 31 ngày).",

    roomNotBookable: "Phòng này không nhận đặt.",
    roomInactive: "Phòng đang vô hiệu — không nhận đặt.",
    approvalNotSupported: "Phòng này yêu cầu duyệt — phiên bản hiện tại chưa hỗ trợ.",

    cancelInvalid: "Không huỷ được lượt đặt này.",
    alreadyCancelled: "Lượt đặt đã bị huỷ trước đó.",
    alreadyEnded: "Lượt đặt đã kết thúc — không thể huỷ.",

    attendeeInvalid: "Danh sách người tham dự không hợp lệ.",
    attendeeNotFound: "Người tham dự không tồn tại trong công ty.",
    attendeeInactive: "Người tham dự không còn hoạt động.",
    attendeeDuplicate: "Có người bị chọn trùng (hoặc trùng người tổ chức).",
    tooManyAttendees: "Tối đa 50 người tham dự.",

    overCapacity: "Vượt sức chứa của phòng.",

    roomHasUpcoming: "Phòng còn lịch đặt sắp tới — huỷ các lượt đó trước.",
    nameTaken: "Đã có phòng trùng tên trong công ty.",

    organizerInvalid: "Người tổ chức không hợp lệ.",
    bookOnBehalfDenied: "Bạn chỉ được đặt phòng cho chính mình.",
    organizerNotFound: "Người tổ chức không tồn tại trong công ty.",
    organizerInactive: "Người tổ chức không còn hoạt động.",

    idempotencyInProgress: "Yêu cầu trước đó đang được xử lý. Vui lòng chờ trong giây lát.",
    idempotencyKeyReused: "Yêu cầu đã thay đổi — đang gửi lại.",
  },

  states: {
    loading: "Đang tải…",
    error: "Không tải được dữ liệu.",
    retry: "Thử lại",
    saving: "Đang lưu…",
    forbidden: "Bạn không có quyền xem nội dung này.",
  },
} as const;

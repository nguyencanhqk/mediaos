/**
 * S7-CHAT-FE-2 — namespace `chat` (vi). SPEC-15 §9 · §14.
 *
 * Mọi chuỗi hiển thị của trang `/chat` sống ở đây; JSX KHÔNG được có chuỗi cứng. Nhãn trạng thái theo
 * đúng chữ của §14 để QA đối chiếu được từng ô một.
 */
export default {
  title: "Tin nhắn",

  rooms: {
    heading: "Trò chuyện",
    searchPlaceholder: "Tìm phòng theo tên hoặc mã",
    newButton: "Tin nhắn mới",
    newButtonAria: "Tạo cuộc trò chuyện mới",
    showArchived: "Xem phòng đã lưu trữ",
    showActive: "Quay lại phòng đang hoạt động",
    empty: "Chưa có cuộc trò chuyện nào.",
    emptyHint: "Bấm “Tin nhắn mới” để bắt đầu.",
    emptyArchived: "Không có phòng nào đã lưu trữ.",
    noSearchResult: "Không có phòng nào khớp “{{query}}”.",
    unreadAria: "{{count}} tin chưa đọc",
    unreadOverflow: "99+",
    archivedBadge: "Đã lưu trữ",
    noMessageYet: "Chưa có tin nhắn",
    loadError: "Không tải được danh sách phòng.",
    types: {
      direct: "Tin nhắn riêng",
      group: "Nhóm",
      department: "Phòng ban",
      project: "Dự án",
    },
    /** Phòng `direct` không có `name`; danh sách phòng không kèm thành viên nên nhãn dự phòng là mã phòng. */
    directFallback: "Tin nhắn riêng · {{code}}",
  },

  conversation: {
    selectRoom: "Chọn một cuộc trò chuyện",
    selectRoomHint: "Chọn ở danh sách bên trái, hoặc tạo cuộc trò chuyện mới.",
    loading: "Đang tải tin nhắn…",
    empty: "Chưa có tin nhắn nào.",
    emptyHint: "Hãy gửi tin đầu tiên để bắt đầu cuộc trò chuyện.",
    loadError: "Không tải được tin nhắn.",
    retry: "Thử lại",
    loadOlder: "Tải tin cũ hơn",
    loadingOlder: "Đang tải tin cũ hơn…",
    historyStart: "Đây là phần đầu của cuộc trò chuyện.",
    historyLimitReached:
      "Đã tải tối đa {{count}} tin trong phiên này. Mở lại phòng để tiếp tục xem lịch sử cũ hơn.",
    newMessages: "Có tin nhắn mới",
    jumpToLatest: "Xuống tin mới nhất",
    membersCount: "{{count}} thành viên",
    infoToggle: "Thông tin phòng",
    infoToggleClose: "Đóng thông tin phòng",
    jumpNotLoaded: "Không tìm thấy tin đó trong phần lịch sử đã tải.",
  },

  connection: {
    reconnecting: "Mất kết nối — đang kết nối lại. Bạn vẫn đọc được tin đã tải.",
    pollingFallback: "Máy chủ đang tắt realtime. Tin nhắn được cập nhật lại mỗi 10 giây.",
  },

  message: {
    recalled: "Tin nhắn đã được thu hồi",
    editedNever: "",
    replyingTo: "Trả lời {{name}}",
    replyPreviewUnavailable: "Tin gốc không còn trong phần đã tải",
    unknownSender: "Người dùng không xác định",
    systemSender: "Hệ thống",
    seenBy: "Đã xem: {{names}}",
    seenByCount: "{{count}} người đã xem",
    pinnedBadge: "Đã ghim",
    actions: "Tác vụ tin nhắn",
    reply: "Trả lời",
    pin: "Ghim",
    unpin: "Bỏ ghim",
    recall: "Thu hồi",
    copy: "Sao chép nội dung",
    recallConfirmTitle: "Thu hồi tin nhắn?",
    recallConfirmBody:
      "Nội dung và tệp đính kèm sẽ không còn hiển thị với mọi người trong phòng. Không hoàn tác được.",
    recallConfirmAction: "Thu hồi",
    cancel: "Huỷ",
    pinLimitReached: "Phòng đã đạt tối đa 20 tin ghim. Hãy bỏ ghim bớt trước.",
    recallFailed: "Không thu hồi được tin nhắn.",
    pinFailed: "Không ghim được tin nhắn.",
  },

  attachment: {
    unavailable: "Tệp không tải được",
    resolving: "Đang lấy liên kết tải…",
    download: "Tải xuống",
    imageAlt: "Ảnh đính kèm: {{name}}",
    imageBroken: "Ảnh không hiển thị được",
    countLabel: "{{count}} tệp đính kèm",
  },

  composer: {
    placeholder: "Nhập tin nhắn…",
    placeholderArchived: "Phòng đã lưu trữ — chỉ đọc.",
    placeholderNoPermission: "Bạn không có quyền gửi tin trong phòng này.",
    send: "Gửi",
    sendAria: "Gửi tin nhắn",
    attach: "Đính kèm tệp",
    attachAria: "Chọn tệp đính kèm",
    removeAttachment: "Bỏ tệp {{name}}",
    cancelReply: "Bỏ trả lời",
    uploading: "Đang tải lên {{name}} ({{percent}}%)",
    uploadFailed: "Tải tệp “{{name}}” thất bại.",
    tooManyFiles: "Mỗi tin chỉ đính kèm được tối đa {{count}} tệp.",
    tooLong: "Tin nhắn tối đa {{count}} ký tự.",
    sending: "Đang gửi…",
    failed: "Gửi lỗi",
    resend: "Gửi lại",
    discard: "Bỏ tin này",
    sendFailed: "Không gửi được tin. Nội dung của bạn vẫn được giữ nguyên.",
    archivedNotice: "Phòng đã lưu trữ. Bạn vẫn đọc được nhưng không gửi tin mới.",
  },

  info: {
    title: "Thông tin phòng",
    descriptionEmpty: "Chưa có mô tả.",
    roomCode: "Mã phòng",
    createdAt: "Tạo lúc",
    tabs: {
      members: "Thành viên",
      pinned: "Tin ghim",
    },
    members: {
      empty: "Phòng chưa có thành viên nào.",
      loadError: "Không tải được danh sách thành viên.",
      roleAdmin: "Quản trị phòng",
      roleMember: "Thành viên",
      you: "Bạn",
      add: "Thêm thành viên",
      addDialogTitle: "Thêm thành viên vào phòng",
      addDialogDescription: "Chọn nhân viên để thêm vào phòng nhóm này.",
      alreadyIn: "Đã ở trong phòng",
      remove: "Bớt khỏi phòng",
      removeConfirmTitle: "Bớt {{name}} khỏi phòng?",
      removeConfirmBody: "Người này sẽ không đọc được tin mới của phòng nữa.",
      promote: "Phong quản trị phòng",
      demote: "Hạ xuống thành viên",
      derivedNotice:
        "Thành viên phòng {{type}} do hệ thống đồng bộ tự động — không thêm/bớt bằng tay được.",
      actionFailed: "Không thực hiện được thao tác thành viên.",
    },
    pinned: {
      empty: "Chưa có tin nào được ghim.",
      loadError: "Không tải được tin ghim.",
      jump: "Xem trong hội thoại",
      limitHint: "Tối đa 20 tin ghim mỗi phòng.",
    },
    edit: {
      button: "Đổi tên / mô tả",
      title: "Đổi thông tin phòng",
      nameLabel: "Tên phòng",
      namePlaceholder: "Nhập tên phòng",
      descriptionLabel: "Mô tả",
      descriptionPlaceholder: "Mô tả ngắn về phòng (không bắt buộc)",
      save: "Lưu",
      cancel: "Huỷ",
      failed: "Không lưu được thông tin phòng.",
      nameRequired: "Tên phòng không được để trống.",
    },
    archive: {
      button: "Lưu trữ phòng",
      confirmTitle: "Lưu trữ phòng này?",
      confirmBody: "Sau khi lưu trữ, phòng chuyển sang chỉ đọc — không ai gửi thêm tin được.",
      confirmAction: "Lưu trữ",
      failed: "Không lưu trữ được phòng.",
      already: "Phòng đã được lưu trữ.",
    },
    leave: {
      button: "Rời phòng",
      confirmTitle: "Rời khỏi phòng?",
      confirmBody: "Bạn sẽ không đọc được tin mới của phòng này nữa.",
      // Chữ KHÁC nút mở hộp thoại ("Rời phòng") có chủ đích: hai nút trùng nhãn trong cùng một cây DOM
      // làm người dùng dùng trình đọc màn hình không phân biệt được đang ở bước nào.
      confirmAction: "Rời khỏi phòng",
      failed: "Không rời được phòng.",
    },
  },

  create: {
    title: "Cuộc trò chuyện mới",
    tabs: {
      direct: "Nhắn riêng",
      group: "Tạo nhóm",
    },
    direct: {
      description: "Chọn một người để bắt đầu nhắn riêng.",
      pickerTitle: "Chọn người nhắn riêng",
      noAccount: "Chưa liên kết tài khoản",
      failed: "Không mở được cuộc trò chuyện riêng.",
    },
    group: {
      description: "Đặt tên nhóm rồi chọn thành viên.",
      nameLabel: "Tên nhóm",
      namePlaceholder: "Ví dụ: Dự án Alpha",
      nameRequired: "Tên nhóm không được để trống.",
      descriptionLabel: "Mô tả",
      descriptionPlaceholder: "Mô tả ngắn (không bắt buộc)",
      membersLabel: "Thành viên",
      membersHint: "Bạn tự động là quản trị phòng.",
      pickMembers: "Chọn thành viên",
      selectedCount: "Đã chọn {{count}} người",
      create: "Tạo nhóm",
      failed: "Không tạo được nhóm.",
    },
    cancel: "Huỷ",
  },

  forbidden: {
    title: "Bạn không có quyền xem tin nhắn nội bộ",
    body: "Liên hệ quản trị hệ thống nếu bạn cần truy cập module Chat.",
  },

  time: {
    today: "Hôm nay",
    yesterday: "Hôm qua",
  },
} as const;

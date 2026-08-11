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
    /**
     * S8-CHAT-UX-FE-1 — tiêu đề MỤC trong danh sách. Bốn mục theo loại phòng dùng LẠI `rooms.types.*`
     * (cùng chữ, một nguồn) — ở đây chỉ khai thứ không suy được từ `room_type`.
     */
    sections: {
      pinned: "Đã ghim",
      collapseAria: "Thu gọn mục {{name}}",
      expandAria: "Mở rộng mục {{name}}",
      unreadAria: "{{count}} tin chưa đọc trong mục {{name}}",
    },
    /** Phòng `direct` không có `name`; danh sách phòng không kèm thành viên nên nhãn dự phòng là mã phòng. */
    directFallback: "Tin nhắn riêng · {{code}}",

    // ── S8-CHAT-UX-FE-2 ─────────────────────────────────────────────────────────────────────────
    /** Dấu hiệu NGAY TRÊN DÒNG — không phải chỉ trong menu (mở từng phòng mới biết = không bao giờ biết). */
    pinnedAria: "Đã ghim hội thoại",
    mutedAria: "Đang tắt thông báo",
    menu: {
      openAria: "Tuỳ chọn cho {{name}}",
      listAria: "Tuỳ chọn hội thoại {{name}}",
      pin: "Ghim hội thoại",
      unpin: "Bỏ ghim hội thoại",
      muteHeading: "Tắt thông báo",
      mutePreset: {
        "1h": "Trong 1 giờ",
        "8h": "Trong 8 giờ",
        "1w": "Trong 1 tuần",
      },
      unmute: "Bật lại thông báo",
      markUnread: "Đánh dấu chưa đọc",
      archive: "Lưu trữ phòng",
      /**
       * CHAT-ERR-021 — **nêu rõ con số trần**. "Không ghim được" để người dùng bấm lại vô ích; câu này
       * nói cho họ biết việc cần làm là bỏ ghim bớt.
       */
      pinLimitReached: "Bạn đã ghim tối đa {{count}} hội thoại. Hãy bỏ ghim bớt trước.",
      pinFailed: "Không đổi được trạng thái ghim. Hội thoại đã trở về như cũ.",
      muteFailed: "Không đổi được trạng thái thông báo. Hội thoại đã trở về như cũ.",
      markUnreadFailed: "Không đánh dấu chưa đọc được. Hội thoại đã trở về như cũ.",
      archiveFailed: "Không lưu trữ được phòng.",
    },
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
    // S7-CHAT-FE-4 — dải báo của chế độ xem ngữ cảnh. Nói rõ CẢ hệ quả ("tin mới không hiện ở đây") vì
    // đó chính là điều người dùng sẽ thắc mắc, và im lặng về nó là để họ tưởng chat bị hỏng.
    contextMode: "Đang xem đoạn hội thoại quanh tin đã chọn — tin mới chưa hiện ở đây.",
    contextExit: "Về tin mới nhất",
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

  // ── S8-CHAT-UX-FE-3 — thả cảm xúc (CHAT-FUNC-019 · CHAT-DEC-018) ──
  reaction: {
    open: "Thả cảm xúc",
    pickerLabel: "Chọn cảm xúc",
    // `{{emoji}}` là TÊN đã dịch của cảm xúc, không phải ký tự — nhãn này dành cho trình đọc màn hình.
    toggle: "{{emoji}} · {{count}} người. Bấm để thả hoặc bỏ thả.",
    failed: "Không cập nhật được cảm xúc.",
    names: {
      like: "Thích",
      love: "Yêu thích",
      haha: "Haha",
      wow: "Ngạc nhiên",
      sad: "Buồn",
      angry: "Phẫn nộ",
    },
  },

  // ── S8-CHAT-UX-FE-3 — đang gõ (CHAT-DEC-017) ──
  typing: {
    names: "{{names}} đang nhập…",
    many: "{{count}} người đang nhập…",
    // Có ping nhưng chưa tra được tên (roster chưa về): vẫn phải nói có người đang gõ.
    someone_one: "Có người đang nhập…",
    someone_other: "{{count}} người đang nhập…",
  },

  presence: {
    online: "Đang hoạt động",
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
      files: "Tệp",
      pinned: "Tin ghim",
    },
    /** S8-CHAT-UX-FE-2 — ảnh đại diện phòng (CHAT-FUNC-018 · CHAT-DEC-016). */
    avatar: {
      set: "Đặt ảnh đại diện",
      change: "Đổi ảnh đại diện",
      remove: "Gỡ ảnh",
      inputAria: "Chọn ảnh đại diện cho phòng",
      hint: "Ảnh vuông, tối đa 5 MB.",
      uploading: "Đang tải ảnh lên…",
      tooLarge: "Ảnh vượt quá {{mb}} MB. Hãy chọn ảnh nhỏ hơn.",
      // Ba thông điệp dưới đây ứng với ba MÃ LỖI khác nhau và ba việc khác nhau người dùng phải làm —
      // gộp chúng thành một câu chung là bỏ đúng phần họ cần (SPEC-15 §12 CHAT-ERR-022/023).
      forbidden: "Bạn không đủ tư cách đổi ảnh đại diện của phòng này.",
      notSupported: "Loại phòng này không có ảnh đại diện riêng.",
      archived: "Phòng đã lưu trữ — không đổi được ảnh đại diện.",
      rejectedFile: "Tệp không hợp lệ: chỉ nhận ảnh, và không vượt quá giới hạn dung lượng.",
      failed: "Không cập nhật được ảnh đại diện phòng.",
    },
    files: {
      empty: "Phòng chưa có tệp nào được gửi.",
      loadError: "Không tải được danh sách tệp.",
      loadMoreError: "Không tải thêm được tệp cũ hơn.",
      loadMore: "Tải tệp cũ hơn",
      loadingMore: "Đang tải…",
      jump: "Xem trong hội thoại",
    },
    members: {
      empty: "Phòng chưa có thành viên nào.",
      loadError: "Không tải được danh sách thành viên.",
      roleAdmin: "Quản trị phòng",
      roleMember: "Thành viên",
      you: "Bạn",
      // S7-CHAT-FE-4 — "đã xem tới đâu" (§13.2), dẫn xuất từ `last_read_seq`.
      seenLatest: "Đã xem tin mới nhất",
      seenBehind: "Chưa xem {{count}} tin",
      seenNone: "Chưa xem tin nào",
      seenUnknown: "Chưa rõ đã xem tới đâu",
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

  /** S7-CHAT-FE-3 — badge tổng chưa đọc trên header (CHAT-SCREEN-006). */
  badge: {
    ariaLabel: "Tin nhắn — {{count}} tin chưa đọc",
    totalUnread: "Tin nhắn — {{count}} tin chưa đọc",
    heading: "Tin nhắn gần đây",
    openFullPage: "Mở trang tin nhắn",
  },

  /** S7-CHAT-FE-3 — panel chat nổi (CHAT-SCREEN-002). */
  dock: {
    minimize: "Thu nhỏ cuộc trò chuyện với {{name}}",
    expand: "Mở lại cuộc trò chuyện với {{name}}",
    minimizeShort: "Thu nhỏ",
    expandShort: "Mở rộng",
    openFullScreen: "Mở toàn màn hình",
    close: "Đóng cuộc trò chuyện",
  },

  /** S7-CHAT-FE-4 — màn tìm kiếm tin nhắn (CHAT-SCREEN-005 · SPEC-15 §13.7). */
  search: {
    heading: "Tìm tin nhắn",
    openAria: "Tìm trong nội dung tin nhắn",
    backToRooms: "Quay lại danh sách phòng",
    placeholder: "Nhập nội dung cần tìm",
    scopeLabel: "Phạm vi tìm kiếm",
    scopeAll: "Tất cả phòng của tôi",
    scopeRoom: "Trong: {{room}}",
    // Nói cho người dùng biết họ KHÔNG cần gõ dấu — luật bỏ dấu nằm ở server (`f_unaccent`), đây chỉ là
    // lời hứa đúng với hành vi thật.
    accentHint: "Gõ có dấu hay không dấu đều tìm được (ví dụ “bao cao” ra “báo cáo”).",
    tooShort: "Nhập ít nhất {{count}} ký tự để tìm.",
    idle: "Nhập từ khoá để tìm trong tin nhắn.",
    empty: "Không có tin nhắn nào khớp “{{query}}”.",
    loadError: "Không tìm được. Kiểm tra kết nối rồi thử lại.",
    loadMore: "Tải thêm kết quả",
    loadingMore: "Đang tải…",
    attachmentCount: "{{count}} tệp",
    membershipNote: "Chỉ tìm trong những phòng bạn là thành viên.",
    jumpFailed: "Không mở được tin đó. Có thể tin đã bị thu hồi.",
    dismiss: "Đóng",
  },

  /** S7-CALL-FE-1 — cuộc gọi thoại/hình 1-1 (CHAT-SCREEN-006 · DECISIONS-07). */
  call: {
    startAudio: "Gọi thoại",
    startVideo: "Gọi video",
    incomingTitle: "{{name}} đang gọi",
    incomingAudio: "Cuộc gọi thoại đến",
    incomingVideo: "Cuộc gọi video đến",
    ringing: "Đang đổ chuông…",
    accept: "Nhận",
    reject: "Từ chối",
    calling: "Đang gọi…",
    connecting: "Đang kết nối…",
    inCall: "Đang trong cuộc gọi",
    frameLabel: "Cuộc gọi với {{name}}",
    hangup: "Kết thúc cuộc gọi",
    muteMic: "Tắt mic",
    unmuteMic: "Bật mic",
    cameraOn: "Bật camera",
    cameraOff: "Tắt camera",
    shareScreen: "Chia sẻ màn hình",
    stopSharing: "Dừng chia sẻ màn hình",
    peerSharingScreen: "Người kia đang chia sẻ màn hình",
    peerMuted: "Người kia đã tắt mic",
    minimize: "Thu nhỏ cuộc gọi",
    expand: "Mở toàn màn hình",
    // Roster chưa về (phòng chưa mở lần nào) — overlay vẫn phải bắt máy được, không đợi tên.
    unknownPeer: "Người dùng",
  },

  time: {
    today: "Hôm nay",
    yesterday: "Hôm qua",
  },
} as const;

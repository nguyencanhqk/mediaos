/**
 * S16-SOCIAL-FE-1 — namespace `social` (vi). SPEC-16 §9 · §12 · §14.
 *
 * Mọi chuỗi hiển thị của cổng thông tin `/feed*` sống ở đây; **JSX KHÔNG được có chuỗi cứng**
 * (khuôn `chat.ts`). Chỉ có locale `vi`.
 *
 * ⚠️ NGOẠI LỆ ĐÃ BIẾT — nhãn sidebar KHÔNG qua đây: `SidebarItemMeta.label` là chuỗi tiếng Việt
 * literal trong `layouts/workspace/sidebar/social.ts` (sidebar render nhanh, không qua i18n — xem
 * `sidebar-registry.ts` dòng 5). Tiêu đề route thì ngược lại: `routeTitle.social*` nằm ở
 * `packages/web-core/src/i18n/locales/vi/nav.ts` vì 6 route đó thuộc `ROUTE_REGISTRY` của web-core.
 * Ba nơi, ba lý do — đừng gom.
 *
 * ┌─ BA CHUỖI RỖNG PHẢI KHÁC NHAU (SPEC-16 §14 · ca C12) ─────────────────────────────────────────┐
 * │ `empty.feed` · `empty.search` · `empty.saved` là BA câu KHÁC NHAU, và spec assert chúng khác   │
 * │ nhau bằng `not.toBe`. Một màn rỗng nói sai lý do ("chưa có bài nào" trong khi thật ra là "tìm  │
 * │ không ra") đẩy người dùng đi sửa nhầm thứ. Đừng "gọn hoá" thành một khoá dùng chung.            │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export default {
  // ── Khung portal ────────────────────────────────────────────────────────────
  portal: {
    leftRailAria: "Điều hướng bảng tin",
    rightRailAria: "Thông tin bên phải",
    tabBarAria: "Điều hướng bảng tin (thu gọn)",
    mainAria: "Bảng tin — nội dung chính",
    myProfile: "Trang cá nhân",
  },

  // ── Composer (SOC-SCREEN-001) ───────────────────────────────────────────────
  //
  // ⚠️ ĐÚNG HAI nút: «Chia sẻ» + «Tin tức» (plan D2). Ca C4 assert đúng con số 2. Bình chọn / Sáng
  // kiến / Vinh danh KHÔNG có khoá ở đây — thêm khoá là bước đầu của việc lén mở phạm vi sang FE-2.
  composer: {
    placeholder: "Bạn đang nghĩ gì?",
    newsPlaceholder: "Nội dung tin tức gửi tới công ty…",
    typeShare: "Chia sẻ",
    typeNews: "Tin tức",
    typeAria: "Chọn loại bài",
    audienceLabel: "Phạm vi",
    audienceCompany: "Toàn công ty",
    audienceOrgUnit: "Phòng ban",
    requiresAck: "Yêu cầu xác nhận đã đọc",
    submit: "Đăng",
    submitting: "Đang đăng…",
    cancel: "Huỷ",
    emojiAria: "Chèn biểu tượng cảm xúc",
    mentionAria: "Nhắc tới đồng nghiệp",
    /** Bỏ mention ngoài audience — THÔNG TIN, không phải lỗi (SPEC-16 §12 `ERR-009`). */
    droppedMentions_one: "Đã bỏ {{count}} lượt nhắc tới người không nằm trong phạm vi bài.",
    droppedMentions_other: "Đã bỏ {{count}} lượt nhắc tới người không nằm trong phạm vi bài.",
    bodyTooLong: "Nội dung vượt quá {{max}} ký tự.",
    bodyRequired: "Hãy nhập nội dung trước khi đăng.",
  },

  // ── Thẻ bài (UI-07 §34b.4) ─────────────────────────────────────────────────
  post: {
    unknownAuthor: "Người dùng đã rời công ty",
    pinned: "Đã ghim",
    edited: "đã chỉnh sửa",
    requiresAck: "Cần xác nhận đã đọc",
    showMore: "Xem thêm",
    showLess: "Thu gọn",
    commentsLocked: "Bình luận đã bị khoá",
    /** `viewCount` — số người đã xem, KHÔNG phải số lượt xem. */
    viewCount_one: "{{count}} lượt xem",
    viewCount_other: "{{count}} lượt xem",
    commentCount_one: "{{count}} bình luận",
    commentCount_other: "{{count}} bình luận",
    likeCount_one: "{{count}} cảm xúc",
    likeCount_other: "{{count}} cảm xúc",
    openDetail: "Mở bài viết",
    attachmentUnavailable: "Không xem được tệp đính kèm",
    imageAlt: "Ảnh đính kèm {{index}}/{{total}}",
    moreImages: "+{{count}}",
    // Menu ⋯ — mỗi mục là một cặp quyền KHÁC NHAU, xem plan §5.2.
    menu: {
      trigger: "Tuỳ chọn bài viết",
      copyLink: "Sao chép liên kết",
      copied: "Đã sao chép liên kết",
      edit: "Chỉnh sửa",
      delete: "Xoá bài",
      hide: "Ẩn bài",
      unhide: "Bỏ ẩn bài",
      pin: "Ghim bài",
      unpin: "Bỏ ghim",
      lockComments: "Khoá bình luận",
      unlockComments: "Mở bình luận",
    },
    confirmDelete: "Xoá bài viết này?",
    confirmDeleteBody: "Bài sẽ không còn hiển thị trên bảng tin. Thao tác này không hoàn tác được.",
  },

  // ── Cảm xúc — 6 mã dùng CHUNG với CHAT ─────────────────────────────────────
  //
  // ⚠️ Khoá ở đây PHẢI khớp đúng 6 giá trị của `feedReactionEmojiSchema` (tái dùng
  // `chatReactionEmojiSchema`). Bộ này đã sống ở 3 nơi (CHECK DB của CHAT · hằng drizzle · enum
  // contracts) — bảng nhãn này là nhãn, KHÔNG phải nguồn sự thật thứ tư.
  reaction: {
    trigger: "Bày tỏ cảm xúc",
    like: "Thích",
    love: "Yêu thích",
    haha: "Haha",
    wow: "Wow",
    sad: "Buồn",
    angry: "Phẫn nộ",
    listTitle: "Người đã bày tỏ cảm xúc",
    listEmpty: "Chưa có ai bày tỏ cảm xúc.",
  },

  // ── Bình luận ───────────────────────────────────────────────────────────────
  comment: {
    heading: "Bình luận",
    placeholder: "Viết bình luận…",
    replyPlaceholder: "Trả lời {{name}}…",
    submit: "Gửi",
    submitting: "Đang gửi…",
    reply: "Trả lời",
    cancelReply: "Huỷ trả lời",
    edit: "Sửa",
    delete: "Xoá",
    confirmDelete: "Xoá bình luận này?",
    loadMore: "Xem thêm bình luận",
    empty: "Chưa có bình luận nào.",
    // Lỗi TẢI danh sách bình luận cần tiêu đề RIÊNG: `state.errorTitle` là "Không tải được bảng
    // tin" — sai chỗ khi cái hỏng là danh sách bình luận của một bài. Đây là nhánh mà trước bản vá
    // FULL gate rơi thẳng vào câu "Chưa có bình luận nào", khiến người đọc kết luận 12 bình luận
    // vừa bị xoá sạch.
    errorTitle: "Không tải được bình luận",
    locked: "Tác giả đã khoá bình luận cho bài này.",
    bodyRequired: "Hãy nhập nội dung bình luận.",
    /**
     * ⚠️ FE-1 KHÔNG có đính kèm trong bình luận (plan D8 · nợ N1): không tồn tại
     * `POST /social/files/upload-url`, còn `foundation/files` đòi cặp `*:foundation-file` mà nhân
     * viên thường KHÔNG có. Không khai khoá nút đính kèm ở đây — khoá có sẵn là lời mời dựng UI cho
     * một đường không đi được.
     */
  },

  // ── Badge «N bài mới» (D7) ─────────────────────────────────────────────────
  newPosts: {
    /** Bấm ⇒ tải lại danh sách + cuộn lên đầu. KHÔNG tự chèn bài (SOC-DEC-010). */
    badge_one: "{{count}} bài mới",
    badge_other: "{{count}} bài mới",
    aria: "Tải các bài mới và cuộn lên đầu",
  },

  // ── Bộ lọc / sắp xếp (giữ trong URL search — D6) ───────────────────────────
  filter: {
    sortLabel: "Sắp xếp",
    sortActive: "Hoạt động mới",
    sortLatest: "Mới đăng",
    typeLabel: "Loại bài",
    typeAll: "Tất cả",
    typeShare: "Chia sẻ",
    typeNews: "Tin tức",
    audienceLabel: "Phạm vi",
    audienceAll: "Tất cả",
    tagLabel: "Thẻ",
    clearTag: "Bỏ lọc thẻ «{{tag}}»",
    /** Chỉ hiện cho người có `manage:feed-post` — server 403 nếu người khác gửi `status`. */
    statusLabel: "Trạng thái",
    statusPublished: "Đang hiển thị",
    statusHidden: "Đang ẩn",
  },

  // ── Tin tức (SOC-SCREEN-003) ───────────────────────────────────────────────
  news: {
    title: "Tin tức công ty",
    ackButton: "Xác nhận đã đọc",
    acking: "Đang xác nhận…",
    acked: "Bạn đã xác nhận đọc",
    ackedAt: "Đã xác nhận lúc {{at}}",
    /** Gate `manage:feed-news` — nửa «chưa đọc» chiếu danh tính toàn công ty. */
    readersTab: "Danh sách đã đọc",
    readersTitle: "Ai đã đọc bài này",
    readersRead: "Đã đọc",
    readersUnread: "Chưa đọc",
    readersEmpty: "Chưa có ai xác nhận đã đọc.",
    // Nửa «chưa đọc» rỗng có nghĩa NGƯỢC HẲN với `readersEmpty`: ở đây rỗng là tin MỪNG (mọi người
    // đã đọc), ở kia rỗng là chưa ai đọc. Dùng chung một câu cho cả hai nửa là nói sai một nửa.
    readersAllRead: "Mọi người trong phạm vi đã xác nhận đọc.",
    readersCount: "{{read}}/{{total}} đã xác nhận",
  },

  // ── Đã lưu (SOC-SCREEN-004) ────────────────────────────────────────────────
  saved: {
    title: "Bài đã lưu",
    save: "Lưu bài",
    unsave: "Bỏ lưu",
    savedToast: "Đã lưu bài viết",
    unsavedToast: "Đã bỏ lưu bài viết",
  },

  // ── Trang cá nhân (SOC-SCREEN-005) ─────────────────────────────────────────
  profile: {
    titleMine: "Bài viết của tôi",
    titleOther: "Bài viết của {{name}}",
    titleUnknown: "Bài viết của đồng nghiệp",
    backToFeed: "Về bảng tin",
  },

  // ── Chi tiết bài (SOC-SCREEN-002) ──────────────────────────────────────────
  detail: {
    backToFeed: "Về bảng tin",
    notFound: "Không tìm thấy bài viết",
    notFoundBody: "Bài viết có thể đã bị xoá hoặc bạn không còn quyền xem.",
  },

  // ── Widget rail phải ───────────────────────────────────────────────────────
  birthday: {
    title: "Sinh nhật",
    rangeToday: "Hôm nay",
    rangeWeek: "Tuần này",
    rangeMonth: "Tháng này",
    /** Mở composer prefill @mention — KHÔNG tự đăng bài (SOC-DEC-003: không có bài hệ thống). */
    wishButton: "Gửi lời chúc",
    wishPrefill: "Chúc mừng sinh nhật {{name}}! 🎉",
    empty: "Không có sinh nhật nào trong khoảng này.",
    unknownPerson: "Đồng nghiệp",
    /** `date` đã được server chuẩn hoá; FE chỉ định dạng hiển thị. */
    onDate: "Ngày {{date}}",
  },
  highlight: {
    title: "Tin nổi bật",
    empty: "Chưa có tin nổi bật.",
    viewAll: "Xem tất cả tin tức",
  },

  // ── Ô tìm kiếm portal (SOCIAL-API-023) ─────────────────────────────────────
  search: {
    placeholder: "Tìm bài viết, thẻ, người…",
    aria: "Tìm trong bảng tin",
    submit: "Tìm",
    clear: "Xoá từ khoá",
    resultsTitle: "Kết quả cho «{{q}}»",
    minLength: "Nhập ít nhất 1 ký tự để tìm.",
  },

  // ── Ba trạng thái rỗng KHÁC NHAU (C12) ─────────────────────────────────────
  empty: {
    feed: "Chưa có bài nào trên bảng tin.",
    feedHint: "Hãy là người đầu tiên chia sẻ điều gì đó với công ty.",
    search: "Không tìm thấy bài viết nào khớp từ khoá.",
    searchHint: "Thử từ khoá ngắn hơn hoặc bỏ bớt bộ lọc.",
    saved: "Bạn chưa lưu bài viết nào.",
    savedHint: "Mở menu ⋯ trên một bài rồi chọn «Lưu bài».",
    news: "Chưa có tin tức nào được đăng.",
    profile: "Đồng nghiệp này chưa đăng bài nào.",
    profileMine: "Bạn chưa đăng bài nào.",
  },

  // ── Loading / lỗi (C13) ────────────────────────────────────────────────────
  state: {
    loadingAria: "Đang tải bảng tin",
    errorTitle: "Không tải được bảng tin",
    errorBody: "Đã có lỗi khi tải dữ liệu. Vui lòng thử lại.",
    retry: "Thử lại",
    loadMore: "Xem thêm",
    loadingMore: "Đang tải…",
  },

  // ── Lỗi HÀNH ĐỘNG GHI (khác hẳn lỗi TẢI ở `state` trên) ────────────────────
  //
  // Khối này sinh ra từ FULL gate 23/09/2026: cả 12 mutation của module thiếu `onError`, app không
  // có hệ toast, `QueryClient` không khai `MutationCache.onError` ⇒ mọi hành động ghi hỏng là câm
  // tuyệt đối. Người dùng bấm «Xác nhận đã đọc», server trả 500, nút nhả ra như cũ — họ đóng tab và
  // tin rằng đã xác nhận.
  //
  // Tách ĐÔI mỗi hành động thành `forbidden` (403) và lỗi chung, vì hai ca đòi hai hành vi khác
  // nhau: mất quyền thì thử lại bao nhiêu lần cũng vô ích, lỗi mạng/500 thì thử lại là đúng.
  actionError: {
    forbidden: {
      reaction: "Bạn không còn quyền bày tỏ cảm xúc ở bài này.",
      save: "Bạn không còn quyền lưu bài này.",
      moderate: "Bạn không có quyền thực hiện thao tác kiểm duyệt này.",
      delete: "Bạn không có quyền xoá bài này.",
      comment: "Bạn không còn quyền bình luận ở bài này.",
      commentDelete: "Bạn không có quyền xoá bình luận này.",
      post: "Bạn không có quyền đăng loại bài này.",
      ack: "Bạn không còn quyền xác nhận tin này.",
    },
    generic: {
      reaction: "Không gửi được cảm xúc. Vui lòng thử lại.",
      save: "Không lưu được bài. Vui lòng thử lại.",
      moderate: "Không thực hiện được thao tác. Vui lòng thử lại.",
      delete: "Không xoá được bài. Bài vẫn còn — vui lòng thử lại.",
      comment: "Không gửi được bình luận. Nội dung bạn gõ vẫn còn trong ô soạn.",
      commentDelete: "Không xoá được bình luận. Vui lòng thử lại.",
      post: "Không đăng được bài. Nội dung bạn gõ vẫn còn trong ô soạn.",
      ack: "Không ghi nhận được xác nhận của bạn. Vui lòng thử lại.",
    },
    dismiss: "Đóng thông báo",
  },
} as const;

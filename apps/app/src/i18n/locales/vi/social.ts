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
import groups from "./social-groups";
import kudos from "./social-kudos";

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
  // S16-SOCIAL-FE-2C: NĂM nút — «Chia sẻ» · «Tin tức» · «Bình chọn» · «Sáng kiến» · «Vinh danh». Ca C4''
  // assert tập đó; «Vinh danh» vắng ở composer NHÓM (owner ký O3).
  composer: {
    placeholder: "Bạn đang nghĩ gì?",
    newsPlaceholder: "Nội dung tin tức gửi tới công ty…",
    /** S16-SOCIAL-FE-2B — composer trên trang nhóm (`audience='group'`). */
    groupPlaceholder: "Viết gì đó cho nhóm…",
    groupNewsPlaceholder: "Nội dung tin tức gửi tới các thành viên nhóm…",
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
    typePoll: "Bình chọn",
    typeIdea: "Sáng kiến",
    ideaPlaceholder: "Mô tả sáng kiến của bạn…",
    typeKudos: "Vinh danh",
    /** Kudos: ô soạn chính là LỜI NHẮN (bắt buộc) — không gửi `body`. */
    kudosPlaceholder: "Lời cảm ơn / ghi nhận của bạn…",
    kudos: {
      searchLabel: "Người được vinh danh",
      searchPlaceholder: "Gõ tên đồng nghiệp…",
      searchHint: "Gõ ít nhất 2 chữ để tìm.",
      searchLoading: "Đang tìm…",
      searchError: "Không tải được danh bạ. Vui lòng thử lại.",
      searchEmpty: "Không tìm thấy ai khớp.",
      searchTruncated: "Còn nhiều người khớp hơn — gõ thêm để thu hẹp.",
      resultsAria: "Kết quả tìm người",
      selectedAria: "Người đã chọn",
      selectedCount: "Đã chọn {{count}}/{{max}}",
      full: "Đã đủ {{max}} người.",
      remove: "Bỏ {{name}}",
      badge: "Huy hiệu",
      noBadge: "Không gắn huy hiệu",
      badgeLoading: "Đang tải huy hiệu…",
      badgeError: "Không tải được danh sách huy hiệu — vẫn gửi được không kèm huy hiệu.",
      official: "Vinh danh chính thức (dấu công ty)",
      recipientsRequired: "Hãy chọn ít nhất một người được vinh danh.",
      recipientsTooMany: "Chỉ vinh danh tối đa {{max}} người một lần.",
      messageRequired: "Hãy nhập lời nhắn vinh danh.",
      messageTooLong: "Lời nhắn tối đa {{max}} ký tự.",
    },
    /** Poll: ô soạn chính là MÔ TẢ TUỲ CHỌN (plan §8 M8) — bỏ trống thì không gửi `body`. */
    pollDescriptionPlaceholder: "Mô tả thêm (không bắt buộc)…",
    poll: {
      question: "Câu hỏi",
      questionPlaceholder: "Bạn muốn hỏi mọi người điều gì?",
      optionLabel: "Lựa chọn {{index}}",
      addOption: "Thêm lựa chọn",
      removeOption: "Bỏ lựa chọn {{index}}",
      multipleChoice: "Cho chọn nhiều đáp án",
      anonymous: "Bỏ phiếu ẩn danh",
      closesAt: "Hạn kết thúc (không bắt buộc)",
      /** 🔒 SPEC-16 §13.4 — hai cờ và các lựa chọn BẤT BIẾN sau khi đăng. */
      immutableHint: "Sau khi đăng, không sửa được lựa chọn, kiểu chọn và chế độ ẩn danh.",
      questionRequired: "Hãy nhập câu hỏi.",
      questionTooLong: "Câu hỏi tối đa {{max}} ký tự.",
      optionsRange: "Bình chọn cần từ 2 đến 10 lựa chọn.",
      optionEmpty: "Có lựa chọn đang để trống.",
      optionTooLong: "Mỗi lựa chọn tối đa {{max}} ký tự.",
      optionDuplicate: "Có hai lựa chọn giống nhau.",
      closesAtPast: "Hạn kết thúc phải ở tương lai.",
    },
  },

  // ── Khối bình chọn trên thẻ bài (SOC-SCREEN-007, plan D5) ─────────────────
  poll: {
    anonymous: "Ẩn danh",
    multipleHint: "Chọn được nhiều đáp án",
    singleHint: "Chọn một đáp án",
    totalVoters_one: "{{count}} người đã bỏ phiếu",
    totalVoters_other: "{{count}} người đã bỏ phiếu",
    percent: "{{percent}}%",
    myChoice: "Lựa chọn của bạn",
    vote: "Bỏ phiếu",
    changeVote: "Đổi phiếu",
    voting: "Đang gửi…",
    withdraw: "Rút phiếu",
    close: "Kết thúc bình chọn",
    closing: "Đang kết thúc…",
    closed: "Đã kết thúc",
    /** Quá `closesAt` nhưng job chưa chạy — server đã từ chối phiếu (plan §8 H4). */
    expired: "Đã hết hạn",
    closesIn: "Kết thúc {{when}}",
    loadingAria: "Đang tải bình chọn",
    errorTitle: "Không tải được bình chọn",
    optionsAria: "Các lựa chọn của bình chọn",
  },

  // ── Sáng kiến (SOC-SCREEN-008, plan D6/D8) ─────────────────────────────────
  idea: {
    label: "Sáng kiến",
    viewAll: "Xem danh sách sáng kiến",
    status: {
      submitted: "Đã gửi",
      under_review: "Đang xem xét",
      accepted: "Được chấp nhận",
      rejected: "Không được chấp nhận",
    },
    review: "Xét duyệt",
    reviewTitle: "Xét duyệt sáng kiến",
    targetLabel: "Chuyển sang",
    note: "Ghi chú xét duyệt",
    notePlaceholder: "Nhận xét gửi tới tác giả…",
    noteRequired: "Từ chối bắt buộc ghi lý do.",
    noteTooLong: "Ghi chú tối đa {{max}} ký tự.",
    /** D21 của BE: mỗi lượt xét duyệt GHI ĐÈ ghi chú cũ (plan §8 L14). */
    noteReplaces: "Ghi chú mới sẽ thay cho ghi chú hiện có.",
    submit: "Lưu kết quả",
    submitting: "Đang lưu…",
    cancel: "Huỷ",
    reviewedBy: "Xét duyệt bởi {{name}}",
    openPost: "Mở bài viết",
  },

  // ── Màn danh sách bình chọn / sáng kiến ────────────────────────────────────
  polls: {
    title: "Bình chọn",
    tabOpen: "Đang mở",
    tabClosed: "Đã kết thúc",
    tabAll: "Tất cả",
    filterAria: "Lọc bình chọn theo trạng thái",
    empty: "Chưa có bình chọn nào.",
    emptyOpen: "Không có bình chọn nào đang mở.",
  },
  ideas: {
    title: "Sáng kiến",
    filterAll: "Tất cả",
    filterAria: "Lọc sáng kiến theo trạng thái",
    empty: "Chưa có sáng kiến nào.",
    emptyFiltered: "Không có sáng kiến nào ở trạng thái này.",
  },
  pagination: {
    prev: "Trang trước",
    next: "Trang sau",
    pageOf: "Trang {{page}}/{{pages}}",
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
  openPolls: {
    title: "Bình chọn đang mở",
    empty: "Không có bình chọn nào đang mở.",
    viewAll: "Xem tất cả bình chọn",
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
  // ── S16-SOCIAL-FE-2B — màn Nhóm (SOC-SCREEN-006), file riêng `social-groups.ts` ──
  groups,
  // ── S16-SOCIAL-FE-2C — Vinh danh (SOC-SCREEN-009), file riêng `social-kudos.ts` ──
  kudos,

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
      vote: "Bạn không còn quyền bỏ phiếu ở bình chọn này.",
      pollClose: "Bạn không có quyền kết thúc bình chọn này.",
      ideaReview: "Bạn không có quyền xét duyệt sáng kiến.",
      // S16-SOCIAL-FE-2B — nhóm. 403 ở đây thường nghĩa là vai của bạn trong nhóm vừa đổi.
      groupJoin: "Bạn không có quyền tham gia nhóm này.",
      groupLeave: "Bạn không thể rời nhóm lúc này.",
      groupCreate: "Bạn không có quyền tạo nhóm.",
      groupUpdate: "Bạn không còn quyền sửa thông tin nhóm này.",
      groupDelete: "Chỉ chủ nhóm mới xoá được nhóm.",
      memberDecide: "Bạn không còn quyền duyệt yêu cầu tham gia của nhóm này.",
      memberRole: "Bạn không có quyền đổi vai trò này.",
      memberRemove: "Bạn không còn quyền mời thành viên ra khỏi nhóm này.",
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
      // Plan FE-2 §8 M6: server ném mã 016/017/«đang xử lý» cùng một `code` HTTP ⇒ FE KHÔNG phân biệt
      // được. Chữ trung tính + khối tự tải lại trạng thái (poll vừa đóng sẽ tự hiện «Đã kết thúc»).
      vote: "Không ghi nhận được phiếu. Trạng thái bình chọn vừa được tải lại — vui lòng kiểm tra rồi thử lại.",
      pollClose: "Không kết thúc được bình chọn. Trạng thái vừa được tải lại — vui lòng thử lại.",
      ideaReview: "Không lưu được kết quả xét duyệt. Danh sách vừa được tải lại — có thể người khác đã duyệt trước.",
      groupJoin: "Không tham gia được nhóm. Vui lòng thử lại.",
      groupLeave: "Không rời được nhóm. Vui lòng thử lại.",
      groupCreate: "Không tạo được nhóm. Thông tin bạn nhập vẫn còn — vui lòng thử lại.",
      groupUpdate: "Không lưu được thay đổi. Vui lòng thử lại.",
      groupDelete: "Không xoá được nhóm. Nhóm vẫn còn — vui lòng thử lại.",
      memberDecide: "Không xử lý được yêu cầu tham gia. Vui lòng thử lại.",
      memberRole: "Không đổi được vai trò. Vui lòng thử lại.",
      memberRemove: "Không mời được thành viên ra khỏi nhóm. Vui lòng thử lại.",
    },
    /**
     * S16-SOCIAL-FE-2B — lý do CỤ THỂ (thắng `forbidden`/`generic`). Đọc từ `error.code` SOCIAL
     * (S16-SOCIAL-GROUPERR-1); với API cũ chưa redeploy thì từ tiền tố `message` + ngữ cảnh route
     * (nhánh LEGACY-PREFIX của `groups/lib/group-errors.ts`).
     */
    reason: {
      lastOwner:
        "Nhóm phải luôn còn ít nhất một chủ nhóm. Hãy phong một thành viên khác làm Chủ nhóm trước — hoặc xoá nhóm nếu không còn cần.",
      alreadyMember: "Bạn đã là thành viên hoặc đã gửi yêu cầu vào nhóm này.",
      stateChanged:
        "Trạng thái vừa thay đổi (có thể người khác đã xử lý trước). Dữ liệu đã được tải lại.",
      groupGone: "Không tìm thấy nhóm.",
      nameTaken: "Tên nhóm này đã được dùng trong công ty. Hãy chọn tên khác.",
      // S16-SOCIAL-FE-2C — lời vinh danh (`kudos/lib/kudos-errors.ts`).
      kudosCreateDenied: "Bạn không có quyền gửi lời vinh danh.",
      kudosOfficialDenied:
        "Bạn không có quyền gửi vinh danh CHÍNH THỨC. Bỏ chọn «Vinh danh chính thức» rồi gửi lại.",
      kudosSelf: "Không thể tự vinh danh chính mình. Hãy bỏ bạn khỏi danh sách người nhận.",
      kudosRecipientLimit: "Mỗi lời vinh danh cần từ 1 đến 10 người nhận.",
      kudosRecipientInvalid:
        "Có người nhận không còn hợp lệ (hồ sơ đã bị xoá). Hãy bỏ người đó rồi gửi lại.",
      kudosBadgeInvalid:
        "Huy hiệu vừa chọn không còn dùng được. Danh sách huy hiệu đã được tải lại — hãy chọn lại.",
      // S16-SOCIAL-FEMODERRMSG-1 — 404 `SOCIAL-ERR-001` khi thả cảm xúc/lưu/kiểm duyệt/xoá bài
      // (`feed/lib/feed-errors.ts`). MỘT câu cho cả «đã xoá» lẫn «không còn được xem» — cùng luật
      // chống-oracle của `detail.notFoundBody`.
      postGone:
        "Bài viết này không còn: có thể đã bị xoá hoặc bạn không còn quyền xem. Dữ liệu đã được tải lại.",
    },
    dismiss: "Đóng thông báo",
  },
} as const;

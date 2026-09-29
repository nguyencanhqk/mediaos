/**
 * S16-SOCIAL-FE-2B — chuỗi màn Nhóm (SOC-SCREEN-006), gắn vào namespace `social` dưới khoá `groups`
 * (xem `social.ts`). Tách file riêng để `social.ts` không phình quá trần (CLAUDE.md §5).
 *
 * ┌─ 🔴 CHỮ CỦA MÀN 404 PHẢI TRUNG TÍNH (done_when #2 · plan D8) ─────────────────────────────────┐
 * │ `notFound.*` KHÔNG nhắc «quyền», «riêng tư», «đã xoá»: server trả CÙNG một 404 cho nhóm không  │
 * │ tồn tại · đã xoá · kín mà bạn không thuộc. Chữ nào phân biệt ba ca đó là biến màn 404 thành     │
 * │ oracle dò nhóm kín. Cũng vì vậy KHÔNG dùng lại `detail.notFoundBody` («…không còn quyền xem»).  │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Lỗi của các thao tác ghi KHÔNG ở đây: chúng đi qua `ActionErrorBanner` ⇒ `actionError.*` của
 * `social.ts` (một bộ khoá lỗi cho cả module).
 */
export default {
  role: {
    owner: "Chủ nhóm",
    admin: "Quản trị viên",
    member: "Thành viên",
  },
  visibility: {
    public: "Công khai",
    private: "Riêng tư",
  },
  memberCount_one: "{{count}} thành viên",
  memberCount_other: "{{count}} thành viên",

  list: {
    title: "Nhóm",
    tabsAria: "Lọc danh sách nhóm",
    tabAll: "Tất cả",
    tabMine: "Nhóm của tôi",
    searchLabel: "Tìm nhóm theo tên",
    searchPlaceholder: "Tìm theo tên nhóm…",
    searchSubmit: "Tìm",
    create: "Tạo nhóm",
    loadingAria: "Đang tải danh sách nhóm",
    errorTitle: "Không tải được danh sách nhóm",
    // BA câu rỗng khác nhau — cùng luật `empty.*` của bảng tin: nói sai lý do là đẩy người dùng đi sửa nhầm.
    emptyAll: "Chưa có nhóm nào. Hãy tạo nhóm đầu tiên.",
    emptyMine: "Bạn chưa tham gia nhóm nào.",
    emptySearch: "Không tìm thấy nhóm nào khớp «{{q}}».",
    joined: "Đã tham gia",
    pending: "Đang chờ duyệt",
  },

  actions: {
    join: "Tham gia",
    requestJoin: "Gửi yêu cầu tham gia",
    cancelRequest: "Huỷ yêu cầu",
    leave: "Rời nhóm",
    working: "Đang xử lý…",
    cancel: "Huỷ",
    copyInvite: "Sao chép link mời",
    copied: "Đã sao chép link mời.",
    copyFallback: "Không sao chép tự động được — hãy tự sao chép link dưới đây.",
    copyFallbackLabel: "Link mời vào nhóm",
    leaveConfirmTitle: "Rời nhóm «{{name}}»?",
    leaveConfirmBody:
      "Bạn sẽ không còn đăng bài trong nhóm. Với nhóm riêng tư, bạn cũng không còn xem được bài viết của nhóm.",
    publicNonMemberHint: "Tham gia nhóm để đăng bài.",
  },

  create: {
    title: "Tạo nhóm",
    name: "Tên nhóm",
    nameRequired: "Hãy nhập tên nhóm.",
    nameTooLong: "Tên nhóm tối đa {{max}} ký tự.",
    description: "Mô tả (không bắt buộc)",
    descriptionTooLong: "Mô tả tối đa {{max}} ký tự.",
    visibility: "Chế độ",
    visibilityPublicHint: "Ai trong công ty cũng xem được bài và tự tham gia được.",
    visibilityPrivateHint:
      "Chỉ thành viên xem được bài. Người ngoài cần link mời và được duyệt mới vào được.",
    submit: "Tạo nhóm",
    submitting: "Đang tạo…",
  },

  page: {
    tabsAria: "Các mục của nhóm",
    tabPosts: "Bài viết",
    tabMembers: "Thành viên",
    tabRequests: "Yêu cầu tham gia",
    tabSettings: "Cài đặt",
    myRole: "Vai trò của bạn: {{role}}",
    loadingAria: "Đang tải nhóm",
    errorTitle: "Không tải được nhóm",
    refreshError: "Không làm mới được thông tin nhóm — đang hiện dữ liệu gần nhất.",
    manageViewer:
      "Bạn đang xem nhóm riêng tư này với quyền quản trị. Bài viết của nhóm chỉ hiển thị với thành viên.",
    emptyPosts: "Nhóm chưa có bài viết nào.",
    emptyPostsCanPost: "Nhóm chưa có bài viết nào — hãy là người đầu tiên chia sẻ.",
    backToList: "Về danh sách nhóm",
  },

  notFound: {
    title: "Không tìm thấy nhóm",
    body: "Đường dẫn có thể đã sai, hoặc nhóm này không còn.",
    inviteBody: "Nếu bạn được mời vào nhóm này, hãy gửi yêu cầu tham gia để chủ nhóm duyệt.",
    inviteSubmit: "Gửi yêu cầu tham gia",
    inviteSent: "Đã gửi yêu cầu tham gia. Bạn sẽ nhận thông báo khi được duyệt.",
  },

  members: {
    loadingAria: "Đang tải danh sách thành viên",
    errorTitle: "Không tải được danh sách thành viên",
    empty: "Chưa có thành viên nào.",
    unknownName: "Người dùng",
    you: "(bạn)",
    joinedAt: "Tham gia {{when}}",
    roleSelectLabel: "Vai trò của {{name}}",
    remove: "Mời ra",
    removeConfirmTitle: "Mời {{name}} ra khỏi nhóm?",
    removeConfirmBody: "Người này sẽ không còn là thành viên của nhóm.",
    transferHint:
      "Để chuyển quyền chủ nhóm: phong một thành viên làm Chủ nhóm, rồi đổi vai trò của chính bạn.",
  },

  requests: {
    loadingAria: "Đang tải yêu cầu tham gia",
    errorTitle: "Không tải được yêu cầu tham gia",
    empty: "Không có yêu cầu tham gia nào đang chờ.",
    approve: "Duyệt",
    reject: "Từ chối",
    rejectConfirmTitle: "Từ chối yêu cầu của {{name}}?",
    rejectConfirmBody: "Người này có thể gửi lại yêu cầu sau.",
  },

  settings: {
    title: "Thông tin nhóm",
    save: "Lưu thay đổi",
    saving: "Đang lưu…",
    saved: "Đã lưu thay đổi.",
    toPrivateNote: "Chuyển sang riêng tư: người ngoài nhóm sẽ không còn xem được bài viết của nhóm.",
    toPublicNote: "Chuyển sang công khai: các yêu cầu đang chờ vẫn cần được duyệt.",
    dangerTitle: "Xoá nhóm",
    dangerBody: "Không thể khôi phục nhóm sau khi xoá. Bài viết trong nhóm sẽ không còn hiển thị.",
    delete: "Xoá nhóm",
    deleteConfirmTitle: "Xoá nhóm «{{name}}»?",
  },

  widget: {
    title: "Nhóm của tôi",
    viewAll: "Xem tất cả",
    empty: "Bạn chưa tham gia nhóm nào.",
  },
} as const;

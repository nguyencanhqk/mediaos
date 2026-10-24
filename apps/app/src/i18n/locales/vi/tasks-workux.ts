/**
 * i18n (vi) — khoá MỚI của namespace "tasks" cho đợt S20-WORKUX (drawer việc toàn cục, bộ lọc trên
 * URL). Tách khỏi `tasks.ts` (đã quá 800 dòng) và trộn vào cùng namespace ở `i18n/index.ts` — khoá
 * gốc ở đây KHÔNG được trùng khoá gốc của `tasks.ts` (phép trộn là spread nông).
 */
export default {
  // S20-TASK-DRAWER-1 — một thông điệp DUY NHẤT cho mọi ca không mở được (`?task=` rác, việc không
  // tồn tại, đã xoá mềm, ngoài phạm vi đọc): không phân biệt để không lộ việc nào có thật.
  taskDrawer: {
    unavailable: "Không mở được việc này",
    // Tiêu đề drawer khi tải lỗi ngoài nhóm từ chối (5xx/mạng) — không lộ tiêu đề/mã việc.
    loadFailed: "Lỗi khi tải công việc",
  },
  // S20-TASK-DRAWER-1 (US-TASK-QL-05) — bộ lọc Danh sách trên URL: ô tìm, chip «Của tôi», phòng ban.
  listFilters: {
    searchLabel: "Tìm công việc",
    searchPlaceholder: "Tìm theo tiêu đề… (phím /)",
    mine: "Của tôi",
    mineUnlinked: "Tài khoản của bạn chưa gắn hồ sơ nhân viên.",
    mineFailed: "Không tải được thông tin của bạn. Vui lòng thử lại.",
    department: "Phòng ban",
    allDepartments: "Tất cả phòng ban",
    clear: "Xoá bộ lọc",
    emptyFiltered: {
      title: "Không có công việc khớp bộ lọc",
      description: "Thử đổi từ khoá hoặc xoá bộ lọc để xem lại toàn bộ.",
    },
  },
  // S20-TASK-QUICKENTRY-1 (US-TASK-NV-10/11) — nhập bằng bàn phím ở chi tiết việc.
  quickEntry: {
    checklist: {
      inputLabel: "Thêm mục",
      placeholder: "Thêm mục… (Enter để thêm · dán nhiều dòng = nhiều mục)",
      submit: "Thêm vào checklist",
      // Tên nhóm tạo tự động khi việc chưa có checklist nào.
      defaultTitle: "Checklist",
      pendingCount: "Enter để thêm {{count}} mục",
      tooMany: "Tối đa {{max}} mục mỗi lần — hiện có {{count}} dòng.",
      tooLong: "Mỗi mục tối đa {{max}} ký tự — dòng {{line}} có {{length}} ký tự.",
    },
    subtasks: {
      inputLabel: "Tiêu đề việc con",
      placeholder: "Nhập tiêu đề rồi Enter… (Esc để đóng)",
    },
    comments: {
      shortcutHint: "Ctrl/⌘+Enter để gửi · Enter để xuống dòng",
      mentionOutOfScope: "Người được nhắc không có quyền xem công việc này — bỏ nhắc rồi gửi lại.",
      mentionNotFound: "Không tìm thấy người được nhắc hoặc người đó đã ngưng hoạt động.",
    },
  },
  // S20-TASK-MYTASKS-1 (US-TASK-NV-01) — «Việc của tôi» chia nhóm theo hạn (giờ công ty), chip trên URL.
  myTasks: {
    groups: {
      overdue: "Quá hạn",
      today: "Hôm nay",
      upcoming: "Sắp đến hạn",
      inProgress: "Đang làm",
      inReview: "Chờ kiểm tra",
      other: "Khác",
      done: "Đã xong",
    },
    groupFilterLabel: "Lọc theo nhóm",
    allGroups: "Tất cả nhóm",
    sourceFilterLabel: "Lọc theo nguồn",
    allSources: "Tất cả nguồn",
    sources: { assigned: "Được giao", created: "Tôi tạo", watched: "Theo dõi" },
    showDone: "Hiện việc đã xong",
    quickFilterLabel: "Lọc nhanh theo tiêu đề",
    quickFilterPlaceholder: "Lọc nhanh theo tiêu đề… (phím /)",
    due: "Hạn {{value}}",
    empty: {
      title: "Bạn chưa có công việc nào",
      description:
        "Việc được giao cho bạn, do bạn tạo hoặc bạn theo dõi sẽ hiện ở đây. Nếu đã được giao việc mà vẫn không thấy, hãy nhờ bộ phận nhân sự kiểm tra tài khoản đã liên kết với hồ sơ nhân viên chưa.",
    },
    emptyFiltered: {
      title: "Không có việc khớp bộ lọc",
      description: "Thử chọn nguồn hoặc nhóm khác, xoá ô lọc nhanh, hoặc bật «Hiện việc đã xong».",
      clear: "Xoá bộ lọc",
    },
  },
  // S20-TASK-BOARDMOVE-1 (US-TASK-NV-91) — menu ⋯ đổi cột trên thẻ board (điện thoại · bàn phím).
  kanbanMove: {
    trigger: "Chuyển việc «{{title}}» sang cột khác",
    heading: "Chuyển sang cột…",
    noTargets: "Không còn cột nào khác để chuyển.",
  },
  // S20-TASK-ASSIGNWARN-1 (US-TASK-QL-91) — cảnh báo sau khi giao (`warnings[]` của route action).
  // ON-LEAVE = đơn nghỉ đã duyệt trùng NGÀY HẠN của việc (task-actions.service) — không phải «đang nghỉ».
  assigneeWarning: {
    onLeave: "{{name}} nghỉ phép vào ngày hạn của việc",
    onLeaveUntil: "{{name}} nghỉ phép vào ngày hạn của việc (nghỉ đến {{until}})",
    notMember: "{{name}} không phải thành viên dự án",
    // Ý thứ hai trở đi của câu gộp — KHÔNG chủ ngữ (tên chỉ nêu ở ý đầu), khoá riêng thay vì truyền
    // name rỗng rồi trim (chỉ đúng khi mọi bản dịch mở đầu bằng {{name}}).
    continued: {
      onLeave: "nghỉ phép vào ngày hạn của việc",
      onLeaveUntil: "nghỉ phép vào ngày hạn của việc (nghỉ đến {{until}})",
      notMember: "không phải thành viên dự án",
    },
    fallbackName: "Người được giao",
    changeAssignee: "Đổi người",
  },
};

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
      // S20-TASK-FEDEBT-1 — nhãn listbox gợi ý @ (đọc cùng mục đang sáng qua aria-activedescendant).
      mentionListLabel: "Gợi ý người để nhắc",
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
  // S20-SEC-TASKPATCHGATE-1 — ô của form Sửa bị khoá vì thiếu cặp quyền chuyên trách của trường đó.
  fieldGate: {
    locked: "Bạn không có quyền đổi mục này.",
  },
  // S20-SEC-GOALNAMEDTO-1 — việc gắn mục tiêu mà người xem không có quyền xem (server chỉ trả cờ).
  goalRef: {
    restricted: "Có mục tiêu",
    restrictedHint: "Việc này đang gắn một mục tiêu mà bạn không có quyền xem.",
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
  // S20-TASK-QUICKEDIT-1 — popover mốc hạn dùng chung (DeadlineQuickPicker). Giờ hiển thị là giờ CÔNG TY.
  deadlinePicker: {
    triggerLabel: "Chọn hạn",
    empty: "Chưa có hạn",
    setDeadline: "Đặt hạn",
    quickLabel: "Chọn nhanh",
    presetsLabel: "Mốc hạn nhanh",
    presets: {
      today: "Hôm nay {{time}}",
      tomorrow: "Ngày mai {{time}}",
      thisFriday: "Thứ Sáu này {{time}}",
      nextFriday: "Thứ Sáu tuần sau {{time}}",
      nextMonday: "Thứ Hai tuần sau {{time}}",
      // S20-TASK-OVERDUEDESK-1 — mốc riêng của trang Quá hạn, tính từ HÔM NAY (giờ công ty).
      plusOneDay: "+1 ngày {{time}}",
      plusThreeDays: "+3 ngày {{time}}",
      custom: "{{time}}",
    },
    clear: "Xoá hạn",
    custom: "Tuỳ chỉnh",
    customInputLabel: "Hạn tuỳ chỉnh (giờ công ty)",
    customApply: "Áp dụng",
    customInvalid: "Ngày giờ không hợp lệ",
  },
  // S20-TASK-QUICKEDIT-1 — đổi trạng thái / hạn ngay trên dòng danh sách.
  quickEdit: {
    statusLabel: "Đổi trạng thái: {{title}}",
    deadlineLabel: "Đổi hạn: {{title}}",
    openChecklist: "Mở checklist",
    retry: "Thử lại",
    statusSaved: "Đã chuyển «{{title}}» sang {{status}}",
    undo: "Hoàn tác",
    errors: {
      checklistRequired: "Cần hoàn tất checklist",
      dateRange: "Hạn không được sớm hơn ngày bắt đầu của việc — hãy chọn mốc muộn hơn",
      forbidden: {
        status: "Bạn không có quyền đổi trạng thái việc này",
        deadline: "Bạn không có quyền đổi hạn việc này",
        assignee: "Bạn không có quyền đổi người phụ trách việc này",
      },
      closed: "Việc đã huỷ — không đổi được hạn",
      conflict: "Không chuyển được sang trạng thái này — việc vừa thay đổi, hãy tải lại",
      network: "Mất kết nối — thay đổi chưa được lưu",
      generic: "Không lưu được thay đổi. Vui lòng thử lại.",
    },
  },
  // S20-TASK-QUICKADD-1 (US-TASK-NV-05 · US-TASK-QL-06) — tạo việc một dòng («Việc của tôi» + board),
  // chip Người/Hạn giữ cho lượt sau; form Tạo mặc định «Tôi»; «Tạo công việc» trên board.
  quickAdd: {
    placeholder: "Thêm việc cho tôi rồi Enter… (phím n)",
    hint: "Enter để tạo · chip hạn được giữ cho việc kế tiếp",
    loading: "Đang tải thông tin của bạn…",
    unlinked:
      "Tài khoản của bạn chưa liên kết hồ sơ nhân viên nên chưa tạo nhanh được. Hãy nhờ bộ phận nhân sự liên kết.",
    meFailed: "Không tải được thông tin của bạn nên chưa tạo nhanh được. Tải lại trang để thử lại.",
    createButton: "Tạo việc",
    boardCreateButton: "Tạo công việc",
    assigneeChip: "Người",
    deadlineChip: "Hạn của việc sắp tạo",
    errors: {
      titleRequired: "Nhập tên công việc trước khi Enter",
      titleTooLong: "Tên công việc tối đa {{max}} ký tự",
      assignee: "Không giao được cho người này",
      forbidden: "Bạn không có quyền tạo công việc ở đây.",
      badRequest: "Không tạo được — kiểm tra lại tên công việc, hạn hoặc cột.",
      network: "Mất kết nối — chưa tạo được việc. Vui lòng thử lại.",
      generic: "Không tạo được công việc. Vui lòng thử lại.",
    },
    form: {
      me: "Tôi",
      meNamed: "Tôi ({{name}})",
      currentProject: "Dự án này",
      assigneeOutOfScope: "Hãy chọn người phụ trách trong phạm vi của bạn",
      titleTooLong: "Tiêu đề tối đa 500 ký tự",
    },
  },
  // S20-TASK-OVERDUEDESK-1 (US-TASK-QL-07) — trang Việc quá hạn thành bàn xử lý.
  overdueDesk: {
    lateColumn: "Trễ",
    lateDays: "{{days}} ngày",
    lateUnderDay: "Dưới 1 ngày",
    filters: {
      project: "Dự án",
      allProjects: "Tất cả dự án",
      noProject: "Không thuộc dự án",
      assignee: "Người phụ trách",
      allAssignees: "Tất cả người",
      unassigned: "Chưa giao",
      mine: "Tôi giao",
      clear: "Xoá bộ lọc",
    },
    emptyMine: {
      title: "Không có việc trễ trong số việc bạn giao",
      description: "Việc bạn tạo hoặc giao cho người khác đều đang đúng hạn.",
    },
    emptyFiltered: {
      title: "Không có việc trễ khớp bộ lọc",
      description: "Thử chọn dự án hoặc người khác, hoặc xoá bộ lọc để xem lại toàn bộ.",
    },
  },
};

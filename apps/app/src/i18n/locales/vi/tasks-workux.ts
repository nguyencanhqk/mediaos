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
};

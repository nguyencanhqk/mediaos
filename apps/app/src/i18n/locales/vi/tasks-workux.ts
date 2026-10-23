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
  },
};

/**
 * Namespace "notifications" (vi) — chuông thông báo là chrome dùng chung mọi app (FS-5). Đặt ở
 * @mediaos/web-core (TS module, nhúng đồng bộ vào CORE_RESOURCES như common/nav/auth) → mọi app
 * (kể cả people/console không có feature chat) có sẵn chuỗi mà không phải đăng ký riêng. Trước đây
 * các khoá này nằm trong namespace `chat` của apps/{web,studio} → tách ra để chuông không kéo theo ns chat.
 */
export default {
  title: "Thông báo",
  ariaLabel: "Thông báo",
  markAllRead: "Đọc tất cả",
  empty: "Không có thông báo",
  types: {
    task_assigned: "Giao việc",
    task_submitted: "Nộp việc",
    approval_requested: "Yêu cầu duyệt",
    approved: "Đã duyệt",
    revision_requested: "Trả sửa",
    mentioned: "Nhắc đến",
    general: "Thông báo",
  },
};

/**
 * S16-SOCIAL-FE-3 — chuỗi của cụm QUẢN TRỊ bảng tin (Kiểm duyệt `SOC-SCREEN-010` · Thống kê
 * `SOC-SCREEN-011` · Thiết lập huy hiệu `SOC-SCREEN-012`) và hộp thoại «Báo cáo», gắn vào namespace
 * `social` dưới khoá `admin` (xem `social.ts`). Tách file như `social-groups.ts`/`social-kudos.ts` để
 * `social.ts` không phình quá trần (CLAUDE.md §5); các lát sau của WO chỉ nối vào file NÀY.
 *
 * ┌─ `error.*` — MỖI REASON MỘT CÂU, NÓI LÝ DO ───────────────────────────────────────────────────┐
 * │ Khoá = đúng một phần tử của `ADMIN_ERROR_REASONS` (`routes/social/admin/lib/admin-errors.ts`). │
 * │ Spec của `AdminErrorNotice` lặp toàn bộ tập đó với i18n thật và đòi các câu KHÁC nhau từng đôi │
 * │ — thêm reason mà quên câu, hoặc dùng chung một câu «có lỗi xảy ra», là đỏ.                     │
 * │ Câu là chữ của FE: KHÔNG bao giờ chèn `message` của server (nó có thể mang mã nội bộ).         │
 * │ Câu nào hứa «thử lại» thì lỗi đó phải thật sự thử lại được (`reportBusy` · `busy` · `generic`);│
 * │ lỗi kết cục (`reportAlreadyDecided` · `forbidden`…) KHÔNG mời thử lại.                         │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export default {
  notice: {
    retry: "Thử lại",
    dismiss: "Đóng thông báo",
  },
  error: {
    // ── Dùng chung mọi lời gọi của cụm quản trị ──
    generic: "Không thực hiện được do lỗi hệ thống hoặc kết nối. Vui lòng thử lại.",
    forbidden:
      "Bạn không có quyền thực hiện thao tác này. Nếu cần, hãy liên hệ quản trị viên để được cấp quyền.",
    invalidRequest:
      "Yêu cầu không hợp lệ nên chưa được thực hiện. Hãy kiểm tra lại thông tin đã nhập.",
    busy: "Yêu cầu trước của bạn vẫn đang được xử lý. Vui lòng chờ giây lát rồi thử lại.",
    // ── 029 — kết thúc báo cáo ──
    reportAlreadyDecided:
      "Báo cáo này đã được xử lý bởi người khác trước khi bạn xác nhận. Danh sách đã được làm mới.",
    reportBusy: "Báo cáo này đang được người khác xử lý. Vui lòng thử lại sau giây lát.",
    reportActionDenied:
      "Bạn không có quyền thực hiện hành động kèm đã chọn. Bạn vẫn có thể kết thúc báo cáo mà không kèm hành động.",
    reportActionInvalid:
      "Hành động đã chọn không áp dụng được cho loại nội dung bị báo cáo. Hãy chọn hành động khác.",
    reportTargetUnavailable:
      "Nội dung bị báo cáo không còn thao tác được (có thể đã bị xoá). Hãy kết thúc báo cáo mà không kèm hành động.",
    reportGone:
      "Không tìm thấy báo cáo này — có thể nó không còn trong phạm vi của bạn. Danh sách đã được làm mới.",
    // ── 006 — hiện lại bài đang ẩn ──
    postGone: "Bài viết này không còn tồn tại nên không thể hiện lại. Danh sách đã được làm mới.",
    // ── 027 — gửi báo cáo ──
    reportDuplicate: "Bạn đã báo cáo nội dung này và báo cáo đó đang chờ xử lý. Không cần gửi lại.",
    reportTargetGone: "Nội dung bạn muốn báo cáo không còn tồn tại hoặc bạn không còn xem được.",
  },
  // ── Kiểm duyệt `SOC-SCREEN-010` ──
  moderation: {
    /**
     * Hành động kèm khi kết thúc báo cáo (029). Khoá đi theo `moderation/lib/report-actions.ts`
     * (`REPORT_ACTION_LABEL_KEYS`): MỖI loại đích một bộ nhãn riêng — cùng hành động `lock_comments` /
     * `delete_target` nhưng tác động lên thứ KHÁC nhau (bài ↔ bài chứa bình luận ↔ chính bình luận),
     * dùng chung một nhãn là người kiểm duyệt xoá/khoá nhầm đối tượng. Đích `comment` KHÔNG có `hide_post`.
     */
    action: {
      none: "Không kèm hành động",
      post: {
        hide_post: "Ẩn bài",
        lock_comments: "Khoá bình luận của bài",
        delete_target: "Xoá bài",
      },
      comment: {
        lock_comments: "Khoá bình luận của bài chứa bình luận này",
        delete_target: "Xoá bình luận này",
      },
    },
    /** Chữ ô tick BẮT BUỘC trước khi gửi `delete_target` — nói rõ xoá CÁI GÌ và chưa khôi phục được. */
    deleteConfirm: {
      post: "Tôi hiểu bài sẽ bị xoá; hiện chưa có màn khôi phục",
      comment: "Tôi hiểu bình luận sẽ bị xoá; hiện chưa có màn khôi phục",
    },
  },
};

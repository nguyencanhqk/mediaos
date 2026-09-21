/**
 * S16-SOCIAL-BE-1 — mã lỗi SOCIAL (SPEC-16 §12, quy ước SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * MỘT CHỖ duy nhất định nghĩa thông điệp ⇒ int-spec assert theo MÃ, không theo câu chữ.
 *
 * ┌─ `POST_NOT_FOUND` / `COMMENT_NOT_FOUND` LÀ HẰNG, KHÔNG PHẢI HÀM ───────────────────────────────┐
 * │ Mọi lý do "không đọc được bài" — không tồn tại · tenant khác · đã xoá mềm · `hidden` mà mình     │
 * │ không phải tác giả · `audience='org_unit'` của đơn vị khác — PHẢI trả về CHUỖI GIỐNG HỆT NHAU.  │
 * │ Thêm chi tiết, dù chỉ là `postId`, là biến 404 thành oracle dò đúng thứ `SOCIAL-ERR-001` dựng    │
 * │ lên để chặn (SPEC-16 §12 «404 trước 403», khuôn `CHAT_ERR.ROOM_NOT_FOUND`).                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `SOCIAL-ERR-002` (403) **CHỈ dùng cho nhánh GHI** — đăng bài/bình luận vào `org_unit`/`group` mà
 * actor tự chọn nhưng không thuộc. Nhánh ĐỌC KHÔNG BAO GIỜ trả mã này (403 ở nhánh đọc xác nhận đối
 * tượng có thật ⇒ rò sự tồn tại). SPEC-16 §12 ghi thẳng luật này dưới bảng mã.
 *
 * ⚠️ `SOCIAL-ERR-009` KHÔNG phải lỗi HTTP: mention ngoài audience bị bỏ im lặng, request vẫn 201 và
 * danh sách bị bỏ trả ở `data.droppedMentions[]`. Hằng dưới đây chỉ để log/tài liệu — KHÔNG được ném.
 *
 * 22 mã của catalog SOCIAL: `001..010` dùng ở Nhóm A (WO này); `011`,`021` thuộc `S16-SOCIAL-BE-1B`;
 * `012..020`,`022` thuộc `S16-SOCIAL-BE-2`. Khai đủ ở đây để BE-1B/BE-2 không đẻ bảng mã thứ hai.
 */
export const SOCIAL_ERR = {
  /**
   * `SOCIAL-ERR-001` (404) — bài lạ. KHÔNG phân biệt "không tồn tại" · "đã xoá mềm" · "hidden mà
   * mình không phải tác giả" · "org_unit khác". Một chuỗi cho mọi lý do.
   */
  POST_NOT_FOUND: "SOCIAL-ERR-001: không tìm thấy bài viết.",

  /** `SOCIAL-ERR-001` — cùng luật, trục BÌNH LUẬN (bình luận lạ, hoặc bài chứa nó không thấy được). */
  COMMENT_NOT_FOUND: "SOCIAL-ERR-001: không tìm thấy bình luận.",

  /**
   * `SOCIAL-ERR-002` (403) — CHỈ NHÁNH GHI: đăng vào đơn vị/nhóm mình không thuộc. Actor tự chọn đích
   * nên đã biết nó tồn tại ⇒ 403 không rò gì thêm.
   */
  WRITE_OUT_OF_AUDIENCE:
    "SOCIAL-ERR-002: không đăng được vào đơn vị hoặc nhóm mà bạn không thuộc về.",

  /** `SOCIAL-ERR-003` (403) — sửa/xoá nội dung của người khác mà không có `manage:feed-post`. */
  NOT_CONTENT_OWNER:
    "SOCIAL-ERR-003: chỉ tác giả hoặc người có quyền quản lý bài viết mới sửa/xoá được nội dung này.",

  /** `SOCIAL-ERR-004` (409) — bài đã khoá bình luận. */
  COMMENTS_LOCKED: "SOCIAL-ERR-004: bài viết này đã khoá bình luận.",

  /** `SOCIAL-ERR-005` (422) — trả lời quá 1 cấp (SPEC-16 §13.2). */
  REPLY_DEPTH: "SOCIAL-ERR-005: chỉ trả lời được vào bình luận gốc (tối đa 1 cấp).",

  /** `SOCIAL-ERR-006` (422) — emoji ngoài bộ dùng chung với CHAT. */
  REACTION_EMOJI_INVALID: "SOCIAL-ERR-006: biểu tượng cảm xúc không nằm trong bộ cho phép.",

  /** `SOCIAL-ERR-007` (422) — vượt giới hạn đính kèm SPEC-16 §16. */
  ATTACHMENT_LIMIT:
    "SOCIAL-ERR-007: đính kèm vượt giới hạn — tối đa 10 ảnh, 1 video, mỗi tệp không quá 20MB.",

  /** `SOCIAL-ERR-007` — tệp không hợp lệ: không tồn tại, của tenant khác, hoặc không phải bạn tải lên. */
  ATTACHMENT_INVALID:
    "SOCIAL-ERR-007: tệp đính kèm không hợp lệ — chỉ đính kèm được tệp do chính bạn tải lên.",

  /** `SOCIAL-ERR-008` (422) — audience thiếu khoá kéo theo. */
  AUDIENCE_KEY_MISSING: "SOCIAL-ERR-008: phạm vi hiển thị thiếu khoá tương ứng (đơn vị hoặc nhóm).",

  /**
   * `SOCIAL-ERR-008` (422) — `audience='group'` CHƯA MỞ ở BE-1 (plan §2 D1, owner chốt 21/09/2026).
   *
   * Từ chối tường minh thay vì im lặng bỏ qua: `feed_groups` chưa có route tạo nhóm nào nên bộ lọc
   * EXISTS membership không test được thật, và một nhánh "coi như company" sẽ phát bài đáng lẽ riêng
   * tư ra cả công ty.
   */
  AUDIENCE_GROUP_NOT_AVAILABLE:
    "SOCIAL-ERR-008: đăng bài vào nhóm chưa khả dụng — tính năng nhóm sẽ mở ở bản cập nhật sau.",

  /**
   * `SOCIAL-ERR-009` — **KHÔNG BAO GIỜ NÉM.** Giữ chỗ để census mã lỗi không báo thiếu, và để ai đọc
   * file này thấy ngay rằng mention-bị-bỏ là kết quả 201 kèm `droppedMentions[]`, không phải lỗi.
   */
  MENTION_DROPPED_NOT_AN_ERROR:
    "SOCIAL-ERR-009: (không phải lỗi) một số lượt nhắc tên bị bỏ vì người được nhắc ngoài phạm vi hiển thị.",

  /** `SOCIAL-ERR-010` (403) — tạo/ghim tin tức mà không có `manage:feed-news`. */
  NEWS_MANAGE_REQUIRED:
    "SOCIAL-ERR-010: cần quyền quản lý tin tức để đăng hoặc ghim tin tức công ty.",

  /** `SOCIAL-ERR-010` (403) — đổi trường kiểm duyệt cụ thể mà thiếu cặp quyền của TRƯỜNG đó. */
  MODERATION_FIELD_DENIED: "SOCIAL-ERR-010: bạn không có quyền thay đổi trường kiểm duyệt này.",

  // ── Nhóm B (`S16-SOCIAL-BE-1B`) — khai sẵn, KHÔNG dùng ở WO này ──
  /** `SOCIAL-ERR-011` (409) — xác nhận đã đọc một bài không phải tin tức / không bật yêu cầu ack. */
  ACK_NOT_APPLICABLE: "SOCIAL-ERR-011: bài viết này không yêu cầu xác nhận đã đọc.",
  /** `SOCIAL-ERR-021` (409) — xử lý một báo cáo đã kết thúc. */
  REPORT_ALREADY_DECIDED: "SOCIAL-ERR-021: báo cáo này đã được xử lý.",
} as const;

export type SocialErrorMessage = (typeof SOCIAL_ERR)[keyof typeof SOCIAL_ERR];

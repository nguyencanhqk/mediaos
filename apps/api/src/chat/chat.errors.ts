/**
 * S7-CHAT-BE-1 — mã lỗi CHAT (SPEC-15 §12, quy ước SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * MỘT CHỖ duy nhất định nghĩa thông điệp ⇒ int-spec assert theo MÃ, không theo câu chữ.
 *
 * ⚠️ `ROOM_NOT_FOUND` là HẰNG, không phải hàm: mọi lý do "không đọc được phòng" (không tồn tại · tenant
 * khác · đã xoá mềm · mình không phải thành viên · mình đã rời) PHẢI trả về CHUỖI GIỐNG HỆT NHAU. Thêm
 * chi tiết vào thông điệp — dù chỉ là roomId — là biến 404 trở lại thành oracle dò đúng thứ CHAT-ERR-001
 * dựng nó để chặn.
 */
export const CHAT_ERR = {
  /**
   * CHAT-ERR-001 (vế 404) — phòng lạ. KHÔNG phân biệt "không tồn tại" với "không phải thành viên".
   */
  ROOM_NOT_FOUND: "CHAT-ERR-001: không tìm thấy phòng chat.",

  /**
   * CHAT-ERR-001 (vế 403) — ĐÃ là thành viên nhưng thiếu vai trò quản trị phòng. 403 ở đây KHÔNG lộ gì
   * thêm: người gọi vốn đã biết phòng tồn tại.
   */
  NOT_ROOM_ADMIN: "CHAT-ERR-001: chỉ quản trị viên của phòng mới thực hiện được thao tác này.",

  /** CHAT-ERR-002 — chỉ tạo được phòng `group` qua CHAT-API-002. */
  CREATE_TYPE:
    "CHAT-ERR-002: chỉ tạo được phòng nhóm qua đường này — chat riêng dùng POST /chat/rooms/direct, phòng ban/dự án do hệ thống tự dựng.",

  /** CHAT-ERR-003 — mở DM với chính mình. */
  DIRECT_SELF: "CHAT-ERR-003: không mở được phòng chat riêng với chính mình.",

  /**
   * CHAT-ERR-003 — người dùng không hợp lệ: không cùng công ty, không tồn tại, hoặc đã bị khoá/xoá.
   *
   * SPEC-15 §12 viết mã này cho đường DM; dùng lại cho `memberUserIds` của phòng nhóm là ĐÚNG NGHĨA
   * ("user không cùng company, hoặc user đã bị khoá/nghỉ việc") và tránh đẻ mã ngoài sổ. Thông điệp
   * KHÔNG kèm userId — id do client gửi lên, echo lại thì vô hại, nhưng giữ thói quen không echo.
   */
  USER_INVALID:
    "CHAT-ERR-003: người dùng không hợp lệ — phải là tài khoản đang hoạt động trong cùng công ty.",

  /** CHAT-ERR-005 — phòng đã lưu trữ thì CHỈ ĐỌC (không sửa tên, không đổi thành viên). */
  ROOM_ARCHIVED:
    "CHAT-ERR-005: phòng đã lưu trữ — chỉ đọc, không thay đổi được thông tin hay thành viên.",

  /** CHAT-ERR-005 — lưu trữ một phòng vốn đã lưu trữ. */
  ALREADY_ARCHIVED: "CHAT-ERR-005: phòng này đã được lưu trữ trước đó.",

  /** CHAT-ERR-011 — thêm người đã là thành viên đang hoạt động. */
  MEMBER_EXISTS: "CHAT-ERR-011: người này đã là thành viên của phòng.",

  /**
   * CHAT-ERR-011 — bớt/hạ cấp/để-rời người quản trị CUỐI CÙNG khi phòng còn thành viên khác. Phòng nhóm
   * không có admin thì không ai thêm/bớt được nữa — hỏng vĩnh viễn, không có đường sửa qua API.
   */
  LAST_ADMIN:
    "CHAT-ERR-011: đây là quản trị viên cuối cùng của phòng — chỉ định người khác làm quản trị trước.",

  /**
   * CHAT-ERR-012 — thao tác thành viên THỦ CÔNG chỉ hợp lệ ở phòng `group` (SPEC-15 §3.1: chỉ `group`
   * có cơ chế thành viên thủ công). `department`/`project` là thành viên DẪN XUẤT — sửa ở HR/TASK;
   * `direct` cố định đúng 2 người.
   */
  MANUAL_MEMBER_BLOCKED: (roomType: string): string =>
    roomType === "direct"
      ? "CHAT-ERR-012: phòng chat riêng cố định 2 người — không thêm/bớt thành viên được."
      : `CHAT-ERR-012: phòng ${roomType} có thành viên đồng bộ tự động — thay đổi phải thực hiện ở module nguồn (HR/TASK).`,

  /** CHAT-ERR-012 — sửa tên/mô tả cũng là thao tác thủ công: chỉ phòng `group`. */
  MANUAL_EDIT_BLOCKED: (roomType: string): string =>
    roomType === "direct"
      ? "CHAT-ERR-012: phòng chat riêng không có tên để sửa."
      : `CHAT-ERR-012: phòng ${roomType} do hệ thống đồng bộ — đổi tên/mô tả phải thực hiện ở module nguồn (HR/TASK).`,

  /** CHAT-ERR-013 — chỉ rời được phòng `group` (SPEC-15 §3.1). */
  LEAVE_BLOCKED: (roomType: string): string =>
    `CHAT-ERR-013: không rời được phòng loại ${roomType} — chỉ phòng nhóm mới rời được.`,
} as const;

/**
 * Hành động audit của module (SPEC-15 §18 · API-13 hình dạng dòng audit). `object_type` LUÔN
 * `'chat_room'` (đã có sẵn trong union `AuditObjectType` — không cần migration), `module_code` = 'CHAT'.
 *
 * NỘI DUNG TIN NHẮN KHÔNG BAO GIỜ VÀO ĐÂY (SPEC-15 §18 · API-13 §6.8). WO này không chạm tin nhắn nên
 * chỉ cần giữ nguyên tắc khi mở rộng.
 */
export const CHAT_AUDIT = {
  ROOM_CREATED: "chat.room.created",
  ROOM_DIRECT_OPENED: "chat.room.direct_opened",
  ROOM_UPDATED: "chat.room.updated",
  ROOM_ARCHIVED: "chat.room.archived",
  MEMBER_ADDED: "chat.room.member_added",
  MEMBER_ROLE_CHANGED: "chat.room.member_role_changed",
  MEMBER_REMOVED: "chat.room.member_removed",
  ROOM_LEFT: "chat.room.left",
} as const;

/** `module_code` cho mọi dòng audit của CHAT — CHAT-API-019 lọc theo cột này. */
export const CHAT_MODULE_CODE = "CHAT";

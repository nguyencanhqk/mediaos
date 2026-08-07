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

  // ═══════════ S7-CHAT-BE-2 — tin nhắn ═══════════

  /**
   * CHAT-ERR-001 (trục TIN NHẮN) — HẰNG, cùng lý do với `ROOM_NOT_FOUND`: "tin không tồn tại" và "tin có
   * thật nhưng ở phòng mình không thuộc" PHẢI không phân biệt được, nếu không `messageId` trở thành trục
   * dò thứ hai bên cạnh `roomId`.
   */
  MESSAGE_NOT_FOUND: "CHAT-ERR-001: không tìm thấy tin nhắn.",

  /** CHAT-ERR-004 — thân tin rỗng / vượt trần. (Zod chặn ở biên; hằng này cho đường gọi service.) */
  BODY_INVALID:
    "CHAT-ERR-004: nội dung tin nhắn không hợp lệ — tối đa 4000 ký tự và không được rỗng.",

  /** CHAT-ERR-005 — gửi vào phòng đã lưu trữ hoặc đã xoá mềm. */
  SEND_ARCHIVED: "CHAT-ERR-005: phòng đã lưu trữ — không gửi thêm tin được.",

  /**
   * CHAT-ERR-006 — thu hồi tin người khác, hoặc quá cửa sổ thu hồi (SPEC-15 §13.6).
   * MỘT thông điệp cho cả hai vế: tách ra sẽ nói cho người ngoài biết "tin này của bạn hay không".
   */
  RECALL_DENIED: (windowMinutes: number): string =>
    `CHAT-ERR-006: chỉ người gửi (trong ${windowMinutes} phút) hoặc quản trị viên phòng nhóm mới thu hồi được tin này.`,

  /** CHAT-ERR-007 — sửa nội dung tin: KHÔNG hỗ trợ ở v1, mọi đường ghi vào `body` bị từ chối. */
  EDIT_UNSUPPORTED: "CHAT-ERR-007: không sửa được nội dung tin nhắn — thu hồi rồi gửi lại tin mới.",

  /** CHAT-ERR-008 — vượt trần ghim của phòng. */
  PIN_LIMIT: (max: number): string =>
    `CHAT-ERR-008: mỗi phòng chỉ ghim tối đa ${max} tin — bỏ ghim bớt trước.`,

  /**
   * CHAT-ERR-021 *(S8)* — vượt trần GHIM HỘI THOẠI (409, SPEC-15 §12).
   *
   * ⚠️ KHÔNG nhầm với `PIN_LIMIT` ngay trên: đó là CHAT-ERR-008, ghim **TIN** trong một phòng, trần
   * 20/phòng, mọi thành viên cùng thấy. Cái này ghim **HỘI THOẠI** lên đầu danh sách, trần 10/NGƯỜI,
   * chỉ mình thấy — khác bảng (`chat_room_members.pinned_at`), khác trần, khác phạm vi nhìn thấy.
   * SPEC-15 §12 có hẳn một ghi chú cảnh báo cặp trùng chữ "ghim" này.
   *
   * 409 (không phải 400/422) là ĐÚNG theo SPEC-15 §12: vượt hạn mức là xung đột TRẠNG THÁI — cùng dữ
   * liệu gửi lên sẽ thành công sau khi người dùng bỏ ghim bớt, nên nó không phải lỗi đầu vào.
   */
  ROOM_PIN_LIMIT: (max: number): string =>
    `CHAT-ERR-021: chỉ ghim được tối đa ${max} hội thoại — bỏ ghim bớt trước.`,

  /**
   * CHAT-ERR-024 *(S8)* — thả cảm xúc vào tin ĐÃ THU HỒI (422).
   *
   * Cùng lớp che với `body: null` của SPEC-15 §13.6: tin đã rút thì không còn nội dung để phản ứng.
   * Cho phép thả sẽ đẻ ra một thanh cảm xúc dưới một bong bóng trống — và một lối để người ta tiếp tục
   * tương tác với thứ người gửi đã chủ động thu hồi.
   *
   * 422 (không phải 404): người gọi ĐÃ đọc được tin đó, giấu thêm không che được gì.
   */
  REACTION_ON_RECALLED: "CHAT-ERR-024: không thả cảm xúc được vào tin đã thu hồi.",

  /**
   * CHAT-ERR-025 *(S8)* — emoji ngoài BỘ ĐÓNG (422).
   *
   * Hằng này là lưới cho đường gọi service; biên HTTP đã bị `chatReactionEmojiSchema` chặn trước, và
   * `chat_message_reactions_emoji_chk` ở DB là đai thứ ba. Ba lớp vì bộ emoji đóng là thứ duy nhất giữ
   * cột `emoji` khỏi trở thành bề mặt lưu trữ tự do.
   */
  REACTION_EMOJI_INVALID:
    "CHAT-ERR-025: cảm xúc không hợp lệ — chỉ dùng được bộ biểu tượng có sẵn.",

  /** CHAT-ERR-009 — trả lời tin không cùng phòng, hoặc tin đã thu hồi. */
  REPLY_INVALID:
    "CHAT-ERR-009: không trả lời được tin này — tin phải thuộc cùng phòng và chưa bị thu hồi.",

  /** CHAT-ERR-016 — con trỏ phân trang không hợp lệ. */
  CURSOR_EXCLUSIVE:
    "CHAT-ERR-016: chỉ dùng MỘT trong hai con trỏ beforeSeq hoặc afterSeq, không dùng cả hai.",

  /**
   * CHAT-ERR-016 (trục TÌM KIẾM) — con trỏ opaque của `/chat/search` hỏng.
   *
   * Hằng RIÊNG chứ không tái dùng `CURSOR_EXCLUSIVE`: mã kia nói về `beforeSeq`/`afterSeq` của
   * `/messages`, dùng lại là báo sai nguyên nhân cho người gọi. Hỏng phải **400**, KHÔNG được im lặng
   * rơi về trang đầu — rơi về trang đầu biến con trỏ hỏng thành vòng lặp vô hạn ở FE.
   */
  SEARCH_CURSOR_INVALID: "CHAT-ERR-016: con trỏ phân trang tìm kiếm không hợp lệ.",

  /** Tin `system` / tin đã thu hồi không phải đối tượng của thao tác kiểm duyệt. */
  MESSAGE_NOT_ACTIONABLE:
    "CHAT-ERR-006: tin hệ thống hoặc tin đã thu hồi không thực hiện được thao tác này.",

  // ═══════════ S7-CHAT-BE-3 — đính kèm ═══════════

  /**
   * CHAT-ERR-015 (403 — API-13 §8) — tệp đính kèm không dùng được.
   *
   * HẰNG, một thông điệp cho CẢ BỐN lý do: tệp không tồn tại · thuộc tenant khác (RLS lọc còn 0 hàng) ·
   * **do người khác tải lên** · chưa `Uploaded` hoặc đã `Infected`. Tách ra là nói cho người gọi biết
   * "fileId này có thật không / của ai" — oracle dò tệp, cùng lớp với CHAT-ERR-001 trên trục phòng/tin.
   * Thông điệp KHÔNG kèm fileId.
   */
  ATTACHMENT_INVALID:
    "CHAT-ERR-015: tệp đính kèm không hợp lệ — chỉ gắn được tệp do chính bạn tải lên, đã tải xong và đã qua kiểm virus.",

  // ═══════════ S7-CHAT-BE-7 🔒 — đọc-vượt membership ═══════════

  /**
   * CHAT-ERR-020 (500) — ghi `audit_logs` của đường ĐỌC-VƯỢT thất bại ⇒ **rollback, 0 byte dữ liệu**.
   *
   * ⚠️ Đây là mã lỗi DUY NHẤT của module mà đường đúng là **500**, và điều đó có chủ đích: trên đường
   * đọc-vượt, dòng audit là ĐIỀU KIỆN để dữ liệu được rời server (SPEC-15 §3.3). Trả `200` với thân rỗng
   * là "đọc-vượt không dấu vết" ngụy trang thành kết quả trống — API-13 §8 cấm tuyệt đối.
   *
   * Thông điệp KHÔNG kèm chi tiết lỗi Postgres (không rò tên bảng/cột ra ngoài).
   */
  OVERSIGHT_AUDIT_FAILED:
    "CHAT-ERR-020: không ghi được nhật ký truy cập quản trị — yêu cầu đã bị huỷ và không trả về dữ liệu.",

  // ═══════════ S7-CHAT-BE-9 🔒 — bộ lọc của CHAT-API-019 ═══════════

  /**
   * CHAT-ERR-016 (trục NHẬT KÝ ĐỌC-VƯỢT) — con trỏ được sinh ra dưới MỘT bộ lọc khác.
   *
   * ⚠️ Vẫn là mã `CHAT-ERR-016` (SPEC-15 §12: "con trỏ phân trang không hợp lệ") — KHÔNG đẻ mã ngoài sổ.
   * Nhưng thông điệp RIÊNG: "con trỏ hỏng" và "con trỏ của bộ lọc khác" dẫn tới hai cách sửa khác nhau ở
   * FE (một cái là bug dựng URL, một cái là phải tải lại từ trang đầu sau khi đổi bộ lọc).
   *
   * Vì sao 400 chứ không im lặng: xem `chat-oversight-audit-cursor.ts`. Trả 200 kèm trang cắt theo mốc
   * của một tập kết quả khác là làm hỏng chính thứ màn CHAT-SCREEN-008 dùng để đếm bằng chứng.
   */
  OVERSIGHT_CURSOR_FILTER_MISMATCH:
    "CHAT-ERR-016: con trỏ phân trang không khớp bộ lọc hiện tại — hãy tải lại từ trang đầu.",
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
  /**
   * Bỏ tombstone của một DM đã xoá mềm + kích hoạt lại tư cách thành viên (`resurrectDirect`).
   * KHÔNG gộp vào `direct_opened`: đây là hành động UN-DELETE trên dữ liệu đã bị xoá, và đó chính là
   * loại hành động mà sổ audit sinh ra để trả lời "ai đã làm sống lại phòng này".
   * `object_type` tái dùng `chat_room` (đã có trong CHECK) — cột `action` là text tự do, không cần migration.
   */
  ROOM_DIRECT_RESTORED: "chat.room.direct_restored",
  ROOM_UPDATED: "chat.room.updated",
  ROOM_ARCHIVED: "chat.room.archived",
  MEMBER_ADDED: "chat.room.member_added",
  MEMBER_ROLE_CHANGED: "chat.room.member_role_changed",
  MEMBER_REMOVED: "chat.room.member_removed",
  ROOM_LEFT: "chat.room.left",
  // ── S7-CHAT-BE-2 ──
  /**
   * CỐ Ý CHỈ CÓ 3 HÀNH ĐỘNG TIN NHẮN — thu hồi và ghim/bỏ ghim.
   *
   * Gửi và đọc tin KHÔNG ghi audit: mỗi tin một dòng sẽ nhấn chìm `audit_logs` (bảng append-only DÙNG
   * CHUNG, đang phục vụ điều tra AUTH/HR/LEAVE) và biến nó thành bản sao thứ hai của `chat_messages`.
   * Ba hành động dưới đây khác về chất: chúng tác động lên nội dung của NGƯỜI KHÁC.
   *
   * `object_id` = messageId. TUYỆT ĐỐI KHÔNG kèm `body` (SPEC-15 §18 · API-13 §6.8).
   */
  MESSAGE_RECALLED: "chat.message.recalled",
  MESSAGE_PINNED: "chat.message.pinned",
  MESSAGE_UNPINNED: "chat.message.unpinned",
  // ── S7-CHAT-BE-5 — phòng dẫn xuất theo phòng ban/dự án ──
  /**
   * Bốn hành động ĐỒNG BỘ + một hành động THẤT BẠI. Chúng tách khỏi `ROOM_CREATED`/`MEMBER_ADDED`… của
   * BE-1 vì trả lời câu hỏi điều tra KHÁC: "ai cho người này vào phòng" với đáp án "không ai — hệ thống
   * suy ra từ hồ sơ nhân sự". Gộp chung thì mọi dòng máy sinh sẽ trông như thao tác tay của một admin.
   *
   * `actorType`: `'System'` cho hook thời-gian-thực (có `actorUserId` = người vừa ghi HR/TASK),
   * `'Job'` cho job đối soát (KHÔNG có `actorUserId` — không người nào đứng sau).
   */
  ROOM_AUTO_CREATED: "chat.room.auto_created",
  ROOM_AUTO_ARCHIVED: "chat.room.auto_archived",
  MEMBER_AUTO_ADDED: "chat.room.member_auto_added",
  MEMBER_AUTO_REMOVED: "chat.room.member_auto_removed",
  /**
   * Đường THU HỒI thất bại — `resultStatus='Failure'`, ghi ở transaction RIÊNG sau khi tx nghiệp vụ đã
   * rollback hẳn (không có gì để atomic CÙNG, vì hành động chính đã biến mất). Đây là dòng audit DUY
   * NHẤT của hệ được phép nằm ngoài tx nghiệp vụ, và lý do nằm ở chính bản chất "audit của một thất bại".
   * `after` chỉ chứa lý do đã lược PII + loại đích — KHÔNG kèm thông điệp lỗi thô của Postgres.
   */
  MEMBER_SYNC_FAILED: "chat.room.member_sync_failed",
  // ── S7-CHAT-BE-7 🔒 — đọc-vượt membership (CHAT-DEC-004) ──
  /**
   * MỘT action duy nhất cho CẢ BỐN route `/chat/oversight/*` — API-13 §5.3 "hình dạng dòng audit".
   *
   * Vì sao một chứ không bốn: `CHAT-API-019` phải bó truy vấn `action = 'chat.oversight.read' AND
   * module_code = 'CHAT'`. Bốn action là bốn thứ phải nhớ liệt kê, và quên một cái làm nhật ký
   * CHAT-SCREEN-008 **thiếu dòng trong im lặng** — tức mất đúng thứ nó sinh ra để ghi. Loại route nằm ở
   * `metadata.endpoint` ('018a'|'018b'|'018c'|'019'|'unknown' — nguồn: `CHAT_OVERSIGHT_ENDPOINT`), là
   * chi tiết hiển thị chứ không phải khoá lọc. `'unknown'` = đường dẫn không khớp khuôn nào đã khai
   * (S7-CHAT-CLEAN-2): thà lộ ra là chưa biết còn hơn mượn nhãn của một endpoint CÓ THẬT.
   *
   * `object_type` = `'chat_room'` (đã có trong catalog CHECK + union TS ⇒ KHÔNG cần migration);
   * `object_id` = `roomId` với 018b/018c, **NULL** với 018a/019.
   *
   * ⚠️ NỘI DUNG TIN NHẮN KHÔNG BAO GIỜ VÀO ĐÂY (SPEC-15 §18) — kể cả trích đoạn, kể cả số lần khớp từ
   * khoá. `metadata` của 018a chỉ mang chuỗi người dùng TỰ GÕ (`q`) + `roomType` + số kết quả.
   */
  OVERSIGHT_READ: "chat.oversight.read",
} as const;

/** `module_code` cho mọi dòng audit của CHAT — CHAT-API-019 lọc theo cột này. */
export const CHAT_MODULE_CODE = "CHAT";

import { z } from "zod";

// S7-CHAT-DB-1 (mig 0538 · CHAT-DEC-001): BỎ 'channel' — cụm media out-of-scope sau de-media-fy.
// Đổi CÙNG COMMIT với migration đổi CHECK chat_rooms_room_type_chk, nếu không FE/BE lệch DB.
export const chatRoomTypeSchema = z.enum(["direct", "group", "department", "project"]);
export type ChatRoomType = z.infer<typeof chatRoomTypeSchema>;

export const chatRoomSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  refId: z.string().uuid().nullable(),
  roomType: chatRoomTypeSchema,
  // ⚠️ NULLABLE: phòng `direct` không có tên (mig 0538 DROP NOT NULL) — client dựng tên từ 2 người.
  // Thiếu .nullable() ở đây là ZodError runtime DÙ HTTP 200 (lớp server-masking-needs-optional-fe-schema).
  name: z.string().nullable(),
  roomCode: z.string(),
  description: z.string().nullable().optional(),
  lastMessageAt: z.string().datetime().nullable().optional(),
  lastMessageSeq: z.number().int().nullable().optional(),
  isArchived: z.boolean().optional(),
  /**
   * Số tin chưa đọc = lastMessageSeq − lastReadSeq, CẢ HAI trong hệ `room_seq` (per-room, mig 0539).
   * ⚠️ KHÔNG dùng `chat_messages.seq` — đó là identity CẤP BẢNG, phép trừ trên nó cho ra tổng số tin
   * TOÀN HỆ THỐNG giữa hai mốc (đo thật: 51 thay vì 1) và làm lộ lưu lượng của phòng mình không thuộc.
   */
  unreadCount: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime(),
  // ── S8-CHAT-UX-BE-1 — tuỳ chọn PER-USER trên hàng membership của chính người gọi (mig 0543) ──
  // CẢ BA đều `.nullable().optional()`, KHÔNG required: `/chat/rooms` có 7 consumer đang chạy và một
  // khoá required mới làm TẤT CẢ ăn ZodError ngay khi FE lên trước BE (bài học S7-SEC-ROLE2FA-UI-1 +
  // memory `server-masking-needs-optional-fe-schema`). `null` = không đặt, `undefined` = server cũ.
  /**
   * Ghim hội thoại — **PER-USER** (`chat_room_members.pinned_at`, CHAT-DEC-015), trần 10/người.
   * ⚠️ KHÔNG phải `chat_messages.pinned_at` (ghim TIN, trần 20/phòng, cả phòng cùng thấy) — SPEC-15 §12.
   */
  pinnedAt: z.string().datetime().nullable().optional(),
  /** Tắt thông báo tới mốc này (CHAT-FUNC-015). Quá mốc ⇒ tự nhận lại; `null` = đang bật thông báo. */
  mutedUntil: z.string().datetime().nullable().optional(),
  /**
   * Đánh dấu chưa đọc THỦ CÔNG (CHAT-FUNC-017). Cột RIÊNG — `unreadCount` KHÔNG đổi theo nó, vì
   * `last_read_seq` là con trỏ chỉ-tiến (SPEC-15 §13.2) và không được lùi để làm tính năng tiện.
   * FE hiện đậm dòng phòng khi `markedUnreadAt !== null` DÙ `unreadCount === 0`.
   */
  markedUnreadAt: z.string().datetime().nullable().optional(),
});
export type ChatRoomDto = z.infer<typeof chatRoomSchema>;

/**
 * PUT /chat/rooms/:id/mute (CHAT-API-025) — tắt/bật thông báo phòng.
 *
 * ⚠️ Mã là **025**, KHÔNG phải 019: `CHAT-API-019` đã thuộc `GET /chat/oversight/audit` từ wave S7 và
 * literal `'019'` đang nằm trong `audit_logs.metadata.endpoint` trên PROD (xem `docs/plans/S8-CHAT-UX-BE-1.md` §0).
 *
 * `null` = BẬT lại thông báo — đó là lý do trường này `nullable` chứ không `optional`: body `{}` sẽ không
 * phân biệt được với "bật lại", và một API tắt-được-mà-không-bật-lại-được là lỗ một chiều.
 */
export const chatMuteRoomSchema = z.object({
  mutedUntil: z.string().datetime().nullable(),
});
export type ChatMuteRoomRequest = z.infer<typeof chatMuteRoomSchema>;

// Chỉ tạo được phòng NHÓM qua đường này: `direct` mở bằng POST /chat/rooms/direct (idempotent theo
// direct_key), `department`/`project` do hệ thống tự dựng (thành viên dẫn xuất — CHAT-DEC-003).
export const createChatRoomSchema = z.object({
  name: z.string().min(1).max(200),
  roomType: z.literal("group").default("group"),
  description: z.string().max(500).optional(),
  /**
   * Trần 200 — KHÔNG phải con số thẩm mỹ. Mọi role canonical đều giữ `create:chat-room` @Company
   * (`0538:452`), nên không có trần thì bất kỳ nhân viên nào cũng POST được 5.000 UUID hợp lệ và
   * `createGroup` chạy 5.000 INSERT tuần tự trong MỘT transaction đang giữ hàng phòng — giao dịch dài
   * trên pool PgBouncer transaction-mode. Cạn tài nguyên bằng tài khoản hợp lệ, không cần lỗ hổng nào.
   */
  memberUserIds: z.array(z.string().uuid()).max(200).default([]),
});
export type CreateChatRoomRequest = z.infer<typeof createChatRoomSchema>;

// S7-CHAT-BE-2: += "system" — tin do SERVER sinh (thêm/bớt thành viên, đổi tên phòng). Khớp CHECK
// `chk_chat_messages_type` (mig 0538). Client KHÔNG gửi được kiểu này (sendMessageSchema khoá riêng).
export const chatMessageTypeSchema = z.enum(["text", "file", "system"]);
export type ChatMessageType = z.infer<typeof chatMessageTypeSchema>;

/**
 * S7-CHAT-BE-3 — một tệp đính kèm ĐÃ qua kiểm quyền (SPEC-15 §13.5 · DB-12 §6.5).
 *
 * Nguồn dữ liệu là `file_links` (module `CHAT`, entity `chat_message`) ⋈ `files` — CHAT **không** lưu
 * URL trần trên `chat_messages` nữa (`file_url`/`file_name` khai tử).
 *
 * ⚠️ `url` và `thumbnailUrl` **`.nullable()`** CÓ CHỦ ĐÍCH. Server bỏ trắng khi `FilePolicyService` từ
 * chối (tệp còn link của module khác — luật AND most-restrictive), khi tệp `Infected`/chưa `Uploaded`,
 * hoặc khi ký lỗi. Trả metadata + `url: null` để FE hiện "tệp không tải được" thay vì làm hỏng cả trang
 * tin vì một tệp; bỏ `.nullable()` ở đây là `ZodError` = TRẮNG TRANG dù HTTP 200
 * (memory `server-masking-needs-optional-fe-schema`).
 */
export const chatAttachmentSchema = z.object({
  /** id của hàng `file_links` — khoá ổn định để FE `key=`; KHÔNG phải id tệp. */
  id: z.string().uuid(),
  fileId: z.string().uuid(),
  /** `files.original_name` — đã sanitize lúc upload (chống path-traversal). */
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** Server quyết định (`mimeType` bắt đầu `image/`) — KHÔNG để FE tự đoán từ phần mở rộng. */
  isImage: z.boolean(),
  /** URL ký hạn ngắn (mặc định 300s). `null` = không được phép tải hoặc ký lỗi. */
  url: z.string().nullable(),
  /**
   * URL hiện XEM-TRƯỚC. `null` cho tệp không phải ảnh (FE hiện tên + kích thước — SPEC-15 §13.5).
   *
   * ⚠️ v1: với ảnh, đây là URL của **chính bản gốc**, KHÔNG phải biến thể đã resize — repo chưa có
   * pipeline sinh biến thể (không thư viện xử lý ảnh, không job, không khoá biến thể trong storage).
   * FE co bằng CSS. Tên khoá giữ nguyên để khi có biến thể thật thì chỉ đổi ở SERVER.
   */
  thumbnailUrl: z.string().nullable(),
});
export type ChatAttachmentDto = z.infer<typeof chatAttachmentSchema>;

/**
 * chatMessageSchema — DTO chung REST + WS (realtime.ts re-export làm payload `chat:message`).
 * BẤT BIẾN masking (CLAUDE.md §5): server PHẢI `.parse()` row qua schema này trước khi trả/emit —
 * key thừa bị strip. Mọi field dưới đây server PHẢI cung cấp (repo select đủ cột + join senderName).
 */
export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  roomId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string().nullable(),
  /**
   * ⚠️ NULLABLE CÓ CHỦ ĐÍCH — tin đã thu hồi trả `null` (SPEC-15 §13.6). Che ở **SERVER**, không ở
   * client: bản ghi và body gốc vẫn nằm trong DB cho tranh chấp nội bộ, nhưng DTO bỏ trắng.
   * Bỏ `.nullable()` ở đây là ZodError làm TRẮNG TRANG dù HTTP 200
   * (memory `server-masking-needs-optional-fe-schema`).
   */
  body: z.string().nullable(),
  messageType: chatMessageTypeSchema,
  // ⚠️ `fileUrl`/`fileName` ĐÃ BỎ HẲN — `S7-CHAT-CLEAN-1` (mig `0542`) drop luôn hai cột dưới DB.
  // Đây chính là "đợt dọn sau" mà comment cũ hẹn. Đính kèm đi qua FOUNDATION Files + `file_links`
  // + URL ký hạn ngắn (SPEC-15 §13.5, `S7-CHAT-BE-3`) — đọc `attachments` bên dưới.
  // Đừng thêm lại: URL trần trong DTO là đường rò tệp KHÔNG qua kiểm quyền, đúng lý do khai tử.
  /** Đã LỌC ở server: chỉ còn userId thực sự là thành viên phòng (CHAT-ERR-010). */
  mentions: z.array(z.string().uuid()),
  pinnedAt: z.string().datetime().nullable(),
  pinnedBy: z.string().uuid().nullable(),
  /** Tin được trả lời (cùng phòng). NULL = tin độc lập. */
  replyToMessageId: z.string().uuid().nullable(),
  /** Mốc thu hồi. Khác NULL ⇒ `body` là `null` — hai trường đi CÙNG NHAU, đừng đọc lẻ một cái. */
  recalledAt: z.string().datetime().nullable(),
  /** Số tệp đính kèm (đặt ngay lúc INSERT — `S7-CHAT-BE-3`). Tin không tệp = 0. */
  attachmentCount: z.number().int().nonnegative(),
  /**
   * S7-CHAT-BE-3 — tệp đính kèm ĐÃ dựng sẵn URL ký (SPEC-15 §13.5).
   *
   * KHÔNG `.optional()`: server LUÔN cung cấp (mảng rỗng khi không có tệp). Để optional là mời FE viết
   * `attachments?.map` rồi quên nhánh undefined ở đúng chỗ khó tái hiện nhất.
   *
   * Tin ĐÃ THU HỒI luôn `[]` — cùng lớp che với `body: null` (§13.6). Có thể LỆCH với `attachmentCount`
   * (đếm lúc gửi, bất biến vì cột không có GRANT UPDATE): tin thu hồi giữ `attachmentCount: 2` nhưng
   * `attachments: []`. Đọc `attachments` để render, `attachmentCount` chỉ là số liệu lịch sử.
   */
  attachments: z.array(chatAttachmentSchema),
  /**
   * Số thứ tự **PER-ROOM**, liên tục từ 1 (mig `0539`). Đây là con trỏ dùng cho `beforeSeq`/`afterSeq`,
   * cho đếm chưa đọc và cho "đã xem bởi".
   *
   * ⚠️ CỐ Ý KHÔNG CÓ `seq`. `chat_messages.seq` là identity **cấp BẢNG** — tăng xuyên mọi phòng và mọi
   * tenant; lộ ra client thì thành viên MỘT phòng suy được lưu lượng tin TOÀN CÔNG TY giữa hai lần mình
   * nhắn, gồm cả DM họ không thuộc (SPEC-15 §13.1 ĐÍNH CHÍNH 02/08/2026). Cột vẫn còn trong DB (identity
   * không drop sạch được) nhưng KHÔNG BAO GIỜ ra khỏi server. Đây là nợ của `S7-CHAT-DB-2`, trả ở đây.
   */
  roomSeq: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

/**
 * POST /chat/rooms/:id/messages (CHAT-API-010).
 *
 * `clientMessageId` **BẮT BUỘC**, do client sinh **MỘT LẦN khi bắt đầu soạn** (API-13 §6.5). Sinh lại
 * trong thân hàm gửi thì khoá là ngẫu nhiên mỗi lần ⇒ **không chống trùng gì cả**
 * (memory `idempotency-key-must-be-content-derived`). Để `.optional()` là mời gọi đúng lỗi đó.
 *
 * KHÔNG có `messageType`: client không chọn kiểu. Server suy ra — `fileIds` không rỗng ⇒ `'file'`,
 * ngược lại `'text'`; `'system'` chỉ do server sinh.
 */
export const sendMessageSchema = z
  .object({
    /**
     * S7-CHAT-BE-3 — `.default("")` thay cho `.min(1)`: tin CHỈ có ảnh là ca thường gặp nhất của tính
     * năng đính kèm. Ràng buộc "không được rỗng" chuyển xuống `.superRefine` bên dưới (rỗng **và**
     * không tệp mới là lỗi) ⇒ tin rỗng-không-tệp vẫn 422 y như trước.
     * `chat_messages.body` NOT NULL nên chuỗi rỗng là giá trị hợp lệ ở DB.
     */
    body: z.string().max(4000).default(""),
    clientMessageId: z.string().uuid(),
    replyToMessageId: z.string().uuid().optional(),
    /** userId được mention. Server LỌC bỏ người ngoài phòng, KHÔNG chặn gửi (CHAT-ERR-010). */
    mentions: z.array(z.string().uuid()).max(20).optional(),
    /**
     * S7-CHAT-BE-3 — fileId đã upload xong qua FOUNDATION Files (SPEC-15 §13.5 bước 2).
     *
     * Server kiểm ĐỦ bốn vế trước khi gắn: tệp thuộc tenant + **do chính người gửi upload** + đã
     * `Uploaded` + không `Infected` — sai bất kỳ vế nào → CHAT-ERR-015 (403).
     *
     * Trần 10: mỗi fileId là một INSERT `file_links` trong CÙNG transaction đang giữ hàng phòng. Không
     * trần thì một POST hợp lệ giữ giao dịch dài trên pool PgBouncer transaction-mode (cùng lớp bẫy với
     * trần 200 thành viên của `createChatRoomSchema`).
     */
    fileIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.body.trim().length === 0 && (v.fileIds?.length ?? 0) === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: "CHAT-ERR-004: tin nhắn phải có nội dung hoặc ít nhất một tệp đính kèm.",
      });
    }
  });
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

/**
 * GET /chat/rooms/:id/messages (CHAT-API-009) — phân trang bằng CON TRỎ, **cấm `offset`**
 * (kết quả trôi khi có tin mới chèn vào giữa lúc cuộn — API-13 §6.4).
 *
 * `beforeSeq` và `afterSeq` LOẠI TRỪ NHAU; gửi cả hai → CHAT-ERR-016. Giá trị mang nghĩa `room_seq`
 * (per-room), KHÔNG phải `seq` toàn cục — tên tham số giữ nguyên để khỏi churn FE.
 *
 * `z.coerce.number()` idempotent dưới `ZodValidationPipe` chạy 2 lần (Number(5) === 5) — khác boolean,
 * không cần preprocess (memory `zod-query-param-double-pipe-idempotent`).
 */
export const listChatMessagesQuerySchema = z.object({
  beforeSeq: z.coerce.number().int().positive().optional(),
  afterSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuerySchema>;

/**
 * POST /chat/rooms/:id/read (CHAT-API-014) — con trỏ CHỈ TIẾN.
 * Gửi số nhỏ hơn giá trị hiện có → bỏ qua IM LẶNG, không lỗi (CHAT-ERR-018): nhiều thiết bị cùng mở,
 * thiết bị chậm không được kéo lùi trạng thái của thiết bị nhanh.
 */
export const chatMarkReadSchema = z.object({
  /**
   * Trần `MAX_SAFE_INTEGER` là ĐAI THỨ HAI, không phải trang trí: `.int()` của Zod chỉ gọi
   * `Number.isInteger`, mà `Number.isInteger(1e300) === true`. Không có trần thì `1e300` đi thẳng xuống
   * bind bigint và ném `22003` ⇒ 500. Kẹp ở biên bằng chính giới hạn an toàn của JS number, vẫn nhỏ hơn
   * trần bigint của Postgres ⇒ không đường nào tràn. Giá trị hợp lệ nhưng lớn hơn số tin thật vẫn được
   * SQL kẹp về `last_message_seq` và trả 200 (đúng thiết kế con-trỏ-chỉ-tiến), KHÔNG phải 400.
   */
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type ChatMarkReadRequest = z.infer<typeof chatMarkReadSchema>;

export const chatMarkReadResultSchema = z.object({
  roomId: z.string().uuid(),
  lastReadSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});
export type ChatMarkReadResultDto = z.infer<typeof chatMarkReadResultSchema>;

/**
 * GET /chat/rooms/:id/files (CHAT-API-017) — tab "Tệp" của phòng.
 *
 * Con trỏ `beforeSeq` (theo `room_seq` của tin chứa tệp), **cấm `offset`** — cùng luật với
 * `/messages` (API-13 §6.4). `z.coerce` idempotent khi `ZodValidationPipe` chạy 2 lần
 * (memory `zod-query-param-double-pipe-idempotent`).
 */
export const listChatRoomFilesQuerySchema = z.object({
  beforeSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type ListChatRoomFilesQuery = z.infer<typeof listChatRoomFilesQuerySchema>;

/** Một dòng của tab "Tệp": đính kèm + ngữ cảnh tin chứa nó (để FE nhảy tới tin). */
export const chatRoomFileSchema = chatAttachmentSchema.extend({
  messageId: z.string().uuid(),
  /** `room_seq` của tin chứa tệp — cũng là con trỏ cho trang kế (`beforeSeq`). */
  roomSeq: z.number().int().positive(),
  senderId: z.string().uuid(),
  senderName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ChatRoomFileDto = z.infer<typeof chatRoomFileSchema>;

/** GET /chat/unread-count (CHAT-API-016) — badge header. Tổng PHÉP TRỪ, không `COUNT(*)`. */
export const chatUnreadCountSchema = z.object({
  total: z.number().int().nonnegative(),
  rooms: z.number().int().nonnegative(),
});
export type ChatUnreadCountDto = z.infer<typeof chatUnreadCountSchema>;

// ─── direct room (DM 1-1 idempotent) ─────────────────────────────────────────

export const openDirectRoomSchema = z.object({
  /** userId của người đối thoại — server tự lấy userId mình từ JWT, ghép direct_key dedup. */
  peerUserId: z.string().uuid(),
});
export type OpenDirectRoomRequest = z.infer<typeof openDirectRoomSchema>;

// ─── thành viên phòng ─────────────────────────────────────────────────────────

export const chatMemberRoleSchema = z.enum(["member", "admin"]);
export type ChatMemberRole = z.infer<typeof chatMemberRoleSchema>;

export const addChatMemberSchema = z.object({
  userId: z.string().uuid(),
  role: chatMemberRoleSchema.default("member"),
});
export type AddChatMemberRequest = z.infer<typeof addChatMemberSchema>;

export const chatRoomMemberSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  role: chatMemberRoleSchema,
  joinedAt: z.string().datetime(),
  // ── S7-CHAT-BE-1 (additive, optional — caller cũ không gãy) ──
  /** Tên hiển thị (join `users.full_name`) — phòng `direct` dựng tên từ 2 người ở client. */
  userName: z.string().nullable().optional(),
  /** Con trỏ đã đọc trong hệ `room_seq` — FE dựng "đã xem bởi" (SPEC-15 §13.2), KHÔNG cần bảng riêng. */
  lastReadSeq: z.number().int().nonnegative().optional(),
});
export type ChatRoomMemberDto = z.infer<typeof chatRoomMemberSchema>;

// ═══════════════ S7-CHAT-BE-1 — phòng & thành viên (CHAT-API-001..008) ═══════════════

/**
 * GET /chat/rooms (CHAT-API-001). Boolean query-param phải IDEMPOTENT dưới `ZodValidationPipe` chạy 2
 * lần (memory `zod-query-param-double-pipe-idempotent`) ⇒ `z.preprocess`, KHÔNG `z.coerce.boolean`
 * ("false" là chuỗi không rỗng nên coerce ra `true` — ngược hẳn ý người dùng).
 */
export const listChatRoomsQuerySchema = z.object({
  type: chatRoomTypeSchema.optional(),
  archived: z
    .preprocess(
      (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined),
      z.boolean().optional(),
    )
    .optional(),
});
export type ListChatRoomsQuery = z.infer<typeof listChatRoomsQuerySchema>;

/**
 * PATCH /chat/rooms/:id (CHAT-API-005) — chỉ `name`/`description`, chỉ phòng `group`.
 * `.refine` ép ít nhất một trường: body rỗng mà trả 200 là báo "đã đổi" trong khi không đổi gì.
 */
export const updateChatRoomSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "Cần ít nhất một trường để cập nhật (name hoặc description).",
  });
export type UpdateChatRoomRequest = z.infer<typeof updateChatRoomSchema>;

/** PATCH /chat/rooms/:id/members/:userId (CHAT-API-007c) — phong/hạ vai trò trong phòng. */
export const updateChatMemberSchema = z.object({
  role: chatMemberRoleSchema,
});
export type UpdateChatMemberRequest = z.infer<typeof updateChatMemberSchema>;

/**
 * GET /chat/rooms/:id (CHAT-API-004) — phòng + thành viên + vai trò CỦA TÔI.
 * `myRole` để FE khỏi phải tự dò mình trong `members[]` (và khỏi tự suy ra luật admin ở client).
 */
export const chatRoomDetailSchema = chatRoomSchema.extend({
  members: z.array(chatRoomMemberSchema),
  myRole: chatMemberRoleSchema,
});
export type ChatRoomDetailDto = z.infer<typeof chatRoomDetailSchema>;

// ═══════════ S7-CHAT-BE-4 — tìm kiếm toàn văn (CHAT-API-015) ═══════════
//
// ⚠️ KHỐI APPEND — `contracts/src/chat.ts` là hot-file của 4 WO trong wave S7. Thêm ở CUỐI file, không
// chèn vào giữa, không sắp xếp lại khối của WO khác.

/**
 * `GET /chat/search` (CHAT-API-015 · SPEC-15 §13.7).
 *
 * `q` đi qua `trim → NFC → min(2)`:
 *   • `.trim()` TRƯỚC `min(2)` — `"  a  "` phải trượt, không được lọt vì đếm cả khoảng trắng;
 *   • `.normalize("NFC")` vì macOS/iOS gửi tiếng Việt ở dạng **NFD** (ký tự cơ sở + dấu tổ hợp) mà
 *     `f_unaccent` không gỡ được dấu tổ hợp ⇒ người gõ CÓ DẤU từ máy Mac ra **0 kết quả**, hỏng theo
 *     chiều khó phát hiện nhất (người test gõ không dấu thấy chạy, tưởng xong);
 *   • `max(200)` — không có trần thì một câu 10KB đi thẳng vào `websearch_to_tsquery`.
 *
 * Cả ba phép biến đổi đều **idempotent**, an toàn khi `ZodValidationPipe` chạy 2 lần trên query-param
 * (memory `zod-query-param-double-pipe-idempotent`).
 *
 * `limit` max 50 (thấp hơn `/messages`): mỗi hàng kết quả kéo thêm join `chat_rooms` + `users`.
 */
/**
 * Có ký tự ĐIỀU KHIỂN C0/C1 không (trừ tab · newline · CR — chúng vô hại và người dùng dán vào là
 * chuyện thường)?
 *
 * ⚠️ **So mã điểm, KHÔNG dùng regex.** Một character-class chứa ký tự điều khiển làm luật `eslint`
 * `no-control-regex` ĐỎ, và lối thoát nhanh nhất lúc đó là tắt luật — tức bỏ một luật đúng để giữ một
 * cách viết không cần thiết. Vòng lặp này nói rõ ý định hơn và không cần miễn trừ nào.
 *
 * ⚠️ Cũng KHÔNG viết ký tự điều khiển dạng literal vào file nguồn: một byte NUL thật làm cả file thành
 * "binary" với `grep`/`git diff` và biến mất im lặng qua nhiều công cụ chỉnh sửa (đã xảy ra khi viết
 * chính hàm này).
 */
function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  }
  return false;
}

export const chatSearchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .transform((s) => s.normalize("NFC"))
    .pipe(
      z
        .string()
        .min(2, "CHAT-ERR-017: từ khoá tìm kiếm phải có ít nhất 2 ký tự.")
        .max(200, "CHAT-ERR-017: từ khoá tìm kiếm quá dài (tối đa 200 ký tự).")
        // ⚠️ Byte NUL phải chặn ở BIÊN. Đo thật trên lane DB: `websearch_to_tsquery('simple',
        // f_unaccent($1))` với chuỗi chứa NUL ném `22021 invalid byte sequence for encoding "UTF8"`
        // ⇒ `GET /chat/search?q=%00ab` trả **500**. Không rò gì (bộ lọc lỗi trả "Lỗi hệ thống"), nhưng
        // mỗi request mở rồi rollback một transaction và bơm stack vào log — DoS rẻ tiền trên đúng
        // đường gõ-là-gọi. Mọi ký tự cú pháp khác (`&`, `|`, `!`, `(`, `:*`, `'`, `"`) thì
        // `websearch_to_tsquery` nuốt bình thường; NUL là ngoại lệ DUY NHẤT đo được.
        .refine((s) => !hasControlChar(s), {
          message: "CHAT-ERR-017: từ khoá tìm kiếm chứa ký tự không hợp lệ.",
        }),
    ),
  /** Bó theo MỘT phòng. Không thuộc phòng → 404 GIỐNG HỆT phòng không tồn tại (CHAT-ERR-017). */
  roomId: z.string().uuid().optional(),
  /** Con trỏ opaque của trang trước. Rác → 400, KHÔNG im lặng rơi về trang đầu (vòng lặp vô hạn ở FE). */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ChatSearchQuery = z.infer<typeof chatSearchQuerySchema>;

/**
 * Một dòng kết quả tìm kiếm.
 *
 * ⚠️ **KHÔNG extend `chatMessageSchema`** — lý do là bảo mật, không phải gọn code. `chatMessageSchema`
 * (sau `S7-CHAT-BE-3`) mang `attachments` **kèm URL ký**; tái dùng nó ở đây biến một ô tìm kiếm thành máy
 * phát URL ký hàng loạt trên toàn bộ kho tệp người dùng có quyền — 50 URL/trang, mỗi lần gõ phím. Đường
 * tìm kiếm chỉ trả `attachmentCount`; muốn tệp thì mở phòng (`/rooms/:id/files`, có access-log).
 *
 * `roomSeq` phơi ở đây AN TOÀN: nó per-room (mig `0539`) và người tìm đã là thành viên đúng phòng đó.
 * Nó là thứ FE cần để "nhảy tới tin trong ngữ cảnh" (CHAT-SCREEN-005).
 */
export const chatSearchResultSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  /** DM không có tên phòng ⇒ `.nullable()` (memory `server-masking-needs-optional-fe-schema`). */
  roomName: z.string().nullable(),
  roomType: chatRoomTypeSchema,
  roomSeq: z.number().int().positive(),
  senderId: z.string().uuid(),
  senderName: z.string().nullable(),
  body: z.string(),
  createdAt: z.string().datetime(),
  attachmentCount: z.number().int().nonnegative(),
});
export type ChatSearchResultDto = z.infer<typeof chatSearchResultSchema>;

/**
 * Phản hồi keyset — `{ data, nextCursor }`, **không** đi qua `paginated()`.
 *
 * Khối `Pagination` dùng chung của repo là page/offset, không dùng được cho keyset. Sau
 * `ResponseEnvelopeInterceptor` phía FE nhận `data.data` + `data.nextCursor` — ghi ở đây để FE-4 không
 * dính bẫy `apifetch-drops-pagination-bare-array`.
 *
 * `nextCursor: null` = trang cuối.
 */
export const chatSearchResponseSchema = z.object({
  data: z.array(chatSearchResultSchema),
  nextCursor: z.string().nullable(),
});
export type ChatSearchResponseDto = z.infer<typeof chatSearchResponseSchema>;

// ═══════════ S7-CHAT-BE-7 🔒 — ĐỌC-VƯỢT MEMBERSHIP (CHAT-API-018/019) ═══════════
//
// ⚠️ KHỐI APPEND ở CUỐI file — `contracts/src/chat.ts` là hot-file của 5 WO trong wave S7.
//
// ┌─ VÌ SAO KHỐI NÀY KHÔNG `extend` MỘT SCHEMA NÀO Ở TRÊN ────────────────────────────────────────────┐
// │ CHAT-DEC-004 mở đúng MỘT thứ: ranh giới MEMBERSHIP. Nó KHÔNG mở đường tải tệp (SPEC-15 §3.3 ·      │
// │ API-13 §5.3 ràng buộc 7). `chatAttachmentSchema` mang `url`/`thumbnailUrl` = URL ký hạn ngắn;      │
// │ `chatMessageSchema` nhúng nguyên mảng đó. Tái dùng — kể cả qua `.extend()`/`.omit()` — biến chính  │
// │ payload oversight thành máy phát khoá đọc tệp KHÔNG CẦN MEMBERSHIP, và `.omit()` thì im lặng phục  │
// │ hồi khoá mỗi khi ai đó thêm trường mới vào schema gốc. Khai LẠI tường minh là lớp phòng vệ duy     │
// │ nhất không trôi. Ca census `chat-oversight.census.spec.ts` đóng đinh điều đó.                       │
// └────────────────────────────────────────────────────────────────────────────────────────────────────┘

/**
 * `GET /chat/oversight/rooms` (CHAT-API-018a) — TRA phòng theo mã/tên/loại.
 *
 * `q` BẮT BUỘC và tối thiểu 2 ký tự (API-13 §5.3: "018a hẹp hơn 'liệt kê mọi phòng'"). Cùng khuôn
 * `trim → NFC → min(2)` với `chatSearchQuerySchema`: NFD từ máy Mac và chuỗi toàn khoảng trắng đều bị
 * chặn ở BIÊN, và cả ba phép biến đổi idempotent khi `ZodValidationPipe` chạy 2 lần
 * (memory `zod-query-param-double-pipe-idempotent`).
 *
 * **KHÔNG có con trỏ phân trang** — CÓ CHỦ Ý, xem `chatOversightRoomListSchema`.
 */
export const chatOversightRoomQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .transform((s) => s.normalize("NFC"))
    .pipe(
      z
        .string()
        .min(2, "CHAT-ERR-019: từ khoá tra cứu phòng phải có ít nhất 2 ký tự.")
        .max(200, "CHAT-ERR-019: từ khoá tra cứu phòng quá dài (tối đa 200 ký tự).")
        .refine((s) => !hasControlChar(s), {
          message: "CHAT-ERR-019: từ khoá tra cứu phòng chứa ký tự không hợp lệ.",
        }),
    ),
  roomType: chatRoomTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ChatOversightRoomQuery = z.infer<typeof chatOversightRoomQuerySchema>;

/**
 * Siêu dữ liệu MỘT phòng ở kết quả tra cứu.
 *
 * ⚠️ **KHÔNG có `members`** — đây là vế giữ cho `018a` không xuất được đồ thị "ai nhắn riêng với ai" của
 * cả công ty ngay cả khi `q` khớp rộng (ví dụ tiền tố `room_code`). Muốn biết ai ở trong một phòng thì
 * phải gọi `018b` ĐÍCH DANH một `roomId`, và mỗi lần gọi để lại ĐÚNG MỘT dòng audit — chính là ngoại lệ
 * "mở đích danh một phòng" mà owner chốt (SPEC-15 §3.3).
 *
 * ⚠️ **KHÔNG có `directKey`**: cột đó ghép từ 2 `userId` nên bản thân nó LÀ quan hệ ai-nhắn-với-ai.
 * ⚠️ **KHÔNG có `unreadCount`**: người đọc-vượt không thuộc phòng nên "chưa đọc" vô nghĩa; trả 0 là bịa.
 */
export const chatOversightRoomSummarySchema = z.object({
  id: z.string().uuid(),
  roomCode: z.string(),
  /** Phòng `direct` KHÔNG có tên (mig `0538` DROP NOT NULL) ⇒ tra theo tên không bao giờ ra DM. */
  name: z.string().nullable(),
  roomType: chatRoomTypeSchema,
  isArchived: z.boolean(),
  /** Số thành viên ĐANG hoạt động — một con số, KHÔNG phải danh sách người. */
  memberCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ChatOversightRoomSummaryDto = z.infer<typeof chatOversightRoomSummarySchema>;

/**
 * Kết quả `018a`. **Không phân trang** (không con trỏ, không offset) — CÓ CHỦ Ý:
 * không lật trang được thì không enumerate được toàn bộ phòng bằng một chuỗi request.
 *
 * `truncated: true` = còn kết quả bị cắt ⇒ UI buộc người dùng thu hẹp truy vấn. Cờ này BẮT BUỘC phải
 * tồn tại: cắt trang mà im lặng đọc ra y hệt "đã trả hết", và người dùng kết luận sai về phạm vi.
 */
export const chatOversightRoomListSchema = z.object({
  data: z.array(chatOversightRoomSummarySchema),
  truncated: z.boolean(),
});
export type ChatOversightRoomListDto = z.infer<typeof chatOversightRoomListSchema>;

/**
 * `GET /chat/oversight/rooms/:id` (CHAT-API-018b) — chi tiết phòng + thành viên.
 *
 * ⚠️ **KHÔNG có `myRole`** (khác `chatRoomDetailSchema`): người đọc-vượt KHÔNG có hàng
 * `chat_room_members` nào, nên mọi giá trị điền vào đó đều là bịa — và một FE đọc `myRole === 'admin'`
 * sẽ bật nút quản trị trên phòng mà BE luôn 403. Vắng trường = FE buộc phải render chế độ CHỈ ĐỌC.
 */
export const chatOversightRoomDetailSchema = chatOversightRoomSummarySchema.extend({
  description: z.string().nullable(),
  members: z.array(chatRoomMemberSchema),
});
export type ChatOversightRoomDetailDto = z.infer<typeof chatOversightRoomDetailSchema>;

/**
 * Đính kèm ở đường ĐỌC-VƯỢT — **metadata thuần, 0 URL** (API-13 §5.3 ràng buộc 7).
 *
 * ⚠️ Khai LẠI thay vì `chatAttachmentSchema.omit({ url: true, thumbnailUrl: true })`: `.omit()` là hợp
 * đồng NGƯỢC (liệt kê thứ bị bỏ), nên mọi trường URL thêm vào schema gốc về sau sẽ tự động chảy vào
 * payload oversight — im lặng, đúng lúc không ai review lại WO này nữa.
 */
export const chatOversightAttachmentSchema = z.object({
  fileId: z.string().uuid(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  isImage: z.boolean(),
});
export type ChatOversightAttachmentDto = z.infer<typeof chatOversightAttachmentSchema>;

/**
 * `GET /chat/oversight/rooms/:id/messages` (CHAT-API-018c).
 *
 * `body` vẫn `.nullable()` — **tin đã thu hồi VẪN bị che ở đường này** (SPEC-15 §13.6). CHAT-DEC-004 mở
 * ranh giới MEMBERSHIP, KHÔNG mở lớp masking; nới thêm là một năng lực mới không ai chốt.
 *
 * `roomSeq` per-room; `seq` cấp bảng KHÔNG BAO GIỜ rời server (SPEC-15 §13.1).
 */
export const chatOversightMessageSchema = z.object({
  id: z.string().uuid(),
  roomId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderName: z.string().nullable(),
  body: z.string().nullable(),
  messageType: chatMessageTypeSchema,
  mentions: z.array(z.string().uuid()),
  pinnedAt: z.string().datetime().nullable(),
  replyToMessageId: z.string().uuid().nullable(),
  recalledAt: z.string().datetime().nullable(),
  attachmentCount: z.number().int().nonnegative(),
  attachments: z.array(chatOversightAttachmentSchema),
  roomSeq: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export type ChatOversightMessageDto = z.infer<typeof chatOversightMessageSchema>;

/**
 * Con trỏ của `018c` — RIÊNG, không mượn `listChatMessagesQuerySchema`.
 *
 * Không phải để khác cho khác: đường oversight đọc **toàn dải `seq`** của phòng (API-13 §5.3 ràng buộc 8),
 * còn đường thường bị kẹp thêm bởi `visible_from_seq` của người đọc. Dùng chung một DTO là mời người thi
 * công dùng chung luôn truy vấn — và truy vấn đó JOIN `chat_room_members`, thứ mà người đọc-vượt KHÔNG có
 * hàng nào ⇒ trả về RỖNG, hỏng lặng lẽ theo chiều ngược lại.
 */
export const chatOversightMessagesQuerySchema = z.object({
  beforeSeq: z.coerce.number().int().positive().optional(),
  afterSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ChatOversightMessagesQuery = z.infer<typeof chatOversightMessagesQuerySchema>;

/**
 * Ngày lịch `YYYY-MM-DD` — **KHÔNG** phải mốc thời gian.
 *
 * ⚠️ Cố ý KHÔNG dùng `z.coerce.date()`: nó nuốt luôn `"2026-08-04T17:00:00Z"`, tức mở lại đúng cánh cửa
 * "client tự quy đổi múi giờ" mà `S7-CHAT-BE-9` đóng — hai người ở hai múi giờ sẽ lọc ra hai kết quả khác
 * nhau trên cùng một câu hỏi. Quy đổi ngày → khoảng thời gian là việc của SERVER, theo `company.timezone`.
 *
 * `.refine` kiểm ngày CÓ THẬT: regex một mình cho `2026-02-31` đi qua, và `new Date()` thì cuộn nó thành
 * 03-03 — một cửa sổ lọc lệch 2 ngày, HTTP 200, không lỗi.
 *
 * Chỉ `.regex` + `.refine` (KHÔNG `.transform`) nên chạy pipe hai lần vẫn cho cùng kết quả — nestjs-zod
 * parse query DTO hai lượt (memory `zod-query-param-double-pipe-idempotent`).
 */
const calendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải có dạng YYYY-MM-DD.")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return (
      probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
    );
  }, "Ngày không tồn tại trên lịch.");

/**
 * `GET /chat/oversight/audit` (CHAT-API-019) — nhật ký đọc-vượt cho CHAT-SCREEN-008.
 *
 * ⚠️ Ba bộ lọc dưới đây chỉ **THU HẸP**. Vế bó cứng `action = 'chat.oversight.read' AND
 * module_code = 'CHAT'` (`ChatOversightRepository.listOversightAudit`) là BẤT BIẾN của 019 — thêm bộ lọc
 * KHÔNG được biến một cặp quyền CHAT thành cổng đọc `audit_logs` toàn hệ thống (API-13 §5.3).
 */
export const chatOversightAuditQuerySchema = z
  .object({
    /**
     * Con trỏ opaque keyset `(created_at, id)` **kèm dấu vân bộ lọc**. Rác, hoặc sinh ra ở một bộ lọc
     * khác → 400 (`CHAT-ERR-016`), KHÔNG im lặng rơi về trang đầu và KHÔNG im lặng trả sai trang.
     */
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    /** Lọc theo NGƯỜI đọc-vượt. Khớp `audit_logs.actor_user_id`. */
    actorUserId: z.string().uuid().optional(),
    /** Ngày bắt đầu (BAO GỒM), theo **TZ công ty** — server quy đổi, xem `calendarDaySchema`. */
    from: calendarDaySchema.optional(),
    /** Ngày kết thúc (BAO GỒM), theo **TZ công ty**. */
    to: calendarDaySchema.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: "Khoảng ngày không hợp lệ — `from` phải nhỏ hơn hoặc bằng `to`.",
    path: ["from"],
  });
export type ChatOversightAuditQuery = z.infer<typeof chatOversightAuditQuerySchema>;

/**
 * Một dòng nhật ký đọc-vượt: **ai · phòng nào · lúc nào · thành công/từ chối** (SPEC-15 §9 CHAT-SCREEN-008).
 *
 * `roomId`/`roomCode`/`roomName` NULL với `018a` (tra danh sách — không có phòng đích) và với dòng
 * `Denied` không mang `:id` trên URL.
 */
export const chatOversightAuditEntrySchema = z.object({
  id: z.string().uuid(),
  actorUserId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  roomId: z.string().uuid().nullable(),
  roomCode: z.string().nullable(),
  roomName: z.string().nullable(),
  /**
   * BỐN giá trị của `audit_logs.result_status` (`audit.service.ts` `AUDIT_RESULT_STATUSES`) + `Unknown`.
   *
   * Đường đọc-vượt CHỈ ghi `Success` (service) và `Denied` (guard) — API-13 §5.3 giữ nguyên. Nhưng đây là
   * hợp đồng ĐỌC: nó phải tả đúng thứ có thể nằm trong cột, nếu không thì mapper buộc phải gộp, và gộp
   * `Failure`/`Error` vào `Denied` là **audit nói sai loại sự kiện** (S7-CHAT-CLEAN-2).
   * `Unknown` = dòng có `result_status` NULL/lạ (dữ liệu hỏng) — cố ý KHÔNG quy về `Success`.
   */
  resultStatus: z.enum(["Success", "Failure", "Denied", "Error", "Unknown"]),
  /** `018a` | `018b` | `018c` | `019` | `unknown` — để CHAT-SCREEN-008 nhãn hoá đúng loại truy cập. */
  endpoint: z.string().nullable(),
  /** Tiêu chí tìm của `018a` (`q`, `roomType`) — bằng chứng "đã tra cái gì". KHÔNG chứa nội dung tin. */
  criteria: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
});
export type ChatOversightAuditEntryDto = z.infer<typeof chatOversightAuditEntrySchema>;

/** Keyset — `{ data, nextCursor }`, KHÔNG đi qua `paginated()` (memory `apifetch-drops-pagination-bare-array`). */
export const chatOversightAuditResponseSchema = z.object({
  data: z.array(chatOversightAuditEntrySchema),
  nextCursor: z.string().nullable(),
});
export type ChatOversightAuditResponseDto = z.infer<typeof chatOversightAuditResponseSchema>;

// ═══════════ S7-CHAT-FE-1 — hai route KHÔNG trả `ChatRoomDto` ═══════════
//
// ⚠️ KHỐI APPEND ở CUỐI file — `contracts/src/chat.ts` là hot-file của 6 WO trong wave S7.
//
// Đo thật trên master: `ChatRoomsService.leaveRoom` và `ChatMembersService.removeMember` trả
// `{ left: true }` / `{ removed: true }`, KHÔNG phải phòng. Client parse hai response đó bằng
// `chatRoomSchema` sẽ ăn `ZodError` (thiếu TOÀN BỘ field bắt buộc của phòng) — HTTP 200 mà UI vỡ, đúng
// lớp bẫy `server-masking-needs-optional-fe-schema` nhưng theo chiều "schema quá rộng cho payload hẹp".
//
// `z.literal(true)` chứ không `z.boolean()`: server không có nhánh nào trả `false`, nên một `false` lọt
// tới đây là hợp đồng đã trôi — phải nổ ở biên, không được im lặng đọc thành "đã rời phòng".

/** Kết quả `POST /chat/rooms/:id/leave` (CHAT-API-008) — KHÔNG phải `ChatRoomDto`. */
export const chatLeaveRoomResultSchema = z.object({ left: z.literal(true) });
export type ChatLeaveRoomResultDto = z.infer<typeof chatLeaveRoomResultSchema>;

/** Kết quả `DELETE /chat/rooms/:id/members/:userId` (CHAT-API-007d) — KHÔNG phải `ChatRoomDto`. */
export const chatRemoveMemberResultSchema = z.object({ removed: z.literal(true) });
export type ChatRemoveMemberResultDto = z.infer<typeof chatRemoveMemberResultSchema>;

// ═══════════ S7-CHAT-BE-8 — presign upload own-scope của CHAT (SPEC-15 §13.5 bước 1-2) ═══════════
//
// ⚠️ KHỐI APPEND ở CUỐI file (hot-file của wave S7).
//
// Chỉ có INPUT ở đây. Response của `POST /chat/files/upload-url` và `POST /chat/files/:id/confirm` TÁI
// DÙNG NGUYÊN VĂN `registerFileResponseSchema` / `confirmUploadResponseSchema` (`contracts/files.ts`):
// hai route này là wrapper own-scope quanh CHÍNH `FileService.upload/confirmUpload`, nên khai schema
// response riêng là dựng bản sao thứ hai của cùng một hợp đồng — và bản sao sẽ trôi lần đầu FOUNDATION
// thêm một trường (mirror lý do `chat-file.constants.ts` uỷ quyền `isAttachableFile` sang FOUNDATION).

/**
 * `POST /api/v1/chat/files/upload-url` body — đăng ký MỘT tệp Private owned-by-token để chuẩn bị đính
 * kèm vào tin nhắn (gate `send:chat-message`).
 *
 * ⚠️ **HẸP HƠN `uploadFileInputSchema` CÓ CHỦ ĐÍCH** — 3 trường, không hơn:
 *   • `visibility` KHÔNG nhận từ client (server ép `'Private'`): nhận vào là để client tự khai `Public`;
 *   • `moduleCode`/`entityType`/`entityId` KHÔNG nhận: chúng đi thẳng vào `audit_logs`/`file_access_logs`
 *     của `FileService.upload`, nên nhận vào là để client tự khai tệp của mình thuộc entity module khác
 *     trong dấu vết điều tra. Tin nhắn lúc này còn CHƯA TỒN TẠI — `file_links` do CHAT tạo trong cùng
 *     transaction với INSERT tin (§13.5 bước 3), client không được tự gắn.
 *
 * `originalName` PHẢI mang đuôi khớp `declaredMimeType`, và MIME phải ∈ allowlist `system_settings` —
 * `FileService.upload` re-validate cả hai (FOUNDATION-FILE-ERR-EXTENSION / -MIME / -SIZE / -BLOCKED).
 */
export const chatFileUploadUrlInputSchema = z.object({
  originalName: z.string().trim().min(1).max(500),
  declaredMimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
});
export type ChatFileUploadUrlInput = z.infer<typeof chatFileUploadUrlInputSchema>;

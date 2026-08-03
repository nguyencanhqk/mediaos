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
});
export type ChatRoomDto = z.infer<typeof chatRoomSchema>;

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
  /**
   * ⚠️ HAI CỘT KHAI TỬ. Đính kèm đi qua FOUNDATION Files + `file_links` (SPEC-15 §13.5,
   * `S7-CHAT-BE-3`) — KHÔNG ghi vào `chat_messages.file_url/file_name` nữa. Đường đọc trả `null`.
   * Giữ khoá trong DTO để FE cũ không vỡ; bỏ hẳn ở đợt dọn sau.
   */
  fileUrl: z.string().nullable(),
  fileName: z.string().nullable(),
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
  seq: z.number().int().nonnegative(),
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

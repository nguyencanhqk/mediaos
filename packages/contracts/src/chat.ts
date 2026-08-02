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
  memberUserIds: z.array(z.string().uuid()).default([]),
});
export type CreateChatRoomRequest = z.infer<typeof createChatRoomSchema>;

// G10-1: kiểu tin nhắn — text mặc định, file đính kèm (fileUrl/fileName).
export const chatMessageTypeSchema = z.enum(["text", "file"]);
export type ChatMessageType = z.infer<typeof chatMessageTypeSchema>;

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
  body: z.string(),
  messageType: chatMessageTypeSchema,
  fileUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  mentions: z.array(z.string().uuid()),
  pinnedAt: z.string().datetime().nullable(),
  pinnedBy: z.string().uuid().nullable(),
  /**
   * ⚠️ NỢ CHƯA TRẢ — KHÔNG dùng field này khi dựng `S7-CHAT-BE-2`.
   *
   * `chat_messages.seq` là `GENERATED ALWAYS AS IDENTITY` **cấp BẢNG**: tăng xuyên MỌI phòng và MỌI
   * tenant. Comment cũ ở đây ("thứ tự tổng trong room", chép từ `0050:79`) đã bị `0539` bác — xem
   * SPEC-15 §13.1 ĐÍNH CHÍNH 02/08/2026. Lộ nó ra client = thành viên một phòng suy được lưu lượng tin
   * TOÀN CÔNG TY giữa hai lần mình nhắn, gồm cả DM họ không thuộc.
   *
   * `S7-CHAT-DB-2` chốt "DTO/contracts KHÔNG trả `seq`" nhưng chỉ kịp sửa `chatRoomSchema`. Field này
   * còn đây vì bỏ nó là quyết định hình dạng DTO tin nhắn — thuộc `S7-CHAT-BE-2`, WO dựng endpoint tin
   * nhắn. `S7-CHAT-BE-1` KHÔNG có endpoint nào trả tin nhắn nên chưa rò gì ra client.
   *
   * ⇒ BE-2 phải thay bằng `roomSeq` (per-room, liên tục từ 1) cho MỌI thứ hướng-client: con trỏ
   * `beforeSeq`/`afterSeq`, đếm chưa đọc, "đã xem bởi".
   */
  seq: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

export const sendMessageSchema = z.object({
  body: z.string().min(1).max(4000),
  messageType: chatMessageTypeSchema.default("text"),
  fileUrl: z.string().url().max(2000).optional(),
  fileName: z.string().max(255).optional(),
  /** userId được mention — server kiểm membership trước khi tạo notification `mentioned`. */
  mentions: z.array(z.string().uuid()).max(20).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageSchema>;

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

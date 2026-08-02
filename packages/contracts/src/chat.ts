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
  /** Số tin chưa đọc của người gọi = lastMessageSeq − lastReadSeq (SPEC-15 §13.2). */
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
  /** seq = bigint GENERATED ALWAYS AS IDENTITY — thứ tự tổng trong room (ordering ổn định hơn createdAt). */
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
});
export type ChatRoomMemberDto = z.infer<typeof chatRoomMemberSchema>;

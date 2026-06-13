import { z } from "zod";

// G10-1: mở rộng room_type (project/direct giữ nguyên + group/channel/department cho auto-room G10-2).
export const chatRoomTypeSchema = z.enum([
  "project",
  "direct",
  "group",
  "channel",
  "department",
]);
export type ChatRoomType = z.infer<typeof chatRoomTypeSchema>;

export const chatRoomSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  refId: z.string().uuid().nullable(),
  roomType: chatRoomTypeSchema,
  name: z.string(),
  createdAt: z.string().datetime(),
});
export type ChatRoomDto = z.infer<typeof chatRoomSchema>;

export const createChatRoomSchema = z.object({
  name: z.string().min(1).max(200),
  roomType: chatRoomTypeSchema.default("direct"),
  refId: z.string().uuid().optional(),
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

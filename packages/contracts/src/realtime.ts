import { z } from "zod";
import { chatMessageSchema } from "./chat";
import { notificationSchema } from "./notification";

/**
 * Realtime (G10-1) — hợp đồng WS giữa api ↔ web (Socket.IO namespace `/ws`).
 *
 * BẤT BIẾN (CLAUDE.md §5): payload server→client PHẢI là output của `.parse()` các schema dưới đây
 * (cùng DTO/masking layer như REST) — CẤM `io.emit` thẳng row DB. Schema Zod mặc định strip key thừa,
 * nên parse-trước-emit vừa validate vừa mask.
 */

export const WS_NAMESPACE = "ws";

/** Tên event WS — dùng chung 2 phía, không hard-code chuỗi rải rác. */
export const WS_EVENTS = {
  // client → server (có ack)
  CHAT_JOIN: "chat:join",
  CHAT_LEAVE: "chat:leave",
  CHAT_SEND: "chat:send",
  CHAT_TYPING: "chat:typing",
  CHAT_PRESENCE_LIST: "chat:presence:list",
  // server → client
  CHAT_MESSAGE: "chat:message",
  CHAT_TYPING_EVENT: "chat:typing:event",
  CHAT_PRESENCE: "chat:presence",
  NOTIFICATION_NEW: "notification:new",
} as const;
export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

// ─── client → server payloads ────────────────────────────────────────────────
// LƯU Ý: KHÔNG có companyId/userId trong payload client — server LUÔN lấy từ socket.data.user
// (đã verify JWT ở handshake). Client gửi companyId = vô nghĩa, server không bao giờ đọc.

export const wsChatJoinSchema = z.object({
  roomId: z.string().uuid(),
});
export type WsChatJoinRequest = z.infer<typeof wsChatJoinSchema>;

export const wsChatLeaveSchema = z.object({
  roomId: z.string().uuid(),
});
export type WsChatLeaveRequest = z.infer<typeof wsChatLeaveSchema>;

export const wsChatSendSchema = z.object({
  roomId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  /** Danh sách userId được mention — server kiểm membership trước khi tạo notification. */
  mentions: z.array(z.string().uuid()).max(20).optional(),
});
export type WsChatSendRequest = z.infer<typeof wsChatSendSchema>;

export const wsChatTypingSchema = z.object({
  roomId: z.string().uuid(),
  isTyping: z.boolean(),
});
export type WsChatTypingRequest = z.infer<typeof wsChatTypingSchema>;

export const wsChatPresenceListSchema = z.object({
  roomId: z.string().uuid(),
});
export type WsChatPresenceListRequest = z.infer<typeof wsChatPresenceListSchema>;

// ─── server → client payloads (masking layer) ───────────────────────────────

/** chat:message — đúng DTO REST (chatMessageSchema), không hơn không kém. */
export const wsChatMessageEventSchema = chatMessageSchema;
export type WsChatMessageEvent = z.infer<typeof wsChatMessageEventSchema>;

export const wsChatTypingEventSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  isTyping: z.boolean(),
});
export type WsChatTypingEvent = z.infer<typeof wsChatTypingEventSchema>;

export const wsChatPresenceEventSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  status: z.enum(["online", "offline"]),
});
export type WsChatPresenceEvent = z.infer<typeof wsChatPresenceEventSchema>;

/** notification:new — đúng DTO REST (notificationSchema). */
export const wsNotificationEventSchema = notificationSchema;
export type WsNotificationEvent = z.infer<typeof wsNotificationEventSchema>;

// ─── ack chuẩn cho mọi event client → server ─────────────────────────────────

export const wsAckSchema = z.object({
  ok: z.boolean(),
  /** Mã lỗi ngắn khi ok=false (không leak chi tiết nội bộ). */
  error: z.string().optional(),
});
export type WsAck = z.infer<typeof wsAckSchema>;

export const wsChatSendAckSchema = wsAckSchema.extend({
  data: chatMessageSchema.optional(),
});
export type WsChatSendAck = z.infer<typeof wsChatSendAckSchema>;

export const wsPresenceListAckSchema = wsAckSchema.extend({
  userIds: z.array(z.string().uuid()).optional(),
});
export type WsPresenceListAck = z.infer<typeof wsPresenceListAckSchema>;

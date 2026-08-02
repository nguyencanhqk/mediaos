import { createZodDto } from "nestjs-zod";
import {
  addChatMemberSchema,
  chatMarkReadSchema,
  createChatRoomSchema,
  listChatMessagesQuerySchema,
  listChatRoomsQuerySchema,
  openDirectRoomSchema,
  sendMessageSchema,
  updateChatMemberSchema,
  updateChatRoomSchema,
} from "@mediaos/contracts";

/**
 * S7-CHAT-BE-1 — DTO biên module CHAT. Nguồn sự thật = Zod ở `@mediaos/contracts/chat`
 * (createZodDto → validate qua `ZodValidationPipe` khai ở controller).
 */

/** GET /chat/rooms (view:chat-room) — lọc `type`/`archived`. */
export class ListChatRoomsQueryDto extends createZodDto(listChatRoomsQuerySchema) {}

/** POST /chat/rooms (create:chat-room) — CHỈ phòng nhóm (`roomType` khoá `z.literal("group")`). */
export class CreateChatRoomDto extends createZodDto(createChatRoomSchema) {}

/** POST /chat/rooms/direct (create:chat-room) — idempotent theo `direct_key`. */
export class OpenDirectRoomDto extends createZodDto(openDirectRoomSchema) {}

/** PATCH /chat/rooms/:id (update:chat-room) — tên/mô tả, cần ít nhất một trường. */
export class UpdateChatRoomDto extends createZodDto(updateChatRoomSchema) {}

/** POST /chat/rooms/:id/members (manage:chat-member). */
export class AddChatMemberDto extends createZodDto(addChatMemberSchema) {}

/** PATCH /chat/rooms/:id/members/:userId (manage:chat-member). */
export class UpdateChatMemberDto extends createZodDto(updateChatMemberSchema) {}

// ── S7-CHAT-BE-2 — tin nhắn (CHAT-API-009, 010, 014) ────────────────────────────

/** GET /chat/rooms/:id/messages (view:chat-room) — `z.coerce` ⇒ idempotent khi pipe chạy 2 lần. */
export class ListChatMessagesQueryDto extends createZodDto(listChatMessagesQuerySchema) {}

/** POST /chat/rooms/:id/messages (send:chat-message) — `clientMessageId` BẮT BUỘC (idempotency). */
export class SendChatMessageDto extends createZodDto(sendMessageSchema) {}

/** POST /chat/rooms/:id/read (view:chat-room) — con trỏ chỉ tiến. */
export class ChatMarkReadDto extends createZodDto(chatMarkReadSchema) {}

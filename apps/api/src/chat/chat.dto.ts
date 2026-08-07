import { createZodDto } from "nestjs-zod";
import {
  addChatMemberSchema,
  chatFileUploadUrlInputSchema,
  chatMarkReadSchema,
  chatMuteRoomSchema,
  chatOversightAuditQuerySchema,
  chatOversightMessagesQuerySchema,
  chatOversightRoomQuerySchema,
  chatSearchQuerySchema,
  createChatRoomSchema,
  listChatMessagesQuerySchema,
  listChatRoomFilesQuerySchema,
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

// ── S8-CHAT-UX-BE-1 — tuỳ chọn per-phòng (CHAT-API-024a/b, 025, 020) ───────────

/**
 * PUT /chat/rooms/:id/mute (view:chat-room) — `{ mutedUntil }` **nullable, không optional**:
 * `null` là "bật lại thông báo", nên body rỗng không được phép trượt thành một thao tác hợp lệ.
 *
 * Ghim và đánh dấu chưa đọc KHÔNG có DTO — chúng không nhận body (id nằm ở path, giá trị do server đặt).
 */
export class ChatMuteRoomDto extends createZodDto(chatMuteRoomSchema) {}

// ── S7-CHAT-BE-3 — đính kèm (CHAT-API-017) ──────────────────────────────────────

/** GET /chat/rooms/:id/files (view:chat-room) — con trỏ `beforeSeq`, cấm offset. */
export class ListChatRoomFilesQueryDto extends createZodDto(listChatRoomFilesQuerySchema) {}

// ── S7-CHAT-BE-8 — presign upload own-scope (SPEC-15 §13.5 bước 1-2) ───────────

/**
 * POST /chat/files/upload-url (send:chat-message) — 3 trường, HẸP HƠN `uploadFileInputSchema` có chủ
 * đích: `visibility` server-set `'Private'`, và `moduleCode`/`entityType`/`entityId` KHÔNG nhận từ client
 * (chúng đi thẳng vào `audit_logs`/`file_access_logs`). Xem `chatFileUploadUrlInputSchema`.
 *
 * `/chat/files/:id/confirm` KHÔNG có DTO: body rỗng, `fileId` lấy từ route (`ParseUUIDPipe`).
 */
export class ChatFileUploadUrlDto extends createZodDto(chatFileUploadUrlInputSchema) {}

// ── S7-CHAT-BE-4 — tìm kiếm (CHAT-API-015) ──────────────────────────────────────

/**
 * GET /chat/search (view:chat-room) — `q` ≥2 ký tự sau `trim`+NFC, `roomId?`, con trỏ opaque.
 * `z.coerce` cho `limit` ⇒ idempotent khi pipe chạy 2 lần.
 */
export class ChatSearchQueryDto extends createZodDto(chatSearchQuerySchema) {}

// ── S7-CHAT-BE-7 🔒 — đọc-vượt membership (CHAT-API-018/019) ────────────────────
//
// ⚠️ `@UsePipes(ZodValidationPipe)` ở `ChatOversightController` là ĐIỀU KIỆN để 3 DTO dưới đây có tác
// dụng. Thiếu nó thì `q` không bị ép ≥2 ký tự và `limit` không bị chặn trần — tức hai trong ba vế làm
// `018a` "hẹp hơn liệt kê mọi phòng" (API-13 §5.3) biến thành trang trí.

/** GET /chat/oversight/rooms (view:chat-oversight) — `q` BẮT BUỘC ≥2 ký tự sau `trim`+NFC, trần trang. */
export class ChatOversightRoomQueryDto extends createZodDto(chatOversightRoomQuerySchema) {}

/** GET /chat/oversight/rooms/:id/messages — con trỏ RIÊNG, toàn dải `room_seq` (không `visible_from_seq`). */
export class ChatOversightMessagesQueryDto extends createZodDto(chatOversightMessagesQuerySchema) {}

/** GET /chat/oversight/audit — keyset con trỏ opaque (codec dùng chung `chat-search-cursor.ts`). */
export class ChatOversightAuditQueryDto extends createZodDto(chatOversightAuditQuerySchema) {}

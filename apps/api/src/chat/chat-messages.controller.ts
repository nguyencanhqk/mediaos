import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatMessagesService } from "./chat-messages.service";
import { ChatMessageModerationService } from "./chat-message-moderation.service";
import { ChatAttachmentPresignService } from "./chat-attachments.service";
import {
  ChatMarkReadDto,
  ListChatMessagesQueryDto,
  ListChatRoomFilesQueryDto,
  SendChatMessageDto,
} from "./chat.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CHAT-BE-2 — `ChatMessagesController` (CHAT-API-009..014, 016). Prefix `/chat`, cùng prefix với
 * `ChatRoomsController` — Nest gộp được, và tách file giữ mỗi controller ở kích thước đọc được.
 *
 * ⚠️ KHÔNG CÓ `@Patch`/`@Put` NÀO Ở ĐÂY — CÓ CHỦ ĐÍCH. Sửa nội dung tin nhắn KHÔNG hỗ trợ ở v1
 * (SPEC-15 §3.4 · CHAT-ERR-007), và điều đó được ép ở tận DB: `mediaos_app` KHÔNG có UPDATE cấp bảng
 * trên `chat_messages`, chỉ 4 cột `pinned_at`/`pinned_by`/`recalled_at`/`recalled_by`. Thêm route sửa
 * `body` sẽ 42501 lúc chạy chứ không âm thầm sửa — nhưng đừng thêm.
 *
 * ⚠️ THỨ TỰ ROUTE: `GET /chat/unread-count` khai TRƯỚC mọi route có tham số để chắc chắn không bị route
 * nào nuốt nếu sau này có ai thêm `/chat/:something`.
 *
 * Cặp quyền theo API-13 §5.1 — LƯU Ý `send`/`recall`/`pin` × `chat-message` là ba cặp KHÁC nhau: một
 * người được gửi tin không đương nhiên được thu hồi tin người khác hay ghim.
 */
@Controller("chat")
@UsePipes(ZodValidationPipe)
export class ChatMessagesController {
  constructor(
    private readonly messages: ChatMessagesService,
    private readonly moderation: ChatMessageModerationService,
    // S7-CHAT-BE-3 (additive) — CHAT-API-017.
    private readonly attachments: ChatAttachmentPresignService,
  ) {}

  /** GET /chat/unread-count — CHAT-API-016. Tự-bound theo actor, không nhận roomId. */
  @Get("unread-count")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  unreadCount(@Req() req: AuthenticatedRequest) {
    return this.messages.unreadCount(req.user);
  }

  /** GET /chat/rooms/:id/messages — CHAT-API-009. Con trỏ `beforeSeq` XOR `afterSeq`, cấm offset. */
  @Get("rooms/:id/messages")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  listMessages(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListChatMessagesQueryDto,
  ) {
    return this.messages.listMessages(req.user, id, query);
  }

  /**
   * POST /chat/rooms/:id/messages — CHAT-API-010.
   *
   * `@HttpCode(200)` cho CẢ lần gửi đầu: endpoint idempotent theo `clientMessageId`, gọi lại phải cho
   * kết quả GIỐNG HỆT. 201-rồi-200 buộc client phân biệt hai lần gọi giống nhau — đúng thứ idempotency
   * dựng ra để xoá bỏ (mirror `POST /chat/rooms/direct` của BE-1).
   */
  @Post("rooms/:id/messages")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("send", "chat-message")
  sendMessage(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.messages.sendMessage(req.user, id, dto);
  }

  /**
   * GET /chat/rooms/:id/files — CHAT-API-017 (tab "Tệp" của phòng).
   *
   * Cặp `view:chat-room` — **TRÙNG NGUYÊN VĂN** cặp của `listMessages` và của
   * `ChatMessageFileResolver`. API-13 §6 nguyên tắc 3: `data_scope` là per-(permission, role), nên gắn
   * một cặp riêng cho tệp sẽ đẻ ra role "thấy tệp mà không đọc được tin" (hoặc ngược lại). Ba chỗ này
   * phải đổi cùng nhau hoặc không đổi chỗ nào.
   */
  @Get("rooms/:id/files")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  listRoomFiles(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListChatRoomFilesQueryDto,
  ) {
    return this.attachments.listRoomFiles(req.user, id, query);
  }

  /** GET /chat/rooms/:id/pinned — CHAT-API-013. */
  @Get("rooms/:id/pinned")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  listPinned(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.messages.listPinned(req.user, id);
  }

  /**
   * POST /chat/rooms/:id/read — CHAT-API-014. Cặp `view:chat-room`, KHÔNG phải `send:chat-message`:
   * đánh dấu đã đọc là thao tác trên trạng thái ĐỌC của chính mình. Gắn cặp gửi vào đây sẽ làm người chỉ
   * có quyền xem không bao giờ tắt được badge.
   */
  @Post("rooms/:id/read")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "chat-room")
  markRead(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChatMarkReadDto,
  ) {
    return this.messages.markRead(req.user, id, dto);
  }

  /** POST /chat/messages/:id/recall — CHAT-API-011. Người gửi ≤15 phút hoặc admin phòng nhóm. */
  @Post("messages/:id/recall")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("recall", "chat-message")
  recall(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.moderation.recall(req.user, id);
  }

  /** POST /chat/messages/:id/pin — CHAT-API-012a. Trần 20 tin ghim/phòng. */
  @Post("messages/:id/pin")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("pin", "chat-message")
  pin(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.moderation.pin(req.user, id);
  }

  /** DELETE /chat/messages/:id/pin — CHAT-API-012b. */
  @Delete("messages/:id/pin")
  @UseGuards(PermissionGuard)
  @RequirePermission("pin", "chat-message")
  unpin(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.moderation.unpin(req.user, id);
  }
}

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { meAvatarUploadUrlInputSchema, setMeAvatarInputSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatRoomAvatarService } from "./chat-room-avatar.service";

class ChatRoomAvatarUploadUrlDto extends createZodDto(meAvatarUploadUrlInputSchema) {}
class SetChatRoomAvatarDto extends createZodDto(setMeAvatarInputSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S8-CHAT-UX-BE-2 — `ChatRoomAvatarController` (`CHAT-DEC-016`).
 *
 * Controller RIÊNG chứ không thêm route vào `ChatRoomsController`: ba route này là đường GHI TỆP (gọi
 * `FileService` bỏ qua gate `upload:foundation-file`), cùng lớp với `ChatFilesController` được tách ra
 * vì lý do y hệt. Đứng chung với CRUD phòng sẽ làm mờ đúng tính chất đó.
 *
 * MỌI route gate `('update','chat-room')` — cặp ĐÃ SEED (`0538:410`), grant sẵn cho cả 4 role canonical
 * @Company ⇒ **không cặp quyền mới, không migration quyền**. Cặp này chỉ là cổng module; ai thực sự
 * được đổi ảnh do `ChatRoomAvatarService.assertCanSetAvatarTx` quyết theo `room_type` (CHAT-DEC-016).
 *
 * `:id` là `@Param` nhưng KHÔNG IDOR: `assertMember` + RLS khoá tenant/membership, và người ngoài phòng
 * nhận **404** hằng (`CHAT-ERR-001`) chứ không phải 403.
 *
 * Tái dùng `meAvatarUploadUrlInputSchema`/`setMeAvatarInputSchema` (mirror `HrEmployeeAvatarController`):
 * hình dạng đầu vào của "đăng ký ảnh + gắn ảnh" giống hệt nhau ở cả ba chỗ. Nhân bản schema chỉ để đổi
 * tên là thêm một bản sao sẽ trôi.
 */
@Controller("chat")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ChatRoomAvatarController {
  constructor(private readonly svc: ChatRoomAvatarService) {}

  /** `POST /api/v1/chat/rooms/:id/avatar/upload-url` → `{fileId, uploadUrl, expiresAt}`. */
  @Post("rooms/:id/avatar/upload-url")
  @RequirePermission("update", "chat-room")
  createUploadUrl(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ChatRoomAvatarUploadUrlDto,
  ) {
    return this.svc.createUploadUrl(req.user, id, dto);
  }

  /**
   * `POST /api/v1/chat/rooms/:id/avatar` — gắn ảnh (confirm-if-pending gộp vào đây).
   * Trả `{fileId}`; FE tải lại danh sách/chi tiết phòng để lấy `avatarUrl` đã ký TƯƠI.
   */
  @Post("rooms/:id/avatar")
  @RequirePermission("update", "chat-room")
  setRoomAvatar(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: SetChatRoomAvatarDto,
  ) {
    return this.svc.setRoomAvatar(req.user, id, dto.fileId);
  }

  /** `DELETE /api/v1/chat/rooms/:id/avatar` — gỡ ảnh (idempotent: chưa có ảnh vẫn 204). */
  @Delete("rooms/:id/avatar")
  @HttpCode(204)
  @RequirePermission("update", "chat-room")
  async removeRoomAvatar(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.removeRoomAvatar(req.user, id);
  }
}

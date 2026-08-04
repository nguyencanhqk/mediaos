import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatFilesService } from "./chat-files.service";
import { ChatFileUploadUrlDto } from "./chat.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CHAT-BE-8 — `ChatFilesController` (SPEC-15 §13.5 bước 1-2 · CHAT-FUNC-007).
 *
 * Wrapper own-scope quanh `FileService`, cho phép người dùng THƯỜNG (không có `*:foundation-file`) tự
 * đưa tệp lên để đính kèm tin nhắn. Lý do đầy đủ + ba ranh giới không được nới: jsdoc `ChatFilesService`.
 *
 * ⚠️ **CẶP QUYỀN = `('send','chat-message')`, KHÔNG phải `view:chat-room`.** Đây là hai bước ĐẦU của
 * luồng GỬI tin: người chỉ có quyền xem không được tạo tệp mới trong tenant. Cặp này TRÙNG NGUYÊN VĂN cặp
 * mà `ChatMessageFileResolver.canLink` hỏi lúc gắn link (§13.5 bước 3) — ba chỗ (upload · confirm ·
 * canLink) phải đổi cùng nhau hoặc không đổi chỗ nào, nếu không sẽ đẻ ra role "tải lên được mà gắn
 * không được" (API-13 §6 nguyên tắc 3: `data_scope` là per-(permission, role)).
 *
 * ⚠️ **KHÔNG nhận `roomId`.** Tệp ở bước này chưa gắn vào tin nào ⇒ chưa thuộc phòng nào. Membership
 * được kiểm ở đúng một chỗ: `sendMessage` (`assertMember` + `findOwnedFiles`). Thêm một vế membership ở
 * đây là dựng bản sao thứ hai của luật `ChatAccessService` — đúng thứ module này sinh ra để không có.
 *
 * ⚠️ `@UseGuards(PermissionGuard)` khai per-route: guard là **opt-in** ở dự án này (KHÔNG `APP_GUARD`),
 * quên một dòng là route MỞ cho mọi user đã đăng nhập, IM LẶNG. `chat.permissions.spec.ts` gác đúng chỗ
 * đó — controller này PHẢI có mặt trong hằng `CHAT_CONTROLLERS` của spec ấy.
 */
@Controller("chat/files")
@UsePipes(ZodValidationPipe)
export class ChatFilesController {
  constructor(private readonly svc: ChatFilesService) {}

  /**
   * POST /api/v1/chat/files/upload-url — đăng ký tệp Private owned-by-token → `{fileId, uploadStatus,
   * uploadUrl, expiresAt}`. Client PUT bytes thẳng lên storage rồi gọi `/confirm`.
   *
   * `@HttpCode(200)`: đây là bước cấp URL, không phải tạo tài nguyên nghiệp vụ mà client giữ tham chiếu
   * lâu dài — mirror `POST /me/avatar/upload-url` (200) và giữ FE chỉ phải đổi đường dẫn, không đổi cách
   * đọc mã trạng thái (`/foundation/files/upload` cũ cũng trả 200 qua `@HttpCode`).
   */
  @Post("upload-url")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("send", "chat-message")
  createUploadUrl(@Req() req: AuthenticatedRequest, @Body() dto: ChatFileUploadUrlDto) {
    return this.svc.createUploadUrl(req.user, dto);
  }

  /**
   * POST /api/v1/chat/files/:id/confirm — xác nhận bytes đã lên (flip `Pending → Uploaded`).
   *
   * Body RỖNG `{}` (fileId lấy từ route). Owner-check chạy TRƯỚC khi chạm storage — xem
   * `ChatFilesService.confirmOwnUpload`. 200 idempotent khi tệp đã `Uploaded`.
   */
  @Post(":id/confirm")
  @HttpCode(200)
  @UseGuards(PermissionGuard)
  @RequirePermission("send", "chat-message")
  confirmUpload(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.svc.confirmOwnUpload(req.user, id);
  }
}

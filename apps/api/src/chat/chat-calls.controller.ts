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
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { createChatCallSchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ChatCallsService } from "./chat-calls.service";

class CreateChatCallDto extends createZodDto(createChatCallSchema) {}

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S7-CALL-BE-1 — `CHAT-API-026..028`: vòng đời cuộc gọi qua **REST** (hàng rào **R4** của `CHAT-DEC-020`).
 *
 * ⚠️ `@UseGuards(PermissionGuard)` cấp CLASS là **bắt buộc**, không phải trang trí: `PermissionGuard`
 * **opt-in theo controller** ở repo này — thiếu dòng đó thì `@RequirePermission` bên dưới trở thành
 * metadata không ai đọc và cả 5 route mở toang cho mọi phiên đã đăng nhập, **không có test nào tự đỏ**.
 * `route-guard-coverage` là thứ duy nhất bắt được, và nó chỉ bắt được nếu census được regen.
 *
 * Cặp `('call','chat-room')` — seed + grant 4 role canonical ở mig `0546`. Cặp quyền là **cổng module**
 * ("được phép gọi điện hay không"); ai gọi được vào phòng NÀO do `assertMember`/`assertCallAccess` quyết
 * (SPEC-15 §3.2 — ranh giới là MEMBERSHIP, không phải data_scope).
 *
 * `:id` là `@Param` nhưng KHÔNG IDOR: người ngoài phòng nhận **404 hằng** (CHAT-ERR-001 cho trục phòng,
 * CHAT-ERR-026 cho trục cuộc gọi) chứ không phải 403 — 403 sẽ xác nhận đối tượng có tồn tại.
 *
 * ⚠️ **Không có route ĐỌC lịch sử cuộc gọi ở đây, và không được thêm.** SPEC-15 §15a: wave này không cấp
 * mã cho đường liệt kê; ai làm màn "nhật ký cuộc gọi" phải cấp mã mới (`CHAT-API-030`+) sau khi **đo lại**
 * dải trống — `030` đã bị `CHAT-ERR-030` chiếm ở trục mã lỗi, đừng suy ra trục API cũng còn trống.
 */
@Controller("chat")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ChatCallsController {
  constructor(private readonly svc: ChatCallsService) {}

  /** `POST /api/v1/chat/rooms/:id/calls` — mời (CHAT-API-026). 409 nếu phòng đang có cuộc gọi sống. */
  @Post("rooms/:id/calls")
  @RequirePermission("call", "chat-room")
  invite(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CreateChatCallDto,
  ) {
    return this.svc.invite(req.user, id, dto);
  }

  /**
   * `POST /api/v1/chat/calls/:id/accept` — nhận (CHAT-API-027). Chỉ người được mời.
   *
   * ⚠️ `@HttpCode(200)` ở CẢ BỐN route vòng đời dưới đây: mặc định của Nest cho `@Post` là **201
   * Created**, mà bốn thao tác này **không tạo tài nguyên nào** — chúng đổi trạng thái một hàng đã có.
   * Để nguyên 201 là nói dối về ngữ nghĩa với mọi client, và FE nào kiểm `status === 201` để biết "đã
   * tạo cuộc gọi" sẽ hiểu nhầm một cú gác máy là một cuộc gọi mới. Chỉ `invite` (026) giữ 201.
   */
  @Post("calls/:id/accept")
  @HttpCode(200)
  @RequirePermission("call", "chat-room")
  accept(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.svc.accept(req.user, id);
  }

  /** `POST /api/v1/chat/calls/:id/reject` — từ chối (CHAT-API-027). Chỉ khi còn đổ chuông. */
  @Post("calls/:id/reject")
  @HttpCode(200)
  @RequirePermission("call", "chat-room")
  reject(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.svc.reject(req.user, id);
  }

  /** `POST /api/v1/chat/calls/:id/cancel` — huỷ (CHAT-API-028). Chỉ người khởi tạo, chỉ khi chưa ai nhận. */
  @Post("calls/:id/cancel")
  @HttpCode(200)
  @RequirePermission("call", "chat-room")
  cancel(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.svc.cancel(req.user, id);
  }

  /** `POST /api/v1/chat/calls/:id/hangup` — kết thúc (CHAT-API-028). Bên nào cũng gác được. */
  @Post("calls/:id/hangup")
  @HttpCode(200)
  @RequirePermission("call", "chat-room")
  hangup(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.svc.hangup(req.user, id);
  }
}

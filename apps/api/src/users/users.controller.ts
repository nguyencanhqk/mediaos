import { Body, Controller, Patch, Req, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { UpdateProfileDto } from "./users.dto";
import { UsersService } from "./users.service";

/** Request đã qua JwtAuthGuard (global) — user gắn ở req.user. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

@Controller("users")
@UsePipes(ZodValidationPipe)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * Cập nhật hồ sơ của CHÍNH user (self-service, Module 2a). Authenticated (JwtAuthGuard global cấp req.user).
   * KHÔNG @RequirePermission: ai cũng được sửa hồ sơ CỦA MÌNH (service ép `WHERE id = self`, không chạm người
   * khác — PermissionGuard không global nên route này chỉ cần đăng nhập). Trả {ok:true}; FE refetch /auth/me.
   */
  @Patch("me")
  async updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ ok: true }> {
    await this.users.updateOwnProfile(
      { id: req.user.id, companyId: req.user.companyId },
      dto.fullName,
    );
    return { ok: true };
  }
}

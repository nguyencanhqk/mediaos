import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../permission/guards/jwt-auth.guard";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { LmsSsoService } from "./lms-sso.service";

type AuthRequest = Request & { user: AuthenticatedUser };

/**
 * GET /api/v1/integrations/lms/sso-link — trả { url } dẫn sang LMS kèm token SSO 60s.
 * Bảo vệ bởi bộ guard toàn cục (JWT + company + 2FA) + PermissionGuard cặp access:lms (§13):
 * quyền "mở LMS" thuộc hệ phân quyền MediaOS — admin cấp/thu theo vai trò. Mặc định 4 role canonical
 * đều có (seed 0508). Token chỉ phát cho CHÍNH email user (không nhận input).
 */
@Controller("integrations/lms")
@UseGuards(PermissionGuard)
export class LmsSsoController {
  constructor(private readonly ssoService: LmsSsoService) {}

  @Get("sso-link")
  @RequirePermission("access", "lms", { isSensitive: false })
  getSsoLink(@Req() req: AuthRequest): { url: string } {
    return this.ssoService.buildSsoUrl(req.user.email);
  }
}

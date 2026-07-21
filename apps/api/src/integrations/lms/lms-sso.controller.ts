import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../permission/guards/jwt-auth.guard";
import { LmsSsoService } from "./lms-sso.service";

type AuthRequest = Request & { user: AuthenticatedUser };

/**
 * GET /api/v1/integrations/lms/sso-link — trả { url } dẫn sang LMS kèm token SSO 60s.
 * Bảo vệ bởi bộ guard toàn cục (JWT + company + 2FA). KHÔNG gắn PermissionGuard:
 * mọi nhân viên đã đăng nhập đều được sang LMS (token chỉ phát cho CHÍNH email của họ,
 * user locked/nghỉ việc không đăng nhập được nên không lấy được token).
 */
@Controller("integrations/lms")
export class LmsSsoController {
  constructor(private readonly ssoService: LmsSsoService) {}

  @Get("sso-link")
  getSsoLink(@Req() req: AuthRequest): { url: string } {
    return this.ssoService.buildSsoUrl(req.user.email);
  }
}

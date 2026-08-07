import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../../permission/guards/jwt-auth.guard";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { SocialSsoService } from "./social-sso.service";

type AuthRequest = Request & { user: AuthenticatedUser };

/**
 * GET /api/v1/integrations/social/sso-link — trả { url } dẫn sang fbpost kèm token SSO 60s.
 *
 * Bảo vệ bởi bộ guard toàn cục (JWT + company + 2FA) + PermissionGuard cặp ('view','social-post').
 *
 * VÌ SAO GATE BẰNG `view:social-post` MÀ KHÔNG PHẢI MỘT CẶP `access:social` RIÊNG: mở app này nghĩa
 * là nhìn thấy các bài đã đăng/đang hẹn giờ của công ty — đúng cặp đó. Thêm một cặp "access" thứ tư
 * chỉ để mở cửa sẽ tạo ra tình trạng cấp được quyền vào mà không cấp quyền xem, tức một cánh cửa dẫn
 * vào phòng trống. Cặp này CŨNG là cặp mà ô "Đăng bài" ở FE dùng để ẩn/hiện — cổng màn-hình khớp
 * cổng đường-tải (memory read-path-gate-pair-must-match-download-pair).
 */
@Controller("integrations/social")
@UseGuards(PermissionGuard)
export class SocialSsoController {
  constructor(private readonly ssoService: SocialSsoService) {}

  @Get("sso-link")
  @RequirePermission("view", "social-post", { isSensitive: false })
  async getSsoLink(@Req() req: AuthRequest): Promise<{ url: string }> {
    // mintSsoLink = đường DUY NHẤT có audit (FAIL-CLOSED): token chỉ trả khi audit đã commit.
    return this.ssoService.mintSsoLink(req.user);
  }
}

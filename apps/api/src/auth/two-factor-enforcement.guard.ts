import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnv } from "../config/env.schema";
import { IS_PUBLIC } from "../permission/public.decorator";
import type { AuthRequest } from "../permission/guards/jwt-auth.guard";
import { ALLOW_WITHOUT_TWO_FACTOR } from "./two-factor-enforcement.decorator";
import { TwoFactorService } from "./two-factor.service";

/** Mã máy-đọc-được để FE redirect tới luồng thiết lập 2FA (KHÔNG hard-code message ở client). */
export const TWO_FACTOR_SETUP_REQUIRED = "TWO_FACTOR_SETUP_REQUIRED";

/**
 * TwoFactorEnforcementGuard — ÉP server-side (G16-1b): user có role `requires_two_factor` nhưng CHƯA enroll
 * 2FA bị DENY mọi tài nguyên được bảo vệ, KHÔNG chỉ là cờ tư vấn `mustSetupTwoFactor` (me()). Chạy SAU
 * JwtAuthGuard + CompanyGuard (cần `req.user`). Route @Public() hoặc @AllowWithoutTwoFactor() được bỏ qua
 * (nếu không user sẽ deadlock — không có đường enroll). Ném 403 + `code:TWO_FACTOR_SETUP_REQUIRED` để FE redirect.
 *
 * Quyết định bằng DB (requiresTwoFactor && !isEnabled) chứ KHÔNG dựa claim trong JWT — claim có thể cũ
 * (role đổi sau khi cấp token); enforcement phải phản ánh trạng thái role HIỆN TẠI.
 */
@Injectable()
export class TwoFactorEnforcementGuard implements CanActivate {
  private readonly enabled = loadEnv().TWO_FACTOR_ENFORCEMENT_ENABLED === "true";

  constructor(
    private readonly reflector: Reflector,
    private readonly twoFactor: TwoFactorService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Kill-switch (G16-1b): default BẬT. Tắt chỉ ở harness e2e cũ (admin mock chưa enroll) qua env.
    if (!this.enabled) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;
    const allowWithout = this.reflector.getAllAndOverride<boolean>(ALLOW_WITHOUT_TWO_FACTOR, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (allowWithout) return true;

    // WS: APP_GUARD chạy cho gateway handler — không HTTP request. 2FA enforcement chỉ áp REST tài nguyên.
    if (ctx.getType() !== "http") return true;

    const req = ctx.switchToHttp().getRequest<Partial<AuthRequest>>();
    const user = req.user as (AuthRequest["user"] & { viaApiKey?: boolean }) | undefined;
    if (!user) return true; // JwtAuthGuard đã ném nếu thiếu — không double-throw ở đây.

    // AC-5: PAT request (viaApiKey) bỏ qua enrollment 2FA. PAT KHÔNG phải phiên người tương tác (không có
    // bước nhập TOTP); bảo mật PAT nằm ở scope∩grant + revoke + TTL. Cấp PAT lại đòi manage:api-key (sensitive)
    // — đường cấp key đã qua phiên người (có 2FA). Đây KHÔNG phải bypass: scope∩grant vẫn ép ở PermissionGuard.
    if (user.viaApiKey) return true;

    const required = await this.twoFactor.requiresTwoFactor(user.id, user.companyId);
    if (!required) return true;
    const enabled = await this.twoFactor.isEnabled(user.id, user.companyId);
    if (enabled) return true;

    // Bị ép 2FA + chưa enroll → DENY. Payload mang `code` để FE redirect (không render message hard-code).
    throw new ForbiddenException({
      code: TWO_FACTOR_SETUP_REQUIRED,
      message: "Bạn phải thiết lập xác thực 2 bước (2FA) trước khi tiếp tục.",
    });
  }
}

import type {
  AuthTokens,
  LoginResponse,
  MeResponse,
  TwoFactorEnrollResponse,
  TwoFactorStatus,
} from "@mediaos/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { AuthService, type RequestMeta } from "./auth.service";
import {
  ForgotPasswordDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  TwoFactorDisableDto,
  TwoFactorEnableDto,
  TwoFactorVerifyDto,
} from "./auth.dto";
import { TwoFactorService } from "./two-factor.service";
import { Public } from "../permission/public.decorator";
import { AllowWithoutTwoFactor } from "./two-factor-enforcement.decorator";

/** Request đã qua JwtAuthGuard (global) — user gắn ở req.user. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

// @AllowWithoutTwoFactor ở cấp controller: TẤT CẢ route auth (me/2fa enroll/enable/disable/status) phải
// reachable DÙ user bị ép 2FA mà chưa enroll — nếu không user deadlock (không có đường nào để enroll). Các
// route nghiệp vụ khác (payroll/media/…) KHÔNG có decorator này nên VẪN bị TwoFactorEnforcementGuard chặn.
@AllowWithoutTwoFactor()
@Controller("auth")
@UsePipes(ZodValidationPipe)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResponse> {
    return this.auth.login(dto, this.meta(req));
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string): Promise<MeResponse> {
    return this.auth.me(this.bearer(authorization));
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(202)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.auth.forgotPassword(dto, this.meta(req));
    // Phản hồi ĐỒNG NHẤT dù email tồn tại hay không (không lộ enumeration).
    return { ok: true };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ ok: true }> {
    await this.auth.resetPassword(dto);
    return { ok: true };
  }

  // ── 2FA TOTP (G16-1, AUTH-003) ────────────────────────────────────────────────

  /** Bước 2 login khi 2FA bật: challengeToken + mã (TOTP/recovery) → tokens. @Public (chưa có access token). */
  @Public()
  @Post("2fa/verify")
  @HttpCode(200)
  verifyTwoFactor(@Body() dto: TwoFactorVerifyDto, @Req() req: Request): Promise<AuthTokens> {
    return this.auth.completeTwoFactorLogin(dto.challengeToken, dto.code, this.meta(req));
  }

  /** Bắt đầu enroll 2FA cho chính user — trả otpauthUri (QR) + recovery codes (hiển thị 1 LẦN). */
  @Post("2fa/enroll")
  @HttpCode(200)
  enrollTwoFactor(@Req() req: AuthenticatedRequest): Promise<TwoFactorEnrollResponse> {
    return this.twoFactor.enroll(req.user.id, req.user.companyId);
  }

  /** Xác nhận bật 2FA: nhập mã TOTP hiện tại. Mã sai → 401. */
  @Post("2fa/enable")
  @HttpCode(200)
  async enableTwoFactor(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TwoFactorEnableDto,
  ): Promise<{ ok: true }> {
    await this.twoFactor.confirmEnable(req.user.id, req.user.companyId, dto.token);
    return { ok: true };
  }

  /** Tắt 2FA — re-auth bằng mật khẩu hiện tại. */
  @Post("2fa/disable")
  @HttpCode(200)
  async disableTwoFactor(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TwoFactorDisableDto,
  ): Promise<{ ok: true }> {
    await this.auth.disableTwoFactor(req.user, dto.password);
    return { ok: true };
  }

  /** Trạng thái 2FA của user hiện tại (đã bật + có bị ép). */
  @Get("2fa/status")
  twoFactorStatus(@Req() req: AuthenticatedRequest): Promise<TwoFactorStatus> {
    return this.twoFactor.status(req.user.id, req.user.companyId);
  }

  private meta(req: Request): RequestMeta {
    return { ip: req.ip, userAgent: req.headers["user-agent"] };
  }

  private bearer(authorization?: string): string {
    if (!authorization?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Thiếu access token.");
    }
    return authorization.slice("Bearer ".length).trim();
  }
}

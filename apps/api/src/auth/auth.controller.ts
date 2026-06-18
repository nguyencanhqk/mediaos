import type {
  AuthRefreshResponse,
  AuthTokens,
  LoginResponse,
  LogoutResponse,
  MeResponse,
  RedirectAllowedResponse,
  TwoFactorEnrollResponse,
  TwoFactorStatus,
} from "@mediaos/contracts";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, REFRESH_COOKIE_NAME } from "@mediaos/contracts";
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request, Response } from "express";
import { AuthService, type RequestMeta } from "./auth.service";
import { csrfTokensMatch, parseCookies } from "./cookie.util";
import { SessionCookieService } from "./session-cookie.service";
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
    private readonly cookies: SessionCookieService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login(dto, this.meta(req));
    // SSO: login trả tokens (KHÔNG phải challenge 2FA) → đặt refresh + CSRF cookie (web-core dùng cookie;
    // mobile/Bearer bỏ qua Set-Cookie). Body GIỮ NGUYÊN (tương thích ngược). Nhánh 2FA: cookie đặt ở /2fa/verify.
    if ("accessToken" in result) {
      this.setSessionCookies(res, result.refreshToken);
    }
    return result;
  }

  /**
   * FS-1a — refresh phiên. COOKIE-FIRST: nếu có refresh cookie → bắt buộc CSRF double-submit, xoay token
   * (rotation + reuse-detection ở service), phát cookie MỚI, trả {accessToken,expiresIn} (refresh token NẰM
   * TRONG cookie, KHÔNG body). Không cookie → luồng cũ body refreshToken (mobile/Bearer) trả AuthTokens đầy đủ.
   */
  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens | AuthRefreshResponse> {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[REFRESH_COOKIE_NAME];

    if (cookieToken) {
      this.assertCsrf(req, cookies);
      let tokens: AuthTokens;
      try {
        tokens = await this.auth.refresh(cookieToken);
      } catch (err) {
        // Thất bại (invalid/expired/reuse-detected) → xoá cookie buộc client login lại (rotation safety).
        this.clearSessionCookies(res);
        throw err;
      }
      this.setSessionCookies(res, tokens.refreshToken); // rotation: cookie refresh + CSRF MỚI
      return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn };
    }

    // Luồng cũ (mobile/Bearer): refreshToken trong body, KHÔNG cookie/CSRF. 401 chung (không lộ chế độ).
    if (!dto?.refreshToken) throw new UnauthorizedException("Phiên không hợp lệ.");
    return this.auth.refresh(dto.refreshToken);
  }

  /**
   * FS-1a — đăng xuất TOÀN CỤC: thu hồi cả họ refresh token + xoá cookie. COOKIE-based bắt buộc CSRF (chống
   * forced-logout CSRF). Idempotent: luôn 200 + xoá cookie kể cả khi không có phiên.
   */
  @Public()
  @Post("logout")
  @HttpCode(200)
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LogoutResponse> {
    const cookies = parseCookies(req.headers.cookie);
    const cookieToken = cookies[REFRESH_COOKIE_NAME];
    if (cookieToken) {
      this.assertCsrf(req, cookies);
      await this.auth.logout(cookieToken);
    } else if (dto?.refreshToken) {
      await this.auth.logout(dto.refreshToken);
    }
    this.clearSessionCookies(res);
    return { ok: true };
  }

  /**
   * FS-1a — kiểm `?redirect` theo allowlist origin (chống open-redirect). @Public: `apps/auth` gọi TRƯỚC khi
   * điều hướng. Server là nguồn allowlist DUY NHẤT. `target` chỉ trả khi hợp lệ (đã chuẩn hoá), ngược lại null.
   */
  @Public()
  @Get("redirect-allowed")
  redirectAllowed(@Query("redirect") redirect?: string): RedirectAllowedResponse {
    const target = this.cookies.resolveSafeRedirect(redirect);
    return { allowed: target !== null, target };
  }

  /**
   * @Public: endpoint định-danh CHÍNH CHỦ — TỰ verify access token trong handler (auth.me → verifyAccessToken
   * "any") để chấp nhận CẢ phiên operator lẫn tenant. Nếu để guard toàn cục chạy, JwtAuthGuard ép mặc định
   * audience='tenant' → token operator (aud=operator) bị 401 trước khi tới handler ("any" thành code chết).
   * @Public bỏ qua guard → handler tự verify (vẫn bắt buộc token hợp lệ; KHÔNG hạ bảo mật).
   */
  @Public()
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
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.auth.completeTwoFactorLogin(dto.challengeToken, dto.code, this.meta(req));
    // SSO: phiên thành công sau bước 2 → đặt refresh + CSRF cookie (mirror /login nhánh tokens).
    this.setSessionCookies(res, tokens.refreshToken);
    return tokens;
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

  // ── FS-1a SSO cookie helpers ──────────────────────────────────────────────────
  /** Đặt refresh (HttpOnly) + CSRF (đọc được) cookie cho phiên SSO. CSRF mới mỗi lần (login/2fa/refresh). */
  private setSessionCookies(res: Response, refreshToken: string): void {
    res.append("Set-Cookie", this.cookies.buildRefreshCookie(refreshToken));
    res.append("Set-Cookie", this.cookies.buildCsrfCookie(this.cookies.newCsrfToken()));
  }

  /** Xoá refresh + CSRF cookie (logout / refresh thất bại). */
  private clearSessionCookies(res: Response): void {
    res.append("Set-Cookie", this.cookies.clearRefreshCookie());
    res.append("Set-Cookie", this.cookies.clearCsrfCookie());
  }

  /**
   * Ép CSRF double-submit cho endpoint cookie-based (refresh/logout): header `x-csrf-token` PHẢI khớp cookie
   * CSRF (so hằng-thời-gian). Thiếu/sai → 403. Bảo vệ chống CSRF (kèm SameSite=Strict — defense-in-depth).
   */
  private assertCsrf(req: Request, cookies: Record<string, string>): void {
    const header = req.headers[CSRF_HEADER_NAME];
    const headerValue = Array.isArray(header) ? header[0] : header;
    if (!csrfTokensMatch(headerValue, cookies[CSRF_COOKIE_NAME])) {
      throw new ForbiddenException("CSRF token không hợp lệ.");
    }
  }
}

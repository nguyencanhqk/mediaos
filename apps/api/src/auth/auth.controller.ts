import type { AuthTokens, MeResponse } from "@mediaos/contracts";
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
import { ForgotPasswordDto, LoginDto, RefreshDto, ResetPasswordDto } from "./auth.dto";
import { Public } from "../permission/public.decorator";

@Controller("auth")
@UsePipes(ZodValidationPipe)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthTokens> {
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

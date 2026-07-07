import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import {
  AUTH_USER,
  type AuthUserDetailDto,
  type AuthUserDto,
  type AuthUserListDto,
  type AuthUserPasswordResetResultDto,
  type AuthUserTwoFactorResetDto,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AuthUsersService } from "./auth-users.service";
import {
  CreateAuthUserDto,
  ListAuthUsersQueryDto,
  LockAuthUserDto,
  UpdateAuthUserDto,
} from "./auth-users.dto";

/** Request đã qua JwtAuthGuard (global) — user gắn ở req.user. companyId LẤY TỪ JWT, KHÔNG từ body. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-AUTH-BE-3 — User admin API qua PermissionGuard. @Controller('auth/users') (prefix RIÊNG khỏi
 * users/admin ACCT-2 — KHÔNG va chạm route, surface song song).
 *
 * Gate trên CẶP CANONICAL từ seed 0444/0450 (KHÔNG legacy manage/suspend/delete-user):
 *   GET    /auth/users          → view:user
 *   GET    /auth/users/:id      → view:user
 *   POST   /auth/users          → create:user
 *   PATCH  /auth/users/:id      → update:user
 *   POST   /auth/users/:id/lock → lock:user
 *   POST   /auth/users/:id/unlock → unlock:user
 * §13: các pair này is_sensitive=false → KHÔNG khai isSensitive ở decorator (khớp catalog).
 */
@Controller("auth/users")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AuthUsersController {
  constructor(private readonly users: AuthUsersService) {}

  @Get()
  @RequirePermission(AUTH_USER.VIEW.action, AUTH_USER.VIEW.resource)
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListAuthUsersQueryDto,
  ): Promise<AuthUserListDto> {
    return this.users.listUsers(req.user, query);
  }

  @Get(":id")
  @RequirePermission(AUTH_USER.VIEW.action, AUTH_USER.VIEW.resource)
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AuthUserDetailDto> {
    return this.users.getUserDetail(req.user, id);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission(AUTH_USER.CREATE.action, AUTH_USER.CREATE.resource)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAuthUserDto): Promise<AuthUserDto> {
    return this.users.createUser(req.user, dto);
  }

  @Patch(":id")
  @RequirePermission(AUTH_USER.UPDATE.action, AUTH_USER.UPDATE.resource)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAuthUserDto,
  ): Promise<AuthUserDto> {
    return this.users.updateUser(req.user, id, dto);
  }

  @Post(":id/lock")
  @HttpCode(200)
  @RequirePermission(AUTH_USER.LOCK.action, AUTH_USER.LOCK.resource)
  lock(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: LockAuthUserDto,
  ): Promise<AuthUserDto> {
    return this.users.lockUser(req.user, id, dto.reason);
  }

  @Post(":id/unlock")
  @HttpCode(200)
  @RequirePermission(AUTH_USER.UNLOCK.action, AUTH_USER.UNLOCK.resource)
  unlock(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AuthUserDto> {
    return this.users.unlockUser(req.user, id);
  }

  /**
   * S2-AUTH-BE-12 — POST /auth/users/:id/2fa/reset: admin gỡ 2FA của target (xoá user_totp +
   * user_recovery_codes + thu hồi phiên). Gate CẶP CANONICAL reset-2fa:user is_sensitive=true (mig 0466) —
   * khai isSensitive để wildcard *:* KHÔNG thoả cổng. Self-reset cho phép. Cross-tenant/không tồn tại → 404.
   */
  @Post(":id/2fa/reset")
  @HttpCode(200)
  @RequirePermission(AUTH_USER.RESET_2FA.action, AUTH_USER.RESET_2FA.resource, {
    isSensitive: true,
  })
  resetTwoFactor(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AuthUserTwoFactorResetDto> {
    return this.users.resetTwoFactor(req.user, id);
  }

  /**
   * S2-AUTH-USEROPS-1 — DELETE /auth/users/:id: XÓA MỀM (deleted_at, khôi phục được — KHÔNG hard-delete,
   * BẤT BIẾN #2). Gate CẶP CANONICAL delete:user is_sensitive=true (mig 0476) — khai isSensitive để
   * wildcard *:* KHÔNG thoả cổng. Self-delete → 400. Cross-tenant/không tồn tại/đã xóa → 404.
   */
  @Delete(":id")
  @HttpCode(200)
  @RequirePermission(AUTH_USER.DELETE.action, AUTH_USER.DELETE.resource, { isSensitive: true })
  softDelete(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AuthUserDto> {
    return this.users.deleteUser(req.user, id);
  }

  /**
   * S2-AUTH-USEROPS-1 — POST /auth/users/:id/restore: KHÔI PHỤC user đã xóa mềm. Gate restore:user
   * is_sensitive=true (mig 0476). Row live/lạ/cross-tenant → 404; email đã bị chiếm bởi user live → 409.
   */
  @Post(":id/restore")
  @HttpCode(200)
  @RequirePermission(AUTH_USER.RESTORE.action, AUTH_USER.RESTORE.resource, { isSensitive: true })
  restore(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AuthUserDto> {
    return this.users.restoreUser(req.user, id);
  }

  /**
   * S2-AUTH-USEROPS-1 — POST /auth/users/:id/password/reset: admin đặt lại mật khẩu (temp password +
   * must_change_password + thu hồi mọi phiên). Gate reset-password:user is_sensitive=true (mig 0476).
   * Self → 400 (dùng change-password). Response chứa tempPassword ĐÚNG 1 LẦN — KHÔNG log (BẤT BIẾN #3).
   */
  @Post(":id/password/reset")
  @HttpCode(200)
  @RequirePermission(AUTH_USER.RESET_PASSWORD.action, AUTH_USER.RESET_PASSWORD.resource, {
    isSensitive: true,
  })
  resetPassword(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AuthUserPasswordResetResultDto> {
    return this.users.resetPassword(req.user, id);
  }
}

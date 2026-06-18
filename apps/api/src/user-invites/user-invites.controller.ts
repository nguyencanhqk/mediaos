import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import {
  APPROVE_USER_ACTION,
  INVITE_USER_ACTION,
  USER_INVITE_RESOURCE_TYPE,
  type AcceptInviteResult,
  type CreateUserInviteResult,
  type PendingInvitesDto,
  type UserInviteDto,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { Public } from "../permission/public.decorator";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AcceptInviteDto, CreateUserInviteDto } from "./user-invites.dto";
import { UserInvitesService } from "./user-invites.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * CS-10 Đối tượng: Mời / Duyệt / Kích hoạt user. companyId LẤY TỪ JWT (trừ accept — sessionless, resolve slug).
 *
 * Guard `invite:user` + `approve:user` SENSITIVE (is_sensitive=true cả seed lẫn decorator — chống *:* wildcard
 * bypass). accept @Public (token là auth — người được mời CHƯA có phiên).
 */
@Controller("users")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class UserInvitesController {
  constructor(private readonly invites: UserInvitesService) {}

  /** POST /users/invite — tạo lời mời + gửi email kích hoạt (best-effort). */
  @Post("invite")
  @RequirePermission(INVITE_USER_ACTION, USER_INVITE_RESOURCE_TYPE, { isSensitive: true })
  invite(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateUserInviteDto,
  ): Promise<CreateUserInviteResult> {
    return this.invites.invite(req.user, dto);
  }

  /** GET /users/pending — hàng đợi Chờ duyệt + Yêu cầu kích hoạt (pending + accepted). */
  @Get("pending")
  @RequirePermission(APPROVE_USER_ACTION, USER_INVITE_RESOURCE_TYPE)
  listPending(@Req() req: AuthenticatedRequest): Promise<PendingInvitesDto> {
    return this.invites.listPending(req.user.companyId);
  }

  /** POST /users/:id/approve — duyệt (tạo tài khoản ACTIVE). `:id` = invite id. */
  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermission(APPROVE_USER_ACTION, USER_INVITE_RESOURCE_TYPE, { isSensitive: true })
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<UserInviteDto> {
    return this.invites.approve(req.user, id);
  }

  /** POST /users/:id/reject — từ chối lời mời. `:id` = invite id. */
  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermission(APPROVE_USER_ACTION, USER_INVITE_RESOURCE_TYPE, { isSensitive: true })
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<UserInviteDto> {
    return this.invites.reject(req.user, id);
  }

  /** POST /users/activation/accept — SESSIONLESS (token là auth). Đặt mật khẩu, kích hoạt. */
  @Public()
  @Post("activation/accept")
  @HttpCode(200)
  accept(@Body() dto: AcceptInviteDto): Promise<AcceptInviteResult> {
    return this.invites.accept(dto);
  }
}

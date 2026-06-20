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
  ADMIN_USER_RESOURCE_TYPE,
  DELETE_USER_ACTION,
  MANAGE_USER_ACTION,
  SUSPEND_USER_ACTION,
  type AdminUserDto,
  type AdminUserListDto,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AdminUsersService } from "./admin-users.service";
import { ListUsersQueryDto, SuspendUserDto, UpdateUserDto } from "./users.dto";

/** Request đã qua JwtAuthGuard (global) — user gắn ở req.user. companyId LẤY TỪ JWT, KHÔNG từ body. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * ACCT-2 Module 2b — Admin user CRUD + suspend + soft-delete qua PermissionGuard.
 *
 * Prefix con `users/admin` (KHÔNG dùng `users` trần) — TRÁNH va chạm route với UserInvitesController
 * (cùng @Controller('users') với literal `pending`/`invite`/`activation`). UsersModule đăng ký TRƯỚC
 * UserInvitesModule trong AppModule ⇒ nếu để `GET users/:id` ở đây thì `/users/pending` sẽ khớp `:id`
 * (id='pending') → 400 nuốt route invite. Tách prefix con loại bỏ ambiguity hoàn toàn.
 *
 * Guard: list/get/update = manage:user (non-sensitive). suspend/reactivate/delete = is_sensitive=TRUE
 * (chống '*:*' wildcard bypass cổng nhạy cảm — khai ở CẢ seed 0430 lẫn decorator).
 */
@Controller("users/admin")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  /** GET /users/admin — danh sách (filter status?/q? + phân trang). */
  @Get()
  @RequirePermission(MANAGE_USER_ACTION, ADMIN_USER_RESOURCE_TYPE)
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListUsersQueryDto,
  ): Promise<AdminUserListDto> {
    return this.users.listUsers(req.user.companyId, query);
  }

  /** GET /users/admin/:id — chi tiết 1 user. */
  @Get(":id")
  @RequirePermission(MANAGE_USER_ACTION, ADMIN_USER_RESOURCE_TYPE)
  getOne(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserDto> {
    return this.users.getUser(req.user.companyId, id);
  }

  /** PATCH /users/admin/:id — sửa hồ sơ (fullName, non-sensitive). */
  @Patch(":id")
  @RequirePermission(MANAGE_USER_ACTION, ADMIN_USER_RESOURCE_TYPE)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<AdminUserDto> {
    return this.users.updateUser(req.user, id, dto);
  }

  /** POST /users/admin/:id/suspend — tạm khoá (SENSITIVE). */
  @Post(":id/suspend")
  @HttpCode(200)
  @RequirePermission(SUSPEND_USER_ACTION, ADMIN_USER_RESOURCE_TYPE, { isSensitive: true })
  suspend(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: SuspendUserDto,
  ): Promise<AdminUserDto> {
    return this.users.suspendUser(req.user, id, dto.reason);
  }

  /** POST /users/admin/:id/reactivate — mở khoá (SENSITIVE). */
  @Post(":id/reactivate")
  @HttpCode(200)
  @RequirePermission(SUSPEND_USER_ACTION, ADMIN_USER_RESOURCE_TYPE, { isSensitive: true })
  reactivate(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserDto> {
    return this.users.reactivateUser(req.user, id);
  }

  /** DELETE /users/admin/:id — XOÁ-MỀM (set deleted_at, KHÔNG hard-delete) (SENSITIVE). */
  @Delete(":id")
  @HttpCode(200)
  @RequirePermission(DELETE_USER_ACTION, ADMIN_USER_RESOURCE_TYPE, { isSensitive: true })
  remove(
    @Req() req: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserDto> {
    return this.users.softDeleteUser(req.user, id);
  }
}

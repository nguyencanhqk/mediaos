import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "./guards/permission.guard";
import { RequirePermission } from "./require-permission.decorator";
import { PermissionAdminService } from "./permission-admin.service";
import {
  AssignRoleDto,
  RemoveObjectPermissionDto,
  SetObjectPermissionDto,
} from "./permission-admin.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Permission mutation-path (G3-4 DoD) — quản lý phân quyền RUNTIME. CROWN JEWEL.
 *
 * MỌI route NHẠY CẢM (leo thang đặc quyền) ⇒ @RequirePermission isSensitive:true (PermissionGuard
 * fail-closed, KHÔNG kế thừa wildcard). Service ghi audit + emit `permission.changed` cùng tx.
 *   - assign-role:user                    → gán/thu role cho user.
 *   - grant-object-permission:permission  → set/xoá object-permission (seed 0037).
 */
@Controller("permissions")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PermissionAdminController {
  constructor(private readonly admin: PermissionAdminService) {}

  /** Gán role cho user. Idempotent (cùng role+expiry = no-op). */
  @Post("users/:userId/roles")
  @RequirePermission("assign-role", "user", { isSensitive: true })
  assignRole(
    @Req() req: AuthenticatedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.admin.assignRole(req.user, userId, dto);
  }

  /** Thu role khỏi user. */
  @Delete("users/:userId/roles/:roleId")
  @HttpCode(204)
  @RequirePermission("assign-role", "user", { isSensitive: true })
  revokeRole(
    @Req() req: AuthenticatedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Param("roleId", ParseUUIDPipe) roleId: string,
  ) {
    return this.admin.revokeRole(req.user, userId, roleId);
  }

  /** Set object-level permission override (insert/flip effect). */
  @Put("object")
  @RequirePermission("grant-object-permission", "permission", { isSensitive: true })
  setObjectPermission(@Req() req: AuthenticatedRequest, @Body() dto: SetObjectPermissionDto) {
    return this.admin.setObjectPermission(req.user, dto);
  }

  /** Xoá object-level permission override. */
  @Delete("object")
  @HttpCode(204)
  @RequirePermission("grant-object-permission", "permission", { isSensitive: true })
  removeObjectPermission(@Req() req: AuthenticatedRequest, @Body() dto: RemoveObjectPermissionDto) {
    return this.admin.removeObjectPermission(req.user, dto);
  }
}

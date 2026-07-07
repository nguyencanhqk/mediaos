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
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "./guards/permission.guard";
import { RequirePermission } from "./require-permission.decorator";
import { RoleAdminService } from "./role-admin.service";
import {
  AssignRolePermissionDto,
  CreateRoleDto,
  RevokeRolePermissionDto,
  UpdateRoleDto,
} from "./role-admin.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * RoleAdminController (S2-AUTH-BE-6) — role WRITE (create/update, KHÔNG sửa system role) + gán/gỡ
 * permission cho role. CROWN JEWEL.
 *
 *   - create/update:role       → tạo/sửa role company-scope (seed 0005, is_sensitive=false).
 *   - assign:permission        → gán/gỡ permission cho role (seed 0460, is_sensitive=true — ANTI-
 *                                 ESCALATION pin company-admin, KHÔNG kế thừa wildcard).
 */
@Controller("auth/roles")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class RoleAdminController {
  constructor(private readonly roleAdmin: RoleAdminService) {}

  /**
   * S2-AUTH-ROLEMEM-1 — thành viên active của role (tab Thành viên). READ-ONLY, gate view:user
   * (response = dữ liệu account-level như GET /auth/users). Thêm/gỡ member tái dùng
   * POST/DELETE /permissions/users/:userId/roles (assign-role:user isSensitive — KHÔNG mở surface mới).
   */
  @Get(":id/members")
  @RequirePermission("view", "user")
  listMembers(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.roleAdmin.listMembers(req.user, id);
  }

  @Post()
  @RequirePermission("create", "role")
  createRole(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoleDto) {
    return this.roleAdmin.createRole(req.user, dto);
  }

  @Patch(":id")
  @RequirePermission("update", "role")
  updateRole(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roleAdmin.updateRole(req.user, id, dto);
  }

  @Post(":id/permissions")
  @RequirePermission("assign", "permission", { isSensitive: true })
  assignPermission(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignRolePermissionDto,
  ) {
    return this.roleAdmin.assignPermissionToRole(req.user, id, dto);
  }

  @Delete(":id/permissions")
  @HttpCode(204)
  @RequirePermission("assign", "permission", { isSensitive: true })
  revokePermission(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RevokeRolePermissionDto,
  ) {
    return this.roleAdmin.revokePermissionFromRole(req.user, id, dto);
  }
}

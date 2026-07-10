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
  ApplyPermissionRuleDto,
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

  /**
   * S2-AUTH-PERMUX-1 — grants đã gán của role (RolePermissionsPage v2). READ-ONLY, gate
   * view:permission (cùng cặp catalog). Mutation vẫn qua POST/DELETE :id/permissions bên dưới.
   */
  @Get(":id/permissions")
  @RequirePermission("view", "permission")
  listRolePermissions(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.roleAdmin.listRolePermissions(req.user, id);
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

  /**
   * DELETE /auth/roles/:id — xoá MỀM role company-scope + CASCADE gỡ khỏi mọi thành viên (soft-delete
   * user_roles). Gate delete:role (seed 0005 is_sensitive=false — company-admin có sẵn ALLOW/Company).
   * system role → 400. Path 1-segment KHÔNG đụng ":id/permissions" (2-segment, revokePermission).
   */
  @Delete(":id")
  @RequirePermission("delete", "role")
  deleteRole(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.roleAdmin.deleteRole(req.user, id);
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

  /**
   * S2-AUTH-PERMRULE-1 — POST /auth/roles/:id/permissions/apply-rule: bung 1 LUẬT (match catalog ×
   * action-preset × scope) → grant khớp; dryRun=true xem trước (0 ghi), false áp qua assignPermissionToRole.
   * Gate assign:permission isSensitive (CÙNG cặp assign thủ công — KHÔNG mở cổng mới). Path 3-segment
   * KHÔNG đụng ":id/permissions" (2-segment) hay ":id" (delete role, 1-segment).
   */
  @Post(":id/permissions/apply-rule")
  // 200, KHÔNG 201: route không tạo tài nguyên tại URL của nó (dryRun trả preview, apply trả summary).
  @HttpCode(200)
  @RequirePermission("assign", "permission", { isSensitive: true })
  applyPermissionRule(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApplyPermissionRuleDto,
  ) {
    return this.roleAdmin.applyPermissionRuleToRole(req.user, id, dto);
  }
}

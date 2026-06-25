import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import {
  AUTH_PERMISSION,
  AUTH_ROLE,
  type PermissionListDto,
  type RoleListDto,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { PermissionGuard } from "./guards/permission.guard";
import { RequirePermission } from "./require-permission.decorator";
import { PermissionAdminRepository } from "./permission-admin.repository";

/** Request đã qua JwtAuthGuard (global) — user gắn ở req.user. companyId LẤY TỪ JWT. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-AUTH-BE-3 — read-only catalogs cho UI gán quyền.
 *   GET /auth/roles       → view:role        (own-tenant + system, LOẠI operator role)
 *   GET /auth/permissions → view:permission  (catalog global)
 *
 * Gate trên cặp canonical seed 0444 (view:role / view:permission), is_sensitive=false. CHỈ ĐỌC —
 * KHÔNG mutate, KHÔNG audit (đọc không phải hành động quan trọng). roles đọc qua withTenant (RLS lộ
 * own-tenant + company_id IS NULL); permissions là catalog no-RLS.
 */
@Controller("auth")
@UseGuards(PermissionGuard)
export class AuthRolesPermissionsController {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PermissionAdminRepository,
  ) {}

  @Get("roles")
  @RequirePermission(AUTH_ROLE.action, AUTH_ROLE.resource)
  async listRoles(@Req() req: AuthenticatedRequest): Promise<RoleListDto> {
    const roles = await this.db.withTenant(req.user.companyId, (tx) => this.repo.listRolesTx(tx));
    return { roles };
  }

  @Get("permissions")
  @RequirePermission(AUTH_PERMISSION.action, AUTH_PERMISSION.resource)
  async listPermissions(@Req() req: AuthenticatedRequest): Promise<PermissionListDto> {
    // Catalog GLOBAL no-RLS — đọc qua withTenant để giữ chốt DUY NHẤT (company_id GUC set; bảng không
    // có company_id nên RLS vô hại). Mirror PermissionService đọc catalog.
    const permissions = await this.db.withTenant(req.user.companyId, (tx) =>
      this.repo.listPermissionsTx(tx),
    );
    return { permissions };
  }
}

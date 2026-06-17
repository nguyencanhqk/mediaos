import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { ZodError } from "zod";
import { listModulesQuerySchema, toggleModuleRequestSchema } from "@mediaos/contracts";
import type { ToggleModuleRequest } from "@mediaos/contracts";
import type { Request } from "express";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { OperatorReauthGuard } from "./operator-reauth.guard";
import { ModuleRegistryService } from "./module-registry.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

function parseOr400<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.errors);
    }
    throw err;
  }
}

/**
 * ModuleRegistryController (AC-7) — operator (platform-admin) control-plane cho module-registry.
 *
 * Mọi route: @OperatorOnly (aud=operator; token tenant/legacy ⇒ 401) + PermissionGuard (fail-closed).
 * PUT toggle thêm OperatorReauthGuard (method-level, CHẠY TRƯỚC PermissionGuard) — step-up window theo
 * route :id (target tenant). Quyền:
 *   - GET catalog/list  → view:system-module
 *   - GET tenant modules → view:system-module
 *   - PUT toggle        → manage:module-toggle (is_sensitive=true, requiresReauth=true)
 *
 * Per-tenant bật/tắt CHÉO tenant = withTenant(:id) (KHÔNG escape-hatch — escape-hatch chỉ bảng companies).
 */
@Controller("admin/platform")
@OperatorOnly()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ModuleRegistryController {
  constructor(private readonly modules: ModuleRegistryService) {}

  /** Catalog module (paginate) — không gắn tenant cụ thể. */
  @Get("modules")
  @RequirePermission("view", "system-module")
  listCatalog(@Req() req: AuthenticatedRequest, @Query() query: Record<string, string>) {
    return this.modules.listCatalog(req.user.companyId, parseOr400(listModulesQuerySchema, query));
  }

  /** Catalog + trạng thái HIỆU LỰC của module cho 1 tenant (đọc từ FeatureFlagService). */
  @Get("companies/:id/modules")
  @RequirePermission("view", "system-module")
  getTenantModules(@Param("id", ParseUUIDPipe) id: string) {
    return this.modules.getTenantModules(id);
  }

  /** Bật/tắt 1 module cho 1 tenant (cross-tenant, step-up bắt buộc, atomic + audit). */
  @Put("companies/:id/modules/:moduleKey")
  @UseGuards(OperatorReauthGuard)
  @RequirePermission("manage", "module-toggle", { isSensitive: true, requiresReauth: true })
  setModuleEnabled(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("moduleKey") moduleKey: string,
    @Body() body: ToggleModuleRequest,
  ) {
    const dto = parseOr400(toggleModuleRequestSchema, body);
    return this.modules.setModuleEnabled(req.user, id, moduleKey, dto.enabled);
  }
}

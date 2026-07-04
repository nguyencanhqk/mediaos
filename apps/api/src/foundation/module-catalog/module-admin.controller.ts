import { Body, Controller, Get, Param, Patch, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { ModuleCatalogService } from "./module-catalog.service";
import { PatchModuleToggleDto } from "./module-toggle.dto";
import { ModuleToggleService } from "./module-toggle.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-FND-BE-1 / S2-FND-BE-8 — HTTP surface admin module-catalog (BACKEND-04 §9.3 / API-09). Global prefix 'api/v1'.
 *
 *  GET   /foundation/modules        (view:foundation-module)  — TẤT CẢ module (active + inactive) + cờ enabled.
 *  GET   /foundation/modules/:code  (view:foundation-module)  — detail 1 module; code lạ → 404.
 *  PATCH /foundation/modules/:code  (update:foundation-module, is_sensitive=TRUE) — bật/tắt module (S2-FND-BE-8).
 *
 * Cặp engine (seed mig 0435): `view:foundation-module` dòng 338 (is_sensitive=false → company-admin có qua
 * bulk-grant resource_type LIKE 'foundation-%'); `update:foundation-module` dòng 339 (is_sensitive=TRUE —
 * KHÔNG kế thừa qua wildcard '*:*'/super-admin, cần grant EXACT cặp; permission.service sensitive gate).
 * KHÔNG dùng nhãn FE cũng KHÔNG namespace cũ `read/update:module` (bài học pair-drift S1-FND-MODULE).
 * PermissionGuard opt-in (fail-closed). isSensitive: true tường minh (defense-in-depth + đồng bộ catalog).
 *
 * TÁCH controller RIÊNG (KHÔNG gộp vào ModuleCatalogController): my-apps là Authenticated-only (tự lọc theo
 * quyền user), admin catalog là gated. Đăng ký SAU ModuleCatalogController trong ModuleCatalogModule.controllers
 * ⇒ route TĨNH `modules/my-apps` khớp TRƯỚC route param `modules/:code` (Express match theo thứ tự) ⇒ my-apps
 * KHÔNG bị :code nuốt (không regress).
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class ModuleAdminController {
  constructor(
    private readonly catalog: ModuleCatalogService,
    private readonly toggle: ModuleToggleService,
  ) {}

  @Get("modules")
  @RequirePermission("view", "foundation-module")
  listModules(@Req() req: AuthenticatedRequest) {
    return this.catalog.getAllModules(req.user);
  }

  @Get("modules/:code")
  @RequirePermission("view", "foundation-module")
  getModuleDetail(@Req() req: AuthenticatedRequest, @Param("code") code: string) {
    return this.catalog.getModuleDetail(req.user, code);
  }

  @Patch("modules/:code")
  @RequirePermission("update", "foundation-module", { isSensitive: true })
  toggleModule(
    @Req() req: AuthenticatedRequest,
    @Param("code") code: string,
    @Body() dto: PatchModuleToggleDto,
  ) {
    return this.toggle.toggleModule(req.user, code, dto.enabled);
  }
}

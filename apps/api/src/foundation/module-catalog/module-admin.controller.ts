import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { ModuleCatalogService } from "./module-catalog.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-FND-BE-1 — HTTP surface admin module-catalog (BACKEND-04 §9.3 / API-09). Global prefix 'api/v1'.
 *
 *  GET /foundation/modules        (view:foundation-module) — TẤT CẢ module (active + inactive) + cờ enabled.
 *  GET /foundation/modules/:code  (view:foundation-module) — detail 1 module; code lạ → 404.
 *
 * Cặp engine `view:foundation-module` (seed mig 0435 dòng 338, is_sensitive=false → company-admin có qua
 * bulk-grant resource_type LIKE 'foundation-%') — KHÔNG dùng nhãn FE 'FOUNDATION.MODULE.VIEW' cũng KHÔNG
 * namespace cũ `read:module` (bài học pair-drift S1-FND-MODULE). PermissionGuard opt-in (fail-closed).
 *
 * TÁCH controller RIÊNG (KHÔNG gộp vào ModuleCatalogController): my-apps là Authenticated-only (tự lọc theo
 * quyền user), admin catalog là gated view:foundation-module. Đăng ký SAU ModuleCatalogController trong
 * ModuleCatalogModule.controllers ⇒ route TĨNH `modules/my-apps` khớp TRƯỚC route param `modules/:code`
 * (Express match theo thứ tự đăng ký) ⇒ my-apps KHÔNG bị :code nuốt (không regress).
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
export class ModuleAdminController {
  constructor(private readonly catalog: ModuleCatalogService) {}

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
}

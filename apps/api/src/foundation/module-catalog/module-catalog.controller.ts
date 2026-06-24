import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { ModuleCatalogService } from "./module-catalog.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S1-FND-MODULE-1 — HTTP surface cho module catalog (BACKEND-04 §9.3). Global prefix 'api/v1' (main.ts).
 *
 *  GET /foundation/modules/my-apps  (Authenticated) — app user được phép thấy ở Home Portal/App Switcher.
 *
 * "Authenticated" (KHÔNG permission cụ thể): controller KHÔNG gắn @UseGuards(PermissionGuard) ⇒ chỉ chuỗi
 * guard GLOBAL (JwtAuthGuard → CompanyGuard) chạy, cấp req.user. Endpoint TỰ lọc theo quyền user trong
 * service (mỗi app chỉ hiện nếu user có ≥1 quyền của module) — KHÔNG cần gate riêng. Mẫu giống auth
 * change-password (authenticated, KHÔNG @Public, KHÔNG @RequirePermission).
 */
@Controller("foundation")
export class ModuleCatalogController {
  constructor(private readonly catalog: ModuleCatalogService) {}

  @Get("modules/my-apps")
  myApps(@Req() req: AuthenticatedRequest) {
    return this.catalog.getMyApps(req.user);
  }
}

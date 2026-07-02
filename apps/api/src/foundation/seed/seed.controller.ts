import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { SeedTrackingService } from "./seed-tracking.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-FND-BE-2 — HTTP ops surface cho seed-run status (BACKEND-04 §11.8, DB-08 §8.12/8.13). Global prefix
 * 'api/v1' (main.ts). Global JwtAuthGuard + CompanyGuard đã set req.user; class-level PermissionGuard
 * opt-in (fail-closed).
 *
 *  GET /foundation/seeds  (view:foundation-seed) — trạng thái RUN batch seed tenant (status/checksum/
 *      last-run), READ-ONLY. WHITELIST — KHÔNG secret/payload.
 *
 * CẶP SEED THẬT (mig 0435, is_sensitive=TRUE — System-scope): view 'foundation-seed'. KHÔNG kế thừa qua
 * wildcard bulk-grant (sensitive) ⇒ phải cấp tường minh per-user; company-admin KHÔNG tự có. KHÔNG nhãn
 * FE 'FOUNDATION.SEED.VIEW', KHÔNG cặp 'manage'. `run:foundation-seed` là hành động RUN (KHÔNG thuộc WO này).
 *
 * companyId LẤY TỪ req.user (AuthContext) — BỎ QUA company_id client. Envelope do
 * ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller TRẢ DATA THÔ.
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
export class SeedController {
  constructor(private readonly seedTracking: SeedTrackingService) {}

  /** GET /foundation/seeds — trạng thái batch seed tenant (READ-ONLY, WHITELIST). */
  @Get("seeds")
  @RequirePermission("view", "foundation-seed", { isSensitive: true })
  list(@Req() req: AuthenticatedRequest) {
    return this.seedTracking.listBatches(req.user.companyId);
  }
}

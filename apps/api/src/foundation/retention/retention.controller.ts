import { Body, Controller, Get, Param, Patch, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { PatchRetentionPolicyDto, toRetentionPolicyView } from "./retention.dto";
import { RetentionService } from "./retention.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-FND-BE-3 (L3) — HTTP surface cho data-retention governance (BACKEND-11 §17.3/§17.4, DB-08 §8.11).
 * Global JwtAuthGuard + CompanyGuard (app.module) đã set req.user; class-level PermissionGuard opt-in
 * (fail-closed — mọi route @RequirePermission). Resource = 'foundation-retention' (seed mig 0435).
 *
 *  GET   /foundation/retention-policies      (view)   — liệt kê policy tenant (gồm disabled), WHITELIST view.
 *  PATCH /foundation/retention-policies/:id   (manage) — is_sensitive/System-scope: company-admin CÓ view
 *          NHƯNG KHÔNG có manage ⇒ 403. Cập nhật field mutable + audit CONFIG_UPDATE cùng tx; 0 row → 404.
 *
 * Envelope do ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller TRẢ DATA THÔ (KHÔNG tự bọc). Global
 * prefix 'api/v1' do main.ts.
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /** GET /foundation/retention-policies — mọi policy (deleted_at IS NULL, gồm disabled) của tenant. */
  @Get("retention-policies")
  @RequirePermission("view", "foundation-retention")
  async list(@Req() req: AuthenticatedRequest) {
    const rows = await this.retention.listPolicies(req.user.companyId);
    return rows.map(toRetentionPolicyView);
  }

  /**
   * PATCH /foundation/retention-policies/:id — is_sensitive=true (System-scope). Cập nhật field mutable +
   * audit-in-tx. 0 row → NotFound (service, fail-closed). actor = req.user.id (audit + updated_by).
   */
  @Patch("retention-policies/:id")
  @RequirePermission("manage", "foundation-retention", { isSensitive: true })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: PatchRetentionPolicyDto,
  ) {
    const updated = await this.retention.updatePolicy(req.user.companyId, id, dto, {
      id: req.user.id,
    });
    return toRetentionPolicyView(updated);
  }
}

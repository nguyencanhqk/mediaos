import { Body, Controller, Get, Param, Patch, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { PatchSequenceDto } from "./sequence.dto";
import { SequenceService } from "./sequence.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-FND-BE-2 — HTTP ops surface cho sequence_counters (BACKEND-04 §8.6, DB-08 §8.9). Global prefix
 * 'api/v1' (main.ts). Global JwtAuthGuard + CompanyGuard đã set req.user; class-level PermissionGuard
 * opt-in (fail-closed — mọi route @RequirePermission).
 *
 *  GET   /foundation/sequences          (view:foundation-sequence)   — list counter tenant (WHITELIST,
 *          KHÔNG current_value).
 *  GET   /foundation/sequences/:id/preview (view:foundation-sequence) — mã KẾ TIẾP, KHÔNG mutate
 *          (previewNextCodeById).
 *  PATCH /foundation/sequences/:id       (update:foundation-sequence) — sửa cấu hình + audit
 *          SequenceUpdated cùng tx; 0 row → 404.
 *
 * CẶP SEED THẬT (mig 0435, is_sensitive=false): view/update 'foundation-sequence' — company-admin có qua
 * bulk-grant resource_type LIKE 'foundation-%'. KHÔNG nhãn FE 'FOUNDATION.SEQUENCE.*', KHÔNG cặp 'manage'.
 *
 * companyId LẤY TỪ req.user (AuthContext) — BỎ QUA mọi company_id client gửi (chống cross-tenant). Envelope
 * {success,message,data,meta} do ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller TRẢ DATA THÔ.
 */
@Controller("foundation")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SequenceController {
  constructor(private readonly sequences: SequenceService) {}

  /** GET /foundation/sequences — mọi counter (deleted_at IS NULL) của tenant, WHITELIST view. */
  @Get("sequences")
  @RequirePermission("view", "foundation-sequence")
  list(@Req() req: AuthenticatedRequest) {
    return this.sequences.listSequences(req.user.companyId);
  }

  /**
   * GET /foundation/sequences/:id/preview — mã kế tiếp (KHÔNG mutate current_value). id lạ/cross-tenant
   * → 404 (RLS che). Route TĨNH-hoá bằng suffix '/preview' — KHÔNG đụng PATCH ':id'.
   */
  @Get("sequences/:id/preview")
  @RequirePermission("view", "foundation-sequence")
  preview(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.sequences.previewNextCodeById(req.user.companyId, id);
  }

  /**
   * PATCH /foundation/sequences/:id — sửa cấu hình mutable + audit-in-tx. actor = req.user (audit +
   * updated_by). 0 row → NotFound (service, fail-closed). ZodValidationPipe chặn field ngoài whitelist.
   */
  @Patch("sequences/:id")
  @RequirePermission("update", "foundation-sequence")
  update(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: PatchSequenceDto) {
    return this.sequences.updateSequenceById(req.user, id, dto);
  }
}

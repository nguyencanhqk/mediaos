import { Controller, Get, Param, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { OperatorOnly } from "../../auth/operator-only.decorator";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { paginated, toPaginationFromOffset } from "../../common/pagination";
import { AuditLogQueryDto } from "./audit.dto";
import { AuditQueryService } from "./audit.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * FOUNDATION-BE-3 — Audit viewer (READ-ONLY) 2 scope tách route, fail-closed 2 lớp (D4):
 *   - COMPANY  GET /foundation/audit-logs (+ /:id): @RequirePermission(view,audit-log,sensitive) → withTenant.
 *   - SYSTEM   GET /foundation/audit-logs/all (+ /all/:id): @OperatorOnly (biên audience operator) VÀ
 *              @RequirePermission(view,platform-audit,sensitive) → withPlatformReadContext (chéo tenant
 *              SELECT-only, mig 0340). Hai lớp khác nhau: aud=tenant → 401; thiếu grant → 403.
 *
 * isSensitive:true ⇒ wildcard *:* KHÔNG kế thừa (PermissionGuard). THỨ TỰ route: '/all' + '/all/:id' khai
 * báo TRƯỚC '/:id' để '/all' không bị param ':id' nuốt. Controller KHÔNG tự chọn DB-context (service lo).
 *
 * ── S2-FND-BE-5: audit-log gate CANONICAL ────────────────────────────────────────────────────────────
 * Cổng DUY NHẤT của audit viewer COMPANY = @RequirePermission('view','audit-log',{isSensitive:true})
 * (permission seed mig 0340, grant company-admin 0001). grep toàn apps/api xác nhận KHÔNG route nào enforce
 * (view|export):foundation-audit-log.
 *
 * ⚠️ DEPRECATE (app-surface): cặp view:foundation-audit-log + export:foundation-audit-log (seed mig
 * 0435:345-346, is_sensitive=false, granted company-admin qua blanket foundation-*) KHÔNG được dùng làm cổng
 * ở BẤT KỲ route audit nào — chúng bị BỎ QUA. Seed row 0435 GIỮ NGUYÊN (audit/seed append-only, BẤT BIẾN #2
 * — KHÔNG DELETE/rewrite CHECK), chỉ ĐÁNH DẤU deprecated. MODULE_APP_METADATA.AUTH đã đổi
 * view:foundation-audit-log → view:audit-log để app-surface khớp cổng thật. Chốt: docs/permission-matrix-spec.md.
 */
@Controller("foundation/audit-logs")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  /** COMPANY — list audit của tenant hiện tại (RLS ép). Pagination = block đỉnh (API-01 §16.1). */
  @Get()
  @RequirePermission("view", "audit-log", { isSensitive: true })
  async listCompany(@Req() req: AuthenticatedRequest, @Query() query: AuditLogQueryDto) {
    const { data, meta } = await this.audit.listCompany(req.user.companyId, query);
    return paginated(data, toPaginationFromOffset(meta.total, meta.offset, meta.limit));
  }

  /** SYSTEM — list audit chéo tenant (operator). KHAI BÁO TRƯỚC '/:id'. `?companyId` khoanh 1 tenant. */
  @Get("all")
  @OperatorOnly()
  @RequirePermission("view", "platform-audit", { isSensitive: true })
  async listSystem(@Query() query: AuditLogQueryDto) {
    const { data, meta } = await this.audit.listSystem(query);
    return paginated(data, toPaginationFromOffset(meta.total, meta.offset, meta.limit));
  }

  /** SYSTEM — chi tiết 1 audit chéo tenant (id toàn cục — không cần companyId). */
  @Get("all/:id")
  @OperatorOnly()
  @RequirePermission("view", "platform-audit", { isSensitive: true })
  getSystemDetail(@Param("id") id: string) {
    return this.audit.getSystemDetail(id);
  }

  /** COMPANY — chi tiết 1 audit của tenant hiện tại. KHAI BÁO CUỐI (':id' bắt phần còn lại). */
  @Get(":id")
  @RequirePermission("view", "audit-log", { isSensitive: true })
  getCompanyDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.audit.getCompanyDetail(req.user.companyId, id);
  }
}

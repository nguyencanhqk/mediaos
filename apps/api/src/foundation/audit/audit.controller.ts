import { Controller, Get, Param, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { OperatorOnly } from "../../auth/operator-only.decorator";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
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
 */
@Controller("foundation/audit-logs")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  /** COMPANY — list audit của tenant hiện tại (RLS ép). */
  @Get()
  @RequirePermission("view", "audit-log", { isSensitive: true })
  listCompany(@Req() req: AuthenticatedRequest, @Query() query: AuditLogQueryDto) {
    return this.audit.listCompany(req.user.companyId, query);
  }

  /** SYSTEM — list audit chéo tenant (operator). KHAI BÁO TRƯỚC '/:id'. `?companyId` khoanh 1 tenant. */
  @Get("all")
  @OperatorOnly()
  @RequirePermission("view", "platform-audit", { isSensitive: true })
  listSystem(@Query() query: AuditLogQueryDto) {
    return this.audit.listSystem(query);
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

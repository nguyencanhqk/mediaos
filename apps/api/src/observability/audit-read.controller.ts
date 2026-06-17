import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";
import { auditLogQuerySchema, type AuditLogQuery } from "@mediaos/contracts";
import type { Request } from "express";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { OperatorReauthGuard } from "../platform/operator-reauth.guard";
import { OperatorReauthService } from "../platform/operator-reauth.service";
import { AuditReadService } from "./audit-read.service";
import { PLATFORM_AUDIT_SCOPE } from "./observability.constants";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

function parseQueryOr400(input: unknown): AuditLogQuery {
  try {
    return auditLogQuerySchema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) throw new BadRequestException(err.errors);
    throw err;
  }
}

/**
 * AC-8 AuditReadController — viewer audit CHỈ-ĐỌC, 2 tầng:
 *
 *  TENANT self (GET /tenant/audit): company-admin xem audit của tenant MÌNH. companyId LẤY TỪ JWT
 *    (KHÔNG cross-tenant). @RequirePermission(view:audit-log, {isSensitive:true}).
 *
 *  OPERATOR cross-tenant (GET /admin/platform/audit): platform-admin xem audit MỌI tenant (+ optional
 *    ?companyId filter). @OperatorOnly (aud=operator) + @RequirePermission(view:platform-audit,
 *    {isSensitive:true}) + OperatorReauthGuard step-up.
 *
 * TRAP reveal-class (G12-4/AC-7): @RequirePermission CHỈ {isSensitive:true} — TUYỆT ĐỐI KHÔNG
 *   requiresReauth:true (cặp isSensitive&&requiresReauth ⇒ reveal-class ⇒ đòi PER-OBJECT grant ⇒ operator
 *   role-level grant deny VĨNH VIỄN). Step-up CHÉO TENANT do OperatorReauthGuard + kiểm window tường minh
 *   ở controller (resolveWindow). SCOPE step-up = sentinel PLATFORM_AUDIT_SCOPE (KHÔNG keyed 1 tenant): cửa
 *   sổ cho tenant A KHÔNG thể authorize đọc all-tenant (key khác). Operator step-up trước qua
 *   POST /admin/platform/companies/:id/step-up với :id = PLATFORM_AUDIT_SCOPE.
 */
@Controller()
export class AuditReadController {
  constructor(
    private readonly auditRead: AuditReadService,
    private readonly operatorReauth: OperatorReauthService,
  ) {}

  /** Audit của TENANT mình (company-admin). */
  @Get("tenant/audit")
  @UseGuards(PermissionGuard)
  @RequirePermission("view", "audit-log", { isSensitive: true })
  async listTenantAudit(@Req() req: AuthenticatedRequest, @Query() rawQuery: unknown) {
    const query = parseQueryOr400(rawQuery);
    return this.auditRead.listOwnTenant(req.user.companyId, query);
  }

  /** Audit CHÉO tenant (platform operator). Step-up keyed sentinel PLATFORM_AUDIT_SCOPE. */
  @Get("admin/platform/audit")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission("view", "platform-audit", { isSensitive: true })
  async listPlatformAudit(@Req() req: AuthenticatedRequest, @Query() rawQuery: unknown) {
    await this.requireStepUp(req.user);
    const query = parseQueryOr400(rawQuery);
    return this.auditRead.listCrossTenant(req.user, query);
  }

  /**
   * ÉP step-up cross-tenant: cửa sổ (operator, PLATFORM_AUDIT_SCOPE) PHẢI còn hiệu lực. FAIL-CLOSED:
   * thiếu/hết hạn/Valkey rớt (resolveWindow trả null) ⇒ 403 (KHÔNG bao giờ false-allow). KHÔNG dùng
   * reauthContext của guard (chỉ populate, không enforce) — quyết định deny ở ĐÂY.
   */
  private async requireStepUp(operator: { id: string; companyId: string }): Promise<void> {
    const window = await this.operatorReauth.resolveWindow(operator.id, PLATFORM_AUDIT_SCOPE);
    if (!window) {
      throw new ForbiddenException(
        "Cross-tenant audit read requires operator step-up (re-authentication).",
      );
    }
  }
}

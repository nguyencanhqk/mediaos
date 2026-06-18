import { Body, Controller, Get, Patch, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import type { SecurityPolicyDto } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SecurityPolicyService } from "./security-policy.service";
import { UpdateSecurityPolicyDto } from "./security-policy.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * CS-9 — GET/PATCH chính sách bảo mật của CÔNG TY HIỆN TẠI (companyId LẤY TỪ JWT, KHÔNG body/param).
 *
 * Guard: configure-security-policy:company. is_sensitive=TRUE (khai ở CẢ seed lẫn decorator — chống
 * *:* wildcard bypass cổng nhạy cảm). requiresReauth=TRUE: thao tác đổi chính sách bảo mật là sensitive →
 * yêu cầu cửa sổ step-up (reuse console step-up; mirror reveal-secret). Người gọi PATCH luôn được service
 * tự thêm vào exempt-list (chống tự-khoá — BẤT BIẾN #4).
 */
@Controller("settings/security-policy")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SecurityPolicyController {
  constructor(private readonly service: SecurityPolicyService) {}

  @Get()
  @RequirePermission("configure-security-policy", "company", { isSensitive: true })
  getPolicy(@Req() req: AuthenticatedRequest): Promise<SecurityPolicyDto> {
    return this.service.getPolicy(req.user.companyId);
  }

  @Patch()
  @RequirePermission("configure-security-policy", "company", {
    isSensitive: true,
    requiresReauth: true,
  })
  updatePolicy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSecurityPolicyDto,
  ): Promise<SecurityPolicyDto> {
    return this.service.updatePolicy(req.user.companyId, dto, req.user.id);
  }
}

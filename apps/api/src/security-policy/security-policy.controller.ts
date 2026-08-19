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
 * *:* wildcard bypass cổng nhạy cảm). Người gọi PATCH luôn được service tự thêm vào exempt-list
 * (chống tự-khoá — BẤT BIẾN #4).
 *
 * ⛔ KHÔNG THÊM `requiresReauth: true` VÀO ĐÂY (KI-065, S10-QA-SECPOLICY-GATE-1 — ADR DECISIONS-09).
 * `permission.decide.ts` tính `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)`.
 * Route này là SINGLETON (1 hàng/công ty) nên KHÔNG có `:id` ⇒ `PermissionGuard` truyền `resourceId`
 * null ⇒ object-tier bị bỏ qua ⇒ `deny-object-required` VĨNH VIỄN cho MỌI actor. Đường thoát còn lại —
 * cửa sổ re-auth — cũng bất khả thi: KHÔNG chỗ nào trong `apps/api/src` GHI `req.reauthContext` (chưa
 * có step-up thật). Bản khai cũ (2026-07 → 14/08/2026) đã làm route CHẾT 403 im lặng, màn hình console
 * `settings/security-policy` không lưu được gì. Muốn ép xác thực lại: xây step-up THẬT trước
 * (WO `S10-AUTH-STEPUP-1`), rồi mới gắn cờ — cổng `test/foundation/reauth-reachability.e2e-spec.ts`
 * sẽ ĐỎ nếu cờ quay lại trước khi có step-up.
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
  @RequirePermission("configure-security-policy", "company", { isSensitive: true })
  updatePolicy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSecurityPolicyDto,
  ): Promise<SecurityPolicyDto> {
    return this.service.updatePolicy(req.user.companyId, dto, req.user.id);
  }
}

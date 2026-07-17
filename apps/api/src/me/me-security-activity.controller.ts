import { Controller, Get, Header, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import { meSecurityActivityQuerySchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { paginated, toPagination } from "../common/pagination";
import { MeSecurityActivityService } from "./me-security-activity.service";
import { ME_ACCESS_PAIR } from "./me.constants";

/**
 * Query DTO — CHỈ page/per_page/from_date/to_date. Schema KHÔNG `.strict()` ⇒ key lạ client gửi
 * (?user_id=<B>…) bị STRIP im lặng, hành vi không đổi (chống IDOR §14.4 — owner 100% từ token).
 */
class MeSecurityActivityQueryDto extends createZodDto(meSecurityActivityQuerySchema) {}

/** Request đã qua JwtAuthGuard + CompanyGuard (global) — mirror MeController. */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-ME-BE-3 — MeSecurityActivityController (SPEC-09 ME-FUNC-016 · §14.2): GET /api/v1/me/security/
 * activity — hoạt động bảo mật CỦA CHÍNH user (login_logs + user_security_events hợp nhất, đã mask).
 *
 * TÁCH controller riêng (không nhét vào MeController) để BẢO TOÀN bất biến tài liệu hoá của
 * MeController "CỐ Ý KHÔNG khai @Param/@Query/@Body" — route này cần @Query phân trang.
 *
 * BẢO MẬT:
 *  - Chưa auth → 401 (JwtAuthGuard global). Gate = cặp tuple THẬT `('access','me')` mig 0495
 *    (ME_ACCESS_PAIR — done_when: KHÔNG dùng cặp `view:audit-log` của viewer admin, endpoint admin
 *    /auth/login-logs · /auth/security-events GIỮ NGUYÊN).
 *  - Own-scope + masking ở service/repository; controller CHỈ map req→service→envelope phân trang.
 *  - `Cache-Control: no-store` — dữ liệu security KHÔNG cache (SPEC-09 §12.6).
 *  - Sessions list/revoke KHÔNG dựng lại ở đây — ME tái dùng /auth/sessions sẵn có (done_when).
 */
@Controller("me/security")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
@RequirePermission(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType, {
  isSensitive: ME_ACCESS_PAIR.isSensitive,
})
export class MeSecurityActivityController {
  constructor(private readonly activity: MeSecurityActivityService) {}

  /** GET /api/v1/me/security/activity — phân trang, cửa sổ tối đa 90 ngày, DTO đã mask. */
  @Get("activity")
  @Header("Cache-Control", "no-store")
  async listActivity(
    @Req() req: AuthenticatedRequest,
    @Query() query: MeSecurityActivityQueryDto,
  ) {
    const { data, total } = await this.activity.listActivity(req.user, query);
    return paginated(data, toPagination(total, query.page, query.per_page));
  }
}

import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { MeTrainingResponse } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MeTrainingService } from "./me-training.service";
import { ME_TRAINING_ACCESS_PAIR } from "./me.constants";

/**
 * Chỉ đọc từ TOKEN (JwtAuthGuard đã set req.user). CỐ Ý KHÔNG khai @Param/@Query/@Body/@Headers — mirror
 * me.controller.ts. Client KHÔNG có đường nào truyền email/user_id/employee_id.
 */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/**
 * S5-LMS-BE-3 — `GET /api/v1/me/training`: tiến độ học của CHÍNH user (proxy LMS, cache ~60s, KHÔNG lưu DB).
 *
 * BẢO MẬT:
 *  - JwtAuthGuard + CompanyGuard + TwoFactorEnforcementGuard là APP_GUARD GLOBAL ⇒ chưa auth → 401 tự động.
 *  - Class-level PermissionGuard + cặp `access:lms` (mig 0508 — TÁI DÙNG cặp của cầu SSO). Thiếu → 403.
 *  - 🔒 IDOR (security review S5-LMS-APP-3 M3 — BẤT BIẾN CỨNG của WO này): LMS trả tiến độ của BẤT KỲ email
 *    nào cho ai giữ token ⇒ TOÀN BỘ kiểm soát "đúng người" nằm ở đây. Email resolve 100% từ `req.user`.
 *    **CẤM thêm @Query/@Body/@Param/@Headers vào handler này** — `me-training.permissions.spec.ts` khoá
 *    hành vi đó bằng metadata route-args; đừng "sửa" test khi nó đỏ, đó là hàng rào.
 */
@Controller("me/training")
@UseGuards(PermissionGuard)
@RequirePermission(ME_TRAINING_ACCESS_PAIR.action, ME_TRAINING_ACCESS_PAIR.resourceType, {
  isSensitive: ME_TRAINING_ACCESS_PAIR.isSensitive,
})
export class MeTrainingController {
  constructor(private readonly training: MeTrainingService) {}

  /** GET /api/v1/me/training — envelope `{ status:'ok'|'no_account', progress }` (DTO đã qua Zod). */
  @Get()
  getMyTraining(@Req() req: AuthenticatedRequest): Promise<MeTrainingResponse> {
    return this.training.getMyTraining(req.user);
  }
}

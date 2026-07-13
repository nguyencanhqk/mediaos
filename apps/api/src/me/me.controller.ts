import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { MeAggregationService } from "./me-aggregation.service";
import { ME_ACCESS_PAIR } from "./me.constants";

/**
 * Chỉ đọc từ TOKEN (JwtAuthGuard đã set req.user). CỐ Ý KHÔNG khai @Param/@Query/@Body — không có tham số
 * nào cho phép client truyền user_id/employee_id (chống IDOR, SPEC-09 §14.4/§17.1). Owner 100% từ req.user.
 */
interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/**
 * S5-ME-BE-1 — MeController (Personal Hub, SPEC-09 §14.2 / API-11 §5). 6 route đọc-tổng-hợp own-scope.
 *
 * BẢO MẬT:
 *  - JwtAuthGuard + CompanyGuard + TwoFactorEnforcementGuard là APP_GUARD GLOBAL ⇒ chưa auth → 401 tự động.
 *  - Class-level PermissionGuard + @RequirePermission('access','me') (tuple THẬT mig 0495: action='access',
 *    resourceType='me', is_sensitive=false — KHÔNG dotted 'ME.ACCESS'). Thiếu cặp → 403 AUTH-ERR-FORBIDDEN.
 *  - Logic + fail-soft ở MeAggregationService (business ở service, không ở controller). Controller CHỈ
 *    forward req.user → service; KHÔNG nhận owner ID từ client.
 */
@Controller("me")
@UseGuards(PermissionGuard)
@RequirePermission(ME_ACCESS_PAIR.action, ME_ACCESS_PAIR.resourceType, {
  isSensitive: ME_ACCESS_PAIR.isSensitive,
})
export class MeController {
  constructor(private readonly me: MeAggregationService) {}

  /** GET /api/v1/me — danh tính user hiện tại (account + link employee tối thiểu). */
  @Get()
  getIdentity(@Req() req: AuthenticatedRequest) {
    return this.me.getIdentity(req.user);
  }

  /** GET /api/v1/me/overview — tổng quan (identity + 5 section status riêng, fail-soft). */
  @Get("overview")
  getOverview(@Req() req: AuthenticatedRequest) {
    return this.me.getOverview(req.user);
  }

  /** GET /api/v1/me/attendance-summary — chấm công hôm nay (own). */
  @Get("attendance-summary")
  getAttendanceSummary(@Req() req: AuthenticatedRequest) {
    return this.me.getAttendanceSummary(req.user);
  }

  /** GET /api/v1/me/leave-summary — số dư phép (own). */
  @Get("leave-summary")
  getLeaveSummary(@Req() req: AuthenticatedRequest) {
    return this.me.getLeaveSummary(req.user);
  }

  /** GET /api/v1/me/task-summary — roll-up task (own). */
  @Get("task-summary")
  getTaskSummary(@Req() req: AuthenticatedRequest) {
    return this.me.getTaskSummary(req.user);
  }

  /** GET /api/v1/me/notification-summary — đếm thông báo chưa đọc (own). */
  @Get("notification-summary")
  getNotificationSummary(@Req() req: AuthenticatedRequest) {
    return this.me.getNotificationSummary(req.user);
  }
}

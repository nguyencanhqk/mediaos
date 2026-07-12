import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { InternalGuard } from "../permission/guards/internal.guard";
import {
  DASH_CACHE_INVALIDATE_ERR,
  widgetsForInvalidationEvent,
} from "./dashboard-cache-invalidation.const";
import { DashboardCacheInvalidateRequestDto } from "./dashboard-cache-invalidation.dto";
import {
  DashboardCacheInvalidationService,
  type InvalidateResult,
} from "./dashboard-cache-invalidation.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S4-INT-2 — POST /internal/v1/dashboard/cache/invalidate: DASH cache invalidation từ event TASK/NOTI/ATT/
 * LEAVE (docs/plans S4-INT-2, mẫu duyệt `internal-notifications.controller.ts` + `attendance-internal.
 * controller.ts`). CHỈ nhận eventCode thuộc registry reconciled (dashboard-cache-invalidation.const.ts —
 * "chỉ dùng mã do producer THẬT phát").
 *
 * TRUST BOUNDARY (mirror InternalNotificationsController):
 *  - KHÔNG `@Public()`. `JwtAuthGuard`+`CompanyGuard` là APP_GUARD toàn cục ⇒ thiếu Bearer → 401 TRƯỚC khi
 *    tới `InternalGuard`.
 *  - `InternalGuard` (controller-level) đòi `x-internal-key` khớp `INTERNAL_API_KEY` (env) — thiếu/sai/env
 *    unset → 403 fail-closed. Defense-in-depth: cần CẢ JWT hợp lệ VÀ internal key.
 *  - company_id LẤY TỪ TOKEN (`req.user.companyId`), KHÔNG từ body — DTO không có field này; nếu client vẫn
 *    nhét `company_id`/`companyId` khác token → 400 (assertBodyCompanyMatchesToken, mirror NOTI).
 *  - eventCode KHÔNG thuộc registry (dashboard-cache-invalidation.const.ts) → 400 loud (KHÔNG no-op-200) —
 *    "mã không có producer bị loại/map" PHẢI bị chặn ở biên, không âm thầm invalidate sai/không invalidate gì.
 *
 * FIRE-AND-FORGET theo WIDGET (không theo eventCode): 1 widget catalog thiếu KHÔNG chặn cả request — xem
 * DashboardCacheInvalidationService. Response 200 luôn kèm invalidatedWidgets/rowsAffected để caller log/audit.
 */
@Controller("internal/v1/dashboard")
@UseGuards(InternalGuard)
@UsePipes(ZodValidationPipe)
export class InternalDashboardCacheController {
  constructor(private readonly invalidation: DashboardCacheInvalidationService) {}

  @Post("cache/invalidate")
  @HttpCode(200)
  async invalidate(
    @Req() req: AuthenticatedRequest,
    @Body() dto: DashboardCacheInvalidateRequestDto,
  ): Promise<InvalidateResult> {
    this.assertBodyCompanyMatchesToken(req);
    this.assertKnownEvent(dto.eventCode);
    return this.invalidation.invalidate(req.user.companyId, dto.eventCode, dto.userIds);
  }

  private assertKnownEvent(eventCode: string): void {
    if (!widgetsForInvalidationEvent(eventCode)) {
      throw new BadRequestException({
        code: DASH_CACHE_INVALIDATE_ERR.UNKNOWN_EVENT,
        message: `eventCode ngoài registry DASH cache invalidation: ${eventCode}`,
      });
    }
  }

  /** Nếu body mang `company_id`/`companyId` khác token → 400 (cross-tenant spoof qua body). */
  private assertBodyCompanyMatchesToken(req: AuthenticatedRequest): void {
    const rawBody = (req.body ?? {}) as Record<string, unknown>;
    const bodyCompanyId = rawBody["company_id"] ?? rawBody["companyId"];
    if (bodyCompanyId !== undefined && bodyCompanyId !== req.user.companyId) {
      throw new BadRequestException({
        code: "DASH-ERR-COMPANY-MISMATCH",
        message: "company_id lấy từ token, không được truyền trong body",
      });
    }
  }
}

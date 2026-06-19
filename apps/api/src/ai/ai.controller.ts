import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { aiInsightQuerySchema } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { AiInsightService } from "./ai-insight.service";
import { AiInsightQueryDto } from "./ai-insight.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * AI-1 — AI Insight HTTP layer (READ-ONLY). GET /ai/insight.
 *
 * PermissionGuard fail-closed: read:kpi (TÁI DÙNG quyền KPI có sẵn — module read-only KHÔNG thêm bảng/
 * migration nên KHÔNG seed perm mới). view-finance(isSensitive) check thêm Ở SERVICE để MASK số tiền.
 * companyId/userId LẤY TỪ req.user (KHÔNG tin client). Global JwtAuthGuard + CompanyGuard chạy trước.
 */
@Controller("ai")
@UsePipes(ZodValidationPipe)
export class AiController {
  constructor(private readonly insight: AiInsightService) {}

  /** GET /ai/insight — tóm tắt KPI + chi phí (đã mask theo quyền) qua Claude. */
  @Get("insight")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "kpi")
  getInsight(@Req() req: AuthenticatedRequest, @Query() query: AiInsightQueryDto) {
    const { id: userId, companyId } = req.user;
    // Default-applies + reject giá trị lạ server-side; KHÔNG tin raw query string.
    const parsed = aiInsightQuerySchema.parse(query);
    return this.insight.summarizeInsight(companyId, userId, parsed);
  }
}

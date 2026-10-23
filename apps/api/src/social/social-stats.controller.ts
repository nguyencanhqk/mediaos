import { Controller, Get, Header, Query, Req, Res, UseGuards, UsePipes } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { SocialInputTextPipe } from "./social-input-text.pipe";
import { feedEngagementQuerySchema, type FeedEngagementQueryDto } from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SOCIAL_STATS_XLSX_MIME } from "./social-stats-xlsx";
import { SocialStatsService } from "./social-stats.service";
import { SOCIAL_ROUTE_PAIRS as P } from "./social-route-pairs.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S16-SOCIAL-BE-3B — `SOCIAL-API-052..053` (thống kê tương tác). MỎNG: chỉ định tuyến.
 *
 * ⚠️ **`stats/engagement/export` khai TRƯỚC `stats/engagement`** (luật tĩnh-trước của API-19 §5.2).
 * Query validate bằng `ZodValidationPipe` TẠI CHỖ (schema có `superRefine` + `transform` nắn tuần ISO — khuôn 076/081).
 * `Cache-Control: no-store` ở CẢ HAI route: SOC-DEC-010 «thống kê không cache» — cache trình duyệt/proxy cũng là cache.
 * Không route `{id}` nào ⇒ không `ParseUUIDPipe`.
 */
@Controller("social")
@UsePipes(SocialInputTextPipe)
export class SocialStatsController {
  constructor(private readonly stats: SocialStatsService) {}

  /** 053 — GET /social/stats/engagement/export (XLSX; audit cùng tx). */
  @Get("stats/engagement/export")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.statsExport.action, P.statsExport.resourceType)
  async export(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(feedEngagementQuerySchema)) query: FeedEngagementQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.stats.export(req.user, query);
    // Content-Type đặt Ở ĐƯỜNG THÀNH CÔNG, cạnh `send` — `@Header` áp TRƯỚC handler làm 4xx đội nhãn XLSX (bài học 017).
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", SOCIAL_STATS_XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /** 052 — GET /social/stats/engagement (theo tuần & đơn vị; KHÔNG cache, KHÔNG audit). */
  @Get("stats/engagement")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.statsEngagement.action, P.statsEngagement.resourceType)
  @Header("Cache-Control", "no-store")
  engagement(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(feedEngagementQuerySchema)) query: FeedEngagementQueryDto,
  ) {
    return this.stats.engagement(req.user, query);
  }
}

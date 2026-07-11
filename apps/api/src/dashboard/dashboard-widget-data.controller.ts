import { Controller, Get, Param, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { DashboardWidgetDataService } from "./dashboard-widget-data.service";
import { WidgetDataQueryDto } from "./dashboard-widget-data.dto";
import { DASH_READ_PAIR } from "./dashboard-widget-catalog.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const READ = DASH_READ_PAIR;

/**
 * S4-DASH-BE-2 — Widget DATA API (API-08 §10.1/§11.3): controller THỨ BA trên @Controller("dashboard") —
 * song song DashboardController (report/mv-stats/alerts/refresh/summary) + DashboardResolverController
 * (me/types/4-type). Route MỚI `widgets` + `widgets/:slug` — KHÔNG trùng path+method với 2 controller kia.
 *
 * ⚠ @UseGuards(PermissionGuard) MỨC CLASS BẮT BUỘC (PermissionGuard KHÔNG global): @RequirePermission chỉ là
 * SetMetadata — thiếu guard = decorator vô hiệu. Gate read:dashboard (DASH_READ_PAIR, blanket mọi role mig 0100).
 * Gate per-widget theo cặp source-module ép TIẾP ở service/handler (fail-closed 403).
 */
@Controller("dashboard")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class DashboardWidgetDataController {
  constructor(private readonly service: DashboardWidgetDataService) {}

  /** GET /dashboard/widgets — catalog widget khả dụng (omit widget thiếu quyền); ?include_data=true kèm data. */
  @Get("widgets")
  @RequirePermission(READ.action, READ.resourceType, { isSensitive: READ.isSensitive })
  catalog(@Req() req: AuthenticatedRequest, @Query() query: WidgetDataQueryDto) {
    return this.service.getCatalog(req.user, query);
  }

  /** GET /dashboard/widgets/:slug — data 1 widget (?refresh=true bỏ qua cache hợp lệ, tôn trọng min-interval). */
  @Get("widgets/:slug")
  @RequirePermission(READ.action, READ.resourceType, { isSensitive: READ.isSensitive })
  widget(
    @Req() req: AuthenticatedRequest,
    @Param("slug") slug: string,
    @Query() query: WidgetDataQueryDto,
  ) {
    return this.service.getWidget(req.user, slug, query);
  }
}

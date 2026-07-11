import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { DashboardConfigService } from "./dashboard-config.service";
import { DashboardConfigListQueryDto, DashboardConfigPatchDto } from "./dashboard-config.dto";
import { DASH_PERMISSION_PAIRS, type DashPermissionPair } from "./dashboard-widget-catalog.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/** Fail-fast lookup cặp DASH từ NGUỒN DUY NHẤT (DASH_PERMISSION_PAIRS, mig 0484) — KHÔNG gõ tay string rời
 * (bài học pair-drift đã cắn 3 lần). Mirror dashPairBySpec/attPair. */
function configPair(specCode: string): DashPermissionPair {
  const pair = DASH_PERMISSION_PAIRS.find((p) => p.specCode === specCode);
  if (!pair) {
    throw new Error(`DASH permission pair missing from catalog: specCode=${specCode}`);
  }
  return pair;
}

const VIEW = configPair("DASH.CONFIG.VIEW");
const UPDATE = configPair("DASH.CONFIG.UPDATE");

/**
 * S4-DASH-BE-3 — Dashboard widget CONFIG CRUD API (API-10:310, DASH-API-201/203). Controller THỨ TƯ trên
 * @Controller("dashboard") — song song DashboardController (report/mv-stats/alerts/refresh/summary) +
 * DashboardResolverController (me/types/employee/manager/hr/admin). Route MỚI /configs + /configs/:id
 * KHÔNG trùng path+method với 3 controller kia.
 *
 * ⚠ @UseGuards(PermissionGuard) MỨC CLASS BẮT BUỘC: PermissionGuard KHÔNG global (app.module APP_GUARD chỉ
 * JwtAuthGuard/CompanyGuard/TwoFactorEnforcementGuard). @RequirePermission chỉ là SetMetadata — thiếu guard
 * = decorator vô hiệu ⇒ MỌI user đăng nhập đọc/sửa được config (bài học resolver-controller). Cặp
 * view/update:dashboard-config (is_sensitive) lấy TỪ const DASH_PERMISSION_PAIRS.
 *
 * KHÔNG mở đường đọc: config PATCH chỉ đổi hiển thị — read-time gating tier-2 (DashboardWidgetRegistryService)
 * là authoritative, cap quyền xem widget (permission-matrix-spec §7).
 */
@Controller("dashboard")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class DashboardConfigController {
  constructor(private readonly service: DashboardConfigService) {}

  /** GET /dashboard/configs — list config widget (join widget_code/name), filter + precedence-ordered. */
  @Get("configs")
  @RequirePermission(VIEW.action, VIEW.resourceType, { isSensitive: VIEW.isSensitive })
  list(@Req() req: AuthenticatedRequest, @Query() query: DashboardConfigListQueryDto) {
    return this.service.list(req.user.companyId, query);
  }

  /** PATCH /dashboard/configs/:id — cập nhật field cho phép + audit-in-tx; id ngoài tenant/soft-deleted → 404. */
  @Patch("configs/:id")
  @RequirePermission(UPDATE.action, UPDATE.resourceType, { isSensitive: UPDATE.isSensitive })
  patch(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DashboardConfigPatchDto,
  ) {
    return this.service.patch(req.user.companyId, req.user, id, dto);
  }
}

import { Controller, Get, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { DashboardResolverService } from "./dashboard-resolver.service";
import { DashboardWidgetListQueryDto } from "./dashboard-resolver.dto";
import { DASH_READ_PAIR, DASH_TYPE_PERMISSION_PAIR } from "./dashboard-widget-catalog.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const READ = DASH_READ_PAIR;
const EMPLOYEE = DASH_TYPE_PERMISSION_PAIR.Employee;
const MANAGER = DASH_TYPE_PERMISSION_PAIR.Manager;
const HR = DASH_TYPE_PERMISSION_PAIR.HR;
const ADMIN = DASH_TYPE_PERMISSION_PAIR.Admin;

/**
 * S4-DASH-BE-1 — Dashboard resolver API (API-08 §10.1): /dashboard/me · /types · 4 route TĨNH type. Controller
 * THỨ HAI trên @Controller("dashboard") — song song DashboardController cũ (report/mv-stats/alerts/refresh/
 * summary), mirror MyNotificationsController cạnh NotificationsController. KHÔNG route trùng path+method.
 *
 * ⚠ @UseGuards(PermissionGuard) MỨC CLASS BẮT BUỘC: PermissionGuard KHÔNG global (app.module APP_GUARD chỉ
 * JwtAuthGuard/CompanyGuard/TwoFactorEnforcementGuard). @RequirePermission chỉ là SetMetadata — thiếu guard =
 * decorator vô hiệu ⇒ mọi user đăng nhập gọi được /dashboard/hr·/admin. redTest M1/M2/M3 (403) là backstop.
 *
 * Cặp @RequirePermission lấy TỪ const (DASH_READ_PAIR/DASH_TYPE_PERMISSION_PAIR) — KHÔNG gõ tay string rời
 * (bài học pair-drift). Route /me·/types gate read:dashboard (blanket); 4 route type gate view-*:dashboard.
 */
@Controller("dashboard")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class DashboardResolverController {
  constructor(private readonly service: DashboardResolverService) {}

  /** GET /dashboard/me — dashboard mặc định của user (ưu tiên Admin>HR>Manager>Employee). */
  @Get("me")
  @RequirePermission(READ.action, READ.resourceType, { isSensitive: READ.isSensitive })
  me(@Req() req: AuthenticatedRequest, @Query() query: DashboardWidgetListQueryDto) {
    return this.service.getMyDashboard(req.user.companyId, req.user.id, query.limit);
  }

  /** GET /dashboard/types — dashboard type user được phép xem (+ is_default). */
  @Get("types")
  @RequirePermission(READ.action, READ.resourceType, { isSensitive: READ.isSensitive })
  types(@Req() req: AuthenticatedRequest) {
    return this.service.listAllowedTypes(req.user.companyId, req.user.id);
  }

  /** GET /dashboard/employee. */
  @Get("employee")
  @RequirePermission(EMPLOYEE.action, EMPLOYEE.resourceType, { isSensitive: EMPLOYEE.isSensitive })
  employee(@Req() req: AuthenticatedRequest, @Query() query: DashboardWidgetListQueryDto) {
    return this.service.getDashboardByType(
      req.user.companyId,
      req.user.id,
      "Employee",
      query.limit,
    );
  }

  /** GET /dashboard/manager. */
  @Get("manager")
  @RequirePermission(MANAGER.action, MANAGER.resourceType, { isSensitive: MANAGER.isSensitive })
  manager(@Req() req: AuthenticatedRequest, @Query() query: DashboardWidgetListQueryDto) {
    return this.service.getDashboardByType(req.user.companyId, req.user.id, "Manager", query.limit);
  }

  /** GET /dashboard/hr. */
  @Get("hr")
  @RequirePermission(HR.action, HR.resourceType, { isSensitive: HR.isSensitive })
  hr(@Req() req: AuthenticatedRequest, @Query() query: DashboardWidgetListQueryDto) {
    return this.service.getDashboardByType(req.user.companyId, req.user.id, "HR", query.limit);
  }

  /** GET /dashboard/admin. */
  @Get("admin")
  @RequirePermission(ADMIN.action, ADMIN.resourceType, { isSensitive: ADMIN.isSensitive })
  admin(@Req() req: AuthenticatedRequest, @Query() query: DashboardWidgetListQueryDto) {
    return this.service.getDashboardByType(req.user.companyId, req.user.id, "Admin", query.limit);
  }
}

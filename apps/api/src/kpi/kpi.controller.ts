import { Body, Controller, Get, Post, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { KpiService } from "./kpi.service";
import {
  ComputeKpiDto,
  ConfirmKpiResultDto,
  CreateKpiDefinitionDto,
  ListKpiDefinitionQueryDto,
  ListKpiResultQueryDto,
} from "./kpi.dto";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * G8-4 — KPI HTTP layer. PermissionGuard fail-closed:
 *  - manage:kpi-definition → tạo/sửa định nghĩa KPI (trọng số).
 *  - read:kpi              → tính KPI (compute snapshot).
 *  - confirm:kpi           → xác nhận KPI (BR-007 — snapshot mới có cờ).
 * Hyphen spelling 'kpi-definition' byte-identical với seed migration 0089 (tránh 403 vĩnh viễn).
 * companyId/userId lấy từ req.user (mirror evaluation.controller.ts).
 */
@Controller("kpi")
@UsePipes(ZodValidationPipe)
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  /** GET /kpi/definitions — danh sách định nghĩa KPI active của tenant. */
  @Get("definitions")
  listDefinitions(@Req() req: AuthenticatedRequest, @Query() query: ListKpiDefinitionQueryDto) {
    return this.kpi.listDefinitions(req.user.companyId, req.user.id, {
      includeInactive: query.includeInactive,
    });
  }

  /** POST /kpi/definitions — tạo định nghĩa KPI (manage:kpi-definition). */
  @Post("definitions")
  @UseGuards(PermissionGuard)
  @RequirePermission("manage", "kpi-definition")
  createDefinition(@Req() req: AuthenticatedRequest, @Body() dto: CreateKpiDefinitionDto) {
    return this.kpi.createDefinition(req.user.companyId, req.user.id, dto);
  }

  /**
   * GET /kpi/results — lịch sử kết quả KPI (read:kpi). Employee thường chỉ thấy KPI của-mình (server
   * lọc scope, KHÔNG dựa subjectUserId client); HR/quản lý (confirm:kpi / manage:kpi-definition) xem rộng.
   * Route literal → đặt cạnh /definitions, không xung đột route động.
   */
  @Get("results")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "kpi")
  listResults(@Req() req: AuthenticatedRequest, @Query() query: ListKpiResultQueryDto) {
    return this.kpi.listResults(req.user.companyId, req.user.id, query);
  }

  /** POST /kpi/compute — tính KPI cá nhân/team trong kỳ (read:kpi). */
  @Post("compute")
  @UseGuards(PermissionGuard)
  @RequirePermission("read", "kpi")
  computeKpi(@Req() req: AuthenticatedRequest, @Body() dto: ComputeKpiDto) {
    return this.kpi.computeKpi(req.user.companyId, req.user.id, dto);
  }

  /** POST /kpi/confirm — xác nhận KPI (BR-007 — confirm:kpi). */
  @Post("confirm")
  @UseGuards(PermissionGuard)
  @RequirePermission("confirm", "kpi")
  confirmResult(@Req() req: AuthenticatedRequest, @Body() dto: ConfirmKpiResultDto) {
    return this.kpi.confirmResult(req.user.companyId, req.user.id, dto);
  }
}

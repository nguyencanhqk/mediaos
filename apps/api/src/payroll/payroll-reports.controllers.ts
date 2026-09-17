import { Controller, Get, Header, Param, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  payrollOverviewQuerySchema,
  payrollReportCodeEnum,
  payrollReportExportQuerySchema,
  payrollReportQuerySchema,
  type PayrollOverviewQuery,
  type PayrollReportCode,
  type PayrollReportExportQuery,
  type PayrollReportQuery,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PayrollOverviewService } from "./payroll-overview.service";
import { sendXlsx } from "./payroll-payment.controllers";
import { PayrollReportExportService } from "./payroll-report-export.service";
import { PayrollReportsService } from "./payroll-reports.service";
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S15-PAYROLL-BE-5 — `PAYROLL-API-078..082`: Tổng quan · Lời nhắc · 7 báo cáo. MỎNG — chỉ định tuyến.
 *
 * Luật cấp-file của module áp nguyên: guard TỪNG route (cặp đọc từ `PAYROLL_ROUTE_PAIRS`, `isSensitive` tường minh),
 * query/param validate bằng `ZodValidationPipe` TẠI CHỖ (schema có `superRefine` — khuôn 076). Route TĨNH `reports`
 * khai TRƯỚC `reports/:reportCode` (bẫy `goals/tree`); `:reportCode` là mã đóng (`z.enum`), không phải UUID.
 * `Cache-Control: no-store` cho mọi route chở tiền (plan §0b C13) — cache trình duyệt/proxy cũng là cache.
 */
@Controller("payroll")
export class PayrollReportsController {
  constructor(
    private readonly overviewService: PayrollOverviewService,
    private readonly reports: PayrollReportsService,
    private readonly exporter: PayrollReportExportService,
  ) {}

  /** 078 — GET /payroll/overview (6 khối; KHÔNG cache; audit mỗi lượt). */
  @Get("overview")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.overview.action, P.overview.resourceType, {
    isSensitive: P.overview.isSensitive,
  })
  @Header("Cache-Control", "no-store")
  overview(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(payrollOverviewQuerySchema)) query: PayrollOverviewQuery,
  ) {
    return this.overviewService.overview(req.user, query);
  }

  /** 079 — GET /payroll/overview/reminders (3 số đếm; KHÔNG cache; audit mỗi lượt). */
  @Get("overview/reminders")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.overviewReminders.action, P.overviewReminders.resourceType, {
    isSensitive: P.overviewReminders.isSensitive,
  })
  @Header("Cache-Control", "no-store")
  reminders(@Req() req: AuthenticatedRequest) {
    return this.overviewService.reminders(req.user);
  }

  /** 080 — GET /payroll/reports (danh mục theo quyền; metadata ⇒ 0 audit). ⚠️ TRƯỚC `reports/:reportCode`. */
  @Get("reports")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.reportList.action, P.reportList.resourceType, {
    isSensitive: P.reportList.isSensitive,
  })
  catalog(@Req() req: AuthenticatedRequest) {
    return this.reports.catalog(req.user);
  }

  /** 082 — GET /payroll/reports/:reportCode/export (XLSX; + `export:payroll` + cặp nguồn; audit `export`). */
  @Get("reports/:reportCode/export")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.reportExport.action, P.reportExport.resourceType, {
    isSensitive: P.reportExport.isSensitive,
  })
  async export(
    @Req() req: AuthenticatedRequest,
    @Param("reportCode", new ZodValidationPipe(payrollReportCodeEnum)) code: PayrollReportCode,
    @Query(new ZodValidationPipe(payrollReportExportQuerySchema)) query: PayrollReportExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.exporter.export(req.user, code, query);
    res.setHeader("Cache-Control", "no-store");
    sendXlsx(res, buffer, filename);
  }

  /** 081 — GET /payroll/reports/:reportCode (phân trang; + cặp nguồn; KHÔNG cache; audit mỗi lượt). */
  @Get("reports/:reportCode")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.reportData.action, P.reportData.resourceType, {
    isSensitive: P.reportData.isSensitive,
  })
  @Header("Cache-Control", "no-store")
  data(
    @Req() req: AuthenticatedRequest,
    @Param("reportCode", new ZodValidationPipe(payrollReportCodeEnum)) code: PayrollReportCode,
    @Query(new ZodValidationPipe(payrollReportQuerySchema)) query: PayrollReportQuery,
  ) {
    return this.reports.data(req.user, code, query);
  }
}

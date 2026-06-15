import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PayslipService } from "./payslip.service";
import { RunPayrollDto } from "./payroll.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Payslip — SNAPSHOT APPEND-ONLY (ADR-0005, BẤT BIẾN #2). Lương NHẠY CẢM (BẤT BIẾN #3):
 *  - run-payroll + view-payslip is_sensitive=TRUE ⇒ KHÔNG kế thừa wildcard *:* (G3-2).
 *  - KHÔNG có route PATCH/DELETE (append-only — sửa = ghi mới ở service, chưa expose ở G12-2).
 *  - re-auth khi xem payslip = G12-4 (chỉ chuẩn bị permission view-payslip, KHÔNG full re-auth lượt này).
 */
@Controller("payslips")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PayslipController {
  constructor(private readonly payslips: PayslipService) {}

  @Post("run")
  @RequirePermission("run-payroll", "payroll_period", { isSensitive: true })
  run(@Req() req: AuthenticatedRequest, @Body() dto: RunPayrollDto) {
    return this.payslips.runPayroll(req.user, dto);
  }

  @Get()
  @RequirePermission("view-payslip", "payslip", { isSensitive: true })
  list(
    @Req() req: AuthenticatedRequest,
    @Query("payrollPeriodId") payrollPeriodId?: string,
    @Query("userId") userId?: string,
  ) {
    return this.payslips.list(req.user, { payrollPeriodId, userId });
  }

  @Get(":id")
  @RequirePermission("view-payslip", "payslip", { isSensitive: true })
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.payslips.getOne(req.user, id);
  }
}

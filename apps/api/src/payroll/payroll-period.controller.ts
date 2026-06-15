import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { PayrollPeriodService } from "./payroll-period.service";
import { CreatePayrollPeriodDto } from "./payroll.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Payroll period CRUD — kỳ lương MUTABLE (draft→locked, ADR-0005).
 * MỖI route khai @RequirePermission('manage-payroll-period') (PermissionGuard fail-closed nếu thiếu).
 * manage-payroll-period KHÔNG nhạy cảm (quản trị kỳ) — run-payroll/payslip mới nhạy cảm (controller riêng).
 */
@Controller("payroll-periods")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PayrollPeriodController {
  constructor(private readonly periods: PayrollPeriodService) {}

  @Get()
  @RequirePermission("manage-payroll-period", "payroll_period")
  list(@Req() req: AuthenticatedRequest, @Query("status") status?: string) {
    return this.periods.list(req.user, {
      status: status as "draft" | "locked" | undefined,
    });
  }

  @Post()
  @RequirePermission("manage-payroll-period", "payroll_period")
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePayrollPeriodDto) {
    return this.periods.create(req.user, dto);
  }

  @Post(":id/lock")
  @RequirePermission("manage-payroll-period", "payroll_period")
  lock(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.periods.lock(req.user, id);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("manage-payroll-period", "payroll_period")
  remove(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.periods.remove(req.user, id);
  }
}

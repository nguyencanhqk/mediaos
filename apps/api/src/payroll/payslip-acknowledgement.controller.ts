import {
  Body,
  Controller,
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
import { PayslipAcknowledgementService } from "./payslip-acknowledgement.service";
import { DisputePayslipDto, ResolvePayslipDisputeDto } from "./payroll.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Payslip acknowledgement (G12-4) — nhân viên XÁC NHẬN / KHIẾU NẠI bảng lương đã phát hành; HR resolve.
 *  - acknowledge/dispute/list: quyền 'acknowledge-own-payslip' (không nhạy cảm) + OWNERSHIP ép ở SERVICE.
 *  - resolve: quyền 'resolve-payslip-dispute' (NHẠY CẢM) → HR/admin (KHÔNG kế thừa wildcard).
 * @Controller() + path đầy đủ (mirror platform-accounts) — routes nằm dưới /payslips + /payslip-acknowledgements.
 */
@Controller()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PayslipAcknowledgementController {
  constructor(private readonly acks: PayslipAcknowledgementService) {}

  @Post("payslips/:id/acknowledge")
  @HttpCode(201)
  @RequirePermission("acknowledge-own-payslip", "payslip")
  acknowledge(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.acks.acknowledge(req.user, id);
  }

  @Post("payslips/:id/dispute")
  @HttpCode(201)
  @RequirePermission("acknowledge-own-payslip", "payslip")
  dispute(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: DisputePayslipDto,
  ) {
    return this.acks.dispute(req.user, id, dto);
  }

  @Get("payslips/:id/acknowledgements")
  @RequirePermission("acknowledge-own-payslip", "payslip")
  list(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Query("status") status?: string,
  ) {
    return this.acks.listForPayslip(req.user, id, {
      status: status as "acknowledged" | "disputed" | "resolved" | undefined,
    });
  }

  @Post("payslip-acknowledgements/:id/resolve")
  @RequirePermission("resolve-payslip-dispute", "payslip", { isSensitive: true })
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ResolvePayslipDisputeDto,
  ) {
    return this.acks.resolve(req.user, id, dto);
  }
}

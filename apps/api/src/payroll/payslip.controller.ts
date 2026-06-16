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
import { PayslipService } from "./payslip.service";
import { PayslipReauthService } from "./payslip-reauth.service";
import { PayslipReauthGuard } from "./payslip-reauth.guard";
import { PayslipReauthDto, RunPayrollDto } from "./payroll.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
  reauthContext?: { reauthValidUntil?: Date | null };
}

/**
 * Payslip — SNAPSHOT APPEND-ONLY (ADR-0005, BẤT BIẾN #2). Lương NHẠY CẢM (BẤT BIẾN #3):
 *  - run-payroll + view-payslip is_sensitive=TRUE ⇒ KHÔNG kế thừa wildcard *:* (G3-2).
 *  - KHÔNG có route PATCH/DELETE (append-only — sửa = ghi mới ở service).
 *  - G12-4 RE-AUTH khi xem chi tiết payslip: POST :id/reauth mint cửa sổ step-up → GET :id (PayslipReauthGuard
 *    đọc cửa sổ → service.getOne ép requiresReauth). Thiếu cửa sổ ⇒ 403 dù có view-payslip.
 */
@Controller("payslips")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PayslipController {
  constructor(
    private readonly payslips: PayslipService,
    private readonly payslipReauth: PayslipReauthService,
  ) {}

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

  // ── B1 own-payslip (nhân viên xem phiếu CỦA MÌNH, re-auth-gated, money-free-by-default) ──────────
  // Route 'me/*' khai TRƯỚC ':id' (admin) để Nest router KHÔNG nuốt 'me' vào param :id.

  // LIST money-FREE: view-own-payslip is_sensitive. Ownership ép ở service (user_id=self). KHÔNG tiền.
  @Get("me/list")
  @RequirePermission("view-own-payslip", "payslip", { isSensitive: true })
  listOwn(@Req() req: AuthenticatedRequest) {
    return this.payslips.listOwn(req.user);
  }

  // step-up own: mint cửa sổ re-auth per-(user, payslip) sau verify mật khẩu. Tái dùng PayslipReauthService.
  // Decorator CỐ Ý chỉ { isSensitive } (KHÔNG requiresReauth) — mirror @Post(":id/reauth") admin: guard ở
  // mức TYPE (resourceId=undefined, isRevealClass=false) ⇒ employee company-grant view-own-payslip QUA gate
  // nhạy cảm. Re-auth window enforce Ở SERVICE (getOwn requiresReauth+objectGrantRequired:false), KHÔNG ở guard.
  @Post("me/:id/reauth")
  @HttpCode(200)
  @RequirePermission("view-own-payslip", "payslip", { isSensitive: true })
  reauthOwn(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: PayslipReauthDto,
  ) {
    return this.payslipReauth.reauth(req.user, id, { password: dto.password });
  }

  // getOWN full tiền: PayslipReauthGuard populate cửa sổ → service.getOwn ÉP re-auth + OWNERSHIP (self).
  // Decorator chỉ { isSensitive } (mirror @Get(":id") admin): guard mức TYPE để KHÔNG suy needsObjectGrant
  // (G12-4 TRAP — nếu khai requiresReauth ở guard ⇒ deny-object-required chặn employee company-grant TRƯỚC khi
  // tới service). requiresReauth + objectGrantRequired:false ÉP ở SERVICE getOwn (fail-closed).
  @Get("me/:id")
  @UseGuards(PayslipReauthGuard)
  @RequirePermission("view-own-payslip", "payslip", { isSensitive: true })
  getOwn(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.payslips.getOwn(req.user, id, {
      reauthValidUntil: req.reauthContext?.reauthValidUntil ?? null,
    });
  }

  // G12-4 step-up: mint cửa sổ re-auth per-(user, payslip) sau khi verify mật khẩu. Gate view-payslip
  // (đúng tập người được xem chi tiết). Cửa sổ vô dụng nếu GET :id không có view-payslip + cửa sổ hợp lệ.
  @Post(":id/reauth")
  @HttpCode(200)
  @RequirePermission("view-payslip", "payslip", { isSensitive: true })
  reauth(@Req() req: AuthenticatedRequest, @Param("id") id: string, @Body() dto: PayslipReauthDto) {
    return this.payslipReauth.reauth(req.user, id, { password: dto.password });
  }

  // PayslipReauthGuard (method-level) populate req.reauthContext; service.getOne ÉP re-auth (fail-closed).
  @Get(":id")
  @UseGuards(PayslipReauthGuard)
  @RequirePermission("view-payslip", "payslip", { isSensitive: true })
  getOne(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.payslips.getOne(req.user, id, {
      reauthValidUntil: req.reauthContext?.reauthValidUntil ?? null,
    });
  }
}

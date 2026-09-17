import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import {
  payslipPdfBatchRequestSchema,
  type PayslipPdfBatchDto,
  type PayslipPdfBatchRequest,
  type PayslipPdfDto,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PayrollPayslipPdfBatchService } from "./payroll-payslip-pdf-batch.service";
import { PayrollPayslipPdfService } from "./payroll-payslip-pdf.service";
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/** Body rỗng (không gửi JSON) ⇒ `{}` rồi mới `.strict()`. */
const batchBodySchema = payslipPdfBatchRequestSchema.default({});

/**
 * S15-PAYROLL-BE-5B — `PAYROLL-API-083` PDF phiếu người khác. MỎNG — chỉ định tuyến.
 * Trả JSON `{ fileId, fileName, url, expiresAt }` (signed-URL TTL ngắn), `Cache-Control: no-store`.
 */
@Controller("payslips")
export class PayrollPayslipPdfController {
  constructor(private readonly pdf: PayrollPayslipPdfService) {}

  /** 083 — GET /payslips/:id/pdf (+ `export:payroll` ở service; audit `export`). */
  @Get(":id/pdf")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.payslipPdf.action, P.payslipPdf.resourceType, {
    isSensitive: P.payslipPdf.isSensitive,
  })
  @Header("Cache-Control", "no-store")
  adminPdf(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<PayslipPdfDto> {
    return this.pdf.adminPdf(req.user, id);
  }
}

/**
 * `PAYROLL-API-084` — PDF phiếu của chính mình. Segment `me` thuộc module ME trong `openapi-modules.ts` (khuôn
 * 031–033). Own scope, kỳ đã phát hành; phiếu người khác ⇒ 404 sentinel; 0 audit (SPEC-11 §18.1 B).
 */
@Controller("me/payslips")
export class MePayslipPdfController {
  constructor(private readonly pdf: PayrollPayslipPdfService) {}

  /** 084 — GET /me/payslips/:id/pdf. */
  @Get(":id/pdf")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.mePayslipPdf.action, P.mePayslipPdf.resourceType, {
    isSensitive: P.mePayslipPdf.isSensitive,
  })
  @Header("Cache-Control", "no-store")
  myPdf(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<PayslipPdfDto> {
    return this.pdf.myPdf(req.user, id);
  }
}

/**
 * `PAYROLL-API-085` — PDF hàng loạt, lấy-hoặc-tạo (owner O-4). Mã HTTP ĐỘNG: `202` khi lô đang sinh, `200` khi
 * xong/hỏng ⇒ `@Res({ passthrough: true })`. **KHÔNG `@Idempotent()`** (owner O-8 — xem service).
 */
@Controller("payroll-periods")
export class PayrollPayslipPdfBatchController {
  constructor(private readonly batch: PayrollPayslipPdfBatchService) {}

  /** 085 — POST /payroll-periods/:id/payslips/pdf-batch (+ `view-payslip` ở service; audit khi tạo lô). */
  @Post(":id/payslips/pdf-batch")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.payslipPdfBatch.action, P.payslipPdfBatch.resourceType, {
    isSensitive: P.payslipPdfBatch.isSensitive,
  })
  @Header("Cache-Control", "no-store")
  async requestBatch(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(batchBodySchema)) body: PayslipPdfBatchRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PayslipPdfBatchDto> {
    const result = await this.batch.request(req.user, id, body);
    res.status(result.httpStatus);
    return result.dto;
  }
}

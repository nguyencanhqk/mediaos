import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request, Response } from "express";
import {
  PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES,
  payrollAdjustmentImportQuerySchema,
  type PayrollAdjustmentImportQuery,
} from "@mediaos/contracts";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PayrollAdjustmentImportService } from "./payroll-adjustments-import.service";
import { PayrollBudgetsService } from "./payroll-budgets.service";
import {
  CompletePaymentBatchDto,
  CreatePaymentBatchDto,
  CreatePayrollBudgetDto,
  ListPaymentBatchesQueryDto,
  ListPaymentLinesQueryDto,
  ListPayrollBudgetsQueryDto,
  UpdatePaymentBatchDto,
  UpdatePayrollBudgetDto,
} from "./payroll-disbursement.dto";
import { PayrollPaymentBatchesService } from "./payroll-payment-batches.service";
import { PayrollPaymentExportService } from "./payroll-payment-export.service";
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Content-Type XLSX đặt Ở ĐƯỜNG THÀNH CÔNG, cạnh `send(buffer)` — `@Header` áp TRƯỚC handler làm 4xx đội nhãn XLSX (bài học 017). */
function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

/**
 * S15-PAYROLL-BE-4 — đợt chi trả `PAYROLL-API-066..072`. MỎNG — chỉ định tuyến, 0 nghiệp vụ. Ba luật cấp-file của module
 * áp NGUYÊN (guard TỪNG route · `ParseUUIDPipe` · `@UsePipes` cấp METHOD). `@Idempotent()` ĐÚNG HAI route: **067 · 072**.
 * 072 là `POST` KHÔNG tạo tài nguyên ⇒ `@HttpCode(200)` (SPEC-11 §15.1: chưa phủ đủ ⇒ 200, phủ đủ ⇒ 200 + kỳ `Paid`).
 * Route tĩnh không có; `:id/lines` · `:id/export` · `:id/complete` khai TRƯỚC `:id`.
 */
@Controller("payroll/payment-batches")
export class PayrollPaymentBatchesController {
  constructor(
    private readonly batches: PayrollPaymentBatchesService,
    private readonly exporter: PayrollPaymentExportService,
  ) {}

  /** 066 — GET /payroll/payment-batches (**ghi audit lượt đọc**). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchList.action, P.batchList.resourceType, {
    isSensitive: P.batchList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPaymentBatchesQueryDto) {
    return this.batches.list(req.user, query);
  }

  /** 067 — POST /payroll/payment-batches (kỳ chưa `Published` ⇒ 409 027; body `.strict()` — KHÔNG trường TK). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchCreate.action, P.batchCreate.resourceType, {
    isSensitive: P.batchCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePaymentBatchDto) {
    return this.batches.create(req.user, dto);
  }

  /** 070 — GET /payroll/payment-batches/:id/lines (`bankAccountLast4`; **ghi audit lượt đọc**). */
  @Get(":id/lines")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchLines.action, P.batchLines.resourceType, {
    isSensitive: P.batchLines.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  lines(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListPaymentLinesQueryDto,
  ) {
    return this.batches.lines(req.user, id, query);
  }

  /**
   * 071 — GET /payroll/payment-batches/:id/export (tệp UNC XLSX). Decorator = `manage:payment-batch`; service assert THÊM
   * `export:payroll` + `view-payslip:payslip` (BA cặp — SPEC-11 §15.1). `@Res()` library-mode ⇒ đi vòng qua envelope.
   */
  @Get(":id/export")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchExport.action, P.batchExport.resourceType, {
    isSensitive: P.batchExport.isSensitive,
  })
  async exportUnc(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.exporter.export(req.user, id);
    sendXlsx(res, buffer, filename);
  }

  /** 072 — POST /payroll/payment-batches/:id/complete (luật PHỦ; 028 rỗng · 027 chưa chi/đã hoàn tất/four-eyes). */
  @Post(":id/complete")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchComplete.action, P.batchComplete.resourceType, {
    isSensitive: P.batchComplete.isSensitive,
  })
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @UsePipes(ZodValidationPipe)
  complete(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CompletePaymentBatchDto,
  ) {
    return this.batches.complete(req.user, id, dto);
  }

  /** 068 — GET /payroll/payment-batches/:id (**ghi audit lượt đọc**). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchDetail.action, P.batchDetail.resourceType, {
    isSensitive: P.batchDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.batches.get(req.user, id);
  }

  /** 069 — PATCH /payroll/payment-batches/:id (chỉ `Draft`/`Ready`; `status` enum RIÊNG — `Completed` ⇒ 400). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.batchUpdate.action, P.batchUpdate.resourceType, {
    isSensitive: P.batchUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentBatchDto,
  ) {
    return this.batches.update(req.user, id, dto);
  }
}

/** `PAYROLL-API-073..075` — ngân sách lương. `@Idempotent()` ĐÚNG MỘT route: **074**. */
@Controller("payroll/budgets")
export class PayrollBudgetsController {
  constructor(private readonly budgets: PayrollBudgetsService) {}

  /** 073 — GET /payroll/budgets (kèm thực hiện; SÀN scope Company; **ghi audit lượt đọc**). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.budgetList.action, P.budgetList.resourceType, {
    isSensitive: P.budgetList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPayrollBudgetsQueryDto) {
    return this.budgets.list(req.user, query);
  }

  /** 074 — POST /payroll/budgets (trùng (năm, đơn vị) ⇒ 409 029). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.budgetCreate.action, P.budgetCreate.resourceType, {
    isSensitive: P.budgetCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePayrollBudgetDto) {
    return this.budgets.create(req.user, dto);
  }

  /** 075 — PATCH /payroll/budgets/:id (sửa hoặc xoá mềm). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.budgetUpdate.action, P.budgetUpdate.resourceType, {
    isSensitive: P.budgetUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollBudgetDto,
  ) {
    return this.budgets.update(req.user, id, dto);
  }
}

/**
 * `PAYROLL-API-076..077` — import thu nhập/khấu trừ khác. `@Controller()` gốc vì hai route ở HAI segment khác nhau
 * (`payroll-periods/:id/import-adjustments` · `payroll/imports/adjustments-template`) — cả hai đã thuộc `segments` PAYROLL
 * của `openapi-modules.ts`. 076 là multipart (`FileInterceptor` giới hạn 5MB; service kiểm lại) — không `@Body()`, query
 * validate tại chỗ `@Query(new ZodValidationPipe(...))` (khuôn HR import). `@Idempotent()` ở 076.
 */
@Controller()
export class PayrollAdjustmentImportsController {
  constructor(private readonly imports: PayrollAdjustmentImportService) {}

  /** 076 — POST /payroll-periods/:id/import-adjustments (`?dryRun=true` mặc định; toàn tệp hoặc không dòng nào). */
  @Post("payroll-periods/:id/import-adjustments")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.importAdjustments.action, P.importAdjustments.resourceType, {
    isSensitive: P.importAdjustments.isSensitive,
  })
  // KHÔNG `@Idempotent()` — CỐ Ý (security-reviewer BE-4 M2, cùng khuôn `HrImportController`): interceptor
  // idempotency chạy TRƯỚC `FileInterceptor` và băm `request.body`, mà body multipart lúc đó RỖNG ⇒ vân tay
  // hằng số, mù nội dung tệp ⇒ cùng key + tệp KHÁC sẽ phát lại phản hồi tệp #1 và im lặng bỏ tệp #2.
  // Chống nạp trùng là `warnings: possible-duplicate:<n>` (C6) + cổng duyệt thưởng/phạt.
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES } }),
  )
  importAdjustments(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query(new ZodValidationPipe(payrollAdjustmentImportQuerySchema))
    query: PayrollAdjustmentImportQuery,
  ) {
    return this.imports.import(req.user, id, file, query.dryRun);
  }

  /** 077 — GET /payroll/imports/adjustments-template (XLSX sinh từ chính khuôn cột của 076; 0 audit). */
  @Get("payroll/imports/adjustments-template")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.importTemplate.action, P.importTemplate.resourceType, {
    isSensitive: P.importTemplate.isSensitive,
  })
  async template(@Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.imports.template(req.user);
    sendXlsx(res, buffer, filename);
  }
}

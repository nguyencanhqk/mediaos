import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request, Response } from "express";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";
import {
  AdjustPayrollLineDto,
  ApproveBonusPenaltyDto,
  AttendancePeriodPickerQueryDto,
  CreateBonusPenaltyDto,
  CreatePayrollPeriodDto,
  CreateSalaryProfileDto,
  ListBonusPenaltiesQueryDto,
  ListMePayslipsQueryDto,
  ListPayrollLinesQueryDto,
  ListPayrollPeriodsQueryDto,
  ListPayslipsQueryDto,
  ListSalaryProfilesQueryDto,
  PayrollExportQueryDto,
  PeoplePickerQueryDto,
  RejectBonusPenaltyDto,
  RejectPayrollPeriodDto,
  ReopenPayrollPeriodDto,
  UpdateBonusPenaltyDto,
  UpdatePayrollPeriodDto,
  UpdateSalaryProfileDto,
} from "./payroll.dto";
import { BonusPenaltiesService } from "./bonus-penalties.service";
import { PayrollApprovalService } from "./payroll-approval.service";
import { PayrollCalcService } from "./payroll-calc.service";
import { PayrollExportService } from "./payroll-export.service";
import { PayrollPayslipsService } from "./payroll-payslips.service";
import { PayrollPeriodsService } from "./payroll-periods.service";
import { SalaryProfilesService } from "./salary-profiles.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S13-PAYROLL-BE-1 — 4 controller PAYROLL (`PAYROLL-API-001..006` · `019..028` · `034..035`). MỎNG —
 * chỉ định tuyến, 0 nghiệp vụ.
 *
 * Ba luật cấp-file, quên là ĐỎ CI (và một trong ba là lỗ bảo mật thật):
 *  1. **`@UseGuards(PermissionGuard)` trên TỪNG route.** `PermissionGuard` KHÔNG phải APP_GUARD
 *     (`route-guard-coverage.e2e-spec.ts:226`) ⇒ `@RequirePermission` một mình chỉ là **trang trí**.
 *  2. **`@Param("id", ParseUUIDPipe)`** — `param-uuid-ratchet` đặt `UNPIPED_CEILING = 1` và có ca
 *     ĐẲNG THỨC `=== 1`: không còn chỗ trống nào.
 *  3. **`@UsePipes(ZodValidationPipe)` cấp METHOD** — cấp class không validate gì.
 *
 * Cặp quyền đọc TỪ `PAYROLL_ROUTE_PAIRS` (KHÔNG literal) và truyền `isSensitive` TƯỜNG MINH — census
 * 2 tầng so cả decorator lẫn service với CÙNG bảng hằng.
 *
 * ⚠️ THỨ TỰ ROUTE `PayrollPeriodsController`: `:id` khai **sau cùng**, để BE-2 chèn `summary` (018) lên
 * trước mà không phải sắp lại (Nest nuốt segment tĩnh thành `:id` — bài học `goals/tree`).
 */
@Controller("payroll-periods")
export class PayrollPeriodsController {
  constructor(
    private readonly periods: PayrollPeriodsService,
    private readonly calc: PayrollCalcService,
    private readonly approval: PayrollApprovalService,
    private readonly payslips: PayrollPayslipsService,
    private readonly exporter: PayrollExportService,
  ) {}

  /** 001 — GET /payroll-periods (KHÔNG số tiền, kể cả tổng). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodList.action, P.periodList.resourceType, {
    isSensitive: P.periodList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPayrollPeriodsQueryDto) {
    return this.periods.list(req.user, query);
  }

  /** 002 — POST /payroll-periods (trùng tháng ⇒ 409 008). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodCreate.action, P.periodCreate.resourceType, {
    isSensitive: P.periodCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePayrollPeriodDto) {
    return this.periods.create(req.user, dto);
  }

  /** 005 — POST /payroll-periods/:id/collect (envelope KHÔNG khoá tiền nào). */
  @Post(":id/collect")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodCollect.action, P.periodCollect.resourceType, {
    isSensitive: P.periodCollect.isSensitive,
  })
  collect(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.periods.collect(req.user, id);
  }

  /** 006 — GET /payroll-periods/:id/readiness (cảnh báo MỀM, không chặn tính). */
  @Get(":id/readiness")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodReadiness.action, P.periodReadiness.resourceType, {
    isSensitive: P.periodReadiness.isSensitive,
  })
  readiness(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.periods.readiness(req.user, id);
  }

  /**
   * 018 — GET /payroll-periods/summary (tổng chi phí kỳ MỚI NHẤT).
   *
   * ⚠️ **PHẢI khai TRƯỚC `@Get(":id")`** — Nest/Express khớp theo thứ tự đăng ký, để sau thì `summary`
   * bị nuốt thành `:id` rồi ăn 400 «không phải UUID» (bài học `goals/tree`). BE-1 đã cài sẵn chú thích
   * này ở cuối controller; đừng "sắp lại cho gọn".
   */
  @Get("summary")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodSummary.action, P.periodSummary.resourceType, {
    isSensitive: P.periodSummary.isSensitive,
  })
  summary(@Req() req: AuthenticatedRequest) {
    return this.calc.summary(req.user);
  }

  /** 007 — POST /payroll-periods/:id/calculate (envelope KHÔNG khoá tiền nào). */
  @Post(":id/calculate")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodCalculate.action, P.periodCalculate.resourceType, {
    isSensitive: P.periodCalculate.isSensitive,
  })
  @Idempotent()
  calculate(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.calc.calculate(req.user, id);
  }

  /** 008 — GET /payroll-periods/:id/lines (**ghi audit lượt đọc**). */
  @Get(":id/lines")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodLines.action, P.periodLines.resourceType, {
    isSensitive: P.periodLines.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  lines(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ListPayrollLinesQueryDto,
  ) {
    return this.calc.listLines(req.user, id, query);
  }

  /**
   * 017 — GET /payroll-periods/:id/export (XLSX).
   *
   * `@Res()` library-mode ⇒ response đi VÒNG QUA envelope interceptor (bytes nhị phân, không phải JSON).
   * Cặp quyền ở decorator là `export:payroll`; vế `view-line` assert ở service (hai cặp — SPEC-11 §18).
   *
   * ⚠️ **KHÔNG dùng `@Header("Content-Type", …xlsx)`** (đã gỡ ở `S13-PAYROLL-QA-1`, đo 2026-09-01).
   * Nest áp header của `@Header` NGAY TRƯỚC khi gọi handler — tức TRƯỚC khi service kịp ném. Mọi lỗi
   * phát từ TRONG handler (403 sàn scope · 404 sentinel `PAYROLL-ERR-010` · 422 `PAYROLL-ERR-016`)
   * do đó đi ra với **thân JSON của `AllExceptionsFilter` nhưng nhãn XLSX**: `res.json()` của Express
   * chỉ đặt `application/json` khi Content-Type CHƯA có. Client (và `apiFetch` của FE) parse theo
   * nhãn ⇒ mất trắng `error.code`/`error.details`, người dùng "tải về" một file hỏng chứa JSON lỗi.
   * Lỗi 401 vẫn đúng nhãn vì guard chạy TRƯỚC bước áp header — nên bug này vô hình với mọi ca chỉ
   * đo `status`. Đặt Content-Type Ở ĐƯỜNG THÀNH CÔNG, ngay cạnh `send(buffer)`.
   */
  @Get(":id/export")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodExport.action, P.periodExport.resourceType, {
    isSensitive: P.periodExport.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  async exportXlsx(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: PayrollExportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.exporter.export(req.user, id, query);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * 009 — PATCH /payroll-periods/:id/lines/:lineId.
   *
   * ⚠️ **HAI** param UUID, **cả hai** phải qua `ParseUUIDPipe`: `param-uuid-ratchet` đặt
   * `UNPIPED_CEILING = 1` kèm ca ĐẲNG THỨC — không còn chỗ trống nào.
   */
  @Patch(":id/lines/:lineId")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodAdjustLine.action, P.periodAdjustLine.resourceType, {
    isSensitive: P.periodAdjustLine.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  adjustLine(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("lineId", ParseUUIDPipe) lineId: string,
    @Body() dto: AdjustPayrollLineDto,
  ) {
    return this.calc.adjustLine(req.user, id, lineId, dto);
  }

  /** 010 — POST /payroll-periods/:id/submit (không có người duyệt hợp lệ ⇒ 422 017). */
  @Post(":id/submit")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodSubmit.action, P.periodSubmit.resourceType, {
    isSensitive: P.periodSubmit.isSensitive,
  })
  submit(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.approval.submit(req.user, id);
  }

  /** 011 — POST /payroll-periods/:id/approve (four-eyes ⇒ 409 005). */
  @Post(":id/approve")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodApprove.action, P.periodApprove.resourceType, {
    isSensitive: P.periodApprove.isSensitive,
  })
  approve(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.approval.approve(req.user, id);
  }

  /** 012 — POST /payroll-periods/:id/reject (`reason` BẮT BUỘC). */
  @Post(":id/reject")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodReject.action, P.periodReject.resourceType, {
    isSensitive: P.periodReject.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectPayrollPeriodDto,
  ) {
    return this.approval.reject(req.user, id, dto);
  }

  /** 013 — POST /payroll-periods/:id/generate-payslips (đã sinh ⇒ **no-op 200**). */
  @Post(":id/generate-payslips")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodGeneratePayslips.action, P.periodGeneratePayslips.resourceType, {
    isSensitive: P.periodGeneratePayslips.isSensitive,
  })
  @Idempotent()
  generatePayslips(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.payslips.generate(req.user, id);
  }

  /** 014 — POST /payroll-periods/:id/publish (chưa sinh phiếu ⇒ 409 007). */
  @Post(":id/publish")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodPublish.action, P.periodPublish.resourceType, {
    isSensitive: P.periodPublish.isSensitive,
  })
  publish(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.payslips.publish(req.user, id);
  }

  /** 015 — POST /payroll-periods/:id/lock (`Locked` là terminal tuyệt đối). */
  @Post(":id/lock")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodLock.action, P.periodLock.resourceType, {
    isSensitive: P.periodLock.isSensitive,
  })
  lock(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.approval.lock(req.user, id);
  }

  /** 016 — POST /payroll-periods/:id/reopen (cặp quyền RIÊNG; đã sinh phiếu ⇒ 409 004). */
  @Post(":id/reopen")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodReopen.action, P.periodReopen.resourceType, {
    isSensitive: P.periodReopen.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  reopen(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ReopenPayrollPeriodDto,
  ) {
    return this.approval.reopen(req.user, id, dto);
  }

  /** 003 — GET /payroll-periods/:id. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodDetail.action, P.periodDetail.resourceType, {
    isSensitive: P.periodDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.periods.get(req.user, id);
  }

  /** 004 — PATCH /payroll-periods/:id (`.strict()`; KHÔNG nhận `status`). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.periodUpdate.action, P.periodUpdate.resourceType, {
    isSensitive: P.periodUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollPeriodDto,
  ) {
    return this.periods.update(req.user, id, dto);
  }
}

@Controller("salary-profiles")
export class SalaryProfilesController {
  constructor(private readonly salaries: SalaryProfilesService) {}

  /** 019 — GET /salary-profiles (**ghi audit lượt đọc**). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.salaryProfileList.action, P.salaryProfileList.resourceType, {
    isSensitive: P.salaryProfileList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListSalaryProfilesQueryDto) {
    return this.salaries.list(req.user, query);
  }

  /** 020 — POST /salary-profiles (trùng ngày hiệu lực ⇒ 409 014). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.salaryProfileCreate.action, P.salaryProfileCreate.resourceType, {
    isSensitive: P.salaryProfileCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateSalaryProfileDto) {
    return this.salaries.create(req.user, dto);
  }

  /** 021 — GET /salary-profiles/:id (**ghi audit lượt đọc**). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.salaryProfileDetail.action, P.salaryProfileDetail.resourceType, {
    isSensitive: P.salaryProfileDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.salaries.get(req.user, id);
  }

  /** 022 — PATCH /salary-profiles/:id (sửa hoặc xoá mềm `{delete:true}`). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.salaryProfileUpdate.action, P.salaryProfileUpdate.resourceType, {
    isSensitive: P.salaryProfileUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalaryProfileDto,
  ) {
    return this.salaries.update(req.user, id, dto);
  }
}

@Controller("bonus-penalties")
export class BonusPenaltiesController {
  constructor(private readonly bonuses: BonusPenaltiesService) {}

  /** 023 — GET /bonus-penalties. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.bonusPenaltyList.action, P.bonusPenaltyList.resourceType, {
    isSensitive: P.bonusPenaltyList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListBonusPenaltiesQueryDto) {
    return this.bonuses.list(req.user, query);
  }

  /** 024 — POST /bonus-penalties. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.bonusPenaltyCreate.action, P.bonusPenaltyCreate.resourceType, {
    isSensitive: P.bonusPenaltyCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateBonusPenaltyDto) {
    return this.bonuses.create(req.user, dto);
  }

  /** 027 — POST /bonus-penalties/:id/approve (tự duyệt ⇒ 409 012). */
  @Post(":id/approve")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.bonusPenaltyApprove.action, P.bonusPenaltyApprove.resourceType, {
    isSensitive: P.bonusPenaltyApprove.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApproveBonusPenaltyDto,
  ) {
    return this.bonuses.approve(req.user, id, dto);
  }

  /** 028 — POST /bonus-penalties/:id/reject (`decisionNote` BẮT BUỘC). */
  @Post(":id/reject")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.bonusPenaltyReject.action, P.bonusPenaltyReject.resourceType, {
    isSensitive: P.bonusPenaltyReject.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectBonusPenaltyDto,
  ) {
    return this.bonuses.reject(req.user, id, dto);
  }

  /** 025 — GET /bonus-penalties/:id. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.bonusPenaltyDetail.action, P.bonusPenaltyDetail.resourceType, {
    isSensitive: P.bonusPenaltyDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.bonuses.get(req.user, id);
  }

  /** 026 — PATCH /bonus-penalties/:id (chỉ khi `Pending` ⇒ 011; đã consume ⇒ 013). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.bonusPenaltyUpdate.action, P.bonusPenaltyUpdate.resourceType, {
    isSensitive: P.bonusPenaltyUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateBonusPenaltyDto,
  ) {
    return this.bonuses.update(req.user, id, dto);
  }
}

/**
 * `PAYROLL-API-029..030` — phiếu lương của NGƯỜI KHÁC. Cặp `view-payslip:payslip` (`is_sensitive`) +
 * SÀN scope Company; cả hai route **ghi audit lượt đọc** trong cùng transaction (SPEC-11 §18).
 */
@Controller("payslips")
export class PayslipsController {
  constructor(private readonly payslips: PayrollPayslipsService) {}

  /** 029 — GET /payslips. */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.payslipList.action, P.payslipList.resourceType, {
    isSensitive: P.payslipList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPayslipsQueryDto) {
    return this.payslips.list(req.user, query);
  }

  /** 030 — GET /payslips/:id (kèm breakdown). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.payslipDetail.action, P.payslipDetail.resourceType, {
    isSensitive: P.payslipDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.payslips.get(req.user, id);
  }
}

/**
 * `PAYROLL-API-031..033` — «Phiếu lương của tôi». Scope **Own** hợp lệ (3 cặp duy nhất của PAYROLL
 * tắt SÀN Company) và `objectGrantRequired = false` TƯỜNG MINH — để mặc định thì nhân viên có
 * company-grant vẫn **403 trên phiếu của chính mình** (bẫy ghi trong mig `0180`).
 *
 * ⚠️ **KHÔNG ghi audit lượt đọc** ở 031/032: tự xem lương của mình không phải sự kiện an ninh
 * (SPEC-11 §18). 033 là HÀNH ĐỘNG nên vẫn có vết.
 *
 * ⓘ Segment `me` thuộc module **ME** trong `openapi-modules.ts` — KHÔNG thêm ba route này vào
 * `segments` của PAYROLL, kẻo `openapi-contract.e2e-spec` đỏ vì một route thuộc hai module.
 */
@Controller("me/payslips")
export class MePayslipsController {
  constructor(private readonly payslips: PayrollPayslipsService) {}

  /** 031 — GET /me/payslips (chỉ kỳ `Paid`/`Locked`; chưa có phiếu ⇒ danh sách RỖNG, không lỗi). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.mePayslipList.action, P.mePayslipList.resourceType, {
    isSensitive: P.mePayslipList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  listMine(@Req() req: AuthenticatedRequest, @Query() query: ListMePayslipsQueryDto) {
    return this.payslips.listMine(req.user, query);
  }

  /** 032 — GET /me/payslips/:id (phiếu người khác ⇒ **404 sentinel**, không 403). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.mePayslipDetail.action, P.mePayslipDetail.resourceType, {
    isSensitive: P.mePayslipDetail.isSensitive,
  })
  getMine(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.payslips.getMine(req.user, id);
  }

  /** 033 — POST /me/payslips/:id/acknowledge (chưa phát hành / đã xác nhận ⇒ 409 015, hai `kind`). */
  @Post(":id/acknowledge")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.mePayslipAck.action, P.mePayslipAck.resourceType, {
    isSensitive: P.mePayslipAck.isSensitive,
  })
  acknowledge(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.payslips.acknowledge(req.user, id);
  }
}

/**
 * Hai picker dưới basePath `payroll/pickers` — **BẮT BUỘC, không phải tiện nghi**: `payroll-officer`
 * giữ **0 cặp ngoài PAYROLL** (§9g) nên không gọi được `GET /attendance/periods` (`('read','attendance')`)
 * lẫn API-03 HR; thiếu chúng thì `PAYROLL-API-002/004` và màn thưởng/phạt **không dùng được**.
 */
@Controller("payroll/pickers")
export class PayrollPickersController {
  constructor(
    private readonly salaries: SalaryProfilesService,
    private readonly periods: PayrollPeriodsService,
  ) {}

  /** 034 — GET /payroll/pickers/people. */
  @Get("people")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pickerPeople.action, P.pickerPeople.resourceType, {
    isSensitive: P.pickerPeople.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  people(@Req() req: AuthenticatedRequest, @Query() query: PeoplePickerQueryDto) {
    return this.salaries.pickPeople(req.user, query);
  }

  /** 035 — GET /payroll/pickers/attendance-periods. */
  @Get("attendance-periods")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.pickerAttendancePeriods.action, P.pickerAttendancePeriods.resourceType, {
    isSensitive: P.pickerAttendancePeriods.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  attendancePeriods(
    @Req() req: AuthenticatedRequest,
    @Query() query: AttendancePeriodPickerQueryDto,
  ) {
    return this.periods.pickAttendancePeriods(req.user, query);
  }
}

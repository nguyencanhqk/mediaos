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
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import {
  CreatePayrollTemplateDto,
  CreateSalaryComponentDto,
  CreateStatutoryRateDto,
  ListPayrollTemplatesQueryDto,
  ListSalaryComponentsQueryDto,
  ListStatutoryRatesQueryDto,
  PreviewPayrollTemplateDto,
  PutPayrollTemplateComponentsDto,
  UpdatePayrollTemplateDto,
  UpdateSalaryComponentDto,
  UpdateStatutoryRateDto,
  ValidateFormulaDto,
} from "./payroll-catalog.dto";
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";
import { PayrollTemplatesService } from "./payroll-templates.service";
import { SalaryComponentsService } from "./salary-components.service";
import { StatutoryRatesService } from "./statutory-rates.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S15-PAYROLL-BE-2 — 3 controller track B (`PAYROLL-API-044..058`). MỎNG — chỉ định tuyến, 0 nghiệp vụ.
 *
 * Ba luật cấp-file của module (xem `payroll.controllers.ts`) áp NGUYÊN, quên là ĐỎ CI:
 *  1. **`@UseGuards(PermissionGuard)` trên TỪNG route** — guard KHÔNG phải APP_GUARD.
 *  2. **`@Param(..., ParseUUIDPipe)`** — `param-uuid-ratchet` không còn chỗ trống.
 *  3. **`@UsePipes(ZodValidationPipe)` cấp METHOD** trên mọi route có `@Body()`/`@Query()`.
 *
 * Cặp quyền đọc TỪ `PAYROLL_ROUTE_PAIRS` + `isSensitive` TƯỜNG MINH (census 2 tầng so với CÙNG bảng hằng).
 *
 * ⚠️ `@Idempotent()` ĐÚNG BA route: **045 · 050 · 056** (danh sách 11 route v2 là ĐÓNG — API-18 §5b).
 * ⚠️ 048 và 054 là `POST` KHÔNG tạo tài nguyên ⇒ `@HttpCode(200)`, không để mặc định 201.
 */
@Controller("payroll/salary-components")
export class PayrollSalaryComponentsController {
  constructor(private readonly components: SalaryComponentsService) {}

  /** 044 */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.componentList.action, P.componentList.resourceType, {
    isSensitive: P.componentList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListSalaryComponentsQueryDto) {
    return this.components.list(req.user, query);
  }

  /** 045 — kiểm cú pháp/vòng/giới hạn khi lưu (⇒ 018/019); mã dành riêng ⇒ 409 024. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.componentCreate.action, P.componentCreate.resourceType, {
    isSensitive: P.componentCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateSalaryComponentDto) {
    return this.components.create(req.user, dto);
  }

  /**
   * 048 — kiểm tại chỗ, KHÔNG ghi. Khai TRƯỚC các route `:id` (API-18 §5b bẫy 2). Gác cặp GHI vì nó phơi ra chính
   * parser (SPEC-11 §18.1 D).
   */
  @Post("validate-formula")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(P.componentValidateFormula.action, P.componentValidateFormula.resourceType, {
    isSensitive: P.componentValidateFormula.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  validateFormula(@Req() req: AuthenticatedRequest, @Body() dto: ValidateFormulaDto) {
    return this.components.validateFormula(req.user, dto);
  }

  /** 046 */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.componentDetail.action, P.componentDetail.resourceType, {
    isSensitive: P.componentDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.components.get(req.user, id);
  }

  /** 047 — hàng hệ thống chỉ `name`/`sortOrder` (409 024); audit kèm diff công thức. */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.componentUpdate.action, P.componentUpdate.resourceType, {
    isSensitive: P.componentUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSalaryComponentDto,
  ) {
    return this.components.update(req.user, id, dto);
  }
}

@Controller("payroll/templates")
export class PayrollTemplatesController {
  constructor(private readonly templates: PayrollTemplatesService) {}

  /** 049 */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.templateList.action, P.templateList.resourceType, {
    isSensitive: P.templateList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPayrollTemplatesQueryDto) {
    return this.templates.list(req.user, query);
  }

  /** 050 */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.templateCreate.action, P.templateCreate.resourceType, {
    isSensitive: P.templateCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePayrollTemplateDto) {
    return this.templates.create(req.user, dto);
  }

  /** 051 — kèm fingerprint tập công thức hiện tại. */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.templateDetail.action, P.templateDetail.resourceType, {
    isSensitive: P.templateDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.templates.get(req.user, id);
  }

  /** 052 */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.templateUpdate.action, P.templateUpdate.resourceType, {
    isSensitive: P.templateUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollTemplateDto,
  ) {
    return this.templates.update(req.user, id, dto);
  }

  /** 053 — ĐẶT LẠI toàn bộ danh sách thành phần trong MỘT lượt. */
  @Put(":id/components")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.templatePutComponents.action, P.templatePutComponents.resourceType, {
    isSensitive: P.templatePutComponents.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  putComponents(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PutPayrollTemplateComponentsDto,
  ) {
    return this.templates.putComponents(req.user, id, dto);
  }

  /** 054 — xem trước với dữ liệu GIẢ; KHÔNG ghi, KHÔNG audit. Gác cặp GHI (cùng lý do 048). */
  @Post(":id/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(PermissionGuard)
  @RequirePermission(P.templatePreview.action, P.templatePreview.resourceType, {
    isSensitive: P.templatePreview.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  preview(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: PreviewPayrollTemplateDto,
  ) {
    return this.templates.preview(req.user, id, dto);
  }
}

@Controller("payroll/statutory-rates")
export class PayrollStatutoryRatesController {
  constructor(private readonly rates: StatutoryRatesService) {}

  /** 055 */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.statutoryRateList.action, P.statutoryRateList.resourceType, {
    isSensitive: P.statutoryRateList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListStatutoryRatesQueryDto) {
    return this.rates.list(req.user, query);
  }

  /** 056 — 7 bậc liên tục (⇒ 422 022); trùng ngày hiệu lực ⇒ 409 033. */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.statutoryRateCreate.action, P.statutoryRateCreate.resourceType, {
    isSensitive: P.statutoryRateCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateStatutoryRateDto) {
    return this.rates.create(req.user, dto);
  }

  /** 057 */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.statutoryRateDetail.action, P.statutoryRateDetail.resourceType, {
    isSensitive: P.statutoryRateDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.rates.get(req.user, id);
  }

  /** 058 — bản đã có kỳ dùng ⇒ 409 033 `rate-in-use`. */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.statutoryRateUpdate.action, P.statutoryRateUpdate.resourceType, {
    isSensitive: P.statutoryRateUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatutoryRateDto,
  ) {
    return this.rates.update(req.user, id, dto);
  }
}

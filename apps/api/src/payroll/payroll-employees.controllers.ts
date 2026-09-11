import {
  Body,
  Controller,
  Get,
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
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";
import {
  CreatePayrollDependentDto,
  ListPayrollEmployeesQueryDto,
  PutPayrollEmployeeSettingsDto,
  UpdatePayrollDependentDto,
} from "./payroll.dto";
import { PayrollDependentsService } from "./payroll-dependents.service";
import { PayrollEmployeeSettingsService } from "./payroll-employee-settings.service";
import { PayrollEmployeesService } from "./payroll-employees.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S15-PAYROLL-BE-1 — 2 controller track A (`PAYROLL-API-036..042`). MỎNG — chỉ định tuyến, 0 nghiệp vụ.
 *
 * Ba luật cấp-file của module (xem `payroll.controllers.ts`) áp NGUYÊN, quên là ĐỎ CI:
 *  1. **`@UseGuards(PermissionGuard)` trên TỪNG route** — guard KHÔNG phải APP_GUARD
 *     (`route-guard-coverage.e2e-spec.ts`) ⇒ `@RequirePermission` một mình chỉ là **trang trí**.
 *  2. **`@Param(..., ParseUUIDPipe)`** — `param-uuid-ratchet` đặt `UNPIPED_CEILING = 1` và có ca
 *     ĐẲNG THỨC `=== 1`: không còn chỗ trống nào.
 *  3. **`@UsePipes(ZodValidationPipe)` cấp METHOD** — cấp class không validate gì
 *     (`nestjs-zod-class-level-pipe-does-nothing`), và `body-validation-ratchet` đặt 0 offender.
 *
 * Cặp quyền đọc TỪ `PAYROLL_ROUTE_PAIRS` (KHÔNG literal) + truyền `isSensitive` TƯỜNG MINH — census
 * 2 tầng so CẢ decorator lẫn service với CÙNG bảng hằng.
 *
 * ⚠️ **Prefix `payroll/employees` là controller RIÊNG**, không nhét vào `PayrollPickersController`
 * (prefix `payroll/pickers`): SPEC-11 §15.1 bẫy 4 — hai nhóm chung prefix `payroll` mà khác segment thứ
 * hai thì Nest vẫn khớp đúng, nhưng gom chung một controller sẽ làm `:userId` của nhóm này nuốt
 * `pickers` nếu ai đó đổi thứ tự khai.
 *
 * ⚠️ **`@Idempotent()` ĐÚNG HAI route của track A: 039 · 041** — danh sách 11 route nhận
 * `Idempotency-Key` của v2 là ĐÓNG (SPEC-11 §15.1). Khoá do CLIENT sinh, server KHÔNG tự suy từ payload
 * (`idempotency-key-must-be-content-derived` — tự suy làm hai lượt khác nhau đụng nhau).
 */
@Controller("payroll/employees")
export class PayrollEmployeesController {
  constructor(
    private readonly employees: PayrollEmployeesService,
    private readonly settings: PayrollEmployeeSettingsService,
    private readonly dependents: PayrollDependentsService,
  ) {}

  /** 036 — GET /payroll/employees (**ghi audit lượt đọc**). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.employeeList.action, P.employeeList.resourceType, {
    isSensitive: P.employeeList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPayrollEmployeesQueryDto) {
    return this.employees.list(req.user, query);
  }

  /**
   * 038 — GET /payroll/employees/:userId/settings.
   * ⚠️ Khai TRƯỚC `:userId` trần? Không cần: `:userId/settings` có segment thứ hai nên Nest không nhầm
   * với `:userId`. Thứ tự dưới đây giữ theo mã route cho dễ đối chiếu SPEC.
   */
  @Get(":userId/settings")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.employeeSettingsGet.action, P.employeeSettingsGet.resourceType, {
    isSensitive: P.employeeSettingsGet.isSensitive,
  })
  getSettings(@Req() req: AuthenticatedRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.settings.get(req.user, userId);
  }

  /** 039 — PUT /payroll/employees/:userId/settings (upsert 1 hàng/nhân sự; envelope 0 khoá PII). */
  @Put(":userId/settings")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.employeeSettingsPut.action, P.employeeSettingsPut.resourceType, {
    isSensitive: P.employeeSettingsPut.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  putSettings(
    @Req() req: AuthenticatedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: PutPayrollEmployeeSettingsDto,
  ) {
    return this.settings.upsert(req.user, userId, dto);
  }

  /** 040 — GET /payroll/employees/:userId/dependents (**ghi audit lượt đọc**). */
  @Get(":userId/dependents")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.employeeDependentList.action, P.employeeDependentList.resourceType, {
    isSensitive: P.employeeDependentList.isSensitive,
  })
  listDependents(@Req() req: AuthenticatedRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.dependents.list(req.user, userId);
  }

  /** 041 — POST /payroll/employees/:userId/dependents (chồng lấp ⇒ 409 032). */
  @Post(":userId/dependents")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.employeeDependentCreate.action, P.employeeDependentCreate.resourceType, {
    isSensitive: P.employeeDependentCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  createDependent(
    @Req() req: AuthenticatedRequest,
    @Param("userId", ParseUUIDPipe) userId: string,
    @Body() dto: CreatePayrollDependentDto,
  ) {
    return this.dependents.create(req.user, userId, dto);
  }

  /** 037 — GET /payroll/employees/:userId. Khai SAU hai nhóm `:userId/...` để không nuốt segment. */
  @Get(":userId")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.employeeDetail.action, P.employeeDetail.resourceType, {
    isSensitive: P.employeeDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.employees.get(req.user, userId);
  }
}

/**
 * 042 — `PATCH /payroll/dependents/:id`. **KHÔNG lồng dưới `/payroll/employees/:userId`** — có chủ
 * đích (SPEC-11 §15.1): `dependentId` đã đủ định danh, và lồng thêm `userId` tạo **hai nguồn sự thật
 * cho cùng một phép kiểm quyền** (URL nói người A, hàng DB nói người B). Service kiểm hàng thuộc
 * company rồi resolve `userId` **TỪ HÀNG**, không từ URL.
 */
@Controller("payroll/dependents")
export class PayrollDependentsController {
  constructor(private readonly dependents: PayrollDependentsService) {}

  /** 042 — sửa **hoặc** xoá mềm (`{delete:true}`); chồng lấp ⇒ 409 032. Envelope 0 khoá PII. */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.dependentUpdate.action, P.dependentUpdate.resourceType, {
    isSensitive: P.dependentUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollDependentDto,
  ) {
    return this.dependents.update(req.user, id, dto);
  }
}

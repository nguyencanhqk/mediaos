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
  ApproveBonusPenaltyDto,
  AttendancePeriodPickerQueryDto,
  CreateBonusPenaltyDto,
  CreatePayrollPeriodDto,
  CreateSalaryProfileDto,
  ListBonusPenaltiesQueryDto,
  ListPayrollPeriodsQueryDto,
  ListSalaryProfilesQueryDto,
  PeoplePickerQueryDto,
  RejectBonusPenaltyDto,
  UpdateBonusPenaltyDto,
  UpdatePayrollPeriodDto,
  UpdateSalaryProfileDto,
} from "./payroll.dto";
import { BonusPenaltiesService } from "./bonus-penalties.service";
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
  constructor(private readonly periods: PayrollPeriodsService) {}

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

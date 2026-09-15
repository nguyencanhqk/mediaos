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
import { PayrollAdvancesService } from "./payroll-advances.service";
import {
  ApprovePayrollAdvanceDto,
  CreatePayrollAdvanceDto,
  ListMePayrollAdvancesQueryDto,
  ListPayrollAdvancesQueryDto,
  RejectPayrollAdvanceDto,
  UpdatePayrollAdvanceDto,
} from "./payroll-disbursement.dto";
import { PAYROLL_ROUTE_PAIRS as P } from "./payroll-route-pairs.const";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S15-PAYROLL-BE-4 — tạm ứng `PAYROLL-API-059..064` + Own `065`. MỎNG — chỉ định tuyến, 0 nghiệp vụ.
 *
 * Ba luật cấp-file của module (xem `payroll.controllers.ts`) áp NGUYÊN: `@UseGuards(PermissionGuard)` TỪNG route ·
 * `@Param(..., ParseUUIDPipe)` · `@UsePipes(ZodValidationPipe)` cấp METHOD. Cặp quyền đọc TỪ `PAYROLL_ROUTE_PAIRS`.
 * `@Idempotent()` ĐÚNG MỘT route: **060**. Route tĩnh không có ⇒ `:id` khai sau cùng theo thói quen (bài học `goals/tree`).
 */
@Controller("payroll/advances")
export class PayrollAdvancesController {
  constructor(private readonly advances: PayrollAdvancesService) {}

  /** 059 — GET /payroll/advances (**ghi audit lượt đọc**). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.advanceList.action, P.advanceList.resourceType, {
    isSensitive: P.advanceList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  list(@Req() req: AuthenticatedRequest, @Query() query: ListPayrollAdvancesQueryDto) {
    return this.advances.list(req.user, query);
  }

  /** 060 — POST /payroll/advances (kỳ đích đã tính ⇒ 409 026; envelope 0 khoá tiền). */
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.advanceCreate.action, P.advanceCreate.resourceType, {
    isSensitive: P.advanceCreate.isSensitive,
  })
  @Idempotent()
  @UsePipes(ZodValidationPipe)
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreatePayrollAdvanceDto) {
    return this.advances.create(req.user, dto);
  }

  /** 063 — POST /payroll/advances/:id/approve (tự duyệt — người tạo HOẶC thụ hưởng ⇒ 409 025). */
  @Post(":id/approve")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.advanceApprove.action, P.advanceApprove.resourceType, {
    isSensitive: P.advanceApprove.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: ApprovePayrollAdvanceDto,
  ) {
    return this.advances.approve(req.user, id, dto);
  }

  /** 064 — POST /payroll/advances/:id/reject (`note` BẮT BUỘC). */
  @Post(":id/reject")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.advanceReject.action, P.advanceReject.resourceType, {
    isSensitive: P.advanceReject.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: RejectPayrollAdvanceDto,
  ) {
    return this.advances.reject(req.user, id, dto);
  }

  /** 061 — GET /payroll/advances/:id (**ghi audit lượt đọc**). */
  @Get(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.advanceDetail.action, P.advanceDetail.resourceType, {
    isSensitive: P.advanceDetail.isSensitive,
  })
  getOne(@Req() req: AuthenticatedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.advances.get(req.user, id);
  }

  /** 062 — PATCH /payroll/advances/:id (chỉ `Pending` chưa khấu trừ ⇒ 025; `delete:true` = xoá mềm). */
  @Patch(":id")
  @UseGuards(PermissionGuard)
  @RequirePermission(P.advanceUpdate.action, P.advanceUpdate.resourceType, {
    isSensitive: P.advanceUpdate.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  update(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdatePayrollAdvanceDto,
  ) {
    return this.advances.update(req.user, id, dto);
  }
}

/**
 * `PAYROLL-API-065` — «Tạm ứng của tôi». Scope **Own** (sàn Company TẮT, `objectGrantRequired = false` tường minh —
 * cùng khuôn `MePayslipsController`). **KHÔNG ghi audit lượt đọc** (tự xem của mình). Segment `me` thuộc module ME
 * trong `openapi-modules.ts` — KHÔNG thêm vào `segments` của PAYROLL.
 */
@Controller("me/payroll-advances")
export class MePayrollAdvancesController {
  constructor(private readonly advances: PayrollAdvancesService) {}

  /** 065 — GET /me/payroll-advances (chưa có ⇒ danh sách RỖNG, không lỗi). */
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission(P.meAdvanceList.action, P.meAdvanceList.resourceType, {
    isSensitive: P.meAdvanceList.isSensitive,
  })
  @UsePipes(ZodValidationPipe)
  listMine(@Req() req: AuthenticatedRequest, @Query() query: ListMePayrollAdvancesQueryDto) {
    return this.advances.listMine(req.user, query);
  }
}

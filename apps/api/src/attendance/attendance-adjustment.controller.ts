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
import {
  ATT_PERMISSIONS,
  ATT_RESOURCES,
  type AttPermissionPair,
  type AttResourceType,
} from "./attendance-permissions.const";
import { AttendanceAdjustmentService } from "./attendance-adjustment.service";
import {
  AdjustmentListQueryDto,
  ApproveAdjustmentDto,
  CreateAdjustmentRequestDto,
  DirectAdjustDto,
  RejectAdjustmentDto,
} from "./attendance-adjustment.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/** Bind a permission pair from the REAL catalog (fail-fast on drift) — mirrors AttendanceController. */
function attPair(action: string, resourceType: AttResourceType): AttPermissionPair {
  const pair = ATT_PERMISSIONS.find((p) => p.action === action && p.resourceType === resourceType);
  if (!pair) throw new Error(`ATT permission pair missing from catalog: ${action}:${resourceType}`);
  return pair;
}

const ADJ = ATT_RESOURCES.ADJUSTMENT;
const ATT = ATT_RESOURCES.ATTENDANCE;
const CREATE_OWN = attPair("create-own", ADJ);
const VIEW_OWN = attPair("view-own", ADJ);
const VIEW_TEAM = attPair("view-team", ADJ);
const VIEW_COMPANY = attPair("view-company", ADJ);
const APPROVE = attPair("approve", ADJ);
const REJECT = attPair("reject", ADJ);
const ADJUST_DIRECT = attPair("adjust-direct", ATT);

/**
 * S3-ATT-BE-4 — canonical adjustment-request HTTP surface (ATT-FUNC-018..022). Every route fail-closed
 * behind PermissionGuard with the EXACT engine pair (create-own/view-own/view-team/view-company/approve/
 * reject:adjustment · adjust-direct:attendance) — no generic read/adjust. Scope FILTER + 403-vs-404 policy
 * live in the service (DataScopeService). Static /my + /team declared BEFORE /:id so Express never shadows
 * them. Shares the "attendance" prefix with AttendanceController (distinct paths → no route collision).
 */
@Controller("attendance")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class AttendanceAdjustmentController {
  constructor(private readonly service: AttendanceAdjustmentService) {}

  @Post("adjustment-requests")
  @RequirePermission(CREATE_OWN.action, CREATE_OWN.resourceType, {
    isSensitive: CREATE_OWN.sensitive,
  })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateAdjustmentRequestDto) {
    return this.service.createRequest(req.user, dto);
  }

  @Get("adjustment-requests/my")
  @RequirePermission(VIEW_OWN.action, VIEW_OWN.resourceType, { isSensitive: VIEW_OWN.sensitive })
  listMy(@Req() req: AuthenticatedRequest, @Query() query: AdjustmentListQueryDto) {
    return this.service.listMy(req.user, query);
  }

  @Get("adjustment-requests/team")
  @RequirePermission(VIEW_TEAM.action, VIEW_TEAM.resourceType, { isSensitive: VIEW_TEAM.sensitive })
  listTeam(@Req() req: AuthenticatedRequest, @Query() query: AdjustmentListQueryDto) {
    return this.service.listTeam(req.user, query);
  }

  @Get("adjustment-requests")
  @RequirePermission(VIEW_COMPANY.action, VIEW_COMPANY.resourceType, {
    isSensitive: VIEW_COMPANY.sensitive,
  })
  listCompany(@Req() req: AuthenticatedRequest, @Query() query: AdjustmentListQueryDto) {
    return this.service.listCompany(req.user, query);
  }

  @Get("adjustment-requests/:id")
  @RequirePermission(VIEW_OWN.action, VIEW_OWN.resourceType, { isSensitive: VIEW_OWN.sensitive })
  getDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.getDetail(req.user, id);
  }

  @Post("adjustment-requests/:id/approve")
  @HttpCode(200)
  @RequirePermission(APPROVE.action, APPROVE.resourceType, { isSensitive: APPROVE.sensitive })
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveAdjustmentDto,
  ) {
    return this.service.approve(req.user, id, dto);
  }

  @Post("adjustment-requests/:id/reject")
  @HttpCode(200)
  @RequirePermission(REJECT.action, REJECT.resourceType, { isSensitive: REJECT.sensitive })
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectAdjustmentDto,
  ) {
    return this.service.reject(req.user, id, dto);
  }

  @Post("records/:id/adjust-direct")
  @HttpCode(200)
  @RequirePermission(ADJUST_DIRECT.action, ADJUST_DIRECT.resourceType, {
    isSensitive: ADJUST_DIRECT.sensitive,
  })
  adjustDirect(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: DirectAdjustDto,
  ) {
    return this.service.adjustDirect(req.user, id, dto);
  }
}

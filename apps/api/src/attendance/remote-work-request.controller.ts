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
import { RemoteWorkRequestService } from "./remote-work-request.service";
import {
  ApproveRemoteWorkRequestDto,
  CreateRemoteWorkRequestDto,
  RejectRemoteWorkRequestDto,
  RemoteWorkRequestListQueryDto,
  SubmitRemoteWorkRequestDto,
} from "./remote-work-request.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string; email: string };
}

/** Bind a permission pair from the REAL catalog (fail-fast on drift) — mirrors AttendanceAdjustmentController. */
function attPair(action: string, resourceType: AttResourceType): AttPermissionPair {
  const pair = ATT_PERMISSIONS.find((p) => p.action === action && p.resourceType === resourceType);
  if (!pair) throw new Error(`ATT permission pair missing from catalog: ${action}:${resourceType}`);
  return pair;
}

const RR = ATT_RESOURCES.REMOTE_REQUEST;
const CREATE_OWN = attPair("create-own", RR);
const VIEW_OWN = attPair("view-own", RR);
const VIEW_TEAM = attPair("view-team", RR);
const VIEW_COMPANY = attPair("view-company", RR);
const APPROVE = attPair("approve", RR);
const REJECT = attPair("reject", RR);
const CANCEL_OWN = attPair("cancel-own", RR);

/**
 * S3-ATT-BE-5 — remote/onsite-work request HTTP surface (CO-S4-004). Every route fail-closed behind
 * PermissionGuard with the EXACT engine pair (create-own/view-own/view-team/view-company/approve/reject/
 * cancel-own:remote-request — mig 0454 catalog, NO invented pair). `submit` (Draft→Pending) is gated on
 * create-own — it is the owner-only continuation of the create lifecycle (no separate 'submit' pair in
 * the catalog; approve/reject remain gated on their own pairs). Static /my/team declared BEFORE /:id so
 * Express never shadows them.
 */
@Controller("attendance/remote-work-requests")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class RemoteWorkRequestController {
  constructor(private readonly service: RemoteWorkRequestService) {}

  @Post()
  @RequirePermission(CREATE_OWN.action, CREATE_OWN.resourceType, {
    isSensitive: CREATE_OWN.sensitive,
  })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRemoteWorkRequestDto) {
    return this.service.createRequest(req.user, dto);
  }

  @Post(":id/submit")
  @HttpCode(200)
  @RequirePermission(CREATE_OWN.action, CREATE_OWN.resourceType, {
    isSensitive: CREATE_OWN.sensitive,
  })
  submit(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: SubmitRemoteWorkRequestDto,
  ) {
    return this.service.submit(req.user, id, dto);
  }

  @Get("my")
  @RequirePermission(VIEW_OWN.action, VIEW_OWN.resourceType, { isSensitive: VIEW_OWN.sensitive })
  listMy(@Req() req: AuthenticatedRequest, @Query() query: RemoteWorkRequestListQueryDto) {
    return this.service.listMy(req.user, query);
  }

  @Get("team")
  @RequirePermission(VIEW_TEAM.action, VIEW_TEAM.resourceType, { isSensitive: VIEW_TEAM.sensitive })
  listTeam(@Req() req: AuthenticatedRequest, @Query() query: RemoteWorkRequestListQueryDto) {
    return this.service.listTeam(req.user, query);
  }

  @Get()
  @RequirePermission(VIEW_COMPANY.action, VIEW_COMPANY.resourceType, {
    isSensitive: VIEW_COMPANY.sensitive,
  })
  listCompany(@Req() req: AuthenticatedRequest, @Query() query: RemoteWorkRequestListQueryDto) {
    return this.service.listCompany(req.user, query);
  }

  @Get(":id")
  @RequirePermission(VIEW_OWN.action, VIEW_OWN.resourceType, { isSensitive: VIEW_OWN.sensitive })
  getDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.getDetail(req.user, id);
  }

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermission(APPROVE.action, APPROVE.resourceType, { isSensitive: APPROVE.sensitive })
  approve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveRemoteWorkRequestDto,
  ) {
    return this.service.approve(req.user, id, dto);
  }

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermission(REJECT.action, REJECT.resourceType, { isSensitive: REJECT.sensitive })
  reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectRemoteWorkRequestDto,
  ) {
    return this.service.reject(req.user, id, dto);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission(CANCEL_OWN.action, CANCEL_OWN.resourceType, {
    isSensitive: CANCEL_OWN.sensitive,
  })
  cancelOwn(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.service.cancelOwn(req.user, id);
  }
}

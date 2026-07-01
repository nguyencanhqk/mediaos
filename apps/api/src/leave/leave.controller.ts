import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
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
  LEAVE_PERMISSIONS,
  LEAVE_RESOURCES,
  type LeavePermissionPair,
  type LeaveResourceType,
} from "./leave-permissions.const";
import { LeaveApprovalService } from "./leave-approval.service";
import { LeaveReadService } from "./leave-read.service";
import { LeaveRequestService } from "./leave-request.service";
import { LeaveService } from "./leave.service";
import {
  ApproveLeaveRequestDto,
  CancelLeaveRequestDto,
  CreateLeaveRequestDraftDto,
  CreateLeaveTypeDto,
  LeaveCalculateDto,
  LeaveCalendarQueryDto,
  LeaveListQueryDto,
  LeaveRequestListQueryDto,
  PendingLeaveRequestListQueryDto,
  RejectLeaveRequestDto,
  SubmitLeaveRequestDto,
  UpdateLeaveRequestDraftDto,
  UpdateLeaveTypeDto,
  UpsertLeaveBalanceDto,
} from "./leave.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S3-LEAVE-BE-1: bind @RequirePermission from the REAL catalog pair (leave-permissions.const = single source
 * of truth, in sync with mig 0455) — NOT hard-coded strings (avoids the action/resource drift hit at
 * S1-FND-MODULE). Fail-fast at load if a pair is missing from the catalog. Mirrors attendance.controller attPair().
 */
function leavePair(action: string, resourceType: LeaveResourceType): LeavePermissionPair {
  const pair = LEAVE_PERMISSIONS.find(
    (p) => p.action === action && p.resourceType === resourceType,
  );
  if (!pair) {
    throw new Error(`LEAVE permission pair missing from catalog: ${action}:${resourceType}`);
  }
  return pair;
}

// view:leave-type (read catalog — granted to all 4 canonical roles @ Company in mig 0455; replaces the
// orphaned read:leave pair the legacy route used). view-own:leave-balance + create:leave for the new routes.
const VIEW_LEAVE_TYPE = leavePair("view", LEAVE_RESOURCES.LEAVE_TYPE);
const VIEW_OWN_BALANCE = leavePair("view-own", LEAVE_RESOURCES.LEAVE_BALANCE);
const CREATE_LEAVE = leavePair("create", LEAVE_RESOURCES.LEAVE);
// S3-LEAVE-BE-2 — self-service workflow pairs (mig 0455, granted @ Own to all 4 canonical roles).
const SUBMIT_LEAVE = leavePair("submit", LEAVE_RESOURCES.LEAVE);
const UPDATE_DRAFT_LEAVE = leavePair("update-draft", LEAVE_RESOURCES.LEAVE);
const CANCEL_OWN_LEAVE = leavePair("cancel-own", LEAVE_RESOURCES.LEAVE);
const VIEW_OWN_LEAVE = leavePair("view-own", LEAVE_RESOURCES.LEAVE);
// S3-LEAVE-BE-3 — management/approval pairs (mig 0455). view:leave + reject:leave are SENSITIVE (cross-read
// / management) → wildcard grant does NOT satisfy; approve:leave is non-sensitive. Scope (Team/Company) is
// enforced in LeaveApprovalService (resolveContext + isEmployeeInScope), NOT here.
const VIEW_LEAVE = leavePair("view", LEAVE_RESOURCES.LEAVE);
const APPROVE_LEAVE = leavePair("approve", LEAVE_RESOURCES.LEAVE);
const REJECT_LEAVE = leavePair("reject", LEAVE_RESOURCES.LEAVE);

/**
 * G11-2 — Leave HTTP surface. Every route gated by PermissionGuard (@RequirePermission, fail-closed).
 * Resource type = 'leave'. Self-service (read own balance, create/cancel own request) vs. management
 * (manage types/balances, approve/reject, list-all, team calendar) split by action in the catalog (0063).
 */
@Controller("leave")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class LeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly leaveRead: LeaveReadService,
    private readonly leaveRequest: LeaveRequestService,
    private readonly leaveApproval: LeaveApprovalService,
  ) {}

  // ─── Leave types ─────────────────────────────────────────────────────────────

  // S3-LEAVE-BE-1 re-gate: was @RequirePermission('read','leave') (orphaned media-era pair NOT granted to
  // the 4 canonical roles) → view:leave-type (granted @ Company to employee/manager/hr/company-admin, mig
  // 0455). Re-pointed to the read service → richer DTO (mig 0453 config columns), active-only, sorted.
  @Get("types")
  @RequirePermission(VIEW_LEAVE_TYPE.action, VIEW_LEAVE_TYPE.resourceType, {
    isSensitive: VIEW_LEAVE_TYPE.sensitive,
  })
  listTypes(@Req() req: AuthenticatedRequest) {
    return this.leaveRead.listTypes(req.user.companyId);
  }

  @Post("types")
  @RequirePermission("manage", "leave")
  createType(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeaveTypeDto) {
    return this.leave.createType(req.user, dto);
  }

  @Patch("types/:id")
  @RequirePermission("manage", "leave")
  updateType(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leave.updateType(req.user, id, dto);
  }

  // ─── Leave balances ──────────────────────────────────────────────────────────

  // S3-LEAVE-BE-1 NEW: own balances (self-locked by user_id in the service). view-own:leave-balance is
  // granted to all 4 canonical roles @ Own (mig 0455). Declared BEFORE /balances (distinct path; 2 segments).
  @Get("me/balances")
  @RequirePermission(VIEW_OWN_BALANCE.action, VIEW_OWN_BALANCE.resourceType, {
    isSensitive: VIEW_OWN_BALANCE.sensitive,
  })
  listMyBalances(@Req() req: AuthenticatedRequest) {
    return this.leaveRead.listMyBalances(req.user);
  }

  // ─── My leave requests (S3-LEAVE-BE-2 self-service) ──────────────────────────
  // Static "me/requests" declared BEFORE "me/requests/:id" (Express order: static before param, same verb).
  // view-own:leave (Own) — list/detail SELF-LOCKED by user_id in the service (not a scope query). 404 (not
  // 403) when a request exists but isn't owned/cross-tenant → never leak existence.

  @Get("me/requests")
  @RequirePermission(VIEW_OWN_LEAVE.action, VIEW_OWN_LEAVE.resourceType, {
    isSensitive: VIEW_OWN_LEAVE.sensitive,
  })
  listMyRequests(@Req() req: AuthenticatedRequest, @Query() query: LeaveRequestListQueryDto) {
    return this.leaveRequest.listMine(req.user, query);
  }

  @Get("me/requests/:id")
  @RequirePermission(VIEW_OWN_LEAVE.action, VIEW_OWN_LEAVE.resourceType, {
    isSensitive: VIEW_OWN_LEAVE.sensitive,
  })
  getMyRequest(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.leaveRequest.getMineDetail(req.user, id);
  }

  @Get("balances")
  @RequirePermission("read", "leave")
  listBalances(@Req() req: AuthenticatedRequest, @Query() query: LeaveListQueryDto) {
    return this.leave.listBalances(req.user, { scope: query.scope, year: query.year });
  }

  @Post("balances")
  @RequirePermission("manage", "leave")
  upsertBalance(@Req() req: AuthenticatedRequest, @Body() dto: UpsertLeaveBalanceDto) {
    return this.leave.upsertBalance(req.user, dto);
  }

  // ─── Leave requests (→ Task Hub) ─────────────────────────────────────────────

  // S3-LEAVE-BE-3 REPOINT: management list for approvers. Was ('read','leave') (orphaned pair) → view:leave
  // (SENSITIVE, mig 0455). SCOPED in LeaveApprovalService: manager=Team, hr/company-admin=Company; employees
  // (no view:leave grant) → 403 at the guard. status defaults to 'Pending' + pagination/filters.
  @Get("requests")
  @RequirePermission(VIEW_LEAVE.action, VIEW_LEAVE.resourceType, {
    isSensitive: VIEW_LEAVE.sensitive,
  })
  listRequests(@Req() req: AuthenticatedRequest, @Query() query: PendingLeaveRequestListQueryDto) {
    return this.leaveApproval.listPending(req.user, query);
  }

  // S3-LEAVE-BE-2 REPOINT: create now produces a Draft via LeaveRequestService (FSM Draft→Pending→Cancelled).
  // submitNow=true in the body runs the submit path in the same tx. create:leave (Own) gate.
  @Post("requests")
  @RequirePermission(CREATE_LEAVE.action, CREATE_LEAVE.resourceType, {
    isSensitive: CREATE_LEAVE.sensitive,
  })
  createRequest(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeaveRequestDraftDto) {
    return this.leaveRequest.createDraft(req.user, dto);
  }

  // S3-LEAVE-BE-1 NEW: LEAVE-API-301 preview (canonical path /leave/requests/calculate). PREVIEW ONLY —
  // no mutation. create:leave gate (view:leave is sensitive & employees don't hold it → would wrongly 403).
  // Static path declared BEFORE the /requests/:id/* routes so Express never shadows it.
  @Post("requests/calculate")
  @HttpCode(200)
  @RequirePermission(CREATE_LEAVE.action, CREATE_LEAVE.resourceType, {
    isSensitive: CREATE_LEAVE.sensitive,
  })
  calculateRequest(@Req() req: AuthenticatedRequest, @Body() dto: LeaveCalculateDto) {
    return this.leaveRead.calculate(req.user, dto);
  }

  // S3-LEAVE-BE-2 NEW: update draft (only when status='Draft' → else 409). PATCH /requests/:id (distinct verb
  // from POST /requests/calculate → no shadow). update-draft:leave (Own).
  @Patch("requests/:id")
  @RequirePermission(UPDATE_DRAFT_LEAVE.action, UPDATE_DRAFT_LEAVE.resourceType, {
    isSensitive: UPDATE_DRAFT_LEAVE.sensitive,
  })
  updateRequestDraft(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateLeaveRequestDraftDto,
  ) {
    return this.leaveRequest.updateDraft(req.user, id, dto);
  }

  // S3-LEAVE-BE-2 NEW: submit draft (Draft → Pending; min-notice + overlap + balance reserve). submit:leave (Own).
  @Post("requests/:id/submit")
  @HttpCode(200)
  @RequirePermission(SUBMIT_LEAVE.action, SUBMIT_LEAVE.resourceType, {
    isSensitive: SUBMIT_LEAVE.sensitive,
  })
  submitRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: SubmitLeaveRequestDto,
  ) {
    return this.leaveRequest.submit(req.user, id, dto.note);
  }

  // S3-LEAVE-BE-3 REPOINT: FSM Pending → Approved. approve:leave gate + scope-check + self-approval block in
  // LeaveApprovalService (ngoài scope → 403, cross-tenant → 404, self → 422 LEAVE-ERR-APPROVER-INVALID).
  @Post("requests/:id/approve")
  @HttpCode(200)
  @RequirePermission(APPROVE_LEAVE.action, APPROVE_LEAVE.resourceType, {
    isSensitive: APPROVE_LEAVE.sensitive,
  })
  approveRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveLeaveRequestDto,
  ) {
    return this.leaveApproval.approve(req.user, id, dto.note);
  }

  // S3-LEAVE-BE-3 REPOINT + REGATE: FSM Pending → Rejected. Gate CHANGED ('approve' → 'reject':leave,
  // SENSITIVE). reason REQUIRED (Zod min(1)) + scope-check + self-approval block. Releases the reserve;
  // NO attendance record, NO sync event.
  @Post("requests/:id/reject")
  @HttpCode(200)
  @RequirePermission(REJECT_LEAVE.action, REJECT_LEAVE.resourceType, {
    isSensitive: REJECT_LEAVE.sensitive,
  })
  rejectRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectLeaveRequestDto,
  ) {
    return this.leaveApproval.reject(req.user, id, dto.reason);
  }

  // S3-LEAVE-BE-2 REPOINT + REGATE: cancel own request (Draft|Pending → Cancelled; releases reserve on
  // Pending). Gate CHANGED create:leave → cancel-own:leave (Own) — correct self-service pair (mig 0455).
  @Post("requests/:id/cancel")
  @HttpCode(200)
  @RequirePermission(CANCEL_OWN_LEAVE.action, CANCEL_OWN_LEAVE.resourceType, {
    isSensitive: CANCEL_OWN_LEAVE.sensitive,
  })
  cancelRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: CancelLeaveRequestDto,
  ) {
    return this.leaveRequest.cancel(req.user, id, dto.cancelReason);
  }

  // ─── Team calendar ───────────────────────────────────────────────────────────

  @Get("calendar")
  @RequirePermission("read", "leave")
  listCalendar(@Req() req: AuthenticatedRequest, @Query() query: LeaveCalendarQueryDto) {
    return this.leave.listCalendar(req.user.companyId, query.month);
  }
}

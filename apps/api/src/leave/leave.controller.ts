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
import { LeaveAdminService } from "./leave-admin.service";
import { LeaveApprovalService } from "./leave-approval.service";
import { LeaveCalendarService } from "./leave-calendar.service";
import { LeaveReadService } from "./leave-read.service";
import { LeaveRequestService } from "./leave-request.service";
import { LeaveService } from "./leave.service";
import {
  AdjustLeaveBalanceDto,
  ApproveLeaveRequestDto,
  CancelLeaveRequestDto,
  CreateLeavePolicyDto,
  CreateLeaveRequestDraftDto,
  CreateLeaveTypeAdminDto,
  CreateLeaveTypeDto,
  LeaveBalanceAdminListQueryDto,
  LeaveCalculateDto,
  LeaveCalendarQueryDto,
  LeaveListQueryDto,
  LeavePolicyListQueryDto,
  LeaveRequestListQueryDto,
  PendingLeaveRequestListQueryDto,
  RejectLeaveRequestDto,
  SubmitLeaveRequestDto,
  UpdateLeavePolicyDto,
  UpdateLeaveRequestDraftDto,
  UpdateLeaveTypeAdminDto,
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
// S3-LEAVE-BE-5 — calendar (own/team/company). Controller gates the COARSE Own pair (granted to all 4
// canonical roles) — the REAL per-scope gate (view-own/view-team/view-company) runs in
// LeaveCalendarService via DataScopeService.resolveAndAssert, mirroring the BE-3 listPending 2-tier gate.
const VIEW_OWN_CALENDAR = leavePair("view-own", LEAVE_RESOURCES.LEAVE_CALENDAR);
// S3-LEAVE-BE-4 — admin surface (mig 0455). Controller gates the coarse pair; the REAL Company-scope gate
// runs in LeaveAdminService via DataScopeService.resolveAndAssert (mirrors BE-3/BE-5 2-tier pattern).
const CREATE_LEAVE_TYPE = leavePair("create", LEAVE_RESOURCES.LEAVE_TYPE);
const UPDATE_LEAVE_TYPE = leavePair("update", LEAVE_RESOURCES.LEAVE_TYPE);
const DELETE_LEAVE_TYPE = leavePair("delete", LEAVE_RESOURCES.LEAVE_TYPE);
const VIEW_LEAVE_POLICY = leavePair("view", LEAVE_RESOURCES.LEAVE_POLICY);
const CREATE_LEAVE_POLICY = leavePair("create", LEAVE_RESOURCES.LEAVE_POLICY);
const UPDATE_LEAVE_POLICY = leavePair("update", LEAVE_RESOURCES.LEAVE_POLICY);
const DELETE_LEAVE_POLICY = leavePair("delete", LEAVE_RESOURCES.LEAVE_POLICY);
const VIEW_LEAVE_BALANCE = leavePair("view", LEAVE_RESOURCES.LEAVE_BALANCE);
const VIEW_TRANSACTION_LEAVE_BALANCE = leavePair("view-transaction", LEAVE_RESOURCES.LEAVE_BALANCE);
const ADJUST_LEAVE_BALANCE = leavePair("adjust", LEAVE_RESOURCES.LEAVE_BALANCE);

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
    private readonly leaveCalendar: LeaveCalendarService,
    private readonly leaveAdmin: LeaveAdminService,
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

  // ─── Leave calendar (S3-LEAVE-BE-5 · CO-S4-005) ──────────────────────────────

  // Coarse gate here (view-own:leave-calendar, granted @Own to all 4 canonical roles). The REAL gate for
  // scope=team/company (view-team/view-company — sensitive, NOT granted to every role) runs inside
  // LeaveCalendarService.listCalendar (dataScope.resolveAndAssert) → 403 if the caller lacks THAT scope's
  // grant, regardless of this coarse decorator passing.
  @Get("calendar")
  @RequirePermission(VIEW_OWN_CALENDAR.action, VIEW_OWN_CALENDAR.resourceType, {
    isSensitive: VIEW_OWN_CALENDAR.sensitive,
  })
  listCalendar(@Req() req: AuthenticatedRequest, @Query() query: LeaveCalendarQueryDto) {
    return this.leaveCalendar.listCalendar(req.user, query);
  }

  // ─── Admin: leave types (S3-LEAVE-BE-4 · create/update/delete:leave-type) ────
  // Distinct `admin/` prefix — never shadows the legacy /leave/types (GET+POST+PATCH `manage:leave`) routes
  // above; both surfaces coexist during migration (legacy DEFERRED, not removed this WO).

  @Post("admin/types")
  @RequirePermission(CREATE_LEAVE_TYPE.action, CREATE_LEAVE_TYPE.resourceType, {
    isSensitive: CREATE_LEAVE_TYPE.sensitive,
  })
  createTypeAdmin(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeaveTypeAdminDto) {
    return this.leaveAdmin.createType(req.user, dto);
  }

  @Patch("admin/types/:id")
  @RequirePermission(UPDATE_LEAVE_TYPE.action, UPDATE_LEAVE_TYPE.resourceType, {
    isSensitive: UPDATE_LEAVE_TYPE.sensitive,
  })
  updateTypeAdmin(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateLeaveTypeAdminDto,
  ) {
    return this.leaveAdmin.updateType(req.user, id, dto);
  }

  @Post("admin/types/:id/delete")
  @HttpCode(200)
  @RequirePermission(DELETE_LEAVE_TYPE.action, DELETE_LEAVE_TYPE.resourceType, {
    isSensitive: DELETE_LEAVE_TYPE.sensitive,
  })
  deleteTypeAdmin(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.leaveAdmin.deleteType(req.user, id);
  }

  // ─── Admin: leave policies (S3-LEAVE-BE-4 · view/create/update/delete:leave-policy) ──

  @Get("admin/policies")
  @RequirePermission(VIEW_LEAVE_POLICY.action, VIEW_LEAVE_POLICY.resourceType, {
    isSensitive: VIEW_LEAVE_POLICY.sensitive,
  })
  listPolicies(@Req() req: AuthenticatedRequest, @Query() query: LeavePolicyListQueryDto) {
    return this.leaveAdmin.listPolicies(req.user, query);
  }

  @Post("admin/policies")
  @RequirePermission(CREATE_LEAVE_POLICY.action, CREATE_LEAVE_POLICY.resourceType, {
    isSensitive: CREATE_LEAVE_POLICY.sensitive,
  })
  createPolicy(@Req() req: AuthenticatedRequest, @Body() dto: CreateLeavePolicyDto) {
    return this.leaveAdmin.createPolicy(req.user, dto);
  }

  @Patch("admin/policies/:id")
  @RequirePermission(UPDATE_LEAVE_POLICY.action, UPDATE_LEAVE_POLICY.resourceType, {
    isSensitive: UPDATE_LEAVE_POLICY.sensitive,
  })
  updatePolicy(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateLeavePolicyDto,
  ) {
    return this.leaveAdmin.updatePolicy(req.user, id, dto);
  }

  @Post("admin/policies/:id/delete")
  @HttpCode(200)
  @RequirePermission(DELETE_LEAVE_POLICY.action, DELETE_LEAVE_POLICY.resourceType, {
    isSensitive: DELETE_LEAVE_POLICY.sensitive,
  })
  deletePolicy(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.leaveAdmin.deletePolicy(req.user, id);
  }

  // ─── Admin: leave balances (S3-LEAVE-BE-4 · view/view-transaction/adjust:leave-balance) ──

  @Get("admin/balances")
  @RequirePermission(VIEW_LEAVE_BALANCE.action, VIEW_LEAVE_BALANCE.resourceType, {
    isSensitive: VIEW_LEAVE_BALANCE.sensitive,
  })
  listBalancesAdmin(
    @Req() req: AuthenticatedRequest,
    @Query() query: LeaveBalanceAdminListQueryDto,
  ) {
    return this.leaveAdmin.listBalances(req.user, query);
  }

  @Get("admin/balances/:id/transactions")
  @RequirePermission(
    VIEW_TRANSACTION_LEAVE_BALANCE.action,
    VIEW_TRANSACTION_LEAVE_BALANCE.resourceType,
    {
      isSensitive: VIEW_TRANSACTION_LEAVE_BALANCE.sensitive,
    },
  )
  listBalanceTransactions(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.leaveAdmin.listBalanceTransactions(req.user, id);
  }

  @Post("admin/balances/:id/adjust")
  @HttpCode(200)
  @RequirePermission(ADJUST_LEAVE_BALANCE.action, ADJUST_LEAVE_BALANCE.resourceType, {
    isSensitive: ADJUST_LEAVE_BALANCE.sensitive,
  })
  adjustBalance(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: AdjustLeaveBalanceDto,
  ) {
    return this.leaveAdmin.adjustBalance(req.user, id, dto);
  }
}

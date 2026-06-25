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
import {
  approveProfileChangeRequestSchema,
  createProfileChangeRequestSchema,
  profileChangeRequestListQuerySchema,
  rejectProfileChangeRequestSchema,
  type ApproveProfileChangeRequest,
  type CreateProfileChangeRequest,
  type ProfileChangeRequestListQuery,
  type RejectProfileChangeRequest,
} from "@mediaos/contracts";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { ProfileChangeRequestService } from "./profile-change-request.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S2-HR-BE-4 — Profile change request HTTP surface (SPEC-03 / API-03 §16.7).
 *
 * Routes (aligned with API-03 §16.7, prefixed /hr):
 *   POST   /hr/profile-change-requests            — Employee creates request (create:pcr)
 *   GET    /hr/profile-change-requests/me          — Employee lists own requests  (create:pcr = Own)
 *   GET    /hr/profile-change-requests             — HR lists all requests (approve:pcr = Company)
 *   GET    /hr/profile-change-requests/:id         — Detail view (own or HR scope)
 *   POST   /hr/profile-change-requests/:id/approve — HR approves (approve:pcr)
 *   POST   /hr/profile-change-requests/:id/reject  — HR rejects  (approve:pcr)
 *   POST   /hr/profile-change-requests/:id/cancel  — Employee cancels own (create:pcr)
 *
 * ALL routes are fail-closed via PermissionGuard (@RequirePermission mandatory).
 * Business logic + permission gate lives in ProfileChangeRequestService, NOT here.
 */
@Controller("hr/profile-change-requests")
@UseGuards(PermissionGuard)
export class ProfileChangeRequestController {
  constructor(private readonly svc: ProfileChangeRequestService) {}

  // ── Employee: create ──────────────────────────────────────────────────────────

  @Post()
  @HttpCode(201)
  @RequirePermission("create", "profile-change-request")
  @UsePipes(new ZodValidationPipe(createProfileChangeRequestSchema))
  createRequest(@Req() req: AuthenticatedRequest, @Body() dto: CreateProfileChangeRequest) {
    return this.svc.createRequest(req.user, dto);
  }

  // ── Employee: list own (/me must be declared BEFORE /:id) ────────────────────

  @Get("me")
  @RequirePermission("create", "profile-change-request")
  @UsePipes(new ZodValidationPipe(profileChangeRequestListQuerySchema))
  listOwnRequests(@Req() req: AuthenticatedRequest, @Query() query: ProfileChangeRequestListQuery) {
    return this.svc.listOwnRequests(req.user, query);
  }

  // ── HR: list all ─────────────────────────────────────────────────────────────

  @Get()
  @RequirePermission("approve", "profile-change-request")
  @UsePipes(new ZodValidationPipe(profileChangeRequestListQuerySchema))
  listRequests(@Req() req: AuthenticatedRequest, @Query() query: ProfileChangeRequestListQuery) {
    return this.svc.listRequests(req.user, query);
  }

  // ── Shared: detail (own scope enforced in service) ───────────────────────────

  @Get(":id")
  @RequirePermission("create", "profile-change-request")
  getDetail(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.getRequestDetail(req.user, id);
  }

  // ── HR: approve ───────────────────────────────────────────────────────────────

  @Post(":id/approve")
  @HttpCode(200)
  @RequirePermission("approve", "profile-change-request")
  @UsePipes(new ZodValidationPipe(approveProfileChangeRequestSchema))
  approveRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveProfileChangeRequest,
  ) {
    return this.svc.approveRequest(req.user, id, dto);
  }

  // ── HR: reject ────────────────────────────────────────────────────────────────

  @Post(":id/reject")
  @HttpCode(200)
  @RequirePermission("approve", "profile-change-request")
  @UsePipes(new ZodValidationPipe(rejectProfileChangeRequestSchema))
  rejectRequest(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectProfileChangeRequest,
  ) {
    return this.svc.rejectRequest(req.user, id, dto);
  }

  // ── Employee: cancel own ─────────────────────────────────────────────────────

  @Post(":id/cancel")
  @HttpCode(200)
  @RequirePermission("create", "profile-change-request")
  cancelRequest(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.svc.cancelRequest(req.user, id);
  }
}

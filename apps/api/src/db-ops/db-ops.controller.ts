import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ZodError } from "zod";
import type { Request } from "express";
import {
  dbAllTenantBrowseQuerySchema,
  dbBrowserQuerySchema,
  dbExportJobCreateSchema,
  dbOpsGrantRequestSchema,
  type DbAllTenantBrowseQuery,
  type DbBrowserQuery,
  type DbExportJobCreate,
  type DbOpsGrantRequest,
} from "@mediaos/contracts";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { OperatorReauthGuard } from "../platform/operator-reauth.guard";
import { OperatorReauthService } from "../platform/operator-reauth.service";
import { AllTenantBrowserService } from "./all-tenant-browser.service";
import { DataBrowserService } from "./data-browser.service";
import { DbExportJobService } from "./db-export-job.service";
import { DbOpsGrantService } from "./db-ops-grant.service";
import {
  DB_ALL_TENANT_ACTION_READ,
  DB_ALL_TENANT_RESOURCE,
  DB_BROWSER_ACTION_READ,
  DB_BROWSER_RESOURCE,
  DB_OPS_ACTION_MANAGE,
  DB_OPS_RESOURCE,
  PLATFORM_DB_OPS_SCOPE,
} from "./db-ops.constants";
import { MigrationStatusService } from "./migration-status.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

function parseOr400<T>(schema: { parse: (i: unknown) => T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) throw new BadRequestException(err.errors);
    throw err;
  }
}

/**
 * DbOpsController (🔴 AC-9 — operator-only, platform-admin, CHỈ-ĐỌC). Route /operator/db-ops.
 *
 * MỌI handler: @OperatorOnly (aud=operator) + @UseGuards(OperatorReauthGuard, PermissionGuard) +
 * @RequirePermission(action, resource, {isSensitive:true}) — TUYỆT ĐỐI KHÔNG requiresReauth:true (cặp
 * isSensitive&&requiresReauth ⇒ reveal-class ⇒ per-OBJECT grant ⇒ operator role-level grant DENY VĨNH VIỄN;
 * đã phá AC-7/G12-4). Step-up cross-tenant ÉP TƯỜNG MINH ở controller qua operatorReauth.resolveWindow,
 * fail-closed 403 (KHÔNG qua requiresReauth). Tenant-scoped op (browse/export) step-up theo target tenant id
 * THẬT; all-tenant op (migration-status) theo sentinel PLATFORM_DB_OPS_SCOPE (mirror PLATFORM_AUDIT_SCOPE).
 */
@Controller("operator/db-ops")
@OperatorOnly()
export class DbOpsController {
  constructor(
    private readonly migrationStatus: MigrationStatusService,
    private readonly dataBrowser: DataBrowserService,
    private readonly allTenantBrowser: AllTenantBrowserService,
    private readonly grants: DbOpsGrantService,
    private readonly exportJobs: DbExportJobService,
    private readonly operatorReauth: OperatorReauthService,
  ) {}

  // ── P1 Migration status (all-tenant op → sentinel step-up) ───────────────────────────────────────
  @Get("migration-status")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async getMigrationStatus(@Req() req: AuthenticatedRequest) {
    await this.requireStepUp(req.user, PLATFORM_DB_OPS_SCOPE);
    return this.migrationStatus.getStatus();
  }

  // ── P2 Data browser (tenant-scoped → step-up theo target tenant id thật) ─────────────────────────
  @Get("browse")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_BROWSER_ACTION_READ, DB_BROWSER_RESOURCE, { isSensitive: true })
  async browse(@Req() req: AuthenticatedRequest, @Query() rawQuery: unknown) {
    const query: DbBrowserQuery = parseOr400(dbBrowserQuerySchema, rawQuery);
    await this.requireStepUp(req.user, query.targetCompanyId);
    return this.dataBrowser.browse(req.user, query);
  }

  // ── C1 All-tenant data browser (all-tenant op → sentinel step-up + perm read:db-all-tenant) ──────
  // ADR-0021 Tầng 3: quét XUYÊN MỌI TENANT qua role read-only. Quyền + grant break-glass all-tenant
  // (target null) ÉP ở service (assertAllTenantGrantActive). Step-up theo sentinel (KHÔNG có target id).
  @Get("browse-all")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_ALL_TENANT_ACTION_READ, DB_ALL_TENANT_RESOURCE, { isSensitive: true })
  async browseAllTenants(@Req() req: AuthenticatedRequest, @Query() rawQuery: unknown) {
    const query: DbAllTenantBrowseQuery = parseOr400(dbAllTenantBrowseQuerySchema, rawQuery);
    await this.requireStepUp(req.user, PLATFORM_DB_OPS_SCOPE);
    return this.allTenantBrowser.browseAllTenants(req.user, query);
  }

  // ── P3 Break-glass SoD grant lifecycle ───────────────────────────────────────────────────────────
  @Get("grants")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async listGrants(@Req() req: AuthenticatedRequest) {
    return this.grants.listMyGrants(req.user);
  }

  @Post("grants")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async requestGrant(@Req() req: AuthenticatedRequest, @Body() rawBody: unknown) {
    const body: DbOpsGrantRequest = parseOr400(dbOpsGrantRequestSchema, rawBody);
    return this.grants.requestGrant(req.user, {
      targetTenantId: body.targetTenantId ?? null,
      reason: body.reason,
      ttlSeconds: body.ttlSeconds,
    });
  }

  @Post("grants/:id/approve")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async approveGrant(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) grantId: string,
  ) {
    return this.grants.approveGrant(req.user, grantId);
  }

  @Post("grants/:id/revoke")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async revokeGrant(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) grantId: string,
  ) {
    return this.grants.revokeGrant(req.user, grantId);
  }

  // ── P4 Export jobs (tenant-scoped → step-up theo target tenant id thật) ──────────────────────────
  @Get("exports")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async listExports(@Req() req: AuthenticatedRequest) {
    return this.exportJobs.listJobs(req.user);
  }

  @Post("exports")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async createExport(@Req() req: AuthenticatedRequest, @Body() rawBody: unknown) {
    const body: DbExportJobCreate = parseOr400(dbExportJobCreateSchema, rawBody);
    await this.requireStepUp(req.user, body.targetCompanyId);
    return this.exportJobs.createJob(req.user, body);
  }

  @Get("exports/:id")
  @OperatorOnly()
  @UseGuards(OperatorReauthGuard, PermissionGuard)
  @RequirePermission(DB_OPS_ACTION_MANAGE, DB_OPS_RESOURCE, { isSensitive: true })
  async getExport(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) jobId: string,
  ) {
    return this.exportJobs.getJob(req.user, jobId);
  }

  /**
   * ÉP step-up: cửa sổ (operator, scope) PHẢI còn hiệu lực. FAIL-CLOSED: thiếu/hết hạn/Valkey rớt
   * (resolveWindow null) ⇒ 403. KHÔNG dùng requiresReauth (tránh reveal-class trap) — quyết định deny Ở ĐÂY.
   */
  private async requireStepUp(
    operator: { id: string; companyId: string },
    scope: string,
  ): Promise<void> {
    const window = await this.operatorReauth.resolveWindow(operator.id, scope);
    if (!window) {
      throw new ForbiddenException(
        "Cross-tenant db-ops requires operator step-up (re-authentication).",
      );
    }
  }
}

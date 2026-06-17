import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import { ZodError } from "zod";
import { setFeatureFlagSchema, setUsageLimitSchema } from "@mediaos/contracts";
import type { SetFeatureFlagRequest, SetUsageLimitRequest } from "@mediaos/contracts";
import type { Request } from "express";
import { OperatorOnly } from "../auth/operator-only.decorator";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { OperatorReauthGuard } from "./operator-reauth.guard";
import { PlatformEntitlementsService } from "./platform-entitlements.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

function parseOr400<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException(err.errors);
    }
    throw err;
  }
}

/**
 * PlatformEntitlementsController (AC-2) — operator (platform-admin) control-plane cho feature-flag /
 * usage-limit / entitlement viewer của 1 công ty BẤT KỲ (cross-tenant, withTenant(target)).
 *
 * Mọi route: @OperatorOnly (aud=operator; token tenant/legacy ⇒ 401) + PermissionGuard (fail-closed) +
 * @RequirePermission('manage','platform-subscription',{isSensitive:true}) — REUSE quyền AC-1 set-plan
 * (cùng nhóm entitlement) ⇒ 0-seed-change.
 *
 * PUT feature-flags/usage-limits thêm OperatorReauthGuard (method-level, CHẠY TRƯỚC PermissionGuard) —
 * step-up window theo route :id (target tenant). KHÔNG dùng `requiresReauth:true` trên @RequirePermission:
 * cặp (isSensitive && requiresReauth) bật "reveal-class" ở PermissionGuard → đòi PER-OBJECT grant trên
 * target company + reauthContext; operator chỉ có grant ROLE-level (platform-admin) ⇒ deny VĨNH VIỄN
 * (TRAP G12-4 / AC-7). isSensitive:true (khớp seed) là đủ — quyền vẫn fail-closed type-level, step-up đã
 * do OperatorReauthGuard ép. (Mirror ModuleRegistryController.)
 */
@Controller("admin/platform/companies")
@OperatorOnly()
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class PlatformEntitlementsController {
  constructor(private readonly entitlements: PlatformEntitlementsService) {}

  /** Feature-flag hiệu lực của 1 tenant (viewer). */
  @Get(":id/feature-flags")
  @RequirePermission("manage", "platform-subscription", { isSensitive: true })
  getFeatureFlags(@Param("id", ParseUUIDPipe) id: string) {
    return this.entitlements.getFeatureFlags(id);
  }

  /** Usage-limit hiệu lực của 1 tenant (viewer). */
  @Get(":id/usage-limits")
  @RequirePermission("manage", "platform-subscription", { isSensitive: true })
  getUsageLimits(@Param("id", ParseUUIDPipe) id: string) {
    return this.entitlements.getUsageLimits(id);
  }

  /** Entitlement HIỆU LỰC tổng hợp (gói + override) — viewer. */
  @Get(":id/entitlements")
  @RequirePermission("manage", "platform-subscription", { isSensitive: true })
  getEntitlements(@Param("id", ParseUUIDPipe) id: string) {
    return this.entitlements.getEntitlements(id);
  }

  /** Đặt override 1 feature-flag cho tenant (cross-tenant, step-up bắt buộc, atomic + audit). */
  @Put(":id/feature-flags")
  @UseGuards(OperatorReauthGuard)
  @RequirePermission("manage", "platform-subscription", { isSensitive: true })
  setFeatureFlag(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SetFeatureFlagRequest,
  ) {
    const dto = parseOr400(setFeatureFlagSchema, body);
    return this.entitlements.setFeatureFlag(req.user, id, dto);
  }

  /** Đặt override 1 usage-limit cho tenant (cross-tenant, step-up bắt buộc, atomic + audit). */
  @Put(":id/usage-limits")
  @UseGuards(OperatorReauthGuard)
  @RequirePermission("manage", "platform-subscription", { isSensitive: true })
  setUsageLimit(
    @Req() req: AuthenticatedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SetUsageLimitRequest,
  ) {
    const dto = parseOr400(setUsageLimitSchema, body);
    return this.entitlements.setUsageLimit(req.user, id, dto);
  }
}

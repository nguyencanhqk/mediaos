import { Body, Controller, Get, Put, Req, UseGuards, UsePipes } from "@nestjs/common";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { PermissionGuard } from "../permission/guards/permission.guard";
import { RequirePermission } from "../permission/require-permission.decorator";
import { SubscriptionService } from "./subscription.service";
import { SetFeatureFlagDto, SetSubscriptionDto, SetUsageLimitDto } from "./subscription.dto";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * Subscription SELF-SERVICE (G16-3) — company-admin xem/đặt gói + feature-flag/usage-limit override của
 * CHÍNH công ty mình (companyId từ JWT). Quyền view/manage:subscription (non-sensitive, seed cho company-admin).
 */
@Controller("subscription")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get()
  @RequirePermission("view", "subscription")
  get(@Req() req: AuthenticatedRequest) {
    return this.subscriptions.getSubscription(req.user.companyId);
  }

  @Get("entitlements")
  @RequirePermission("view", "subscription")
  entitlements(@Req() req: AuthenticatedRequest) {
    return this.subscriptions.getEffectiveEntitlements(req.user.companyId);
  }

  @Put()
  @RequirePermission("manage", "subscription")
  setPlan(@Req() req: AuthenticatedRequest, @Body() dto: SetSubscriptionDto) {
    return this.subscriptions.setSubscription(req.user, req.user.companyId, dto);
  }

  @Put("feature-flags")
  @RequirePermission("manage", "subscription")
  setFeatureFlag(@Req() req: AuthenticatedRequest, @Body() dto: SetFeatureFlagDto) {
    return this.subscriptions.setFeatureFlag(req.user, req.user.companyId, dto);
  }

  @Put("usage-limits")
  @RequirePermission("manage", "subscription")
  setUsageLimit(@Req() req: AuthenticatedRequest, @Body() dto: SetUsageLimitDto) {
    return this.subscriptions.setUsageLimit(req.user, req.user.companyId, dto);
  }
}

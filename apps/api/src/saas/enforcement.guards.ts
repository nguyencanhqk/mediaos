import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { loadEnv } from "../config/env.schema";
import { IS_PUBLIC } from "../permission/public.decorator";
import type { AuthRequest } from "../permission/guards/jwt-auth.guard";
import { ENFORCE_USAGE_LIMIT, REQUIRE_FEATURE, type UsageLimitMeta } from "./decorators";
import { FeatureFlagService } from "./feature-flag.service";
import { UsageLimitService } from "./usage-limit.service";

/** Mã máy-đọc-được để FE phân biệt (redirect upgrade plan / báo quota). */
export const FEATURE_NOT_ENABLED = "FEATURE_NOT_ENABLED";
export const USAGE_LIMIT_EXCEEDED = "USAGE_LIMIT_EXCEEDED";

/** SAAS_ENFORCEMENT_ENABLED default 'true'. 'false' = tắt hẳn enforcement (emergency rollback). */
function enforcementEnabled(): boolean {
  return loadEnv().SAAS_ENFORCEMENT_ENABLED === "true";
}

/** Bỏ qua route @Public / non-http (WS auth ở gateway). Trả undefined nếu KHÔNG skip. */
function shouldSkip(reflector: Reflector, ctx: ExecutionContext): boolean {
  const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
    ctx.getHandler(),
    ctx.getClass(),
  ]);
  if (isPublic) return true;
  if (ctx.getType() !== "http") return true;
  return false;
}

/**
 * FeatureFlagEnforcementGuard (G16-3) — route khai @RequireFeature(key) bị DENY nếu feature TẮT cho công
 * ty. Chạy SAU JwtAuthGuard + CompanyGuard (cần req.user). Route KHÔNG khai = no-op (return true).
 */
@Injectable()
export class FeatureFlagEnforcementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!enforcementEnabled()) return true;
    if (shouldSkip(this.reflector, ctx)) return true;

    const featureKey = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_FEATURE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!featureKey) return true; // route không yêu cầu feature → no-op.

    const req = ctx.switchToHttp().getRequest<Partial<AuthRequest>>();
    const companyId = req.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException("User context missing for feature enforcement");
    }

    const enabled = await this.featureFlags.isEnabled(companyId, featureKey);
    if (enabled) return true;

    throw new ForbiddenException({
      code: FEATURE_NOT_ENABLED,
      message: `Tính năng '${featureKey}' chưa được bật cho công ty này.`,
    });
  }
}

/**
 * UsageLimitEnforcementGuard (G16-3) — route khai @EnforceUsageLimit(metric,cost) bị DENY khi
 * used + cost > limit hiệu lực. Guard CHỈ check (read-only); ghi tăng đếm là việc service sau hành động.
 */
@Injectable()
export class UsageLimitEnforcementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usage: UsageLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!enforcementEnabled()) return true;
    if (shouldSkip(this.reflector, ctx)) return true;

    const meta = this.reflector.getAllAndOverride<UsageLimitMeta | undefined>(ENFORCE_USAGE_LIMIT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!meta) return true; // route không yêu cầu hạn mức → no-op.

    const req = ctx.switchToHttp().getRequest<Partial<AuthRequest>>();
    const companyId = req.user?.companyId;
    if (!companyId) {
      throw new ForbiddenException("User context missing for usage enforcement");
    }

    const check = await this.usage.canConsume(companyId, meta.metric, meta.cost);
    if (check.allowed) return true;

    throw new ForbiddenException({
      code: USAGE_LIMIT_EXCEEDED,
      message: `Đã đạt hạn mức '${meta.metric}' (đã dùng ${check.used}/${check.limit}).`,
    });
  }
}

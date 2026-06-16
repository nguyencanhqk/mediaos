import { SetMetadata } from "@nestjs/common";

/**
 * G16-3 enforcement seam — decorator gắn yêu cầu feature/usage cho route. Guard toàn cục
 * (FeatureFlagEnforcementGuard / UsageLimitEnforcementGuard) đọc metadata này; route KHÔNG khai =
 * guard no-op (KHÔNG ảnh hưởng route hiện có).
 */

export const REQUIRE_FEATURE = "REQUIRE_FEATURE";
/** Yêu cầu feature-flag `featureKey` BẬT cho công ty, nếu không → 403 FEATURE_NOT_ENABLED. */
export const RequireFeature = (featureKey: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_FEATURE, featureKey);

export const ENFORCE_USAGE_LIMIT = "ENFORCE_USAGE_LIMIT";
export interface UsageLimitMeta {
  metric: string;
  cost: number;
}
/**
 * Chặn route khi công ty đã chạm hạn mức `metric` (used + cost > limit) → 403 USAGE_LIMIT_EXCEEDED.
 * Ghi tăng đếm là việc của service SAU khi hành động thành công (guard chỉ check, không side-effect).
 */
export const EnforceUsageLimit = (
  metric: string,
  cost = 1,
): MethodDecorator & ClassDecorator =>
  SetMetadata(ENFORCE_USAGE_LIMIT, { metric, cost } satisfies UsageLimitMeta);

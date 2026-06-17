import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/db.module";
import { EventsModule } from "../events/events.module";
import { PermissionModule } from "../permission/permission.module";
import { SaasRepository } from "./saas.repository";
import { FeatureFlagService } from "./feature-flag.service";
import { UsageLimitService } from "./usage-limit.service";
import { SubscriptionService } from "./subscription.service";
import { SubscriptionController } from "./subscription.controller";

/**
 * SaasModule (G16-3) — subscription / feature-flag / usage-limit scaffold + enforcement seam.
 * Exports FeatureFlagService + UsageLimitService cho các enforcement guard toàn cục (đăng ký ở
 * app.module) và SubscriptionService cho PlatformModule (platform set cross-tenant).
 *
 * Enforcement seam (@RequireFeature / @EnforceUsageLimit + guards) được CHỨNG MINH bằng guard unit-test
 * (saas-enforcement.int-spec) — route nghiệp vụ THẬT tự gắn decorator khi cần (KHÔNG có endpoint demo
 * mutate counter để giảm bề mặt — security review G16-3).
 */
@Module({
  imports: [DatabaseModule, EventsModule, PermissionModule],
  controllers: [SubscriptionController],
  providers: [SaasRepository, FeatureFlagService, UsageLimitService, SubscriptionService],
  // AC-7: + SaasRepository (ModuleRegistryService dùng upsertFeatureOverride cho từng feature_key của module).
  exports: [FeatureFlagService, UsageLimitService, SubscriptionService, SaasRepository],
})
export class SaasModule {}

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { RetentionCleanupJob } from "./retention-cleanup.job";
import { RetentionController } from "./retention.controller";
import { RetentionService } from "./retention.service";

/**
 * S2-FND-BE-3 (L3) — RetentionModule (self-contained). DatabaseModule = withTenant/RLS (BẤT BIẾN #1);
 * PermissionModule = PermissionService + guard stack (route gate view/manage:foundation-retention);
 * EventsModule = AuditService (PATCH ghi CONFIG_UPDATE in-tx — BẤT BIẾN #2/#3 mask). Exports
 * RetentionService/RetentionCleanupJob cho cron/consumer (BullMQ wire ở lane sau).
 *
 * Wire vào app: FoundationModule (ADDITIVE, hot-file append — CLAUDE §9.3). EventsModule là @Global nên
 * AuditService có sẵn; import tường minh để module self-contained (không phụ thuộc thứ tự wire).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionCleanupJob],
  exports: [RetentionService, RetentionCleanupJob],
})
export class RetentionModule {}

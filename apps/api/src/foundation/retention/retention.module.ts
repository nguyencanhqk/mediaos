import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { RetentionCleanupJobHandler } from "./retention-cleanup.job-handler";
import { RetentionCleanupJob } from "./retention-cleanup.job";
import { RetentionController } from "./retention.controller";
import { RetentionService } from "./retention.service";

/**
 * S2-FND-BE-3 (L3) — RetentionModule (self-contained). DatabaseModule = withTenant/RLS (BẤT BIẾN #1);
 * PermissionModule = PermissionService + guard stack (route gate view/manage:foundation-retention);
 * EventsModule = AuditService (PATCH ghi CONFIG_UPDATE in-tx — BẤT BIẾN #2/#3 mask). Exports
 * RetentionService/RetentionCleanupJob cho cron/consumer (BullMQ wire ở lane sau).
 *
 * S2-FND-JOBS-1 (jobs_retention · ADDITIVE): RetentionCleanupJobHandler (@SystemJobHandler) bọc
 * RetentionCleanupJob thành JobHandler — SchedulerModule (DiscoveryService) tự gom qua metadata; module này
 * KHÔNG import SchedulerModule (phụ thuộc MỘT HƯỚNG, KHÔNG cycle). Chỉ import file token `scheduler/job-handler`.
 *
 * Wire vào app: FoundationModule (ADDITIVE, hot-file append — CLAUDE §9.3). EventsModule là @Global nên
 * AuditService có sẵn; import tường minh để module self-contained (không phụ thuộc thứ tự wire).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [RetentionController],
  providers: [RetentionService, RetentionCleanupJob, RetentionCleanupJobHandler],
  exports: [RetentionService, RetentionCleanupJob, RetentionCleanupJobHandler],
})
export class RetentionModule {}

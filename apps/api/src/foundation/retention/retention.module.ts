import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { EventsModule } from "../../events/events.module";
import { PermissionModule } from "../../permission/permission.module";
import { RetentionCleanupJobHandler } from "./retention-cleanup.job-handler";
import { RetentionCleanupJob } from "./retention-cleanup.job";
import { RetentionController } from "./retention.controller";
import { RetentionService } from "./retention.service";
import { SystemJobRunsRetentionJobHandler } from "./system-job-runs-retention.job-handler";

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
 * S5-SYS-CLEAN-1 (ADDITIVE): SystemJobRunsRetentionJobHandler (@SystemJobHandler) dọn CÓ NGƯỠNG
 * `system_job_runs` qua FUNCTION SECURITY DEFINER (mig 0511) trên `workerDb` — KHÔNG dùng RetentionService/
 * DatabaseModule (chạy role mediaos_worker trực tiếp); tham số `workerDb` KHÔNG phải Nest provider nên
 * constructor gắn `@Optional()` (Nest truyền undefined → default JS áp dụng), tránh "can't resolve
 * dependencies" làm sập bootstrap AppModule. Chỉ cần khai trong providers để DiscoveryService gom qua
 * metadata; KHÔNG export (không consumer nào ngoài scheduler).
 *
 * Wire vào app: FoundationModule (ADDITIVE, hot-file append — CLAUDE §9.3). EventsModule là @Global nên
 * AuditService có sẵn; import tường minh để module self-contained (không phụ thuộc thứ tự wire).
 */
@Module({
  imports: [DatabaseModule, PermissionModule, EventsModule],
  controllers: [RetentionController],
  providers: [
    RetentionService,
    RetentionCleanupJob,
    RetentionCleanupJobHandler,
    SystemJobRunsRetentionJobHandler,
  ],
  exports: [RetentionService, RetentionCleanupJob, RetentionCleanupJobHandler],
})
export class RetentionModule {}

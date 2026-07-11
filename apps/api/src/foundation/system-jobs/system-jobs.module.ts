import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../db/db.module";
import { PermissionModule } from "../../permission/permission.module";
import { SystemJobsController } from "./system-jobs.controller";
import { SystemJobsRepository } from "./system-jobs.repository";
import { SystemJobsService } from "./system-jobs.service";

/**
 * S5-FND-JOBS-OBS-1 — SystemJobsModule (self-contained, READ-ONLY). DatabaseModule = withTenant/RLS
 * (BẤT BIẾN #1); PermissionModule = PermissionService + guard stack (route gate view:foundation-job).
 *
 * CỐ Ý KHÔNG import SchedulerModule — đọc thẳng `system_job_runs` qua DatabaseService (KHÔNG cần biết
 * job-handler nào đang đăng ký; mẫu RetentionModule "phụ thuộc MỘT HƯỚNG, KHÔNG cycle" — ở đây module
 * quan sát này còn KHÔNG cần chiều phụ thuộc nào tới Scheduler).
 *
 * Wire vào app: FoundationModule (ADDITIVE, hot-file append — CLAUDE §9.3).
 */
@Module({
  imports: [DatabaseModule, PermissionModule],
  controllers: [SystemJobsController],
  providers: [SystemJobsService, SystemJobsRepository],
  exports: [SystemJobsService],
})
export class SystemJobsModule {}

import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { AuditMaskerService } from "../events/audit-masker.service";
import { FilesModule } from "../foundation/files/files.module";
import { RetentionModule } from "../foundation/retention/retention.module";
import { JobLockService } from "./job-lock.service";
import { JobRunLogger } from "./job-run-logger";
import { JobRunner } from "./job-runner";
import { WORKER_SCHEDULER_CONFIG, loadWorkerSchedulerConfig } from "./worker-scheduler.config";
import { WorkerSchedulerService } from "./worker-scheduler.service";

/**
 * SchedulerModule (WAVE 4 OPS + S2-FND-JOBS-1) — wire các nhịp worker nền:
 *   • outbox: WorkerSchedulerService gọi OutboxWorker.processBatch (OutboxWorker đến từ @Global EventsModule).
 *   • system-jobs: JobRunner chạy mọi @SystemJobHandler được DiscoveryService gom.
 *
 * Chiều phụ thuộc MỘT HƯỚNG (S2-FND-JOBS-1): SchedulerModule import RetentionModule/FilesModule để chúng
 * init TRƯỚC (handler instance sẵn sàng cho DiscoveryService) — feature module KHÔNG import SchedulerModule
 * ⇒ KHÔNG import cycle. DiscoveryModule cung cấp DiscoveryService cho WorkerSchedulerService.
 *
 * JobLockService/JobRunLogger dựng qua useFactory để giữ constructor `dbw = workerDb` mặc định (KHÔNG buộc
 * Nest resolve kiểu Drizzle non-token). AuditMaskerService từ @Global EventsModule (inject vào factory).
 */
@Module({
  imports: [DiscoveryModule, RetentionModule, FilesModule],
  providers: [
    { provide: WORKER_SCHEDULER_CONFIG, useFactory: loadWorkerSchedulerConfig },
    { provide: JobLockService, useFactory: (): JobLockService => new JobLockService() },
    {
      provide: JobRunLogger,
      useFactory: (masker: AuditMaskerService): JobRunLogger => new JobRunLogger(masker),
      inject: [AuditMaskerService],
    },
    JobRunner,
    WorkerSchedulerService,
  ],
})
export class SchedulerModule {}

import { Module } from "@nestjs/common";
import { WORKER_SCHEDULER_CONFIG, loadWorkerSchedulerConfig } from "./worker-scheduler.config";
import { WorkerSchedulerService } from "./worker-scheduler.service";

/**
 * SchedulerModule (WAVE 4 OPS) — wire WorkerSchedulerService gọi processBatch định kỳ.
 *
 * `OutboxWorker` đến từ EventsModule (@Global ⇒ inject được mà KHÔNG cần import).
 * Config đọc qua factory từ env (đã validate ở env.schema).
 */
@Module({
  providers: [
    { provide: WORKER_SCHEDULER_CONFIG, useFactory: loadWorkerSchedulerConfig },
    WorkerSchedulerService,
  ],
})
export class SchedulerModule {}

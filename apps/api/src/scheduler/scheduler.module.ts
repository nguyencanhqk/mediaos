import { Module } from "@nestjs/common";
import { DbOpsModule } from "../db-ops/db-ops.module";
import { WORKER_SCHEDULER_CONFIG, loadWorkerSchedulerConfig } from "./worker-scheduler.config";
import { WorkerSchedulerService } from "./worker-scheduler.service";

/**
 * SchedulerModule (WAVE 4 OPS) — wire WorkerSchedulerService gọi processBatch định kỳ.
 *
 * Imports DbOpsModule cho `DbExportWorker` (DbOpsModule export nó). `OutboxWorker` đến từ EventsModule
 * (@Global ⇒ inject được mà KHÔNG cần import). Config đọc qua factory từ env (đã validate ở env.schema).
 */
@Module({
  imports: [DbOpsModule],
  providers: [
    { provide: WORKER_SCHEDULER_CONFIG, useFactory: loadWorkerSchedulerConfig },
    WorkerSchedulerService,
  ],
})
export class SchedulerModule {}

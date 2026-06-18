import { loadEnv } from "../config/env.schema";

/** DI token cho cấu hình scheduler (inject vào WorkerSchedulerService → test dựng thẳng, không mock module). */
export const WORKER_SCHEDULER_CONFIG = Symbol("WORKER_SCHEDULER_CONFIG");

export interface WorkerSchedulerConfig {
  /** WORKERS_SCHEDULER_ENABLED === 'true' (kill-switch vận hành). */
  enabled: boolean;
  /** NODE_ENV === 'test' → scheduler TỰ TẮT (spec worker gọi processBatch trực tiếp; tránh đua/nhiễu). */
  isTestEnv: boolean;
  /** Chu kỳ poll outbox (ms). */
  outboxPollMs: number;
  /** Chu kỳ poll export job (ms). */
  exportPollMs: number;
}

/** Đọc cấu hình từ env (đã validate ở env.schema). Factory cho provider WORKER_SCHEDULER_CONFIG. */
export function loadWorkerSchedulerConfig(): WorkerSchedulerConfig {
  const env = loadEnv();
  return {
    enabled: env.WORKERS_SCHEDULER_ENABLED === "true",
    isTestEnv: env.NODE_ENV === "test",
    outboxPollMs: env.OUTBOX_POLL_MS,
    exportPollMs: env.EXPORT_POLL_MS,
  };
}

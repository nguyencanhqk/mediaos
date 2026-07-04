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
  /**
   * Chu kỳ tick 'system-jobs' (ms) — JobRunner chạy mọi SYSTEM_JOB_HANDLER. OPTIONAL: giữ tương thích
   * ngược với call-site cũ dựng config 4-trường; service default `DEFAULT_SYSTEM_JOBS_POLL_MS` khi vắng.
   */
  systemJobsPollMs?: number;
}

/** Khoảng poll system-jobs mặc định + biên hợp lệ (1 phút; clamp [1s, 1h] chống giá trị rác từ env). */
export const DEFAULT_SYSTEM_JOBS_POLL_MS = 60_000;
const MIN_SYSTEM_JOBS_POLL_MS = 1_000;
const MAX_SYSTEM_JOBS_POLL_MS = 3_600_000;

/**
 * SYSTEM_JOBS_POLL_MS chưa nằm trong env.schema (env.schema.ts NGOÀI paths lane jobs_runner — sẽ thêm ở
 * lane env-schema nối tiếp). Đọc trực tiếp `process.env` với parse-an-toàn + clamp biên: giá trị rác/NaN
 * → default. Không phải secret ⇒ không đụng BẤT BIẾN #3.
 */
function resolveSystemJobsPollMs(): number {
  const raw = process.env.SYSTEM_JOBS_POLL_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_SYSTEM_JOBS_POLL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_SYSTEM_JOBS_POLL_MS;
  if (parsed < MIN_SYSTEM_JOBS_POLL_MS || parsed > MAX_SYSTEM_JOBS_POLL_MS) {
    return DEFAULT_SYSTEM_JOBS_POLL_MS;
  }
  return parsed;
}

/** Đọc cấu hình từ env (đã validate ở env.schema). Factory cho provider WORKER_SCHEDULER_CONFIG. */
export function loadWorkerSchedulerConfig(): WorkerSchedulerConfig {
  const env = loadEnv();
  return {
    enabled: env.WORKERS_SCHEDULER_ENABLED === "true",
    isTestEnv: env.NODE_ENV === "test",
    outboxPollMs: env.OUTBOX_POLL_MS,
    exportPollMs: env.EXPORT_POLL_MS,
    systemJobsPollMs: resolveSystemJobsPollMs(),
  };
}

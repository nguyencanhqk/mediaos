import { z } from "zod";

/**
 * S5-FND-JOBS-OBS-1 — System Jobs observability DTO (READ-ONLY). Nguồn sự thật cho
 * GET /api/v1/foundation/system-jobs (+ /:jobName/runs). DB-08 §8.14 (system_job_runs, mig 0475
 * S2-FND-JOBS-1) đã ship JobRunner/WorkerScheduler + JobRunLogger (ghi). WO này CHỈ thêm lớp ĐỌC —
 * KHÔNG migration, KHÔNG endpoint trigger (POST run = out-of-scope, đỏ).
 *
 * `system_job_runs.company_id` NULLABLE Ở DB (NULL = job cấp system/global — vd TASK_REMINDER quét mọi
 * tenant 1 lần; NOT NULL = job chạy theo tenant — vd RETENTION_CLEANUP/TEMP_FILE_CLEANUP mỗi tenant 1 hàng).
 * RLS (mig 0475) ép app role CHỈ thấy `company_id = GUC OR company_id IS NULL` ⇒ đọc qua `withTenant`
 * (BẤT BIẾN #1) tự động trả ĐÚNG phạm vi — KHÔNG rò lịch sử job của công ty khác.
 *
 * View WHITELIST — CỐ Ý KHÔNG bao gồm `metadata` (jsonb tự do, phạm vi rộng hơn cần cho quan sát tóm tắt).
 * `errorMessage` ĐÃ scrub secret ở write-time (job-error-scrubber, JobRunLogger.finish) — BE mapper scrub
 * LẦN NỮA khi đọc (idempotent, BẤT BIẾN #3 phòng thủ chiều sâu cho hàng ghi trước khi có scrubber).
 */

/** ∈ CHECK system_job_runs (mig 0475) — khớp SYSTEM_JOB_RUN_STATUSES (apps/api/src/db/schema/system-jobs.ts). */
export const SYSTEM_JOB_RUN_STATUSES = [
  "Running",
  "Success",
  "Failed",
  "Partial",
  "Skipped",
] as const;
export const systemJobRunStatusSchema = z.enum(SYSTEM_JOB_RUN_STATUSES);
export type SystemJobRunStatusDto = z.infer<typeof systemJobRunStatusSchema>;

/** ∈ CHECK system_job_runs (mig 0475) — khớp SYSTEM_JOB_TRIGGERED_BY. */
export const SYSTEM_JOB_TRIGGERED_BY = ["Scheduler", "User", "System"] as const;
export const systemJobTriggeredBySchema = z.enum(SYSTEM_JOB_TRIGGERED_BY);
export type SystemJobTriggeredByDto = z.infer<typeof systemJobTriggeredBySchema>;

/**
 * View DTO 1 hàng run — dùng CHUNG cho cả 2 endpoint: GET /system-jobs (mỗi jobCode = hàng MỚI NHẤT) và
 * GET /system-jobs/:jobName/runs (mỗi hàng = 1 lần chạy). `.strip()` loại field lạ (phòng thủ chiều sâu —
 * `metadata` không bao giờ lọt ra dù row raw có cột đó). startedAt/finishedAt = ISO-8601 string trên wire.
 */
export const systemJobRunViewSchema = z
  .object({
    id: z.string().uuid(),
    jobCode: z.string(),
    /** NULL = job cấp system/global (không thuộc riêng tenant nào). */
    companyId: z.string().uuid().nullable(),
    status: systemJobRunStatusSchema,
    triggeredBy: systemJobTriggeredBySchema,
    startedAt: z.string(),
    finishedAt: z.string().nullable(),
    durationMs: z.number().int().nullable(),
    totalItems: z.number().int().nullable(),
    successItems: z.number().int().nullable(),
    failedItems: z.number().int().nullable(),
    /** Đã scrub secret (write-time + read-time, BẤT BIẾN #3). */
    errorMessage: z.string().nullable(),
  })
  .strip();
export type SystemJobRunView = z.infer<typeof systemJobRunViewSchema>;

/** Response GET /foundation/system-jobs — 1 hàng/jobCode (chạy mới nhất). Tập job nhỏ, bounded — KHÔNG cần phân trang. */
export const systemJobSummaryListResponseSchema = z.array(systemJobRunViewSchema);
export type SystemJobSummaryListResponse = z.infer<typeof systemJobSummaryListResponseSchema>;

const JOB_RUNS_LIMIT_DEFAULT = 20;
const JOB_RUNS_LIMIT_MIN = 1;
const JOB_RUNS_LIMIT_MAX = 100;

/**
 * Query GET /system-jobs/:jobName/runs — phân trang page-based (khớp convention
 * `listFileAccessLogsQuerySchema`, file-access-log.ts). `.catch` + clamp: input rác → default (list đọc
 * KHÔNG nên 400 vì page/limit rác — chống DoS unbounded).
 */
export const systemJobRunsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .catch(1)
    .transform((n) => Math.max(1, n))
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .catch(JOB_RUNS_LIMIT_DEFAULT)
    .transform((n) => Math.min(JOB_RUNS_LIMIT_MAX, Math.max(JOB_RUNS_LIMIT_MIN, n)))
    .default(JOB_RUNS_LIMIT_DEFAULT),
});
export type SystemJobRunsQuery = z.infer<typeof systemJobRunsQuerySchema>;

/** Response GET /system-jobs/:jobName/runs = mảng run (envelope + pagination bọc ở interceptor, mẫu file-access-log). */
export const systemJobRunListResponseSchema = z.array(systemJobRunViewSchema);
export type SystemJobRunListResponse = z.infer<typeof systemJobRunListResponseSchema>;

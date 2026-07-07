import { Injectable, Logger } from "@nestjs/common";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../../scheduler/job-handler";
import { RetentionCleanupJob } from "./retention-cleanup.job";

/**
 * S2-FND-JOBS-1 (jobs_retention · crown) — RetentionCleanupJobHandler.
 *
 * Bọc RetentionCleanupJob hiện có (FOUNDATION-BE-8) thành `JobHandler` cho JobRunner. Mỗi nhịp scheduler,
 * JobRunner acquire lock `system_job_locks('RETENTION_CLEANUP')` 1 lần, enumerate tenant qua
 * withPlatformContext, RỒI gọi `run({companyId})` cho từng tenant NGOÀI tx enumerate.
 *
 * Bất biến giữ nguyên (KHÔNG sửa RetentionCleanupJob/RetentionService):
 *  - BẤT BIẾN #1: RetentionCleanupJob TỰ mở `withTenant(companyId, …)` nội bộ — handler KHÔNG nhận/mở `tx`,
 *    KHÔNG chạy nested-context (contract JobRunContext = chỉ `companyId`, không có `tx`).
 *  - BẤT BIẾN #2: PROTECTED_TABLES (audit_logs/file_access_logs …) → deletedRecords=0 ép ở
 *    RetentionService.runCleanup + REVOKE-DELETE ở DB. Handler CHỈ đọc-qua kết quả, KHÔNG nới.
 *  - §17.4 safety: dryRun MẶC ĐỊNH true. Chỉ XÓA THẬT khi kill-switch env `RETENTION_JOB_ENABLED='true'`
 *    (khớp CHÍNH XÁC chuỗi 'true'; giá trị khác/vắng → dryRun=true, count-only).
 *
 * Đăng ký: `@SystemJobHandler()` + khai báo class trong `providers` của RetentionModule. SchedulerModule
 * (DiscoveryService) gom mọi @SystemJobHandler thành SYSTEM_JOB_HANDLER[] — RetentionModule KHÔNG import
 * SchedulerModule (phụ thuộc MỘT HƯỚNG, KHÔNG import cycle).
 */

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const RETENTION_CLEANUP_JOB_CODE = "RETENTION_CLEANUP";

/**
 * Kill-switch env: chỉ khi ='true' (khớp chính xác) mới cho phép XÓA THẬT (dryRun=false). Vắng / giá trị
 * khác → dryRun=true (fail-safe count-only, §17.4). KHÔNG phải secret (BẤT BIẾN #3) — chỉ cờ vận hành.
 */
const RETENTION_JOB_ENABLED_ENV = "RETENTION_JOB_ENABLED";

@Injectable()
@SystemJobHandler()
export class RetentionCleanupJobHandler implements JobHandler {
  readonly jobCode = RETENTION_CLEANUP_JOB_CODE;
  private readonly logger = new Logger(RetentionCleanupJobHandler.name);

  constructor(private readonly job: RetentionCleanupJob) {}

  /**
   * Chạy cleanup cho 1 tenant. dryRun mặc định true; kill-switch env mở khoá XÓA THẬT. KHÔNG catch —
   * lỗi propagate cho JobRunner finalize run-row 'Failed' (finish-once, KHÔNG chặn tenant kế).
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const { companyId } = ctx;
    const dryRun = process.env[RETENTION_JOB_ENABLED_ENV] !== "true";

    this.logger.debug(
      `RETENTION_CLEANUP tenant=${companyId} dryRun=${dryRun}` +
        `${dryRun ? " (kill-switch OFF — count-only)" : " (kill-switch ON — xóa thật)"}`,
    );

    // RetentionCleanupJob TỰ mở withTenant (BẤT BIẾN #1); PROTECTED_TABLES → deletedRecords=0 (BẤT BIẾN #2).
    const result = await this.job.run(companyId, { dryRun });

    // Map JobRunResult: mỗi policy xử-lý-xong = 1 unit success (job không track per-policy fail — hoặc
    // hoàn tất trọn vẹn, hoặc ném ⇒ JobRunner finalize 'Failed'). metadata đi qua AuditMasker ở JobRunLogger.
    return {
      total: result.policiesProcessed,
      success: result.policiesProcessed,
      failed: 0,
      metadata: {
        policiesProcessed: result.policiesProcessed,
        totalDeleted: result.totalDeleted,
        dryRun: result.dryRun,
      },
    };
  }
}

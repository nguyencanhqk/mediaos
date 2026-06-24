import { Injectable, Logger } from "@nestjs/common";
import type { RunCleanupOptions } from "./retention.types";
import { RetentionService } from "./retention.service";

/**
 * FOUNDATION-BE-8 — RetentionCleanupJob skeleton (§17.4).
 *
 * Job lặp qua các policy enabled của 1 tenant, gọi RetentionService.runCleanup, ghi SYSTEM LOG.
 *  - dryRun mặc định true (an toàn — KHÔNG xóa thật nếu không truyền dryRun:false).
 *  - log KHÔNG chứa secret (chỉ policyId/eligible/deleted/dryRun).
 *  - KHÔNG insert audit_logs (object_type retention/cleanup chưa có trong CHECK union — nợ lane DB).
 *
 * Wire vào BullMQ/cron ở lane BE-9 (module registration). Lane này chỉ xây skeleton.
 */

export interface JobRunOptions extends RunCleanupOptions {
  /** dryRun mặc định true (§17.4 safety). */
  dryRun?: boolean;
}

export interface JobRunResult {
  companyId: string;
  policiesProcessed: number;
  totalDeleted: number;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
}

@Injectable()
export class RetentionCleanupJob {
  private readonly logger = new Logger(RetentionCleanupJob.name);

  constructor(private readonly retention: RetentionService) {}

  /**
   * Chạy cleanup cho 1 tenant. dryRun=true mặc định (§17.4 safety).
   * Lặp qua listEnabledPolicies → runCleanup → tổng hợp kết quả + ghi system log.
   */
  async run(companyId: string, options: JobRunOptions = {}): Promise<JobRunResult> {
    const { dryRun = true, batchSize } = options;
    const startedAt = new Date();

    this.logger.log(
      `RetentionCleanupJob.run: company=${companyId} dryRun=${dryRun} batchSize=${batchSize ?? "default"}`,
    );

    const policies = await this.retention.listEnabledPolicies(companyId);

    if (policies.length === 0) {
      this.logger.log(`RetentionCleanupJob.run: company=${companyId} no enabled policies — no-op`);
      return {
        companyId,
        policiesProcessed: 0,
        totalDeleted: 0,
        dryRun,
        startedAt,
        finishedAt: new Date(),
      };
    }

    let totalDeleted = 0;

    for (const policy of policies) {
      const result = await this.retention.runCleanup(companyId, policy.id, { dryRun, batchSize });

      this.logger.log(
        `RetentionCleanupJob: policy=${policy.id} entity=${policy.entityType}` +
          ` eligible=${result.eligibleRecords} deleted=${result.deletedRecords}` +
          ` dryRun=${result.dryRun} skippedDisabled=${result.skippedDisabled}`,
      );

      totalDeleted += result.deletedRecords;
    }

    const finishedAt = new Date();
    this.logger.log(
      `RetentionCleanupJob.run: DONE company=${companyId} policies=${policies.length}` +
        ` totalDeleted=${totalDeleted} dryRun=${dryRun}` +
        ` elapsed=${finishedAt.getTime() - startedAt.getTime()}ms`,
    );

    return {
      companyId,
      policiesProcessed: policies.length,
      totalDeleted,
      dryRun,
      startedAt,
      finishedAt,
    };
  }
}

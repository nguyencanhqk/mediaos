import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import type { SystemJobTriggeredBy } from "../db/schema/system-jobs";
import type { JobHandler } from "./job-handler";
import { JobLockService } from "./job-lock.service";
import { JobRunLogger, type TerminalStatus } from "./job-run-logger";

export interface RunJobOptions {
  triggeredBy?: SystemJobTriggeredBy;
  triggeredByUserId?: string | null;
  /** TTL lock (ms) — vòng chạy PHẢI < TTL để lock không hết hạn giữa chừng. Default 10 phút. */
  lockTtlMs?: number;
}

export interface RunJobSummary {
  jobCode: string;
  /** true = lock đang bị instance khác giữ ⇒ bỏ qua nhịp (KHÔNG chạy handler). */
  skipped: boolean;
  /** Số tenant đã chạy handler. */
  tenants: number;
  /** Số tenant handler NÉM lỗi (đã finalize run-row Failed, KHÔNG chặn tenant kế). */
  failedTenants: number;
}

/**
 * JobRunner (S2-FND-JOBS-1, crown) — điều phối 1 system job:
 *
 *  1. Acquire lock `system_job_locks(jobCode)` ĐÚNG 1 LẦN quanh TOÀN BỘ vòng per-tenant. Rỗng ⇒ skip
 *     (instance khác đang chạy) — KHÔNG chạy handler, KHÔNG ghi run-row.
 *  2. Enumerate companyIds qua `withPlatformContext` — MATERIALIZE danh sách RỒI đóng tx TRƯỚC khi gọi
 *     `handler.run` (chống nested-context: handler tự mở `withTenant` bên trong, không chạy trong tx
 *     enumerate đang mở).
 *  3. Mỗi tenant: `JobRunLogger.start` (run-row 'Running', company_id TƯỜNG MINH) → `handler.run({companyId})`
 *     → `finish()` ĐÚNG 1 LẦN. Handler NÉM ở 1 tenant → finalize run-row 'Failed' + log, KHÔNG chặn tenant
 *     kế (mẫu outbox try/catch per-item).
 *  4. Release lock (UPDATE `locked_until` về quá khứ) — LUÔN chạy (finally).
 *
 * `runJob` nhận `handler` làm THAM SỐ (không tự resolve) ⇒ unit-test cô lập với fake lock/logger/db.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private static readonly DEFAULT_LOCK_TTL_MS = 10 * 60_000;
  /** Định danh instance giữ lock (host#pid#rand) — chẩn đoán "ai đang chạy". */
  private readonly lockOwner = `${hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly locks: JobLockService,
    private readonly runLog: JobRunLogger,
    private readonly dbService: DatabaseService,
  ) {}

  async runJob(
    jobCode: string,
    handler: JobHandler,
    opts: RunJobOptions = {},
  ): Promise<RunJobSummary> {
    const ttl = opts.lockTtlMs ?? JobRunner.DEFAULT_LOCK_TTL_MS;
    const acquired = await this.locks.acquire(jobCode, this.lockOwner, ttl);
    if (!acquired) {
      this.logger.debug(`Job '${jobCode}': lock đang giữ ở instance khác — bỏ qua nhịp (skip).`);
      return { jobCode, skipped: true, tenants: 0, failedTenants: 0 };
    }

    try {
      // Materialize danh sách tenant RỒI đóng tx enumerate — KHÔNG gọi handler.run bên trong (nested-context).
      const companyIds = await this.enumerateCompanyIds();
      let failedTenants = 0;
      for (const companyId of companyIds) {
        const ok = await this.runForTenant(jobCode, handler, companyId, opts);
        if (!ok) failedTenants += 1;
      }
      return { jobCode, skipped: false, tenants: companyIds.length, failedTenants };
    } finally {
      // Release LUÔN chạy (kể cả throw bất ngờ). KHÔNG nuốt lỗi release — log ERROR + stack.
      await this.locks.release(jobCode).catch((err: unknown) => {
        this.logger.error(
          `release lock '${jobCode}' THẤT BẠI: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      });
    }
  }

  /** Liệt kê companyIds ACTIVE (deleted_at IS NULL) qua withPlatformContext, materialize rồi đóng tx. */
  private async enumerateCompanyIds(): Promise<string[]> {
    return this.dbService.withPlatformContext(async (tx) => {
      const res = await tx.execute(
        sql`SELECT id FROM companies WHERE deleted_at IS NULL ORDER BY id`,
      );
      return (res.rows as { id: string }[]).map((r) => r.id);
    });
  }

  /**
   * Chạy handler cho 1 tenant với run-row riêng. Trả `false` nếu handler NÉM (đã finalize 'Failed'), `true`
   * nếu handler hoàn tất (finalize theo counts: Success/Partial/Failed). finish() gọi ĐÚNG 1 LẦN mỗi nhánh.
   */
  private async runForTenant(
    jobCode: string,
    handler: JobHandler,
    companyId: string,
    opts: RunJobOptions,
  ): Promise<boolean> {
    const startedAtMs = Date.now();
    const runId = await this.runLog.start({
      companyId,
      jobCode,
      triggeredBy: opts.triggeredBy ?? "Scheduler",
      triggeredByUserId: opts.triggeredByUserId ?? null,
    });

    try {
      const result = await handler.run({ companyId });
      const status = JobRunner.deriveStatus(result.failed, result.success);
      await this.runLog.finish(runId, {
        status,
        total: result.total,
        success: result.success,
        failed: result.failed,
        metadata: result.metadata,
        startedAtMs,
      });
      return true;
    } catch (err) {
      // Job fail 1 tenant KHÔNG sập tenant khác (mẫu outbox per-item). finalize 'Failed' (finish-once).
      await this.runLog
        .finish(runId, { status: "Failed", failed: 1, error: err, startedAtMs })
        .catch((finishErr: unknown) => {
          this.logger.error(
            `finish(Failed) run ${runId} lỗi: ${finishErr instanceof Error ? finishErr.message : String(finishErr)}`,
            finishErr instanceof Error ? finishErr.stack : undefined,
          );
        });
      this.logger.error(
        `Job '${jobCode}' tenant ${companyId} THẤT BẠI: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      return false;
    }
  }

  /** Suy trạng thái terminal từ đếm: failed===0 → Success; có success → Partial; còn lại → Failed. */
  private static deriveStatus(failed: number, success: number): TerminalStatus {
    if (failed <= 0) return "Success";
    if (success > 0) return "Partial";
    return "Failed";
  }
}

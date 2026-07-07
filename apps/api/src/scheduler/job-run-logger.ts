import { Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { type Database, workerDb } from "../db/index";
import type { SystemJobRunStatus, SystemJobTriggeredBy } from "../db/schema/system-jobs";
import { assertWorkerRoleSafe } from "../db/worker-role";
import { AuditMaskerService } from "../events/audit-masker.service";
import { scrubErrorMessage } from "./job-error-scrubber";

/** Trạng thái kết thúc (terminal) hợp lệ của 1 run-row (Running/Skipped KHÔNG phải terminal của finish). */
export type TerminalStatus = Extract<SystemJobRunStatus, "Success" | "Failed" | "Partial">;

export interface StartRunInput {
  /** company_id TƯỜNG MINH: NULL = run cấp system/global; UUID = run theo tenant (cột NO-DEFAULT). */
  companyId: string | null;
  jobCode: string;
  triggeredBy: SystemJobTriggeredBy;
  triggeredByUserId?: string | null;
}

export interface FinishRunInput {
  status: TerminalStatus;
  total?: number;
  success?: number;
  failed?: number;
  /** Lỗi (unknown) — message được SCRUB secret trước khi ghi `error_message`. */
  error?: unknown;
  /** metadata jsonb — đi qua AuditMaskerService.mask trước khi ghi. */
  metadata?: Record<string, unknown>;
  /** Mốc bắt đầu (Date.now()) để tính duration_ms. */
  startedAtMs?: number;
}

/** Giá trị cột đã transform (scrub error + mask metadata). PURE — unit test KHÔNG cần DB. */
export interface FinishRow {
  status: TerminalStatus;
  errorMessage: string | null;
  metadata: unknown;
  totalItems: number | null;
  successItems: number | null;
  failedItems: number | null;
}

/**
 * JobRunLogger (S2-FND-JOBS-1) — ghi nhật ký `system_job_runs` qua `workerDb` (role mediaos_worker). Gọi
 * `assertWorkerRoleSafe(mode:'prod-only')` TRƯỚC MỌI INSERT/UPDATE (BẤT BIẾN #1); FAIL-CLOSED khi workerDb
 * vắng. company_id ghi TƯỜNG MINH mỗi run-row (cột NO-DEFAULT). `error_message` qua string-scrubber +
 * `metadata` qua AuditMaskerService.mask TRƯỚC khi ghi (BẤT BIẾN #3).
 *
 * finish() finalize Running→terminal ĐÚNG 1 LẦN (guard KÉP): (1) Set in-memory `finished` (cùng process gọi
 * lại → no-op), (2) DB `WHERE status='Running'` (instance khác đã finalize → 0 row cập nhật).
 */
@Injectable()
export class JobRunLogger {
  private readonly logger = new Logger(JobRunLogger.name);
  private roleChecked = false;
  /** runId đã finalize → gọi finish() lại là no-op (finish-once tại process này). */
  private readonly finished = new Set<string>();

  constructor(
    private readonly masker: AuditMaskerService,
    // `null` = KHÔNG có db (fail-closed tường minh, dùng int-spec); vắng/undefined → default module workerDb.
    private readonly dbw: Database | null = workerDb ?? null,
  ) {}

  private async ensureWorkerSafe(): Promise<Database> {
    const dbw = this.dbw;
    if (!dbw) {
      throw new Error(
        "JobRunLogger: workerDb chưa cấu hình (DATABASE_WORKER_URL/DIRECT_URL) — fail-closed (KHÔNG ghi run-row).",
      );
    }
    if (!this.roleChecked) {
      await assertWorkerRoleSafe(dbw, {
        context: "JobRunLogger",
        mode: "prod-only",
        logger: this.logger,
      });
      this.roleChecked = true;
    }
    return dbw;
  }

  /**
   * Tạo run-row trạng thái 'Running'. company_id TƯỜNG MINH (KHÔNG dựa DEFAULT current_setting — cột
   * NO-DEFAULT, khác audit_logs). Trả `runId` để finish() sau này.
   */
  async start(input: StartRunInput): Promise<string> {
    const dbw = await this.ensureWorkerSafe();
    const res = await dbw.execute(sql`
      INSERT INTO system_job_runs
        (company_id, job_code, status, triggered_by, triggered_by_user_id, started_at)
      VALUES
        (${input.companyId}, ${input.jobCode}, 'Running', ${input.triggeredBy}, ${input.triggeredByUserId ?? null}, now())
      RETURNING id
    `);
    const row = res.rows[0] as { id: string } | undefined;
    if (!row) {
      throw new Error(`JobRunLogger.start: INSERT run-row không trả id (job=${input.jobCode}).`);
    }
    return row.id;
  }

  /** Transform input → giá trị cột (scrub error_message + mask metadata). PURE (unit-testable, không DB). */
  buildFinishRow(input: FinishRunInput): FinishRow {
    return {
      status: input.status,
      errorMessage: scrubErrorMessage(input.error),
      metadata: input.metadata === undefined ? null : this.masker.mask(input.metadata),
      totalItems: input.total ?? null,
      successItems: input.success ?? null,
      failedItems: input.failed ?? null,
    };
  }

  /**
   * Finalize run-row Running→terminal ĐÚNG 1 LẦN. error_message đã SCRUB, metadata đã MASK. `WHERE
   * status='Running'` ⇒ chỉ chuyển từ Running (không ghi đè terminal đã có). Gọi lại cùng runId → no-op.
   */
  async finish(runId: string, input: FinishRunInput): Promise<void> {
    if (this.finished.has(runId)) {
      this.logger.warn(`JobRunLogger.finish gọi lại cho run ${runId} — bỏ qua (finish-once).`);
      return;
    }
    const dbw = await this.ensureWorkerSafe();
    const row = this.buildFinishRow(input);
    const durationMs = input.startedAtMs != null ? Date.now() - input.startedAtMs : null;
    const metadataJson = row.metadata === null ? null : JSON.stringify(row.metadata);
    const res = await dbw.execute(sql`
      UPDATE system_job_runs
      SET status        = ${row.status},
          finished_at   = now(),
          duration_ms   = ${durationMs},
          total_items   = ${row.totalItems},
          success_items = ${row.successItems},
          failed_items  = ${row.failedItems},
          error_message = ${row.errorMessage},
          metadata      = ${metadataJson}::jsonb
      WHERE id = ${runId} AND status = 'Running'
      RETURNING id
    `);
    // Đánh dấu finish-once NGAY cả khi 0 row (đã finalize ở nơi khác) — không thử lại.
    this.finished.add(runId);
    if (res.rows.length === 0) {
      this.logger.warn(
        `JobRunLogger.finish: run ${runId} không ở trạng thái Running (đã finalize?) — no-op.`,
      );
    }
  }
}

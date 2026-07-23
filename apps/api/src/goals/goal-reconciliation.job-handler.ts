import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { GoalProgressEngineService } from "../tasks/goal-progress-engine.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const GOAL_PROGRESS_RECONCILE_JOB_CODE = "GOAL_PROGRESS_RECONCILE";

/**
 * S5-GOAL-BE-2 — job đối soát tiến độ mục tiêu (SPEC-10 §13.3 "đối soát đêm").
 *
 * Recompute đồng bộ trong tx đã lo 99% ca; job này bắt phần còn lại: hàng ghi thẳng DB (import/script),
 * tx bị rollback nửa chừng ở phía TASK, hoặc goal vừa được reopen sau một kỳ đóng băng dài. Lệch quá
 * 0.01 ⇒ log WARN (engine lo) để có dấu vết điều tra thay vì âm thầm sửa.
 *
 * ⚠️ MỘT `withTenant` DUY NHẤT cho TOÀN BỘ vòng hội tụ (không mở tx lồng trong vòng lặp): JobRunner đã
 * enumerate tenant rồi ĐÓNG tx TRƯỚC khi gọi `run()` (hợp đồng `JobRunContext` = chỉ `companyId`), và
 * PgBouncer transaction-mode + tx lồng = treo. Mirror `RetentionCleanupJobHandler`.
 *
 * Idempotent theo yêu cầu của `JobHandler`: engine chỉ ghi khi giá trị THỰC SỰ đổi ⇒ chạy lại ngay lập
 * tức trên cùng dữ liệu cho `fixed = 0`.
 *
 * Đăng ký: `@SystemJobHandler()` + khai trong `providers` của `GoalsModule`; SchedulerModule
 * (DiscoveryService) gom mọi provider mang metadata đó — GoalsModule KHÔNG import SchedulerModule
 * (phụ thuộc MỘT HƯỚNG, không cycle).
 */
@Injectable()
@SystemJobHandler()
export class GoalReconciliationJobHandler implements JobHandler {
  readonly jobCode = GOAL_PROGRESS_RECONCILE_JOB_CODE;
  private readonly logger = new Logger(GoalReconciliationJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly engine: GoalProgressEngineService,
  ) {}

  /**
   * Chạy đối soát cho 1 tenant. KHÔNG catch — lỗi propagate để JobRunner finalize run-row 'Failed'
   * (nuốt lỗi = job "Success" vĩnh viễn trong khi không sửa được gì).
   *
   * "Hôm nay" tính theo UTC (ADR-0008 UTC-at-rest): `period_start`/`period_end` là cột `date` thuần,
   * so sánh phải cùng một hệ quy chiếu với dữ liệu đã lưu.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const today = new Date().toISOString().slice(0, 10);
    const summary = await this.db.withTenant(ctx.companyId, (tx) =>
      this.engine.reconcileCompanyTx(tx, ctx.companyId, today),
    );

    if (summary.drifted > 0) {
      this.logger.warn(
        `GOAL_PROGRESS_RECONCILE tenant=${ctx.companyId}: ${summary.drifted} mục tiêu lệch cache > 0.01 (đã sửa).`,
      );
    }
    return {
      total: summary.scanned,
      success: summary.scanned,
      failed: 0,
      metadata: { scanned: summary.scanned, fixed: summary.fixed, drifted: summary.drifted, today },
    };
  }
}

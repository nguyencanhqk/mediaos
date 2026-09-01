import { Injectable, Logger } from "@nestjs/common";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { LeaveAccrualService } from "./leave-accrual.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const LEAVE_ACCRUAL_JOB_CODE = "LEAVE_ACCRUAL";

/**
 * S6-LEAVE-ACCRUAL-1 — job cộng dồn phép theo chính sách (SPEC-05 · D-A1/D-A2/D-A4).
 *
 * Hợp đồng `JobHandler` (job-handler.ts:43): chạy MỖI NHỊP scheduler (60s) và PHẢI idempotent ⇒ cộng dồn
 * định kỳ và **bù kỳ bỏ lỡ là CÙNG một đường code**. Không có "chế độ backfill" riêng: mỗi nhịp, engine
 * hỏi "kỳ nào đã kết thúc mà chưa có dòng ACCRUAL?" rồi cấp đúng phần thiếu. Chạy lại N lần trên cùng kỳ
 * ⇒ `granted = 0`.
 *
 * ⚠️ MỘT `withTenant` DUY NHẤT cho cả vòng (nằm trong `LeaveAccrualService.runCompany`): JobRunner đã
 * enumerate tenant rồi ĐÓNG tx TRƯỚC khi gọi `run()`, và PgBouncer transaction-mode + tx LỒNG = treo.
 * Mirror `GoalReconciliationJobHandler`/`RetentionCleanupJobHandler`.
 *
 * KHÔNG catch lỗi ở đây — lỗi propagate để JobRunner finalize run-row 'Failed'. Nuốt lỗi = job báo
 * "Success" vĩnh viễn trong khi không cấp được ngày phép nào; đúng loại im lặng WO này đi vá.
 *
 * Đăng ký: `@SystemJobHandler()` + khai class trong `providers` của `LeaveModule`. SchedulerModule
 * (DiscoveryService) tự gom — LeaveModule KHÔNG import SchedulerModule (phụ thuộc MỘT HƯỚNG, không cycle).
 */
@Injectable()
@SystemJobHandler()
export class LeaveAccrualJobHandler implements JobHandler {
  readonly jobCode = LEAVE_ACCRUAL_JOB_CODE;
  private readonly logger = new Logger(LeaveAccrualJobHandler.name);
  /** companyId → chữ ký cảnh báo đã in. Chặn spam WARN mỗi 60s cho cùng một tình trạng BỀN. */
  private readonly warned = new Map<string, string>();

  constructor(private readonly accrual: LeaveAccrualService) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    // `ctx.today` là TUỲ CHỌN và JobRunner PROD KHÔNG set nó ⇒ `runCompany` rơi về tham số mặc định
    // `LeaveAccrualService.today()` = ngày THẬT. Chỉ spec truyền vào để ghim mốc thời gian (S13-LEAVE-JOBDATE-1)
    // — trước đó handler nuốt mất tham số ngày và ca test phụ thuộc đồng hồ máy ⇒ đỏ vĩnh viễn từ 01/09/2026.
    const result = await this.accrual.runCompany(ctx.companyId, ctx.today);
    const { preview, granted, grantedDays, failed } = result;

    this.warnOnce(ctx.companyId, preview.skipped, preview.policies.length);

    return {
      // `total` = số kỳ ĐÁNG LẼ phải xử lý ở nhịp này (0 ở nhịp bình thường — mọi kỳ đã cấp xong).
      total: granted + failed,
      success: granted,
      failed,
      // CHỈ SỐ ĐẾM (BẤT BIẾN #3): không tên, không mã nhân viên. `skippedByReason` là thứ biến "engine
      // âm thầm không cấp gì" thành một con số đọc được trong `system_job_runs.metadata`.
      metadata: {
        today: preview.today,
        policies: preview.policies.length,
        employeesScanned: preview.employeesScanned,
        granted,
        grantedDays,
        failed,
        alreadyGranted: preview.alreadyGranted,
        skippedByReason: countByReason(preview.skipped),
      },
    };
  }

  /**
   * Cảnh báo hồ sơ bị bỏ qua — nhưng CHỈ khi chữ ký đổi. Đây là trạng thái BỀN (thiếu `start_date` thì
   * còn thiếu mãi tới khi HR điền): in mỗi nhịp 60s = 1440 dòng/ngày cho một việc không đổi, đúng dạng
   * alert-fatigue đã phải đi dọn ở S6-OPS-LOGWINDOW-1.
   */
  private warnOnce(companyId: string, skipped: { reason: string }[], policyCount: number): void {
    const byReason = countByReason(skipped);
    // METHOD_DISABLED không nằm trong skipped; 0 chính sách chạy được = tin đáng nói MỘT lần.
    const signature = policyCount === 0 ? "no-policy" : JSON.stringify(byReason);
    if (this.warned.get(companyId) === signature) return;
    this.warned.set(companyId, signature);

    if (policyCount === 0) {
      this.logger.log(
        `LEAVE_ACCRUAL tenant=${companyId}: 0 chính sách có accrual_method ∈ {Monthly,Yearly,Prorated} — engine KHÔNG cấp gì (đúng thiết kế D-A4, bật ở màn Chính sách).`,
      );
      return;
    }
    if (Object.keys(byReason).length > 0) {
      this.logger.warn(
        `LEAVE_ACCRUAL tenant=${companyId}: bỏ qua hồ sơ theo lý do ${JSON.stringify(byReason)} — xem GET /leave/admin/accrual/preview để biết hồ sơ nào.`,
      );
    }
  }
}

function countByReason(skipped: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of skipped) out[s.reason] = (out[s.reason] ?? 0) + 1;
  return out;
}

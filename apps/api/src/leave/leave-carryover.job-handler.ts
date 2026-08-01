import { Injectable, Logger } from "@nestjs/common";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { LeaveCarryoverService, type CarryoverPreview } from "./leave-carryover.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const LEAVE_CARRYOVER_JOB_CODE = "LEAVE_CARRYOVER";

/**
 * S6-LEAVE-CARRYOVER-1 — job chuyển tiếp phép cuối năm + hết hạn phần đã chuyển (SPEC-05 · owner D-A3).
 *
 * Hợp đồng `JobHandler` (job-handler.ts:43): chạy MỖI NHỊP scheduler (60s) và PHẢI idempotent. Ở đây
 * "idempotent" KHÔNG có nghĩa là "chỉ chạy đúng một lần rồi thôi": số dư năm cũ vẫn đổi được sau khi
 * chuyển (từ chối đơn trả lại `pending_days`, huỷ đơn trả lại `used_days`), nên engine được phép ghi BÙ ở
 * nhịp sau. Thứ bị chặn là ghi QUÁ SỐ — ép bằng ràng buộc số ngày trong WHERE của lệnh UPDATE
 * (`leave-carryover.repository.ts`), cộng hai unique index chống trùng trong ngày (mig 0537).
 *
 * ⚠️ MỘT `withTenant` DUY NHẤT cho cả vòng (trong `LeaveCarryoverService.runCompany`): JobRunner đã
 * enumerate tenant rồi ĐÓNG tx TRƯỚC khi gọi `run()`, và PgBouncer transaction-mode + tx LỒNG = treo.
 *
 * KHÔNG catch lỗi ở đây — lỗi propagate để JobRunner finalize run-row 'Failed'. Nuốt lỗi = job báo
 * "Success" vĩnh viễn trong khi phép của người ta không được chuyển; đúng loại im lặng WO này đi vá.
 */
@Injectable()
@SystemJobHandler()
export class LeaveCarryoverJobHandler implements JobHandler {
  readonly jobCode = LEAVE_CARRYOVER_JOB_CODE;
  private readonly logger = new Logger(LeaveCarryoverJobHandler.name);
  /** companyId → chữ ký cảnh báo đã in. Chặn spam WARN mỗi 60s cho cùng một tình trạng BỀN. */
  private readonly warned = new Map<string, string>();

  constructor(private readonly carryover: LeaveCarryoverService) {}

  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const result = await this.carryover.runCompany(ctx.companyId);
    const { preview, carried, carriedDays, expired, expiredDays, failed } = result;

    this.warnOnce(ctx.companyId, preview);

    return {
      total: carried + expired + failed,
      success: carried + expired,
      failed,
      // CHỈ SỐ ĐẾM (BẤT BIẾN #3). Ba con số cuối là thứ phân biệt "engine đang nghỉ ĐÚNG thiết kế" với
      // "engine bị cấu hình sai" và "có dữ liệu engine không với tới được" — thiếu chúng thì hai tình
      // trạng đó đẻ ra `system_job_runs` giống hệt nhau, và không ai phát hiện được cái thứ hai.
      metadata: {
        today: preview.today,
        sourceYear: preview.sourceYear,
        targetYear: preview.targetYear,
        balancesScanned: preview.balancesScanned,
        carried,
        carriedDays,
        expired,
        expiredDays,
        failed,
        policies: preview.policiesTotal,
        policiesWithCarryForward: preview.policiesWithCarryForward,
        strandedBalances: preview.strandedBalances,
        skippedByReason: countByReason(preview.skipped),
      },
    };
  }

  /**
   * Cảnh báo hồ sơ bị bỏ qua — CHỈ khi chữ ký đổi. Đây là trạng thái BỀN (chưa tới mốc chốt sổ thì còn
   * chưa tới suốt tháng 1): in mỗi nhịp 60s = 1440 dòng/ngày cho một việc không đổi, đúng dạng
   * alert-fatigue đã phải đi dọn ở S6-OPS-LOGWINDOW-1.
   *
   * `BEFORE_SETTLEMENT` KHÔNG cảnh báo: đó là trạng thái đúng-theo-thiết-kế, không phải việc cần ai làm.
   */
  private warnOnce(companyId: string, preview: CarryoverPreview): void {
    const actionable = preview.skipped.filter((s) => s.reason !== "BEFORE_SETTLEMENT");
    const byReason = countByReason(actionable);
    // Chữ ký theo DANH TÍNH (dòng nào, lý do gì) — KHÔNG theo số đếm. Đếm-thôi sẽ im lặng nuốt ca đổi
    // người: hôm nay anh A `EMPLOYEE_LEFT`, tuần sau A đã xong nhưng chị B bị gắn nhầm `end_date` ⇒ vẫn
    // là `{"EMPLOYEE_LEFT":1}` ⇒ không ai được báo. Sắp xếp để thứ tự phần tử không đẻ cảnh báo giả.
    const identity = actionable
      .map((s) => `${s.leaveTypeId}|${s.employeeId ?? "-"}|${s.year}|${s.reason}`)
      .sort()
      .join(",");
    const signature = `p${preview.policiesWithCarryForward}/${preview.policiesTotal}|s${preview.strandedBalances}|${identity}`;
    if (this.warned.get(companyId) === signature) return;
    this.warned.set(companyId, signature);

    // "Engine không có gì để làm" phải nói ra MỘT lần, nếu không thì cấu hình sai và nghỉ-đúng-thiết-kế
    // trông giống hệt nhau mãi mãi (mirror LeaveAccrualJobHandler).
    if (preview.policiesTotal === 0) {
      this.logger.log(
        `LEAVE_CARRYOVER tenant=${companyId}: 0 chính sách phạm vi Công ty đang hiệu lực — engine KHÔNG có gì để xử lý.`,
      );
    } else if (preview.policiesWithCarryForward === 0) {
      this.logger.log(
        `LEAVE_CARRYOVER tenant=${companyId}: 0/${preview.policiesTotal} chính sách bật chuyển tiếp — engine KHÔNG chuyển gì (đúng thiết kế, bật ở màn Chính sách).`,
      );
    }
    if (preview.strandedBalances > 0) {
      this.logger.warn(
        `LEAVE_CARRYOVER tenant=${companyId}: ${preview.strandedBalances} dòng số dư của năm < ${preview.sourceYear} còn ngày chưa dùng nhưng NẰM NGOÀI cửa sổ quét — engine không xử lý được, cần điều chỉnh tay (POST /leave/admin/balances/:id/adjust).`,
      );
    }
    if (Object.keys(byReason).length > 0) {
      this.logger.warn(
        `LEAVE_CARRYOVER tenant=${companyId}: bỏ qua theo lý do ${JSON.stringify(byReason)} — xem GET /leave/admin/carryover/preview để biết dòng nào.`,
      );
    }
  }
}

function countByReason(skipped: { reason: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of skipped) out[s.reason] = (out[s.reason] ?? 0) + 1;
  return out;
}

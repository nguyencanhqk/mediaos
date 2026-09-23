import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { SocialPollsRepository } from "./social-polls.repository";
import { SocialPollsService } from "./social-polls.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const SOCIAL_POLL_CLOSE_EXPIRED_JOB_CODE = "SOCIAL_POLL_CLOSE_EXPIRED";

/**
 * S16-SOCIAL-BE-2B-1 — đóng bình chọn **quá hạn** (`closes_at <= now()`), API-19 §5.1d.
 *
 * Không có đường người-dùng nào thay được job này: `closes_at` là lời hứa của hệ thống, và để hàng
 * ở `status='open'` sau hạn nghĩa là **vẫn nhận phiếu** (cổng ghi kiểm `closes_at`, nên phiếu muộn
 * bị chặn — nhưng kết quả hiển thị thì vẫn nói "đang mở" và NOTI-035 không bao giờ phát).
 *
 * ┌─ IDEMPOTENT BẰNG CHÍNH CÂU GHI, KHÔNG BẰNG CỜ ──────────────────────────────────────────────────┐
 * │ `closeExpiredTx` là `UPDATE … WHERE status='open' … RETURNING`. Hàng vừa đóng không còn khớp vị  │
 * │ từ ⇒ nhịp kế `total = 0`. Và vì ở READ COMMITTED Postgres **re-check `WHERE`** sau khi chờ khoá  │
 * │ hàng, một `044` (đóng tay) chạy song song sẽ làm hàng đó rớt khỏi tập — nên `RETURNING` là danh  │
 * │ sách poll mà **CHÍNH lượt chạy này** đã đóng. Đó là điều làm NOTI-035 không nhân đôi, chứ không  │
 * │ phải một cờ "đã gửi" nào cả.                                                                     │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **DI — vì sao KHÔNG `@Optional()`.** Cả ba dependency là provider THẬT trong `SocialModule`.
 * Memory `systemjobhandler-optional-dbw-di` áp cho handler nhận tham số **không phải** Nest provider
 * (ví dụ `workerDb: Database`); gắn `@Optional()` cho một provider CÓ THẬT biến lỗi wiring thành
 * `undefined` im lặng — ngược đúng thứ memory đó bảo vệ. Ghi chữ ký constructor ra đây làm căn cứ
 * kiểm chứng được, thay vì chỉ nói "theo tiền lệ".
 *
 * ⚠️ Audit dùng **`actorType: "Job"`** và **KHÔNG có `actorUserId`** — đường đúng, đã đo:
 * `AuditEntry.actorUserId` là `?: string` (optional, KHÔNG nullable) nên truyền `null` không biên
 * dịch được; còn dựng một "user hệ thống" giả thì nó hiện ra ở mọi màn lọc audit theo người. Enum
 * `AUDIT_ACTOR_TYPES` (CHECK `0432`) đã có sẵn `"Job"`. Tiền lệ: `leave-accrual.service.ts:212`.
 */
@Injectable()
@SystemJobHandler()
export class SocialPollCloseExpiredJobHandler implements JobHandler {
  readonly jobCode = SOCIAL_POLL_CLOSE_EXPIRED_JOB_CODE;
  private readonly logger = new Logger(SocialPollCloseExpiredJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SocialPollsRepository,
    private readonly polls: SocialPollsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * MỘT transaction cho cả tenant: `feed_polls` + outbox NOTI + `audit_logs` cùng commit/rollback.
   *
   * KHÔNG catch: lỗi propagate cho `JobRunner` để nó finalize run-row `'Failed'` — nuốt lỗi ở đây
   * làm một job hỏng liên tục trông y hệt một job không có việc.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const closed = await this.db.withTenant(ctx.companyId, async (tx) => {
      const rows = await this.repo.closeExpiredTx(tx, ctx.companyId);

      // 🔴 Audit + NOTI **CHỈ khi thực sự có hàng đổi**, và nằm SAU `RETURNING`, TRONG cùng tx.
      // `total = 0` là trạng thái BÌNH THƯỜNG của gần như mọi nhịp; ghi audit ở đó là bơm rác vào
      // một bảng append-only (`leave-accrual.service.ts:206-208` đã phải đi gỡ đúng quả bom này).
      for (const poll of rows) {
        await this.polls.enqueuePollClosedNotiTx(tx, ctx.companyId, {
          postId: poll.postId,
          question: poll.question,
        });
      }

      if (rows.length > 0) {
        await this.audit.record(tx, {
          action: "social.poll.close",
          objectType: "feed_post",
          // Một dòng cho cả lượt chạy: `object_id` là bài đầu tiên, số lượng nằm ở metadata. Ghi
          // mỗi poll một dòng sẽ làm một nhịp gặt 500 poll đẻ 500 dòng audit cho MỘT hành động của
          // hệ thống — không ai đọc, và bảng thì append-only.
          objectId: rows[0].postId,
          actorType: "Job",
          actionGroup: "SOCIAL",
          resultStatus: "Success",
          dataScope: "Company",
          sensitivityLevel: "Normal",
          // CHỈ SỐ ĐẾM + khoá kỹ thuật — không câu hỏi bình chọn, không danh tính ai.
          metadata: { via: "job", closed: rows.length, postIds: rows.map((r) => r.postId) },
        });
      }

      return rows;
    });

    if (closed.length > 0) {
      this.logger.log(
        `${this.jobCode} tenant=${ctx.companyId}: đóng ${closed.length} bình chọn quá hạn.`,
      );
    }

    return { total: closed.length, success: closed.length, failed: 0 };
  }
}

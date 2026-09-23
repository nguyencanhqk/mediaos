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
 * Số bình chọn gặt tối đa MỖI transaction (FULL gate 23/09/2026 — xem docblock `run()`).
 *
 * Xuất khẩu để test dựng được ca "nhiều hơn một lô" mà không phải gõ lại con số.
 */
export const SOCIAL_POLL_CLOSE_BATCH_SIZE = 200;

/** Trần số lô một lượt chạy — chặn vòng lặp chạy mất kiểm soát nếu vị từ gặt bị viết sai. */
const MAX_BATCHES_PER_RUN = 50;

/** Số `postId` MẪU ghi vào `metadata` của dòng audit — số đếm thật nằm ở khoá `closed`. */
const AUDIT_POSTID_SAMPLE = 20;

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
   * Gặt theo LÔ — **mỗi lô MỘT transaction** (`feed_polls` + outbox NOTI + `audit_logs` của lô đó
   * cùng commit/rollback).
   *
   * ┌─ VÌ SAO CHIA LÔ (FULL gate 23/09/2026) ────────────────────────────────────────────────────────┐
   * │ `database-reviewer` H-1 · `santa-A` F7 · `santa-B` F2 · `silent-failure-hunter` M-6 — BỐN    │
   * │ nguồn độc lập. Bản cũ: MỘT tx cho cả tenant, `closeExpiredTx` không `LIMIT`, rồi `2N`        │
   * │ round-trip (một SELECT người nhận + một `enqueue` cho TỪNG poll) bên trong. Sau một đợt        │
   * │ `WORKERS_SCHEDULER_ENABLED=false` (kill-switch vận hành có thật) hoặc restore từ backup cũ,    │
   * │ một nhịp có thể gặt hàng nghìn poll:                                                            │
   * │   · ghim một server-connection của PgBouncer (pool `max:20`, KHÔNG `connectionTimeoutMillis`); │
   * │   · mọi `041`/`042`/`044` trên các poll trong lô **TREO** ở `lockPollRowTx` — không lỗi,     │
   * │     không log, chỉ chờ; đủ nhiều thì cạn pool và cả API đứng im lặng;                           │
   * │   · vỡ ở hàng cuối ⇒ rollback TOÀN PHẦN ⇒ nhịp sau làm lại từ đầu, không tiến-độ-từng-phần.     │
   * │ Chia lô + `FOR UPDATE SKIP LOCKED` (xem `closeExpiredTx`) bó cửa sổ khoá về `BATCH_SIZE` và  │
   * │ cho tiến độ từng phần. Vị từ gặt vốn đã idempotent nên lô dư trôi sang vòng sau miễn phí.      │
   * │ ⚠️ NỢ đã ghi (plan §13.4): chưa đặt `lock_timeout`/`statement_timeout` cho tx của job.        │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * KHÔNG catch: lỗi propagate cho `JobRunner` để nó finalize run-row `'Failed'` — nuốt lỗi ở đây
   * làm một job hỏng liên tục trông y hệt một job không có việc.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    let total = 0;
    let batches = 0;

    for (; batches < MAX_BATCHES_PER_RUN; batches += 1) {
      const rows = await this.db.withTenant(ctx.companyId, async (tx) => {
        const closed = await this.repo.closeExpiredTx(
          tx,
          ctx.companyId,
          SOCIAL_POLL_CLOSE_BATCH_SIZE,
        );
        // 🔴 Audit + NOTI **CHỈ khi thực sự có hàng đổi**, và nằm SAU `RETURNING`, TRONG cùng tx.
        // `total = 0` là trạng thái BÌNH THƯỜNG của gần như mọi nhịp; ghi audit ở đó là bơm rác vào
        // một bảng append-only (`leave-accrual.service.ts:206-208` đã phải đi gỡ đúng quả bom này).
        if (closed.length === 0) return closed;

        // MỘT câu người nhận + MỘT `enqueueMany` cho cả lô — xem `enqueuePollClosedNotiManyTx`.
        await this.polls.enqueuePollClosedNotiManyTx(tx, ctx.companyId, closed);

        await this.audit.record(tx, {
          action: "social.poll.close",
          objectType: "feed_post",
          // Một dòng cho cả LÔ: `object_id` là bài đầu tiên, số lượng nằm ở metadata. Ghi mỗi poll
          // một dòng sẽ làm một nhịp gặt 500 poll đẻ 500 dòng audit cho MỘT hành động của hệ thống —
          // không ai đọc, và bảng thì append-only.
          // ⚠️ NỢ CHỜ CHỮ KÝ OWNER (plan §13.3, `silent-failure-hunter` M-5): hệ quả là poll thứ
          // 2..N của một lô **không tra được** bằng `object_id` của chính nó — chỉ nằm trong
          // `metadata.postIds`, thứ mà mọi màn lọc audit theo đối tượng không đọc. `044` thì ghi
          // một dòng/poll ⇒ CÙNG một `action` có hai hình dạng audit.
          objectId: closed[0].postId,
          actorType: "Job",
          actionGroup: "SOCIAL",
          resultStatus: "Success",
          dataScope: "Company",
          sensitivityLevel: "Normal",
          // CHỈ SỐ ĐẾM + khoá kỹ thuật — không câu hỏi bình chọn, không danh tính ai.
          // `postIds` CHẶN TRÊN: một mảng không giới hạn đi vào `jsonb` của bảng append-only là
          // không gỡ lại được (`database-reviewer` H-1). Số đếm thật luôn ở `closed`.
          metadata: {
            via: "job",
            closed: closed.length,
            postIds: closed.slice(0, AUDIT_POSTID_SAMPLE).map((r) => r.postId),
            postIdsTruncated: closed.length > AUDIT_POSTID_SAMPLE,
          },
        });

        return closed;
      });

      total += rows.length;
      // Lô chưa đầy ⇒ đã hết việc. Lô đầy ⇒ có thể còn, vòng tiếp.
      if (rows.length < SOCIAL_POLL_CLOSE_BATCH_SIZE) break;
    }

    if (batches >= MAX_BATCHES_PER_RUN) {
      this.logger.warn(
        `${this.jobCode} tenant=${ctx.companyId}: chạm trần ${MAX_BATCHES_PER_RUN} lô ` +
          `(${total} bình chọn) — phần còn lại để nhịp sau.`,
      );
    }
    if (total > 0) {
      this.logger.log(`${this.jobCode} tenant=${ctx.companyId}: đóng ${total} bình chọn quá hạn.`);
    }

    return { total, success: total, failed: 0 };
  }
}

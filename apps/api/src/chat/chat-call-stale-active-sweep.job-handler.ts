import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { ChatCallsService } from "./chat-calls.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const CHAT_CALL_STALE_ACTIVE_SWEEP_JOB_CODE = "CHAT_CALL_STALE_ACTIVE_SWEEP";

/**
 * S10-CHAT-CALLSWEEP-1 (KI-063) — quét cuộc gọi **`active` mồ côi / quá thọ** → `ended`.
 *
 * ┌─ LỖ ĐƯỢC VÁ ────────────────────────────────────────────────────────────────────────────────────┐
 * │ `CHAT_CALL_RINGING_TIMEOUT` chỉ chạm `status='ringing'`. Một hàng `active` không có đường nào rời │
 * │ khỏi tập `('ringing','active')` của partial unique `chat_calls_one_live_per_room_uq` ngoài hành   │
 * │ động của người còn sống trong phòng — mà gỡ cả hai người khỏi phòng làm họ **hết `hangup` nổi**   │
 * │ (404). Hệ quả: phòng bị khoá **VĨNH VIỄN**, mọi lời mời sau đó 409 `CHAT-ERR-028`, và KHÔNG có    │
 * │ đường sửa qua API — chỉ còn cách sửa tay trong DB.                                                │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Vì sao jobCode RIÊNG, không mở rộng `CHAT_CALL_RINGING_TIMEOUT`.** `jobCode` là **khoá vận hành**
 * (PK của `system_job_locks`, cột lọc của `system_job_runs`), không phải nhãn mô tả: đổi tên nó bỏ lại
 * một hàng lock mồ côi và **cắt đôi lịch sử run** giữa hai cái tên. Còn giữ nguyên tên cũ mà nhét thêm
 * việc quét `active` vào thì tên nói một đằng code làm một nẻo — đúng lớp lỗi KI-054 (*"Company-scope"
 * viết trong docstring như một sự thật*). Tách ra cũng cho **đo riêng**: "gặt bao nhiêu cuộc gọi ma" là
 * con số phải trả lời được khi đóng KI, không trộn lẫn với 45s ring-timeout.
 *
 * ⚠️ **Đây là đường DUY NHẤT**, không phải lưới an toàn (khác job ring-timeout, vốn có bước dọn-trước-khi-
 * mời của `CHAT-API-026` làm đường chính). Không có đường người-dùng nào chạm tới trạng thái này được:
 * đúng những người có thể `hangup` là những người đã bị gỡ khỏi phòng. Nhịp scheduler mặc định 60s ⇒ độ
 * trễ tối đa để mở khoá một phòng là một nhịp sau khi ngưỡng chín.
 *
 * **Idempotent** theo hợp đồng `JobHandler`: hàng vừa đổi không còn `status='active'` ⇒ lần chạy kế tiếp
 * khớp 0 hàng. Vị từ có ĐÚNG MỘT bản sao (`ChatCallsService.expireStaleActiveTx`).
 *
 * ⚠️ **DI — vì sao KHÔNG `@Optional()`.** Cả hai dependency là provider THẬT trong `ChatModule` (mirror
 * `ChatCallRingingTimeoutJobHandler`, đang chạy PROD không `@Optional()`). Memory
 * `systemjobhandler-optional-dbw-di` áp cho handler nhận tham số KHÔNG phải Nest provider; gắn
 * `@Optional()` cho một provider CÓ THẬT sẽ biến lỗi wiring thành `undefined` im lặng — ngược đúng thứ
 * memory đó bảo vệ.
 */
@Injectable()
@SystemJobHandler()
export class ChatCallStaleActiveSweepJobHandler implements JobHandler {
  readonly jobCode = CHAT_CALL_STALE_ACTIVE_SWEEP_JOB_CODE;
  private readonly logger = new Logger(ChatCallStaleActiveSweepJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly calls: ChatCallsService,
  ) {}

  /**
   * MỘT transaction cho cả tenant: `chat_calls` + `chat_call_participants` + `audit_logs` phải cùng
   * commit/rollback. Ghi audit ngoài tx nghiệp vụ là đường im lặng (lỗi audit vẫn commit thay đổi).
   *
   * KHÔNG catch: lỗi propagate cho `JobRunner` finalize run-row `'Failed'` — nuốt lỗi ở đây làm một job
   * hỏng liên tục trông y hệt một job không có việc.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const swept = await this.db.withTenant(ctx.companyId, (tx) =>
      this.calls.expireStaleActiveTx(tx, ctx.companyId, new Date()),
    );
    const total = swept.length;

    // ⚠️ SAU COMMIT. Không có "actor" nào ở đây, nên người được báo lấy từ chính bảng participants của
    // từng cuộc gọi. Bỏ dòng này = máy người dùng giữ khung gọi của một cuộc gọi đã chết.
    this.calls.emitAutoEnded(ctx.companyId, swept);

    if (total > 0) {
      // `warn`, KHÔNG `debug`: mỗi hàng gặt được là bằng chứng một phòng ĐÃ từng bị khoá. Ở mức không thu
      // ở production thì KI-063 tái diễn mà không ai đếm được.
      this.logger.warn(
        `${this.jobCode} tenant=${ctx.companyId}: gặt ${total} cuộc gọi 'active' mồ côi/quá thọ ` +
          `→ 'ended' (phòng được mở khoá cho lời mời mới).`,
      );
    } else {
      this.logger.debug(
        `${this.jobCode} tenant=${ctx.companyId}: không có cuộc gọi 'active' quá hạn.`,
      );
    }

    return {
      total,
      success: total,
      failed: 0,
      metadata: { callsAutoEnded: total },
    };
  }
}

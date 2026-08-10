import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { ChatCallsService, CHAT_CALL_RING_TIMEOUT_MS } from "./chat-calls.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const CHAT_CALL_RINGING_TIMEOUT_JOB_CODE = "CHAT_CALL_RINGING_TIMEOUT";

/**
 * S7-CALL-BE-1 — quét cuộc gọi `ringing` quá hạn → `missed` (SPEC-15 §15a).
 *
 * ┌─ VÌ SAO SERVER PHẢI LÀM VIỆC NÀY, KHÔNG PHẢI CLIENT ────────────────────────────────────────────┐
 * │ Client tự đóng khung gọi khi hết chuông là thay đổi ở MÀN HÌNH, không ở DB. Hàng `ringing` còn   │
 * │ nguyên ⇒ nó vẫn nằm trong tập "sống" của `chat_calls_one_live_per_room_uq` ⇒ phòng bị một cuộc   │
 * │ gọi ma chiếm chỗ và **mọi lời mời sau đó 409 VĨNH VIỄN**. Không có thông báo lỗi nào chỉ ra       │
 * │ nguyên nhân — người dùng chỉ thấy "không gọi được nữa".                                          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Job này là **lưới an toàn, không phải đường chính**. Đường chính là bước dọn ngay trong
 * `CHAT-API-026` (`ChatCallsService.invite`): nhịp scheduler mặc định 60s > thời gian đổ chuông 45s, nên
 * chờ job mới mở khoá phòng là để người dùng chờ tới ~1 phút cho lần gọi lại. Job phủ phần còn lại:
 * phòng KHÔNG ai mời lại (nếu không, hàng `ringing` sống mãi và `missed` không bao giờ được ghi).
 *
 * **Idempotent** theo hợp đồng `JobHandler`: chạy lại ngay trên cùng dữ liệu ⇒ 0 hàng, vì hàng vừa đổi
 * không còn khớp `status='ringing'`. Vị từ hết hạn có ĐÚNG MỘT bản sao (`ChatCallsService.expireStaleTx`)
 * dùng chung với đường mời — hai bản sao là hai ngưỡng sẽ trôi khỏi nhau.
 *
 * ⚠️ **DI — vì sao KHÔNG `@Optional()`.** Memory `systemjobhandler-optional-dbw-di` áp cho handler nhận
 * tham số KHÔNG phải Nest provider (`workerDb: Database`) — Nest không resolve được và **AppModule sập**,
 * kéo hàng trăm int-spec đỏ dây chuyền. Handler này nhận `DatabaseService` + `ChatCallsService`, cả hai
 * là provider thật trong `ChatModule` (mirror `ChatDerivedRoomsReconcileJobHandler`, đang chạy PROD không
 * `@Optional()`). Gắn `@Optional()` cho một provider CÓ THẬT sẽ biến lỗi wiring thành `undefined` im lặng
 * — ngược đúng thứ memory đó bảo vệ. Bằng chứng thay thế MẠNH HƠN: ca int-spec dựng **AppModule THẬT** và
 * khẳng định `jobCode` có mặt đúng 1 lần (mẫu `chat-be5-derived-rooms.int-spec.ts`).
 */
@Injectable()
@SystemJobHandler()
export class ChatCallRingingTimeoutJobHandler implements JobHandler {
  readonly jobCode = CHAT_CALL_RINGING_TIMEOUT_JOB_CODE;
  private readonly logger = new Logger(ChatCallRingingTimeoutJobHandler.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly calls: ChatCallsService,
  ) {}

  /**
   * MỘT transaction cho cả tenant: cập nhật `chat_calls` + `chat_call_participants` + `audit_logs` phải
   * cùng commit/rollback. Ghi audit ngoài tx nghiệp vụ là đường im lặng (lỗi audit vẫn commit thay đổi).
   *
   * KHÔNG catch: lỗi propagate cho `JobRunner` finalize run-row `'Failed'` — nuốt lỗi ở đây làm một job
   * hỏng liên tục trông y hệt một job không có việc.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const expired = await this.db.withTenant(ctx.companyId, (tx) =>
      this.calls.expireStaleTx(tx, ctx.companyId, new Date()),
    );

    if (expired > 0) {
      this.logger.warn(
        `${this.jobCode} tenant=${ctx.companyId}: ${expired} cuộc gọi quá ${CHAT_CALL_RING_TIMEOUT_MS}ms ` +
          `đã chuyển 'missed' (phòng được mở khoá cho lời mời mới).`,
      );
    } else {
      this.logger.debug(`${this.jobCode} tenant=${ctx.companyId}: không có cuộc gọi quá hạn.`);
    }

    return {
      total: expired,
      success: expired,
      failed: 0,
      metadata: { callsMissed: expired, ringTimeoutMs: CHAT_CALL_RING_TIMEOUT_MS },
    };
  }
}

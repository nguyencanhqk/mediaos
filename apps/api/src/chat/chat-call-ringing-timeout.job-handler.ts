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
   * KHÔNG catch **phần DB**: lỗi trong `withTenant` propagate cho `JobRunner` finalize run-row `'Failed'`
   * — nuốt lỗi ở đó làm một job hỏng liên tục trông y hệt một job không có việc.
   *
   * ⚠️ **Phần SAU COMMIT thì NGƯỢC LẠI, và đây là ranh giới phải đọc kỹ (S10-CHAT-EMITGUARD-1 · KI-075).**
   * Lời gọi phát nằm sau khi tx đã commit, còn job này **idempotent theo thiết kế** — hàng vừa chuyển
   * `missed` không còn khớp `status='ringing'` ⇒ nhịp kế khớp **0 hàng**. Nên để lỗi phát propagate là
   * cách TỆ NHẤT: run-row bị đóng `'Failed'` cho một thay đổi ĐÃ commit, mà chạy lại job **không sửa
   * được gì** — sự kiện mất vĩnh viễn (CALL không có route ĐỌC nào để FE poll bù). Vì thế `emitExpired`
   * nuốt lỗi **per-item** và trả về SỐ đếm; con số đó đi thẳng vào `failed` + `metadata.emitFailed`.
   */
  async run(ctx: JobRunContext): Promise<JobRunResult> {
    const expiries = await this.db.withTenant(ctx.companyId, (tx) =>
      this.calls.expireStaleTx(tx, ctx.companyId, new Date()),
    );
    const expired = expiries.length;

    // ⚠️ SAU COMMIT — đường phát THỨ BẢY của vòng đời (S7-CALL-RT-1). Không có "actor" nào ở đây, nên
    // người được báo lấy từ chính bảng participants của từng cuộc gọi. Bỏ dòng này = máy người được gọi
    // đổ chuông tới khi họ tự tắt: job là đường DUY NHẤT đóng cuộc gọi ở phòng không ai mời lại.
    //
    // S10-CHAT-EMITGUARD-1 (KI-075): giá trị trả về PHẢI được tiêu thụ — nó là tín hiệu DUY NHẤT còn lại
    // sau khi `emitExpired` nuốt lỗi per-item. Bỏ nó đi = mất chuông trở thành im lặng tuyệt đối. Job
    // gặt (`chat-call-stale-active-sweep`) mang khuôn Y HỆT: sửa một cái mà quên cái kia là lý do
    // S10-CHAT-CALLSWEEP-1 đã hoãn cả hai lại thành MỘT món.
    const emitFailed = this.calls.emitExpired(ctx.companyId, expiries);

    if (emitFailed > 0) {
      this.logger.error(
        `${this.jobCode} tenant=${ctx.companyId}: ${emitFailed}/${expired} cuộc gọi KHÔNG phát được ` +
          `chat:call{missed} — hàng DB ĐÃ 'missed' và job IDEMPOTENT (nhịp kế khớp 0 hàng) ⇒ sự kiện ` +
          `mất VĨNH VIỄN, CALL không có đường REST để poll bù.`,
      );
    }

    if (expired > 0) {
      this.logger.warn(
        `${this.jobCode} tenant=${ctx.companyId}: ${expired} cuộc gọi quá ${CHAT_CALL_RING_TIMEOUT_MS}ms ` +
          `đã chuyển 'missed' (phòng được mở khoá cho lời mời mới).`,
      );
    } else {
      this.logger.debug(`${this.jobCode} tenant=${ctx.companyId}: không có cuộc gọi quá hạn.`);
    }

    // `total` = số hàng DB ĐÃ đổi trạng thái (sự thật nghiệp vụ — KHÔNG đổi vì chuông hỏng).
    // `success + failed === total` theo quy ước nhà (`attendance-alert-noti.job-handler.ts`) ⇒
    // `JobRunner.deriveStatus` cho 'Partial' khi mất một phần, 'Failed' khi mất cả lô. `callsMissed`
    // giữ nguyên đếm DB ở CẢ HAI nhánh, nên run-row đọc được nguyên vẹn "DB xong, chuông mất bao nhiêu".
    // `emitFailed` CHỈ có mặt khi > 0 — đường xanh phải giữ ĐÚNG hình dạng cũ của `JobRunResult`.
    return {
      total: expired,
      success: expired - emitFailed,
      failed: emitFailed,
      metadata: {
        callsMissed: expired,
        ringTimeoutMs: CHAT_CALL_RING_TIMEOUT_MS,
        ...(emitFailed > 0 ? { emitFailed } : {}),
      },
    };
  }
}

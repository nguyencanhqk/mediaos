import { Catch, Logger, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Socket } from "socket.io";

/**
 * S7-CALL-RT-1 — filter ngoại lệ **CÂM** cho `/ws-call`.
 *
 * ┌─ VÌ SAO KHÔNG DÙNG FILTER MẶC ĐỊNH CỦA NEST ────────────────────────────────────────────────────┐
 * │ `BaseWsExceptionFilter` có `includeCause` mặc định **true**: mọi lỗi lọt ra khỏi handler làm      │
 * │ client nhận một khung `exception` kèm **tên sự kiện + CHÍNH payload nó vừa gửi**, và socket **vẫn │
 * │ sống**. Trên một kênh mà chính sách là "không mô tả lỗi" (CHAT-ERR-030), đó là hai lỗ cùng lúc:  │
 * │   1. người dò cửa phân biệt được "handler ném" với "bỏ im lặng" ⇒ dựng lại được bản đồ nhánh xử  │
 * │      lý mà lớp A/B/C cố ý làm cho không phân biệt được;                                          │
 * │   2. khung echo lại có thể mang chính `sdp`/`candidate` — dữ liệu R3 cấm server chạm vào.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Ở đây: log ĐẦY ĐỦ phía server (fail-LOUD cho người vận hành), phát **0 khung** về client, và ngắt.
 * Ngắt chứ không để sống: một handler ném nghĩa là ta không biết mình vừa ở trạng thái nào — giữ kết nối
 * là giữ một phiên signalling mà server không còn khẳng định được điều gì về nó.
 */
@Catch()
export class CallSignallingExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(CallSignallingExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();
    const user = (client.data as { user?: { id?: string } } | undefined)?.user;

    // KHÔNG log payload/khung: nó có thể chứa SDP/ICE (R3 — server không đọc, không lưu; log tập trung
    // cũng là một nơi lưu). Đủ để điều tra: ai, socket nào, lỗi gì.
    this.logger.error(
      `/ws-call handler ném — ngắt kết nối. userId=${user?.id ?? "?"} socket=${client.id}: ` +
        (exception instanceof Error ? exception.message : String(exception)),
      exception instanceof Error ? exception.stack : undefined,
    );

    try {
      client.disconnect(true);
    } catch (err) {
      // Không nuốt im lặng: nếu ngay cả việc ngắt cũng hỏng thì một phiên signalling ở trạng thái không
      // xác định vẫn đang sống, và đó là thứ người vận hành phải biết.
      this.logger.error(
        `/ws-call: ngắt kết nối THẤT BẠI sau lỗi handler — phiên có thể còn sống: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }
}

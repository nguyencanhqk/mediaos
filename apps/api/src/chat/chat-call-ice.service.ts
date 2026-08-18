import { Injectable, Logger } from "@nestjs/common";
import type { IceConfigDto } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { ValkeyService } from "../permission/valkey.service";
import { CHAT_CALL_COOLDOWN_SCOPE, ChatCallCooldownService } from "./chat-call-cooldown.service";
import { chatKey } from "../common/valkey/valkey-key";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * STUN công cộng của Google — **luôn có mặt**, kể cả khi TURN sinh được credential.
 *
 * STUN chỉ giúp hai máy tự tìm đường trực tiếp; TURN mới là đường tiếp sức khi cả hai đứng sau NAT chặt.
 * Giữ cả hai trong danh sách để trình duyệt tự chọn đường rẻ nhất trước.
 */
const DEFAULT_STUN_SERVERS: IceConfigDto["iceServers"] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * Hạn của credential TURN (giây). S7-CALL-SEC-1 (HIGH-2 vế 1) HẠ từ 3600s xuống đúng cửa sổ MỘT cuộc
 * gọi thoại/hình thông thường: giữ credential sống 1 giờ trong khi cuộc gọi trung bình vài phút chỉ nới
 * rộng vô ích cửa sổ mà một credential rò/harvest còn dùng được. Cuộc gọi dài hơn 10 phút vẫn không vỡ:
 * client gọi lại endpoint này để xin credential mới (idempotent, không có trạng thái phía server).
 */
const TURN_CREDENTIAL_TTL_SECONDS = 600;

/**
 * Trần thời gian chờ Cloudflare. Đây là một lời gọi mạng RA NGOÀI nằm trên đường request của người dùng:
 * không có trần thì Cloudflare treo = nút "gọi" treo. 3 giây đủ rộng cho một API sinh credential, đủ hẹp
 * để người dùng không nghĩ ứng dụng chết.
 */
const TURN_FETCH_TIMEOUT_MS = 3_000;

/**
 * S7-CALL-SEC-1 (HIGH-2 vế 2) — cooldown per-user cho endpoint đúc credential. Ngưỡng đặt RỘNG hơn nhịp
 * gọi hợp lệ (một người khó gọi >5 cuộc/phút thật) nhưng đủ HẸP để chặn thu hoạch hàng loạt / kịch bản
 * lặp. Vượt ngưỡng ⇒ KHÔNG lỗi, rơi về STUN (mirror "thiếu env ⇒ không lỗi") — chặn cứng sẽ biến một
 * giới hạn phòng-thủ thành một cách DoS chính người dùng thật đang cố gọi điện.
 */
const ICE_COOLDOWN_MAX_REQUESTS = 5;
const ICE_COOLDOWN_WINDOW_SEC = 60;

/**
 * S7-CALL-SEC-1 (HIGH-2 vế 3) — Cloudflare từ chối LIÊN TIẾP (đếm theo company, reset khi có 1 lần
 * thành công) chạm ngưỡng này ⇒ ghi một dòng cảnh báo best-effort. Đây là dấu hiệu của hai kịch bản đáng
 * điều tra: (a) tài khoản Cloudflare bị dồn tới rate-limit (do lạm dụng hoặc do lỗi cấu hình), (b) khoá
 * `CLOUDFLARE_TURN_API_TOKEN` đã bị Cloudflare thu hồi. Không ghi thì cả hai xảy ra HOÀN TOÀN im lặng:
 * `!res.ok` chỉ `logger.warn` rồi fallback STUN — không dòng nào trả lời "chuyện gì đang xảy ra".
 */
const TURN_REJECTION_ALERT_THRESHOLD = 3;
/** TTL bộ đếm từ chối liên tiếp — đủ dài để gom các lần thử trong một đợt sự cố, tự dọn khi đợt đó qua. */
const TURN_REJECTION_COUNTER_TTL_SEC = 300;

/**
 * Audit action RIÊNG của service này. CỐ Ý KHÔNG thêm vào `CHAT_AUDIT` (`chat.errors.ts`) — file đó
 * NGOÀI quyền sở hữu của lane SEC/ICE (xem phân công Work Order). `object_type='chat_call'` đã có sẵn
 * trong UNION (`AuditObjectType`, mig `0546`) nên hằng chuỗi text tự do này KHÔNG cần migration.
 */
const ICE_TURN_REJECTED_AUDIT_ACTION = "chat.call.ice_turn_rejected";

interface CloudflareTurnResponse {
  iceServers?: unknown;
}

/**
 * S7-CALL-BE-1 / S7-CALL-SEC-1 — `CHAT-API-029` (`GET /chat/calls/ice-config`), port từ
 * `apps/lms/app/api/messages/calls/ice-config/route.ts` (DECISIONS-07 §5 · §6).
 *
 * ┌─ BẤT BIẾN #3 — ĐÂY LÀ FILE DUY NHẤT CỦA MODULE CHẠM SECRET ────────────────────────────────────┐
 * │ `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` đọc từ **env**, không hard-code, không    │
 * │ vào DB, không vào DTO, và **KHÔNG VÀO LOG Ở BẤT KỲ MỨC NÀO** — kể cả `debug`.                    │
 * │                                                                                                  │
 * │ ⚠️ Thân phản hồi của Cloudflare CHỨA credential dẫn xuất. Vì thế mọi nhánh lỗi ở đây chỉ log      │
 * │   **mã trạng thái** hoặc **tên lớp lỗi** — TUYỆT ĐỐI không log `await res.text()`, không log      │
 * │   `payload`, không log URL đã dựng (URL mang `keyId`). Đây là cách một secret rò qua log tập      │
 * │   trung mà không ai thấy: không có lỗi nào xảy ra cả. `chat-call-ice.service.spec.ts` khoá bất    │
 * │   biến này bằng spy trên MỌI mức Logger — cố tình log token/keyId/URL PHẢI làm spec đó ĐỎ.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG cache credential.** TTL 600s là hạn của MỘT credential; dùng chung một bản cache cho mọi
 * người là phát cùng một bí mật cho toàn công ty và kéo dài đời của nó ngoài tầm kiểm soát.
 *
 * Thiếu env ⇒ **không lỗi**: rơi về STUN. Cuộc gọi trong cùng mạng LAN/VPN vẫn chạy; cấu hình thiếu
 * không được biến một tính năng thành lỗi 500. Cooldown vượt ngưỡng ⇒ cùng triết lý: rơi về STUN,
 * KHÔNG lỗi (xem `ICE_COOLDOWN_*`).
 *
 * ⚠️ Service này GIỜ CÓ chạm DB — nhưng CHỈ trên nhánh hiếm "Cloudflare từ chối liên tiếp", và CHỈ để
 * ghi một dòng cảnh báo best-effort (`emitRejectionAlert`, KHÔNG BAO GIỜ ném). Đường thành công/thường
 * ngày (cấu hình đủ, Cloudflare trả 2xx, còn hạn mức cooldown) vẫn 0 DB, giữ đúng tinh thần ban đầu.
 */
@Injectable()
export class ChatCallIceService {
  private readonly logger = new Logger(ChatCallIceService.name);
  /** Fallback khi Valkey tắt: đếm số lần Cloudflare từ chối LIÊN TIẾP theo company. Best-effort, không
   *  phải thuộc tính an toàn — lệch giữa các instance chỉ làm cảnh báo trễ/sớm vài lần, không có gì để
   *  đi vòng (mirror lý do fallback của `ChatTypingService` là hợp lệ). */
  private readonly rejectionFallback = new Map<string, number>();

  constructor(
    private readonly cooldown: ChatCallCooldownService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly valkey: ValkeyService,
  ) {}

  async getIceConfig(actor: Actor): Promise<IceConfigDto> {
    const cooldownKey = ChatCallCooldownService.key(
      CHAT_CALL_COOLDOWN_SCOPE.ICE_CONFIG,
      actor.companyId,
      actor.id,
    );
    const withinCooldown = await this.cooldown.allow(
      cooldownKey,
      ICE_COOLDOWN_MAX_REQUESTS,
      ICE_COOLDOWN_WINDOW_SEC,
    );
    if (!withinCooldown) {
      // KHÔNG log actor.id/companyId ở mức warn thường trực — đây là nhánh có thể lặp nhiều lần liên
      // tiếp trong lạm dụng thật, và log định danh người dùng ở đây không thêm giá trị điều tra so với
      // cooldown key đã có namespace theo company (đủ để trace nếu cần mà không biến log thành sổ theo dõi
      // hành vi cá nhân mỗi phút).
      this.logger.debug("CHAT-API-029: vượt cooldown đúc credential TURN — rơi về STUN.");
      return { iceServers: [...DEFAULT_STUN_SERVERS] };
    }

    const turn = await this.fetchCloudflareIceServers(actor.companyId);
    return { iceServers: turn ? [...DEFAULT_STUN_SERVERS, ...turn] : [...DEFAULT_STUN_SERVERS] };
  }

  /** `null` = không cấu hình / gọi hỏng / phản hồi sai hình dạng ⇒ caller rơi về STUN. */
  private async fetchCloudflareIceServers(
    companyId: string,
  ): Promise<IceConfigDto["iceServers"] | null> {
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
    if (!keyId || !apiToken) return null;

    try {
      const res = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
          },
          body: JSON.stringify({ ttl: TURN_CREDENTIAL_TTL_SECONDS }),
          signal: AbortSignal.timeout(TURN_FETCH_TIMEOUT_MS),
        },
      );

      if (!res.ok) {
        // CHỈ mã trạng thái. Thân phản hồi lỗi của Cloudflare có thể vọng lại token đã gửi.
        this.logger.warn(
          `CHAT-API-029: Cloudflare TURN từ chối (HTTP ${res.status}) — rơi về STUN.`,
        );
        await this.recordRejection(companyId, res.status);
        return null;
      }

      await this.resetRejectionCounter(companyId);
      const payload = (await res.json()) as CloudflareTurnResponse;
      return this.normalizeIceServers(payload.iceServers);
    } catch (err) {
      // CHỈ tên lớp lỗi — `err.message` của `fetch` có thể kèm URL, mà URL mang `keyId`.
      this.logger.warn(
        `CHAT-API-029: không lấy được credential TURN (${err instanceof Error ? err.name : "unknown"}) — rơi về STUN.`,
      );
      return null;
    }
  }

  /**
   * Cloudflare trả `iceServers` khi là **object đơn**, khi là **mảng** (đã đổi hình dạng trong quá khứ).
   * Chuẩn hoá về mảng và **lọc theo hình dạng tối thiểu** thay vì tin phản hồi: dữ liệu này đi thẳng
   * xuống trình duyệt làm cấu hình `RTCPeerConnection`, nên một phần tử rác là một lỗi runtime ở FE mà
   * server hoàn toàn có thể chặn.
   */
  private normalizeIceServers(raw: unknown): IceConfigDto["iceServers"] | null {
    if (raw === null || raw === undefined) return null;
    const list = Array.isArray(raw) ? raw : [raw];
    const valid = list.filter((s): s is IceConfigDto["iceServers"][number] => {
      const urls = (s as { urls?: unknown } | null)?.urls;
      return typeof urls === "string" || Array.isArray(urls);
    });
    return valid.length > 0 ? valid : null;
  }

  /** Tăng bộ đếm từ chối liên tiếp; chạm ngưỡng ⇒ ghi cảnh báo best-effort (HIGH-2 vế 3). */
  private async recordRejection(companyId: string, status: number): Promise<void> {
    const count = await this.incrRejectionCount(companyId);
    if (count < TURN_REJECTION_ALERT_THRESHOLD) return;
    await this.emitRejectionAlert(companyId, count, status);
  }

  private async incrRejectionCount(companyId: string): Promise<number> {
    const key = this.rejectionKey(companyId);
    const viaValkey = await this.valkey.incr(key, TURN_REJECTION_COUNTER_TTL_SEC);
    if (viaValkey !== null) return viaValkey;
    const next = (this.rejectionFallback.get(key) ?? 0) + 1;
    this.rejectionFallback.set(key, next);
    return next;
  }

  private async resetRejectionCounter(companyId: string): Promise<void> {
    const key = this.rejectionKey(companyId);
    await this.valkey.del(key);
    this.rejectionFallback.delete(key);
  }

  private rejectionKey(companyId: string): string {
    return chatKey("ice-turn-reject", `co:${companyId}`);
  }

  /**
   * Ghi audit best-effort — KHÔNG BAO GIỜ ném: một dòng cảnh báo hỏng không được phép biến một lần
   * Cloudflare từ chối (vốn ĐÃ fallback STUN thành công) thành lỗi 500 cho người dùng đang cố gọi điện.
   *
   * `metadata` CHỈ chứa mã trạng thái HTTP + số lần liên tiếp — TUYỆT ĐỐI KHÔNG credential/keyId/URL/thân
   * phản hồi Cloudflare (BẤT BIẾN #3, cùng luật với hai nhánh log ở `fetchCloudflareIceServers`).
   */
  private async emitRejectionAlert(
    companyId: string,
    count: number,
    status: number,
  ): Promise<void> {
    try {
      await this.db.withTenant(companyId, (tx) =>
        this.audit.record(tx, {
          action: ICE_TURN_REJECTED_AUDIT_ACTION,
          objectType: "chat_call",
          actorType: "System",
          resultStatus: "Failure",
          metadata: { httpStatus: status, consecutiveRejections: count },
        }),
      );
    } catch (err) {
      this.logger.error(
        `CHAT-API-029: không ghi được cảnh báo TURN từ chối liên tiếp (best-effort, ${err instanceof Error ? err.name : "unknown"})`,
      );
    }
  }
}

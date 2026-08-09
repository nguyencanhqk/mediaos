import { Injectable, Logger } from "@nestjs/common";
import type { IceConfigDto } from "@mediaos/contracts";

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

/** Hạn của credential TURN (giây). Cuộc gọi dài hơn 1 giờ sẽ xin lại — client gọi lại endpoint này. */
const TURN_CREDENTIAL_TTL_SECONDS = 3600;

/**
 * Trần thời gian chờ Cloudflare. Đây là một lời gọi mạng RA NGOÀI nằm trên đường request của người dùng:
 * không có trần thì Cloudflare treo = nút "gọi" treo. 3 giây đủ rộng cho một API sinh credential, đủ hẹp
 * để người dùng không nghĩ ứng dụng chết.
 */
const TURN_FETCH_TIMEOUT_MS = 3_000;

interface CloudflareTurnResponse {
  iceServers?: unknown;
}

/**
 * S7-CALL-BE-1 — `CHAT-API-029` (`GET /chat/calls/ice-config`), port từ
 * `apps/lms/app/api/messages/calls/ice-config/route.ts` (DECISIONS-07 §5 · §6).
 *
 * ┌─ BẤT BIẾN #3 — ĐÂY LÀ FILE DUY NHẤT CỦA MODULE CHẠM SECRET ────────────────────────────────────┐
 * │ `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` đọc từ **env**, không hard-code, không    │
 * │ vào DB, không vào DTO, và **KHÔNG VÀO LOG Ở BẤT KỲ MỨC NÀO** — kể cả `debug`.                    │
 * │                                                                                                  │
 * │ ⚠️ Thân phản hồi của Cloudflare CHỨA credential dẫn xuất. Vì thế mọi nhánh lỗi ở đây chỉ log      │
 * │   **mã trạng thái** hoặc **tên lớp lỗi** — TUYỆT ĐỐI không log `await res.text()`, không log      │
 * │   `payload`, không log URL đã dựng (URL mang `keyId`). Đây là cách một secret rò qua log tập      │
 * │   trung mà không ai thấy: không có lỗi nào xảy ra cả.                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG cache credential.** TTL 3600s là hạn của MỘT credential; dùng chung một bản cache cho mọi
 * người là phát cùng một bí mật cho toàn công ty và kéo dài đời của nó ngoài tầm kiểm soát.
 *
 * Thiếu env ⇒ **không lỗi**: rơi về STUN. Cuộc gọi trong cùng mạng LAN/VPN vẫn chạy; cấu hình thiếu
 * không được biến một tính năng thành lỗi 500.
 */
@Injectable()
export class ChatCallIceService {
  private readonly logger = new Logger(ChatCallIceService.name);

  async getIceConfig(): Promise<IceConfigDto> {
    const turn = await this.fetchCloudflareIceServers();
    return { iceServers: turn ? [...DEFAULT_STUN_SERVERS, ...turn] : [...DEFAULT_STUN_SERVERS] };
  }

  /** `null` = không cấu hình / gọi hỏng / phản hồi sai hình dạng ⇒ caller rơi về STUN. */
  private async fetchCloudflareIceServers(): Promise<IceConfigDto["iceServers"] | null> {
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
        return null;
      }

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
}

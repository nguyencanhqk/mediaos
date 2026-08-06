import { Injectable, Logger } from "@nestjs/common";
import { loadEnv } from "../config/env.schema";
import { DatabaseService } from "../db/db.service";
import { ValkeyService } from "../permission/valkey.service";
import { ChatRoomsRepository } from "../chat/chat-rooms.repository";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { resolveEnvScope } from "./ws-adapter-config";

/**
 * Hạn sống của một khoá presence. Ngắt BẨN (kill -9, rút mạng, BSOD) không chạy `handleDisconnect`, nên
 * TTL là cơ chế dọn DUY NHẤT đáng tin — không có nó, một lần crash để lại "đang online" VĨNH VIỄN
 * (API-13 §7). 60 s: đủ dài để một nhịp tim lỡ không làm người dùng nhấp nháy offline, đủ ngắn để trạng
 * thái ma biến mất trong khoảng thời gian con người còn coi là "vừa xong".
 */
export const PRESENCE_TTL_SEC = 60;

/**
 * Nhịp làm mới. PHẢI < TTL/2 (không phải chỉ < TTL): một tick lỡ vì GC/CPU nghẽn vẫn còn nguyên một tick
 * nữa trước khi khoá hết hạn. Bằng đúng TTL/2 là không có biên an toàn nào.
 */
export const PRESENCE_HEARTBEAT_MS = (PRESENCE_TTL_SEC / 3) * 1000;

/** Một socket đang mở TRÊN INSTANCE NÀY. Sổ cục bộ — không đồng bộ giữa các instance (không cần). */
interface LocalSocket {
  companyId: string;
  userId: string;
}

/**
 * ChatPresenceService (S8-CHAT-UX-RT-1) — "đang online" **thuần server**, theo vòng đời kết nối WS.
 *
 * ══ VÌ SAO KHÔNG CÓ `@SubscribeMessage` ══
 * Bản năng đầu tiên cho presence là để client tự khai "tôi online". CHAT-DEC-005 đóng cửa đó (WS một
 * chiều) và `chat-realtime-structure.spec.ts` đóng đinh bằng ratchet 0 `@SubscribeMessage` trên TOÀN BỘ
 * `apps/api/src`. CHAT-DEC-017 giải bài bằng cách để **server tự biết**: có socket = online, không còn
 * socket nào = offline. Client không khai gì, nên không có gì để giả mạo — một user KHÔNG THỂ báo mình
 * online khi đã bị cắt phiên, và không thể báo người khác offline.
 *
 * ══ TRẠNG THÁI SỐNG Ở VALKEY, KHÔNG Ở BỘ NHỚ TIẾN TRÌNH ══
 * Khoá `{prefix}:{envScope}:co:{companyId}:user:{userId}` là một SET các `socketId`. Tập KHÁC RỖNG = online.
 * SET (không phải cờ boolean) vì một người mở nhiều tab/thiết bị: đóng một tab không được làm họ offline.
 *
 * ⚠️ `{envScope}` là BẮT BUỘC (`resolveEnvScope`) — cả 4 môi trường dùng CHUNG một Valkey và Valkey không
 * có tiền tố kênh sẵn. Thiếu nó thì người đang mở dev-online hiện "đang online" với người dùng PROD
 * (memory `valkey-shared-across-all-envs-no-channel-prefix`).
 *
 * ══ FAIL-SOFT CÓ KÊU ══
 * Presence là MỸ THUẬT; kết nối WS là đường sống của tin nhắn. Mọi method ở đây tự bắt lỗi và KHÔNG BAO
 * GIỜ ném lên `handleConnection`/`handleDisconnect` — một Valkey lỗi hay một truy vấn peer hỏng không được
 * phép ngắt phiên chat của người dùng. Nhưng luôn `logger.warn`: im lặng ở đây nghĩa là cả tính năng chết
 * mà không ai biết. Valkey CHƯA cấu hình ⇒ presence tắt hẳn (WARN một lần) — KHÔNG có bản sao in-memory,
 * vì bản sao đó chỉ đúng trên 1 instance và sẽ nói dối ngay khi scale.
 */
@Injectable()
export class ChatPresenceService {
  private readonly logger = new Logger(ChatPresenceService.name);
  private readonly envScope: string;
  private readonly locals = new Map<string, LocalSocket>();
  private warnedDisabled = false;

  constructor(
    private readonly valkey: ValkeyService,
    private readonly emitter: RealtimeEmitterService,
    private readonly db: DatabaseService,
    private readonly chatRooms: ChatRoomsRepository,
  ) {
    this.envScope = resolveEnvScope(loadEnv(), process.env.LANE_DB);
  }

  /**
   * Khoá presence của một user. Public để test đo được KHÔNG GIAN KHOÁ trực tiếp — đó là thứ chứng minh
   * hai môi trường không thấy nhau, và nó phải kiểm được mà không cần dựng Valkey thật.
   */
  presenceKey(companyId: string, userId: string): string {
    return `chat:presence:${this.envScope}:co:${companyId}:user:${userId}`;
  }

  /**
   * Socket vừa nối (GỌI SAU cổng quyền `view:chat-room` — người trượt cổng không vào presence của ai).
   * Phát `chat:presence{online}` CHỈ khi đây là socket ĐẦU TIÊN của user.
   */
  async markOnline(companyId: string, userId: string, socketId: string): Promise<void> {
    if (!this.ensureEnabled()) return;
    this.locals.set(socketId, { companyId, userId });
    try {
      const size = await this.valkey.sAddWithTtl(
        this.presenceKey(companyId, userId),
        socketId,
        PRESENCE_TTL_SEC,
      );
      // `null` = Valkey lỗi ⇒ KHÔNG phát: thà không biết còn hơn nói sai trạng thái của một con người.
      // `> 1` = user đã online từ trước (tab khác) ⇒ peer đã biết rồi, phát lại chỉ là nhiễu.
      if (size === 1) await this.broadcast(companyId, userId, "online");
    } catch (err) {
      this.warn("markOnline", userId, err);
    }
  }

  /**
   * Socket vừa đóng. Phát `chat:presence{offline}` CHỈ khi đó là socket CUỐI CÙNG của user.
   *
   * Cũng là đường mà `severUserSessions` (khoá/vô hiệu tài khoản) đi qua: `disconnectSockets(true)` đóng
   * kết nối ⇒ Socket.IO phát `disconnect` ⇒ gateway gọi hàm này. Không cần móc riêng cho việc thu hồi
   * phiên — nhưng CÓ ca test đóng đinh đường đó chạy thật.
   */
  async markOffline(companyId: string, userId: string, socketId: string): Promise<void> {
    // ⚠️ CỔNG "socket này ĐÃ TỪNG online chưa". `handleDisconnect` chạy cho MỌI socket, kể cả socket đã
    // TRƯỢT cổng quyền `view:chat-room` ở bước (A) và vì thế chưa bao giờ được `markOnline`. Không có cổng
    // này thì `sRemCount` trên một khoá KHÔNG TỒN TẠI trả 0 — trùng đúng tín hiệu "vừa gỡ socket cuối" —
    // và ta phát một `offline` MA cho các peer DM: một chuyển trạng thái chưa từng xảy ra, do một người mà
    // cổng quyền vừa từ chối. Nó cũng chặn luôn `offline` phát hai lần khi disconnect bị gọi lặp.
    if (!this.locals.has(socketId)) return;
    this.locals.delete(socketId);
    if (!this.ensureEnabled()) return;
    try {
      const key = this.presenceKey(companyId, userId);
      const remaining = await this.valkey.sRemCount(key, socketId);
      if (remaining === 0) {
        // Dọn khoá rỗng: SET rỗng trong Valkey tự biến mất, nhưng DEL tường minh để không phụ thuộc
        // chi tiết cài đặt đó, và để khoá không nằm lại chờ hết TTL.
        await this.valkey.del(key);
        await this.broadcast(companyId, userId, "offline");
      }
    } catch (err) {
      this.warn("markOffline", userId, err);
    }
  }

  /**
   * Nhịp tim — gia hạn TTL cho mọi socket đang mở TRÊN INSTANCE NÀY.
   *
   * Không phát sự kiện nào: đây là gia hạn, không phải chuyển trạng thái. `sAddWithTtl` idempotent với
   * cùng member, nên nếu khoá vừa hết hạn oan (nghẽn dài hơn TTL) thì nhịp này dựng lại — user không kẹt
   * offline trong khi socket vẫn sống.
   */
  async refreshLocal(): Promise<void> {
    if (!this.ensureEnabled() || this.locals.size === 0) return;
    for (const [socketId, { companyId, userId }] of this.locals) {
      try {
        await this.valkey.sAddWithTtl(
          this.presenceKey(companyId, userId),
          socketId,
          PRESENCE_TTL_SEC,
        );
      } catch (err) {
        this.warn("refreshLocal", userId, err);
      }
    }
  }

  /**
   * Lọc ra những user ĐANG online trong một danh sách.
   *
   * CHƯA có endpoint nào gọi — `API-13 §5.1` không cấp route đọc presence ở wave này. Viết sẵn (và có test)
   * để WO kế tiếp gắn ảnh chụp lúc mở app vào `CHAT-API-007a`: nếu không, FE chỉ thấy các chuyển trạng
   * thái SAU khi nối và một người online từ trước sẽ hiện offline tới lần họ đóng/mở lại.
   */
  async getOnlineUserIds(companyId: string, userIds: readonly string[]): Promise<string[]> {
    if (!this.ensureEnabled() || userIds.length === 0) return [];
    const online: string[] = [];
    for (const userId of userIds) {
      const size = await this.valkey.sCard(this.presenceKey(companyId, userId));
      if (size !== null && size > 0) online.push(userId);
    }
    return online;
  }

  /** Số socket cục bộ đang theo dõi — chỉ để test đóng đinh việc dọn sổ (không rò bộ nhớ). */
  localSocketCount(): number {
    return this.locals.size;
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Gửi trạng thái tới các peer DM. Truy vấn peer nằm ở đây (không ở caller) để `handleConnection` không
   * phải biết gì về hình dạng của presence.
   */
  private async broadcast(
    companyId: string,
    userId: string,
    status: "online" | "offline",
  ): Promise<void> {
    const peers = await this.db.withTenant(companyId, (tx) =>
      this.chatRooms.listDirectPeerUserIds(tx, companyId, userId),
    );
    this.emitter.emitChatPresence(companyId, { userId, status }, peers);
  }

  /** Valkey chưa cấu hình ⇒ presence tắt. WARN ĐÚNG MỘT LẦN — không spam mỗi kết nối. */
  private ensureEnabled(): boolean {
    if (this.valkey.isEnabled()) return true;
    if (!this.warnedDisabled) {
      this.warnedDisabled = true;
      this.logger.warn(
        "VALKEY_URL chưa cấu hình — TRẠNG THÁI ĐANG ONLINE TẮT HOÀN TOÀN (không có bản sao in-memory: " +
          "bản sao chỉ đúng trên 1 instance và sẽ nói dối ngay khi scale)",
      );
    }
    return false;
  }

  private warn(op: string, userId: string, err: unknown): void {
    this.logger.warn(`${op} thất bại — trạng thái online của user=${userId} có thể sai`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

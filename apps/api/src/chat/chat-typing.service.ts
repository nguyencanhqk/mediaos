import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { ValkeyService } from "../permission/valkey.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { ChatAccessService } from "./chat-access.service";

interface Actor {
  id: string;
  companyId: string;
}

/**
 * Cửa sổ tiết lưu server (giây). FE đã tiết lưu 3 s (CHAT-DEC-017); cửa sổ server đặt NGẮN HƠN một chút
 * để client tuân thủ không bị nuốt ping hợp lệ, mà client không tuân thủ (hoặc script) vẫn bị chặn ồn.
 */
export const TYPING_THROTTLE_SEC = 2;

/** Trần sổ tiết lưu in-memory khi Valkey tắt — chặn một vòng lặp ping làm phình bộ nhớ vô hạn. */
const FALLBACK_MAX_ENTRIES = 10_000;

/**
 * ChatTypingService (S8-CHAT-UX-RT-1 · CHAT-API-023 · CHAT-DEC-017) — "đang gõ".
 *
 * ══ VÌ SAO ĐI REST CHỨ KHÔNG PHẢI WS ══
 * Bản năng cho typing indicator là một event client→server. CHAT-DEC-005 đóng cửa đó và
 * `chat-realtime-structure.spec.ts` đóng đinh bằng ratchet **0 `@SubscribeMessage` trên toàn `apps/api/src`**.
 * CHAT-DEC-017 chốt lối vào là REST `POST /chat/rooms/:id/typing` rồi fan-out WS — nhờ vậy tín hiệu này đi
 * qua ĐÚNG pipeline guard mà mọi ghi khác đi qua (`JwtAuthGuard → CompanyGuard → 2FA → PermissionGuard`),
 * thay vì một handler WS tự viết lại kiểm tra quyền.
 *
 * ⚠️ **0 ghi DB · 0 audit** (API-13 §5.1). `assertMember` là ĐỌC — R6 cấm ghi, không cấm đọc. Thêm bất kỳ
 * INSERT/UPDATE nào vào đây (kể cả "lưu lần gõ cuối") là biến một tín hiệu mỗi-vài-giây-mỗi-người thành
 * lưu lượng ghi thường trực, và biến audit log thành nhật ký hành vi gõ phím.
 */
@Injectable()
export class ChatTypingService {
  private readonly logger = new Logger(ChatTypingService.name);
  /** Fallback khi Valkey tắt: `key → hạn (epoch ms)`. Chỉ đúng trong 1 tiến trình — xem `throttled()`. */
  private readonly fallback = new Map<string, number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly emitter: RealtimeEmitterService,
    private readonly valkey: ValkeyService,
  ) {}

  /**
   * CHAT-API-023 — báo "đang gõ". Trả `void` ⇒ controller trả `204` cho MỌI nhánh đi tới đây.
   *
   * Chỉ hai lối thoát bằng lỗi, cả hai đều TRƯỚC khi tới phần mỹ thuật:
   *   • không phải thành viên / phòng lạ ⇒ `404 CHAT-ERR-001` (`assertMember`);
   *   • thiếu cặp `('send','chat-message')` ⇒ `403` (`PermissionGuard`, ở tầng controller).
   */
  async ping(actor: Actor, roomId: string): Promise<void> {
    const access = await this.db.withTenant(actor.companyId, (tx) =>
      this.access.assertMember(tx, actor.companyId, roomId, actor.id),
    );

    // Phòng đã lưu trữ là CHỈ ĐỌC (CHAT-ERR-005 chặn gửi tin). Phát "đang gõ" ở đó là báo một việc không
    // thể xảy ra — người xem sẽ chờ một tin nhắn không bao giờ tới. LUẬT NGHIỆP VỤ có chủ đích, không phải
    // nuốt lỗi: vẫn trả 204 (client không có gì để xử lý khác đi, và một mã lỗi mới cho việc mỹ thuật là
    // nợ hợp đồng), nhưng ca test đóng đinh "0 emit" để nhánh này không lặng lẽ đảo chiều.
    if (access.room.isArchived) {
      this.logger.debug(`typing bỏ qua: phòng ${roomId} đã lưu trữ`);
      return;
    }

    if (await this.throttled(actor, roomId)) return;

    this.emitter.emitChatTyping(actor.companyId, roomId, { roomId, userId: actor.id });
  }

  /**
   * `true` ⇒ đã có ping của CÙNG (user, phòng) trong cửa sổ ⇒ bỏ emit.
   *
   * `setNx` là nguyên tử và dùng chung giữa các instance. Khi Valkey tắt/lỗi (`null`) thì rơi xuống `Map`
   * in-memory — ở đây fallback là HỢP LỆ, khác hẳn `ReplayGuard`: tiết lưu này là **giảm ồn**, không phải
   * thuộc tính an toàn. Lệch giữa các instance chỉ làm phát dư vài sự kiện mỹ thuật; không có gì để đi vòng.
   */
  private async throttled(actor: Actor, roomId: string): Promise<boolean> {
    const key = `chat:typing:co:${actor.companyId}:room:${roomId}:user:${actor.id}`;
    const first = await this.valkey.setNx(key, "1", TYPING_THROTTLE_SEC);
    if (first !== null) return !first;

    const now = Date.now();
    const until = this.fallback.get(key);
    if (until !== undefined && until > now) return true;

    // Dọn rác theo hạn TRƯỚC khi thêm — không có TTL tự động như Valkey, nên phải tự quét. Chỉ chạy khi
    // sổ đã lớn: quét mỗi lần gọi là O(n) trên đường nóng của một tính năng gõ-phím.
    if (this.fallback.size >= FALLBACK_MAX_ENTRIES) {
      for (const [k, exp] of this.fallback) if (exp <= now) this.fallback.delete(k);
      // Vẫn đầy sau khi quét (toàn hạn còn hiệu lực) ⇒ bỏ hẳn sổ. Mất tiết lưu trong một cửa sổ còn hơn
      // giữ một Map phình không giới hạn trong tiến trình API.
      if (this.fallback.size >= FALLBACK_MAX_ENTRIES) this.fallback.clear();
    }
    this.fallback.set(key, now + TYPING_THROTTLE_SEC * 1000);
    return false;
  }
}

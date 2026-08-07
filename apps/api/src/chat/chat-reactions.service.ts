import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  chatReactionEmojiSchema,
  type ChatMessageReactionDto,
  type ChatReactionEmoji,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { ChatAccessService } from "./chat-access.service";
import { ChatReactionsRepository } from "./chat-reactions.repository";
import type { ChatActor } from "./chat-rooms.service";
import { assertNotArchived } from "./chat-room-rules";
import { CHAT_ERR } from "./chat.errors";

/**
 * S8-CHAT-UX-BE-3 — thả / bỏ thả cảm xúc (CHAT-API-022a/022b · CHAT-FUNC-019 · CHAT-DEC-018).
 *
 * ┌─ BỐN LUẬT, ĐỌC TRƯỚC KHI SỬA ────────────────────────────────────────────────────────────────┐
 * │ 1. Ranh giới dữ liệu đi qua `assertMessageAccess` — MỘT truy vấn, MỘT hằng thông điệp cho mọi │
 * │    lý do (tin lạ · tin tenant khác · phòng mình không thuộc · tin trước `visible_from_seq`).  │
 * │    404 chứ không 403: 403 xác nhận tin CÓ THẬT ⇒ bắn `messageId` ngẫu nhiên là dò được kho    │
 * │    tin của cả công ty (CHAT-ERR-001, trục TIN).                                               │
 * │ 2. Phòng ĐÃ LƯU TRỮ là CHỈ ĐỌC (CHAT-ERR-005) — cùng luật `sendMessage`. Thả cảm xúc là một    │
 * │    lối GHI vào phòng; bỏ vế này là để lại đúng một đường ghi lọt qua trạng thái đóng băng.     │
 * │ 3. Tin ĐÃ THU HỒI ⇒ 422 (CHAT-ERR-024). Cùng lớp che với `body: null` (§13.6).                 │
 * │ 4. **0 audit.** `CHAT_AUDIT` cố ý chỉ có 3 hành động tin nhắn, và cả ba đều tác động lên NỘI   │
 * │    DUNG của người khác (thu hồi · ghim · bỏ ghim). Một lượt thả cảm xúc thì không: nó là nút   │
 * │    bật/tắt đảo ngược được, và ghi mỗi lượt vào `audit_logs` (bảng append-only DÙNG CHUNG, đang │
 * │    phục vụ điều tra AUTH/HR/LEAVE) sẽ nhấn chìm bảng đó bằng lưu lượng UI.                     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class ChatReactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatReactionsRepository,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  /**
   * CHAT-API-022a — thả cảm xúc. Idempotent: thả hai lần vẫn đúng MỘT hàng.
   *
   * Trả tổng hợp MỚI của tin (không phải 204) để FE hoà lại cập-nhật-lạc-quan mà không phải tải lại
   * trang tin — `PUT` là chiều CÓ THỂ bị từ chối (tin thu hồi · phòng lưu trữ · emoji lạ), nên nó là
   * chiều mà client cần nghe lại sự thật từ server.
   */
  async react(
    actor: ChatActor,
    messageId: string,
    emojiRaw: string,
  ): Promise<ChatMessageReactionDto[]> {
    const emoji = this.parseEmoji(emojiRaw);

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.assertReactable(tx, actor, messageId);
      const changed = await this.repo.add(tx, messageId, actor.id, emoji);
      const reactions = await this.aggregateOne(tx, actor, messageId);
      return { roomId: acc.message.roomId, changed, reactions };
    });

    // SAU commit, và CHỈ khi thật sự có hàng mới: thả lại emoji đang thả là no-op, phát `chat:reaction`
    // lần nữa chỉ bắt cả phòng render lại đúng con số cũ.
    if (result.changed) this.broadcast(actor, result.roomId, messageId, result.reactions);
    return result.reactions;
  }

  /**
   * CHAT-API-022b — bỏ thả. Chưa từng thả ⇒ vẫn **204**, KHÔNG 404 (xem `repo.remove`).
   *
   * ⚠️ CỐ Ý **không** chặn ở tin đã thu hồi / phòng đã lưu trữ — khác `react`. Bỏ thả là đường GỠ; chặn
   * nó nghĩa là một cảm xúc lỡ tay thả vào tin ngay trước khi tin bị thu hồi (hoặc phòng bị đóng) sẽ
   * dính vĩnh viễn, không có đường sửa qua API. Đường ghi phải chặt, đường gỡ thì không.
   * Ranh giới dữ liệu (`assertMessageAccess`) VẪN áp — nới đúng vế cần nới.
   */
  async unreact(actor: ChatActor, messageId: string, emojiRaw: string): Promise<void> {
    const emoji = this.parseEmoji(emojiRaw);

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
      const changed = await this.repo.remove(tx, actor.companyId, messageId, actor.id, emoji);
      const reactions = await this.aggregateOne(tx, actor, messageId);
      return { roomId: acc.message.roomId, changed, reactions };
    });

    if (result.changed) this.broadcast(actor, result.roomId, messageId, result.reactions);
  }

  /**
   * Tổng hợp cho một LÔ tin — đường mà `ChatAttachmentPresignService.decorate` gọi khi dựng DTO.
   *
   * Mở `withTenant` RIÊNG (giống `attachmentsByMessage`) vì caller gọi nó SAU khi tx đọc tin đã commit:
   * lồng `withTenant` trong `withTenant` là chiếm client thứ hai từ pool khi client thứ nhất còn giữ
   * transaction, và trên PgBouncer transaction-mode nó TREO chứ không báo lỗi.
   *
   * ĐÚNG MỘT truy vấn cho cả lô (`done_when` #5) — không phải một truy vấn mỗi tin.
   */
  async aggregateForMessages(
    actor: ChatActor,
    messageIds: readonly string[],
  ): Promise<Map<string, ChatMessageReactionDto[]>> {
    const out = new Map<string, ChatMessageReactionDto[]>();
    if (messageIds.length === 0) return out;

    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.aggregateForMessages(tx, actor.companyId, messageIds, actor.id),
    );
    for (const row of rows) {
      const list = out.get(row.messageId) ?? [];
      list.push({ emoji: row.emoji, count: row.count, mine: row.mine });
      out.set(row.messageId, list);
    }
    return out;
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Biên HTTP đã lọc emoji qua `ChatReactionEmojiParamPipe`; hàm này là lưới cho đường gọi service
   * (job/bridge sau này) — DTO chỉ gác biên HTTP. Cùng khuôn `createGroup` kiểm lại `roomType`.
   */
  private parseEmoji(raw: string): ChatReactionEmoji {
    const parsed = chatReactionEmojiSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UnprocessableEntityException(CHAT_ERR.REACTION_EMOJI_INVALID);
    }
    return parsed.data;
  }

  /**
   * Ba cổng của đường GHI, ĐÚNG THỨ TỰ: ranh giới dữ liệu (404) → phòng đóng băng (422) → thu hồi (422).
   *
   * Thứ tự có nghĩa: `assertMessageAccess` phải chạy TRƯỚC hai vế kia, nếu không một người ngoài phòng
   * sẽ phân biệt được "phòng đã lưu trữ" với "phòng không tồn tại" — tức 404 hằng bị thủng bằng một
   * kênh phụ.
   */
  private async assertReactable(tx: TenantTx, actor: ChatActor, messageId: string) {
    const acc = await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
    assertNotArchived(acc.room);
    if (acc.message.recalledAt !== null) {
      throw new UnprocessableEntityException(CHAT_ERR.REACTION_ON_RECALLED);
    }
    return acc;
  }

  /** Tổng hợp một tin, TRONG tx đang mở — dùng ngay sau khi ghi để trả về/phát đúng ảnh chụp mới nhất. */
  private async aggregateOne(
    tx: TenantTx,
    actor: ChatActor,
    messageId: string,
  ): Promise<ChatMessageReactionDto[]> {
    const rows = await this.repo.aggregateForMessages(tx, actor.companyId, [messageId], actor.id);
    return rows.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine }));
  }

  /**
   * Phát `chat:reaction` cho cả phòng. **`mine` bị bỏ ở đây** — nó là trạng thái của riêng actor; xem
   * `wsChatReactionEventSchema`. Emitter `.parse()` lần nữa nên một khoá thừa lọt tới đó cũng bị strip,
   * nhưng bỏ TẠI NGUỒN là để không ai đọc code này mà tưởng cả phòng đang nhận cờ của người vừa bấm.
   */
  private broadcast(
    actor: ChatActor,
    roomId: string,
    messageId: string,
    reactions: readonly ChatMessageReactionDto[],
  ): void {
    this.realtime.emitChatReaction(actor.companyId, roomId, {
      roomId,
      messageId,
      reactions: reactions.map(({ emoji, count }) => ({ emoji, count })),
    });
  }
}

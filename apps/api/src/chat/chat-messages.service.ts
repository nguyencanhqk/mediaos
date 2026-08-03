import { ForbiddenException, Injectable, UnprocessableEntityException } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import type {
  ChatMarkReadRequest,
  ChatMarkReadResultDto,
  ChatMessageDto,
  ChatUnreadCountDto,
  ListChatMessagesQuery,
  SendMessageRequest,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { OutboxService } from "../events/outbox.service";
import { FileAccessLogService } from "../foundation/files/file-access-log.service";
import { ChatAccessService, type ChatRoomAccess } from "./chat-access.service";
import { ChatAttachmentPresignService } from "./chat-attachments.service";
import { ChatAttachmentsRepository } from "./chat-attachments.repository";
import { CHAT_MESSAGE_ENTITY_TYPE, isAttachableFile } from "./chat-file.constants";
import type { ChatMessageType } from "../db/schema/communication";
import { ChatMessagesRepository } from "./chat-messages.repository";
import { CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import { assertCursorExclusive } from "./chat-message-rules";
import { unreadOf } from "./chat-room-rules";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import type { ChatActor } from "./chat-rooms.service";

/** `permission_code` ghi vào `file_access_logs` khi gắn tệp vào tin — cặp gate của `POST …/messages`. */
const CHAT_ATTACH_PERMISSION_CODE = "CHAT.CHAT-MESSAGE.SEND";

/** `uq_chat_messages_client_id` (mig 0538) — partial unique (company, room, sender, client_message_id). */
const CLIENT_ID_UNIQUE_CONSTRAINT = "uq_chat_messages_client_id";
const PG_UNIQUE_VIOLATION = "23505";

function isClientIdConflict(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; constraint?: unknown };
  return e.code === PG_UNIQUE_VIOLATION && e.constraint === CLIENT_ID_UNIQUE_CONSTRAINT;
}

/**
 * S7-CHAT-BE-2 — đọc/gửi tin + con trỏ đã đọc (CHAT-API-009, 010, 013, 014, 016).
 * Thu hồi/ghim ở `ChatMessageModerationService`.
 *
 * MỌI đường nhận `roomId` đi qua `ChatAccessService.assertMember` TRƯỚC mọi thứ khác.
 */
@Injectable()
export class ChatMessagesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatMessagesRepository,
    // ── S7-CHAT-BE-3 (additive) ──
    private readonly attachmentRepo: ChatAttachmentsRepository,
    private readonly attachments: ChatAttachmentPresignService,
    private readonly accessLog: FileAccessLogService,
    // ── S7-CHAT-BE-6 (additive) ── outbox producer cho thông báo CHAT. `OutboxService` đến từ
    // `EventsModule` (@Global, cùng nguồn với `AuditService`) ⇒ KHÔNG đổi `chat.module.ts`.
    private readonly outbox: OutboxService,
    // ── S7-CHAT-RT-1 (additive) ── emit SAU commit; KHÔNG gọi bên trong `withTenant`.
    private readonly realtime: RealtimeEmitterService,
  ) {}

  /** CHAT-API-009 — một trang tin theo con trỏ. Cấm offset (API-13 §6.4). */
  async listMessages(
    actor: ChatActor,
    roomId: string,
    query: ListChatMessagesQuery,
  ): Promise<ChatMessageDto[]> {
    assertCursorExclusive(query.beforeSeq, query.afterSeq);
    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      return this.repo.listMessages(tx, actor.companyId, roomId, {
        beforeSeq: query.beforeSeq,
        afterSeq: query.afterSeq,
        limit: query.limit,
        // Vị từ SPEC-15 §13.4 — v1 luôn NULL, nhưng đường đọc phải mang sẵn nó từ đầu.
        visibleFromSeq: acc.membership.visibleFromSeq,
      });
    });
    // Gắn tệp SAU khi tx đã commit — ký tệp mở transaction riêng, lồng vào đây sẽ TREO trên PgBouncer
    // transaction-mode (xem cảnh báo ở `ChatAttachmentPresignService.decorate`).
    return this.attachments.decorate(actor, rows);
  }

  /** CHAT-API-013 — tin đã ghim của phòng. Mang vị từ §13.4 y như `/messages` (cùng cột `body`). */
  async listPinned(actor: ChatActor, roomId: string): Promise<ChatMessageDto[]> {
    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      return this.repo.listPinned(tx, actor.companyId, roomId, acc.membership.visibleFromSeq);
    });
    return this.attachments.decorate(actor, rows);
  }

  /**
   * CHAT-API-010 — gửi tin, IDEMPOTENT theo `clientMessageId` (CHAT-ERR-014).
   *
   * Thứ tự trong tx có ý nghĩa: `assertMember` → chặn phòng lưu trữ → **tra `clientMessageId`** →
   * validate trả lời/mention → **cấp `room_seq`** → INSERT → nâng con trỏ đọc của người gửi.
   *
   * Tra `clientMessageId` phải đứng TRƯỚC lúc cấp số: gửi lại tin cũ không được đụng vào
   * `last_message_seq` của phòng. (Kể cả khi lỡ đụng thì rollback trả lại — nhưng dựa vào rollback để
   * giữ đúng bất biến là dựa vào may.)
   *
   * ⚠️ `room_seq` cấp TRONG tx, khác `room_code` của BE-1 (cấp ngoài tx, chấp nhận lỗ số): `0539` verify
   * ép `room_seq` liên tục từ 1 trong mỗi phòng, nên một lỗ là migration sau đó ĐỎ.
   */
  async sendMessage(
    actor: ChatActor,
    roomId: string,
    dto: SendMessageRequest,
  ): Promise<ChatMessageDto> {
    const sent = await this.db
      .withTenant(actor.companyId, async (tx): Promise<{ messageId: string; isNew: boolean }> => {
        const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
        if (acc.room.isArchived) {
          // 409 (không phải 422): xung đột với TRẠNG THÁI của phòng, body gửi lên vẫn hợp lệ.
          throw new ConflictException(CHAT_ERR.SEND_ARCHIVED);
        }

        const existing = await this.repo.findByClientMessageId(
          tx,
          actor.companyId,
          roomId,
          actor.id,
          dto.clientMessageId,
        );
        // `isNew:false` — gửi lại cùng `clientMessageId` KHÔNG được phát `chat:message` lần thứ hai
        // (đúng cùng lập luận với việc nhánh này không enqueue thông báo, xem chú thích bên dưới).
        if (existing) return { messageId: existing.id, isNew: false };

        if (dto.replyToMessageId) {
          const ok = await this.repo.replyTargetIsValid(
            tx,
            actor.companyId,
            roomId,
            dto.replyToMessageId,
            // §13.4 — không trích dẫn được tin nằm trước mốc mình vào phòng (trích dẫn kéo nội dung
            // tin gốc lên màn hình qua DTO của tin trả lời).
            acc.membership.visibleFromSeq,
          );
          if (!ok) throw new UnprocessableEntityException(CHAT_ERR.REPLY_INVALID);
        }

        const mentions = await this.repo.filterMentionsToMembers(tx, actor.companyId, roomId, [
          ...new Set(dto.mentions ?? []),
        ]);

        // S7-CHAT-BE-3 — validate tệp TRƯỚC khi cấp số: `fileIds` sai thì tin không được sinh ra, và
        // `last_message_seq` không được đụng tới. (Rollback cũng trả lại số, nhưng dựa vào rollback để
        // giữ đúng bất biến là dựa vào may — cùng lập luận với nhánh idempotent ở trên.)
        const fileIds = await this.resolveAttachments(tx, actor, dto.fileIds);

        const now = new Date();
        const roomSeq = await this.repo.allocateRoomSeq(tx, actor.companyId, roomId, now);

        // KHÔNG bọc try/catch quanh INSERT ở đây: 23505 abort cả transaction (mọi câu sau là 25P02).
        // Để lỗi thoát ra ngoài `withTenant` rồi mới tra lại — xem `.catch` bên dưới.
        const inserted = await this.repo.insertMessage(tx, {
          companyId: actor.companyId,
          roomId,
          senderId: actor.id,
          body: dto.body,
          // Kiểu do SERVER suy, client không chọn: có tệp ⇒ `'file'`. `'system'` chỉ server sinh.
          messageType: fileIds.length > 0 ? "file" : "text",
          mentions,
          clientMessageId: dto.clientMessageId,
          replyToMessageId: dto.replyToMessageId ?? null,
          roomSeq,
          // ĐẶT NGAY TRONG CÂU INSERT — `attachment_count` không có GRANT UPDATE (0538:350). Mọi
          // `UPDATE … SET attachment_count` là 42501 ⇒ MỌI TIN CÓ TỆP TRẢ 500. Đừng chuyển xuống dưới.
          attachmentCount: fileIds.length,
        });

        // Link nằm CÙNG transaction với INSERT tin (SPEC-15 §13.5 bước 3): tin và tệp của nó cùng có
        // hoặc cùng không, không bao giờ có tin trỏ vào link chưa tồn tại. PHẢI đứng SAU insert (cần
        // `messageId` làm `entity_id`) — kéo theo: `23505` idempotency xảy ra TRƯỚC khi có link nào,
        // nên nhánh đua ở `.catch` bên dưới không cần dọn link.
        await this.linkAttachments(tx, actor, inserted.id, fileIds);

        // S7-CHAT-BE-6 — enqueue thông báo TRONG CÙNG tx. Vị trí có ba ràng buộc, cả ba đúng bằng CẤU
        // TRÚC code chứ không bằng cờ canh:
        //   (a) nhánh idempotent-replay `if (existing) return existing.id;` return SỚM ở trên ⇒ gửi lại
        //       cùng `clientMessageId` KHÔNG sinh thông báo thứ hai;
        //   (b) nhánh `.catch` đua 23505 nằm NGOÀI closure này ⇒ bên thua cuộc không enqueue;
        //   (c) đứng SAU `insertMessage` (cần `messageId`) và TRƯỚC `advanceLastReadSeq` ⇒ tin, tệp,
        //       thông báo và con trỏ đọc cùng commit hoặc cùng rollback.
        await this.enqueueNotifications(tx, actor, acc, {
          messageId: inserted.id,
          roomSeq,
          mentions,
          messageType: fileIds.length > 0 ? "file" : "text",
          createdAt: now,
        });

        // Tin của chính mình luôn tự nâng con trỏ đọc, TRONG CÙNG tx (SPEC-15 §13.2) — nếu không,
        // người gửi thấy badge chưa-đọc của chính tin mình vừa gửi.
        // Vẫn đi qua `GREATEST` (trần = chính `roomSeq`): một `POST /read` chạy song song đã đọc con trỏ
        // CŨ mà commit sau lệnh này thì phép gán đè sẽ kéo con trỏ của CHÍNH NGƯỜI GỬI lùi lại.
        await this.repo.advanceLastReadSeq(
          tx,
          actor.companyId,
          acc.membership.id,
          roomSeq,
          roomSeq,
        );
        return { messageId: inserted.id, isNew: true };
      })
      .catch(async (err: unknown) => {
        // Đua thật sự: cả hai qua SELECT rồi cùng INSERT. Bên thua nhận 23505 của ĐÚNG constraint
        // idempotency ⇒ tra lại trong tx MỚI và trả bản ghi của bên thắng. Rollback đã trả lại
        // `last_message_seq` nên KHÔNG để lại lỗ số.
        // Soi TÊN constraint: nuốt 23505 của constraint khác là trả về tin sai trong im lặng.
        if (!isClientIdConflict(err)) throw err;
        const raced = await this.db.withTenant(actor.companyId, (tx) =>
          this.repo.findByClientMessageId(
            tx,
            actor.companyId,
            roomId,
            actor.id,
            dto.clientMessageId,
          ),
        );
        if (!raced) throw err;
        // Đua THUA: bên thắng đã phát `chat:message` rồi — phát nữa là hai bản cho cùng một tin.
        return { messageId: raced.id, isNew: false };
      });

    const message = await this.readMessage(actor, sent.messageId);
    // SAU commit, và CHỈ ở nhánh INSERT thật sự. `readMessage` chạy trong tx RIÊNG đã đóng.
    // ⚠️ KHÔNG gọi `emitChatRead` ở đây dù `sendMessage` có tự nâng con trỏ đọc của chính người gửi
    // (`advanceLastReadSeq` ở trên, SPEC-15 §13.2): người gửi biết thừa là mình vừa gửi, và ở phòng
    // nhóm đông người điều đó nhân thêm N sự kiện `chat:read` vô nghĩa cho MỖI tin. Chỉ đường
    // `markRead` tường minh mới phát `chat:read`.
    if (sent.isNew) {
      this.realtime.emitChatMessage(actor.companyId, roomId, message);
    }
    return message;
  }

  /**
   * S7-CHAT-BE-6 — phát sự kiện outbox cho thông báo CHAT (SPEC-15 §17). Chạy TRONG tx của `sendMessage`.
   *
   * ══ NỘI DUNG TIN NHẮN KHÔNG VÀO PAYLOAD ══
   * Payload mang `messageId` để FE điều hướng, KHÔNG mang `body`/trích đoạn. `outbox_events` là dữ liệu
   * BỀN và chảy tiếp vào `notifications.payload` rồi vào push/email — nội dung tin lọt vào đó là rời khỏi
   * phạm vi kiểm soát của module CHAT vĩnh viễn. Bridge còn một lớp whitelist nữa ở `payloadOf`, nhưng
   * lớp đó không cứu được thứ đã được ghi vào outbox.
   *
   * ══ Hai nhánh, loại trừ nhau ══
   *   • phòng `direct`      → `chat.message.direct_sent`  → CHAT_DIRECT_MESSAGE (gộp lô 15 phút)
   *   • phòng khác + mention → `chat.message.mentioned`   → CHAT_MENTIONED (gửi ngay)
   *   • còn lại (group/department/project không nhắc ai) → KHÔNG enqueue gì. Thông báo cho MỌI tin của
   *     mọi phòng là cách nhanh nhất để người dùng tắt sạch thông báo của hệ thống.
   *
   * Khoá snake_case (`actor_name`, `room_name`, `unread_count`) là giá trị ĐÃ RENDER SẴN, khớp CHÍNH XÁC
   * `variables_schema` của template (`0538:736-747`). Chúng phải được tính ở ĐÂY vì `payloadOf` của bridge
   * là hàm ĐỒNG BỘ — nó đổi tên khoá được, nhưng không query DB được.
   */
  private async enqueueNotifications(
    tx: TenantTx,
    actor: ChatActor,
    acc: ChatRoomAccess,
    msg: {
      messageId: string;
      roomSeq: number;
      mentions: string[];
      messageType: ChatMessageType;
      createdAt: Date;
    },
  ): Promise<void> {
    // Tin hệ thống ("X đã vào phòng") không sinh thông báo. Hôm nay `sendMessage` chưa bao giờ sinh
    // `system` — guard đứng sẵn để WO nào bắt đầu sinh loại tin đó không phải nhớ quay lại đây.
    if (msg.messageType === "system") return;

    const isDirect = acc.room.roomType === "direct";
    if (!isDirect && msg.mentions.length === 0) return;

    const actorName = await this.repo.findSenderDisplayName(tx, actor.companyId, actor.id);
    // `users.email` NOT NULL nên `findSenderDisplayName` chỉ trả null khi user biến mất giữa chừng —
    // không có tên thì thông báo sẽ hiện literal "{actor_name}", thà bỏ qua còn hơn.
    if (!actorName) return;

    const createdAt = msg.createdAt.toISOString();

    if (isDirect) {
      const peer = await this.repo.findDirectPeer(tx, actor.companyId, acc.room.id, actor.id);
      if (!peer) return; // người kia đã rời phòng — không còn ai để báo.
      await this.outbox.enqueue(tx, {
        eventType: "chat.message.direct_sent",
        payload: {
          roomId: acc.room.id,
          messageId: msg.messageId,
          actorUserId: actor.id,
          recipientUserId: peer.userId,
          createdAt,
          actor_name: actorName,
          // Số chưa đọc tại thời điểm CHÍNH TIN NÀY được gửi. `NotificationEngineService.intake` SKIP
          // hoàn toàn khi trùng `dedupeKey` (không có nhánh UPDATE) ⇒ chỉ tin ĐẦU TIÊN CỦA LÔ ĐƯỢC TIÊU
          // THỤ mới đóng dấu con số của mình vào thông báo; mọi tin sau bị bỏ qua — CHỦ Ý. Badge
          // `GET /chat/unread-count` mới là số real-time; hai con số lệch nhau là đúng thiết kế.
          //
          // ⚠️ "Tin đầu tiên ĐƯỢC TIÊU THỤ" ≠ "tin đầu tiên theo thời gian": `OutboxWorker.claim()` trả
          // hàng theo thứ tự KHÔNG bảo đảm (KI-059) nên con số hiển thị hiện là 1|2|3 tuỳ lượt chạy. Sai
          // lệch thuần hiển thị (không chạm quyền/toàn vẹn), vá ở `S7-INT-OUTBOX-FIFO-1`. Đừng "sửa" nó
          // bằng một nhánh UPDATE trong engine — đó là hạ tầng dùng chung của cả TASK/LEAVE/ATT.
          unread_count: unreadOf(msg.roomSeq, peer.lastReadSeq),
        },
      });
      return;
    }

    await this.outbox.enqueue(tx, {
      eventType: "chat.message.mentioned",
      payload: {
        roomId: acc.room.id,
        messageId: msg.messageId,
        actorUserId: actor.id,
        mentionedUserIds: msg.mentions,
        createdAt,
        actor_name: actorName,
        // Phòng `direct` không có tên, nhưng nhánh này chỉ chạy cho phòng KHÁC `direct` (nơi
        // `chk_chat_rooms_name` ép `name` NOT NULL). `?? roomCode` là lưới cuối để `{room_name}` không
        // bao giờ rơi ra ngoài dưới dạng literal.
        room_name: acc.room.name ?? acc.room.roomCode,
      },
    });
  }

  /**
   * CHAT-API-014 — đánh dấu đã đọc. Con trỏ CHỈ TIẾN và không vượt thực tế.
   * Gửi số nhỏ hơn → **200, bỏ qua im lặng** (CHAT-ERR-018), không phải lỗi.
   *
   * Cả hai vế (chỉ-tiến + kẹp trần) chạy TRONG câu UPDATE — xem `advanceLastReadSeq`. Tính ở JS rồi ghi
   * đè là đường LÙI con trỏ khi hai thiết bị cùng gửi, và đó là đúng thứ §13.2 sinh ra để chặn.
   */
  async markRead(
    actor: ChatActor,
    roomId: string,
    dto: ChatMarkReadRequest,
  ): Promise<ChatMarkReadResultDto> {
    const { changed, ...result } = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const lastReadSeq = await this.repo.advanceLastReadSeq(
        tx,
        actor.companyId,
        acc.membership.id,
        dto.seq,
        acc.room.lastMessageSeq ?? 0,
      );
      return {
        roomId,
        lastReadSeq,
        unreadCount: unreadOf(acc.room.lastMessageSeq, lastReadSeq),
        // ⚠️ CỜ NỘI BỘ — bị bóc ra ngay ở destructure trên, KHÔNG được lọt vào `ChatMarkReadResultDto`.
        // So con trỏ SAU (giá trị `advanceLastReadSeq` trả về) với con trỏ TRƯỚC (đọc bởi `assertMember`
        // trong CÙNG tx) — không đọc DB lần hai. `advanceLastReadSeq` là `GREATEST(…, LEAST(…))` NGAY
        // TRONG câu UPDATE, nên gửi `seq` nhỏ hơn con trỏ hiện tại là no-op ⇒ `changed=false`.
        // CẤM tái lập bất kỳ phép Math.max/Math.min nào ở tầng JS: đọc-rồi-ghi ở đây là lối con-trỏ-lùi
        // mà `631d683e` đã vá bằng cách đẩy cả hai vế xuống SQL.
        changed: lastReadSeq !== acc.membership.lastReadSeq,
      };
    });

    // SAU commit, và chỉ khi con trỏ THỰC SỰ tiến. Không có cờ này thì mỗi lần FE bấm "đã đọc" lại (rất
    // hay xảy ra: đổi tab, cuộn) đều phát một `chat:read` không mang thông tin mới cho cả phòng.
    if (changed) {
      this.realtime.emitChatRead(actor.companyId, roomId, {
        roomId,
        userId: actor.id,
        lastReadSeq: result.lastReadSeq,
      });
    }
    return result;
  }

  /** CHAT-API-016 — badge header. Tự-bound theo actor; phép trừ, KHÔNG `COUNT(*)`. */
  async unreadCount(actor: ChatActor): Promise<ChatUnreadCountDto> {
    return this.db.withTenant(actor.companyId, (tx) =>
      this.repo.unreadTotals(tx, actor.companyId, actor.id),
    );
  }

  /**
   * Đọc lại một tin để dựng DTO — vẫn đi qua `assertMessageAccess`, không có lối tắt.
   * (Dùng sau khi ghi: tin vừa tạo/sửa nằm trong phòng actor chắc chắn thuộc, nhưng đi cửa chung giữ
   * cho "mọi đường đọc tin đều qua một điểm khẳng định" đúng theo nghĩa đen.)
   */
  private async readMessage(actor: ChatActor, messageId: string): Promise<ChatMessageDto> {
    const row = await this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
      const found = await this.repo.findMessageForDto(
        tx,
        actor.companyId,
        messageId,
        acc.membership.visibleFromSeq,
      );
      if (!found) throw new UnprocessableEntityException(CHAT_ERR.MESSAGE_NOT_FOUND);
      return found;
    });
    return this.attachments.decorateOne(actor, row);
  }

  // ─── S7-CHAT-BE-3 — đính kèm (SPEC-15 §13.5) ─────────────────────────────────

  /**
   * `fileIds` đã khử trùng + đã kiểm ĐỦ BỐN VẾ, hoặc ném CHAT-ERR-015 (403).
   *
   * Bốn vế: tệp thuộc tenant (RLS lọc còn 0 hàng nếu không) · `owner_user_id = người gửi` · đã
   * `Uploaded` · không `Infected`. Ba vế đầu ở SQL (`findOwnedFiles`), vế trạng thái ở
   * `isAttachableFile` — cùng luật với FOUNDATION, không phải bản sao (xem jsdoc hàm đó).
   *
   * ⚠️ KHỬ TRÙNG là bắt buộc, không phải dọn dẹp cho đẹp: `uq_file_links_entity_file_active` cấm gắn
   * cùng một tệp hai lần vào cùng một tin ⇒ `[f, f]` sẽ `23505` giữa tx và biến một request hợp lệ
   * thành 500. Giữ THỨ TỰ client gửi (Set giữ thứ tự chèn) để FE hiển thị đúng thứ tự người dùng chọn.
   *
   * ⚠️ "Cùng transaction" KHÔNG cấp quyền và KHÔNG thay được vế trạng thái — đây là kiểm tra nghiệp vụ ở
   * tầng service, độc lập hoàn toàn với quyền Postgres (DB-12 §6.3 đính chính 01/08).
   */
  private async resolveAttachments(
    tx: TenantTx,
    actor: ChatActor,
    fileIds: string[] | undefined,
  ): Promise<string[]> {
    const unique = [...new Set(fileIds ?? [])];
    if (unique.length === 0) return [];

    const rows = await this.attachmentRepo.findOwnedFiles(tx, actor.companyId, actor.id, unique);
    const usable = new Set(rows.filter(isAttachableFile).map((r) => r.id));
    // So khớp TOÀN BỘ: thiếu bất kỳ tệp nào ⇒ từ chối cả tin. Gửi một phần là im lặng bỏ rơi tệp mà
    // người dùng tin là đã gửi — tệ hơn hẳn một lỗi rõ ràng.
    if (usable.size !== unique.length) {
      throw new ForbiddenException(CHAT_ERR.ATTACHMENT_INVALID);
    }
    return unique;
  }

  /**
   * Tạo `file_links` + `file_access_logs` cho tin vừa INSERT — TRONG cùng tx.
   *
   * Tự ghi link thay vì gọi `FileService.link`: hàm kia tự mở `withTenant` riêng nên không lồng được vào
   * tx gửi tin (PgBouncer transaction-mode), mà SPEC-15 §13.5 bước 3 đòi CÙNG transaction. Đây đúng tiền
   * lệ `HrEmployeeAvatarService` — và `FilesModule` export `FileLinkRepository`/`FileAccessLogService`
   * chính vì trường hợp này (xem jsdoc `files.module.ts`).
   *
   * Đổi lại, hai thứ `FileService.link` làm hộ phải tự làm ở đây: quyền (đã kiểm ở
   * `resolveAttachments`, cùng luật với `ChatMessageFileResolver.canLinkFile`) và access-log.
   * KHÔNG ghi `audit_logs`: `S7-CHAT-BE-2` đã chốt gửi tin không sinh dòng audit nào — mỗi tin một dòng
   * sẽ nhấn chìm bảng append-only dùng chung. `file_access_logs` là nơi đúng cho dấu vết tệp.
   */
  private async linkAttachments(
    tx: TenantTx,
    actor: ChatActor,
    messageId: string,
    fileIds: string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    const created = await this.attachmentRepo.insertAttachmentLinks(tx, {
      companyId: actor.companyId,
      messageId,
      createdBy: actor.id,
      fileIds,
    });
    for (const link of created) {
      await this.accessLog.record(tx, {
        fileId: link.fileId,
        action: "Link",
        accessGranted: true,
        actorUserId: actor.id,
        fileLinkId: link.id,
        moduleCode: CHAT_MODULE_CODE,
        entityType: CHAT_MESSAGE_ENTITY_TYPE,
        entityId: messageId,
        permissionCode: CHAT_ATTACH_PERMISSION_CODE,
      });
    }
  }
}

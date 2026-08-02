import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import { ConflictException } from "@nestjs/common";
import type {
  ChatMarkReadRequest,
  ChatMarkReadResultDto,
  ChatMessageDto,
  ChatUnreadCountDto,
  ListChatMessagesQuery,
  SendMessageRequest,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import { ChatMessagesRepository } from "./chat-messages.repository";
import { CHAT_ERR } from "./chat.errors";
import { assertCursorExclusive, clampReadCursor } from "./chat-message-rules";
import { unreadOf } from "./chat-room-rules";
import { toChatMessageDto } from "./chat.mapper";
import type { ChatActor } from "./chat-rooms.service";

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
  ) {}

  /** CHAT-API-009 — một trang tin theo con trỏ. Cấm offset (API-13 §6.4). */
  async listMessages(
    actor: ChatActor,
    roomId: string,
    query: ListChatMessagesQuery,
  ): Promise<ChatMessageDto[]> {
    assertCursorExclusive(query.beforeSeq, query.afterSeq);
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const rows = await this.repo.listMessages(tx, actor.companyId, roomId, {
        beforeSeq: query.beforeSeq,
        afterSeq: query.afterSeq,
        limit: query.limit,
        // Vị từ SPEC-15 §13.4 — v1 luôn NULL, nhưng đường đọc phải mang sẵn nó từ đầu.
        visibleFromSeq: acc.membership.visibleFromSeq,
      });
      return rows.map(toChatMessageDto);
    });
  }

  /** CHAT-API-013 — tin đã ghim của phòng. */
  async listPinned(actor: ChatActor, roomId: string): Promise<ChatMessageDto[]> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const rows = await this.repo.listPinned(tx, actor.companyId, roomId);
      return rows.map(toChatMessageDto);
    });
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
    const messageId = await this.db
      .withTenant(actor.companyId, async (tx) => {
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
        if (existing) return existing.id;

        if (dto.replyToMessageId) {
          const ok = await this.repo.replyTargetIsValid(
            tx,
            actor.companyId,
            roomId,
            dto.replyToMessageId,
          );
          if (!ok) throw new UnprocessableEntityException(CHAT_ERR.REPLY_INVALID);
        }

        const mentions = await this.repo.filterMentionsToMembers(tx, actor.companyId, roomId, [
          ...new Set(dto.mentions ?? []),
        ]);

        const now = new Date();
        const roomSeq = await this.repo.allocateRoomSeq(tx, actor.companyId, roomId, now);

        // KHÔNG bọc try/catch quanh INSERT ở đây: 23505 abort cả transaction (mọi câu sau là 25P02).
        // Để lỗi thoát ra ngoài `withTenant` rồi mới tra lại — xem `.catch` bên dưới.
        const inserted = await this.repo.insertMessage(tx, {
          companyId: actor.companyId,
          roomId,
          senderId: actor.id,
          body: dto.body,
          messageType: "text",
          mentions,
          clientMessageId: dto.clientMessageId,
          replyToMessageId: dto.replyToMessageId ?? null,
          roomSeq,
          // ĐẶT NGAY TRONG CÂU INSERT — `attachment_count` không có GRANT UPDATE (0538:350).
          // BE-2 chưa có đính kèm; BE-3 sẽ truyền `fileIds.length` vào đúng chỗ này.
          attachmentCount: 0,
        });

        // Tin của chính mình luôn tự nâng con trỏ đọc, TRONG CÙNG tx (SPEC-15 §13.2) — nếu không,
        // người gửi thấy badge chưa-đọc của chính tin mình vừa gửi.
        await this.repo.setLastReadSeq(tx, actor.companyId, acc.membership.id, roomSeq);
        return inserted.id;
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
        return raced.id;
      });

    return this.readMessage(actor, messageId);
  }

  /**
   * CHAT-API-014 — đánh dấu đã đọc. Con trỏ CHỈ TIẾN và không vượt thực tế (`clampReadCursor`).
   * Gửi số nhỏ hơn → **200, bỏ qua im lặng** (CHAT-ERR-018), không phải lỗi.
   */
  async markRead(
    actor: ChatActor,
    roomId: string,
    dto: ChatMarkReadRequest,
  ): Promise<ChatMarkReadResultDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMember(tx, actor.companyId, roomId, actor.id);
      const next = clampReadCursor(dto.seq, acc.membership.lastReadSeq, acc.room.lastMessageSeq);
      if (next !== acc.membership.lastReadSeq) {
        await this.repo.setLastReadSeq(tx, actor.companyId, acc.membership.id, next);
      }
      return {
        roomId,
        lastReadSeq: next,
        unreadCount: unreadOf(acc.room.lastMessageSeq, next),
      };
    });
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
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
      const row = await this.repo.findMessageForDto(tx, actor.companyId, messageId);
      if (!row) throw new UnprocessableEntityException(CHAT_ERR.MESSAGE_NOT_FOUND);
      return toChatMessageDto(row);
    });
  }
}

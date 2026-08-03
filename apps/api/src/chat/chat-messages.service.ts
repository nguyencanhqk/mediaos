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
import { FileAccessLogService } from "../foundation/files/file-access-log.service";
import { ChatAccessService } from "./chat-access.service";
import { ChatAttachmentPresignService } from "./chat-attachments.service";
import { ChatAttachmentsRepository } from "./chat-attachments.repository";
import { CHAT_MESSAGE_ENTITY_TYPE, isAttachableFile } from "./chat-file.constants";
import { ChatMessagesRepository } from "./chat-messages.repository";
import { CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import { assertCursorExclusive } from "./chat-message-rules";
import { unreadOf } from "./chat-room-rules";
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
    return this.db.withTenant(actor.companyId, async (tx) => {
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

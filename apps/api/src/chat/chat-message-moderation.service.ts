import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { ChatMessageDto } from "@mediaos/contracts";
import { AuditService } from "../events/audit.service";
import { DatabaseService } from "../db/db.service";
import { ChatAccessService } from "./chat-access.service";
import { ChatMessagesRepository } from "./chat-messages.repository";
import { CHAT_AUDIT, CHAT_ERR, CHAT_MODULE_CODE } from "./chat.errors";
import { assertCanRecall, assertPinBudget, assertPinnable } from "./chat-message-rules";
import { assertNotArchived } from "./chat-room-rules";
import { toChatMessageDto } from "./chat.mapper";
import type { ChatActor } from "./chat-rooms.service";

/**
 * S7-CHAT-BE-2 — thao tác KIỂM DUYỆT trên tin nhắn: thu hồi · ghim · bỏ ghim
 * (CHAT-API-011, 012a, 012b).
 *
 * Tách khỏi `ChatMessagesService` vì đây là nhóm DUY NHẤT tác động lên nội dung của NGƯỜI KHÁC — cũng
 * đúng là nhóm duy nhất ghi `audit_logs` (§1.7 micro-plan). Để chung một file thì luật "gửi/đọc không
 * ghi audit" và "kiểm duyệt phải ghi audit" nằm cạnh nhau và rất dễ bị đồng hoá nhầm.
 *
 * Cả ba đường vào bằng `messageId` ⇒ đều qua `ChatAccessService.assertMessageAccess` (một truy vấn,
 * một hằng 404 — chống oracle dò sự tồn tại của TIN, xem jsdoc của hàm đó).
 */
@Injectable()
export class ChatMessageModerationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: ChatAccessService,
    private readonly repo: ChatMessagesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * CHAT-API-011 — thu hồi (SPEC-15 §13.6). Người gửi trong cửa sổ, hoặc admin phòng NHÓM.
   *
   * IDEMPOTENT: thu hồi lần hai trả về chính bản ghi đã thu hồi, KHÔNG lỗi và KHÔNG thêm dòng audit —
   * người dùng bấm hai lần (mạng chậm, double-tap) không đáng nhận màn hình đỏ.
   */
  async recall(actor: ChatActor, messageId: string): Promise<ChatMessageDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
      // Phòng lưu trữ = CHỈ ĐỌC (CHAT-ERR-005). Đặt TRƯỚC nhánh idempotent: một phòng đã đóng thì cả
      // lần bấm thứ hai cũng không được báo "thành công" cho một thao tác ghi không được phép.
      assertNotArchived(acc.room);
      if (acc.message.recalledAt) return this.readDto(tx, actor, messageId);

      const now = new Date();
      assertCanRecall(acc, now);

      await this.repo.setRecalled(tx, actor.companyId, messageId, now, actor.id);
      // Gỡ tệp = SOFT DELETE (`file_links` không có GRANT DELETE). Link mất ⇒ FilePolicy từ chối tải.
      await this.repo.unlinkMessageFiles(tx, actor.companyId, messageId, now);

      await this.audit.record(tx, {
        action: CHAT_AUDIT.MESSAGE_RECALLED,
        objectType: "chat_message",
        objectId: messageId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        // ⚠️ KHÔNG `body`, KHÔNG trích đoạn nội dung (SPEC-15 §18 · API-13 §6.8). Chỉ AI thu hồi tin
        // CỦA AI, ở phòng nào — đủ để trả lời tranh chấp mà không biến audit thành bản sao nội dung.
        newValues: {
          roomId: acc.message.roomId,
          senderId: acc.message.senderId,
          byRoomAdmin: acc.message.senderId !== actor.id,
        },
      });

      return this.readDto(tx, actor, messageId);
    });
  }

  /** CHAT-API-012a — ghim. Quyền `pin:chat-message` + **admin phòng**; trần 20/phòng (CHAT-ERR-008). */
  async pin(actor: ChatActor, messageId: string): Promise<ChatMessageDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
      assertNotArchived(acc.room);
      this.access.requirePinAuthority(acc);
      assertPinnable(acc);
      if (acc.message.pinnedAt) return this.readDto(tx, actor, messageId);

      // Khoá phòng TRƯỚC khi đếm: `countPinned` → `setPinned` không khoá là TOCTOU, hai request cùng
      // đọc 19 rồi cùng ghim ⇒ 21 tin ghim, cả hai 200, CHAT-ERR-008 bị phá trong im lặng.
      await this.repo.lockRoom(tx, actor.companyId, acc.message.roomId);
      const pinned = await this.repo.countPinned(tx, actor.companyId, acc.message.roomId);
      assertPinBudget(pinned);

      const now = new Date();
      await this.repo.setPinned(tx, actor.companyId, messageId, { at: now, by: actor.id });
      await this.audit.record(tx, {
        action: CHAT_AUDIT.MESSAGE_PINNED,
        objectType: "chat_message",
        objectId: messageId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        newValues: { roomId: acc.message.roomId },
      });
      return this.readDto(tx, actor, messageId);
    });
  }

  /** CHAT-API-012b — bỏ ghim. Idempotent: tin chưa ghim thì trả nguyên trạng, không lỗi. */
  async unpin(actor: ChatActor, messageId: string): Promise<ChatMessageDto> {
    return this.db.withTenant(actor.companyId, async (tx) => {
      const acc = await this.access.assertMessageAccess(tx, actor.companyId, messageId, actor.id);
      assertNotArchived(acc.room);
      this.access.requirePinAuthority(acc);
      if (!acc.message.pinnedAt) return this.readDto(tx, actor, messageId);

      await this.repo.setPinned(tx, actor.companyId, messageId, null);
      await this.audit.record(tx, {
        action: CHAT_AUDIT.MESSAGE_UNPINNED,
        objectType: "chat_message",
        objectId: messageId,
        actorUserId: actor.id,
        moduleCode: CHAT_MODULE_CODE,
        resultStatus: "Success",
        oldValues: { roomId: acc.message.roomId, pinned: true },
      });
      return this.readDto(tx, actor, messageId);
    });
  }

  /** Đọc lại trong CÙNG tx (membership đã khẳng định ở đầu method — không mở cửa thứ hai). */
  private async readDto(
    tx: Parameters<Parameters<DatabaseService["withTenant"]>[1]>[0],
    actor: ChatActor,
    messageId: string,
  ): Promise<ChatMessageDto> {
    const row = await this.repo.findMessageForDto(tx, actor.companyId, messageId);
    if (!row) throw new UnprocessableEntityException(CHAT_ERR.MESSAGE_NOT_FOUND);
    return toChatMessageDto(row);
  }
}

import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatMessageType } from "../db/schema/communication";
import { fileLinks } from "../db/schema/files";
import { users } from "../db/schema/users";
import { CHAT_MODULE_CODE } from "./chat.errors";

export interface ChatMessageRow {
  id: string;
  companyId: string;
  roomId: string;
  senderId: string;
  senderName: string | null;
  body: string;
  messageType: ChatMessageType;
  mentions: string[];
  pinnedAt: Date | null;
  pinnedBy: string | null;
  replyToMessageId: string | null;
  recalledAt: Date | null;
  attachmentCount: number;
  roomSeq: number;
  createdAt: Date;
}

/**
 * Tập cột ra khỏi repo. LIỆT KÊ TƯỜNG MINH, không `select()` trần:
 *   • `seq` (identity CẤP BẢNG) tuyệt đối không được rời server — SPEC-15 §13.1;
 *   • `client_message_id` là khoá idempotency của client, không phải dữ liệu hiển thị;
 *   • `search_vector` là cột generated to đùng, kéo về là phí băng thông mỗi trang tin;
 *   • `file_url`/`file_name` là hai cột KHAI TỬ (BE-3) — đường đọc trả `null` từ mapper.
 * `select()` trần sẽ tự động kéo theo mọi cột thêm vào bảng sau này, gồm cả cột chưa ai kịp nghĩ có
 * được lộ hay không.
 */
const MESSAGE_COLUMNS = {
  id: chatMessages.id,
  companyId: chatMessages.companyId,
  roomId: chatMessages.roomId,
  senderId: chatMessages.senderId,
  senderName: users.fullName,
  body: chatMessages.body,
  messageType: chatMessages.messageType,
  mentions: chatMessages.mentions,
  pinnedAt: chatMessages.pinnedAt,
  pinnedBy: chatMessages.pinnedBy,
  replyToMessageId: chatMessages.replyToMessageId,
  recalledAt: chatMessages.recalledAt,
  attachmentCount: chatMessages.attachmentCount,
  roomSeq: chatMessages.roomSeq,
  createdAt: chatMessages.createdAt,
} as const;

/**
 * S7-CHAT-BE-2 — data-access tin nhắn. Mọi hàm nhận `tx` (service giữ ranh giới transaction).
 *
 * ⚠️ QUYỀN GHI Ở DB — đọc trước khi thêm câu UPDATE nào:
 *   • `chat_messages`: `SELECT, INSERT` cấp bảng. UPDATE **chỉ 4 cột** — `pinned_at`, `pinned_by`
 *     (`0050:64`), `recalled_at`, `recalled_by` (`0538:355`). KHÔNG DELETE. `0539` verify (3) làm ĐỎ
 *     migration nếu ai cấp UPDATE/DELETE cấp bảng, nên đây là ràng buộc VĨNH VIỄN, không phải tạm thời.
 *   • `attachment_count` CỐ Ý ngoài GRANT ⇒ đặt NGAY TRONG CÂU INSERT (`0538:350`).
 *   • `file_links`: `SELECT, INSERT, UPDATE` — **KHÔNG DELETE** (`0433:182`) ⇒ gỡ link = soft delete.
 * TypeScript mù với cả ba; chỉ int-spec trên DB thật bắt được (42501).
 */
@Injectable()
export class ChatMessagesRepository {
  /**
   * Cấp `room_seq` kế tiếp + đóng dấu hoạt động cuối, trong MỘT câu.
   *
   * `UPDATE … RETURNING` khoá hàng phòng ⇒ **tuần tự hoá theo phòng**: hai người gửi cùng lúc không thể
   * nhận cùng số. Đai thứ hai là unique `(company_id, room_id, room_seq)` — race lọt qua khoá hàng thì
   * `23505` fail-loud, KHÔNG trùng số im lặng (con trỏ phân trang trùng số = mất/lặp tin khi cuộn).
   *
   * ⚠️ PHẢI gọi TRONG tx nghiệp vụ. Khác `room_code` (BE-1) vốn chấp nhận lỗ số: `0539` verify ép
   * `room_seq` LIÊN TỤC TỪ 1 trong mỗi phòng, nên một lỗ là migration sau đó ĐỎ. Tách ra tx riêng =
   * rollback tin nhắn để lại lỗ.
   */
  async allocateRoomSeq(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    now: Date,
  ): Promise<number> {
    const rows = await tx
      .update(chatRooms)
      .set({
        lastMessageSeq: sql`COALESCE(${chatRooms.lastMessageSeq}, 0) + 1`,
        lastMessageAt: now,
      })
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
      .returning({ seq: chatRooms.lastMessageSeq });
    return rows[0].seq as number;
  }

  async insertMessage(
    tx: TenantTx,
    values: {
      companyId: string;
      roomId: string;
      senderId: string;
      body: string;
      messageType: ChatMessageType;
      mentions: string[];
      clientMessageId: string;
      replyToMessageId: string | null;
      roomSeq: number;
      /** ĐẶT NGAY Ở ĐÂY — `attachment_count` không có GRANT UPDATE (0538:350). */
      attachmentCount: number;
    },
  ): Promise<{ id: string }> {
    const rows = await tx.insert(chatMessages).values(values).returning({ id: chatMessages.id });
    return rows[0];
  }

  /** Tin theo id, kèm `senderName` — dùng để dựng DTO sau khi ghi. KHÔNG gate membership (caller lo). */
  async findMessageForDto(
    tx: TenantTx,
    companyId: string,
    messageId: string,
  ): Promise<ChatMessageRow | undefined> {
    const rows = await tx
      .select(MESSAGE_COLUMNS)
      .from(chatMessages)
      .leftJoin(
        users,
        and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
      )
      .where(and(eq(chatMessages.companyId, companyId), eq(chatMessages.id, messageId)))
      .limit(1);
    return rows[0]
      ? { ...rows[0], messageType: rows[0].messageType as ChatMessageType }
      : undefined;
  }

  /** Bản ghi đã gửi trước đó với cùng `clientMessageId` (idempotency — `uq_chat_messages_client_id`). */
  async findByClientMessageId(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    senderId: string,
    clientMessageId: string,
  ): Promise<ChatMessageRow | undefined> {
    const rows = await tx
      .select(MESSAGE_COLUMNS)
      .from(chatMessages)
      .leftJoin(
        users,
        and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
      )
      .where(
        and(
          eq(chatMessages.companyId, companyId),
          eq(chatMessages.roomId, roomId),
          eq(chatMessages.senderId, senderId),
          eq(chatMessages.clientMessageId, clientMessageId),
        ),
      )
      .limit(1);
    return rows[0]
      ? { ...rows[0], messageType: rows[0].messageType as ChatMessageType }
      : undefined;
  }

  /**
   * CHAT-API-009 — một trang tin theo CON TRỎ. **Không có tham số `offset` ở bất kỳ đâu** (API-13 §6.4:
   * offset trôi khi có tin mới chèn vào giữa lúc cuộn).
   *
   * Vị từ SPEC-15 §13.4 `(visible_from_seq IS NULL OR room_seq >= visible_from_seq)` viết SẴN từ v1 dù
   * cột luôn NULL — thêm sau sẽ sót đường đọc.
   *
   * Trả về LUÔN TĂNG DẦN theo `room_seq`: nhánh `beforeSeq`/mặc định phải quét DESC để lấy đúng k tin
   * gần con trỏ nhất, rồi đảo lại ở đây. Trả hai chiều khác nhau tuỳ tham số là bắt FE tự đoán chiều.
   */
  async listMessages(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    opts: {
      beforeSeq?: number;
      afterSeq?: number;
      limit: number;
      visibleFromSeq: number | null;
    },
  ): Promise<ChatMessageRow[]> {
    const conds: SQL[] = [eq(chatMessages.companyId, companyId), eq(chatMessages.roomId, roomId)];
    if (opts.visibleFromSeq !== null) {
      conds.push(sql`${chatMessages.roomSeq} >= ${opts.visibleFromSeq}`);
    }
    if (opts.beforeSeq !== undefined) conds.push(lt(chatMessages.roomSeq, opts.beforeSeq));
    if (opts.afterSeq !== undefined) conds.push(gt(chatMessages.roomSeq, opts.afterSeq));

    const ascending = opts.afterSeq !== undefined;
    const rows = await tx
      .select(MESSAGE_COLUMNS)
      .from(chatMessages)
      .leftJoin(
        users,
        and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
      )
      .where(and(...conds))
      .orderBy(ascending ? asc(chatMessages.roomSeq) : desc(chatMessages.roomSeq))
      .limit(opts.limit);

    const mapped = rows.map((r) => ({ ...r, messageType: r.messageType as ChatMessageType }));
    return ascending ? mapped : mapped.reverse();
  }

  /** CHAT-API-013 — tin đã ghim còn hiệu lực (tin thu hồi rơi khỏi danh sách ghim). */
  async listPinned(tx: TenantTx, companyId: string, roomId: string): Promise<ChatMessageRow[]> {
    const rows = await tx
      .select(MESSAGE_COLUMNS)
      .from(chatMessages)
      .leftJoin(
        users,
        and(eq(users.id, chatMessages.senderId), eq(users.companyId, chatMessages.companyId)),
      )
      .where(
        and(
          eq(chatMessages.companyId, companyId),
          eq(chatMessages.roomId, roomId),
          isNotNull(chatMessages.pinnedAt),
          isNull(chatMessages.recalledAt),
        ),
      )
      .orderBy(desc(chatMessages.pinnedAt));
    return rows.map((r) => ({ ...r, messageType: r.messageType as ChatMessageType }));
  }

  async countPinned(tx: TenantTx, companyId: string, roomId: string): Promise<number> {
    const rows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.companyId, companyId),
          eq(chatMessages.roomId, roomId),
          isNotNull(chatMessages.pinnedAt),
          isNull(chatMessages.recalledAt),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  /** Tin được trả lời phải CÙNG PHÒNG và chưa thu hồi (CHAT-ERR-009). */
  async replyTargetIsValid(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    replyToMessageId: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.companyId, companyId),
          eq(chatMessages.id, replyToMessageId),
          eq(chatMessages.roomId, roomId),
          isNull(chatMessages.recalledAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Ghim/bỏ ghim — ĐÚNG 2 cột có column-GRANT (`0050:64`). Chạm cột khác là 42501. */
  async setPinned(
    tx: TenantTx,
    companyId: string,
    messageId: string,
    pin: { at: Date; by: string } | null,
  ): Promise<void> {
    await tx
      .update(chatMessages)
      .set({ pinnedAt: pin?.at ?? null, pinnedBy: pin?.by ?? null })
      .where(and(eq(chatMessages.companyId, companyId), eq(chatMessages.id, messageId)));
  }

  /**
   * Thu hồi — ĐÚNG 2 cột có column-GRANT (`0538:355`). `body` KHÔNG bị xoá: append-only giữ bản gốc cho
   * tranh chấp nội bộ (SPEC-15 §13.6); việc bỏ trắng là của tầng DTO, ở SERVER.
   */
  async setRecalled(
    tx: TenantTx,
    companyId: string,
    messageId: string,
    at: Date,
    by: string,
  ): Promise<void> {
    await tx
      .update(chatMessages)
      .set({ recalledAt: at, recalledBy: by })
      .where(and(eq(chatMessages.companyId, companyId), eq(chatMessages.id, messageId)));
  }

  /**
   * Gỡ tệp đính kèm của một tin đã thu hồi — **SOFT DELETE**. `file_links` chỉ có
   * `GRANT SELECT, INSERT, UPDATE` (`0433:182`); viết `tx.delete(fileLinks)` là 42501 lúc chạy, mà
   * typecheck và unit test đều mù.
   *
   * Link mất ⇒ `FilePolicyService` từ chối tải (SPEC-15 §13.6). v1 của BE-2 chưa có đường gắn tệp (đó là
   * `S7-CHAT-BE-3`) nên câu này chạy 0 hàng — viết sẵn để BE-3 không phải nhớ quay lại đây.
   */
  async unlinkMessageFiles(
    tx: TenantTx,
    companyId: string,
    messageId: string,
    at: Date,
  ): Promise<void> {
    await tx
      .update(fileLinks)
      .set({ deletedAt: at })
      .where(
        and(
          eq(fileLinks.companyId, companyId),
          eq(fileLinks.moduleCode, CHAT_MODULE_CODE),
          eq(fileLinks.entityType, "chat_message"),
          eq(fileLinks.entityId, messageId),
          isNull(fileLinks.deletedAt),
        ),
      );
  }

  /** Con trỏ đã đọc — `last_read_seq` nằm trong 6 cột UPDATE-được của `chat_room_members` (`0538:258`). */
  async setLastReadSeq(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    seq: number,
  ): Promise<void> {
    await tx
      .update(chatRoomMembers)
      .set({ lastReadSeq: seq, lastReadAt: new Date() })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)));
  }

  /**
   * CHAT-API-016 — tổng chưa đọc, MỘT truy vấn, bằng PHÉP TRỪ.
   *
   * KHÔNG `COUNT(*)` trên `chat_messages`: đó là bảng lớn nhất module, và đếm per-room là N+1 ngay trên
   * đường chạy mỗi lần đổi trang của FE (badge header). Bỏ phòng đã lưu trữ để con số khớp đúng danh
   * sách phòng mặc định — badge kêu vì một phòng người dùng không nhìn thấy là badge không tắt được.
   */
  async unreadTotals(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ total: number; rooms: number }> {
    const unread = sql<number>`greatest(0, coalesce(${chatRooms.lastMessageSeq}, 0) - ${chatRoomMembers.lastReadSeq})`;
    const rows = await tx
      .select({
        total: sql<number>`coalesce(sum(${unread}), 0)::int`,
        rooms: sql<number>`count(*) filter (where ${unread} > 0)::int`,
      })
      .from(chatRooms)
      .innerJoin(
        chatRoomMembers,
        and(
          eq(chatRoomMembers.roomId, chatRooms.id),
          eq(chatRoomMembers.companyId, chatRooms.companyId),
        ),
      )
      .where(
        and(
          eq(chatRooms.companyId, companyId),
          isNull(chatRooms.deletedAt),
          eq(chatRooms.isArchived, false),
          eq(chatRoomMembers.userId, userId),
          isNull(chatRoomMembers.leftAt),
        ),
      );
    return rows[0] ?? { total: 0, rooms: 0 };
  }

  /**
   * Lọc `mentions` xuống còn thành viên ĐANG hoạt động của phòng (CHAT-ERR-010: người ngoài phòng bị
   * loại khỏi danh sách, **không** chặn gửi và **không** sinh notification).
   */
  async filterMentionsToMembers(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await tx
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          isNull(chatRoomMembers.leftAt),
          or(...userIds.map((id) => eq(chatRoomMembers.userId, id))),
        ),
      );
    const allowed = new Set(rows.map((r) => r.userId));
    return userIds.filter((id) => allowed.has(id));
  }
}

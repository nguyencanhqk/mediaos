import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatMessageType } from "../db/schema/communication";
import { users } from "../db/schema/users";
import { unreadSeqExpr, visibleFromSeqScalar } from "./chat-visibility";

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

  /**
   * Tin theo id, kèm `senderName` — dùng để dựng DTO sau khi ghi. KHÔNG gate membership (caller lo).
   *
   * `visibleFromSeq` là THAM SỐ BẮT BUỘC, không optional: caller đã phải chạy `assertMessageAccess`
   * trước (không có đường nào khác lấy được `messageId` hợp lệ), nên nó luôn cầm sẵn giá trị — và bắt
   * buộc thì TypeScript chặn caller MỚI quên truyền, thay vì mặc định `null` = "cho xem tất cả" trong
   * im lặng (SPEC-15 §13.4).
   */
  async findMessageForDto(
    tx: TenantTx,
    companyId: string,
    messageId: string,
    visibleFromSeq: number | null,
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
          eq(chatMessages.id, messageId),
          visibleFromSeqScalar(visibleFromSeq),
        ),
      )
      .limit(1);
    return rows[0]
      ? { ...rows[0], messageType: rows[0].messageType as ChatMessageType }
      : undefined;
  }

  /**
   * Bản ghi đã gửi trước đó với cùng `clientMessageId` (idempotency — `uq_chat_messages_client_id`).
   *
   * CỐ Ý KHÔNG mang vị từ §13.4: đã bound `senderId = actor`, tin của chính mình không thể nằm trước
   * mốc mình vào phòng (xem `chat-visibility.ts`).
   */
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
   * Vị từ SPEC-15 §13.4 lấy từ `chat-visibility.ts` (bản sao DUY NHẤT), viết SẴN từ v1 dù cột luôn
   * NULL — thêm sau sẽ sót đường đọc, và GATE-2 đã chứng minh đúng điều đó: v1 chỉ hàm này có vị từ,
   * 5 đường đọc còn lại thì không.
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
    const visible = visibleFromSeqScalar(opts.visibleFromSeq);
    if (visible) conds.push(visible);
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

  /**
   * CHAT-API-013 — tin đã ghim còn hiệu lực (tin thu hồi rơi khỏi danh sách ghim).
   *
   * Mang vị từ §13.4: ghim là hành động của phòng, nhưng ĐỌC tin ghim vẫn là đọc tin. Thiếu nó thì
   * `/pinned` là cửa hậu đọc nguyên văn phần lịch sử mà `/messages` đã chặn — cùng một `MESSAGE_COLUMNS`,
   * cùng `body`, chỉ khác đường vào.
   */
  async listPinned(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    visibleFromSeq: number | null,
  ): Promise<ChatMessageRow[]> {
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
          visibleFromSeqScalar(visibleFromSeq),
        ),
      )
      .orderBy(desc(chatMessages.pinnedAt));
    return rows.map((r) => ({ ...r, messageType: r.messageType as ChatMessageType }));
  }

  /**
   * Đếm ghim cho trần 20 (CHAT-ERR-008).
   *
   * CỐ Ý KHÔNG mang vị từ §13.4 — trần là bất biến của PHÒNG, không của người đang nhìn. Lọc theo
   * `visible_from_seq` ở đây cho hai thành viên cùng phòng đếm ra hai số khác nhau ⇒ người vào sau
   * ghim vượt trần mà vẫn 200 (xem `chat-visibility.ts`).
   */
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

  /**
   * Tin được trả lời phải CÙNG PHÒNG, chưa thu hồi (CHAT-ERR-009) và **người trả lời phải nhìn thấy
   * được nó** (§13.4).
   *
   * Vế cuối là đường đọc gián tiếp: trích dẫn một tin nằm trước mốc `visible_from_seq` sẽ kéo nội dung
   * tin đó lên màn hình người không được xem, qua chính DTO của tin trả lời. Chặn ở đây thì người dùng
   * nhận CHAT-ERR-009 giống hệt ca "tin không tồn tại" — không có oracle nào cho biết tin đó có thật.
   */
  async replyTargetIsValid(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    replyToMessageId: string,
    visibleFromSeq: number | null,
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
          visibleFromSeqScalar(visibleFromSeq),
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

  /*
   * ⚠️ `unlinkMessageFiles` ĐÃ BỊ GỠ ở S7-CHAT-BE-3 (FULL gate) — ĐỪNG VIẾT LẠI.
   *
   * Nó soft-delete `file_links` trong tx thu hồi. Đo bằng probe trên DB thật: 0 link sống ⇒
   * `FilePolicyService.decideForLinkedFile` rơi vào nhánh `links.length === 0` ⇒ fallback
   * `FOUNDATION.FILE.DOWNLOAD` — cặp company-admin ĐANG giữ (bulk grant `0435`). Người ngoài phòng đo
   * được **403 trước** thu hồi và **302 sau** thu hồi ⇒ thao tác khắc phục lại MỞ RỘNG phạm vi tệp.
   *
   * Thay bằng: giữ link sống (tệp vẫn module-owned) + `ChatMessageFileResolver.canRead` từ chối khi
   * `recalled_at IS NOT NULL`. Xem jsdoc lớp của resolver, khối "VÌ SAO THU HỒI KHÔNG GỠ LINK".
   */

  /**
   * Con trỏ đã đọc — CHỈ TIẾN + kẹp trần, tính **TRONG CÂU UPDATE** (SPEC-15 §13.2 · plan BE-2 §1.6).
   * `last_read_seq` nằm trong 6 cột UPDATE-được của `chat_room_members` (`0538:258`).
   *
   * ⚠️ TUYỆT ĐỐI KHÔNG đọc-rồi-ghi ở tầng JS. `assertMember` chạy `SELECT` thường (không `FOR UPDATE`),
   * nên dưới READ COMMITTED hai thiết bị cùng `POST /read` đều đọc con trỏ CŨ rồi cùng gán đè: bên ghi
   * SAU thắng, kể cả khi nó mang số NHỎ HƠN. Kết quả là con trỏ LÙI — 200 cho cả hai, badge sáng lại
   * hàng chục tin đã đọc, không lỗi, không log. Đặt `GREATEST` vào chính câu UPDATE thì hàng bị khoá tại
   * chỗ và vế phải đọc bản đã commit của bên thắng ⇒ nguyên tử, không cần khoá tay.
   *
   * `LEAST(wanted, ceiling)` = trần `last_message_seq`: client không tự đẩy con trỏ vượt số tin thật để
   * "dọn" badge — cho vượt thì tin gửi SAU đó bị tính là đã đọc mà người dùng chưa hề thấy. Trần lấy từ
   * `assertMember` có thể cũ hơn thực tế một nhịp; kẹp bằng số cũ luôn AN TOÀN (chỉ tiến chậm hơn, không
   * bao giờ tiến quá).
   *
   * @returns con trỏ SAU khi ghi. Caller PHẢI dựng phản hồi từ số này — dùng lại số tính ở JS là trả về
   *   trạng thái mà DB không hề có.
   */
  async advanceLastReadSeq(
    tx: TenantTx,
    companyId: string,
    memberRowId: string,
    wanted: number,
    ceiling: number,
  ): Promise<number> {
    const rows = await tx
      .update(chatRoomMembers)
      .set({
        lastReadSeq: sql`GREATEST(${chatRoomMembers.lastReadSeq}, LEAST(${wanted}::int, ${ceiling}::int))`,
        lastReadAt: new Date(),
      })
      .where(and(eq(chatRoomMembers.companyId, companyId), eq(chatRoomMembers.id, memberRowId)))
      .returning({ seq: chatRoomMembers.lastReadSeq });
    return rows[0].seq;
  }

  /**
   * Khoá hàng phòng cho một chuỗi đọc-rồi-ghi ở phạm vi PHÒNG (trần ghim 20 — CHAT-ERR-008).
   *
   * `SELECT … FOR UPDATE` chứ KHÔNG mượn `allocateRoomSeq`: hàm kia tăng `last_message_seq`, mà `0539`
   * verify ép `room_seq` liên tục từ 1 trong mỗi phòng ⇒ mượn nó để lấy khoá là tự tạo lỗ số.
   *
   * Không khoá thì `countPinned` → `setPinned` là TOCTOU kinh điển: hai request ghim cùng lúc đều đọc
   * 19, đều ghim, phòng thành 21 tin ghim — cả hai 200, trần bị phá trong im lặng.
   */
  async lockRoom(tx: TenantTx, companyId: string, roomId: string): Promise<void> {
    await tx
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(and(eq(chatRooms.companyId, companyId), eq(chatRooms.id, roomId)))
      .for("update");
  }

  /**
   * CHAT-API-016 — tổng chưa đọc, MỘT truy vấn, bằng PHÉP TRỪ.
   *
   * KHÔNG `COUNT(*)` trên `chat_messages`: đó là bảng lớn nhất module, và đếm per-room là N+1 ngay trên
   * đường chạy mỗi lần đổi trang của FE (badge header). Bỏ phòng đã lưu trữ để con số khớp đúng danh
   * sách phòng mặc định — badge kêu vì một phòng người dùng không nhìn thấy là badge không tắt được.
   *
   * Công thức lấy từ `unreadSeqExpr()` — DÙNG CHUNG với `listRoomsForUser` (CHAT-API-001). Hai bản sao
   * của một công thức đếm là hai bản sao sẽ trôi, và badge header lệch badge từng phòng thì không ai
   * biết bên nào đúng.
   */
  async unreadTotals(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<{ total: number; rooms: number }> {
    const unread = unreadSeqExpr();
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

  // ─── S7-CHAT-BE-6 — hai truy vấn phục vụ PAYLOAD thông báo (APPEND, không đụng hàm nào ở trên) ───
  //
  // Cả hai KHÔNG phải cổng quyền: không 404, không quyết định ai đọc được gì. Chúng mirror đúng tính chất
  // của `filterMentionsToMembers` ngay trên — đọc `chat_room_members` cho mục đích AUDIENCE. Điểm khẳng
  // định membership vẫn là `ChatAccessService.assertMember` và vẫn là bản sao DUY NHẤT.

  /**
   * Tên hiển thị người gửi cho payload outbox.
   *
   * `users.email` là `NOT NULL` nên coalesce về email cho ra chuỗi KHÔNG BAO GIỜ rỗng — cần thế vì
   * `payloadOf` của bridge là hàm ĐỒNG BỘ, không query lại được, và template `{actor_name}` thiếu giá trị
   * sẽ render nguyên chuỗi `{actor_name}` vào thông báo gửi cho người dùng. Mirror
   * `task-comments.service.ts` (đọc lại row ngay sau insert để lấy `userName`, coalesce `email`).
   *
   * ⚠️ Dùng `.trim() ||` chứ KHÔNG dùng `??`: `users.full_name` là `text` NULLABLE **không có CHECK
   * non-empty** (ràng buộc `.min(1)` chỉ sống ở DTO admin), nên một hàng do import/backfill/seed tạo ra
   * có thể mang chuỗi RỖNG. Với `??` thì chuỗi rỗng đi lọt, `enqueueNotifications` gặp `if (!actorName)
   * return` và người đó **vĩnh viễn không sinh nổi một thông báo nào** — không lỗi, không log, không audit.
   */
  async findSenderDisplayName(
    tx: TenantTx,
    companyId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ fullName: users.fullName, email: users.email })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.id, userId)))
      .limit(1);
    if (!rows[0]) return null;
    return (rows[0].fullName ?? "").trim() || rows[0].email;
  }

  /**
   * Người CÒN hoạt động khác `excludeUserId` trong phòng — phòng `direct` luôn đúng 2 thành viên nên đây
   * là "người kia". Trả `null` khi người kia đã rời phòng (đua hiếm): caller bỏ qua enqueue thay vì gửi
   * cho một người không còn ở đó.
   *
   * `lastReadSeq` trả kèm để tính `unread_count` NGAY tại thời điểm enqueue — xem `enqueueNotifications`.
   *
   * `ORDER BY joined_at` chứ không `LIMIT 1` trần: hôm nay phòng `direct` luôn đúng 2 thành viên
   * (`assertManualMembership` chặn thêm người), nhưng nếu một WO sau hoặc job đối soát làm phòng có 3 hàng
   * active thì `LIMIT 1` không thứ tự trả về **một người tuỳ planner** — tức chỉ 1 trong N người nhận được
   * DM, im lặng và không tái hiện được. Thứ tự tường minh biến ca đó thành sai-ổn-định thay vì sai-ngẫu-nhiên.
   */
  async findDirectPeer(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    excludeUserId: string,
  ): Promise<{ userId: string; lastReadSeq: number } | null> {
    const rows = await tx
      .select({ userId: chatRoomMembers.userId, lastReadSeq: chatRoomMembers.lastReadSeq })
      .from(chatRoomMembers)
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          isNull(chatRoomMembers.leftAt),
          ne(chatRoomMembers.userId, excludeUserId),
        ),
      )
      .orderBy(asc(chatRoomMembers.joinedAt), asc(chatRoomMembers.userId))
      .limit(1);
    return rows[0] ?? null;
  }
}

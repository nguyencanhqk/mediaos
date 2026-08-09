import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatCalls, chatMessages, chatRoomMembers, chatRooms } from "../db/schema/communication";
import type {
  ChatCallKind,
  ChatCallStatus,
  ChatMemberRole,
  ChatMessageType,
  ChatRoomType,
} from "../db/schema/communication";
import { CHAT_ERR } from "./chat.errors";
import { visibleFromSeqColumn } from "./chat-visibility";

/** Phòng + tư cách thành viên của actor, lấy trong ĐÚNG MỘT truy vấn. */
export interface ChatRoomAccess {
  room: {
    id: string;
    companyId: string;
    refId: string | null;
    roomType: ChatRoomType;
    name: string | null;
    roomCode: string;
    description: string | null;
    isArchived: boolean;
    lastMessageAt: Date | null;
    lastMessageSeq: number | null;
    createdAt: Date;
  };
  membership: {
    id: string;
    userId: string;
    role: ChatMemberRole;
    lastReadSeq: number;
    /**
     * v1 LUÔN NULL (CHAT-DEC-008). Mọi truy vấn đọc tin PHẢI mang vị từ SPEC-15 §13.4 với nó — lấy từ
     * `chat-visibility.ts`, KHÔNG viết lại tay. Trường này có mặt ở đây chính là để caller truyền
     * xuống repo: hàm repo nào đọc `chat_messages` cũng nhận nó làm tham số BẮT BUỘC.
     */
    visibleFromSeq: number | null;
    joinedAt: Date;
    // ── S8-CHAT-UX-BE-1 — tuỳ chọn PER-USER (mig 0543 · muted_until có từ 0538) ──
    // Ở đây chứ không phải `room`: chúng thuộc hàng MEMBERSHIP, hai người cùng phòng có ba giá trị
    // khác nhau. Đặt nhầm sang `room` là biến tuỳ chọn cá nhân thành thuộc tính dùng chung.
    pinnedAt: Date | null;
    mutedUntil: Date | null;
    markedUnreadAt: Date | null;
  };
}

/** Tin nhắn + phòng + tư cách thành viên, lấy trong ĐÚNG MỘT truy vấn (S7-CHAT-BE-2). */
export interface ChatMessageAccess extends ChatRoomAccess {
  message: {
    id: string;
    companyId: string;
    roomId: string;
    senderId: string;
    messageType: ChatMessageType;
    roomSeq: number;
    pinnedAt: Date | null;
    recalledAt: Date | null;
    createdAt: Date;
  };
}

/** Cuộc gọi + phòng + tư cách thành viên, lấy trong ĐÚNG MỘT truy vấn (S7-CALL-BE-1). */
export interface ChatCallAccess extends ChatRoomAccess {
  call: {
    id: string;
    companyId: string;
    roomId: string;
    initiatorUserId: string;
    kind: ChatCallKind;
    status: ChatCallStatus;
    startedAt: Date;
    acceptedAt: Date | null;
    endedAt: Date | null;
  };
}

/**
 * S7-CHAT-BE-1 — `ChatAccessService`: ĐIỂM KHẲNG ĐỊNH MEMBERSHIP DUY NHẤT của module CHAT
 * (SPEC-15 §3.2 · API-13 §6.1).
 *
 * ┌─ VÌ SAO CÓ FILE NÀY ────────────────────────────────────────────────────────────────────────┐
 * │ CHAT **không** dùng thang data_scope `own/department/all` như HR/TASK/GOAL. Một nhân viên có │
 * │ thể nhắn riêng với giám đốc (ngoài phòng ban), và trưởng phòng KHÔNG được đọc tin nhắn riêng │
 * │ của nhân viên phòng mình dù data_scope là `department`. Ranh giới dữ liệu ở đây là THÀNH VIÊN │
 * │ PHÒNG, còn cặp quyền chỉ là cổng module ("được làm hành động gì"). Cả hai phải cùng đúng.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ BA BẤT BIẾN — vi phạm bất kỳ điều nào là mở lại lỗ, không phải "chọn cách khác":
 *
 * 1. **KHÔNG tham số/cờ nào bỏ qua membership.** Đường đọc-vượt của Super Admin (CHAT-DEC-004) là
 *    service + controller RIÊNG ở `S7-CHAT-BE-7`, path riêng `/chat/oversight/*`. Nhét một
 *    `if (isOversight)` vào đây là mất VĨNH VIỄN tính chất "đọc code là chứng minh được" của đường
 *    đọc thường (API-13 §5.3 ràng buộc 1) — từ đó về sau không ai đọc hàm này mà biết chắc nó chặn.
 *
 * 2. **404, KHÔNG phải 403** cho mọi lý do không-đọc-được. `403` xác nhận phòng CÓ tồn tại ⇒ ai cũng dò
 *    được sự tồn tại của mọi phòng bằng cách bắn roomId ngẫu nhiên (CHAT-ERR-001). Thông điệp là HẰNG
 *    dùng chung (`CHAT_ERR.ROOM_NOT_FOUND`) nên hai ca "phòng không tồn tại" và "phòng tồn tại mà mình
 *    không thuộc" trả về BYTE GIỐNG HỆT NHAU.
 *    ⚠️ Quy ước này NGƯỢC với `goals` (in-tenant ngoài phạm vi → 403, SPEC-10 §20.2). Copy nguyên khối
 *    từ `GoalAccessService` sang đây là mở oracle.
 *
 * 3. **Không nơi nào khác viết lại điều kiện membership.** `left_at IS NULL` + `deleted_at IS NULL` +
 *    `company_id` khớp nằm ĐÚNG trong truy vấn dưới. Bản sao thứ hai của luật quyền là bản sao sẽ trôi
 *    (bài học `module-closed-by-second-assert-not-scope`). Ca test 14 grep để chứng minh.
 */
@Injectable()
export class ChatAccessService {
  /**
   * Khẳng định actor ĐANG là thành viên hoạt động của phòng, trong ngữ cảnh tenant đã mở.
   *
   * Nhận `tx` chứ không tự mở `withTenant`: caller phải đọc-và-ghi-và-audit trong CÙNG một transaction
   * (audit ngoài tx nghiệp vụ là đường im lặng — lỗi ghi audit vẫn commit thay đổi).
   *
   * @throws NotFoundException (404) khi BẤT KỲ điều nào dưới đây đúng — không phân biệt được với nhau:
   *   phòng không tồn tại · phòng thuộc tenant khác · phòng đã xoá mềm · actor chưa từng là thành viên ·
   *   actor đã rời (`left_at IS NOT NULL`).
   */
  async assertMember(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    actorUserId: string,
  ): Promise<ChatRoomAccess> {
    const rows = await tx
      .select({
        roomId: chatRooms.id,
        roomCompanyId: chatRooms.companyId,
        refId: chatRooms.refId,
        roomType: chatRooms.roomType,
        name: chatRooms.name,
        roomCode: chatRooms.roomCode,
        description: chatRooms.description,
        isArchived: chatRooms.isArchived,
        lastMessageAt: chatRooms.lastMessageAt,
        lastMessageSeq: chatRooms.lastMessageSeq,
        createdAt: chatRooms.createdAt,
        memberId: chatRoomMembers.id,
        memberUserId: chatRoomMembers.userId,
        memberRole: chatRoomMembers.role,
        lastReadSeq: chatRoomMembers.lastReadSeq,
        visibleFromSeq: chatRoomMembers.visibleFromSeq,
        joinedAt: chatRoomMembers.joinedAt,
        pinnedAt: chatRoomMembers.pinnedAt,
        mutedUntil: chatRoomMembers.mutedUntil,
        markedUnreadAt: chatRoomMembers.markedUnreadAt,
      })
      .from(chatRooms)
      .innerJoin(chatRoomMembers, this.activeMembershipJoin(actorUserId))
      .where(and(eq(chatRooms.id, roomId), this.visibleRoom(companyId)))
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND);

    return {
      room: {
        id: row.roomId,
        companyId: row.roomCompanyId,
        refId: row.refId,
        roomType: row.roomType as ChatRoomType,
        name: row.name,
        roomCode: row.roomCode,
        description: row.description,
        isArchived: row.isArchived,
        lastMessageAt: row.lastMessageAt,
        lastMessageSeq: row.lastMessageSeq,
        createdAt: row.createdAt,
      },
      membership: {
        id: row.memberId,
        userId: row.memberUserId,
        role: row.memberRole as ChatMemberRole,
        lastReadSeq: row.lastReadSeq,
        visibleFromSeq: row.visibleFromSeq,
        joinedAt: row.joinedAt,
        pinnedAt: row.pinnedAt,
        mutedUntil: row.mutedUntil,
        markedUnreadAt: row.markedUnreadAt,
      },
    };
  }

  /**
   * Vai trò quản trị TRONG phòng. HÀM THUẦN — không truy vấn, chỉ đọc kết quả `assertMember` đã trả.
   * Vì thế nó KHÔNG phải "điểm khẳng định membership thứ hai": không gọi `assertMember` trước thì không
   * có `access` để truyền vào đây.
   *
   * 403 (không phải 404) là ĐÚNG ở đây: actor đã là thành viên nên đã biết phòng tồn tại — giấu thêm
   * không che được gì, mà lại làm người dùng không hiểu vì sao nút bấm không ăn.
   */
  requireRoomAdmin(access: ChatRoomAccess): void {
    if (!this.isRoomAdmin(access)) {
      throw new ForbiddenException(CHAT_ERR.NOT_ROOM_ADMIN);
    }
  }

  /**
   * S8-CHAT-UX-BE-2 — vị từ THUẦN "actor là quản trị viên của phòng này", tách khỏi việc NÉM.
   *
   * VÌ SAO tách: SPEC-15 §12 cấp **hai mã khác nhau** cho cùng một vị từ. Đường thao tác phòng/tin
   * dùng `CHAT-ERR-001` (vế 403); đường avatar (§11b) dùng `CHAT-ERR-023`, vì ở đó "không đủ tư cách"
   * phải KHÔNG phân biệt được giữa `group` (thiếu vai trò admin phòng), `department` (thiếu
   * `update:org_unit` hoặc sai đơn vị neo) và `project` (không phải Owner/Manager) — ba lý do một
   * thông điệp, nếu không thông điệp lỗi lại vẽ ra bản đồ quyền.
   *
   * `requireRoomAdmin` gọi CHÍNH hàm này ⇒ vẫn đúng MỘT bản sao của vị từ; chỉ mã lỗi là của caller.
   */
  isRoomAdmin(access: ChatRoomAccess): boolean {
    return access.membership.role === "admin";
  }

  /**
   * Quyền GHIM trong phòng (CHAT-API-012a/b). = admin phòng **HOẶC** phòng `direct`.
   *
   * ⚠️ Vế `direct` KHÔNG phải nới lỏng cho tiện — thiếu nó thì ghim là tính năng CHẾT trong DM: thành
   * viên DM luôn được insert `role:'member'` (`ChatRoomsService.openDirect`) và `assertManualMembership`
   * chặn đổi vai trò trên phòng `direct` ⇒ một DM KHÔNG BAO GIỜ có admin ⇒ `/pin` luôn 403 và
   * `/pinned` luôn rỗng, trong khi SPEC-15 CHAT-SCREEN-004 vẽ "tin đã ghim" cho MỌI loại phòng.
   *
   * An toàn vì DM đúng 2 người ngang vai, hành động đảo ngược được, và trần 20 vẫn áp. Vẫn phải qua
   * `assertMessageAccess` trước — đây là hàm THUẦN trên kết quả đó, không phải điểm khẳng định thứ hai.
   */
  requirePinAuthority(access: ChatRoomAccess): void {
    if (access.room.roomType === "direct") return;
    this.requireRoomAdmin(access);
  }

  /**
   * S7-CHAT-BE-2 — cửa vào cho 3 route nhận `messageId` thay vì `roomId` (thu hồi · ghim · bỏ ghim).
   *
   * ⚠️ VÌ SAO KHÔNG viết `findMessage()` rồi `assertMember(msg.roomId)`: hai bước ⇒ hai thông điệp lỗi
   * khác nhau ("tin không tồn tại" vs "phòng không tìm thấy") ⇒ bắn `messageId` ngẫu nhiên là **dò được
   * tin nào có thật** trong toàn công ty. Đúng lớp oracle mà CHAT-ERR-001 dựng 404 để chặn, chỉ đổi trục
   * từ *phòng* sang *tin*. Ở đây: MỘT truy vấn, MỘT hằng thông điệp cho MỌI lý do.
   *
   * Vị từ membership tái dùng ĐÚNG hai helper của `assertMember` — không có bản sao thứ hai của luật.
   *
   * ⚠️ Hàm này là cửa vào của THU HỒI · GHIM · BỎ GHIM — ba thao tác GHI. Vị từ §13.4 ở đây vì thế
   * không chỉ chặn đọc: thiếu nó, một thành viên có `visible_from_seq` sẽ ghim/thu hồi được tin nằm
   * trước mốc mình vào phòng, và tin đó nhảy lên `/pinned` của **cả phòng**. Dùng dạng CỘT
   * (`visibleFromSeqColumn`) chứ không dạng scalar: truy vấn này lấy membership và tin trong CÙNG một
   * câu nên chưa có giá trị nào ở JS để truyền vào — đó là điểm khác biệt duy nhất, luật vẫn là một.
   *
   * @throws NotFoundException (404) khi: tin không tồn tại · tin của tenant khác · phòng chứa tin đã xoá
   *   mềm · actor không phải thành viên phòng đó · actor đã rời · tin nằm TRƯỚC `visible_from_seq` của
   *   actor (SPEC-15 §13.4) — tất cả trả về BYTE GIỐNG HỆT NHAU.
   */
  async assertMessageAccess(
    tx: TenantTx,
    companyId: string,
    messageId: string,
    actorUserId: string,
  ): Promise<ChatMessageAccess> {
    const rows = await tx
      .select({
        messageId: chatMessages.id,
        messageCompanyId: chatMessages.companyId,
        messageRoomId: chatMessages.roomId,
        senderId: chatMessages.senderId,
        messageType: chatMessages.messageType,
        messageRoomSeq: chatMessages.roomSeq,
        messagePinnedAt: chatMessages.pinnedAt,
        messageRecalledAt: chatMessages.recalledAt,
        messageCreatedAt: chatMessages.createdAt,
        roomId: chatRooms.id,
        roomCompanyId: chatRooms.companyId,
        refId: chatRooms.refId,
        roomType: chatRooms.roomType,
        name: chatRooms.name,
        roomCode: chatRooms.roomCode,
        description: chatRooms.description,
        isArchived: chatRooms.isArchived,
        lastMessageAt: chatRooms.lastMessageAt,
        lastMessageSeq: chatRooms.lastMessageSeq,
        createdAt: chatRooms.createdAt,
        memberId: chatRoomMembers.id,
        memberUserId: chatRoomMembers.userId,
        memberRole: chatRoomMembers.role,
        lastReadSeq: chatRoomMembers.lastReadSeq,
        visibleFromSeq: chatRoomMembers.visibleFromSeq,
        joinedAt: chatRoomMembers.joinedAt,
        pinnedAt: chatRoomMembers.pinnedAt,
        mutedUntil: chatRoomMembers.mutedUntil,
        markedUnreadAt: chatRoomMembers.markedUnreadAt,
      })
      .from(chatMessages)
      .innerJoin(
        chatRooms,
        and(eq(chatRooms.id, chatMessages.roomId), eq(chatRooms.companyId, chatMessages.companyId)),
      )
      .innerJoin(chatRoomMembers, this.activeMembershipJoin(actorUserId))
      .where(
        and(
          eq(chatMessages.id, messageId),
          eq(chatMessages.companyId, companyId),
          this.visibleRoom(companyId),
          visibleFromSeqColumn(),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException(CHAT_ERR.MESSAGE_NOT_FOUND);

    return {
      message: {
        id: row.messageId,
        companyId: row.messageCompanyId,
        roomId: row.messageRoomId,
        senderId: row.senderId,
        messageType: row.messageType as ChatMessageType,
        roomSeq: row.messageRoomSeq,
        pinnedAt: row.messagePinnedAt,
        recalledAt: row.messageRecalledAt,
        createdAt: row.messageCreatedAt,
      },
      room: {
        id: row.roomId,
        companyId: row.roomCompanyId,
        refId: row.refId,
        roomType: row.roomType as ChatRoomType,
        name: row.name,
        roomCode: row.roomCode,
        description: row.description,
        isArchived: row.isArchived,
        lastMessageAt: row.lastMessageAt,
        lastMessageSeq: row.lastMessageSeq,
        createdAt: row.createdAt,
      },
      membership: {
        id: row.memberId,
        userId: row.memberUserId,
        role: row.memberRole as ChatMemberRole,
        lastReadSeq: row.lastReadSeq,
        visibleFromSeq: row.visibleFromSeq,
        joinedAt: row.joinedAt,
        pinnedAt: row.pinnedAt,
        mutedUntil: row.mutedUntil,
        markedUnreadAt: row.markedUnreadAt,
      },
    };
  }

  /**
   * S7-CALL-BE-1 — cửa vào cho 5 route vòng đời nhận `callId` thay vì `roomId` (nhận · từ chối · huỷ ·
   * kết thúc). Trục THỨ BA của cùng một luật, sau `roomId` và `messageId`.
   *
   * ⚠️ VÌ SAO KHÔNG `findCall()` rồi `assertMember(call.roomId)`: hai bước ⇒ hai thông điệp lỗi khác nhau
   * ("cuộc gọi không tồn tại" vs "không tìm thấy phòng") ⇒ bắn `callId` ngẫu nhiên là **dò được cuộc gọi
   * nào có thật** trong toàn công ty, và tệ hơn — dò được phòng nào ĐANG có người gọi nhau. Ở đây: MỘT
   * truy vấn, MỘT hằng thông điệp cho MỌI lý do.
   *
   * ⚠️ **KHÔNG có tham số nào bỏ qua membership**, kể cả cho `('view','chat-oversight')` (SPEC-15 §5.1c):
   * đọc-vượt không mở cửa nghe cuộc gọi. Không có `/chat/oversight/calls` và không được thêm.
   *
   * Vị từ membership tái dùng ĐÚNG hai helper bên dưới — không có bản sao thứ hai của luật.
   *
   * ⚠️ **Không** mang vị từ `visibleFromSeqColumn()` (§13.4) — cố ý, và đây là điểm KHÁC
   * `assertMessageAccess`: §13.4 nói về việc thấy LỊCH SỬ TIN trước mốc mình vào phòng. Một cuộc gọi
   * `ringing` **đang diễn ra bây giờ** không phải lịch sử; áp vế đó vào đây sẽ khoá người mới vào phòng
   * khỏi chính cuộc gọi vừa mời họ.
   *
   * @throws NotFoundException (404 · `CALL_NOT_FOUND`) khi: cuộc gọi không tồn tại · thuộc tenant khác ·
   *   phòng chứa nó đã xoá mềm · actor không phải thành viên phòng đó · actor đã rời — tất cả trả về BYTE
   *   GIỐNG HỆT NHAU.
   */
  async assertCallAccess(
    tx: TenantTx,
    companyId: string,
    callId: string,
    actorUserId: string,
  ): Promise<ChatCallAccess> {
    const rows = await tx
      .select({
        callId: chatCalls.id,
        callCompanyId: chatCalls.companyId,
        callRoomId: chatCalls.roomId,
        initiatorUserId: chatCalls.initiatorUserId,
        kind: chatCalls.kind,
        status: chatCalls.status,
        startedAt: chatCalls.startedAt,
        acceptedAt: chatCalls.acceptedAt,
        endedAt: chatCalls.endedAt,
        roomId: chatRooms.id,
        roomCompanyId: chatRooms.companyId,
        refId: chatRooms.refId,
        roomType: chatRooms.roomType,
        name: chatRooms.name,
        roomCode: chatRooms.roomCode,
        description: chatRooms.description,
        isArchived: chatRooms.isArchived,
        lastMessageAt: chatRooms.lastMessageAt,
        lastMessageSeq: chatRooms.lastMessageSeq,
        createdAt: chatRooms.createdAt,
        memberId: chatRoomMembers.id,
        memberUserId: chatRoomMembers.userId,
        memberRole: chatRoomMembers.role,
        lastReadSeq: chatRoomMembers.lastReadSeq,
        visibleFromSeq: chatRoomMembers.visibleFromSeq,
        joinedAt: chatRoomMembers.joinedAt,
        pinnedAt: chatRoomMembers.pinnedAt,
        mutedUntil: chatRoomMembers.mutedUntil,
        markedUnreadAt: chatRoomMembers.markedUnreadAt,
      })
      .from(chatCalls)
      // Vế nối CUỘC GỌI ↔ PHÒNG (id + company_id) — thiếu nó là tích Descartes, cùng bẫy đã ghi ở
      // `messageReadConditions` mục 1.
      .innerJoin(
        chatRooms,
        and(eq(chatRooms.id, chatCalls.roomId), eq(chatRooms.companyId, chatCalls.companyId)),
      )
      .innerJoin(chatRoomMembers, this.activeMembershipJoin(actorUserId))
      .where(
        and(
          eq(chatCalls.id, callId),
          eq(chatCalls.companyId, companyId),
          this.visibleRoom(companyId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) throw new NotFoundException(CHAT_ERR.CALL_NOT_FOUND);

    return {
      call: {
        id: row.callId,
        companyId: row.callCompanyId,
        roomId: row.callRoomId,
        initiatorUserId: row.initiatorUserId,
        kind: row.kind as ChatCallKind,
        status: row.status as ChatCallStatus,
        startedAt: row.startedAt,
        acceptedAt: row.acceptedAt,
        endedAt: row.endedAt,
      },
      room: {
        id: row.roomId,
        companyId: row.roomCompanyId,
        refId: row.refId,
        roomType: row.roomType as ChatRoomType,
        name: row.name,
        roomCode: row.roomCode,
        description: row.description,
        isArchived: row.isArchived,
        lastMessageAt: row.lastMessageAt,
        lastMessageSeq: row.lastMessageSeq,
        createdAt: row.createdAt,
      },
      membership: {
        id: row.memberId,
        userId: row.memberUserId,
        role: row.memberRole as ChatMemberRole,
        lastReadSeq: row.lastReadSeq,
        visibleFromSeq: row.visibleFromSeq,
        joinedAt: row.joinedAt,
        pinnedAt: row.pinnedAt,
        mutedUntil: row.mutedUntil,
        markedUnreadAt: row.markedUnreadAt,
      },
    };
  }

  // ─── vị từ dùng chung — BẢN SAO DUY NHẤT của luật truy cập ────────────────────

  /**
   * `actor` là thành viên ĐANG hoạt động của phòng đang join.
   *
   * `company_id` ở CẢ HAI vế: RLS đã ép, viết tường minh là defense-in-depth — và nó là vế duy nhất chặn
   * một hàng membership của tenant khác ghép vào phòng của tenant này nếu ngữ cảnh GUC bị đặt sai.
   *
   * ⚠️ Cả hai điểm khẳng định gọi ĐÚNG helper này. Inline lại nó ở nơi thứ ba là dựng bản sao của luật
   * quyền — bản sao sẽ trôi (`module-closed-by-second-assert-not-scope`).
   */
  private activeMembershipJoin(actorUserId: string): SQL {
    return and(
      eq(chatRoomMembers.roomId, chatRooms.id),
      eq(chatRoomMembers.companyId, chatRooms.companyId),
      eq(chatRoomMembers.userId, actorUserId),
      isNull(chatRoomMembers.leftAt),
    ) as SQL;
  }

  /** Phòng còn sống trong tenant này (chưa xoá mềm). */
  private visibleRoom(companyId: string): SQL {
    return and(eq(chatRooms.companyId, companyId), isNull(chatRooms.deletedAt)) as SQL;
  }

  /**
   * S7-CHAT-BE-4 — **NGUYÊN BỘ** điều kiện cho một truy vấn đọc `chat_messages` TRẢI NHIỀU PHÒNG, tức
   * đường mà `assertMember` **không dùng được** vì nó không biết trước tập phòng.
   *
   * ┌─ ĐÂY LÀ NGOẠI LỆ DUY NHẤT CỦA "ĐIỂM KHẲNG ĐỊNH MEMBERSHIP DUY NHẤT" ───────────────────────────┐
   * │ Mọi đường đọc khác của module bó theo MỘT `roomId` đã đi qua `assertMember`/`assertMessageAccess`│
   * │ Tìm kiếm (`GET /chat/search`) thì quét toàn bộ `chat_messages` của tenant rồi mới lọc — sai một │
   * │ vế là rò nguyên nội dung công ty, và rò IM LẶNG (HTTP 200, kết quả trông hợp lý).               │
   * │                                                                                                 │
   * │ Vì vậy hàm trả **cả bộ**, không phải từng núm rời. Trả rời (`activeMembershipJoin` +            │
   * │ `visibleRoom`) là để lọt một hiện thực rất tự nhiên:                                            │
   * │   `.from(chatMessages).innerJoin(chatRooms, access.visibleRoom(companyId))`                     │
   * │ — SQL HỢP LỆ, chạy được, và là **TÍCH DESCARTES** giữa mọi tin của tenant với mọi phòng actor là │
   * │ thành viên. Nó còn trả `roomId`/`roomName` SAI kèm theo. Một test đếm "có đủ các vế membership" │
   * │ vẫn PASS trên chính truy vấn hỏng đó, vì vế thiếu là vế NỐI TIN↔PHÒNG chứ không phải vế quyền.  │
   * │                                                                                                 │
   * │ Trả cả bộ làm cho **không ai dùng được nửa luật**.                                              │
   * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * Caller PHẢI join đủ ba bảng: `.from(chatMessages).innerJoin(chatRooms, …).innerJoin(chatRoomMembers, …)`
   * — thứ tự join không quan trọng, các vế dưới đây đã ràng buộc đủ quan hệ.
   *
   * Năm vế, thiếu vế nào cũng là LỖ (không phải cơ hội tối ưu):
   *
   * | # | Vế | Thiếu nó thì |
   * | - | --- | --- |
   * | 1 | tin ↔ phòng (id + company_id) | tích Descartes — rò toàn bộ nội dung tenant |
   * | 2 | phòng ↔ membership (room_id + company_id) | ghép membership của phòng khác |
   * | 3 | `user_id = actor` + `left_at IS NULL` | đọc phòng mình không thuộc / đã rời |
   * | 4 | `chat_rooms.deleted_at IS NULL` | phòng đã xoá mềm vẫn tìm ra được |
   * | 5 | `visibleFromSeqColumn()` (§13.4) | lịch sử trước mốc mình vào phòng |
   *
   * `company_id` xuất hiện **4 lần** (một lần mỗi bảng + hai lần bắc cầu): RLS đã ép, viết tường minh là
   * defense-in-depth và là vế duy nhất chặn ghép chéo tenant nếu GUC bị đặt sai (CLAUDE.md §2 mục 1).
   *
   * ⚠️ Hàm này **KHÔNG** thay `assertMember`. Đường có `roomId` chỉ định vẫn phải gọi `assertMember` để
   * có đúng 404 `ROOM_NOT_FOUND`, rồi THÊM `eq(chatMessages.roomId, roomId)` vào cùng truy vấn này.
   */
  messageReadConditions(companyId: string, actorUserId: string): SQL[] {
    return [
      // 1 — tin ↔ phòng. VẾ HAY BỊ QUÊN NHẤT; thiếu nó là tích Descartes.
      eq(chatRooms.id, chatMessages.roomId),
      eq(chatRooms.companyId, chatMessages.companyId),
      // 2 + 3 — membership đang hoạt động của actor trên phòng đó.
      this.activeMembershipJoin(actorUserId),
      // 4 — phòng còn sống trong tenant này.
      this.visibleRoom(companyId),
      // company_id của chính bảng tin (vế thứ tư của `company_id`, không suy ra từ bắc cầu).
      eq(chatMessages.companyId, companyId),
      // 5 — SPEC-15 §13.4, bản sao DUY NHẤT ở `chat-visibility.ts`.
      visibleFromSeqColumn(),
    ];
  }
}

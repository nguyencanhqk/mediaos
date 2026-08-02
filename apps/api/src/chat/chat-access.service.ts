import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatRoomMembers, chatRooms } from "../db/schema/communication";
import type { ChatMemberRole, ChatRoomType } from "../db/schema/communication";
import { CHAT_ERR } from "./chat.errors";

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
    joinedAt: Date;
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
        joinedAt: chatRoomMembers.joinedAt,
      })
      .from(chatRooms)
      .innerJoin(
        chatRoomMembers,
        and(
          eq(chatRoomMembers.roomId, chatRooms.id),
          // company_id ở CẢ HAI vế của join: RLS đã ép, viết tường minh là defense-in-depth — và nó là
          // vế duy nhất chặn việc một hàng membership của tenant khác ghép vào phòng của tenant này nếu
          // ngữ cảnh GUC có bao giờ bị đặt sai.
          eq(chatRoomMembers.companyId, chatRooms.companyId),
          eq(chatRoomMembers.userId, actorUserId),
          isNull(chatRoomMembers.leftAt),
        ),
      )
      .where(
        and(
          eq(chatRooms.id, roomId),
          eq(chatRooms.companyId, companyId),
          isNull(chatRooms.deletedAt),
        ),
      )
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
        joinedAt: row.joinedAt,
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
    if (access.membership.role !== "admin") {
      throw new ForbiddenException(CHAT_ERR.NOT_ROOM_ADMIN);
    }
  }
}

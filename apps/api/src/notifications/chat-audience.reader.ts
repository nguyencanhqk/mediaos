import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatRoomMembers, chatRooms } from "../db/schema/communication";

/**
 * S7-CHAT-BE-6 — đọc AUDIENCE của thông báo CHAT (SPEC-15 §17). Sống ở `notifications/**` và đọc THẲNG
 * bảng Drizzle, **KHÔNG** import `ChatModule` — mirror 5/5 tiền lệ (`LeaveApproverReader`,
 * `AttApprovalAudienceReader`, `GoalAudienceReader`…). Giữ đồ thị module acyclic: producer (enqueue) sống
 * trong `chat/**`, consumer (audience + render) sống ở đây.
 *
 * ⚠️ **Đây KHÔNG phải điểm khẳng định membership.** Cổng quyền của module CHAT là
 * `ChatAccessService.assertMember` và nó vẫn là bản sao DUY NHẤT — file này không 404, không quyết định ai
 * ĐỌC ĐƯỢC gì. Nó chỉ trả lời một câu hẹp hơn: "ai còn NHẬN thông báo của phòng này". Hai câu hỏi khác
 * nhau, và trộn chúng là cách một hệ thống có hai luật quyền mà không ai để ý.
 */
@Injectable()
export class ChatAudienceReader {
  /**
   * Điều kiện "còn nhận được thông báo" — **một chỗ duy nhất**, dùng chung cả hai hàm dưới.
   *
   * Bốn vế, mỗi vế có lý do riêng:
   *   • `left_at IS NULL`            — đã rời phòng thì không nhận nữa (vế hiển nhiên);
   *   • `rooms.deleted_at IS NULL`   — defense-in-depth;
   *   • `rooms.is_archived = false`  — như trên;
   *   • `muted_until`                — CHAT-DEC-013: gửi MỌI DM trừ khi người dùng tự tắt. Sau khi bỏ điều
   *     kiện presence ở v1, đây là lớp chống-ồn DUY NHẤT do người dùng điều khiển.
   *
   * Hai vế giữa là defense-in-depth THẬT, không phải trang trí: `sendMessage` đã chặn gửi vào phòng lưu trữ
   * (409) nên đường HTTP không bao giờ tới đây với phòng archived — nhưng bridge tiêu thụ outbox event
   * DURABLE, có thể được re-consume rất lâu sau khi phòng bị đóng/xoá. Tin vào "producer luôn đúng" là đặt
   * cược vào thứ nằm ngoài file này.
   */
  private stillReceiving(): SQL {
    return and(
      isNull(chatRoomMembers.leftAt),
      isNull(chatRooms.deletedAt),
      eq(chatRooms.isArchived, false),
      or(isNull(chatRoomMembers.mutedUntil), lte(chatRoomMembers.mutedUntil, sql`now()`)),
    ) as SQL;
  }

  /**
   * Người được nhắc tên CÒN nhận được thông báo, trong phòng KHÔNG phải `direct`.
   *
   * `candidateUserIds` đã được producer lọc qua `filterMentionsToMembers`; lọc lại ở đây là CỐ Ý — payload
   * outbox là dữ liệu bền, và giữa lúc enqueue và lúc consume người đó có thể đã rời phòng hoặc bật mute.
   */
  async resolveMentionRecipients(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    candidateUserIds: string[],
  ): Promise<string[]> {
    if (candidateUserIds.length === 0) return [];
    const rows = await tx
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .innerJoin(
        chatRooms,
        and(
          eq(chatRooms.id, chatRoomMembers.roomId),
          eq(chatRooms.companyId, chatRoomMembers.companyId),
        ),
      )
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRooms.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          inArray(chatRoomMembers.userId, candidateUserIds),
          // Mention là khái niệm của phòng nhiều người; phòng `direct` đi qua mã sự kiện KHÁC. Vế này
          // chặn một payload bị wire nhầm biến DM thành CHAT_MENTIONED.
          ne(chatRooms.roomType, "direct"),
          this.stillReceiving(),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /** Người nhận DM — xác nhận lại họ vẫn ở trong phòng `direct` đó và chưa tắt thông báo. */
  async resolveDirectRecipient(
    tx: TenantTx,
    companyId: string,
    roomId: string,
    recipientUserId: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({ userId: chatRoomMembers.userId })
      .from(chatRoomMembers)
      .innerJoin(
        chatRooms,
        and(
          eq(chatRooms.id, chatRoomMembers.roomId),
          eq(chatRooms.companyId, chatRoomMembers.companyId),
        ),
      )
      .where(
        and(
          eq(chatRoomMembers.companyId, companyId),
          eq(chatRooms.companyId, companyId),
          eq(chatRoomMembers.roomId, roomId),
          eq(chatRoomMembers.userId, recipientUserId),
          eq(chatRooms.roomType, "direct"),
          this.stillReceiving(),
        ),
      )
      .limit(1);
    return rows.map((r) => r.userId);
  }
}

import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { chatMessages, chatRoomMembers } from "../db/schema/communication";
import { visibleFromSeqColumn } from "./chat-visibility";

/**
 * S20-CHAT-MENTIONPIN-1 — số tin CHƯA ĐỌC có @nhắc CHÍNH người gọi, theo từng phòng (US-CHAT-NV-07 ·
 * CHAT-FUNC-014). Nguồn của `chatRoomSchema.mentionUnreadCount` trên đường danh sách (CHAT-API-001).
 *
 * Tách khỏi `chat-rooms.repository.ts` vì file đó đã quá trần 800 dòng; luật đếm sống ở ĐÚNG một chỗ.
 *
 * ══ BẤT BIẾN ══
 *   • **ĐÚNG MỘT truy vấn cho cả trang** — `GROUP BY room_id` trên tập `roomIds`, không N+1.
 *   • **Chỉ membership của chính người gọi**: vế `chat_room_members.user_id = :userId AND left_at IS
 *     NULL` là gốc của câu; tin chỉ được join qua hàng membership đó. `roomIds` lạ (phòng người gọi
 *     không thuộc, phòng của tenant khác) ⇒ không có hàng membership ⇒ không có số — không lỗi, không lộ.
 *   • `company_id` khớp ở CẢ HAI bảng; RLS + FORCE vẫn là hàng rào cuối (`withTenant` của caller).
 *   • Chưa đọc = `room_seq > last_read_seq` (hệ `room_seq` per-room, mig 0539) **và** vị từ §13.4
 *     `visibleFromSeqColumn()` — một đường đọc `chat_messages` mới không được thoát luật «lịch sử trước khi
 *     tham gia» (census ở `chat-visibility.spec.ts`).
 *   • Tin ĐÃ THU HỒI không tính (`recalled_at IS NULL`): thu hồi là xoá khỏi tầm nhìn, một dấu «@» trỏ
 *     vào tin không còn đọc được là dấu chết.
 *   • Tin của CHÍNH người gọi không tính: «có người @nhắc tôi» — tự nhắc mình không phải tín hiệu.
 *
 * Kết quả CHỈ là con số của người gọi — không id người được nhắc nào khác rời server qua đường này.
 *
 * Hiệu năng: mỗi phòng là một lần dò dải `room_seq > last_read_seq` trên
 * `idx_chat_messages_room_seq (company_id, room_id, room_seq DESC)` — chi phí tỉ lệ với số tin CHƯA ĐỌC,
 * không với tổng lịch sử. Vế `mentions @> …` lọc trên dải đó nên KHÔNG cần index GIN ở quy mô hiện tại
 * (đo EXPLAIN trong `s20-chat-mention-pin.int-spec.ts`).
 */
export function unreadMentionCountQuery(
  tx: TenantTx,
  companyId: string,
  userId: string,
  roomIds: readonly string[],
) {
  return tx
    .select({
      roomId: chatRoomMembers.roomId,
      count: sql<number>`count(*)::int`,
    })
    .from(chatRoomMembers)
    .innerJoin(
      chatMessages,
      and(
        eq(chatMessages.companyId, chatRoomMembers.companyId),
        eq(chatMessages.roomId, chatRoomMembers.roomId),
        gt(chatMessages.roomSeq, chatRoomMembers.lastReadSeq),
        visibleFromSeqColumn(),
        isNull(chatMessages.recalledAt),
        ne(chatMessages.senderId, chatRoomMembers.userId),
        // `jsonb @> jsonb_build_array(text)` — tham số BIND, không nội suy chuỗi vào SQL.
        sql`${chatMessages.mentions} @> jsonb_build_array(${userId}::text)`,
      ),
    )
    .where(
      and(
        eq(chatRoomMembers.companyId, companyId),
        eq(chatRoomMembers.userId, userId),
        isNull(chatRoomMembers.leftAt),
        inArray(chatRoomMembers.roomId, [...roomIds]),
      ),
    )
    .groupBy(chatRoomMembers.roomId);
}

/**
 * Bản đồ `roomId → số @ chưa đọc`. Phòng KHÔNG có trong bản đồ = 0 (caller tự điền `?? 0`).
 * `roomIds` rỗng ⇒ không chạm DB (`IN ()` là lỗi cú pháp, và không có gì để đếm).
 */
export async function countUnreadMentionsByRoom(
  tx: TenantTx,
  companyId: string,
  userId: string,
  roomIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (roomIds.length === 0) return counts;
  const rows = await unreadMentionCountQuery(tx, companyId, userId, roomIds);
  for (const row of rows) counts.set(row.roomId, Number(row.count));
  return counts;
}

import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ChatReactionEmoji } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { chatMessageReactions } from "../db/schema/communication";

/** Một dòng tổng hợp: `(messageId, emoji)` → số lượt + người gọi có thả hay không. */
export interface ChatReactionAggregateRow {
  messageId: string;
  emoji: ChatReactionEmoji;
  count: number;
  mine: boolean;
}

/**
 * S8-CHAT-UX-BE-3 — data-access `chat_message_reactions` (mig `0543` khối D).
 *
 * ⚠️ QUYỀN GHI Ở DB — đọc trước khi thêm câu lệnh nào:
 *   • quyền cấp bảng = **ĐÚNG `{SELECT, INSERT, DELETE}`** (khối VERIFY `0543` mục (E)(6) pin bằng `=`).
 *     **KHÔNG có UPDATE** ⇒ "đổi cảm xúc" là DELETE + INSERT, không phải `.set()`. Viết `update()` ở
 *     đây là `42501` lúc chạy, TypeScript mù với nó.
 *   • Đây là bảng DUY NHẤT của cụm CHAT được cấp `DELETE`, và điều đó KHÔNG phá BẤT BIẾN #2: một
 *     reaction là trạng thái hiện tại của một nút bật/tắt, không phải dấu vết audit/snapshot/ledger.
 *
 * MỌI hàm nhận `tx` và mang `company_id` tường minh bên cạnh RLS (CLAUDE.md §2).
 */
@Injectable()
export class ChatReactionsRepository {
  /**
   * Thả cảm xúc — **idempotent**. Trả `true` nếu THỰC SỰ thêm hàng mới.
   *
   * `ON CONFLICT DO NOTHING` trên `chat_message_reactions_uq` (4 cột) là toàn bộ phần chống đua: hai
   * người bấm cùng lúc thì DB quyết, không cần khoá nào ở tầng ứng dụng. Và cùng một người bấm hai lần
   * cũng chỉ ra một hàng — `done_when` #1.
   *
   * KHÔNG truyền `companyId` vào `values`: cột có DEFAULT theo GUC `app.current_company_id` (mig `0543`
   * khối D + `.default(currentCompanyDefault)` ở schema), tức `withTenant` đã đặt đúng tenant.
   */
  async add(
    tx: TenantTx,
    messageId: string,
    userId: string,
    emoji: ChatReactionEmoji,
  ): Promise<boolean> {
    const rows = await tx
      .insert(chatMessageReactions)
      .values({ messageId, userId, emoji })
      .onConflictDoNothing()
      .returning({ id: chatMessageReactions.id });
    return rows.length > 0;
  }

  /**
   * Bỏ thả — **idempotent**. Trả `true` nếu thực sự xoá được hàng.
   *
   * Chưa từng thả ⇒ `false` ⇒ caller vẫn trả **204**, KHÔNG 404 (`done_when` #1): 404 ở đây sẽ nói cho
   * người gọi biết "bạn chưa từng thả emoji này", một thông tin vô dụng và là một trạng thái mà hai
   * thiết bị của cùng một người rất dễ bất đồng.
   */
  async remove(
    tx: TenantTx,
    companyId: string,
    messageId: string,
    userId: string,
    emoji: ChatReactionEmoji,
  ): Promise<boolean> {
    const rows = await tx
      .delete(chatMessageReactions)
      .where(
        and(
          eq(chatMessageReactions.companyId, companyId),
          eq(chatMessageReactions.messageId, messageId),
          eq(chatMessageReactions.userId, userId),
          eq(chatMessageReactions.emoji, emoji),
        ),
      )
      .returning({ id: chatMessageReactions.id });
    return rows.length > 0;
  }

  /**
   * Tổng hợp cho MỘT LÔ tin — **đúng một truy vấn**, bất kể lô có bao nhiêu tin (`done_when` #5).
   *
   * ⚠️ `mine` tính NGAY TRONG SQL bằng `bool_or(user_id = actor)`, KHÔNG phải bằng một truy vấn thứ hai
   * "reaction của tôi" rồi ghép ở JS. Hai truy vấn ở đây nghĩa là hai ảnh chụp khác nhau: giữa chúng
   * người dùng có thể vừa bỏ thả ở tab khác, và kết quả ghép ra một dòng `count: 1, mine: true` cho một
   * emoji đã không còn ai thả.
   *
   * Sắp theo `emoji` để thứ tự thanh cảm xúc ỔN ĐỊNH giữa các lần tải — không sắp thì Postgres trả theo
   * thứ tự nhóm tuỳ kế hoạch, và thanh cảm xúc nhảy chỗ mỗi lần cuộn.
   */
  async aggregateForMessages(
    tx: TenantTx,
    companyId: string,
    messageIds: readonly string[],
    actorUserId: string,
  ): Promise<ChatReactionAggregateRow[]> {
    if (messageIds.length === 0) return [];
    const rows = await tx
      .select({
        messageId: chatMessageReactions.messageId,
        emoji: chatMessageReactions.emoji,
        count: sql<number>`count(*)::int`,
        mine: sql<boolean>`bool_or(${chatMessageReactions.userId} = ${actorUserId})`,
      })
      .from(chatMessageReactions)
      .where(
        and(
          eq(chatMessageReactions.companyId, companyId),
          inArray(chatMessageReactions.messageId, [...messageIds]),
        ),
      )
      .groupBy(chatMessageReactions.messageId, chatMessageReactions.emoji)
      .orderBy(chatMessageReactions.emoji);

    return rows.map((r) => ({
      messageId: r.messageId,
      emoji: r.emoji as ChatReactionEmoji,
      count: r.count,
      mine: r.mine,
    }));
  }
}

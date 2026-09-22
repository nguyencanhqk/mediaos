import { Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedReactions } from "../db/schema/social";
import { users } from "../db/schema/users";
import type { SocialTargetType } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — `feed_reactions` cho CẢ bài lẫn bình luận (bảng ĐA HÌNH).
 *
 * ⚠️ Mọi method ở đây nhận `targetId` đã qua `SocialAccessService.assertTargetVisible` — repository
 * KHÔNG tự gác. Xem khối ⚠️ IDOR ở `social-access.service.ts`.
 */
@Injectable()
export class SocialReactionsRepository {
  /**
   * Đặt/đổi cảm xúc — MỘT câu `INSERT … ON CONFLICT DO UPDATE`.
   *
   * `feed_reactions_target_user_uq (company_id, target_type, target_id, user_id)` là chốt cuối chống
   * thả đôi. Dùng `DO UPDATE` chứ không `DO NOTHING` vì đây là đường ĐỔI emoji: thả 👍 rồi thả ❤️ là
   * một hàng đổi giá trị, không phải hàng thứ hai.
   *
   * @returns `"inserted"` (chưa từng thả) · `"updated"` (đổi emoji) · `"unchanged"` (thả lại đúng
   *   emoji đang có). Ba nhánh vì chúng khác nhau ở HỆ QUẢ: chỉ `inserted` mới `+1 like_count`, và
   *   chỉ `inserted`/`updated` mới đáng phát WS — phát lại cho `unchanged` chỉ bắt cả công ty render
   *   lại đúng con số cũ (khuôn `ChatReactionsService.react`, `changed===true`).
   */
  async put(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
    userId: string,
    emoji: string,
  ): Promise<"inserted" | "updated" | "unchanged"> {
    const rows = await tx.execute<{ inserted: boolean; changed: boolean }>(sql`
      INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
      VALUES (${companyId}, ${targetType}, ${targetId}, ${userId}, ${emoji})
      ON CONFLICT (company_id, target_type, target_id, user_id)
      DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = now()
      RETURNING (xmax = 0) AS inserted,
                (xmax = 0 OR feed_reactions.emoji IS DISTINCT FROM ${emoji}) AS changed
    `);
    const row = rows.rows[0];
    if (!row) return "unchanged";
    if (row.inserted) return "inserted";
    return row.changed ? "updated" : "unchanged";
  }

  /**
   * Gỡ cảm xúc. Chưa từng thả ⇒ vẫn thành công (đường GỠ không chặt như đường ghi — khuôn
   * `ChatReactionsService.unreact`).
   *
   * @returns `true` khi thật sự có hàng bị gỡ ⇒ caller `-1 like_count` và phát WS.
   */
  async remove(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
    userId: string,
  ): Promise<boolean> {
    const deleted = await tx
      .delete(feedReactions)
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          eq(feedReactions.targetId, targetId),
          eq(feedReactions.userId, userId),
        ),
      )
      .returning({ id: feedReactions.id });
    return deleted.length > 0;
  }

  /** Emoji actor ĐANG thả trên một đích — `null` = chưa thả. Nguồn của cờ `mine` trong DTO. */
  async myEmoji(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ emoji: feedReactions.emoji })
      .from(feedReactions)
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          eq(feedReactions.targetId, targetId),
          eq(feedReactions.userId, userId),
        ),
      )
      .limit(1);
    return rows[0]?.emoji ?? null;
  }

  /** Tổng hợp theo emoji cho MỘT đích — dùng ngay sau khi ghi để trả ảnh chụp mới nhất. */
  async aggregate(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
  ): Promise<{ emoji: string; count: number }[]> {
    const rows = await tx
      .select({ emoji: feedReactions.emoji, count: sql<number>`count(*)::int` })
      .from(feedReactions)
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          eq(feedReactions.targetId, targetId),
        ),
      )
      .groupBy(feedReactions.emoji)
      .orderBy(sql`count(*) DESC`, feedReactions.emoji);
    return rows.map((r) => ({ emoji: r.emoji, count: Number(r.count) }));
  }

  /**
   * `SOCIAL-API-013` — danh sách NGƯỜI đã thả, danh tính NHÂN SỰ.
   *
   * ⚠️ KHÔNG trả `user_id` (cùng luật với `feedAuthorSchema`). Trần cứng thay vì phân trang: thanh
   * cảm xúc chỉ hiện vài khuôn mặt; một danh sách 5000 người không phục vụ màn hình nào và là một
   * đường kéo danh bạ rẻ tiền.
   */
  async listReactors(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
    limit = 100,
  ): Promise<ReactorRow[]> {
    return (await tx
      .select({
        employeeId: employeeProfiles.id,
        fullName: users.fullName,
        avatarUrl: employeeProfiles.avatarUrl,
        emoji: feedReactions.emoji,
        createdAt: feedReactions.createdAt,
      })
      .from(feedReactions)
      .leftJoin(
        users,
        and(eq(users.id, feedReactions.userId), eq(users.companyId, feedReactions.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.userId, feedReactions.userId),
          eq(employeeProfiles.companyId, feedReactions.companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          eq(feedReactions.targetId, targetId),
        ),
      )
      .orderBy(desc(feedReactions.createdAt))
      .limit(limit)) as ReactorRow[];
  }

  /** Gỡ mọi cảm xúc của một đích (dọn theo khi xoá mềm bình luận). */
  async clearForTarget(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
  ): Promise<void> {
    await tx
      .delete(feedReactions)
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          eq(feedReactions.targetId, targetId),
        ),
      );
  }
}

export interface ReactorRow {
  employeeId: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  emoji: string;
  createdAt: Date;
}

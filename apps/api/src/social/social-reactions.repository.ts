import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
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
   *
   * ⚠️ Phân loại nằm ở mệnh đề `WHERE` của `DO UPDATE`, KHÔNG ở `RETURNING`: `RETURNING` chỉ thấy
   * hàng SAU khi ghi, nên so `emoji` ở đó luôn ra «bằng nhau» và nhánh `updated` không bao giờ được
   * trả (QA1-BUG-1 — lượt đổi loại không phát WS). `WHERE` thì được tính trên hàng ĐANG có, đã khoá,
   * trong chính câu lệnh ⇒ không có khe đọc-rồi-ghi: cùng emoji ⇒ 0 hàng trả về (`unchanged`, hàng
   * vẫn bị khoá nên thứ tự khoá «cảm xúc → bộ đếm» giữ nguyên); khác emoji ⇒ 1 hàng `xmax <> 0`.
   */
  async put(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
    userId: string,
    emoji: string,
  ): Promise<"inserted" | "updated" | "unchanged"> {
    const rows = await tx.execute<{ inserted: boolean }>(sql`
      INSERT INTO feed_reactions (company_id, target_type, target_id, user_id, emoji)
      VALUES (${companyId}, ${targetType}, ${targetId}, ${userId}, ${emoji})
      ON CONFLICT (company_id, target_type, target_id, user_id)
      DO UPDATE SET emoji = EXCLUDED.emoji, updated_at = now()
      WHERE feed_reactions.emoji IS DISTINCT FROM EXCLUDED.emoji
      RETURNING (xmax = 0) AS inserted
    `);
    const row = rows.rows[0];
    if (!row) return "unchanged";
    return row.inserted ? "inserted" : "updated";
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
        avatarRaw: employeeProfiles.avatarUrl,
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
  /**
   * S16-SOCIAL-BE-3A (FULL gate database MEDIUM-2) — khoá TRƯỚC mọi hàng cảm xúc của đích, `ORDER BY id`.
   *
   * Đường gỡ cảm xúc (`019`) khoá hàng cảm xúc RỒI mới UPDATE bộ đếm trên hàng bình luận; đường xoá
   * bình luận (`017`/`029 delete_target`) trước vá UPDATE hàng bình luận RỒI mới DELETE cảm xúc ⇒ hai
   * thứ tự ngược nhau ⇒ `40P01` ⇒ 500. Gọi hàm này ĐẦU `removeTx` đưa đường xoá về CÙNG thứ tự
   * «cảm xúc → bình luận».
   */
  async lockForTarget(
    tx: TenantTx,
    companyId: string,
    targetType: SocialTargetType,
    targetId: string,
  ): Promise<void> {
    await tx
      .select({ id: feedReactions.id })
      .from(feedReactions)
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          eq(feedReactions.targetId, targetId),
        ),
      )
      .orderBy(asc(feedReactions.id))
      .for("update");
  }

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
  avatarRaw: string | null;
  emoji: string;
  createdAt: Date;
}

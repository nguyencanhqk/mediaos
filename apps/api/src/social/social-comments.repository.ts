import { Injectable } from "@nestjs/common";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedComments } from "../db/schema/social";
import { users } from "../db/schema/users";
import type { SocialCursor } from "./social-feed-cursor";

/**
 * S16-SOCIAL-BE-1 — truy vấn `feed_comments`. Tập cột TƯỜNG MINH (DB-17 §11 R6).
 *
 * ⚠️ **KHÔNG có vị từ visibility ở đây.** Bình luận không có phạm vi riêng — nó thừa hưởng NGUYÊN
 * phạm vi của bài cha. Mọi caller PHẢI đi qua `SocialAccessService.assertPostVisible` (đường theo
 * `post_id`) hoặc `assertCommentVisible` (đường theo `comment_id`) TRƯỚC khi gọi repository này.
 * Đặt thêm một bản vị từ ở đây sẽ đẻ ra bản luật thứ hai để trôi khỏi bản gốc.
 */
@Injectable()
export class SocialCommentsRepository {
  /**
   * Một trang bình luận của MỘT bài, keyset `(created_at, id)` TĂNG DẦN.
   *
   * Tăng dần (khác feed) có chủ đích: bình luận đọc theo dòng hội thoại từ cũ tới mới, và trang sau
   * là phần TIẾP THEO chứ không phải phần cũ hơn. Vì vậy vế keyset dùng `>` chứ không `<`.
   *
   * ⚠️ `date_trunc('milliseconds', …)` như mọi keyset khác — xem `social-feed-cursor.ts`.
   *
   * Trả 1 cấp phẳng theo thứ tự thời gian: FE lồng trả lời dưới bình luận gốc bằng
   * `parentCommentId`. Trả cây lồng sẵn từ server sẽ phá phân trang (một bình luận gốc có 500 trả
   * lời thì "một trang" là bao nhiêu?).
   */
  async listForPost(
    tx: TenantTx,
    companyId: string,
    postId: string,
    limit: number,
    cursor: SocialCursor | null,
  ): Promise<CommentRow[]> {
    const col = sql`date_trunc('milliseconds', ${feedComments.createdAt})`;
    const where: SQL[] = [
      eq(feedComments.companyId, companyId),
      eq(feedComments.postId, postId),
      isNull(feedComments.deletedAt),
    ];
    if (cursor) {
      where.push(
        sql`(${col} > ${cursor.sortAt.toISOString()}::timestamptz
          OR (${col} = ${cursor.sortAt.toISOString()}::timestamptz AND ${feedComments.id} > ${cursor.id}))`,
      );
    }

    return (await tx
      .select({ ...COMMENT_COLUMNS, sortAt: sql<string>`${col}`.as("sort_at") })
      .from(feedComments)
      .leftJoin(
        users,
        and(eq(users.id, feedComments.authorUserId), eq(users.companyId, feedComments.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, feedComments.authorEmployeeId),
          eq(employeeProfiles.companyId, feedComments.companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(and(...where))
      .orderBy(sql`${col} ASC`, sql`${feedComments.id} ASC`)
      .limit(limit + 1)) as CommentRow[];
  }

  /** Một bình luận theo id (KHÔNG gác — caller đã qua `assertCommentVisible`). */
  async findById(tx: TenantTx, companyId: string, commentId: string): Promise<CommentRow | null> {
    const rows = (await tx
      .select({
        ...COMMENT_COLUMNS,
        sortAt: sql<string>`${feedComments.createdAt}`.as("sort_at"),
      })
      .from(feedComments)
      .leftJoin(
        users,
        and(eq(users.id, feedComments.authorUserId), eq(users.companyId, feedComments.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, feedComments.authorEmployeeId),
          eq(employeeProfiles.companyId, feedComments.companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(feedComments.id, commentId),
          eq(feedComments.companyId, companyId),
          isNull(feedComments.deletedAt),
        ),
      )
      .limit(1)) as CommentRow[];
    return rows[0] ?? null;
  }

  /**
   * MỘT CẤP — ép ở SERVICE vì CHECK cấp hàng không nhìn được hàng cha (`schema/social.ts:206`).
   *
   * @returns `authorUserId` của bình luận CHA (người nhận `NOTI-EVENT-030`), hoặc:
   *   - `undefined` khi cha không tồn tại / không thuộc bài này ⇒ caller trả 404;
   *   - `null` khi cha CHÍNH NÓ đã là một trả lời ⇒ caller trả 422 `SOCIAL-ERR-005`.
   */
  async parentAuthorFor(
    tx: TenantTx,
    companyId: string,
    postId: string,
    parentCommentId: string,
  ): Promise<string | null | undefined> {
    const rows = await tx
      .select({
        authorUserId: feedComments.authorUserId,
        parentCommentId: feedComments.parentCommentId,
      })
      .from(feedComments)
      .where(
        and(
          eq(feedComments.id, parentCommentId),
          eq(feedComments.companyId, companyId),
          // Cha PHẢI thuộc CÙNG bài — thiếu vế này thì một `parent_comment_id` của bài khác sẽ tạo
          // được bình luận "mồ côi" trỏ chéo bài, và cây hội thoại của cả hai bài đều sai.
          eq(feedComments.postId, postId),
          isNull(feedComments.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return row.parentCommentId === null ? row.authorUserId : null;
  }
}

const COMMENT_COLUMNS = {
  id: feedComments.id,
  postId: feedComments.postId,
  parentCommentId: feedComments.parentCommentId,
  authorUserId: feedComments.authorUserId,
  authorEmployeeId: feedComments.authorEmployeeId,
  authorFullName: users.fullName,
  authorAvatarUrl: employeeProfiles.avatarUrl,
  body: feedComments.body,
  likeCount: feedComments.likeCount,
  editedAt: feedComments.editedAt,
  createdAt: feedComments.createdAt,
} as const;

export interface CommentRow {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorUserId: string;
  authorEmployeeId: string | null;
  authorFullName: string | null;
  authorAvatarUrl: string | null;
  body: string;
  likeCount: number;
  editedAt: Date | null;
  createdAt: Date;
  sortAt: string;
}

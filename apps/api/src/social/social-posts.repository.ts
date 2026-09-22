import { Injectable } from "@nestjs/common";
import { and, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { FeedSortDto } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import {
  feedPostTags,
  feedPostViews,
  feedPosts,
  feedReactions,
  feedSavedPosts,
  feedTags,
} from "../db/schema/social";
import { users } from "../db/schema/users";
import { SocialAccessService } from "./social-access.service";
import type { SocialCursor } from "./social-feed-cursor";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — truy vấn `feed_posts`. **Tập cột TƯỜNG MINH, cấm `select()` trần** (DB-17 §11 R6).
 *
 * ┌─ BA LUẬT CỦA MỌI CÂU LIỆT KÊ Ở ĐÂY ────────────────────────────────────────────────────────────┐
 * │ 1. **Audience + status lọc TRONG SQL**, qua `SocialAccessService.visiblePostCondition` — KHÔNG   │
 * │    lấy về rồi lọc bằng JS. Lọc ở JS nghĩa là `LIMIT` đếm cả hàng sẽ bị bỏ ⇒ trang trả về ít hơn  │
 * │    `limit` một cách ngẫu nhiên, và với keyset thì nó còn **bỏ sót hàng ở trang sau**.            │
 * │ 2. **Keyset cắt về mili-giây**: `date_trunc('milliseconds', <cột mốc>)`. Xem `social-feed-       │
 * │    cursor.ts` để biết vì sao — thiếu `date_trunc` là sót bài, HTTP 200, không lỗi.               │
 * │ 3. **Projection theo actor lấy THEO LÔ** (`myReaction`, `savedByMe`) — một truy vấn cho cả       │
 * │    trang, KHÔNG một truy vấn mỗi bài (N+1 trên đúng màn hình cuộn vô hạn). Cố ý KHÔNG nhét       │
 * │    subquery tương quan vào câu chính: nó làm planner bỏ index keyset. Xem                        │
 * │    `SocialActorProjectionRepository`.                                                            │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class SocialPostsRepository {
  constructor(private readonly access: SocialAccessService) {}

  /** Cột mốc sắp xếp của mỗi chế độ (API-19 §5.1). */
  private sortColumn(sort: FeedSortDto): SQL {
    return sort === "latest"
      ? sql`date_trunc('milliseconds', ${feedPosts.publishedAt})`
      : sql`date_trunc('milliseconds', ${feedPosts.lastActivityAt})`;
  }

  /**
   * Vị từ keyset `(sortAt, id) < ($sortAt, $id)` cho thứ tự GIẢM DẦN.
   *
   * Viết dạng tường minh (`a < x OR (a = x AND id < y)`) thay vì tuple `(a,id) < (x,y)`: drizzle
   * không dựng tuple-compare, và dạng tường minh đọc được ở log truy vấn.
   */
  private keysetCondition(sort: FeedSortDto, cursor: SocialCursor): SQL {
    const col = this.sortColumn(sort);
    return sql`(${col} < ${cursor.sortAt.toISOString()}::timestamptz
             OR (${col} = ${cursor.sortAt.toISOString()}::timestamptz AND ${feedPosts.id} < ${cursor.id}))`;
  }

  /**
   * Một trang bài. Lấy `limit + 1` hàng để biết có trang sau hay không — KHÔNG `COUNT(*)`: đếm toàn
   * bộ dòng cuộn mỗi lần lật trang là quét cả bảng cho một con số không ai hiển thị.
   */
  async listFeed(
    tx: TenantTx,
    viewer: SocialViewerContext,
    opts: {
      sort: FeedSortDto;
      limit: number;
      cursor: SocialCursor | null;
      type?: string;
      audience?: string;
      status?: string;
      authorUserId?: string;
      orgUnitId?: string;
      tag?: string;
      savedByActorOnly?: boolean;
      /**
       * S16-SOCIAL-BE-1B (`SOCIAL-API-023`) — từ khoá toàn văn. Thêm MỘT vị từ vào CHÍNH câu này thay
       * vì mở một repository tìm kiếm riêng: bản thứ hai sẽ cần chép lại `visiblePostCondition` và
       * hai bản đó trôi khỏi nhau ngay lần đầu luật audience đổi.
       */
      searchText?: string;
      /**
       * 🔴 S16-SOCIAL-BE-2A (D-OWNER-6/D1) — bài `audience='group'` có nằm trong tập kết quả không.
       * **BẮT BUỘC, không `?`, không giá trị mặc định** (W6): `listFeed` là MỘT hàm phục vụ NĂM
       * route (`001`·`010`·`020`·`023`·`025`), mỗi route trả lời câu này KHÁC nhau, và mọi field
       * khác ở đây đều optional — viết theo thói quen thành `groupScope?:` là để sẵn một cửa
       * fail-OPEN cho caller MỚI (BE-2B/BE-3): quên truyền ⇒ bài nhóm chảy vào feed khám phá, im
       * lặng. Kiểu này làm "quên" KHÔNG biểu diễn được.
       *
       *   • `"exclude"`      — feed khám phá: `001` (không lọc nhóm), `023` tìm kiếm, `025` trang cá nhân
       *   • `"include"`      — nội dung actor ĐÃ có quan hệ: `010` Đã lưu, `020` Tin tức
       *   • `{ only: id }`   — `001?groupId=` lọc đích danh (cửa thoát DUY NHẤT của D-OWNER-6)
       *
       * ⚠️ Đây là bộ lọc **THÀNH PHẦN FEED**, KHÔNG phải quyền: `visiblePostCondition` vẫn AND ở
       * trên nó. `{only}` không nới gì — người ngoài nhóm kín lọc đích danh vẫn nhận tập rỗng.
       */
      groupScope: "exclude" | "include" | { only: string };
    },
  ): Promise<PostRow[]> {
    const where: SQL[] = [
      eq(feedPosts.companyId, viewer.companyId),
      this.access.visiblePostCondition(viewer),
    ];

    // D-OWNER-6 — tầng THÀNH PHẦN FEED (D1), tách hẳn khỏi tầng VISIBILITY ở trên.
    if (opts.groupScope === "exclude") {
      where.push(ne(feedPosts.audience, "group"));
    } else if (typeof opts.groupScope === "object") {
      where.push(eq(feedPosts.groupId, opts.groupScope.only));
    }

    if (opts.type) where.push(eq(feedPosts.type, opts.type as never));
    if (opts.audience) where.push(eq(feedPosts.audience, opts.audience as never));
    // `status` ĐÃ qua cổng quyền ở service (chỉ `manage:feed-post` mới gửi được giá trị khác
    // `published`). Ở đây nó là một bộ lọc THÊM, luôn nằm TRONG tập mà vị từ visibility cho phép —
    // hai vế AND, không vế nào thay thế vế nào.
    if (opts.status) where.push(eq(feedPosts.status, opts.status as never));
    if (opts.authorUserId) where.push(eq(feedPosts.authorUserId, opts.authorUserId));
    if (opts.orgUnitId) where.push(eq(feedPosts.orgUnitId, opts.orgUnitId));
    if (opts.tag) {
      where.push(sql`EXISTS (
        SELECT 1 FROM ${feedPostTags} pt
          JOIN ${feedTags} t ON t.id = pt.tag_id AND t.company_id = pt.company_id
         WHERE pt.company_id = ${viewer.companyId}
           AND pt.post_id = ${feedPosts.id}
           AND t.tag = ${opts.tag.toLowerCase()}
      )`);
    }
    if (opts.savedByActorOnly) {
      where.push(sql`EXISTS (
        SELECT 1 FROM ${feedSavedPosts} s
         WHERE s.company_id = ${viewer.companyId}
           AND s.post_id = ${feedPosts.id}
           AND s.user_id = ${viewer.actorUserId}
      )`);
    }
    if (opts.searchText) {
      // Cột SINH `search_vector = to_tsvector('simple', f_unaccent(body))` (mig `0577` §12) — vế phải
      // PHẢI dùng CÙNG cấu hình `'simple'` VÀ CÙNG hàm `f_unaccent`, nếu không câu khớp 0 kết quả
      // **im lặng** (HTTP 200, danh sách rỗng, không lỗi). Ca `C4` vì vậy có neo DƯƠNG `length===1`,
      // không chỉ kiểm "không có id sai".
      // `plainto_tsquery` (KHÔNG `to_tsquery`): nó tự thoát mọi ký tự toán tử của người dùng — gõ
      // `a & b` hay `!(` vào ô tìm kiếm không được phép thành cú pháp truy vấn, chứ không phải 500.
      where.push(
        sql`${feedPosts.searchVector} @@ plainto_tsquery('simple', public.f_unaccent(${opts.searchText}))`,
      );
    }
    if (opts.cursor) where.push(this.keysetCondition(opts.sort, opts.cursor));

    const col = this.sortColumn(opts.sort);

    return (
      (await tx
        .select({
          ...POST_COLUMNS,
          sortAt: sql<string>`${col}`.as("sort_at"),
        })
        .from(feedPosts)
        .leftJoin(
          users,
          and(eq(users.id, feedPosts.authorUserId), eq(users.companyId, feedPosts.companyId)),
        )
        .leftJoin(
          employeeProfiles,
          and(
            eq(employeeProfiles.id, feedPosts.authorEmployeeId),
            eq(employeeProfiles.companyId, feedPosts.companyId),
            isNull(employeeProfiles.deletedAt),
          ),
        )
        .where(and(...where))
        // Ghim lên đầu CHỈ ở chế độ mặc định «Hoạt động mới»: ở «Mới đăng» người dùng đang hỏi một câu
        // thuần thời gian, chèn bài ghim vào giữa là trả lời một câu khác.
        .orderBy(
          ...(opts.sort === "active"
            ? [sql`${feedPosts.pinned} DESC`, sql`${col} DESC`, sql`${feedPosts.id} DESC`]
            : [sql`${col} DESC`, sql`${feedPosts.id} DESC`]),
        )
        .limit(opts.limit + 1)) as PostRow[]
    );
  }

  /** Một bài theo id, ĐÃ qua vị từ visibility — dùng cho 003 và cho mọi đường ghi trả lại bài. */
  async findVisible(
    tx: TenantTx,
    viewer: SocialViewerContext,
    postId: string,
  ): Promise<PostRow | null> {
    const rows = (await tx
      .select({ ...POST_COLUMNS, sortAt: sql<string>`${feedPosts.lastActivityAt}`.as("sort_at") })
      .from(feedPosts)
      .leftJoin(
        users,
        and(eq(users.id, feedPosts.authorUserId), eq(users.companyId, feedPosts.companyId)),
      )
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.id, feedPosts.authorEmployeeId),
          eq(employeeProfiles.companyId, feedPosts.companyId),
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(feedPosts.id, postId),
          eq(feedPosts.companyId, viewer.companyId),
          this.access.visiblePostCondition(viewer),
        ),
      )
      .limit(1)) as PostRow[];
    return rows[0] ?? null;
  }

  /** `postId → [tag]` cho một lô — MỘT truy vấn, không một truy vấn mỗi bài. */
  async tagsFor(
    tx: TenantTx,
    companyId: string,
    postIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (postIds.length === 0) return out;
    const rows = await tx
      .select({ postId: feedPostTags.postId, tag: feedTags.tag })
      .from(feedPostTags)
      .innerJoin(
        feedTags,
        and(eq(feedTags.id, feedPostTags.tagId), eq(feedTags.companyId, feedPostTags.companyId)),
      )
      .where(
        and(eq(feedPostTags.companyId, companyId), inArray(feedPostTags.postId, [...postIds])),
      );
    for (const r of rows) {
      const list = out.get(r.postId) ?? [];
      list.push(r.tag);
      out.set(r.postId, list);
    }
    return out;
  }

  /**
   * Ghi lượt xem LẦN ĐẦU — `ON CONFLICT DO NOTHING` trên PK tổ hợp `(company_id, post_id, user_id)`.
   *
   * @returns `true` khi thật sự có hàng mới (tức đây là lần xem đầu tiên của người này). Caller chỉ
   *   tăng `view_count` khi `true` — reload trang KHÔNG được tăng (DB-17 §6.8).
   */
  async recordFirstView(
    tx: TenantTx,
    companyId: string,
    postId: string,
    userId: string,
  ): Promise<boolean> {
    const inserted = await tx
      .insert(feedPostViews)
      .values({ companyId, postId, userId })
      .onConflictDoNothing()
      .returning({ postId: feedPostViews.postId });
    return inserted.length > 0;
  }

  /** Lưu bài (PK tổ hợp ⇒ idempotent tự nhiên). `true` = vừa thêm mới. */
  async savePost(
    tx: TenantTx,
    companyId: string,
    postId: string,
    userId: string,
  ): Promise<boolean> {
    const inserted = await tx
      .insert(feedSavedPosts)
      .values({ companyId, postId, userId })
      .onConflictDoNothing()
      .returning({ postId: feedSavedPosts.postId });
    return inserted.length > 0;
  }

  /** Bỏ lưu. Chưa từng lưu ⇒ vẫn thành công (đường GỠ không chặt như đường ghi). */
  async unsavePost(tx: TenantTx, companyId: string, postId: string, userId: string): Promise<void> {
    await tx
      .delete(feedSavedPosts)
      .where(
        and(
          eq(feedSavedPosts.companyId, companyId),
          eq(feedSavedPosts.postId, postId),
          eq(feedSavedPosts.userId, userId),
        ),
      );
  }
}

/**
 * Tập cột của một hàng bài. TƯỜNG MINH, cấm `select()` trần (DB-17 §11 R6) — thêm cột ở đây là một
 * quyết định, không phải một tiện tay.
 *
 * `myReaction`/`savedByMe` KHÔNG nằm ở đây: chúng phụ thuộc actor và được lấy bằng truy vấn lô
 * riêng (`SocialActorProjectionRepository`) — xem jsdoc ở lớp đó để biết vì sao không nhét subquery
 * tương quan vào câu có `ORDER BY` + `LIMIT`.
 */
const POST_COLUMNS = {
  id: feedPosts.id,
  authorUserId: feedPosts.authorUserId,
  authorEmployeeId: feedPosts.authorEmployeeId,
  authorFullName: users.fullName,
  authorAvatarUrl: employeeProfiles.avatarUrl,
  type: feedPosts.type,
  audience: feedPosts.audience,
  orgUnitId: feedPosts.orgUnitId,
  groupId: feedPosts.groupId,
  body: feedPosts.body,
  status: feedPosts.status,
  pinned: feedPosts.pinned,
  commentsLocked: feedPosts.commentsLocked,
  requiresAck: feedPosts.requiresAck,
  likeCount: feedPosts.likeCount,
  commentCount: feedPosts.commentCount,
  viewCount: feedPosts.viewCount,
  publishedAt: feedPosts.publishedAt,
  lastActivityAt: feedPosts.lastActivityAt,
  editedAt: feedPosts.editedAt,
  createdAt: feedPosts.createdAt,
} as const;

export interface PostRow {
  id: string;
  authorUserId: string;
  authorEmployeeId: string | null;
  authorFullName: string | null;
  authorAvatarUrl: string | null;
  type: string;
  audience: string;
  orgUnitId: string | null;
  groupId: string | null;
  body: string | null;
  status: string;
  pinned: boolean;
  commentsLocked: boolean;
  requiresAck: boolean;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  publishedAt: Date;
  lastActivityAt: Date;
  editedAt: Date | null;
  createdAt: Date;
  sortAt: string;
}

/**
 * Projection theo actor cho một LÔ bài — `myReaction` + `savedByMe`, MỘT truy vấn mỗi loại.
 *
 * Tách khỏi câu liệt kê chính có chủ đích: nhét hai subquery tương quan vào câu có `ORDER BY` +
 * `LIMIT` làm planner mất index keyset (đo được trên CHAT ở cùng lớp truy vấn). Hai truy vấn lô trên
 * tập `postIds` ĐÃ giới hạn ≤ 50 hàng thì rẻ và ổn định.
 */
@Injectable()
export class SocialActorProjectionRepository {
  async myReactions(
    tx: TenantTx,
    companyId: string,
    userId: string,
    targetType: "post" | "comment",
    targetIds: readonly string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (targetIds.length === 0) return out;
    const rows = await tx
      .select({ targetId: feedReactions.targetId, emoji: feedReactions.emoji })
      .from(feedReactions)
      .where(
        and(
          eq(feedReactions.companyId, companyId),
          eq(feedReactions.targetType, targetType),
          inArray(feedReactions.targetId, [...targetIds]),
          eq(feedReactions.userId, userId),
        ),
      );
    for (const r of rows) out.set(r.targetId, r.emoji);
    return out;
  }

  async savedPostIds(
    tx: TenantTx,
    companyId: string,
    userId: string,
    postIds: readonly string[],
  ): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();
    const rows = await tx
      .select({ postId: feedSavedPosts.postId })
      .from(feedSavedPosts)
      .where(
        and(
          eq(feedSavedPosts.companyId, companyId),
          eq(feedSavedPosts.userId, userId),
          inArray(feedSavedPosts.postId, [...postIds]),
        ),
      );
    return new Set(rows.map((r) => r.postId));
  }
}

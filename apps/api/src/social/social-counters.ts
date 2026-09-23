import { and, eq, inArray, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { feedComments, feedPostTags, feedPosts, feedTags } from "../db/schema/social";

/**
 * S16-SOCIAL-BE-1 — bộ đếm denormalized của `feed_posts`/`feed_comments`/`feed_tags`.
 *
 * ┌─ LUẬT DUY NHẤT: CỘNG TRONG SQL, KHÔNG ĐỌC-RỒI-GHI ─────────────────────────────────────────────┐
 * │ `UPDATE … SET like_count = like_count + $delta … RETURNING like_count` khoá hàng cha trong CÙNG  │
 * │ transaction (khuôn `tasks.repository.ts:416-433` `allocateSequenceTx`).                         │
 * │ Dạng `SELECT like_count` → `+1` ở JS → `UPDATE SET like_count = $n` là **lost update**: hai      │
 * │ lượt thích đồng thời cùng đọc 5, cùng ghi 6, kết quả 6 thay vì 7. Postgres KHÔNG báo lỗi —       │
 * │ nó chỉ đếm sai, mãi mãi (memory `clamp-must-be-sql-not-js`).                                     │
 * │ ⚠️ CẤM `Math.max(0, …)` ở JS cho vế giảm. Sàn 0 là việc của CHECK `chk_feed_posts_counts`; kẹp   │
 * │ ở JS chỉ che một lỗi đếm thật thành một con số sai im lặng.                                      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `last_activity_at` bump CÙNG TX khi có bình luận/reaction mới — **KHÔNG bump theo lượt xem**
 * (`schema/social.ts:54-55`): bump theo view biến «Hoạt động mới» thành «vừa có người mở ra xem».
 */

/** Cột đếm được phép cộng trên `feed_posts` — tập ĐÓNG, không nhận chuỗi tự do từ caller. */
export type FeedPostCounter = "likeCount" | "commentCount" | "viewCount";

const POST_COUNTER_SQL: Record<FeedPostCounter, ReturnType<typeof sql.raw>> = {
  likeCount: sql.raw("like_count"),
  commentCount: sql.raw("comment_count"),
  viewCount: sql.raw("view_count"),
};

/**
 * Cộng `delta` (âm hoặc dương) vào một cột đếm của bài, trong CÙNG tx với hàng nguồn.
 *
 * `bumpActivity` mặc định `true`: gần như mọi lượt đổi đếm LÀ một hoạt động. Lượt xem truyền `false`
 * — xem khối ⚠️ ở đầu file.
 *
 * @returns giá trị MỚI của cột, hoặc `null` nếu bài không còn (đã xoá mềm giữa chừng). Caller quyết
 *   định `null` nghĩa là gì; hàm này KHÔNG tự ném — nó không biết đường gọi đang ở nhánh đọc hay ghi.
 */
export async function bumpPostCounter(
  tx: TenantTx,
  companyId: string,
  postId: string,
  counter: FeedPostCounter,
  delta: number,
  bumpActivity = true,
): Promise<number | null> {
  const col = POST_COUNTER_SQL[counter];
  const rows = await tx.execute<{ value: number }>(
    bumpActivity
      ? sql`UPDATE feed_posts
               SET ${col} = ${col} + ${delta}, last_activity_at = now()
             WHERE id = ${postId} AND company_id = ${companyId} AND deleted_at IS NULL
         RETURNING ${col} AS value`
      : sql`UPDATE feed_posts
               SET ${col} = ${col} + ${delta}
             WHERE id = ${postId} AND company_id = ${companyId} AND deleted_at IS NULL
         RETURNING ${col} AS value`,
  );
  const row = rows.rows[0];
  return row ? Number(row.value) : null;
}

/** Cộng `delta` vào `feed_comments.like_count`. Cùng luật SQL-không-JS như trên. */
export async function bumpCommentLikeCount(
  tx: TenantTx,
  companyId: string,
  commentId: string,
  delta: number,
): Promise<number | null> {
  const rows = await tx.execute<{ value: number }>(
    sql`UPDATE feed_comments
           SET like_count = like_count + ${delta}
         WHERE id = ${commentId} AND company_id = ${companyId} AND deleted_at IS NULL
     RETURNING like_count AS value`,
  );
  const row = rows.rows[0];
  return row ? Number(row.value) : null;
}

/**
 * Cộng `delta` vào `feed_tags.usage_count` cho một LÔ thẻ — MỘT câu lệnh, không N câu.
 *
 * `feed_tags` KHÔNG bao giờ bị xoá (từ điển) nên không có vế `deleted_at`.
 */
export async function bumpTagUsage(
  tx: TenantTx,
  companyId: string,
  tagIds: readonly string[],
  delta: number,
): Promise<void> {
  if (tagIds.length === 0) return;
  await tx
    .update(feedTags)
    .set({ usageCount: sql`${feedTags.usageCount} + ${delta}` })
    .where(and(eq(feedTags.companyId, companyId), inArray(feedTags.id, [...tagIds])));
}

/**
 * Khôi phục một bài đã xoá mềm — **đối xứng THẬT với `softDeletePostTx`** (plan §2 D10).
 *
 * ┌─ VÌ SAO HÀM NÀY TỒN TẠI DÙ BE-1 KHÔNG CÓ ROUTE RESTORE ────────────────────────────────────────┐
 * │ `done_when` đòi bài xoá mềm biến khỏi feed/đếm/saved TRONG CÙNG TX — tức lúc xoá, bộ đếm của     │
 * │ bài cha (và `feed_tags.usage_count`) bị GIẢM. SPEC-16 §16 lại đòi bộ đếm "đảo ngược được" khi     │
 * │ khôi phục. Hai vế đó chỉ cùng đúng khi có một hàm khôi phục đối xứng: `UPDATE … SET deleted_at    │
 * │ = NULL` làm tay chỉ dựng lại HÀNG, không dựng lại con số.                                        │
 * │ Không có hàm này thì ca test R18 hoặc đỏ, hoặc bị viết yếu cho xanh (chỉ kiểm cột `deleted_at`)   │
 * │ — tức xanh giả trên đúng bất biến nó phải gác.                                                   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Owner chốt 21/09/2026: giữ lời hứa «thùng rác» của SPEC-16 §3.6/§13.1/§7** ⇒ route HTTP khôi
 * phục + đăng ký vào recycle-bin registry thuộc WO `S16-SOCIAL-BE-3`. Hàm này là nền cho nó; đừng
 * xoá vì "chưa ai gọi".
 *
 * Đếm lại TỪ NGUỒN (`COUNT(*)` trên hàng sống) chứ không cộng-ngược một `delta` đã nhớ: giữa lúc xoá
 * và lúc khôi phục, bình luận/cảm xúc có thể đã đổi, nên delta cũ là một con số hết hạn.
 */
export async function restorePostTx(
  tx: TenantTx,
  companyId: string,
  postId: string,
): Promise<boolean> {
  const restored = await tx
    .update(feedPosts)
    .set({ deletedAt: null, deletedBy: null, status: "published", updatedAt: new Date() })
    .where(
      and(
        eq(feedPosts.id, postId),
        eq(feedPosts.companyId, companyId),
        sql`${feedPosts.deletedAt} IS NOT NULL`,
      ),
    )
    .returning({ id: feedPosts.id });
  if (restored.length === 0) return false;

  // Đếm lại từ nguồn — cùng tx, một câu cho mỗi bộ đếm.
  await tx.execute(sql`
    UPDATE feed_posts p
       SET comment_count = (SELECT count(*) FROM feed_comments c
                             WHERE c.company_id = p.company_id AND c.post_id = p.id
                               AND c.deleted_at IS NULL),
           like_count    = (SELECT count(*) FROM feed_reactions r
                             WHERE r.company_id = p.company_id AND r.target_type = 'post'
                               AND r.target_id = p.id),
           view_count    = (SELECT count(*) FROM feed_post_views v
                             WHERE v.company_id = p.company_id AND v.post_id = p.id)
     WHERE p.id = ${postId} AND p.company_id = ${companyId}
  `);

  // Thẻ: bài sống lại thì mỗi thẻ còn gắn với nó được +1 lượt dùng.
  const tagRows = await tx
    .select({ tagId: feedPostTags.tagId })
    .from(feedPostTags)
    .where(and(eq(feedPostTags.companyId, companyId), eq(feedPostTags.postId, postId)));
  await bumpTagUsage(
    tx,
    companyId,
    tagRows.map((r) => r.tagId),
    1,
  );

  return true;
}

/**
 * Xoá mềm một bài + hạ mọi bộ đếm phụ thuộc, CÙNG TX (đối xứng với `restorePostTx`).
 *
 * Bình luận con KHÔNG bị đánh dấu xoá từng hàng: vị từ visibility của bình luận đi qua bài cha
 * (`assertCommentVisible` JOIN `feed_posts` + `visiblePostCondition`), nên bài chết là cả cây bình
 * luận biến mất khỏi mọi đường đọc. Đánh dấu từng hàng sẽ làm việc khôi phục không phân biệt được
 * bình luận "chết theo bài" với bình luận "bị xoá riêng trước đó".
 */
export async function softDeletePostTx(
  tx: TenantTx,
  companyId: string,
  postId: string,
  actorUserId: string,
): Promise<boolean> {
  const now = new Date();
  const deleted = await tx
    .update(feedPosts)
    .set({
      deletedAt: now,
      deletedBy: actorUserId,
      status: "deleted",
      updatedAt: now,
      updatedBy: actorUserId,
    })
    .where(
      and(
        eq(feedPosts.id, postId),
        eq(feedPosts.companyId, companyId),
        sql`${feedPosts.deletedAt} IS NULL`,
      ),
    )
    .returning({ id: feedPosts.id });
  if (deleted.length === 0) return false;

  const tagRows = await tx
    .select({ tagId: feedPostTags.tagId })
    .from(feedPostTags)
    .where(and(eq(feedPostTags.companyId, companyId), eq(feedPostTags.postId, postId)));
  await bumpTagUsage(
    tx,
    companyId,
    tagRows.map((r) => r.tagId),
    -1,
  );

  return true;
}

/**
 * Xoá mềm một bình luận + hạ `comment_count` của bài cha, CÙNG TX.
 *
 * @returns `false` khi bình luận đã bị xoá trước đó (gọi lại là no-op, không phải lỗi).
 */
export async function softDeleteCommentTx(
  tx: TenantTx,
  companyId: string,
  commentId: string,
  postId: string,
  actorUserId: string,
): Promise<boolean> {
  const now = new Date();
  const deleted = await tx
    .update(feedComments)
    .set({ deletedAt: now, deletedBy: actorUserId, updatedAt: now, updatedBy: actorUserId })
    .where(
      and(
        eq(feedComments.id, commentId),
        eq(feedComments.companyId, companyId),
        sql`${feedComments.deletedAt} IS NULL`,
      ),
    )
    .returning({ id: feedComments.id });
  if (deleted.length === 0) return false;

  await bumpPostCounter(tx, companyId, postId, "commentCount", -1, false);
  return true;
}

// ─────────── S16-SOCIAL-BE-2A — bộ đếm `feed_groups.member_count` (D10, khối additive) ───────────

/** Trạng thái hàng `feed_group_members` — `null` = hàng KHÔNG tồn tại (trước khi thêm / sau khi xoá). */
export type FeedGroupMemberState = "active" | "pending" | null;

/**
 * Delta của `member_count` suy TỪ CHUYỂN TRẠNG THÁI CỦA HÀNG, **không phải từ tên route** (D10).
 *
 * ┌─ VÌ SAO KHÔNG PHẢI MỘT BẢNG THEO ROUTE ────────────────────────────────────────────────────────┐
 * │ SPEC-16 §13.6 định nghĩa `member_count = COUNT(*) WHERE status='active'`. Bảy dòng của bảng     │
 * │ delta trong plan (`031` +1 · `035` public +1 · `035` private 0 · `038` approve +1 · `038` reject │
 * │ 0 · `038` đổi vai trò 0 · `036`/`039` −1 CHỈ KHI hàng bị xoá đang `active`) là BẢY HỆ QUẢ của   │
 * │ đúng một phép tính: «số hàng active SAU» trừ «số hàng active TRƯỚC» cho CHÍNH hàng đó.          │
 * │ Viết theo route là mời hai lớp lỗi đã có tên: quên dòng `031` ⇒ nhóm mới có 1 hàng active mà     │
 * │ `member_count = 0` (bất biến vỡ ở thao tác ĐẦU TIÊN); trừ nhầm khi mời ra / huỷ một hàng         │
 * │ `pending` ⇒ chạm `chk_feed_groups_member_count` (`>= 0`) ⇒ **500**, hoặc lệch âm hỏng CÂM.       │
 * │ Hàm thuần + vét cạn ⇒ route mới của BE-2B/BE-2C chỉ cần nói TRƯỚC/SAU, không phải nhớ bảng.     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export function groupMemberCountDelta(
  before: FeedGroupMemberState,
  after: FeedGroupMemberState,
): number {
  const counted = (s: FeedGroupMemberState) => (s === "active" ? 1 : 0);
  return counted(after) - counted(before);
}

/**
 * Cộng `delta` vào `feed_groups.member_count`, CÙNG TX với hàng thành viên vừa đổi.
 *
 * Cùng luật SQL-không-JS của cả file (khuôn `bumpPostCounter`): sàn 0 là việc của
 * `chk_feed_groups_member_count`, KHÔNG phải `Math.max` ở JS — kẹp ở JS chỉ biến một lỗi đếm thật
 * thành một con số sai im lặng.
 *
 * ⚠️ **KHÔNG lọc `deleted_at IS NULL`** — ngoại lệ THỨ HAI của luật D13 (thứ nhất là neo `FOR UPDATE`
 * của `lockGroupRowTx`), và vì một lý do khác: D13 nói về vị từ **hiển thị/audience**, còn đây là bảo
 * trì bộ đếm. Bộ đếm phải đi theo những hàng THẬT SỰ đã đổi; bỏ qua câu UPDATE vì nhóm vừa bị xoá
 * mềm là để lại một `member_count` nói dối về một nhóm còn có thể được khôi phục.
 *
 * ⚠️ **KHÔNG bump `updated_at`**: người vào/ra nhóm không phải là "nhóm vừa được sửa" — cùng lý lẽ
 * với `last_activity_at` ở đầu file.
 */
export async function bumpGroupMemberCount(
  tx: TenantTx,
  companyId: string,
  groupId: string,
  delta: number,
): Promise<number | null> {
  if (delta === 0) return null;
  // 🔴 `RETURNING` + ném khi 0 dòng (FULL gate 22/09, `silent-failure-hunter` LOW-1) — cùng khuôn
  // `bumpPostCounter`. Một `UPDATE` khớp 0 dòng (sai `groupId`/`companyId` từ một call-site tương
  // lai của BE-2B/BE-2C) mà trả `void` là bộ đếm lệch VĨNH VIỄN, không exception, không log: đúng
  // hình dạng "thành công RỖNG" mà WO này đi đóng. Ném ở đây làm cả tx quay lui — thà 500 ồn còn
  // hơn một con số nói dối. Không có đường gọi hợp lệ nào khớp 0 dòng: mọi call-site đã xác nhận
  // nhóm tồn tại trong CÙNG tx (nhóm xoá MỀM vẫn khớp — câu này cố ý không lọc `deleted_at`).
  const rows = await tx.execute<{ value: number }>(
    sql`UPDATE feed_groups
           SET member_count = member_count + ${delta}
         WHERE id = ${groupId} AND company_id = ${companyId}
     RETURNING member_count AS value`,
  );
  const row = rows.rows[0];
  if (!row) {
    throw new Error(`bumpGroupMemberCount: không có hàng feed_groups nào khớp (group=${groupId})`);
  }
  return Number(row.value);
}

/**
 * Cộng `delta` vào `feed_poll_options.vote_count` cho MỘT tập lựa chọn, CÙNG TX với hàng phiếu.
 *
 * ┌─ 🔴 BỘ ĐẾM NGUY HIỂM NHẤT CỦA MODULE ──────────────────────────────────────────────────────────┐
 * │ `vote_count` **KHÔNG nằm trong 5 cột** mà SPEC-16 §13.6 liệt kê cho script đối soát định kỳ,   │
 * │ nhưng nó có `chk_feed_poll_options_vote_count (vote_count >= 0)`. Hệ quả của cặp đó rất xấu:   │
 * │   · lệch DƯƠNG  → kết quả bình chọn SAI. Không lỗi, không log, không ai biết.                   │
 * │   · lệch ÂM     → 23514 ⇒ 500.                                                                 │
 * │ Tức là **nhánh dễ phát hiện lại là nhánh ít xảy ra hơn**. Lưới duy nhất đáng tin là bất biến    │
 * │ `Σ vote_count == COUNT(*) phiếu` kiểm sau MỖI bước của chuỗi vote/đổi/rút (ca `C-2`).           │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Cùng luật SQL-không-JS của cả file: sàn 0 là việc của CHECK, KHÔNG phải `Math.max` ở JS.
 */
export async function bumpPollOptionVotes(
  tx: TenantTx,
  companyId: string,
  optionIds: readonly string[],
  delta: number,
): Promise<number> {
  if (delta === 0 || optionIds.length === 0) return 0;

  const rows = await tx.execute<{ id: string }>(
    sql`UPDATE feed_poll_options
           SET vote_count = vote_count + ${delta}
         WHERE company_id = ${companyId}
           AND id IN (${sql.join(
             optionIds.map((id) => sql`${id}`),
             sql`, `,
           )})
     RETURNING id`,
  );

  // 🔴 `RETURNING` + đối chiếu SỐ LƯỢNG, không chỉ "có dòng nào không" — khuôn `bumpGroupMemberCount`
  // siết thêm một bậc. Khớp THIẾU dòng nghĩa là một `optionId` không thuộc tenant/poll này đã lọt
  // qua cổng `assertOptionsBelongToPoll`, và bỏ qua nó để lại bộ đếm lệch VĨNH VIỄN trong im lặng.
  // Ném ⇒ cả tx quay lui: thà 500 ồn còn hơn một kết quả bình chọn nói dối.
  if (rows.rows.length !== optionIds.length) {
    throw new Error(
      `bumpPollOptionVotes: khớp ${rows.rows.length}/${optionIds.length} hàng feed_poll_options ` +
        `(company=${companyId}) — có optionId không thuộc tenant/poll này`,
    );
  }
  return rows.rows.length;
}

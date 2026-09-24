import { Injectable } from "@nestjs/common";
import type { FeedIdeaStatusDto } from "@mediaos/contracts";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { feedIdeas, feedPosts } from "../db/schema/social";
import { users } from "../db/schema/users";
import { SocialAccessService } from "./social-access.service";
import type { SocialViewerContext } from "./social.types";

/** Một dòng sáng kiến của `045`. `reviewNote` ở đây là giá trị THÔ — service quyết định ai thấy (D19). */
export interface IdeaListRow {
  ideaId: string;
  postId: string;
  status: string;
  body: string | null;
  authorUserId: string;
  reviewNote: string | null;
  /** Tên NGƯỜI DUYỆT. KHÔNG chiếu `users.id` — xem docblock `listIdeasTx`. */
  reviewerName: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** Ảnh chụp trạng thái CŨ, đọc dưới khoá hàng — nguyên liệu của `from` trong audit/FSM (D5/D6). */
export interface IdeaForReviewRow {
  ideaId: string;
  status: FeedIdeaStatusDto;
  authorUserId: string;
}

/**
 * S16-SOCIAL-BE-2B-2 — SQL của SÁNG KIẾN: `045` (danh sách) · `046` (xét duyệt).
 *
 * ┌─ 🔴 VÌ SAO `046` LÀ HAI CÂU, KHÔNG PHẢI MỘT (D5 · D6) ─────────────────────────────────────────┐
 * │ Khuôn `social-reports.repository.ts#resolveReport` làm một câu `UPDATE … WHERE status='open' …   │
 * │ RETURNING {id}` và caller trả 409 khi rỗng. Áp nguyên xi vào đây là SAI ở HAI chỗ:               │
 * │                                                                                                 │
 * │  (a) **`UPDATE … RETURNING` trả giá trị SAU cập nhật** ⇒ không lấy được `status` CŨ từ chính câu  │
 * │      đó, mà `from` là thứ audit và FSM đều cần. (Khuôn kia cũng chỉ `.returning({id})` — nó không │
 * │      cần `from` nên không lộ ra giới hạn này.)                                                   │
 * │                                                                                                 │
 * │  (b) **0 hàng KHÔNG chỉ có nghĩa "thua đua".** `assertPostVisible` cho bài `type='share'` đi QUA  │
 * │      (nó chỉ gác TẦM NHÌN, không gác loại bài), nên một `PATCH /social/posts/{bài share}/idea/    │
 * │      review` cũng khớp 0 hàng — và nuốt nó vào 409 nghĩa là trả «chuyển trạng thái sáng kiến      │
 * │      sai» cho một bài KHÔNG HỀ là sáng kiến. Sai mã, sai nghĩa, và che mất một 404 thật.         │
 * │                                                                                                 │
 * │ ⇒ `getIdeaForReviewTx` (`SELECT … FOR UPDATE`, CÙNG tx, chạy TRƯỚC) phân biệt hai ca: không có   │
 * │ hàng ⇒ **404**; có hàng nhưng `UPDATE` khớp 0 ⇒ **409** (thua đua thật). `FOR UPDATE` giữ hàng     │
 * │ tới hết tx nên người thứ hai CHỜ rồi đọc `status` MỚI ⇒ FSM của họ tự từ chối.                   │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class SocialIdeasRepository {
  constructor(private readonly access: SocialAccessService) {}

  /**
   * `045` — sáng kiến actor THẤY ĐƯỢC, phân trang OFFSET (khuôn `listPollsTx`).
   *
   * `visiblePostCondition` NGAY TRONG CÂU: sáng kiến thừa hưởng phạm vi BÀI CHA, không có cặp quyền
   * đọc riêng (cấp cho nó một cặp riêng là đẻ ra đường đọc thứ hai vào cùng dữ liệu với luật khác —
   * `read-path-gate-pair-must-match-download-pair`).
   *
   * ┌─ 🔴 CHIẾU TÊN NGƯỜI DUYỆT, KHÔNG CHIẾU `reviewed_by` THÔ (D19) ─────────────────────────────────┐
   * │ `feed_ideas.reviewed_by` là một `users.id`. Route này gác **chỉ `view:feed`** — tức MỌI nhân      │
   * │ viên — nên chiếu cột đó ra là biến danh sách sáng kiến thành bản đồ user-id của tầng quản lý,     │
   * │ cùng lớp lỗi mà `feedPostAuthorSchema` (API-19 §6.1) đã bỏ `userId` để tránh. LEFT JOIN lấy       │
   * │ `full_name` (người duyệt có thể đã nghỉ ⇒ FK `SET NULL` ⇒ `reviewerName` null, hợp lệ).           │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * `reviewNote` trả về THÔ ở đây và bị service MASK theo người xem — tách hai tầng có chủ đích: câu
   * SQL không biết `approve:feed-idea` của người xem, còn service thì không nên viết SQL thứ hai.
   */
  async listIdeasTx(
    tx: TenantTx,
    viewer: SocialViewerContext,
    opts: { status?: FeedIdeaStatusDto; limit: number; offset: number },
  ): Promise<{ rows: IdeaListRow[]; total: number }> {
    const where = [
      eq(feedIdeas.companyId, viewer.companyId),
      this.access.visiblePostCondition(viewer),
    ];
    if (opts.status) where.push(eq(feedIdeas.status, opts.status));

    const rows = await tx
      .select({
        ideaId: feedIdeas.id,
        postId: feedIdeas.postId,
        status: feedIdeas.status,
        body: feedPosts.body,
        authorUserId: feedPosts.authorUserId,
        reviewNote: feedIdeas.reviewNote,
        reviewerName: users.fullName,
        reviewedAt: feedIdeas.reviewedAt,
        createdAt: feedIdeas.createdAt,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(feedIdeas)
      .innerJoin(
        feedPosts,
        and(eq(feedPosts.companyId, feedIdeas.companyId), eq(feedPosts.id, feedIdeas.postId)),
      )
      .leftJoin(
        users,
        and(eq(users.id, feedIdeas.reviewedBy), eq(users.companyId, feedIdeas.companyId)),
      )
      .where(and(...where))
      // Khoá phá-hoà DUY NHẤT ở cuối: `created_at` mặc định `now()` = mốc BẮT ĐẦU tx ⇒ hàng tạo trong
      // cùng một tx (seed/import) giống hệt nhau, và OFFSET không có chốt cuối làm hàng LẶP hoặc MẤT
      // giữa hai trang mà không lỗi gì (API-19 §6.4).
      .orderBy(sql`${feedIdeas.createdAt} DESC`, asc(feedIdeas.id))
      .limit(opts.limit)
      .offset(opts.offset);

    const page = rows.map(({ total: _total, ...row }) => row);
    if (rows.length > 0) return { rows: page, total: rows[0].total };
    if (opts.offset === 0) return { rows: page, total: 0 };

    const [totalRow] = await tx
      .select({ n: count() })
      .from(feedIdeas)
      .innerJoin(
        feedPosts,
        and(eq(feedPosts.companyId, feedIdeas.companyId), eq(feedPosts.id, feedIdeas.postId)),
      )
      .where(and(...where));
    return { rows: page, total: Number(totalRow?.n ?? 0) };
  }

  /**
   * D5/D6 — ảnh chụp sáng kiến DƯỚI KHOÁ HÀNG, chạy TRƯỚC `reviewTx` trong CÙNG tx.
   *
   * Trả `null` ⇔ bài này KHÔNG có hàng `feed_ideas` (bài `share`/`news`/`poll`/`kudos`, hoặc tenant
   * khác) ⇒ caller trả **404 `SOCIAL-ERR-001`**, KHÔNG 409.
   *
   * ⚠️ `FOR UPDATE` là vế chống-đua: hai người cùng duyệt thì người thứ hai CHỜ ở đây tới khi tx thứ
   * nhất commit, rồi đọc `status` MỚI ⇒ `assertIdeaTransition` của họ tự từ chối bằng 409. Không có
   * `FOR UPDATE` thì cả hai đọc cùng `status` cũ, cả hai qua FSM, và vế `WHERE status = <from>` của
   * `reviewTx` là lưới duy nhất còn lại — nó vẫn chặn được hàng thứ hai, nhưng khi đó 409 đến từ một
   * phép so lệch ảnh chụp chứ không từ một quyết định, và audit của người thứ hai đã KHÔNG được ghi
   * vì cùng lý do (ca `I-6` đếm đúng bất biến này).
   *
   * ⚠️ `feedIdeas.status` là `varchar` trong Drizzle nhưng tập giá trị bị `chk_feed_ideas_status` ép —
   * ép kiểu về `FeedIdeaStatusDto` ở ĐÂY, một chỗ, để FSM nhận đúng kiểu union thay vì `string`.
   */
  async getIdeaForReviewTx(
    tx: TenantTx,
    companyId: string,
    postId: string,
  ): Promise<IdeaForReviewRow | null> {
    const rows = await tx.execute(
      sql`SELECT i.id AS idea_id, i.status AS status, p.author_user_id AS author_user_id
            FROM feed_ideas i
            JOIN feed_posts p ON p.company_id = i.company_id AND p.id = i.post_id
           WHERE i.company_id = ${companyId} AND i.post_id = ${postId}
           FOR UPDATE OF i`,
    );

    const row = rows.rows[0] as
      | { idea_id: string; status: string; author_user_id: string }
      | undefined;
    if (!row) return null;
    return {
      ideaId: row.idea_id,
      status: row.status as FeedIdeaStatusDto,
      authorUserId: row.author_user_id,
    };
  }

  /**
   * D5 — MỘT câu `UPDATE` bốn cột + `WHERE status = <from>` + `RETURNING {id}`.
   *
   * Trả `false` ⇔ khớp 0 hàng ⇒ caller trả **409 `SOCIAL-ERR-019`** (thua đua: ai đó đã chuyển trạng
   * thái giữa `getIdeaForReviewTx` và câu này — chỉ xảy ra nếu `FOR UPDATE` bị bỏ, nên `false` ở đây
   * cũng là tín hiệu lưới trên đã hỏng).
   *
   * 🔴 **Bốn cột đi CÙNG NHAU, không tách.** `chk_feed_ideas_reviewed_pair` đòi
   * `reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL` với mọi `status` ngoài
   * `submitted`/`under_review`. Quên MỘT trong hai ⇒ `23514` ⇒ **500** (ĐO CỔNG: bỏ `reviewedAt` ⇒ ca
   * `I-5` đỏ). Và `chk_feed_ideas_reject_note` đòi note không-rỗng-sau-btrim khi `rejected` — vế đó
   * service đã ép TRƯỚC bằng 422 có mã, nên tới đây nó chỉ còn là lưới cuối.
   *
   * 🔴 **`reviewNote` GHI ĐÈ mọi lượt (D21), kể cả về `null`.** `reviewed_by`/`reviewed_at` cũng là vết
   * của LẦN CUỐI; để `review_note` giữ giá trị cũ sẽ thành ba cột kể ba câu chuyện khác nhau về cùng
   * một hàng. Hệ quả ĐO ĐƯỢC (ca `I-12`): `submitted→under_review` kèm note A rồi `→accepted` không
   * note ⇒ note A MẤT. Ai cần lịch sử đọc `audit_logs` — mỗi lượt một dòng.
   *
   * ⚠️ **CẤM mapped-write** (`.set({ ...dto })`): DTO của `046` chỉ có 2 trường hôm nay, nhưng một lượt
   * nới DTO sau này sẽ âm thầm ghi thẳng trường mới vào bảng. Liệt kê TƯỜNG MINH bốn cột.
   */
  async reviewTx(
    tx: TenantTx,
    companyId: string,
    input: {
      ideaId: string;
      from: FeedIdeaStatusDto;
      to: FeedIdeaStatusDto;
      reviewNote: string | null;
      reviewerUserId: string;
      now: Date;
    },
  ): Promise<boolean> {
    const updated = await tx
      .update(feedIdeas)
      .set({
        status: input.to,
        reviewedBy: input.reviewerUserId,
        reviewedAt: input.now,
        reviewNote: input.reviewNote,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(feedIdeas.companyId, companyId),
          eq(feedIdeas.id, input.ideaId),
          // Vế chống-đua ở tầng DỮ LIỆU: lượt thứ hai cho cùng `from` khớp 0 hàng ⇒ không audit thứ
          // hai, không outbox thứ hai (ca `I-6`).
          eq(feedIdeas.status, input.from),
        ),
      )
      .returning({ id: feedIdeas.id });

    return updated.length > 0;
  }
}

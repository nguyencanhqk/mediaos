import { Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { feedPollOptions, feedPollVotes, feedPolls, feedPosts } from "../db/schema/social";
import { SocialAccessService } from "./social-access.service";
import type { SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-2B-1 — truy cập dữ liệu BÌNH CHỌN (`SOCIAL-API-040..044` + system-job).
 *
 * ┌─ BA BẤT BIẾN FILE NÀY GIỮ ────────────────────────────────────────────────────────────────────┐
 * │ 1. **Một neo khoá cho mọi đường ghi đi qua MỘT hàng poll cụ thể** (`lockPollRowTx`). Không có  │
 * │    nó thì `voteTx` đọc `status` rồi INSERT ở hai câu khác nhau, và một `044` chen vào giữa làm │
 * │    phiếu rơi vào bình chọn đã đóng. Nó cũng chặn **deadlock nâng-cấp-khoá**: INSERT phiếu lấy  │
 * │    `FOR KEY SHARE` trên hàng `feed_poll_options` (kiểm RI), rồi `bumpPollOptionVotes` đòi khoá │
 * │    GHI trên CHÍNH hàng đó — đúng lớp lỗi mà FULL gate của BE-2A đã bắt ở `035`.                 │
 * │    🔴 Chân trụ của chứng minh: **không writer nào khác chạm `feed_poll_options`** (lựa chọn là │
 * │    BẤT BIẾN sau khi tạo — không route nào sửa/thêm/xoá), nên thứ tự khoá toàn hệ là DUY NHẤT:  │
 * │    `feed_polls → feed_poll_options`. Hai tx cùng UPDATE một hàng option bắt buộc đã tuần tự    │
 * │    hoá trên hàng `feed_polls` trước đó.                                                        │
 * │    ⚠️ **Job đóng poll KHÔNG neo** — nó set-based một câu; xem `closeExpiredTx`.                 │
 * │                                                                                                │
 * │ 2. **`single_choice` đọc từ `feed_polls` NGAY TRONG câu INSERT phiếu.** Cột cố ý không có       │
 * │    DEFAULT: quên ghi ⇒ 23502 (ồn ào, phát hiện ngay). Nhưng ghi SAI GIÁ TRỊ thì tệ hơn nhiều — │
 * │    partial index `feed_poll_votes_single_uq` không áp và **phiếu đôi lọt IM LẶNG**. Đọc ra JS   │
 * │    rồi ghi lại là mở đúng cửa sổ đó.                                                            │
 * │                                                                                                │
 * │ 3. **`optionId` phải thuộc đúng `pollId`, kiểm CÙNG TX trước mỗi INSERT** (nợ (e) của DB-2).   │
 * │    `feed_poll_votes` có HAI FK RỜI — `(company,poll)` và `(company,option)` — không cái nào    │
 * │    ràng option THUỘC poll. Gửi chéo poll thì INSERT vẫn thành công và `vote_count` của một     │
 * │    bình chọn KHÁC lệch vĩnh viễn.                                                               │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Hàng `feed_polls` đủ để quyết định cho/chặn một lượt ghi. */
export interface PollForWrite {
  id: string;
  postId: string;
  question: string;
  status: "open" | "closed";
  multipleChoice: boolean;
  isAnonymous: boolean;
  closesAt: Date | null;
  /**
   * "Đã quá hạn" tính bằng đồng hồ **DB**, trong CÙNG câu đọc hàng poll.
   *
   * 🔴 FULL gate 23/09/2026 (`santa-A` F1 · `santa-B` F3): cổng ghi TRƯỚC ĐÂY so
   * `closesAt.getTime() <= Date.now()` — đồng hồ **APP** — trong khi job (`closeExpiredTx`) so
   * `closes_at <= now()` — đồng hồ **DB**. Một bất biến, hai đồng hồ: app chậm hơn DB δ thì phiếu
   * vẫn được nhận trong δ **sau** khi hệ thống đã coi bình chọn hết hạn và job đã được phép đóng nó.
   * Tính trong SQL ⇒ cổng ghi và job dùng đúng một nguồn thời gian.
   */
  expired: boolean;
}

/** Một hàng của `040` — thông tin bình chọn kèm khoá bài để FE mở chi tiết. */
export interface PollListRow {
  pollId: string;
  postId: string;
  question: string;
  status: "open" | "closed";
  isAnonymous: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
}

/** Một hàng poll vừa bị job đóng — đủ để dựng NOTI-035 mà không phải đọc lại. */
export interface ClosedPollRow {
  pollId: string;
  postId: string;
  question: string;
}

@Injectable()
export class SocialPollsRepository {
  constructor(private readonly access: SocialAccessService) {}

  /**
   * Neo chống-đua cho MỘT hàng poll. Gọi **đầu tiên** trong `voteTx` · `withdrawVoteTx` ·
   * `closeManualTx`. Khuôn `SocialGroupAccessService.lockGroupRowTx`.
   *
   * Không trả gì: người gọi đọc lại trạng thái SAU khoá bằng `getPollForWriteTx`. Đọc trước khoá
   * rồi quyết định là đúng TOCTOU mà neo này sinh ra để đóng.
   */
  async lockPollRowTx(tx: TenantTx, companyId: string, pollId: string): Promise<void> {
    const locked = await tx.execute(
      sql`SELECT 1 FROM feed_polls WHERE company_id = ${companyId} AND id = ${pollId} FOR UPDATE`,
    );
    // 🔴 FULL gate 23/09/2026 — BA reviewer độc lập hội tụ (`security-reviewer` F3 ·
    // `database-reviewer` L-1 · orchestrator). Khớp 0 hàng ⇒ **không khoá gì**, không lỗi, không log,
    // và người gọi vẫn tin mình đã tuần tự hoá. Đây là neo chống-đua DUY NHẤT của cả ba đường ghi và
    // là chân trụ của chứng minh không-deadlock ở docblock đầu file — tức chỗ "thành công RỖNG" đắt
    // nhất trong cụm. Cùng khuôn `bumpGroupMemberCount` / `bumpPollOptionVotes`, hai chỗ đã siết
    // đúng lớp lỗi này ở FULL gate 22/09.
    if (locked.rows.length !== 1) {
      throw new Error(`lockPollRowTx: không khoá được hàng feed_polls nào (poll=${pollId})`);
    }
  }

  /** Hàng poll của một BÀI. `null` = bài không mang bình chọn (⇒ 404 `SOCIAL-ERR-001`). */
  async getPollByPostTx(
    tx: TenantTx,
    companyId: string,
    postId: string,
  ): Promise<PollForWrite | null> {
    const [row] = await tx
      .select({
        id: feedPolls.id,
        postId: feedPolls.postId,
        question: feedPolls.question,
        status: feedPolls.status,
        multipleChoice: feedPolls.multipleChoice,
        isAnonymous: feedPolls.isAnonymous,
        closesAt: feedPolls.closesAt,
        // Xem docblock `PollForWrite.expired` — vế hạn phải đo bằng đồng hồ DB, không `Date.now()`.
        expired: sql<boolean>`${feedPolls.closesAt} IS NOT NULL AND ${feedPolls.closesAt} <= now()`,
      })
      .from(feedPolls)
      .where(and(eq(feedPolls.companyId, companyId), eq(feedPolls.postId, postId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Nợ (e) — số lựa chọn THUỘC ĐÚNG poll này trong tập `optionIds`.
   *
   * Người gọi so với `optionIds.length` (sau khi đã khử trùng lặp). Trả số đếm thay vì boolean để
   * chỗ ném lỗi nhìn thấy được "khớp bao nhiêu / gửi bao nhiêu" khi điều tra.
   */
  async countOptionsOfPollTx(
    tx: TenantTx,
    companyId: string,
    pollId: string,
    optionIds: readonly string[],
  ): Promise<number> {
    if (optionIds.length === 0) return 0;
    const rows = await tx
      .select({ id: feedPollOptions.id })
      .from(feedPollOptions)
      .where(
        and(
          eq(feedPollOptions.companyId, companyId),
          eq(feedPollOptions.pollId, pollId),
          inArray(feedPollOptions.id, [...optionIds]),
        ),
      );
    return rows.length;
  }

  /**
   * Xoá MỌI phiếu của `userId` trong poll, trả về các `optionId` vừa mất một phiếu.
   *
   * `RETURNING` là cả điểm của hàm: người gọi phải `-1` cho ĐÚNG những option này. Trả `void` rồi
   * tự đoán "chắc là option cũ" là cách bộ đếm lệch ở luồng đổi phiếu BÌNH THƯỜNG — không cần đua.
   *
   * ⚠️ DELETE **CỨNG**, ngoại lệ của bất biến "không hard-delete", đã ký ở **DB-17 §4 dòng 121**
   * («đổi/rút phiếu khi poll còn `open`»). `0580:549` cấp đúng `SELECT, INSERT, DELETE` cho app role
   * — bảng này cố ý KHÔNG có `UPDATE`.
   */
  async deleteVotesOfUserTx(
    tx: TenantTx,
    companyId: string,
    pollId: string,
    userId: string,
  ): Promise<string[]> {
    const deleted = await tx
      .delete(feedPollVotes)
      .where(
        and(
          eq(feedPollVotes.companyId, companyId),
          eq(feedPollVotes.pollId, pollId),
          eq(feedPollVotes.userId, userId),
        ),
      )
      .returning({ optionId: feedPollVotes.optionId });
    return deleted.map((r) => r.optionId);
  }

  /**
   * Ghi phiếu. `single_choice` lấy TỪ `feed_polls` ngay trong câu này (bất biến 2 ở docblock đầu file).
   *
   * Viết bằng SQL thô có chủ đích: `INSERT … SELECT` là cách DUY NHẤT đọc `multiple_choice` của
   * hàng poll và ghi giá trị phủ định của nó trong CÙNG MỘT câu. Bản drizzle-builder tương đương
   * buộc phải `SELECT` ra JS rồi `INSERT` lại — hai câu, và giữa chúng là cửa sổ để giá trị đổi.
   */
  async insertVotesTx(
    tx: TenantTx,
    companyId: string,
    pollId: string,
    userId: string,
    optionIds: readonly string[],
  ): Promise<number> {
    if (optionIds.length === 0) return 0;
    const inserted = await tx.execute<{ option_id: string }>(
      sql`INSERT INTO feed_poll_votes (company_id, poll_id, option_id, user_id, single_choice)
          SELECT ${companyId}, ${pollId}, opt.id, ${userId}, NOT p.multiple_choice
            FROM feed_polls p
            JOIN feed_poll_options opt
              ON opt.company_id = p.company_id AND opt.poll_id = p.id
           WHERE p.company_id = ${companyId}
             AND p.id = ${pollId}
             AND opt.id IN (${sql.join(
               optionIds.map((id) => sql`${id}`),
               sql`, `,
             )})
       RETURNING option_id`,
    );
    // 🔴 FULL gate 23/09/2026 — BỐN reviewer hội tụ (`santa-A` F3 · `santa-B` F4 ·
    // `database-reviewer` H-2 · `silent-failure-hunter` L-1). `INSERT … SELECT` ghi ÍT hơn
    // `optionIds` là "thành công RỖNG": câu không ném gì, rồi `bumpPollOptionVotes(+1)` ở service bơm
    // đủ ⇒ `vote_count` lệch **DƯƠNG** vĩnh viễn — đúng nhánh mà plan §9 gọi là rủi ro số 1 (không
    // lỗi, không log, chỉ là kết quả bình chọn SAI). Hôm nay chưa với tới được (cổng D4 dùng đúng bộ
    // vị từ này, hàng poll đang bị `FOR UPDATE`, và app role không có GRANT DELETE trên
    // `feed_polls`/`feed_poll_options`) — nhưng bất biến đứng trên BA chân ngoài hàm, không trên
    // bằng chứng tại chỗ. Trả số hàng để service đối chiếu.
    return inserted.rows.length;
  }

  /**
   * Đóng poll bằng TAY (`044`). Trả `false` khi không khớp hàng nào ⇒ người gọi 409 `SOCIAL-ERR-016`.
   *
   * `WHERE status = 'open'` là phần làm nên tính idempotent: đóng một poll đã đóng khớp 0 dòng,
   * KHÔNG ghi đè `closed_at` cũ và KHÔNG sinh dòng audit/NOTI thứ hai.
   *
   * 🔴 Ghi tường minh ĐÚNG 2 cột nghiệp vụ + `updated_at`. **Cấm mapped-write** (truyền một object
   * dựng động): drizzle **bỏ qua IM LẶNG** khoá không phải là cột, nên một `.set(patch)` với khoá
   * gõ sai sẽ chạy thành công mà không ghi gì. `social-poll-flags-structure.spec.ts` gác tập cột này.
   */
  async closeManualTx(tx: TenantTx, companyId: string, pollId: string): Promise<boolean> {
    // MỘT mốc cho cả hai cột — hai lần `new Date()` cho ra hai giá trị lệch nhau tới 1ms trong cùng
    // một hành động (`santa-A` F8). Khuôn `softDeletePostTx` (`social-counters.ts`) đã làm vậy.
    const now = new Date();
    const updated = await tx
      .update(feedPolls)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(
        and(
          eq(feedPolls.companyId, companyId),
          eq(feedPolls.id, pollId),
          eq(feedPolls.status, "open"),
        ),
      )
      .returning({ id: feedPolls.id });
    return updated.length > 0;
  }

  /**
   * Đóng MỌI poll quá hạn của một tenant — thân của system-job.
   *
   * Vị từ của sub-select giữ ĐÚNG hình dạng `idx_feed_polls_open_deadline`
   * (`(company_id, closes_at) WHERE status='open' AND closes_at IS NOT NULL`) + `ORDER BY closes_at`
   * khớp thứ tự index; `EXISTS` chỉ là filter phía trên nên không phá index cond.
   *
   * ┌─ FULL GATE 23/09/2026 — HAI vá vào câu này ────────────────────────────────────────────────────┐
   * │ 1. **Chia LÔ + `FOR UPDATE SKIP LOCKED`** (`database-reviewer` H-1 · `santa-A` F7 ·          │
   * │    `santa-B` F2 · `silent-failure-hunter` M-6). Bản cũ không `LIMIT`: một nhịp sau khi        │
   * │    `WORKERS_SCHEDULER_ENABLED=false` vài ngày có thể gặt hàng nghìn poll trong MỘT tx, ghim   │
   * │    một server-connection của PgBouncer (pool `max:20`, không `connectionTimeoutMillis`) và    │
   * │    **chặn mọi `041`/`042`/`044`** trên cả lô ở `lockPollRowTx` — không lỗi, không log, chỉ   │
   * │    TREO. Vỡ ở hàng cuối ⇒ rollback toàn phần ⇒ nhịp sau làm lại từ đầu, không tiến-độ-từng-   │
   * │    phần. `SKIP LOCKED` để job không xếp hàng sau một `044` đang mở dở.                        │
   * │    ⚠️ Vế `AND status = 'open'` ở câu NGOÀI giữ nguyên lập luận EPQ cũ (`santa-A` đã ĐO bằng   │
   * │    `EXPLAIN` rằng PG giữ qual này trong `Filter` ⇒ re-check sau khi chờ khoá) — đừng bỏ.      │
   * │ 2. **Loại bài đã XOÁ MỀM** (`security-reviewer` F5 · `santa-A` F4 · `santa-B` F1 ·          │
   * │    `silent-failure-hunter` M-2 · orchestrator — BỐN nguồn độc lập). `softDeletePostTx` KHÔNG  │
   * │    chạm `feed_polls`, nên poll của một bài trong thùng rác vẫn `open` + còn `closes_at`.      │
   * │    Bản cũ đóng nó và phát NOTI-035 mang `poll_question` + `target_url=/social/posts/{id}` cho │
   * │    tác giả ⇒ bấm vào ăn 404, và câu hỏi của bài đã xoá **tái xuất hiện qua bảng                │
   * │    `notifications`** (sống lâu hơn bài). Đường `044` không làm được vậy (`assertPostVisible`  │
   * │    chặn) ⇒ hai nửa của CÙNG một FSM đối xử khác nhau với `deleted_at`. Giờ cùng một luật.     │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  async closeExpiredTx(
    tx: TenantTx,
    companyId: string,
    limit: number,
  ): Promise<ClosedPollRow[]> {
    const rows = await tx.execute<{ id: string; post_id: string; question: string }>(
      sql`UPDATE feed_polls
             SET status = 'closed', closed_at = now(), updated_at = now()
           WHERE (company_id, id) IN (
                   SELECT company_id, id
                     FROM feed_polls
                    WHERE company_id = ${companyId}
                      AND status = 'open'
                      AND closes_at IS NOT NULL
                      AND closes_at <= now()
                      AND EXISTS (SELECT 1
                                    FROM feed_posts p
                                   WHERE p.company_id = feed_polls.company_id
                                     AND p.id = feed_polls.post_id
                                     AND p.deleted_at IS NULL)
                    ORDER BY closes_at
                    LIMIT ${limit}
                    FOR UPDATE SKIP LOCKED)
             AND status = 'open'
       RETURNING id, post_id, question`,
    );
    return rows.rows.map((r) => ({ pollId: r.id, postId: r.post_id, question: r.question }));
  }

  /**
   * `040` — danh sách bình chọn actor THẤY ĐƯỢC.
   *
   * Cổng đọc là `visiblePostCondition` của bài CHA, gọi qua `SocialAccessService` chứ không chép
   * lại: docblock của nó ghi «một luật, một bản», và bản thứ hai sẽ trôi khỏi bản gốc ngay lần đầu
   * luật audience đổi (nhánh `group` của BE-2A là ví dụ vừa xảy ra).
   *
   * Phân trang OFFSET (khuôn `030`) — API-19 §6.4 không xếp danh sách này vào nhóm cursor.
   */
  async listPollsTx(
    tx: TenantTx,
    viewer: SocialViewerContext,
    opts: { status?: "open" | "closed"; limit: number; offset: number },
  ): Promise<PollListRow[]> {
    const where = [
      eq(feedPolls.companyId, viewer.companyId),
      this.access.visiblePostCondition(viewer),
    ];
    if (opts.status) where.push(eq(feedPolls.status, opts.status));

    return tx
      .select({
        pollId: feedPolls.id,
        postId: feedPolls.postId,
        question: feedPolls.question,
        status: feedPolls.status,
        isAnonymous: feedPolls.isAnonymous,
        closesAt: feedPolls.closesAt,
        closedAt: feedPolls.closedAt,
        createdAt: feedPolls.createdAt,
      })
      .from(feedPolls)
      .innerJoin(
        feedPosts,
        and(eq(feedPosts.companyId, feedPolls.companyId), eq(feedPosts.id, feedPolls.postId)),
      )
      .where(and(...where))
      // 🔴 FULL gate 23/09/2026 — BỐN nguồn hội tụ vào MỘT dòng, hai lỗi khác nhau:
      //  · `asc(status)` trên cột `varchar` so sánh CHUỖI ⇒ `'closed' < 'open'` ⇒ bình chọn ĐÃ KẾT
      //    THÚC lên đầu danh sách, nghịch với việc chính của màn này (đi bỏ phiếu). Sắp TƯỜNG MINH.
      //  · OFFSET không có khoá phá-hoà DUY NHẤT: `created_at` mặc định `now()` = mốc BẮT ĐẦU TX nên
      //    mọi poll tạo trong CÙNG một tx (seed/import) có `created_at` GIỐNG HỆT ⇒ hàng lặp hoặc
      //    MẤT giữa hai trang, không lỗi. Khuôn `030` thật (`social-groups.repository.ts`) và `028`
      //    đều có chốt cuối; docblock trên chỉ nói "khuôn 030" nên vế này bị trôi.
      .orderBy(
        sql`CASE WHEN ${feedPolls.status} = 'open' THEN 0 ELSE 1 END`,
        sql`${feedPolls.createdAt} DESC`,
        asc(feedPolls.id),
      )
      .limit(opts.limit)
      .offset(opts.offset);
  }

  /** Các lựa chọn của poll kèm bộ đếm, theo đúng `position`. */
  async optionsWithCountsTx(
    tx: TenantTx,
    companyId: string,
    pollId: string,
  ): Promise<{ id: string; label: string; voteCount: number }[]> {
    return tx
      .select({
        id: feedPollOptions.id,
        label: feedPollOptions.label,
        voteCount: feedPollOptions.voteCount,
      })
      .from(feedPollOptions)
      .where(and(eq(feedPollOptions.companyId, companyId), eq(feedPollOptions.pollId, pollId)))
      .orderBy(asc(feedPollOptions.position));
  }

  /**
   * Số NGƯỜI đã bỏ phiếu (không phải số phiếu — poll đa-lựa-chọn có nhiều phiếu mỗi người).
   *
   * 🔴 Trả về một CON SỐ, không bao giờ trả danh sách `user_id`. Đây là chỗ dễ "tiện tay" nhất để
   * làm rò cử tri: một `SELECT user_id …` ở đây rồi `.length` ở service sẽ khiến mảng id đi qua
   * tầng service, và lần refactor sau nó vào DTO. Xem SOC-DEC-009.
   */
  async totalVotersTx(tx: TenantTx, companyId: string, pollId: string): Promise<number> {
    const rows = await tx.execute<{ value: number }>(
      sql`SELECT COUNT(DISTINCT user_id) AS value
            FROM feed_poll_votes
           WHERE company_id = ${companyId} AND poll_id = ${pollId}`,
    );
    return Number(rows.rows[0]?.value ?? 0);
  }

  /** Các `optionId` mà CHÍNH actor đã chọn. Chỉ của actor — không bao giờ của người khác. */
  async myVoteOptionIdsTx(
    tx: TenantTx,
    companyId: string,
    pollId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({ optionId: feedPollVotes.optionId })
      .from(feedPollVotes)
      .where(
        and(
          eq(feedPollVotes.companyId, companyId),
          eq(feedPollVotes.pollId, pollId),
          eq(feedPollVotes.userId, userId),
        ),
      );
    return rows.map((r) => r.optionId);
  }
}

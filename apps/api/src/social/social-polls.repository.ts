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
    await tx.execute(
      sql`SELECT 1 FROM feed_polls WHERE company_id = ${companyId} AND id = ${pollId} FOR UPDATE`,
    );
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
  ): Promise<void> {
    if (optionIds.length === 0) return;
    await tx.execute(
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
             )})`,
    );
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
    const updated = await tx
      .update(feedPolls)
      .set({ status: "closed", closedAt: new Date(), updatedAt: new Date() })
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
   * 🔴 **KHÔNG neo `FOR UPDATE`**, khác hẳn ba đường ghi kia, và đó là quyết định có chủ đích:
   *   · Câu này set-based; thêm khoá biến nó thành vòng lặp per-row và **mất
   *     `idx_feed_polls_open_deadline`** (`(company_id, closes_at) WHERE status='open' AND
   *     closes_at IS NOT NULL`) — vị từ dưới đây giữ ĐÚNG hình dạng của index đó.
   *   · Nó vẫn an toàn: ở READ COMMITTED, Postgres **re-check `WHERE`** sau khi chờ khoá hàng, nên
   *     một `044` vừa đóng xong sẽ làm hàng đó rớt khỏi `status = 'open'` và job không đụng tới.
   *     `RETURNING` vì vậy là danh sách poll mà **CHÍNH job này** đã đóng ⇒ NOTI-035 không nhân đôi.
   *   · Nó chỉ chạm `feed_polls` (không `feed_poll_options`) nên không tham gia thứ tự khoá kia.
   */
  async closeExpiredTx(tx: TenantTx, companyId: string): Promise<ClosedPollRow[]> {
    const rows = await tx.execute<{ id: string; post_id: string; question: string }>(
      sql`UPDATE feed_polls
             SET status = 'closed', closed_at = now(), updated_at = now()
           WHERE company_id = ${companyId}
             AND status = 'open'
             AND closes_at IS NOT NULL
             AND closes_at <= now()
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
      .orderBy(asc(feedPolls.status), sql`${feedPolls.createdAt} DESC`)
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

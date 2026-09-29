import { ConflictException, Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { feedPollOptions, feedPollVotes, feedPolls, feedPosts } from "../db/schema/social";
import { SocialAccessService } from "./social-access.service";
import { SOCIAL_ERR, socialPgErrorOf, socialError } from "./social.errors";
import type { SocialViewerContext } from "./social.types";
import type { FeedPollStatusDto } from "@mediaos/contracts";

/**
 * Trần CHỜ KHOÁ cho ba đường GHI của bình chọn (`041`/`042`/`044`) — xem `lockPollRowTx`.
 *
 * Ngắn hơn hẳn trần của job (`5s`): ở đây có NGƯỜI đang ngồi đợi phản hồi HTTP, còn job thì không.
 */
const POLL_WRITE_LOCK_TIMEOUT = "3s";

/** `lock_not_available` — Postgres bắn khi `lock_timeout` hết mà chưa lấy được khoá hàng. */
const PG_LOCK_NOT_AVAILABLE = "55P03";

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

/**
 * Kết quả bình chọn đọc trong MỘT ảnh chụp — xem `pollResultsTx`.
 *
 * 🔴 `myVote` là phiếu của CHÍNH actor. Không có trường nào chở danh tính cử tri khác, và đó là
 * BẤT BIẾN của kiểu này: thêm một `voters`/`userIds` ở đây là mở đúng đường rò mà SOC-DEC-009 cấm.
 */
export interface PollResults {
  options: { id: string; label: string; voteCount: number }[];
  totalVoters: number;
  myVote: string[];
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
   *
   * ┌─ TRẦN CHỜ KHOÁ — phía REQUEST, không chỉ phía JOB (FULL gate lượt 2, `database-reviewer` D-1) ┐
   * │ O-7 đã bó tx của job, nhưng đo trên PG thật cho thấy role `mediaos_app` có `lock_timeout = 0` │
   * │ VÀ `statement_timeout = 0` ở mức session, còn pool thì `max: 20` **không**                     │
   * │ `connectionTimeoutMillis`. Nghĩa là: job giữ `FOR UPDATE` trên tối đa 200 hàng `feed_polls`   │
   * │ trong khi chạy; một người bấm bỏ phiếu vào đúng một trong 200 poll đó dừng NGAY TẠI ĐÂY —     │
   * │ không lỗi, không log, chỉ TREO. Đủ 20 request như vậy là cạn pool và **toàn bộ API** đứng im. │
   * │ Đây đúng hình dạng mà docblock `closeExpiredTx` mô tả, chỉ là đã dời từ phía job sang phía    │
   * │ request. Đặt trần ở ĐÂY để cả ba đường ghi (`041`/`042`/`044`) cùng hưởng một lần khai báo.   │
   * │ Và phải DỊCH `55P03` — để nó rơi xuống 500 chưa dịch là đúng lớp lỗi H-1 của lượt gate trước. │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  async lockPollRowTx(tx: TenantTx, companyId: string, pollId: string): Promise<void> {
    // `SET LOCAL` không nhận bind param; hằng literal của module (xem `POLL_WRITE_LOCK_TIMEOUT`).
    await tx.execute(sql.raw(`set local lock_timeout = '${POLL_WRITE_LOCK_TIMEOUT}'`));

    let locked: Awaited<ReturnType<TenantTx["execute"]>>;
    try {
      locked = await tx.execute(
        sql`SELECT 1 FROM feed_polls WHERE company_id = ${companyId} AND id = ${pollId} FOR UPDATE`,
      );
    } catch (err) {
      if (socialPgErrorOf(err)?.code === PG_LOCK_NOT_AVAILABLE) {
        throw new ConflictException(socialError(SOCIAL_ERR.POLL_WRITE_BUSY));
      }
      throw err;
    }
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
  async closeExpiredTx(tx: TenantTx, companyId: string, limit: number): Promise<ClosedPollRow[]> {
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
   *
   * 🔴 **Trả kèm `total`** (owner chốt S5, 23/09/2026). Bản đầu trả MẢNG TRẦN: FE không phân biệt
   * được «trang cuối» với «trang rỗng», và không dựng được pager — trong khi `030`, khuôn mà chính
   * plan khai, vẫn trả envelope.
   *
   * ┌─ `count(*) OVER ()`, KHÔNG phải câu đếm thứ hai (FULL gate lượt 2 — BỐN nguồn hội tụ) ────────┐
   * │ Bản đầu của vá S5 đếm bằng một `select({n: count()})` RIÊNG. Nó đi đúng `innerJoin` + đúng    │
   * │ `where` (đã `EXPLAIN` xác nhận hai kế hoạch giống hệt), nên KHÔNG rò phạm vi — nhưng nó là     │
   * │ **câu thứ hai trên cùng một tx READ COMMITTED**, tức **ảnh chụp thứ hai**. Một `002`/`044`     │
   * │ commit chen vào giữa cho `total` và `data` kể hai câu chuyện khác nhau: `total=11` mà trang    │
   * │ trả 10 hàng, đúng thứ envelope sinh ra để phân biệt («trang cuối» vs «trang rỗng»).            │
   * │                                                                                                │
   * │ 🔴 Điểm chí mạng: đó **CHÍNH LÀ lớp lỗi H-8** mà hàm `pollResultsTx` 40 dòng bên dưới vừa gộp  │
   * │ ba câu thành một để đóng. Vá một chỗ rồi mở lại ở chỗ kia, trong CÙNG một lượt. Docblock cũ    │
   * │ chỉ lập luận về «cùng vị từ» và không một lần nhắc «cùng ảnh chụp» — đúng trục nó vừa vá.      │
   * │ Window function tính SAU `WHERE`/`JOIN` nhưng TRƯỚC `LIMIT`/`OFFSET` ⇒ `total` vẫn là tổng     │
   * │ thật, và giờ ở cùng một ảnh chụp với hàng. Phụ thu: bỏ hẳn một lượt quét tập thấy-được.        │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ **Giá phải trả, đã cân nhắc:** window function chỉ tồn tại nếu có HÀNG. Trang rỗng ⇒ không
   * biết `total`. Với `page=1` thì rỗng nghĩa là tổng = 0 (đúng). Với `page>1` vượt biên thì phải
   * hỏi lại bằng một câu đếm — nhánh HIẾM, và ở đó `total` lệch `data` cũng vô nghĩa vì `data` rỗng.
   * Nên đường thường đi MỘT câu / MỘT ảnh chụp, chỉ nhánh vượt-biên trả thêm một câu.
   */
  async listPollsTx(
    tx: TenantTx,
    viewer: SocialViewerContext,
    opts: { status?: "open" | "closed"; limit: number; offset: number },
  ): Promise<{ rows: PollListRow[]; total: number }> {
    const where = [
      eq(feedPolls.companyId, viewer.companyId),
      this.access.visiblePostCondition(viewer),
    ];
    if (opts.status) where.push(eq(feedPolls.status, opts.status));

    const rows = await tx
      .select({
        pollId: feedPolls.id,
        postId: feedPolls.postId,
        question: feedPolls.question,
        status: feedPolls.status,
        isAnonymous: feedPolls.isAnonymous,
        closesAt: feedPolls.closesAt,
        closedAt: feedPolls.closedAt,
        createdAt: feedPolls.createdAt,
        total: sql<number>`count(*) over ()`.mapWith(Number),
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

    const page = rows.map(({ total: _total, ...row }) => row);
    if (rows.length > 0) return { rows: page, total: rows[0].total };

    // Trang RỖNG — window function không có hàng nào để bám. `offset === 0` ⇒ tập thật sự rỗng
    // (đây là đường của mọi tenant chưa có bình chọn nào, phải MIỄN PHÍ, không tốn câu thứ hai).
    if (opts.offset === 0) return { rows: page, total: 0 };

    // Chỉ còn nhánh VƯỢT BIÊN (`page>1` mà hết hàng). Hỏi lại tổng bằng một câu riêng: ở đây lệch
    // ảnh chụp là vô hại vì `data` đã rỗng, và FE cần con số để lùi về trang cuối hợp lệ.
    const [totalRow] = await tx
      .select({ n: count() })
      .from(feedPolls)
      .innerJoin(
        feedPosts,
        and(eq(feedPosts.companyId, feedPolls.companyId), eq(feedPosts.id, feedPolls.postId)),
      )
      .where(and(...where));
    return { rows: page, total: Number(totalRow?.n ?? 0) };
  }

  /**
   * Toàn bộ kết quả bình chọn trong **MỘT câu** — lựa chọn + bộ đếm + tổng cử tri + phiếu của
   * chính actor.
   *
   * ┌─ VÌ SAO MỘT CÂU, KHÔNG BA (FULL gate 23/09/2026 — H-8, ba nguồn) ─────────────────────────────┐
   * │ Bản cũ chạy ba câu qua `Promise.all` trên CÙNG một tx. Ở READ COMMITTED mỗi CÂU lấy ảnh chụp  │
   * │ RIÊNG, nên một lượt `041` commit chen vào giữa làm response tự mâu thuẫn:                      │
   * │ `Σ options.voteCount` đếm sau lượt đó còn `totalVoters` đếm trước (hoặc ngược lại) ⇒ FE tính   │
   * │ tỉ lệ ra **>100%**. Đúng bất biến mà cả WO này dựng lưới bảo vệ ở đường GHI, vỡ ở đường ĐỌC.   │
   * │ `Promise.all` còn che điều đó: ba câu chạy "song song" nên cửa sổ trông như bằng không, trong  │
   * │ khi driver vẫn tuần tự hoá chúng trên MỘT connection — chạy rời hay `Promise.all` đều hở như   │
   * │ nhau, gộp câu mới là thứ đóng được.                                                            │
   * │ Không chọn `repeatable read` (tx này thường ĐÃ mở và đang ghi — `041`/`042`/`044` gọi lại      │
   * │ hàm này sau khi ghi, đổi isolation giữa chừng là không hợp lệ) và không `FOR SHARE` (giữ khoá  │
   * │ đọc trên cả bảng phiếu, ngược hướng H-3).                                                       │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * 🔴 Trả `totalVoters` là một CON SỐ và `myVote` chỉ của CHÍNH actor — không bao giờ một danh
   * sách `user_id`. Đây là chỗ dễ "tiện tay" nhất để làm rò cử tri: một `SELECT user_id …` ở đây
   * rồi `.length` ở service sẽ khiến mảng id đi qua tầng service, và lần refactor sau nó vào DTO.
   * Xem SOC-DEC-009.
   */
  async pollResultsTx(
    tx: TenantTx,
    companyId: string,
    pollId: string,
    userId: string,
  ): Promise<PollResults> {
    // S16-SOCIAL-BE-2D D5: ỦY QUYỀN cho CÙNG bộ dựng SQL của khối `poll` trên thẻ bài — một định
    // nghĩa, hai đường (thẻ + 041..044) không trôi khỏi nhau. Vẫn MỘT câu ⇒ bất biến H-8 giữ nguyên.
    const byPost = await pollResultsByTx(tx, companyId, userId, { pollIds: [pollId] });
    const hit = [...byPost.values()][0];
    // Trượt = BUG (caller vừa đọc poll trong CÙNG tx; poll 0 lựa chọn vẫn ra một hàng nhờ LEFT JOIN).
    // NÉM (FULL gate silent-failure M2): trả kết quả rỗng trông hợp lệ thì một lượt `041` thành công
    // hiện «0 cử tri, phiếu của bạn biến mất» với HTTP 200 và không log nào.
    if (!hit) {
      throw new Error(
        `S16-SOCIAL-BE-2D: pollResultsTx không ra hàng cho poll ${pollId} (company ${companyId})`,
      );
    }
    return { options: hit.options, totalVoters: hit.totalVoters, myVote: hit.myVote };
  }
}

/**
 * Tóm tắt bình chọn = ĐÚNG hình dạng `043` (`FeedPollResultsDto`), khoá theo `postId`.
 */
export interface PollSummary {
  pollId: string;
  postId: string;
  question: string;
  status: FeedPollStatusDto;
  multipleChoice: boolean;
  isAnonymous: boolean;
  closesAt: string | null;
  totalVoters: number;
  myVote: string[];
  options: { id: string; label: string; voteCount: number }[];
}

/**
 * S16-SOCIAL-BE-2D D5 — kết quả bình chọn của MỘT LÔ poll trong **MỘT câu** (khối `poll` trên thẻ bài;
 * `pollResultsTx` của `041..044` ủy quyền về đây).
 *
 * ┌─ 🔴 BA BẪY ĐÃ ĐO (plan BE-2D §9 V1/V2/V7) ─────────────────────────────────────────────────────┐
 * │ 1. **MỘT câu** — đếm cử tri (`COUNT DISTINCT`) và bộ đếm lựa chọn cùng ảnh chụp, như           │
 * │    `pollResultsTx` cũ (H-8: hai câu = hai ảnh chụp READ COMMITTED ⇒ Σ% > 100). Ca B10 + U7 ghim. │
 * │    LATERAL bám `p` TRƯỚC khi JOIN lựa chọn ⇒ đếm một lần/poll, không một lần/lựa chọn.         │
 * │ 2. `tx.execute` trả `timestamptz` là CHUỖI THÔ (`drizzle-orm/node-postgres/session.js` ép parser │
 * │    thành `(v) => v`): `2026-09-29 08:46:14+00` — KHÔNG phải ISO có `T` ⇒ FE `datetime()` ZodError │
 * │    trên HTTP 200 = feed trắng. ĐỔI bằng `new Date(raw).toISOString()`. `COUNT` về là chuỗi       │
 * │    bigint ⇒ `Number()`.                                                                        │
 * │ 3. Poll 0 lựa chọn (DB cho phép) ⇒ LEFT JOIN cho MỘT hàng option NULL: hàng đó chỉ góp cột poll │
 * │    + `totalVoters`, KHÔNG góp option `{id:null}`.                                              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * 🔴 `myVote` chỉ của `userId` truyền vào (NGƯỜI XEM). Không chiếu `user_id` cử tri nào (SOC-DEC-009).
 * `company_id` tường minh ở MỌI bảng, cả LATERAL lẫn EXISTS (lưới thứ hai sau RLS).
 * ⚠️ KHÔNG tự gác tầm nhìn — `postIds`/`pollIds` phải đến từ hàng ĐÃ qua cổng đọc bài.
 */
export async function pollResultsByTx(
  tx: TenantTx,
  companyId: string,
  userId: string,
  filter: { postIds: readonly string[] } | { pollIds: readonly string[] },
): Promise<Map<string, PollSummary>> {
  const out = new Map<string, PollSummary>();
  const ids = "postIds" in filter ? filter.postIds : filter.pollIds;
  if (ids.length === 0) return out;
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const where = "postIds" in filter ? sql`p.post_id IN (${idList})` : sql`p.id IN (${idList})`;

  const rows = await tx.execute<{
    poll_id: string;
    post_id: string;
    question: string;
    status: FeedPollStatusDto;
    multiple_choice: boolean;
    is_anonymous: boolean;
    closes_at: string | null;
    total_voters: string | number;
    option_id: string | null;
    /** NULL CHỈ khi `option_id` NULL (poll 0 lựa chọn) — hàng đó bị bỏ trước khi đọc hai cột này. */
    label: string;
    vote_count: number;
    mine: boolean;
  }>(
    sql`SELECT p.id AS poll_id,
               p.post_id,
               p.question,
               p.status,
               p.multiple_choice,
               p.is_anonymous,
               p.closes_at,
               tv.total_voters,
               o.id AS option_id,
               o.label,
               o.vote_count,
               (o.id IS NOT NULL AND EXISTS (SELECT 1
                                               FROM feed_poll_votes v
                                              WHERE v.company_id = p.company_id
                                                AND v.poll_id = p.id
                                                AND v.option_id = o.id
                                                AND v.user_id = ${userId})) AS mine
          FROM feed_polls p
          LEFT JOIN LATERAL (SELECT COUNT(DISTINCT v2.user_id) AS total_voters
                               FROM feed_poll_votes v2
                              WHERE v2.company_id = p.company_id
                                AND v2.poll_id = p.id) tv ON true
          LEFT JOIN feed_poll_options o
                 ON o.company_id = p.company_id
                AND o.poll_id = p.id
         WHERE p.company_id = ${companyId}
           AND ${where}
         ORDER BY p.post_id, o.position`,
  );

  // Poll có `closes_at` không đổi được sang ISO (vd `'infinity'` — CHECK `closes_at > created_at` cho
  // phép) ⇒ BỎ khối của bài đó (caller báo mồ côi + log), KHÔNG để `RangeError` làm 500 cả trang
  // (FULL gate DB LOW-1 · silent-failure L3).
  const badPosts = new Set<string>();
  for (const r of rows.rows) {
    if (badPosts.has(r.post_id)) continue;
    let entry = out.get(r.post_id);
    if (!entry) {
      const closesAt = r.closes_at === null ? null : new Date(r.closes_at);
      if (closesAt !== null && Number.isNaN(closesAt.getTime())) {
        badPosts.add(r.post_id);
        continue;
      }
      entry = {
        pollId: r.poll_id,
        postId: r.post_id,
        question: r.question,
        status: r.status,
        multipleChoice: r.multiple_choice,
        isAnonymous: r.is_anonymous,
        closesAt: closesAt === null ? null : closesAt.toISOString(),
        totalVoters: Number(r.total_voters),
        myVote: [],
        options: [],
      };
      out.set(r.post_id, entry);
    }
    if (r.option_id === null) continue;
    entry.options.push({ id: r.option_id, label: r.label, voteCount: Number(r.vote_count) });
    if (r.mine) entry.myVote.push(r.option_id);
  }
  return out;
}

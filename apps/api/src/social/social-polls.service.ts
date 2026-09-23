// `ForbiddenException` đã BỎ ở FULL gate 23/09 (`security-reviewer` F9 — import chết): 403 của `044`
// do `assertCanMutateContent` ném, file này không tự ném 403 ở đâu.
import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService, type NewEvent } from "../events/outbox.service";
import { SocialAccessService } from "./social-access.service";
import { bumpPollOptionVotes } from "./social-counters";
import { SOCIAL_EVENT_POLL_CLOSED, type SocialPollClosedPayload } from "./social-noti.payload";
import { SocialPollsRepository, type PollForWrite } from "./social-polls.repository";
import { SOCIAL_CONSTRAINT, SOCIAL_ERR, isUniqueViolationOf } from "./social.errors";
import type { SocialActor, SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-2B-1 — BÌNH CHỌN (`SOCIAL-API-040..044`).
 *
 * ┌─ THỨ TỰ CỦA MỘT LƯỢT GHI — KHÔNG ĐƯỢC ĐẢO ───────────────────────────────────────────────────┐
 * │  1. `resolveActor`            — tầng 2 guard, MỘT lần đầu method.                             │
 * │  2. `assertPostVisible`       — cổng đọc bài cha (404 cho MỌI lý do không thấy được).          │
 * │  3. `lockPollRowTx`           — neo chống đua, TRƯỚC khi đọc trạng thái để quyết định.         │
 * │  4. đọc poll SAU khoá         — `status`/`closesAt` đọc trước khoá là TOCTOU.                  │
 * │  5. cổng nghiệp vụ            — `open` + chưa quá hạn.                                         │
 * │  6. nợ (e): option ∈ poll     — TRƯỚC mỗi INSERT phiếu.                                        │
 * │  7. ghi + bù trừ bộ đếm       — cùng tx, đối xứng.                                             │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **`041`/`042` CỐ Ý KHÔNG GHI AUDIT.** Một dòng `audit_logs` cho lượt bỏ phiếu mang
 * `actor_user_id` + `object_id = postId` ⇒ **tái dựng được danh sách cử tri** của một bình chọn ẩn
 * danh, vòng qua toàn bộ hàng rào mà `043` dựng lên (SOC-DEC-009). `audit_logs` là append-only và
 * sống lâu hơn grant, nên đây không phải chuyện "bật lại sau cũng được". Ai định "bổ sung audit cho
 * đủ Definition of Done" phải đọc dòng này trước.
 */
@Injectable()
export class SocialPollsService {
  private readonly logger = new Logger(SocialPollsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialPollsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * `040` — danh sách bình chọn actor thấy được.
   *
   * 🔴 Nhận `page`, KHÔNG nhận `offset` (owner chốt S5, 23/09/2026): envelope trả lại `page` cho FE
   * nên phép `(page-1)*limit` phải nằm ĐÚNG MỘT chỗ. Bản trước để controller tính offset rồi service
   * không còn biết `page` — muốn trả envelope là phải tính ngược, và hai phép tính ngược nhau ở hai
   * tầng là chỗ trôi kinh điển.
   */
  async list(
    user: SocialRequestUser,
    query: { status?: "open" | "closed"; page: number; limit: number },
  ) {
    const actor = await this.access.resolveActor(user, "pollList");
    const { page, limit } = query;
    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listPollsTx(tx, actor, {
        status: query.status,
        limit,
        offset: (page - 1) * limit,
      }),
    );
    return {
      data: rows.map((r) => ({
        pollId: r.pollId,
        postId: r.postId,
        question: r.question,
        status: r.status,
        isAnonymous: r.isAnonymous,
        closesAt: r.closesAt?.toISOString() ?? null,
        closedAt: r.closedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }

  /**
   * `041` — bỏ/đổi phiếu. MỘT tx, bù trừ ĐỐI XỨNG.
   *
   * 🔴 Vế `-1` cho option cũ **không phải chuyện của ca đua** — thiếu nó thì bộ đếm lệch ngay ở
   * thao tác bình thường nhất của tính năng (người dùng đổi ý). Ca `P-4` + `C-2` gác bằng bất biến
   * `Σ vote_count == COUNT(*) phiếu` kiểm sau MỖI bước.
   */
  async vote(user: SocialRequestUser, postId: string, optionIds: string[]) {
    const actor = await this.access.resolveActor(user, "pollVote");
    // Khử trùng lặp TRƯỚC mọi thứ: `[A, A]` gửi lên sẽ làm `countOptionsOfPollTx` khớp 1/2 và ném
    // nhầm thành "option lạ", trong khi lỗi thật của người dùng là gửi trùng.
    // 🔴 FULL gate 23/09/2026 (`database-reviewer` L-5): chuẩn hoá HOA/thường TRƯỚC khi khử trùng
    // lặp. `Set` so sánh CHUỖI, Postgres so sánh `uuid`, và Zod `.uuid()` nhận CẢ HAI dạng ⇒
    // `["AB…","ab…"]` (cùng MỘT uuid) lọt qua `Set` thành 2 phần tử, rồi `countOptionsOfPollTx` khớp
    // 1/2 ⇒ ném 404 "không tìm thấy lựa chọn" cho một lỗi thật là gửi TRÙNG. Fail-closed nên không
    // lệch đếm, nhưng thông điệp chỉ sai hướng người dùng.
    const wanted = [...new Set(optionIds.map((id) => id.toLowerCase()))];

    return this.db.withTenant(actor.companyId, async (tx) => {
      const poll = await this.openPollForWriteTx(tx, actor, postId);

      if (!poll.multipleChoice && wanted.length > 1) {
        throw new ConflictException(SOCIAL_ERR.POLL_VOTE_DUPLICATE);
      }

      // Nợ (e) — TRƯỚC INSERT. Hai FK rời không ràng option thuộc poll.
      const belong = await this.repo.countOptionsOfPollTx(tx, actor.companyId, poll.id, wanted);
      if (belong !== wanted.length) {
        throw new NotFoundException(SOCIAL_ERR.POLL_OPTION_NOT_FOUND);
      }

      // Vế `-1`: xoá phiếu cũ và trả về ĐÚNG những option vừa mất phiếu.
      const removed = await this.repo.deleteVotesOfUserTx(
        tx,
        actor.companyId,
        poll.id,
        actor.actorUserId,
      );
      await bumpPollOptionVotes(tx, actor.companyId, poll.id, removed, -1);

      try {
        // 🔴 FULL gate 23/09/2026 — BỐN reviewer hội tụ. Xem docblock `insertVotesTx`: câu
        // `INSERT … SELECT` ghi ÍT hơn `wanted` mà KHÔNG ném gì, rồi `+1` ngay dưới bơm đủ cả
        // `wanted` ⇒ `vote_count` lệch **DƯƠNG** vĩnh viễn (rủi ro số 1 của plan §9: không lỗi,
        // không log, không script đối soát). Ném ⇒ cả tx quay lui.
        const written = await this.repo.insertVotesTx(
          tx,
          actor.companyId,
          poll.id,
          actor.actorUserId,
          wanted,
        );
        if (written !== wanted.length) {
          throw new Error(
            `insertVotesTx: ghi ${written}/${wanted.length} phiếu (poll=${poll.id}) — có optionId ` +
              `không thuộc bình chọn này, hoặc hàng feed_polls biến mất giữa tx`,
          );
        }
      } catch (err) {
        // 🔴 HAI chốt DB, HAI nhánh — dịch CẢ HAI:
        //   · `…_single_uq` : hai option KHÁC nhau, cùng người, poll một-lựa-chọn.
        //   · `…_pk`        : CÙNG một option, cùng người (hai lượt đua nhau).
        // Chỉ dịch cái đầu thì lượt thua của ca đua "cùng option" rơi xuống 23505 không ai dịch ⇒
        // **500** cho người dùng, trong khi ca đua vẫn XANH vì trạng thái cuối vẫn đúng.
        if (
          isUniqueViolationOf(err, SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ) ||
          isUniqueViolationOf(err, SOCIAL_CONSTRAINT.POLL_VOTE_PK)
        ) {
          throw new ConflictException(SOCIAL_ERR.POLL_VOTE_DUPLICATE);
        }
        throw err;
      }
      await bumpPollOptionVotes(tx, actor.companyId, poll.id, wanted, 1);

      return this.readResultsTx(tx, actor, poll);
    });
  }

  /**
   * `042` — rút phiếu.
   *
   * Chưa có phiếu nào ⇒ **200 no-op**, không 404: DELETE là thao tác idempotent theo bản chất, và
   * một 404 ở đây chỉ nói với người dùng điều họ đã biết (họ chưa bỏ phiếu) bằng giọng của lỗi.
   */
  async withdrawVote(user: SocialRequestUser, postId: string) {
    const actor = await this.access.resolveActor(user, "pollVoteWithdraw");
    return this.db.withTenant(actor.companyId, async (tx) => {
      const poll = await this.openPollForWriteTx(tx, actor, postId);
      const removed = await this.repo.deleteVotesOfUserTx(
        tx,
        actor.companyId,
        poll.id,
        actor.actorUserId,
      );
      await bumpPollOptionVotes(tx, actor.companyId, poll.id, removed, -1);
      return this.readResultsTx(tx, actor, poll);
    });
  }

  /** `043` — kết quả. Tập cột TƯỜNG MINH; không bao giờ có `user_id`. */
  async results(user: SocialRequestUser, postId: string) {
    const actor = await this.access.resolveActor(user, "pollResults");
    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertPostVisible(tx, actor, postId);
      const poll = await this.repo.getPollByPostTx(tx, actor.companyId, postId);
      if (!poll) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);
      return this.readResultsTx(tx, actor, poll);
    });
  }

  /**
   * `044` — đóng bình chọn bằng tay. Chủ bài HOẶC `manage:feed-post`.
   *
   * Audit **LUÔN** (không chỉ khi `viaManage`): đóng bình chọn là hành động **không đảo ngược được**
   * — không có route nào mở lại. Đây là cùng bài học mà FULL gate của BE-2A rút ra cho `031`/`034`.
   */
  async close(user: SocialRequestUser, postId: string) {
    const actor = await this.access.resolveActor(user, "pollClose");
    return this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.access.assertPostVisible(tx, actor, postId);
      const viaManage = this.access.assertCanMutateContent(actor, post.authorUserId);

      const poll = await this.repo.getPollByPostTx(tx, actor.companyId, postId);
      if (!poll) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);

      await this.repo.lockPollRowTx(tx, actor.companyId, poll.id);
      const closed = await this.repo.closeManualTx(tx, actor.companyId, poll.id);
      // 🔴 `RETURNING` rỗng ⇒ poll đã đóng từ trước (tay hoặc job). KHÔNG audit, KHÔNG NOTI: cả hai
      // phải nằm SAU vế này, cùng tx. Ghi trước rồi mới kiểm là hai dòng audit cho một lần đóng —
      // và `audit_logs` append-only nên không gỡ lại được.
      if (!closed) throw new ConflictException(SOCIAL_ERR.POLL_CLOSED);

      await this.audit.record(tx, {
        action: "social.poll.close",
        objectType: "feed_post",
        objectId: postId,
        actorUserId: actor.actorUserId,
        actorType: "User",
        actionGroup: "SOCIAL",
        resultStatus: "Success",
        dataScope: "Company",
        sensitivityLevel: "Normal",
        metadata: { postId, pollId: poll.id, via: "manual", viaManage },
      });

      await this.enqueuePollClosedNotiTx(tx, actor.companyId, {
        postId,
        question: poll.question,
      });

      const fresh = await this.repo.getPollByPostTx(tx, actor.companyId, postId);
      // 🔴 FULL gate 23/09/2026 (`santa-A` F9 · `silent-failure-hunter` L-2): KHÔNG `?? poll`.
      // `poll` là ảnh chụp TRƯỚC UPDATE ⇒ nó mang `status:'open'` cho một bình chọn vừa đóng, trong
      // khi audit + NOTI đã phát. Trả một trạng thái NÓI DỐI tệ hơn 500 — cùng lý lẽ mà
      // `bumpGroupMemberCount` đã áp cho vế 0 dòng.
      if (!fresh) {
        throw new Error(`close: hàng feed_polls biến mất sau khi đóng (poll=${poll.id})`);
      }
      return this.readResultsTx(tx, actor, fresh);
    });
  }

  /**
   * NOTI-035 cho MỘT bình chọn — đường `044` (đóng tay). Thân là bản LÔ với lô cỡ 1.
   */
  async enqueuePollClosedNotiTx(
    tx: TenantTx,
    companyId: string,
    poll: { postId: string; question: string },
  ): Promise<void> {
    await this.enqueuePollClosedNotiManyTx(tx, companyId, [poll]);
  }

  /**
   * NOTI-035 cho MỘT LÔ bình chọn — **MỘT** câu người nhận + **MỘT** `enqueueMany`.
   *
   * ┌─ VÌ SAO LÀ BẢN LÔ, KHÔNG PHẢI VÒNG LẶP GỌI BẢN ĐƠN ────────────────────────────────────────────┐
   * │ FULL gate 23/09/2026 — `database-reviewer` H-1 · `santa-A` F7 · `santa-B` F2 ·               │
   * │ `silent-failure-hunter` M-6. Job gọi bản đơn trong vòng `for` là `2N` round-trip nằm TRONG   │
   * │ transaction đang giữ khoá ghi trên N hàng `feed_polls`. `OutboxService.enqueueMany` tồn tại   │
   * │ CHÍNH cho ca này và docblock của nó đã ra luật thành văn: «500 lượt `enqueue` là 500           │
   * │ round-trip nằm trong transaction nghiệp vụ đang giữ row-lock trên kỳ».                          │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * 🔴 Vị từ "còn hoạt động" phải có **CẢ HAI** vế — `employee_profiles.status='active'` VÀ
   * `users.status='active' AND users.deleted_at IS NULL`. Nghỉ việc **KHÔNG xoá mềm** hàng `users`,
   * nên chỉ lọc `deleted_at` là hở. Đúng lỗi mà BA reviewer độc lập đã hội tụ ở BE-1B.
   *
   * ✍️ **Owner chốt O-2 (23/09/2026): GIỮ INNER JOIN `employee_profiles` — đây là LUẬT MODULE, không
   * phải thiếu sót của WO này.** Hệ quả đã biết và được chấp nhận: tài khoản console/tích hợp
   * (`employeeIdOf` trả `null`) tạo được bài+poll nhưng **không bao giờ** nhận NOTI-035. Căn cứ đo
   * được: `social-groups.service.ts#isActiveRecipient` (NOTI-031, BE-2A — ĐÃ qua FULL gate và ĐÃ
   * ship) dùng **đúng cùng hai vế này**. Đổi riêng chỗ này sang LEFT JOIN sẽ làm poll khác nhóm ⇒
   * muốn đổi thì phải đổi CẢ hai producer trong một WO riêng. Lượt gate sau đừng "phát hiện" lại.
   *
   * 🔴 `p.deleted_at IS NULL` (FULL gate 23/09 — BỐN nguồn hội tụ): thiếu vế này thì một bình chọn
   * trên bài **đã xoá mềm** vẫn phát NOTI-035 mang `poll_question` + `target_url=/social/posts/{id}`,
   * người nhận bấm vào ăn 404, và câu hỏi của bài đã xoá **tái xuất hiện qua bảng `notifications`** —
   * thứ sống lâu hơn bài. `closeExpiredTx` giờ cũng loại bài đã xoá, nên hai vế cùng một luật.
   *
   * @returns số event đã enqueue (≤ `polls.length`).
   */
  async enqueuePollClosedNotiManyTx(
    tx: TenantTx,
    companyId: string,
    polls: readonly { postId: string; question: string }[],
  ): Promise<number> {
    if (polls.length === 0) return 0;

    const rows = await tx.execute<{ post_id: string; user_id: string }>(sql`
      SELECT p.id AS post_id, u.id AS user_id
        FROM feed_posts p
        JOIN users u
          ON u.company_id = p.company_id AND u.id = p.author_user_id
         AND u.deleted_at IS NULL AND u.status = 'active'
        JOIN employee_profiles ep
          ON ep.company_id = u.company_id AND ep.user_id = u.id
         AND ep.status = 'active' AND ep.deleted_at IS NULL
       WHERE p.company_id = ${companyId}
         AND p.deleted_at IS NULL
         AND p.id IN (${sql.join(
           polls.map((p) => sql`${p.postId}`),
           sql`, `,
         )})
    `);

    const byPost = new Map<string, string[]>();
    for (const r of rows.rows) {
      const list = byPost.get(r.post_id);
      if (list) list.push(r.user_id);
      else byPost.set(r.post_id, [r.user_id]);
    }

    const events: NewEvent[] = [];
    for (const poll of polls) {
      const recipientUserIds = byPost.get(poll.postId);
      if (recipientUserIds === undefined || recipientUserIds.length === 0) {
        // 🔴 FULL gate 23/09/2026 (`silent-failure-hunter` M-1 · `database-reviewer` M-2): tập rỗng
        // rơi IM LẶNG là hình dạng "thành công RỖNG". `social-noti-bridge.registrar.ts` đã ra luật
        // cho MỌI producer: «tập rỗng ⇒ log WARN rồi KHÔNG enqueue» — hai producer SOCIAL khác
        // (NOTI-031, NOTI-036) đã tuân, producer này thì chưa.
        // Tập rỗng có BA nguyên nhân và KHÔNG cái nào là lỗi: tác giả nghỉ việc/bị khoá · tác giả
        // KHÔNG có hàng `employee_profiles` (`employeeIdOf` trả `null` ⇒ tài khoản console/tích hợp
        // tạo được bài) · bài đã xoá mềm. Ai NÊN nhận trong ca thứ hai là quyết định chính sách của
        // owner (plan §13.3) — dòng log này chỉ bảo đảm nó không còn vô hình.
        this.logger.warn(
          `NOTI-035 post=${poll.postId}: tập người nhận RỖNG (tác giả không còn hoạt động / không có ` +
            `hồ sơ nhân sự / bài đã xoá mềm) — KHÔNG phát thông báo.`,
        );
        continue;
      }

      const payload: SocialPollClosedPayload = {
        post_id: poll.postId,
        poll_question: poll.question,
        recipientUserIds,
      };
      events.push({ eventType: SOCIAL_EVENT_POLL_CLOSED, payload });
    }

    if (events.length === 0) return 0;
    await this.outbox.enqueueMany(tx, events);
    return events.length;
  }

  /**
   * Cổng chung của `041`/`042`: bài thấy được → neo khoá → đọc poll SAU khoá → còn nhận phiếu?
   *
   * Hai nhánh «không nhận phiếu nữa» trả CÙNG một mã `SOCIAL-ERR-016` nhưng là HAI nhánh code khác
   * nhau, nên có HAI ca test riêng (`P-1` đã `closed` · `P-2` quá hạn mà job chưa chạy tới). Gộp ca
   * lại thì bỏ hẳn một nhánh mà vẫn xanh.
   */
  private async openPollForWriteTx(
    tx: TenantTx,
    actor: SocialActor,
    postId: string,
  ): Promise<PollForWrite> {
    await this.access.assertPostVisible(tx, actor, postId);

    const probe = await this.repo.getPollByPostTx(tx, actor.companyId, postId);
    // Bài không mang bình chọn ⇒ 404 cùng chuỗi với "không thấy bài": phân biệt được tức là xác
    // nhận bài CÓ TỒN TẠI và chỉ là không phải poll.
    if (!probe) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);

    await this.repo.lockPollRowTx(tx, actor.companyId, probe.id);

    // 🔴 ĐỌC LẠI SAU KHOÁ. Giá trị đọc ở `probe` là trước khoá — một `044`/job chen vào giữa đã có
    // thể đổi `status`. Dùng lại `probe` ở đây là đúng TOCTOU mà neo khoá sinh ra để đóng.
    const poll = await this.repo.getPollByPostTx(tx, actor.companyId, postId);
    if (!poll) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);

    if (poll.status !== "open") throw new ConflictException(SOCIAL_ERR.POLL_CLOSED);
    // 🔴 FULL gate 23/09/2026 (`santa-A` F1 · `santa-B` F3): `expired` tính TRONG SQL bằng đồng hồ
    // **DB** (xem docblock `PollForWrite.expired`). Bản cũ so `closesAt.getTime() <= Date.now()` —
    // đồng hồ **APP** — trong khi job so `closes_at <= now()` của DB: một bất biến, HAI đồng hồ. App
    // chậm hơn DB δ ⇒ phiếu vẫn được nhận trong δ sau khi hệ thống đã coi bình chọn hết hạn.
    if (poll.expired) throw new ConflictException(SOCIAL_ERR.POLL_CLOSED);
    return poll;
  }

  /**
   * Kết quả bình chọn — **tập cột TƯỜNG MINH**.
   *
   * 🔴 `user_id` KHÔNG BAO GIỜ có mặt, kể cả `company-admin`, kể cả khi `isAnonymous = false`.
   * «Không ẩn danh» nghĩa là FE được phép hiển thị *rằng có người đã bỏ phiếu*, không phải API được
   * phép trả *ai*. Một `select()` trần ở repository sẽ kéo cột `user_id` vào đây mà typecheck không
   * kêu — đó là lý do repository trả về con SỐ (`pollResultsTx`) chứ không trả danh sách.
   *
   * 🔴 FULL gate 23/09/2026 (H-8, ba nguồn): ba câu qua `Promise.all` cho BA ảnh chụp READ
   * COMMITTED ⇒ `Σ options.voteCount` và `totalVoters` đọc được ở hai thời điểm khác nhau ⇒ FE tính
   * tỉ lệ >100%. Gộp thành MỘT câu ở `pollResultsTx` — xem docblock ở đó để biết vì sao
   * `repeatable read`/`FOR SHARE` đều không phải đường đúng.
   */
  private async readResultsTx(tx: TenantTx, actor: SocialActor, poll: PollForWrite) {
    const { options, totalVoters, myVote } = await this.repo.pollResultsTx(
      tx,
      actor.companyId,
      poll.id,
      actor.actorUserId,
    );

    return {
      pollId: poll.id,
      postId: poll.postId,
      question: poll.question,
      status: poll.status,
      multipleChoice: poll.multipleChoice,
      isAnonymous: poll.isAnonymous,
      closesAt: poll.closesAt?.toISOString() ?? null,
      totalVoters,
      myVote,
      options,
    };
  }
}

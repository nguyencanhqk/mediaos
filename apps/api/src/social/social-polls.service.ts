import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
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
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialPollsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `040` — danh sách bình chọn actor thấy được. */
  async list(
    user: SocialRequestUser,
    query: { status?: "open" | "closed"; limit: number; offset: number },
  ) {
    const actor = await this.access.resolveActor(user, "pollList");
    return this.db.withTenant(actor.companyId, async (tx) => {
      const rows = await this.repo.listPollsTx(tx, actor, query);
      return rows.map((r) => ({
        pollId: r.pollId,
        postId: r.postId,
        question: r.question,
        status: r.status,
        isAnonymous: r.isAnonymous,
        closesAt: r.closesAt?.toISOString() ?? null,
        closedAt: r.closedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
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
    const wanted = [...new Set(optionIds)];

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
      await bumpPollOptionVotes(tx, actor.companyId, removed, -1);

      try {
        await this.repo.insertVotesTx(tx, actor.companyId, poll.id, actor.actorUserId, wanted);
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
      await bumpPollOptionVotes(tx, actor.companyId, wanted, 1);

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
      await bumpPollOptionVotes(tx, actor.companyId, removed, -1);
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
      return this.readResultsTx(tx, actor, fresh ?? poll);
    });
  }

  /**
   * NOTI-035 — dùng chung giữa `044` (tay) và system-job.
   *
   * `recipientUserIds` rỗng ⇒ **không phát**: tác giả đã nghỉ việc/bị khoá thì một hàng
   * `notifications` trỏ vào tài khoản không đăng nhập được là rác vĩnh viễn trong bảng append-only.
   *
   * 🔴 Vị từ "còn hoạt động" phải có **CẢ HAI** vế — `employee_profiles.status='active'` VÀ
   * `users.status='active' AND users.deleted_at IS NULL`. Nghỉ việc **KHÔNG xoá mềm** hàng `users`,
   * nên chỉ lọc `deleted_at` là hở. Đúng lỗi mà BA reviewer độc lập đã hội tụ ở BE-1B.
   */
  async enqueuePollClosedNotiTx(
    tx: TenantTx,
    companyId: string,
    poll: { postId: string; question: string },
  ): Promise<void> {
    const rows = await tx.execute<{ user_id: string }>(sql`
      SELECT u.id AS user_id
        FROM feed_posts p
        JOIN users u
          ON u.company_id = p.company_id AND u.id = p.author_user_id
         AND u.deleted_at IS NULL AND u.status = 'active'
        JOIN employee_profiles ep
          ON ep.company_id = u.company_id AND ep.user_id = u.id
         AND ep.status = 'active' AND ep.deleted_at IS NULL
       WHERE p.company_id = ${companyId} AND p.id = ${poll.postId}
    `);
    const recipientUserIds = rows.rows.map((r) => r.user_id);
    if (recipientUserIds.length === 0) return;

    const payload: SocialPollClosedPayload = {
      post_id: poll.postId,
      poll_question: poll.question,
      recipientUserIds,
    };
    await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_POLL_CLOSED, payload });
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
    if (poll.closesAt !== null && poll.closesAt.getTime() <= Date.now()) {
      throw new ConflictException(SOCIAL_ERR.POLL_CLOSED);
    }
    return poll;
  }

  /**
   * Kết quả bình chọn — **tập cột TƯỜNG MINH**.
   *
   * 🔴 `user_id` KHÔNG BAO GIỜ có mặt, kể cả `company-admin`, kể cả khi `isAnonymous = false`.
   * «Không ẩn danh» nghĩa là FE được phép hiển thị *rằng có người đã bỏ phiếu*, không phải API được
   * phép trả *ai*. Một `select()` trần ở repository sẽ kéo cột `user_id` vào đây mà typecheck không
   * kêu — đó là lý do repository trả về con SỐ (`totalVotersTx`) chứ không trả danh sách.
   */
  private async readResultsTx(tx: TenantTx, actor: SocialActor, poll: PollForWrite) {
    const [options, totalVoters, myVote] = await Promise.all([
      this.repo.optionsWithCountsTx(tx, actor.companyId, poll.id),
      this.repo.totalVotersTx(tx, actor.companyId, poll.id),
      this.repo.myVoteOptionIdsTx(tx, actor.companyId, poll.id, actor.actorUserId),
    ]);

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

import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { FeedIdeaStatusDto, ReviewFeedIdeaDto } from "@mediaos/contracts";
import { UnprocessableEntityException } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { SocialAccessService } from "./social-access.service";
import { IDEA_STATUS_LABEL, assertIdeaTransition } from "./social-idea-fsm";
import { SocialIdeasRepository, type IdeaListRow } from "./social-ideas.repository";
import { activeUserIdsTx } from "./social-kudos.repository";
import {
  SOCIAL_EVENT_IDEA_STATUS_CHANGED,
  type SocialIdeaStatusChangedPayload,
} from "./social-noti.payload";
import { SOCIAL_ERR } from "./social.errors";
import type { SocialActor, SocialRequestUser } from "./social.types";

/** Một dòng của `045` sau khi service đã MASK `reviewNote` theo người xem (D19). */
interface IdeaItemDto {
  ideaId: string;
  postId: string;
  status: string;
  body: string | null;
  reviewNote: string | null;
  reviewer: { fullName: string } | null;
  reviewedAt: string | null;
  createdAt: string;
}

/**
 * S16-SOCIAL-BE-2B-2 — `SOCIAL-API-045` (danh sách sáng kiến) · `046` (xét duyệt).
 *
 * `046` là **đường DUYỆT đầu tiên của SOCIAL**: route duy nhất của module gác bằng một cặp `approve:*`,
 * và là chỗ duy nhất ghi cặp vết `reviewed_by`/`reviewed_at` mà `chk_feed_ideas_reviewed_pair` bắt buộc
 * phải đi CÙNG NHAU.
 */
@Injectable()
export class SocialIdeasService {
  private readonly logger = new Logger(SocialIdeasService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialIdeasRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * `045` — `GET /social/ideas`. Gác tầng 1 **chỉ `view:feed`** (mọi nhân viên).
   *
   * Nhận `page`, KHÔNG nhận `offset` (cùng luật owner đã chốt cho `040`, S5 của BE-2B-1): envelope trả
   * lại `page` cho FE nên phép `(page-1)*limit` phải nằm ĐÚNG MỘT chỗ.
   */
  async list(
    user: SocialRequestUser,
    query: { status?: FeedIdeaStatusDto; page: number; limit: number },
  ) {
    const actor = await this.access.resolveActor(user, "ideaList");
    const { page, limit } = query;

    // 🔴 D19 — quyền THẤY `reviewNote` là một câu hỏi RIÊNG, hỏi MỘT LẦN cho cả trang.
    //
    // Vì sao cần: route này gác `view:feed` (mọi nhân viên), nên nếu DTO chở `reviewNote` cho tất cả
    // thì lý do loại nó khỏi audit (`046`) và khỏi payload NOTI-032 SỤP — hai chỗ kia ít nhất còn có
    // cổng đọc riêng, `045` thì không. Ghi chú xét duyệt là chữ TỰ DO của người duyệt về một ý tưởng
    // của một đồng nghiệp cụ thể.
    const canSeeAllNotes = await this.access.canApproveIdeas(actor);

    const { rows, total } = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listIdeasTx(tx, actor, {
        status: query.status,
        limit,
        offset: (page - 1) * limit,
      }),
    );

    return {
      data: rows.map((r) => this.toItem(r, actor.actorUserId, canSeeAllNotes)),
      page,
      limit,
      total,
    };
  }

  /**
   * `046` — `PATCH /social/posts/{post_id}/idea/review`. Tầng 1 `approve:feed-idea` (decorator).
   *
   * THỨ TỰ các cổng, mỗi bước một lý do:
   *   1. **`resolveActor`** — tầng 2, tự resolve `approve:feed-idea` + ép sàn Company; thiếu ⇒ 403
   *      **`SOCIAL-ERR-020`** (qua `SocialPair.denyMessage`). Chạy TRƯỚC khi mở tx ⇒ ca `I-2b` đo được
   *      «403 mà KHÔNG hàng nào bị khoá».
   *   2. **`assertPostVisible`** — 404 cho mọi lý do «không được thấy» (404 TRƯỚC 403, API-19 §6.5).
   *   3. **`getIdeaForReviewTx`** (D6) — không có hàng `feed_ideas` ⇒ **404**, không phải 409.
   *   4. **`assertIdeaTransition`** (D4) — FSM 3 cạnh ⇒ 409 `ERR-019`.
   *   5. **note của `rejected`** (D7) — 422 có mã TRƯỚC khi `chk_feed_ideas_reject_note` biến nó thành 500.
   *   6. **`reviewTx`** (D5) — một câu 4 cột; 0 hàng ⇒ 409.
   *   7. **audit + NOTI-032** (D8) — CHỈ khi bước 6 thành công, CÙNG tx.
   */
  async review(user: SocialRequestUser, postId: string, dto: ReviewFeedIdeaDto) {
    // `resolveActor` LÀ tầng-2 của route này: nó tự resolve cặp `approve:feed-idea` (độc lập với
    // decorator) và ném **`SOCIAL-ERR-020`** ở cả hai nhánh — không có grant · scope hẹp hơn Company
    // (`SocialPair.denyMessage` của `ideaReview`). Một `assert…` thứ hai ở đây KHÔNG BAO GIỜ chạy tới:
    // đo 24/09/2026, và plan D20 đã sai ở đúng điểm này.
    const actor = await this.access.resolveActor(user, "ideaReview");

    return this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertPostVisible(tx, actor, postId);

      const idea = await this.repo.getIdeaForReviewTx(tx, actor.companyId, postId);
      // 🔴 404, KHÔNG 409. Bài `type='share'` đi QUA `assertPostVisible` (cổng đó chỉ gác tầm nhìn),
      // nên nếu để `reviewTx` 0-hàng nuốt ca này thì route trả «chuyển trạng thái sáng kiến sai» cho
      // một bài không hề là sáng kiến — sai mã, sai nghĩa, và che mất một 404 thật (ca `I-11`).
      if (!idea) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);

      const from = idea.status;
      const to = dto.status;
      assertIdeaTransition(from, to);

      // D7 — `btrim(note).length > 0` ép Ở ĐÂY. DTO đã `.trim()` nên `"   "` tới đây là chuỗi RỖNG;
      // để nó lọt xuống `chk_feed_ideas_reject_note` là `23514` ⇒ **500** cho một sai sót nhập liệu
      // hoàn toàn bình thường (ca `I-3`).
      const reviewNote = dto.reviewNote && dto.reviewNote.length > 0 ? dto.reviewNote : null;
      if (to === "rejected" && reviewNote === null) {
        throw new UnprocessableEntityException(SOCIAL_ERR.IDEA_REJECT_NOTE_REQUIRED);
      }

      const now = new Date();
      const applied = await this.repo.reviewTx(tx, actor.companyId, {
        ideaId: idea.ideaId,
        from,
        to,
        reviewNote,
        reviewerUserId: actor.actorUserId,
        now,
      });
      // 🔴 Vế này phải ở TRƯỚC audit + outbox. `audit_logs` là append-only (BẤT BIẾN #2): ghi trước
      // rồi mới kiểm là hai dòng audit cho một lượt chuyển, và không có đường gỡ lại.
      if (!applied) throw new ConflictException(SOCIAL_ERR.IDEA_TRANSITION);

      await this.audit.record(tx, {
        action: "social.idea.review",
        // `feed_post`, KHÔNG `feed_idea`: CHECK `audit_logs.object_type` (`0583:9-15`) cố ý KHÔNG có
        // `feed_idea`/`feed_kudos` — «vinh danh/sáng kiến là một BÀI». Thêm giá trị mới ở đây là một
        // migration, và WO này KHÔNG có migration nào.
        objectType: "feed_post",
        objectId: postId,
        actorUserId: actor.actorUserId,
        actorType: "User",
        actionGroup: "SOCIAL",
        resultStatus: "Success",
        dataScope: "Company",
        sensitivityLevel: "Normal",
        // 🔴 KHÔNG `review_note`: chữ tự do của người duyệt về ý tưởng của một người cụ thể. `from`
        // lấy từ `getIdeaForReviewTx` — `UPDATE … RETURNING` trả giá trị SAU cập nhật nên không có
        // đường nào lấy `from` từ chính câu ghi (D5).
        metadata: { postId, ideaId: idea.ideaId, from, to },
      });

      await this.enqueueIdeaStatusNoti(tx, actor, postId, to, idea.authorUserId);

      return { postId, ideaId: idea.ideaId, status: to, reviewedAt: now.toISOString() };
    });
  }

  /**
   * NOTI-032 «sáng kiến của bạn đổi trạng thái» — người nhận là **TÁC GIẢ BÀI**.
   *
   * 🔴 Lọc bằng **`activeUserIdsTx` (2 vế)**, KHÔNG bằng `userIdsOfEmployeesTx` (D18, 4 vế): tác giả
   * được neo bằng `feed_posts.author_user_id` = một `users.id`, còn D18 nhận `employee_id`. Hai không
   * gian uuid khác nhau — truyền lẫn thì câu khớp 0 hàng và thông báo lặng lẽ không đến ai.
   *
   * ⚠️ **Người DUYỆT không nhận**, kể cả khi họ tự duyệt sáng kiến của chính mình (ca có thật: `hr`
   * đăng sáng kiến rồi tự xét). Trừ `actorUserId` tường minh.
   *
   * ⚠️ Tập rỗng ⇒ KHÔNG enqueue (tác giả đã nghỉ / tài khoản bị khoá) — hàng outbox với
   * `recipientUserIds: []` thành dead-letter câm ở registrar.
   */
  private async enqueueIdeaStatusNoti(
    tx: TenantTx,
    actor: SocialActor,
    postId: string,
    status: FeedIdeaStatusDto,
    authorUserId: string,
  ): Promise<void> {
    if (authorUserId === actor.actorUserId) return;

    const recipients = await activeUserIdsTx(tx, actor.companyId, [authorUserId]);
    if (recipients.length === 0) {
      // 🔴 PHẢI log. Nhánh này là «tác giả sáng kiến không còn nhận được thông báo» (tài khoản bị khoá
      // `suspended`/`locked` hoặc xoá mềm SAU khi đăng bài) — hợp lệ về nghiệp vụ, nhưng nếu return
      // câm thì sự kiện đó **biến khỏi mọi bề mặt quan sát**: không hàng outbox để registrar bắt, không
      // dòng log để vận hành tra khi có người hỏi «vì sao tác giả X không nhận được kết quả xét duyệt».
      // Hai đường NOTI anh em CÙNG hình dạng rỗng (`enqueueNewsPublishedNoti` NOTI-031 ·
      // `enqueueKudosReceivedNoti` NOTI-033) đều đã log WARN cho đúng tình huống này — bỏ ở đây là bất
      // nhất trong cùng module, không phải một quyết định. (FULL gate `silent-failure-hunter`, MEDIUM-1.)
      this.logger.warn(
        `NOTI-032: sáng kiến ở bài ${postId} chuyển sang "${status}" nhưng tác giả (${authorUserId}) KHÔNG còn hoạt động — không phát thông báo.`,
      );
      return;
    }

    const payload: SocialIdeaStatusChangedPayload = {
      post_id: postId,
      status_label: IDEA_STATUS_LABEL[status],
      // Enum THÔ — chỉ để `dedupeKeyOf` dựng `{post_id}:{status}`. KHÔNG có trong `PAYLOAD_KEYS` nên
      // nó không đi vào `notifications.payload` (M34b: `dedupeKeyOf` đọc `ctx.payload` thô).
      status,
      recipientUserIds: recipients,
    };
    await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_IDEA_STATUS_CHANGED, payload });
  }

  /**
   * Row → DTO của `045`, kèm MASK `reviewNote` (D19).
   *
   * `reviewNote` chỉ chiếu cho **tác giả sáng kiến** HOẶC người có `approve:feed-idea`; người khác nhận
   * `null` (ca `I-10` assert `JSON.stringify` không chứa chuỗi note). `reviewer` chỉ chở `fullName` —
   * KHÔNG `users.id` (xem `listIdeasTx`).
   */
  private toItem(row: IdeaListRow, viewerUserId: string, canSeeAllNotes: boolean): IdeaItemDto {
    const maySeeNote = canSeeAllNotes || row.authorUserId === viewerUserId;
    return {
      ideaId: row.ideaId,
      postId: row.postId,
      status: row.status,
      body: row.body,
      reviewNote: maySeeNote ? row.reviewNote : null,
      reviewer: row.reviewerName ? { fullName: row.reviewerName } : null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

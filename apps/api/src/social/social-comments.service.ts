import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type {
  CreateFeedCommentDto,
  FeedCommentCreatedDto,
  FeedCommentDto,
  FeedCommentPageDto,
  ListCommentsQueryDto,
  UpdateFeedCommentDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedComments } from "../db/schema/social";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { SocialAccessService } from "./social-access.service";
import { SocialAttachmentsService } from "./social-attachments.service";
import { SocialCommentsRepository, type CommentRow } from "./social-comments.repository";
import { bumpPostCounter, softDeleteCommentTx } from "./social-counters";
import { decodeFeedCursor, encodeFeedCursor, fingerprintFeedFilter } from "./social-feed-cursor";
import {
  clearMentions,
  parseHashtags,
  resolveMentions,
  syncMentions,
  targetTypeLabel,
  type ResolvedMention,
} from "./social-mentions";
import {
  SOCIAL_EVENT_COMMENT_REPLIED,
  SOCIAL_EVENT_MENTIONED,
  SOCIAL_EVENT_POST_COMMENTED,
  type SocialCommentRepliedPayload,
  type SocialMentionedPayload,
  type SocialPostCommentedPayload,
} from "./social-noti.payload";
import { SocialActorProjectionRepository } from "./social-posts.repository";
import { resolveActorName } from "./social-posts.service";
import { SocialReactionsRepository } from "./social-reactions.repository";
import { SOCIAL_ERR } from "./social.errors";
import { toFeedCommentDto } from "./social.mapper";
import type { SocialActor, SocialRequestUser, SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — `SOCIAL-API-014..017` (bình luận 1 cấp).
 *
 * ⚠️ **MỘT CẤP ép Ở ĐÂY, không ở DB** (`schema/social.ts:206`): CHECK cấp hàng không nhìn được hàng
 * cha, và trigger là bẫy đóng băng. Vị từ thật: `parent.parent_comment_id IS NULL` **và** cha thuộc
 * CÙNG bài — xem `SocialCommentsRepository.parentAuthorFor`.
 *
 * ⚠️ Bình luận KHÔNG có phạm vi riêng — nó thừa hưởng phạm vi của BÀI CHA. Mọi đường vào đây đi qua
 * `assertPostVisible` (theo `post_id`) hoặc `assertCommentVisible` (theo `comment_id`).
 */
@Injectable()
export class SocialCommentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialCommentsRepository,
    private readonly reactions: SocialReactionsRepository,
    private readonly projections: SocialActorProjectionRepository,
    private readonly attachments: SocialAttachmentsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  /** `SOCIAL-API-014` — `GET /social/posts/{id}/comments`. */
  async list(
    user: SocialRequestUser,
    postId: string,
    query: ListCommentsQueryDto,
  ): Promise<FeedCommentPageDto> {
    const actor = await this.access.resolveActor(user, "commentList");
    const fingerprint = fingerprintFeedFilter(["comments", postId]);
    const cursor = query.cursor ? decodeFeedCursor(query.cursor, fingerprint) : null;

    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      // Cổng nằm ở BÀI: thấy được bài ⇒ đọc được bình luận của nó.
      await this.access.assertPostVisible(tx, actor, postId);
      return this.repo.listForPost(tx, actor.companyId, postId, query.limit, cursor);
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const data = await this.decorate(actor, page);
    const last = page[page.length - 1];
    return {
      data,
      nextCursor:
        hasMore && last
          ? encodeFeedCursor({ sortAt: new Date(last.sortAt), id: last.id }, fingerprint)
          : null,
    };
  }

  /**
   * `SOCIAL-API-015` — `POST /social/posts/{id}/comments`. `@Idempotent()` ở controller.
   *
   * Ba cổng, ĐÚNG THỨ TỰ: thấy được bài (404) → bài chưa khoá bình luận (409 `ERR-004`) → cha hợp lệ
   * 1 cấp (422 `ERR-005`). Thứ tự có nghĩa: `assertPostVisible` phải chạy TRƯỚC, nếu không người
   * ngoài phạm vi sẽ phân biệt được "bài đã khoá bình luận" với "bài không tồn tại" — 404 hằng bị
   * thủng bằng một kênh phụ (khuôn `ChatReactionsService.assertReactable`).
   */
  async create(
    user: SocialRequestUser,
    postId: string,
    dto: CreateFeedCommentDto,
  ): Promise<FeedCommentCreatedDto> {
    const actor = await this.access.resolveActor(user, "commentCreate");

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.access.assertPostVisible(tx, actor, postId);
      if (post.commentsLocked) {
        throw new ConflictException(SOCIAL_ERR.COMMENTS_LOCKED);
      }

      let parentAuthorUserId: string | null = null;
      if (dto.parentCommentId) {
        const parent = await this.repo.parentAuthorFor(
          tx,
          actor.companyId,
          postId,
          dto.parentCommentId,
        );
        // `undefined` = cha không tồn tại / không thuộc bài này ⇒ 404 (cùng luật che của bình luận).
        if (parent === undefined) throw new NotFoundException(SOCIAL_ERR.COMMENT_NOT_FOUND);
        // `null` = cha CHÍNH NÓ đã là một trả lời ⇒ quá 1 cấp.
        if (parent === null) throw new UnprocessableEntityException(SOCIAL_ERR.REPLY_DEPTH);
        parentAuthorUserId = parent;
      }

      const authorEmployeeId = await employeeIdOf(tx, actor);
      const [inserted] = await tx
        .insert(feedComments)
        .values({
          companyId: actor.companyId,
          postId,
          parentCommentId: dto.parentCommentId ?? null,
          authorUserId: actor.actorUserId,
          authorEmployeeId,
          body: dto.body,
          createdBy: actor.actorUserId,
          updatedBy: actor.actorUserId,
        })
        .returning({ id: feedComments.id });
      const commentId = inserted.id;

      // Bình luận LÀ hoạt động ⇒ bump `last_activity_at` (mặc định `bumpActivity: true`).
      await bumpPostCounter(tx, actor.companyId, postId, "commentCount", 1);

      // Hashtag trong bình luận KHÔNG vào `feed_post_tags`: bảng đó nối THẺ với BÀI, và gắn thẻ của
      // bình luận vào bài cha sẽ làm bài xuất hiện dưới một thẻ mà tác giả bài không hề đặt.
      // Parse vẫn chạy để tập luật một chỗ; kết quả CỐ Ý bỏ đi ở BE-1 (thẻ cho bình luận: BE-1B).
      void parseHashtags(dto.body);

      const mentions = await resolveMentions(
        tx,
        actor,
        { audience: post.audience, orgUnitId: post.orgUnitId },
        dto.mentionedUserIds ?? [],
      );
      const fresh = await syncMentions(
        tx,
        actor.companyId,
        "comment",
        commentId,
        mentions.accepted,
      );

      if (dto.attachmentIds?.length) {
        await this.attachments.syncLinksTx(
          tx,
          actor.companyId,
          actor.actorUserId,
          "comment",
          commentId,
          dto.attachmentIds,
        );
      }

      await this.enqueueNotis(tx, actor, {
        postId,
        commentId,
        postAuthorUserId: post.authorUserId,
        parentCommentId: dto.parentCommentId ?? null,
        parentAuthorUserId,
        freshMentions: fresh,
      });

      const row = await this.repo.findById(tx, actor.companyId, commentId);
      return { row, post, dropped: mentions.dropped };
    });

    if (!result.row) throw new NotFoundException(SOCIAL_ERR.COMMENT_NOT_FOUND);
    const [dto2] = await this.decorate(actor, [result.row]);
    this.emitCommentCreated(actor, result.post.audience, result.post.status, dto2);
    return { ...dto2, droppedMentions: toDropped(result.dropped) };
  }

  /** `SOCIAL-API-016` — sửa bình luận. Chủ bình luận HOẶC `manage:feed-post`. */
  async update(
    user: SocialRequestUser,
    commentId: string,
    dto: UpdateFeedCommentDto,
  ): Promise<FeedCommentCreatedDto> {
    const actor = await this.access.resolveActor(user, "commentUpdate");

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      const comment = await this.access.assertCommentVisible(tx, actor, commentId);
      const asManager = this.access.assertCanMutateContent(actor, comment.authorUserId);

      const now = new Date();
      await tx
        .update(feedComments)
        .set({ body: dto.body, editedAt: now, updatedAt: now, updatedBy: actor.actorUserId })
        .where(and(eq(feedComments.id, commentId), eq(feedComments.companyId, actor.companyId)));

      // Cung luat voi `remove` va voi 004 — xem lap luan o `SocialPostsService.update`.
      if (asManager) {
        await this.audit.record(tx, {
          action: "social.comment.update",
          objectType: "feed_comment",
          objectId: commentId,
          actorUserId: actor.actorUserId,
          moduleCode: "SOCIAL",
          entityType: "feed_comment",
          entityId: commentId,
          resultStatus: "Success",
          metadata: { commentId, postId: comment.postId, authorUserId: comment.authorUserId },
        });
      }

      const mentions = await resolveMentions(
        tx,
        actor,
        { audience: comment.post.audience, orgUnitId: comment.post.orgUnitId },
        dto.mentionedUserIds ?? [],
      );
      const fresh = await syncMentions(
        tx,
        actor.companyId,
        "comment",
        commentId,
        mentions.accepted,
      );

      // `dto.attachmentIds` là allowlist ĐẦY ĐỦ của lượt sửa (khuôn `SocialPostsService.update`, D18
      // liệt kê 016 trong nhóm phải đồng bộ): kiểm `undefined` chứ KHÔNG `?.length` như nhánh tạo —
      // mảng RỖNG ở đường sửa nghĩa là "bỏ hết đính kèm", nuốt nó đi là im lặng không gỡ link nào.
      if (dto.attachmentIds) {
        await this.attachments.syncLinksTx(
          tx,
          actor.companyId,
          actor.actorUserId,
          "comment",
          commentId,
          dto.attachmentIds,
        );
      }

      if (dto.mentionedUserIds && fresh.length > 0) {
        await this.enqueueMentionNotis(tx, actor, comment.postId, commentId, fresh);
      }

      const row = await this.repo.findById(tx, actor.companyId, commentId);
      return { row, dropped: mentions.dropped };
    });

    if (!result.row) throw new NotFoundException(SOCIAL_ERR.COMMENT_NOT_FOUND);
    const [dto2] = await this.decorate(actor, [result.row]);
    return { ...dto2, droppedMentions: toDropped(result.dropped) };
  }

  /**
   * `SOCIAL-API-017` — xoá mềm bình luận. Audit CHỈ khi xoá của NGƯỜI KHÁC (xem lập luận ở
   * `SocialPostsService.remove`).
   *
   * Dọn theo mention + cảm xúc của CHÍNH bình luận đó trong cùng tx: hai bảng đó trỏ vào nó bằng
   * khoá ĐA HÌNH KHÔNG FK, nên không có `ON DELETE` nào dọn giúp — để lại là rác trỏ vào một hàng
   * không ai đọc được nữa, và `like_count` tổng hợp sau này sẽ đếm cả chúng.
   */
  async remove(user: SocialRequestUser, commentId: string): Promise<{ deleted: true }> {
    const actor = await this.access.resolveActor(user, "commentDelete");

    await this.db.withTenant(actor.companyId, async (tx) => {
      const comment = await this.access.assertCommentVisible(tx, actor, commentId);
      const asManager = this.access.assertCanMutateContent(actor, comment.authorUserId);

      const deleted = await softDeleteCommentTx(
        tx,
        actor.companyId,
        commentId,
        comment.postId,
        actor.actorUserId,
      );
      if (!deleted) return;

      await clearMentions(tx, actor.companyId, "comment", commentId);
      await this.reactions.clearForTarget(tx, actor.companyId, "comment", commentId);

      if (asManager) {
        await this.audit.record(tx, {
          action: "social.comment.delete",
          objectType: "feed_comment",
          objectId: commentId,
          actorUserId: actor.actorUserId,
          moduleCode: "SOCIAL",
          entityType: "feed_comment",
          entityId: commentId,
          resultStatus: "Success",
          metadata: { commentId, postId: comment.postId, authorUserId: comment.authorUserId },
        });
      }
    });
    return { deleted: true };
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  private async decorate(
    viewer: SocialViewerContext,
    rows: CommentRow[],
  ): Promise<FeedCommentDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const myReactions = await this.db.withTenant(viewer.companyId, (tx) =>
      this.projections.myReactions(tx, viewer.companyId, viewer.actorUserId, "comment", ids),
    );
    const attachments = await this.attachments.decorateMany(viewer, "comment", ids);

    return rows.map((row) =>
      toFeedCommentDto(row, viewer, {
        attachments: attachments.get(row.id) ?? [],
        myReaction: myReactions.get(row.id) ?? null,
      }),
    );
  }

  /**
   * Ba sự kiện NOTI của một bình luận mới, mỗi cái có luật «không tự báo cho chính mình» riêng.
   *
   * `029` và `030` LOẠI TRỪ NHAU về mặt người nhận khi cha ≡ tác giả bài? KHÔNG — chúng độc lập:
   * trả lời bình luận của A trên bài của B thì A nhận `030` và B nhận `029`. Trường hợp A ≡ B thì
   * cùng một người nhận cả hai, và đó là ĐÚNG NGỮ NGHĨA (hai việc khác nhau vừa xảy ra với họ);
   * gộp lại ở đây là quyết định của tầng NOTI, không phải của producer.
   */
  private async enqueueNotis(
    tx: TenantTx,
    actor: SocialActor,
    ctx: {
      postId: string;
      commentId: string;
      postAuthorUserId: string;
      parentCommentId: string | null;
      parentAuthorUserId: string | null;
      freshMentions: readonly ResolvedMention[];
    },
  ): Promise<void> {
    const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);

    // 029 — bình luận vào bài của NGƯỜI KHÁC. Tự bình luận bài mình ⇒ không báo.
    if (ctx.postAuthorUserId !== actor.actorUserId) {
      const payload: SocialPostCommentedPayload = {
        actorUserId: actor.actorUserId,
        postId: ctx.postId,
        commentId: ctx.commentId,
        postAuthorUserId: ctx.postAuthorUserId,
        actor_name: actorName,
        post_id: ctx.postId,
      };
      await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_POST_COMMENTED, payload });
    }

    // 030 — trả lời bình luận của NGƯỜI KHÁC. Tự trả lời mình ⇒ không báo.
    if (
      ctx.parentCommentId &&
      ctx.parentAuthorUserId &&
      ctx.parentAuthorUserId !== actor.actorUserId
    ) {
      const payload: SocialCommentRepliedPayload = {
        actorUserId: actor.actorUserId,
        postId: ctx.postId,
        commentId: ctx.commentId,
        parentCommentId: ctx.parentCommentId,
        parentAuthorUserId: ctx.parentAuthorUserId,
        actor_name: actorName,
        post_id: ctx.postId,
      };
      await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_COMMENT_REPLIED, payload });
    }

    await this.enqueueMentionNotis(
      tx,
      actor,
      ctx.postId,
      ctx.commentId,
      ctx.freshMentions,
      actorName,
    );
  }

  private async enqueueMentionNotis(
    tx: TenantTx,
    actor: SocialActor,
    postId: string,
    commentId: string,
    fresh: readonly ResolvedMention[],
    knownActorName?: string,
  ): Promise<void> {
    if (fresh.length === 0) return;
    const actorName =
      knownActorName ?? (await resolveActorName(tx, actor.companyId, actor.actorUserId));
    for (const m of fresh) {
      const payload: SocialMentionedPayload = {
        actorUserId: actor.actorUserId,
        postId,
        targetType: "comment",
        targetId: commentId,
        mentionedUserId: m.userId,
        actor_name: actorName,
        post_id: postId,
        target_type_label: targetTypeLabel("comment"),
      };
      await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_MENTIONED, payload });
    }
  }

  /**
   * Phát `feed:comment.created` — **chỉ khi BÀI CHA fan-out được** (`audience='company'` +
   * `status='published'`, plan §2 D21).
   *
   * Bình luận không có audience riêng, nên câu hỏi luôn là về bài cha: phát bình luận của một bài
   * `org_unit` vào room cả-công-ty là rò nguyên văn nội dung bình luận đó.
   */
  private emitCommentCreated(
    actor: SocialActor,
    postAudience: string,
    postStatus: string,
    dto: FeedCommentDto,
  ): void {
    if (postAudience !== "company" || postStatus !== "published") return;
    const { myReaction: _mr, isMine: _im, attachments, ...rest } = dto;
    this.realtime.emitFeedCommentCreated(actor.companyId, {
      ...rest,
      attachments: attachments.map(({ url: _u, ...a }) => a),
    });
  }
}

async function employeeIdOf(tx: TenantTx, actor: SocialActor): Promise<string | null> {
  const rows = await tx
    .select({ id: employeeProfiles.id })
    .from(employeeProfiles)
    .where(
      and(
        eq(employeeProfiles.companyId, actor.companyId),
        eq(employeeProfiles.userId, actor.actorUserId),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Dội lại ĐÚNG id caller đã gửi — xem docblock `ResolvedMention` (không kèm tên, không kèm lý do). */
function toDropped(dropped: readonly ResolvedMention[]): string[] {
  return dropped.map((m) => m.userId);
}

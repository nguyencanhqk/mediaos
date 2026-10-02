import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type { FeedPostDto, ModerateFeedPostDto } from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { feedPosts } from "../db/schema/social";
import { AuditService } from "../events/audit.service";
import { SocialAccessService } from "./social-access.service";
import { SocialAttachmentsService } from "./social-attachments.service";
import { SocialAvatarSigner } from "./social-avatar-signer";
import {
  SOCIAL_MODERATION_FIELDS,
  SOCIAL_MODERATION_FIELD_PAIRS,
  type SocialModerationField,
} from "./social-route-pairs.const";
import { SocialActorProjectionRepository, SocialPostsRepository } from "./social-posts.repository";
import { SOCIAL_ERR, socialError } from "./social.errors";
import { toFeedPostDto } from "./social.mapper";
import type { SocialActor, SocialPostAccess, SocialRequestUser } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — `SOCIAL-API-006` `PATCH /social/posts/{id}/moderation`.
 *
 * Tách file NGAY TỪ ĐẦU (plan §3) chứ không "tách khi vượt trần": route này có luật riêng hoàn toàn
 * (cặp quyền theo TỪNG TRƯỜNG + một dòng audit mỗi trường) và trộn vào `social-posts.service.ts` sẽ
 * đẩy file đó vượt trần 800 ngay khi cộng đính kèm.
 *
 * ┌─ ⚠️ CẶP QUYỀN THEO TRƯỜNG, KHÔNG PHẢI THEO ROUTE (API-19 §5.1c) ──────────────────────────────┐
 * │   `hidden`         → `manage:feed-post`                                                        │
 * │   `commentsLocked` → `manage:feed-post`                                                        │
 * │   `pinned`         → **`manage:feed-news`** (KHÔNG phải `manage:feed-post`)                     │
 * │                                                                                                 │
 * │ Decorator route ép `manage:feed-post` làm **SÀN** (`tier1IsFloor:true`). Hệ quả ĐÃ ĐO và CHẤP   │
 * │ NHẬN (plan M18/D5): một vai TUỲ BIẾN chỉ có `manage:feed-news` mà không có `manage:feed-post`   │
 * │ bị 403 **ở tầng 1**, kể cả khi chỉ đổi `pinned`. Hôm nay hai cặp đó cấp cho ĐÚNG CÙNG tập vai    │
 * │ canonical (`hr` + `company-admin`, seed `0578:92-95`) ⇒ 0 tác động. Dư lượng ghi nợ BE-2.       │
 * │                                                                                                 │
 * │ ⚠️ KHÔNG khai nhánh `manage:feed-post` cho `pinned`: CHECK `chk_feed_posts_pinned_news` chỉ cho │
 * │ ghim bài `news`, nên nhánh đó là **nhánh chết** (API-19 §5.1c nói thẳng).                        │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class SocialPostsModerationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialPostsRepository,
    private readonly projections: SocialActorProjectionRepository,
    private readonly attachments: SocialAttachmentsService,
    private readonly audit: AuditService,
    private readonly avatarSigner: SocialAvatarSigner,
  ) {}

  async moderate(
    user: SocialRequestUser,
    postId: string,
    dto: ModerateFeedPostDto,
  ): Promise<FeedPostDto> {
    const actor = await this.access.resolveActor(user, "postModerate");

    const row = await this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.access.assertPostVisible(tx, actor, postId);
      const outcome = await this.moderateTx(tx, actor, post, dto);
      // `"noop"` (không trường nào đổi) là thành công bình thường của `006`.
      // D6a — bài vừa bị xoá bởi một lượt đua sau khi qua cổng đọc ⇒ cùng 404 như cổng đọc.
      if (outcome === "gone") throw new NotFoundException(socialError(SOCIAL_ERR.POST_NOT_FOUND));
      return this.repo.findVisible(tx, actor, postId);
    });

    if (!row) throw new NotFoundException(socialError(SOCIAL_ERR.POST_NOT_FOUND));

    // Tx ĐỌC thứ hai (tx ghi ở trên đã commit) — S16-SOCIAL-AVATARPRESIGN-1 ký avatar tác giả CÙNG tx này.
    const { tags, myReaction, saved, avatars } = await this.db.withTenant(
      actor.companyId,
      async (tx) => ({
        tags: await this.repo.tagsFor(tx, actor.companyId, [row.id]),
        myReaction: await this.projections.myReactions(
          tx,
          actor.companyId,
          actor.actorUserId,
          "post",
          [row.id],
        ),
        saved: await this.projections.savedPostIds(tx, actor.companyId, actor.actorUserId, [
          row.id,
        ]),
        avatars: await this.avatarSigner.signTx(tx, actor.companyId, [
          { employeeId: row.authorEmployeeId, avatarRaw: row.authorAvatarRaw },
        ]),
      }),
    );
    const attachments = await this.attachments.decorateMany(actor, "post", [row.id]);

    return toFeedPostDto(row, actor, {
      tags: tags.get(row.id) ?? [],
      attachments: attachments.get(row.id) ?? [],
      myReaction: myReaction.get(row.id) ?? null,
      savedByMe: saved.has(row.id),
      avatars,
    });
  }

  /**
   * S16-SOCIAL-BE-3A (D5) — HÀM LÕI tầng tx của kiểm duyệt: kiểm cặp theo trường → diff → MỘT câu
   * UPDATE → một dòng audit mỗi trường đổi. Route `006` và hành động kèm của `029`
   * (`hide_post`/`lock_comments`) đi qua CHÍNH hàm này — không có câu UPDATE song song thứ hai.
   *
   * ⚠️ Nhận `post` ĐÃ qua cổng đọc (`assertPostVisible`/`findPostVisible`) — hàm này KHÔNG tự gọi
   * cổng: mỗi caller dịch «không thấy» sang mã của riêng nó (404 ở `006`, 422 ở `029`).
   *
   * ┌─ D6a — VÁ RACE «ẨN SAU KHI ĐÃ XOÁ» ───────────────────────────────────────────────────────────┐
   * │ Cổng đọc và UPDATE là HAI câu. Một `DELETE` (`005`/`029 delete_target`) commit giữa hai câu ⇒ │
   * │ trước vá, UPDATE (chỉ lọc `id` + `company_id`) chờ khoá hàng rồi ghi `status='hidden'` lên   │
   * │ một hàng đã `deleted_at` ⇒ bài «ẩn» mà đã xoá, và `status` ghi đè mất `'deleted'`. Vế          │
   * │ `deleted_at IS NULL` được Postgres ĐÁNH GIÁ LẠI trên phiên bản mới sau khi chờ khoá (READ     │
   * │ COMMITTED) ⇒ 0 hàng ⇒ `"gone"`, KHÔNG audit.                                                   │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * ┌─ FULL gate (database LOW-3 · silent-failure MEDIUM-1) — SO TRÊN HÀNG ĐÃ KHOÁ ───────────────┐
   * │ Diff trên ảnh chụp của cổng đọc (chưa khoá) thì (a) hai lượt `lock_comments` nối đuôi cùng     │
   * │ bài đều thấy `false→true` ⇒ HAI dòng audit cho MỘT thay đổi; (b) nhánh «không đổi gì» trả về   │
   * │ mà không chạm khoá nào ⇒ `hide_post` trên bài đã ẩn mà đang bị xoá dở vẫn «thành công». Đọc   │
   * │ lại `status/pinned/comments_locked` `FOR UPDATE` với `deleted_at IS NULL` trước khi diff.       │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   *
   * @returns `"ok"` (đã ghi) · `"noop"` (hàng còn sống, không trường nào đổi — không ghi, không audit)
   *   · `"gone"` (hàng đã xoá — không ghi).
   */
  async moderateTx(
    tx: TenantTx,
    actor: SocialActor,
    post: SocialPostAccess,
    dto: ModerateFeedPostDto,
  ): Promise<"ok" | "noop" | "gone"> {
    // Tập trường CÓ MẶT trong body, theo thứ tự ỔN ĐỊNH (không theo thứ tự khoá của object —
    // audit phải ra dòng theo thứ tự đọc được, không theo hash).
    const requested = SOCIAL_MODERATION_FIELDS.filter((f) => dto[f] !== undefined);

    // ── Cổng: kiểm quyền CHO TỪNG TRƯỜNG, TRƯỚC khi ghi bất cứ gì ──
    // Kiểm TẤT CẢ rồi mới ghi (không kiểm-ghi xen kẽ): một request đổi 2 trường mà trường thứ hai
    // bị từ chối phải KHÔNG đổi trường nào — nếu không, người dùng nhận 403 nhưng nửa thao tác đã
    // xảy ra, và audit ghi một nửa sự thật.
    for (const field of requested) {
      if (!this.canChange(actor, field)) {
        throw new ForbiddenException(socialError(SOCIAL_ERR.MODERATION_FIELD_DENIED));
      }
    }

    // Chỉ ghim được bài `news` (mirror `chk_feed_posts_pinned_news` — chặn ở app TRƯỚC để không vỡ
    // CHECK thành 500 vô danh).
    if (dto.pinned === true && post.type !== "news") {
      throw new UnprocessableEntityException(socialError(SOCIAL_ERR.PIN_NEWS_ONLY));
    }

    const [locked] = await tx
      .select({
        status: feedPosts.status,
        pinned: feedPosts.pinned,
        commentsLocked: feedPosts.commentsLocked,
      })
      .from(feedPosts)
      .where(
        and(
          eq(feedPosts.id, post.id),
          eq(feedPosts.companyId, actor.companyId),
          isNull(feedPosts.deletedAt),
        ),
      )
      .for("update");
    if (!locked) return "gone";

    const changes: { field: SocialModerationField; from: unknown; to: unknown }[] = [];
    const patch: Record<string, unknown> = {};

    for (const field of requested) {
      const to = dto[field]!;
      const from = currentValue(locked, field);
      // Không đổi ⇒ KHÔNG ghi, KHÔNG audit. Một dòng audit `false → false` là tiếng ồn trên đúng
      // bảng mà người điều tra cần đọc.
      if (from === to) continue;
      changes.push({ field, from, to });
      if (field === "hidden") patch.status = to ? "hidden" : "published";
      else patch[field] = to;
    }

    if (changes.length === 0) return "noop";

    patch.updatedAt = new Date();
    patch.updatedBy = actor.actorUserId;
    const updated = await tx
      .update(feedPosts)
      .set(patch)
      .where(
        and(
          eq(feedPosts.id, post.id),
          eq(feedPosts.companyId, actor.companyId),
          isNull(feedPosts.deletedAt),
        ),
      )
      .returning({ id: feedPosts.id });
    if (updated.length === 0) return "gone";

    // MỖI TRƯỜNG ĐỔI = MỘT DÒNG AUDIT RIÊNG (API-19 §8). Payload `{postId, field, from, to}` —
    // KHÔNG nội dung bài.
    for (const c of changes) {
      await this.audit.record(tx, {
        action: `social.post.moderation.${c.field}`,
        objectType: "feed_post",
        objectId: post.id,
        actorUserId: actor.actorUserId,
        moduleCode: "SOCIAL",
        entityType: "feed_post",
        entityId: post.id,
        resultStatus: "Success",
        oldValues: { [c.field]: c.from },
        newValues: { [c.field]: c.to },
        metadata: { postId: post.id, field: c.field, from: c.from, to: c.to },
      });
    }
    return "ok";
  }

  /**
   * Cặp quyền của MỘT trường, tra từ `SOCIAL_MODERATION_FIELD_PAIRS` (nguồn sự thật duy nhất —
   * census 2 tầng so với CHÍNH bảng đó).
   *
   * Hai cờ `canManagePosts`/`canManageNews` đã resolve MỘT LẦN ở `resolveActor`; ánh xạ ở đây là
   * thuần, không chạm DB thêm.
   */
  private canChange(actor: SocialActor, field: SocialModerationField): boolean {
    const pair = SOCIAL_MODERATION_FIELD_PAIRS[field];
    if (pair.resourceType === "feed-news") return actor.canManageNews;
    return actor.canManagePosts;
  }
}

/** Giá trị HIỆN TẠI của trường kiểm duyệt — `hidden` suy từ `status`, không phải một cột riêng. */
function currentValue(
  post: { status: string; pinned: boolean; commentsLocked: boolean },
  field: SocialModerationField,
): boolean {
  if (field === "hidden") return post.status === "hidden";
  if (field === "pinned") return post.pinned;
  return post.commentsLocked;
}

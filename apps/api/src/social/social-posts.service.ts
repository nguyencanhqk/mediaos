import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import type {
  CreateFeedPostDto,
  FeedPostCreatedDto,
  FeedPostDto,
  FeedPostFlagResultDto,
  FeedPostPageDto,
  ListFeedQueryDto,
  ListSavedQueryDto,
  UpdateFeedPostDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { employeeProfiles } from "../db/schema/employees";
import { feedPosts } from "../db/schema/social";
import { users } from "../db/schema/users";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { SocialAccessService } from "./social-access.service";
import { SocialAttachmentsService } from "./social-attachments.service";
import { bumpPostCounter, softDeletePostTx } from "./social-counters";
import { decodeFeedCursor, encodeFeedCursor, fingerprintFeedFilter } from "./social-feed-cursor";
import {
  parseHashtags,
  resolveMentions,
  syncMentions,
  syncPostTags,
  targetTypeLabel,
  type ResolvedMention,
} from "./social-mentions";
import { createIdeaTx, createKudosTx, createPollTx } from "./social-post-types";
import { userIdsOfEmployeesTx } from "./social-kudos.repository";
import { SocialNewsRepository } from "./social-news.repository";
import {
  SOCIAL_EVENT_MENTIONED,
  SOCIAL_EVENT_KUDOS_RECEIVED,
  SOCIAL_EVENT_NEWS_PUBLISHED,
  SOCIAL_NEWS_NOTI_RECIPIENT_CAP,
  type SocialKudosReceivedPayload,
  type SocialMentionedPayload,
  type SocialNewsPublishedPayload,
} from "./social-noti.payload";
import {
  SocialActorProjectionRepository,
  SocialPostsRepository,
  type PostRow,
} from "./social-posts.repository";
import { SOCIAL_ERR } from "./social.errors";
import { toFeedPostDto } from "./social.mapper";
import type { SocialActor, SocialRequestUser, SocialViewerContext } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — `SOCIAL-API-001..005, 007..010` (kiểm duyệt `006` ở
 * `social-posts-moderation.service.ts`).
 *
 * ┌─ THỨ TỰ BẮT BUỘC CỦA MỌI ĐƯỜNG GHI ────────────────────────────────────────────────────────────┐
 * │ 1. `access.resolveActor(user, routeKey)` — tầng guard 2, TRƯỚC mọi side-effect;                 │
 * │ 2. mở `withTenant` → `assertPostVisible` (nếu theo `{id}`) → kiểm nghiệp vụ → GHI → audit +     │
 * │    outbox **CÙNG tx**;                                                                          │
 * │ 3. SAU commit: ký URL đính kèm + phát WS.                                                       │
 * │ Bước 3 nằm ngoài tx vì cả hai đều tự mở kết nối riêng — `withTenant` lồng nhau TREO trên         │
 * │ PgBouncer transaction-mode chứ không báo lỗi.                                                   │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class SocialPostsService {
  private readonly logger = new Logger(SocialPostsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialPostsRepository,
    private readonly projections: SocialActorProjectionRepository,
    private readonly attachments: SocialAttachmentsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimeEmitterService,
    // ⟲ S16-SOCIAL-BE-1B — chỉ dùng cho tập người nhận NOTI-031 (`audienceUserIds`).
    private readonly news: SocialNewsRepository,
  ) {}

  /** `SOCIAL-API-001` — `GET /social/feed`. */
  async list(user: SocialRequestUser, query: ListFeedQueryDto): Promise<FeedPostPageDto> {
    const actor = await this.access.resolveActor(user, "feedList");

    // `status` khác `published` là nguồn dữ liệu của màn KIỂM DUYỆT ⇒ đòi thêm `manage:feed-post`
    // (API-19 §5.1). 403 TƯỜNG MINH, KHÔNG im lặng ép về `published`: ép ngầm làm người vận hành
    // thấy dòng cuộn thường và kết luận "không có bài ẩn nào".
    if (query.status && query.status !== "published" && !actor.canManagePosts) {
      throw new ForbiddenException(SOCIAL_ERR.MODERATION_FIELD_DENIED);
    }

    const fingerprint = feedFingerprint(actor, query);
    const cursor = query.cursor ? decodeFeedCursor(query.cursor, fingerprint) : null;

    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listFeed(tx, actor, {
        sort: query.sort,
        limit: query.limit,
        cursor,
        type: query.type,
        audience: query.audience,
        status: query.status,
        authorUserId: query.authorUserId,
        orgUnitId: query.orgUnitId,
        tag: query.tag,
        // D-OWNER-6: feed khám phá KHÔNG có bài nhóm — trừ khi lọc đích danh `groupId` (D-OWNER-7).
        groupScope: query.groupId ? { only: query.groupId } : "exclude",
      }),
    );

    return this.toPage(actor, rows, query.limit, fingerprint);
  }

  /** `SOCIAL-API-010` — `GET /social/saved` (chỉ bài actor đã lưu). */
  async listSaved(user: SocialRequestUser, query: ListSavedQueryDto): Promise<FeedPostPageDto> {
    const actor = await this.access.resolveActor(user, "savedList");
    // Con trỏ của «đã lưu» và của feed KHÔNG dùng lẫn nhau được — khác tập hàng hoàn toàn. Dấu vân
    // riêng ("saved") làm việc dùng nhầm thành 400 thay vì một trang sai im lặng.
    const fingerprint = fingerprintFeedFilter(["saved", actor.actorUserId, "active"]);
    const cursor = query.cursor ? decodeFeedCursor(query.cursor, fingerprint) : null;

    const rows = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.listFeed(tx, actor, {
        sort: "active",
        limit: query.limit,
        cursor,
        savedByActorOnly: true,
        // D-OWNER-6: GIỮ bài nhóm ở «Đã lưu» — chính actor đã bấm lưu, và membership vẫn bị
        // `visiblePostCondition` gác. Ẩn đi thì `savedByMe=true` mà không thấy bài: hai đường nói
        // ngược nhau về cùng một hành động của chính người dùng.
        groupScope: "include",
      }),
    );
    return this.toPage(actor, rows, query.limit, fingerprint);
  }

  /** `SOCIAL-API-003` — `GET /social/posts/{id}`. */
  async get(user: SocialRequestUser, postId: string): Promise<FeedPostDto> {
    const actor = await this.access.resolveActor(user, "postDetail");
    const row = await this.db.withTenant(actor.companyId, (tx) =>
      this.repo.findVisible(tx, actor, postId),
    );
    if (!row) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);
    const [dto] = await this.decorate(actor, [row]);
    return dto;
  }

  /**
   * `SOCIAL-API-002` — `POST /social/posts`. `@Idempotent()` ở controller.
   *
   * ⚠️ **TẦNG 2 CỦA `tier1IsFloor`**: decorator chỉ ép `create:feed-post` (SÀN). Nhánh `type='news'`
   * đòi THÊM `manage:feed-news` — ép ở ĐÂY, 403 `SOCIAL-ERR-010` (API-19 §5.1b).
   */
  async create(user: SocialRequestUser, dto: CreateFeedPostDto): Promise<FeedPostCreatedDto> {
    const actor = await this.access.resolveActor(user, "postCreate");

    // 🔴 S16-SOCIAL-BE-2B-1 — cổng phụ THEO LOẠI BÀI, MỘT lời gọi cho mọi loại.
    //
    // Trước đây chỗ này là `if (dto.type === "news" && !actor.canManageNews) throw …` — một nhánh
    // hard-code, trong khi bảng `SOCIAL_POST_TYPE_PAIRS` (thứ census đọc để kết luận "loại bài nào
    // cũng có cặp gác") KHÔNG có call-site runtime nào. Hai thứ rời nhau: thêm một loại vào
    // `feedCreatableTypeSchema` mà quên nhánh `if` thì loại đó tạo được KHÔNG QUA CẶP NÀO, và
    // census vẫn XANH vì nó chỉ kiểm bảng có khoá, không kiểm ai dùng bảng.
    //
    // Giờ cổng ĐỌC chính bảng đó ⇒ quên khai một loại là TS đỏ, không phải là một lỗ chờ ship.
    await this.access.assertCreatablePostType(actor, dto.type);

    // 🔴 S16-SOCIAL-BE-2B-2 (D10/D22) — cổng THỨ HAI của nhánh vinh danh: cờ `isOfficial`.
    //
    // Chạy **TRƯỚC khi mở tx**, có chủ đích. Đặt nó trong tx cũng cho 403 đúng, nhưng lúc đó bằng
    // chứng "không ghi gì" lại phụ thuộc vào rollback — và ca `K-3` đếm `COUNT(*) feed_kudos = 0` như
    // một bất biến, không như một hệ quả của việc tx đã bị huỷ đúng cách.
    if (dto.type === "kudos" && dto.kudos?.isOfficial) {
      await this.access.assertKudosOfficial(actor);
    }

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      // 🔴 S16-SOCIAL-BE-2A (D4) — cổng GHI nằm TRONG tx, ngay trước INSERT. Trước đây nó chạy NGOÀI
      // `withTenant`: với `org_unit` (dữ liệu đã có sẵn trên actor) thì vô hại, nhưng nhánh `group`
      // phải HỎI DB (membership là hàng) — kiểm ở tx riêng rồi ghi ở tx sau là TOCTOU.
      // 404 `ERR-012` nhóm không thấy được (kể cả đã xoá mềm) · 403 `ERR-002` không phải thành viên
      // `active` / đăng vào đơn vị mình không thuộc.
      await this.access.assertWriteAudience(
        tx,
        actor,
        dto.audience,
        dto.orgUnitId ?? null,
        dto.groupId ?? null,
      );

      const authorEmployeeId = await this.employeeIdOf(tx, actor);

      const [inserted] = await tx
        .insert(feedPosts)
        .values({
          companyId: actor.companyId,
          authorUserId: actor.actorUserId,
          authorEmployeeId,
          type: dto.type,
          audience: dto.audience,
          orgUnitId: dto.audience === "org_unit" ? (dto.orgUnitId ?? null) : null,
          // Khoá chỉ có nghĩa với ĐÚNG audience của nó — `CHECK chk_feed_posts_audience_group` đòi
          // `group_id IS NOT NULL` khi `audience='group'`, nên hằng `null` cũ khoá chặt nhánh này.
          groupId: dto.audience === "group" ? (dto.groupId ?? null) : null,
          body: dto.body,
          requiresAck: dto.requiresAck,
          // `status`/`pinned`/counters CỐ Ý không truyền: DEFAULT của DB là nguồn sự thật, và DTO
          // không mang chúng (allowlist `.strict()` ở contracts). Đây là vế thứ hai của D3.
          createdBy: actor.actorUserId,
          updatedBy: actor.actorUserId,
        })
        .returning({ id: feedPosts.id });

      const postId = inserted.id;

      // ⟲ S16-SOCIAL-BE-2B-1 — thân riêng theo loại bài. CÙNG tx với INSERT bài: một bài
      // `type='poll'` không có hàng `feed_polls` là bài mà `040..044` trả 404 mãi mãi, và người
      // dùng nhìn thấy một "bình chọn" không bấm được. `dto.poll` chắc chắn có mặt khi
      // `type='poll'` — `createFeedPostSchema.superRefine` ràng cả hai chiều.
      if (dto.type === "poll" && dto.poll) {
        await createPollTx(tx, actor.companyId, postId, dto.poll);
      }

      // ⟲ S16-SOCIAL-BE-2B-2 — hai loại bài của Track B, CÙNG tx với INSERT bài (cùng lý do như
      // `poll`: một bài `type='idea'` không có hàng `feed_ideas` là bài mà `045`/`046` trả 404 mãi
      // mãi). `superRefine` ràng cả hai chiều nên `dto.kudos` chắc chắn có mặt khi `type='kudos'`.
      if (dto.type === "idea") {
        await createIdeaTx(tx, actor.companyId, postId);
      }

      if (dto.type === "kudos" && dto.kudos) {
        const { kudosId, recipientEmployeeIds } = await createKudosTx(
          tx,
          actor.companyId,
          postId,
          authorEmployeeId,
          dto.kudos,
        );

        // 🔴 AUDIT nhánh ĐẶC QUYỀN — owner ký **S8** 24/09/2026 (FULL gate `security-reviewer`, MEDIUM).
        //
        // `create()` KHÔNG audit bất kỳ `type` nào, và đó là đúng cho bài thường: tác giả + thời điểm
        // đã nằm trong chính hàng `feed_posts`. `isOfficial:true` thì khác — nó dùng năng lực
        // `manage:feed-kudos` để xuất bản nội dung mang **DẤU CÔNG TY**, tức một người nói thay tổ
        // chức. Đó đúng hình dạng mà module này đã audit ở mọi chỗ khác: `social.post.update` chỉ ghi
        // khi đi qua nhánh `asManager` (finding HIGH-2 của FULL gate PR #530, owner ký 22/09/2026) ·
        // `social.poll.close` ghi kèm cờ `viaManage` · mọi mutation nhóm qua `manage:feed-group`.
        // `isOfficial` là ngoại lệ DUY NHẤT còn lại — bít nó ở đây.
        //
        // ⚠️ CHỈ ghi ở nhánh `isOfficial`. Audit MỌI bài kudos sẽ làm sổ ngập thao tác thường và làm
        // mờ đúng thứ cần nhìn thấy; ca `K-3c` đếm cả hai chiều (có cờ ⇒ 1 dòng · không cờ ⇒ 0 dòng).
        if (dto.kudos.isOfficial) {
          await this.audit.record(tx, {
            action: "social.kudos.official",
            // `feed_post`, KHÔNG `feed_kudos`: CHECK `audit_logs.object_type` (`0583`) cố ý chỉ có
            // `feed_post` — «vinh danh là một BÀI». Thêm giá trị mới ở đây là một migration.
            objectType: "feed_post",
            objectId: postId,
            actorUserId: actor.actorUserId,
            actorType: "User",
            actionGroup: "SOCIAL",
            resultStatus: "Success",
            dataScope: "Company",
            sensitivityLevel: "Normal",
            // KHÔNG chở `message` (chữ tự do) và KHÔNG chở `employee_id` người nhận — sổ audit có bề
            // mặt đọc RIÊNG, rộng hơn `047`. Chỉ id + số lượng, đủ để lần ngược.
            metadata: { postId, kudosId, recipientCount: recipientEmployeeIds.length },
          });
        }
        // 🔴 NOTI-033 enqueue **TRONG tx** (D24). Ghi hàng outbox sau commit là at-most-once: chết
        // giữa hai bước ⇒ lời vinh danh có thật mà không ai được báo, và không có đường phát lại.
        // Khuôn đã dùng cho NOTI-028 (`enqueueMentionNotis`) và NOTI-031 ngay dưới đây.
        await this.enqueueKudosReceivedNoti(tx, actor, postId, recipientEmployeeIds);
      }

      await syncPostTags(tx, actor.companyId, postId, parseHashtags(dto.body));

      const mentions = await resolveMentions(
        tx,
        actor,
        { audience: dto.audience, orgUnitId: dto.orgUnitId ?? null, groupId: dto.groupId ?? null },
        dto.mentionedUserIds ?? [],
      );
      const fresh = await syncMentions(tx, actor.companyId, "post", postId, mentions.accepted);

      if (dto.attachmentIds?.length) {
        await this.attachments.syncLinksTx(
          tx,
          actor.companyId,
          actor.actorUserId,
          "post",
          postId,
          dto.attachmentIds,
        );
      }

      await this.enqueueMentionNotis(tx, actor, "post", postId, postId, fresh);

      // ⟲ S16-SOCIAL-BE-1B — NOTI-031 «tin tức công ty mới». CÙNG tx với INSERT (C8): tập người nhận
      // chỉ còn đúng tại thời điểm này (bài có thể bị ẩn/xoá/đổi audience ngay sau đó, và registrar
      // chạy SAU, NGOÀI tx).
      if (dto.type === "news") {
        await this.enqueueNewsPublishedNoti(tx, actor, postId, {
          audience: dto.audience,
          orgUnitId: dto.audience === "org_unit" ? (dto.orgUnitId ?? null) : null,
          // Cùng khuôn "khoá chỉ có nghĩa với ĐÚNG audience của nó" như `orgUnitId` ngay trên.
          groupId: dto.audience === "group" ? (dto.groupId ?? null) : null,
        });
      }

      const row = await this.repo.findVisible(tx, actor, postId);
      return { row, dropped: mentions.dropped };
    });

    // `findVisible` ngay sau INSERT trong CÙNG tx không thể trượt (vị từ visibility luôn cho tác giả
    // thấy bài của mình). Vẫn kiểm: `null` ở đây nghĩa là vị từ đã đổi theo cách người viết không
    // lường — ném rõ ràng còn hơn `!` rồi nổ ở chỗ khác.
    if (!result.row) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);

    const [dto2] = await this.decorate(actor, [result.row]);
    this.emitPostCreated(actor, result.row, dto2);
    return { ...dto2, droppedMentions: toDropped(result.dropped) };
  }

  /** `SOCIAL-API-004` — `PATCH /social/posts/{id}`. Chủ bài HOẶC `manage:feed-post`. */
  async update(
    user: SocialRequestUser,
    postId: string,
    dto: UpdateFeedPostDto,
  ): Promise<FeedPostCreatedDto> {
    const actor = await this.access.resolveActor(user, "postUpdate");

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.access.assertPostVisible(tx, actor, postId);
      const asManager = this.access.assertCanMutateContent(actor, post.authorUserId);

      const now = new Date();
      await tx
        .update(feedPosts)
        .set({ body: dto.body, editedAt: now, updatedAt: now, updatedBy: actor.actorUserId })
        .where(and(eq(feedPosts.id, postId), eq(feedPosts.companyId, actor.companyId)));

      // Quan ly SUA noi dung cua NGUOI KHAC => vao so, cung luat voi duong XOA (`remove`).
      // Khong co dong nay thi dau vet bien mat hoan toan: `body` bi ghi de, `updated_by`/`edited_at`
      // cung bi ghi de, va lan tac gia tu sua tiep XOA luon hai cot do. Sua loi nguoi khac la hanh
      // dong quan trong khong kem xoa. (FULL gate PR #530 HIGH-2 — owner ky 22/09/2026; plan §4
      // truoc do ghi audit `—` cho 004/016.)
      if (asManager) {
        await this.audit.record(tx, {
          action: "social.post.update",
          objectType: "feed_post",
          objectId: postId,
          actorUserId: actor.actorUserId,
          moduleCode: "SOCIAL",
          entityType: "feed_post",
          entityId: postId,
          resultStatus: "Success",
          // KHONG cho noi dung bai — API-19 §8 chot payload audit chi mang id + truong doi.
          metadata: { postId, authorUserId: post.authorUserId },
        });
      }

      await syncPostTags(tx, actor.companyId, postId, parseHashtags(dto.body));

      const mentions = await resolveMentions(
        tx,
        actor,
        { audience: post.audience, orgUnitId: post.orgUnitId, groupId: post.groupId },
        dto.mentionedUserIds ?? [],
      );
      // CHỈ mention MỚI mới sinh thông báo — mỗi lần bấm Lưu không được bắn lại cho người cũ.
      const fresh = await syncMentions(tx, actor.companyId, "post", postId, mentions.accepted);

      if (dto.attachmentIds) {
        await this.attachments.syncLinksTx(
          tx,
          actor.companyId,
          actor.actorUserId,
          "post",
          postId,
          dto.attachmentIds,
        );
      }

      await this.enqueueMentionNotis(tx, actor, "post", postId, postId, fresh);

      const row = await this.repo.findVisible(tx, actor, postId);
      return { row, dropped: mentions.dropped };
    });

    if (!result.row) throw new NotFoundException(SOCIAL_ERR.POST_NOT_FOUND);
    const [dto2] = await this.decorate(actor, [result.row]);
    return { ...dto2, droppedMentions: toDropped(result.dropped) };
  }

  /**
   * `SOCIAL-API-005` — `DELETE /social/posts/{id}`. Xoá MỀM.
   *
   * Audit CHỈ khi xoá bài của NGƯỜI KHÁC (`assertCanMutateContent` trả `true`). Xoá bài của chính
   * mình là hành động thường ngày; ghi mọi lượt vào `audit_logs` — một bảng append-only DÙNG CHUNG
   * đang phục vụ điều tra AUTH/HR — là nhấn chìm nó bằng lưu lượng UI (cùng lập luận đã ghi ở
   * `chat-reactions.service.ts`).
   */
  async remove(user: SocialRequestUser, postId: string): Promise<{ deleted: true }> {
    const actor = await this.access.resolveActor(user, "postDelete");

    await this.db.withTenant(actor.companyId, async (tx) => {
      const post = await this.access.assertPostVisible(tx, actor, postId);
      const asManager = this.access.assertCanMutateContent(actor, post.authorUserId);

      await softDeletePostTx(tx, actor.companyId, postId, actor.actorUserId);

      if (asManager) {
        await this.audit.record(tx, {
          action: "social.post.delete",
          objectType: "feed_post",
          objectId: postId,
          actorUserId: actor.actorUserId,
          moduleCode: "SOCIAL",
          entityType: "feed_post",
          entityId: postId,
          resultStatus: "Success",
          // KHÔNG nội dung bài — API-19 §8 chốt payload audit chỉ mang id + trường đổi.
          metadata: { postId, authorUserId: post.authorUserId },
        });
      }
    });
    return { deleted: true };
  }

  /** `SOCIAL-API-007` — ghi lượt xem LẦN ĐẦU (`ON CONFLICT DO NOTHING`, reload không tăng). */
  async recordView(user: SocialRequestUser, postId: string): Promise<FeedPostFlagResultDto> {
    const actor = await this.access.resolveActor(user, "postView");
    const viewCount = await this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertPostVisible(tx, actor, postId);
      const isFirst = await this.repo.recordFirstView(
        tx,
        actor.companyId,
        postId,
        actor.actorUserId,
      );
      if (!isFirst) return null;
      // `bumpActivity: false` — lượt xem KHÔNG được đẩy bài lên «Hoạt động mới» (schema/social.ts:54).
      return bumpPostCounter(tx, actor.companyId, postId, "viewCount", 1, false);
    });
    return { postId, ...(viewCount !== null ? { viewCount } : {}) };
  }

  /** `SOCIAL-API-008` — lưu bài. */
  async save(user: SocialRequestUser, postId: string): Promise<FeedPostFlagResultDto> {
    const actor = await this.access.resolveActor(user, "postSave");
    await this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertPostVisible(tx, actor, postId);
      await this.repo.savePost(tx, actor.companyId, postId, actor.actorUserId);
    });
    return { postId, savedByMe: true };
  }

  /** `SOCIAL-API-009` — bỏ lưu. */
  async unsave(user: SocialRequestUser, postId: string): Promise<FeedPostFlagResultDto> {
    const actor = await this.access.resolveActor(user, "postUnsave");
    await this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertPostVisible(tx, actor, postId);
      await this.repo.unsavePost(tx, actor.companyId, postId, actor.actorUserId);
    });
    return { postId, savedByMe: false };
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /** `employee_profiles.id` của actor — `null` hợp lệ (tài khoản chưa gắn hồ sơ nhân sự). */
  private async employeeIdOf(tx: TenantTx, actor: SocialActor): Promise<string | null> {
    const rows = await tx
      .select({ id: employeeProfiles.id })
      .from(employeeProfiles)
      .where(
        and(
          eq(employeeProfiles.companyId, actor.companyId),
          eq(employeeProfiles.userId, actor.actorUserId),
          // 🔴 `deleted_at IS NULL` — FULL gate `security-reviewer` (S16-SOCIAL-BE-2B-2, 24/09/2026).
          //
          // Unique index `employee_profiles_company_user_active_uq` chỉ phủ hàng CÒN SỐNG
          // (`WHERE deleted_at IS NULL`), nên một user có 1 hồ sơ đã xoá mềm + 1 hồ sơ sống làm
          // `LIMIT 1` **không xác định** — nó có thể trả hồ sơ ĐÃ XOÁ. Trước BE-2B-2 điều đó chỉ ảnh
          // hưởng `feed_posts.author_employee_id` (một cột hiển thị); từ BE-2B-2 giá trị này là vế
          // TRÁI của luật K1 (`KUDOS_SELF_RECIPIENT`, lưới DUY NHẤT — không CHECK nào ở DB chặn tự
          // vinh danh) ⇒ trả hồ sơ cũ là **lách được K1**: tác giả gửi chính `employee_id` đang sống
          // của mình và đi qua.
          isNull(employeeProfiles.deletedAt),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /** Cắt hàng thừa của `limit + 1` rồi dựng con trỏ từ hàng CUỐI của trang ĐÃ cắt. */
  private async toPage(
    actor: SocialActor,
    rows: PostRow[],
    limit: number,
    fingerprint: string,
  ): Promise<FeedPostPageDto> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data = await this.decorate(actor, page);
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeFeedCursor({ sortAt: new Date(last.sortAt), id: last.id }, fingerprint)
        : null;
    return { data, nextCursor };
  }

  /**
   * ⟲ **S16-SOCIAL-BE-1B** — `NOTI-031` «tin tức công ty mới». Producer tính người nhận TRONG tx (C8).
   *
   * ┌─ 🔴 TRẦN 500 NGƯỜI NHẬN — VÀ VÌ SAO KHÔNG ĐƯỢC CẮT CÂM ────────────────────────────────────────┐
   * │ v1 không chia lô: công ty >500 người vẫn đọc tin qua `GET /social/news`; NOTI là kênh đẩy PHỤ.  │
   * │ Nhưng cắt IM LẶNG là đúng hình dạng «thành công RỖNG = fail-OPEN», và hệ quả nghiệp vụ THẬT là: │
   * │ với tin `requires_ack`, người thứ 501 trở đi **không hề được báo** trong khi route `022` vẫn    │
   * │ liệt họ vào danh sách «chưa đọc» — hai đường nói ngược nhau về cùng một người.                  │
   * │ Ba ràng buộc, cả ba đo được ở ca `N-C8-trần`:                                                   │
   * │   1. XÁC ĐỊNH — repository trả tập ĐÃ sắp theo `user_id` tăng dần, cắt SAU khi sắp.             │
   * │   2. QUAN SÁT ĐƯỢC — log WARN (post_id + tổng + trần) **VÀ** `recipientsTruncated`/              │
   * │      `totalRecipients` trong payload outbox (hàng dữ liệu tự mang bằng chứng, log thì trôi).    │
   * │   3. KHÔNG NUỐT tập rỗng — log WARN rồi KHÔNG enqueue (registrar sẽ NÉM nếu nhận payload rỗng). │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  private async enqueueNewsPublishedNoti(
    tx: TenantTx,
    actor: SocialActor,
    postId: string,
    // S16-SOCIAL-BE-2A D14(2): +`groupId` — tin đăng vào nhóm tính người nhận theo membership, và
    // thiếu trường này thì `audienceUserIds` fail-closed về tập rỗng (tin không báo cho ai).
    post: { audience: string; orgUnitId: string | null; groupId: string | null },
  ): Promise<void> {
    // Cắt + đếm + loại tác giả đều ở SQL (xem `audienceUserIds`): `recipients` đã là ≤ trần, `total`
    // là tổng THẬT trước khi cắt — hai con số khác nhau và payload cần CẢ HAI.
    const { userIds: recipients, total } = await this.news.audienceUserIds(
      tx,
      actor.companyId,
      post,
      { excludeUserId: actor.actorUserId, limit: SOCIAL_NEWS_NOTI_RECIPIENT_CAP },
    );

    if (total === 0) {
      this.logger.warn(
        `NOTI-031: tin ${postId} (audience=${post.audience}) không có người nhận nào — không phát thông báo.`,
      );
      return;
    }

    const truncated = total > SOCIAL_NEWS_NOTI_RECIPIENT_CAP;
    if (truncated) {
      this.logger.warn(
        `NOTI-031: tin ${postId} có ${total} người nhận, vượt trần ${SOCIAL_NEWS_NOTI_RECIPIENT_CAP} — đã cắt ${total - recipients.length} người (thứ tự user_id tăng dần).`,
      );
    }

    const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);
    const payload: SocialNewsPublishedPayload = {
      actorUserId: actor.actorUserId,
      postId,
      post_id: postId,
      actor_name: actorName,
      recipientUserIds: recipients,
      recipientsTruncated: truncated,
      totalRecipients: total,
    };
    await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_NEWS_PUBLISHED, payload });
  }

  /**
   * S16-SOCIAL-BE-2B-2 — NOTI-033 «bạn được vinh danh». Người nhận = tập được vinh danh, map
   * `employee_id` → `user_id` rồi lọc **D18** (4 vế).
   *
   * ⚠️ Trừ `actorUserId` MỘT LẦN NỮA dù `KUDOS_SELF_RECIPIENT` đã chặn tự-vinh-danh ở đường ghi: lưới
   * kia là luật NGHIỆP VỤ (owner có thể nới), lưới này là tính chất của THÔNG BÁO (không ai tự báo cho
   * mình). Hai lý do khác nhau ⇒ hai lưới, không phải một lưới lặp.
   *
   * ⚠️ Tập rỗng ⇒ **KHÔNG enqueue**. Ba đường dẫn tới rỗng và cả ba đều BÌNH THƯỜNG, không phải lỗi:
   * mọi người nhận đã nghỉ việc (ca `K-4`) · tài khoản bị khoá (`K-4b`) · nhân sự chưa có tài khoản
   * `users` (`K-4c`). Enqueue một hàng với `recipientUserIds: []` sẽ thành dead-letter câm ở registrar
   * (`requireUserIds` ném) — một lỗi hạ tầng cho một tình huống nghiệp vụ hợp lệ.
   */
  private async enqueueKudosReceivedNoti(
    tx: TenantTx,
    actor: SocialActor,
    postId: string,
    recipientEmployeeIds: readonly string[],
  ): Promise<void> {
    const mapped = await userIdsOfEmployeesTx(tx, actor.companyId, recipientEmployeeIds);
    const recipients = mapped.filter((id) => id !== actor.actorUserId);
    if (recipients.length === 0) {
      this.logger.warn(
        `NOTI-033: vinh danh ở bài ${postId} không có người nhận nào CÒN HOẠT ĐỘNG (${recipientEmployeeIds.length} nhân sự được ghi) — không phát thông báo.`,
      );
      return;
    }

    const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);
    const payload: SocialKudosReceivedPayload = {
      post_id: postId,
      actor_name: actorName,
      recipientUserIds: recipients,
    };
    await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_KUDOS_RECEIVED, payload });
  }

  /**
   * ⟲ **MỐI NỐI TÁI DÙNG CỦA `S16-SOCIAL-BE-1B`** — `020` (tin tức) · `023` (tìm kiếm) · `025` (trang
   * cá nhân) trả CÙNG thẻ bài với dòng cuộn, nên chúng dùng LẠI `toPage`/`decorate` thay vì dựng bản
   * thứ hai (bản thứ hai sẽ trôi khỏi bản này ngay lần đầu DTO bài đổi).
   *
   * ⚠️ Hai wrapper này **KHÔNG nới phạm vi đọc** và đó là điều kiện để chúng tồn tại: `rows` phải đến
   * từ một câu ĐÃ mang `visiblePostCondition` (tức `listFeed`/`findVisible`). Chúng chỉ thêm
   * tag/cảm xúc/đính kèm cho những hàng caller VỐN ĐÃ đọc được, và đính kèm vẫn đi qua
   * `FilePolicyService` theo TỪNG người xem. Đừng biến chúng thành đường lấy bài — đó là lớp lỗi
   * `reused-method-must-be-actor-scoped`.
   */
  decorateForViewer(viewer: SocialViewerContext, rows: PostRow[]): Promise<FeedPostDto[]> {
    return this.decorate(viewer, rows);
  }

  /** Xem docblock `decorateForViewer` — cùng điều kiện: `rows` đến từ câu ĐÃ lọc visibility. */
  toPageForViewer(
    actor: SocialActor,
    rows: PostRow[],
    limit: number,
    fingerprint: string,
  ): Promise<FeedPostPageDto> {
    return this.toPage(actor, rows, limit, fingerprint);
  }

  /** Row → DTO cho một LÔ: tag + projection theo actor (1 tx đọc) rồi đính kèm ĐÃ KÝ (ngoài tx). */
  private async decorate(viewer: SocialViewerContext, rows: PostRow[]): Promise<FeedPostDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);

    const { tags, myReactions, saved } = await this.db.withTenant(viewer.companyId, async (tx) => ({
      tags: await this.repo.tagsFor(tx, viewer.companyId, ids),
      myReactions: await this.projections.myReactions(
        tx,
        viewer.companyId,
        viewer.actorUserId,
        "post",
        ids,
      ),
      saved: await this.projections.savedPostIds(tx, viewer.companyId, viewer.actorUserId, ids),
    }));
    // NGOÀI tx — ký URL tự mở kết nối riêng (xem docblock `SocialAttachmentsService`).
    const attachments = await this.attachments.decorateMany(viewer, "post", ids);

    return rows.map((row) =>
      toFeedPostDto(row, viewer, {
        tags: tags.get(row.id) ?? [],
        attachments: attachments.get(row.id) ?? [],
        myReaction: myReactions.get(row.id) ?? null,
        savedByMe: saved.has(row.id),
      }),
    );
  }

  /** Một outbox event cho MỖI người được nhắc — xem `social-noti.payload.ts`. */
  private async enqueueMentionNotis(
    tx: TenantTx,
    actor: SocialActor,
    targetType: "post" | "comment",
    targetId: string,
    postId: string,
    fresh: readonly ResolvedMention[],
  ): Promise<void> {
    if (fresh.length === 0) return;
    const actorName = await resolveActorName(tx, actor.companyId, actor.actorUserId);
    for (const m of fresh) {
      const payload: SocialMentionedPayload = {
        actorUserId: actor.actorUserId,
        postId,
        targetType,
        targetId,
        mentionedUserId: m.userId,
        actor_name: actorName,
        post_id: postId,
        target_type_label: targetTypeLabel(targetType),
      };
      await this.outbox.enqueue(tx, { eventType: SOCIAL_EVENT_MENTIONED, payload });
    }
  }

  /**
   * Phát `feed:post.created`.
   *
   * ⚠️ **CHỈ bài `audience='company'` + `status='published'`** (plan §2 D21). Room `co:{c}:feed` chứa
   * CẢ công ty và API-19 §7 không khai room nào cho `org_unit` ⇒ phát một bài org_unit vào đó là rò
   * đúng nội dung mà REST trả 404 cho chính những người đó.
   *
   * Bốn khoá projection-theo-actor (`myReaction`/`savedByMe`/`isMine`/`status`) bị BỎ tại nguồn dù
   * schema WS cũng strip chúng: bỏ ở đây để không ai đọc code này mà tưởng cả công ty đang nhận cờ
   * của người vừa đăng (khuôn `ChatReactionsService.broadcast`).
   */
  private emitPostCreated(actor: SocialActor, row: PostRow, dto: FeedPostDto): void {
    if (row.audience !== "company" || row.status !== "published") return;
    const { myReaction: _mr, savedByMe: _sb, isMine: _im, status: _st, attachments, ...rest } = dto;
    this.realtime.emitFeedPostCreated(actor.companyId, {
      ...rest,
      audience: "company",
      attachments: attachments.map(({ url: _u, ...a }) => a),
    });
  }
}

/**
 * Tên hiển thị của actor cho biến template `{actor_name}`.
 *
 * Tên người sống ở `users.full_name` — ĐO THẬT: `employee_profiles` KHÔNG có cột tên nào (chỉ
 * `emergency_contact_name`). Đừng đi tìm nó ở bảng nhân sự.
 *
 * Fallback `"Một đồng nghiệp"` thay vì chuỗi rỗng: registrar `requireField` NÉM khi biến template
 * rỗng (đúng — rỗng thì template render ra `{actor_name}` nguyên văn), nên một tài khoản chưa đặt
 * tên sẽ làm MỌI thông báo của họ dead-letter. Tên hiển thị không phải dữ liệu bắt buộc của hệ thống.
 */
export async function resolveActorName(
  tx: TenantTx,
  companyId: string,
  userId: string,
): Promise<string> {
  const rows = await tx
    .select({ fullName: users.fullName })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);
  return rows[0]?.fullName?.trim() || "Một đồng nghiệp";
}

/**
 * Dấu vân bộ lọc của `GET /social/feed` — MỌI thứ ảnh hưởng tới tập kết quả HOẶC cột sắp xếp.
 *
 * ⚠️ `actor.canManagePosts` và `orgUnitIds` NẰM TRONG dấu vân, và đó không phải thừa: hai giá trị đó
 * quyết định tập bài nhìn thấy được. Một người vừa bị thu hồi `manage:feed-post` giữa hai lần lật
 * trang phải nhận 400 (tải lại từ đầu), chứ không được lật tiếp một trang cắt theo tập CŨ rộng hơn.
 */
function feedFingerprint(actor: SocialActor, q: ListFeedQueryDto): string {
  return fingerprintFeedFilter([
    "feed",
    q.sort,
    q.type,
    q.audience,
    q.status,
    q.authorUserId,
    q.orgUnitId,
    q.tag?.toLowerCase(),
    // 🔴 D-OWNER-7 (W2): thiếu dòng này thì con trỏ của feed thường dùng LẠI được cho feed nhóm ⇒
    // trang sau cắt theo tập CŨ, sai IM LẶNG. Quên nó compile sạch — chỉ ca G15 bắt được.
    q.groupId,
    actor.canManagePosts ? "mp1" : "mp0",
    [...actor.orgUnitIds].sort().join(","),
  ]);
}

/** Dội lại ĐÚNG id caller đã gửi — xem docblock `ResolvedMention` (không kèm tên, không kèm lý do). */
function toDropped(dropped: readonly ResolvedMention[]): string[] {
  return dropped.map((m) => m.userId);
}

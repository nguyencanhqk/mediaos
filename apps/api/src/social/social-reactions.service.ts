import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  feedReactionEmojiSchema,
  type FeedReactionResultDto,
  type FeedReactorDto,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { SocialAccessService } from "./social-access.service";
import { bumpCommentLikeCount, bumpPostCounter } from "./social-counters";
import { SocialReactionsRepository } from "./social-reactions.repository";
import { SOCIAL_ERR } from "./social.errors";
import { toReactionSummaries } from "./social.mapper";
import type { SocialActor, SocialRequestUser, SocialTargetType } from "./social.types";

/**
 * S16-SOCIAL-BE-1 — `SOCIAL-API-011..013` (bài) và `018..019` (bình luận). Khuôn
 * `ChatReactionsService`.
 *
 * ┌─ BỐN LUẬT, ĐỌC TRƯỚC KHI SỬA ──────────────────────────────────────────────────────────────────┐
 * │ 1. **`assertTargetVisible` TRƯỚC MỌI INSERT.** `feed_reactions.target_id` là khoá ĐA HÌNH       │
 * │    KHÔNG FK — DB không đỡ gì cả. Xem khối ⚠️ IDOR ở `social-access.service.ts`.                 │
 * │ 2. **Emoji kiểm LẠI ở service** dù DTO đã gác: cột `feed_reactions.emoji` KHÔNG có CHECK ở DB   │
 * │    (DB-17 §6.3, ngoại lệ DUY NHẤT của luật mirror) ⇒ Zod + hàm này là lưới duy nhất, và DTO chỉ │
 * │    gác biên HTTP (đường gọi service từ job/bridge sau này không đi qua đó).                     │
 * │ 3. **Đếm bằng SQL, cộng-trong-câu.** Không `SELECT` rồi `+1` ở JS — hai lượt thích đồng thời     │
 * │    cùng đọc 5, cùng ghi 6 (memory `clamp-must-be-sql-not-js`).                                   │
 * │ 4. **Phát WS SAU commit, và CHỈ khi thật sự đổi.** Thả lại đúng emoji đang thả là no-op; phát    │
 * │    lần nữa chỉ bắt cả công ty render lại đúng con số cũ.                                        │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **0 audit.** Thả cảm xúc là nút bật/tắt đảo ngược được; ghi mỗi lượt vào `audit_logs` (bảng
 * append-only DÙNG CHUNG, đang phục vụ điều tra AUTH/HR/LEAVE) sẽ nhấn chìm bảng đó bằng lưu lượng
 * UI — nguyên văn lập luận đã ghi ở `chat-reactions.service.ts`.
 */
@Injectable()
export class SocialReactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: SocialAccessService,
    private readonly repo: SocialReactionsRepository,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  /**
   * `SOCIAL-API-011` — đặt/đổi cảm xúc trên BÀI. Idempotent theo bản chất (đặt trạng thái).
   *
   * ⚠️ Bốn method công khai dưới đây khác nhau ĐÚNG một dòng `resolveActor` rồi uỷ quyền cho cùng
   * một thân. Bản đầu gộp làm hai method và chọn key bằng ternary — NGẮN HƠN nhưng làm census 2 tầng
   * MÙ với bốn route này (`social-two-layer-guard-census` quét literal, ternary không phải literal),
   * tức là đúng bốn route mất lớp kiểm "handler này assert đúng key của nó". Key phải là literal TẠI
   * điểm gọi.
   */
  async putOnPost(
    user: SocialRequestUser,
    postId: string,
    emojiRaw: string,
  ): Promise<FeedReactionResultDto> {
    const actor = await this.access.resolveActor(user, "postReactionPut");
    return this.putWith(actor, "post", postId, emojiRaw);
  }

  /** `SOCIAL-API-018` — đặt/đổi cảm xúc trên BÌNH LUẬN. */
  async putOnComment(
    user: SocialRequestUser,
    commentId: string,
    emojiRaw: string,
  ): Promise<FeedReactionResultDto> {
    const actor = await this.access.resolveActor(user, "commentReactionPut");
    return this.putWith(actor, "comment", commentId, emojiRaw);
  }

  private async putWith(
    actor: SocialActor,
    targetType: SocialTargetType,
    targetId: string,
    emojiRaw: string,
  ): Promise<FeedReactionResultDto> {
    const emoji = parseEmoji(emojiRaw);

    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      // Cổng IDOR — TRƯỚC insert, luôn luôn.
      const target = await this.access.assertTargetVisible(tx, actor, targetType, targetId);
      const outcome = await this.repo.put(
        tx,
        actor.companyId,
        targetType,
        targetId,
        actor.actorUserId,
        emoji,
      );
      // CHỈ hàng MỚI mới +1: đổi 👍 → ❤️ là cùng một lượt thích, không phải lượt thứ hai.
      if (outcome === "inserted") {
        await this.bumpLike(tx, actor, targetType, targetId, target.postId, 1);
      }
      return {
        ...(await this.snapshot(tx, actor, targetType, targetId, target.postId)),
        outcome,
        postAudience: target.postAudience,
        postStatus: target.postStatus,
      };
    });

    if (result.outcome !== "unchanged") this.emit(actor, result);
    return toDto(result);
  }

  /**
   * `SOCIAL-API-012`/`019` — gỡ cảm xúc. Chưa từng thả ⇒ vẫn 200, KHÔNG 404.
   *
   * CỐ Ý vẫn áp cổng `assertTargetVisible` (đường GỠ không được nới ranh giới dữ liệu) nhưng KHÔNG
   * thêm điều kiện nghiệp vụ nào khác: đường ghi phải chặt, đường gỡ thì không — một cảm xúc lỡ tay
   * thả ngay trước khi bài bị ẩn không được dính vĩnh viễn.
   */
  async removeOnPost(user: SocialRequestUser, postId: string): Promise<FeedReactionResultDto> {
    const actor = await this.access.resolveActor(user, "postReactionDelete");
    return this.removeWith(actor, "post", postId);
  }

  /** `SOCIAL-API-019` — gỡ cảm xúc trên BÌNH LUẬN. */
  async removeOnComment(
    user: SocialRequestUser,
    commentId: string,
  ): Promise<FeedReactionResultDto> {
    const actor = await this.access.resolveActor(user, "commentReactionDelete");
    return this.removeWith(actor, "comment", commentId);
  }

  private async removeWith(
    actor: SocialActor,
    targetType: SocialTargetType,
    targetId: string,
  ): Promise<FeedReactionResultDto> {
    const result = await this.db.withTenant(actor.companyId, async (tx) => {
      const target = await this.access.assertTargetVisible(tx, actor, targetType, targetId);
      const changed = await this.repo.remove(
        tx,
        actor.companyId,
        targetType,
        targetId,
        actor.actorUserId,
      );
      if (changed) {
        await this.bumpLike(tx, actor, targetType, targetId, target.postId, -1);
      }
      return {
        ...(await this.snapshot(tx, actor, targetType, targetId, target.postId)),
        outcome: changed ? ("updated" as const) : ("unchanged" as const),
        postAudience: target.postAudience,
        postStatus: target.postStatus,
      };
    });

    if (result.outcome !== "unchanged") this.emit(actor, result);
    return toDto(result);
  }

  /** `SOCIAL-API-013` — danh sách người đã thả (danh tính NHÂN SỰ, không `userId`). */
  async listReactors(user: SocialRequestUser, postId: string): Promise<FeedReactorDto[]> {
    const actor = await this.access.resolveActor(user, "postReactionList");
    const rows = await this.db.withTenant(actor.companyId, async (tx) => {
      await this.access.assertPostVisible(tx, actor, postId);
      return this.repo.listReactors(tx, actor.companyId, "post", postId);
    });
    return rows.map((r) => ({
      employeeId: r.employeeId,
      fullName: r.fullName,
      avatarUrl: r.avatarUrl,
      emoji: r.emoji,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ─── nội bộ ──────────────────────────────────────────────────────────────────

  /**
   * Cộng `like_count` ở ĐÚNG bảng của đích.
   *
   * Cảm xúc trên BÌNH LUẬN vẫn bump `last_activity_at` của BÀI CHA (một lượt tương tác trong luồng
   * bài là hoạt động của bài) — nhưng KHÔNG chạm `feed_posts.like_count`, vì con số đó đếm cảm xúc
   * trên CHÍNH bài.
   */
  private async bumpLike(
    tx: TenantTx,
    actor: SocialActor,
    targetType: SocialTargetType,
    targetId: string,
    postId: string,
    delta: number,
  ): Promise<void> {
    if (targetType === "post") {
      await bumpPostCounter(tx, actor.companyId, postId, "likeCount", delta);
      return;
    }
    await bumpCommentLikeCount(tx, actor.companyId, targetId, delta);
    await bumpPostCounter(tx, actor.companyId, postId, "likeCount", 0);
  }

  /** Ảnh chụp MỚI NHẤT của đích, đọc TRONG tx ngay sau khi ghi. */
  private async snapshot(
    tx: TenantTx,
    actor: SocialActor,
    targetType: SocialTargetType,
    targetId: string,
    postId: string,
  ) {
    const rows = await this.repo.aggregate(tx, actor.companyId, targetType, targetId);
    // Hỏi emoji của CHÍNH actor chỉ khi đích thật sự có cảm xúc nào — 0 hàng thì câu trả lời chắc
    // chắn là null, và đây là đường chạy mỗi lượt bấm tim.
    const mine =
      rows.length > 0
        ? await this.repo.myEmoji(tx, actor.companyId, targetType, targetId, actor.actorUserId)
        : null;
    return {
      targetType,
      targetId,
      postId,
      likeCount: rows.reduce((sum, r) => sum + r.count, 0),
      rows,
      myEmoji: mine,
    };
  }

  /**
   * Phát `feed:reaction.changed` — payload KHÔNG có `mine`, KHÔNG có `actorUserId`.
   *
   * ⚠️ **LƯdI D21 — CHỈ bài `audience='company'` + `status='published'`.** `co:{c}:feed` là room CẢ
   * CÔNG TY (`rooms.ts` `feedRoomName`) và API-19 §7 không khai room nào cho `org_unit`. Phát lượt cảm
   * xúc của bài `org_unit`/`hidden` vào đó là rò SỰ TỎN TẠI của `postId`/`commentId` riêng tư + đường
   * cong tương tác theo thời gian thực, đúng thứ mà REST trả 404 cho chính những người đó. Hai
   * emitter kia (`emitPostCreated`/`emitCommentCreated`) đã có lưới này từ đầu; ở đây nó bị thiếu
   * (FULL gate PR #530). Bài của bình luận lấy audience/status của bài CHA — xem `SocialTargetAccess`.
   */
  private emit(
    actor: SocialActor,
    snap: {
      targetType: SocialTargetType;
      targetId: string;
      postId: string;
      likeCount: number;
      rows: { emoji: string; count: number }[];
      postAudience: string;
      postStatus: string;
    },
  ): void {
    if (snap.postAudience !== "company" || snap.postStatus !== "published") return;
    this.realtime.emitFeedReactionChanged(actor.companyId, {
      targetType: snap.targetType,
      targetId: snap.targetId,
      postId: snap.postId,
      likeCount: snap.likeCount,
      reactions: snap.rows,
    });
  }
}

/**
 * Lưới emoji của tầng service — xem luật 2 ở jsdoc lớp.
 *
 * `feedReactionEmojiSchema` TÁI DÙNG bộ của CHAT (contracts `social.ts:74`): CHAT đổi bộ thì SOCIAL
 * đi theo, không cần migration đuổi theo một hằng TypeScript.
 */
function parseEmoji(raw: string): string {
  const parsed = feedReactionEmojiSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UnprocessableEntityException(SOCIAL_ERR.REACTION_EMOJI_INVALID);
  }
  return parsed.data;
}

function toDto(snap: {
  targetType: SocialTargetType;
  targetId: string;
  likeCount: number;
  rows: { emoji: string; count: number }[];
  myEmoji: string | null;
}): FeedReactionResultDto {
  return {
    targetType: snap.targetType,
    targetId: snap.targetId,
    likeCount: snap.likeCount,
    reactions: toReactionSummaries(snap.rows, snap.myEmoji),
  };
}

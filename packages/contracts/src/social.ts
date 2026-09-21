import { z } from "zod";
import { chatReactionEmojiSchema } from "./chat";

/**
 * S16-SOCIAL-DB-1 — enum/hằng chuẩn module SOCIAL Track A (SPEC-16 · DB-17 §8). NGUỒN SỰ THẬT cho DTO
 * của S16-SOCIAL-BE-1 (API-19).
 *
 * 6 enum MIRROR ĐÚNG BẰNG CHECK của migration `0577` — HAI CHIỀU: không chặt hơn (giá trị DB hợp lệ mà
 * Zod từ chối ⇒ 400 oan), không lỏng hơn (Zod cho qua mà DB từ chối ⇒ 500 check-violation vô danh —
 * `contract-must-mirror-db-check-both-directions`). Pin hai chiều ở `social.spec.ts` (mảng literal chép
 * TỪ MIGRATION, cố ý KHÔNG import từ schema drizzle — assert hằng bằng chính nó là tautology).
 *
 * ⚠️ NGOẠI LỆ DUY NHẤT của luật mirror: `feed_reactions.emoji` **KHÔNG có CHECK ở DB** (DB-17 §6.3).
 *   Nguồn sự thật của bộ emoji là bộ dùng chung với CHAT — vì vậy `feedReactionEmojiSchema` TÁI DÙNG
 *   `chatReactionEmojiSchema`, KHÔNG chép lại danh sách. Sao chép = đẻ nguồn sự thật thứ ba (bộ này
 *   vốn đã sống ở 3 chỗ: CHECK `chat_message_reactions_emoji_chk` · hằng drizzle `CHAT_REACTION_EMOJIS`
 *   · enum contracts). `social.spec.ts` KHÔNG được kỳ vọng tìm thấy CHECK cho cột này.
 *
 * Chỉ ENUM/HẰNG + schema tối thiểu ở WO DB (chưa có consumer DTO); request/response đầy đủ viết ở WO
 * BE-1 cùng API-19. Tên export prefix `feed*`/`FEED_*` — KHÔNG dùng tên trần `Post`/`Comment`/`Report`
 * (đụng `./media` đã export trong barrel ⇒ TS2308 — `contracts-barrel-collides-with-parked-media`).
 */

// ═══════════════ 6 enum mirror CHECK migration 0577 ═══════════════

/** `chk_feed_posts_type` — SPEC-16 §3.1. */
export const feedPostTypeSchema = z.enum(["share", "news", "idea", "poll", "kudos"]);
export type FeedPostTypeDto = z.infer<typeof feedPostTypeSchema>;

/** `chk_feed_posts_audience` — `group`/`org_unit` kéo theo khoá tương ứng (xem `feedPostCoreSchema`). */
export const feedAudienceSchema = z.enum(["company", "group", "org_unit"]);
export type FeedAudienceDto = z.infer<typeof feedAudienceSchema>;

/** `chk_feed_posts_status` — SPEC-01 §17.18. */
export const feedPostStatusSchema = z.enum(["published", "hidden", "deleted"]);
export type FeedPostStatusDto = z.infer<typeof feedPostStatusSchema>;

/**
 * `chk_feed_reactions_target` — DÙNG CHUNG cho `feed_reactions` · `feed_mentions` · `feed_reports`
 * (ba CHECK RIÊNG BIỆT ở DB nhưng cùng một tập giá trị; DB-17 §8 gọi là `feedReactionTarget`).
 */
export const feedTargetTypeSchema = z.enum(["post", "comment"]);
export type FeedTargetTypeDto = z.infer<typeof feedTargetTypeSchema>;

/** `chk_feed_reports_reason`. */
export const feedReportReasonSchema = z.enum([
  "spam",
  "harassment",
  "inappropriate",
  "misinformation",
  "other",
]);
export type FeedReportReasonDto = z.infer<typeof feedReportReasonSchema>;

/** `chk_feed_reports_status` — `resolved`/`dismissed` kéo theo người xử lý + mốc (xem `feedReportCoreSchema`). */
export const feedReportStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export type FeedReportStatusDto = z.infer<typeof feedReportStatusSchema>;

// ═══════════════ Hằng độ dài — mirror `chk_feed_posts_body_len` / `chk_feed_comments_body_len` ═══════

/** `chk_feed_posts_body_len` (migration 0577). */
export const FEED_POST_BODY_MAX = 20000;
/** `chk_feed_comments_body_len` (migration 0577). */
export const FEED_COMMENT_BODY_MAX = 5000;

// ═══════════════ Emoji — NGOẠI LỆ: lưới DUY NHẤT nằm ở đây, DB không ràng buộc ═══════════════

/**
 * ⚠️ `feed_reactions.emoji` KHÔNG có CHECK ở DB (quyết định DB-17 §6.3) ⇒ **Zod là lớp phòng thủ DUY
 * NHẤT** cho cột này. Tái dùng bộ CHAT thay vì chép: CHAT đổi bộ emoji thì SOCIAL đi theo, không cần
 * migration đuổi theo một hằng TypeScript. Đánh đổi đã cân nhắc: INSERT đi vòng qua service có thể ghi
 * emoji lạ — chấp nhận được vì không phải dữ liệu nhạy cảm và không có đường ghi nào ngoài service.
 */
export const feedReactionEmojiSchema = chatReactionEmojiSchema;
export type FeedReactionEmojiDto = z.infer<typeof feedReactionEmojiSchema>;

// ═══════════════ Schema tối thiểu — mirror CHECK KÉO THEO (DTO đầy đủ là việc BE-1) ═══════════════

/**
 * Mirror các CHECK kéo theo của `feed_posts` mà một enum đơn không diễn đạt được:
 * `chk_feed_posts_audience_group` · `_audience_org` · `_audience_company` · `_audience_group_excl` ·
 * `_audience_org_excl` · `_pinned_news` · `_ack_news` · `_body_required` · `_body_len` · `_counts`.
 *
 * Không `.strict()`: đây là LÕI dùng lại, BE-1 sẽ `.extend()` thêm trường request/response.
 */
export const feedPostCoreSchema = z
  .object({
    type: feedPostTypeSchema,
    audience: feedAudienceSchema.default("company"),
    groupId: z.string().uuid().nullish(),
    orgUnitId: z.string().uuid().nullish(),
    body: z.string().max(FEED_POST_BODY_MAX).nullish(),
    status: feedPostStatusSchema.default("published"),
    pinned: z.boolean().default(false),
    requiresAck: z.boolean().default(false),
    commentsLocked: z.boolean().default(false),
    likeCount: z.number().int().nonnegative().default(0),
    commentCount: z.number().int().nonnegative().default(0),
    viewCount: z.number().int().nonnegative().default(0),
  })
  .superRefine((v, ctx) => {
    // `chk_feed_posts_audience_group` / `_audience_group_excl`
    if (v.audience === "group") {
      if (v.groupId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupId"],
          message: "audience='group' bắt buộc có groupId",
        });
      }
      if (v.orgUnitId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orgUnitId"],
          message: "audience='group' không được mang orgUnitId",
        });
      }
    }
    // `chk_feed_posts_audience_org` / `_audience_org_excl`
    if (v.audience === "org_unit") {
      if (v.orgUnitId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["orgUnitId"],
          message: "audience='org_unit' bắt buộc có orgUnitId",
        });
      }
      if (v.groupId != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupId"],
          message: "audience='org_unit' không được mang groupId",
        });
      }
    }
    // `chk_feed_posts_audience_company` — phạm vi công ty KHÔNG mang khoá nào
    if (v.audience === "company" && (v.groupId != null || v.orgUnitId != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audience"],
        message: "audience='company' không được mang groupId/orgUnitId",
      });
    }
    // `chk_feed_posts_pinned_news` / `chk_feed_posts_ack_news`
    if (v.pinned && v.type !== "news") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pinned"],
        message: "chỉ bài type='news' được ghim",
      });
    }
    if (v.requiresAck && v.type !== "news") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiresAck"],
        message: "chỉ bài type='news' được yêu cầu xác nhận đọc",
      });
    }
    // `chk_feed_posts_body_required` — poll/kudos mang nội dung ở bảng con Track B
    if (v.type !== "poll" && v.type !== "kudos") {
      if (v.body == null || v.body.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["body"],
          message: "bài share/news/idea bắt buộc có body",
        });
      }
    }
  });
export type FeedPostCoreDto = z.infer<typeof feedPostCoreSchema>;

/** Mirror `chk_feed_comments_body_len` + `chk_feed_comments_like_count`. */
export const feedCommentCoreSchema = z.object({
  postId: z.string().uuid(),
  parentCommentId: z.string().uuid().nullish(),
  body: z.string().min(1).max(FEED_COMMENT_BODY_MAX),
  likeCount: z.number().int().nonnegative().default(0),
});
export type FeedCommentCoreDto = z.infer<typeof feedCommentCoreSchema>;

/**
 * Mirror `chk_feed_reactions_target` + lưới emoji (xem `feedReactionEmojiSchema`).
 * `.strict()` có chủ ý: đây là điểm mà một `emoji` lạ PHẢI bị chặn, thêm trường lạ cũng vậy.
 */
export const feedReactionCoreSchema = z
  .object({
    targetType: feedTargetTypeSchema,
    targetId: z.string().uuid(),
    emoji: feedReactionEmojiSchema,
  })
  .strict();
export type FeedReactionCoreDto = z.infer<typeof feedReactionCoreSchema>;

/** Mirror `chk_feed_mentions_target`. */
export const feedMentionCoreSchema = z.object({
  targetType: feedTargetTypeSchema,
  targetId: z.string().uuid(),
  mentionedUserId: z.string().uuid(),
  mentionedEmployeeId: z.string().uuid().nullish(),
});
export type FeedMentionCoreDto = z.infer<typeof feedMentionCoreSchema>;

/** Mirror `chk_feed_tags_usage`. Thẻ đã chuẩn hoá: lowercase, bỏ `#` (varchar(64) ở DB). */
export const feedTagCoreSchema = z.object({
  tag: z.string().min(1).max(64),
  usageCount: z.number().int().nonnegative().default(0),
});
export type FeedTagCoreDto = z.infer<typeof feedTagCoreSchema>;

/** Mirror `chk_feed_reports_target` · `_reason` · `_status` · `_resolved_pair`. */
export const feedReportCoreSchema = z
  .object({
    targetType: feedTargetTypeSchema,
    targetId: z.string().uuid(),
    reason: feedReportReasonSchema,
    note: z.string().nullish(),
    status: feedReportStatusSchema.default("open"),
    resolvedBy: z.string().uuid().nullish(),
    resolvedAt: z.string().datetime({ offset: true }).nullish(),
    resolutionNote: z.string().nullish(),
  })
  .superRefine((v, ctx) => {
    // `chk_feed_reports_resolved_pair`: đã xử lý ⇒ PHẢI có CẢ người xử lý LẪN mốc thời gian
    if (v.status !== "open" && (v.resolvedBy == null || v.resolvedAt == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "báo cáo đã xử lý phải có resolvedBy và resolvedAt",
      });
    }
  });
export type FeedReportCoreDto = z.infer<typeof feedReportCoreSchema>;

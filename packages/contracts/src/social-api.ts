import { z } from "zod";
import {
  feedAudienceSchema,
  feedPostStatusSchema,
  feedReactionEmojiSchema,
  feedTargetTypeSchema,
  FEED_COMMENT_BODY_MAX,
} from "./social";

/**
 * S16-SOCIAL-BE-1 — DTO request/response của **Nhóm A** (19 route `SOCIAL-API-001..019`: bảng tin/bài
 * 001-013 + bình luận 014-019). Nguồn sự thật hình dạng = API-19 §5.1/§6/§7; nguồn sự thật RULE =
 * SPEC-16; nguồn sự thật GIÁ TRỊ enum = `./social` (mirror CHECK migration 0577).
 *
 * TÁCH KHỎI `./social` theo đúng luật đã dùng cho `./payroll-employees`: file này **import NGƯỢC** từ
 * `./social` và **KHÔNG re-export** tên nào của nó (trùng tên ở hai star-export là lỗi mơ hồ lúc build).
 * Lý do tách: `./social` là nơi ở của enum mirror-CHECK cho CẢ Track A lẫn Track B, đã 372 dòng; nhồi
 * thêm ~330 dòng DTO của riêng Nhóm A đẩy nó về phía trần 800 trước khi BE-1B/BE-2 kịp thêm phần của họ.
 *
 * ┌─ VÌ SAO KHÔNG `.pick()`/`.extend()` TỪ `feedPostCoreSchema` (plan §2 D2/D3 viết vậy) ───────────┐
 * │ ĐO THẬT (zod 3.25.76): `feedPostCoreSchema` kết thúc bằng `.superRefine()` ⇒ nó là **ZodEffects**,│
 * │ và ZodEffects KHÔNG có `.pick`/`.extend` (cả hai `undefined`). Cơ chế plan mô tả không biên dịch  │
 * │ được — không phải lựa chọn khẩu vị.                                                              │
 * │                                                                                                  │
 * │ Thay bằng thứ CHẶT HƠN, đúng mục đích chống mass-assignment của D3: mỗi DTO ghi là một            │
 * │ **allowlist tường minh** `z.object({…}).strict()` chỉ chứa trường NGƯỜI DÙNG được gửi. `.pick()`  │
 * │ là "bỏ bớt khỏi danh sách đầy đủ" — quên bỏ một trường là lọt; allowlist là "chỉ nhận những thứ   │
 * │ có tên ở đây" — quên thêm thì 400, không phải rò. Trường do SERVER quyết định (`status`,          │
 * │ `pinned`, `likeCount`, `commentCount`, `viewCount`) KHÔNG xuất hiện trong bất kỳ DTO ghi nào dưới │
 * │ đây, nên `{status:'published',pinned:true,likeCount:999}` bị `.strict()` từ chối 400 tại biên.    │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

// ═══════════════ Hằng của Nhóm A ═══════════════

/**
 * Trần độ dài `body` bài/bình luận — mirror TRỰC TIẾP `chat.ts:323` (`body: z.string().max(4000)`).
 *
 * ⚠️ HẸP HƠN CHECK của DB có chủ ý (`chk_feed_posts_body_len` 20000 · `chk_feed_comments_body_len`
 * 5000) và đó KHÔNG vi phạm luật mirror-hai-chiều của `./social`: luật đó nói Zod không được từ chối
 * giá trị mà DB CHẤP NHẬN **ở tầng enum/tập giá trị** (từ chối sai ⇒ 400 oan trên dữ liệu hợp lệ).
 * Ở đây là **chính sách sản phẩm** về độ dài bài viết, thống nhất với CHAT; CHECK của DB là lưới cuối
 * chống ghi tay. Nới trần sản phẩm sau này chỉ cần sửa hằng này, không cần migration.
 */
export const FEED_BODY_MAX = 4000;

/** Trần `note`/`resolutionNote` của báo cáo (BE-1B dùng; định nghĩa ở đây để 1 chỗ giữ mọi trần SOCIAL). */
export const FEED_NOTE_MAX = 1000;

/** SPEC-16 §16 — giới hạn đính kèm mỗi bài/bình luận. */
export const FEED_MAX_IMAGES_PER_POST = 10;
export const FEED_MAX_VIDEOS_PER_POST = 1;
export const FEED_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Trần tổng số đính kèm nhận ở DTO — chặn mảng khổng lồ TRƯỚC khi chạm DB/S3. */
export const FEED_MAX_ATTACHMENTS = FEED_MAX_IMAGES_PER_POST + FEED_MAX_VIDEOS_PER_POST;
/** Trần số người được nhắc tên trong MỘT bài/bình luận — chặn fan-out NOTI khổng lồ. */
export const FEED_MAX_MENTIONS = 50;

/** API-19 §6.4 — feed/bình luận dùng cursor, `limit` ≤ 50. */
export const FEED_PAGE_LIMIT_MAX = 50;

// ═══════════════ Enum riêng của tầng API (KHÔNG mirror CHECK nào) ═══════════════

/**
 * API-19 §5.1 — `latest` = keyset `(published_at, id)` («Mới đăng»); `active` = keyset
 * `(last_activity_at, id)` («Hoạt động mới»). Tên lấy NGUYÊN VĂN của API-19, không đổi thành
 * `published`/`activity`: FE và QA đọc bảng route, không đọc tên cột.
 */
export const feedSortSchema = z.enum(["active", "latest"]);
export type FeedSortDto = z.infer<typeof feedSortSchema>;

/**
 * Bộ lọc `status` của `GET /social/feed` — **CHỈ `published`/`hidden`**, cố ý KHÔNG có `deleted`.
 *
 * Bài xoá mềm không có đường đọc nào qua API (không route restore ở BE-1 — plan §0.2); mở một giá trị
 * lọc dẫn tới tập rỗng vĩnh viễn chỉ tạo ảo giác "có màn hình thùng rác".
 */
export const feedStatusFilterSchema = z.enum(["published", "hidden"]);
export type FeedStatusFilterDto = z.infer<typeof feedStatusFilterSchema>;

/** Loại bài BE-1 chấp nhận TẠO (plan §2 D2 — poll/idea/kudos thuộc BE-2). */
export const feedCreatableTypeSchema = z.enum(["share", "news"]);
export type FeedCreatableTypeDto = z.infer<typeof feedCreatableTypeSchema>;

/** Phân loại đính kèm suy từ `files.mime_type` ở server — client KHÔNG gửi lên. */
export const feedAttachmentKindSchema = z.enum(["image", "video", "file"]);
export type FeedAttachmentKindDto = z.infer<typeof feedAttachmentKindSchema>;

// ═══════════════ Mảnh dùng lại ═══════════════

const uuid = () => z.string().uuid();
const feedBody = () => z.string().trim().min(1).max(FEED_BODY_MAX);
const mentionIds = () => z.array(uuid()).max(FEED_MAX_MENTIONS).optional();
const attachmentIds = () => z.array(uuid()).max(FEED_MAX_ATTACHMENTS).optional();

/**
 * Tác giả hiển thị — **KHÔNG có `userId`** (API-19 §6.1).
 *
 * `authorUserId` là khoá định danh tài khoản; DTO bài chỉ cần danh tính NHÂN SỰ. Phơi `userId` ra thẻ
 * bài biến mọi dòng cuộn thành bản đồ user-id của cả công ty, và nó là thứ duy nhất cần để dò các
 * đường `users/*`. Quyền sở hữu ("bài này của tôi") trả bằng cờ `isMine`, không bằng so sánh id ở FE.
 */
export const feedAuthorSchema = z.object({
  employeeId: uuid().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type FeedAuthorDto = z.infer<typeof feedAuthorSchema>;

/**
 * Đính kèm trên DTO REST — `url` là presign KÝ CHO CHÍNH NGƯỜI GỌI.
 *
 * `url` nullable: `FilePolicyService` quyết định per-recipient, từ chối ⇒ `null` (fail-soft, khuôn
 * `chat-attachments.service.ts:217`) chứ không làm hỏng cả thẻ bài.
 */
export const feedAttachmentSchema = z.object({
  fileId: uuid(),
  kind: feedAttachmentKindSchema,
  fileName: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  url: z.string().nullable(),
});
export type FeedAttachmentDto = z.infer<typeof feedAttachmentSchema>;

/** Một dòng tổng hợp cảm xúc trên bài/bình luận. `mine` = của riêng actor. */
export const feedReactionSummarySchema = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
  mine: z.boolean(),
});
export type FeedReactionSummaryDto = z.infer<typeof feedReactionSummarySchema>;

// ═══════════════ Response — bài & bình luận ═══════════════

/**
 * Thẻ bài (API-19 §6.1).
 *
 * ⚠️ `status` **OPTIONAL và chỉ có mặt** với tác giả hoặc người có `manage:feed-post`. Người đọc
 * thường không nhận khoá này — có mặt là đủ để biết một bài đang `hidden` tồn tại. `deletedAt` và
 * `authorUserId` KHÔNG có mặt ở bất kỳ nhánh nào (API-19 §6.1).
 *
 * ⚠️ Cùng schema này là payload WS `feed:post.created` (plan §5 R24) — thêm khoá ở đây là thêm khoá
 * phát ra cho cả room. Xem `wsFeedPostCreatedEventSchema` ở `./realtime` để biết vế thu hẹp.
 */
export const feedPostSchema = z.object({
  id: uuid(),
  type: z.string(),
  audience: feedAudienceSchema,
  orgUnitId: uuid().nullable(),
  groupId: uuid().nullable(),
  author: feedAuthorSchema,
  body: z.string().nullable(),
  tags: z.array(z.string()),
  attachments: z.array(feedAttachmentSchema),
  pinned: z.boolean(),
  commentsLocked: z.boolean(),
  requiresAck: z.boolean(),
  likeCount: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  viewCount: z.number().int().nonnegative(),
  /** Emoji actor đang thả trên bài, `null` = chưa thả. Projection theo actor, cùng một câu truy vấn. */
  myReaction: z.string().nullable(),
  savedByMe: z.boolean(),
  /** Bài này do chính actor đăng — thay cho việc phơi `authorUserId` để FE tự so. */
  isMine: z.boolean(),
  /** CHỈ tác giả / `manage:feed-post`. Vắng mặt = người đọc thường. */
  status: feedPostStatusSchema.optional(),
  editedAt: z.string().datetime({ offset: true }).nullable(),
  publishedAt: z.string().datetime({ offset: true }),
  lastActivityAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedPostDto = z.infer<typeof feedPostSchema>;

/** Bình luận 1 cấp. `parentCommentId` null = bình luận gốc. */
export const feedCommentSchema = z.object({
  id: uuid(),
  postId: uuid(),
  parentCommentId: uuid().nullable(),
  author: feedAuthorSchema,
  body: z.string(),
  attachments: z.array(feedAttachmentSchema),
  likeCount: z.number().int().nonnegative(),
  myReaction: z.string().nullable(),
  isMine: z.boolean(),
  editedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedCommentDto = z.infer<typeof feedCommentSchema>;

/** Một người đã thả cảm xúc (`SOCIAL-API-013`) — danh tính NHÂN SỰ, KHÔNG `userId`. */
export const feedReactorSchema = z.object({
  employeeId: uuid().nullable(),
  fullName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  emoji: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type FeedReactorDto = z.infer<typeof feedReactorSchema>;

/**
 * Keyset — `{ data, nextCursor }`, **KHÔNG** đi qua `paginated()` (memory
 * `apifetch-drops-pagination-bare-array`, khuôn `chatOversightAuditResponseSchema`).
 * `nextCursor: null` = trang cuối.
 */
export const feedPostPageSchema = z.object({
  data: z.array(feedPostSchema),
  nextCursor: z.string().nullable(),
});
export type FeedPostPageDto = z.infer<typeof feedPostPageSchema>;

export const feedCommentPageSchema = z.object({
  data: z.array(feedCommentSchema),
  nextCursor: z.string().nullable(),
});
export type FeedCommentPageDto = z.infer<typeof feedCommentPageSchema>;

/**
 * Bọc kết quả TẠO bài/bình luận — `droppedMentions` là **thông tin, KHÔNG phải lỗi** (SPEC-16 §12
 * `ERR-009`): mention ai đó ngoài audience bị bỏ im lặng, request vẫn 201.
 *
 * ┌─ ⚠️ CHỈ DỘI LẠI `userId` CALLER ĐÃ GỬI — KHÔNG tên, KHÔNG `employeeId` ────────────────────────┐
 * │ Bản đầu trả `{employeeId, fullName}` và kèm docblock nói "không thêm thông tin nào mới". Câu đó  │
 * │ SAI, và cổng `identity-projection-ratchet` bắt được: caller gửi một UUID bất kỳ rồi đọc          │
 * │ `fullName` trong phản hồi là **học được tên người đó** — một oracle dò danh bạ đúng bằng vòng     │
 * │ lặp đoán id, trên chính đường mà SPEC-16 §12 dựng ra để KHÔNG rò gì (mention ngoài audience bị    │
 * │ bỏ IM LẶNG chứ không báo lỗi).                                                                    │
 * │ Dội lại đúng tập con của `mentionedUserIds` mà caller VỪA GỬI thì thông tin mới = 0, và FE vẫn   │
 * │ đủ dữ liệu hiện chú thích (nó đã có tên từ ô chọn mention).                                       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Rỗng là trường hợp thường; khoá LUÔN có mặt để FE không phải kiểm `undefined`.
 */
export const feedDroppedMentionsSchema = z.array(uuid());
export type FeedDroppedMentionsDto = z.infer<typeof feedDroppedMentionsSchema>;

export const feedPostCreatedSchema = feedPostSchema.extend({
  droppedMentions: feedDroppedMentionsSchema,
});
export type FeedPostCreatedDto = z.infer<typeof feedPostCreatedSchema>;

export const feedCommentCreatedSchema = feedCommentSchema.extend({
  droppedMentions: feedDroppedMentionsSchema,
});
export type FeedCommentCreatedDto = z.infer<typeof feedCommentCreatedSchema>;

// ═══════════════ Request — allowlist `.strict()`, KHÔNG dẫn xuất từ core schema ═══════════════

/**
 * `SOCIAL-API-001` — `GET /social/feed`.
 *
 * `status` khác `published` đòi thêm `manage:feed-post` (API-19 §5.1) — **ép ở service, 403**, KHÔNG
 * im lặng ép về `published`: ép ngầm làm màn kiểm duyệt SOC-SCREEN-010 hiện đúng dòng cuộn thường và
 * người vận hành tưởng "không có bài ẩn nào".
 */
export const listFeedQuerySchema = z
  .object({
    sort: feedSortSchema.default("active"),
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT_MAX).default(20),
    type: z.string().max(16).optional(),
    audience: feedAudienceSchema.optional(),
    status: feedStatusFilterSchema.optional(),
    authorUserId: uuid().optional(),
    orgUnitId: uuid().optional(),
    tag: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type ListFeedQueryDto = z.infer<typeof listFeedQuerySchema>;

/** `SOCIAL-API-010` — `GET /social/saved` (chỉ bài của chính actor). */
export const listSavedQuerySchema = z
  .object({
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type ListSavedQueryDto = z.infer<typeof listSavedQuerySchema>;

/** `SOCIAL-API-014` — `GET /social/posts/{id}/comments`. */
export const listCommentsQuerySchema = z
  .object({
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_PAGE_LIMIT_MAX).default(20),
  })
  .strict();
export type ListCommentsQueryDto = z.infer<typeof listCommentsQuerySchema>;

/**
 * `SOCIAL-API-002` — `POST /social/posts`.
 *
 * Allowlist: 7 trường. `status`/`likeCount`/`commentCount`/`viewCount` KHÔNG có tên ở đây ⇒ `.strict()`
 * từ chối 400 (plan §5 R15). `pinned` cũng KHÔNG có: ghim đi qua `/moderation` (006) vì nó cần cặp
 * `manage:feed-news` RIÊNG — cho ghim ngay lúc tạo là mở đường vòng qua đúng cặp đó.
 *
 * Luật kéo theo `audience` ⇄ khoá được lặp lại ở đây (không dẫn xuất được từ `feedPostCoreSchema` —
 * xem docblock đầu file): giữ ĐÚNG hình dạng CHECK `chk_feed_posts_audience_*` của migration 0577.
 * `audience='group'` từ chối ở SERVICE (422 `SOCIAL-ERR-008`, plan D1) chứ không ở đây — Zod từ chối
 * sẽ trả 400 vô danh, còn đây là quyết định NGHIỆP VỤ "chưa mở" cần mã lỗi nói đúng lý do.
 */
export const createFeedPostSchema = z
  .object({
    type: feedCreatableTypeSchema,
    audience: feedAudienceSchema.default("company"),
    groupId: uuid().nullish(),
    orgUnitId: uuid().nullish(),
    body: feedBody(),
    /** Chỉ hợp lệ với `type='news'` (mirror `chk_feed_posts_ack_news`). */
    requiresAck: z.boolean().default(false),
    mentionedUserIds: mentionIds(),
    attachmentIds: attachmentIds(),
  })
  .strict()
  .superRefine((v, ctx) => {
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
    if (v.audience === "company" && (v.groupId != null || v.orgUnitId != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audience"],
        message: "audience='company' không được mang groupId/orgUnitId",
      });
    }
    if (v.requiresAck && v.type !== "news") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requiresAck"],
        message: "chỉ bài type='news' được yêu cầu xác nhận đọc",
      });
    }
  });
export type CreateFeedPostDto = z.infer<typeof createFeedPostSchema>;

/**
 * `SOCIAL-API-004` — `PATCH /social/posts/{id}`.
 *
 * CHỈ nội dung: `body` + danh sách mention/đính kèm thay thế. `audience`/`type`/`orgUnitId` KHÔNG sửa
 * được sau khi đăng — đổi audience của một bài đã có người đọc là đổi ngược phạm vi hiển thị của nội
 * dung đã phát tán, và các bản sao đã fan-out qua WS/NOTI không thu hồi được.
 */
export const updateFeedPostSchema = z
  .object({
    body: feedBody(),
    mentionedUserIds: mentionIds(),
    attachmentIds: attachmentIds(),
  })
  .strict();
export type UpdateFeedPostDto = z.infer<typeof updateFeedPostSchema>;

/**
 * `SOCIAL-API-006` — `PATCH /social/posts/{id}/moderation`.
 *
 * Ba trường ĐỘC LẬP, mỗi trường một cặp quyền riêng (API-19 §5.1c): `hidden`/`commentsLocked` cần
 * `manage:feed-post`, `pinned` cần `manage:feed-news`. Body rỗng ⇒ 400 (không có gì để làm mà vẫn
 * chạm đường audit).
 */
export const moderateFeedPostSchema = z
  .object({
    hidden: z.boolean().optional(),
    pinned: z.boolean().optional(),
    commentsLocked: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => v.hidden !== undefined || v.pinned !== undefined || v.commentsLocked !== undefined,
    {
      message: "cần ít nhất một trường trong {hidden, pinned, commentsLocked}",
    },
  );
export type ModerateFeedPostDto = z.infer<typeof moderateFeedPostSchema>;

/**
 * `SOCIAL-API-015` — `POST /social/posts/{id}/comments`.
 *
 * `body` dùng trần SOCIAL (`FEED_BODY_MAX` 4000) chứ không `FEED_COMMENT_BODY_MAX` (5000, CHECK của
 * DB): trần sản phẩm hẹp hơn lưới DB — xem docblock `FEED_BODY_MAX`. Tham chiếu hằng DB ở đây để lần
 * sau ai nới trần sản phẩm thì thấy ngay đâu là mức DB còn chịu được.
 */
export const createFeedCommentSchema = z
  .object({
    body: feedBody(),
    parentCommentId: uuid().nullish(),
    mentionedUserIds: mentionIds(),
    attachmentIds: attachmentIds(),
  })
  .strict();
export type CreateFeedCommentDto = z.infer<typeof createFeedCommentSchema>;

/** Mức DB còn chịu được cho `feed_comments.body` — xem `createFeedCommentSchema`. */
export const FEED_COMMENT_DB_BODY_MAX = FEED_COMMENT_BODY_MAX;

/** `SOCIAL-API-016` — `PATCH /social/comments/{id}`. */
export const updateFeedCommentSchema = z
  .object({
    body: feedBody(),
    mentionedUserIds: mentionIds(),
    attachmentIds: attachmentIds(),
  })
  .strict();
export type UpdateFeedCommentDto = z.infer<typeof updateFeedCommentSchema>;

/**
 * `SOCIAL-API-011`/`018` — `PUT …/reaction`.
 *
 * `emoji` đi qua `feedReactionEmojiSchema` = bộ dùng chung với CHAT. Cột `feed_reactions.emoji` KHÔNG
 * có CHECK ở DB (DB-17 §6.3) ⇒ **đây là lớp phòng thủ duy nhất**; service kiểm LẠI một lần nữa cho
 * đường gọi không qua HTTP (khuôn `ChatReactionsService.parseEmoji`).
 */
export const putFeedReactionSchema = z.object({ emoji: feedReactionEmojiSchema }).strict();
export type PutFeedReactionDto = z.infer<typeof putFeedReactionSchema>;

/** Phản hồi của 011/012/018/019 — tổng hợp MỚI của đích, để FE hoà lại cập-nhật-lạc-quan. */
export const feedReactionResultSchema = z.object({
  targetType: feedTargetTypeSchema,
  targetId: uuid(),
  likeCount: z.number().int().nonnegative(),
  reactions: z.array(feedReactionSummarySchema),
});
export type FeedReactionResultDto = z.infer<typeof feedReactionResultSchema>;

/** Phản hồi của 007/008/009 — thao tác cá nhân, chỉ cần trạng thái mới. */
export const feedPostFlagResultSchema = z
  .object({
    postId: uuid(),
    savedByMe: z.boolean().optional(),
    viewCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type FeedPostFlagResultDto = z.infer<typeof feedPostFlagResultSchema>;

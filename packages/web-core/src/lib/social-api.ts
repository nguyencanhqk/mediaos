import { z } from "zod";
import {
  // ── Nhóm A (S16-SOCIAL-BE-1, SOCIAL-API-001..019) ──
  feedPostSchema,
  type FeedPostDto,
  feedPostPageSchema,
  type FeedPostPageDto,
  feedPostCreatedSchema,
  type FeedPostCreatedDto,
  feedPostFlagResultSchema,
  type FeedPostFlagResultDto,
  feedCommentSchema,
  type FeedCommentDto,
  feedCommentPageSchema,
  type FeedCommentPageDto,
  feedCommentCreatedSchema,
  type FeedCommentCreatedDto,
  feedReactionResultSchema,
  type FeedReactionResultDto,
  feedReactorSchema,
  type FeedReactorDto,
  type CreateFeedPostDto,
  type UpdateFeedPostDto,
  type ModerateFeedPostDto,
  type CreateFeedCommentDto,
  type UpdateFeedCommentDto,
  type ListFeedQueryDto,
  type ListSavedQueryDto,
  type ListCommentsQueryDto,
  type FeedReactionEmojiDto,
  // ── Nhóm B (S16-SOCIAL-BE-1B, SOCIAL-API-020..026) ──
  feedNewsPageSchema,
  type FeedNewsPageDto,
  feedAckResultSchema,
  type FeedAckResultDto,
  feedAckPageSchema,
  type FeedAckPageDto,
  feedBirthdayListSchema,
  type FeedBirthdayListDto,
  type ListNewsQueryDto,
  type ListPostAcksQueryDto,
  type SearchFeedQueryDto,
  type ListProfilePostsQueryDto,
  type ListBirthdaysQueryDto,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";
import { idempotencyKeyFor } from "./api-idempotency";

/**
 * S16-SOCIAL-FE-1 — SOCIAL API client (SPEC-16 · API-19 §5.1/§5.1b/§5.1c · §6.1).
 *
 * MIRROR các controller THẬT: `SocialPostsController` / `SocialCommentsController` /
 * `SocialReactionsController` (`social.controllers.ts`, 001–019) + `SocialNewsController` /
 * `SocialDiscoveryController` (`social-b.controllers.ts`, 020–026). Tiền tố đường dẫn `/social` —
 * **không** phải `/feed`: `/feed` là đường dẫn ROUTE của FE (plan D1), `/social` là tiền tố
 * `@Controller("social")` của BE. Hai thứ cố ý khác nhau, đừng "sửa cho khớp".
 *
 * ┌─ HÌNH DẠNG PHẢN HỒI — ba kiểu, KHÔNG phải một ────────────────────────────────────────────────┐
 * │ 1. **Keyset `{ data, nextCursor }`** — 001 · 010 · 014 · 020 · 022 · 023 · 025. KHÔNG đi qua    │
 * │    `paginated()`, nên schema truyền vào là `feedPostPageSchema` (object), không phải           │
 * │    `z.array(...)` (memory `apifetch-drops-pagination-bare-array` — đưa sai kiểu là ZodError     │
 * │    runtime DÙ HTTP 200).                                                                        │
 * │ 2. **Mảng trần** — 013 (`FeedReactorDto[]`).                                                    │
 * │ 3. **Object nhỏ** — 005/017 (`{deleted:true}`) · 007/008/009 (`feedPostFlagResultSchema`) ·     │
 * │    011/012/018/019 (`feedReactionResultSchema`) · 021 (`feedAckResultSchema`) ·                 │
 * │    026 (`feedBirthdayListSchema`).                                                              │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `company_id`, RLS, masking và mọi vị từ hiển thị (`visiblePostCondition`, membership nhóm, phạm vi
 * phòng ban) là việc của SERVER. Client chỉ gửi filter/id — **KHÔNG** tự lọc, **KHÔNG** tự che
 * (CLAUDE.md §5: masking là việc của SERVER).
 *
 * ⚠️ **Không mirror ở WO này (cố ý, không phải quên):**
 *  - `024 GET /social/tags` — không màn nào của FE-1 dùng; thêm hàm không call-site là mã chết.
 *  - `027..029` báo cáo vi phạm — owner ký 23/09/2026 GỠ khỏi FE-1 (plan §5.2 · N8); nút + hộp thoại
 *    + cảnh báo tự-lộ-danh-tính (SOC-DEC-011) đi **cùng một lượt** ở `S16-SOCIAL-FE-3`.
 *  - `030..044` nhóm + bình chọn (BE-2A #533 / BE-2B-1 #534 đã merge) — thuộc `S16-SOCIAL-FE-2`.
 */

/**
 * Phản hồi xoá mềm của `005` / `017` — `{ deleted: true }`.
 *
 * Khai TẠI ĐÂY chứ không ở contracts vì BE trả literal này thẳng từ service
 * (`social-posts.service.ts:341`, `social-comments.service.ts:293`) mà **không** đi qua một schema
 * contracts nào. Dùng `z.literal(true)` chứ không `z.boolean()`: nếu một ngày BE đổi sang
 * `{deleted:false}` cho nhánh "không có gì để xoá", ta muốn biết bằng một lỗi parse ồn ào ở đây,
 * không phải bằng một nút xoá im lặng không làm gì.
 */
export const feedDeletedResultSchema = z.object({ deleted: z.literal(true) }).strict();
export type FeedDeletedResultDto = z.infer<typeof feedDeletedResultSchema>;

export const socialApi = {
  // ── 001 · 010 · 020 · 023 · 025 — các dòng cuộn (keyset) ──────────────────────────────────────

  /**
   * GET /social/feed (001) — dòng cuộn chính.
   *
   * ⚠️ `status` khác `published` đòi thêm `manage:feed-post` ở TẦNG 2 (403, không im lặng ép về
   * `published`). FE chỉ gửi `status` khi người dùng thật sự có cặp đó — xem `FeedPage`.
   */
  listFeed: (query?: Partial<ListFeedQueryDto>): Promise<FeedPostPageDto> =>
    apiFetch(`/social/feed${buildQueryString(query ?? {})}`, feedPostPageSchema),

  /** GET /social/saved (010) — bài CHÍNH actor đã lưu. Không có bộ lọc nào ngoài phân trang. */
  listSaved: (query?: Partial<ListSavedQueryDto>): Promise<FeedPostPageDto> =>
    apiFetch(`/social/saved${buildQueryString(query ?? {})}`, feedPostPageSchema),

  /**
   * GET /social/news (020) — danh sách tin tức.
   *
   * Shape RỘNG HƠN `feedPostPageSchema` (`feedNewsItemSchema` thêm các khoá xác nhận đã đọc), nên
   * parse bằng `feedNewsPageSchema` — dùng nhầm schema bài thường sẽ **strip** đúng những khoá mà màn
   * Tin tức cần để vẽ nút «Xác nhận đã đọc».
   */
  listNews: (query?: Partial<ListNewsQueryDto>): Promise<FeedNewsPageDto> =>
    apiFetch(`/social/news${buildQueryString(query ?? {})}`, feedNewsPageSchema),

  /**
   * GET /social/search (023) — tìm toàn văn trong phạm vi bài actor THẤY ĐƯỢC.
   *
   * Trả CÙNG thẻ bài của dòng cuộn và sắp theo «Hoạt động mới», **không** theo điểm `ts_rank`
   * (contracts `searchFeedQuerySchema` giải thích vì sao). UI không được hứa "kết quả liên quan nhất".
   */
  search: (query: SearchFeedQueryDto): Promise<FeedPostPageDto> =>
    apiFetch(`/social/search${buildQueryString(query)}`, feedPostPageSchema),

  /** GET /social/profiles/:employeeId/posts (025) — bài của MỘT nhân viên, qua cùng `listFeed`. */
  listProfilePosts: (
    employeeId: string,
    query?: Partial<ListProfilePostsQueryDto>,
  ): Promise<FeedPostPageDto> =>
    apiFetch(
      `/social/profiles/${employeeId}/posts${buildQueryString(query ?? {})}`,
      feedPostPageSchema,
    ),

  // ── 002..006 — vòng đời bài ───────────────────────────────────────────────────────────────────

  /**
   * POST /social/posts (002) — tạo bài. **@Idempotent ở BE** ⇒ client BẮT BUỘC gửi `Idempotency-Key`.
   *
   * Khoá **suy từ nội dung** (`idempotencyKeyFor`), KHÔNG ngẫu nhiên: lớp API này không giữ trạng thái
   * theo vòng đời composer, nên khoá ngẫu nhiên sinh trong thân hàm sẽ khác nhau ở mỗi lần thử lại ⇒
   * idempotency chỉ có trên giấy và một lần retry mạng đẻ ra hai bài
   * (memory `idempotency-key-must-be-content-derived`).
   *
   * ⚠️ Chống bấm-đúp KHÔNG dựa mình khoá này: hai lần bấm với payload GIỐNG HỆT cho cùng khoá (tốt),
   * nhưng người dùng sửa một ký tự rồi bấm lại là payload khác ⇒ khoá khác ⇒ bài thứ hai. Nút phải bị
   * khoá khi đang gửi (plan ca **C26**).
   *
   * ⚠️ `type:'news'` còn đòi `manage:feed-news` ở TẦNG 2 (`tier1IsFloor`) — FE gate nút «Tin tức»
   * bằng đúng cặp đó, không chờ 403 rồi mới báo.
   */
  createPost: (body: CreateFeedPostDto): Promise<FeedPostCreatedDto> =>
    apiFetch(
      "/social/posts",
      feedPostCreatedSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor("social-post", body) },
    ),

  /** GET /social/posts/:postId (003) — chi tiết bài (`SOC-SCREEN-002`). */
  getPost: (postId: string): Promise<FeedPostDto> =>
    apiFetch(`/social/posts/${postId}`, feedPostSchema),

  /** PATCH /social/posts/:postId (004) — sửa bài. Bài người khác cần `manage:feed-post` (tầng 2). */
  updatePost: (postId: string, body: UpdateFeedPostDto): Promise<FeedPostDto> =>
    apiFetch(`/social/posts/${postId}`, feedPostSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /social/posts/:postId (005) — xoá MỀM. Trả `{deleted:true}`, KHÔNG trả bài. */
  deletePost: (postId: string): Promise<FeedDeletedResultDto> =>
    apiFetch(`/social/posts/${postId}`, feedDeletedResultSchema, { method: "DELETE" }),

  /**
   * PATCH /social/posts/:postId/moderation (006) — ẩn/hiện · khoá bình luận · **ghim**.
   *
   * 🔴 Cặp decorator `manage:feed-post` là **SÀN**. Trường `pinned` đòi RIÊNG `manage:feed-news` ở
   * tầng 2 (`SOCIAL_MODERATION_FIELD_PAIRS`) ⇒ FE gate mục «Ghim» bằng `manage:feed-news`, **không**
   * bằng `manage:feed-post` (plan §5.2). Gate nhầm ở đây cho ra một mục menu bấm vào là 403.
   */
  moderatePost: (postId: string, body: ModerateFeedPostDto): Promise<FeedPostDto> =>
    apiFetch(`/social/posts/${postId}/moderation`, feedPostSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // ── 007..009 — cờ cá nhân trên bài (view · save) ──────────────────────────────────────────────
  //
  // Cả ba gate bằng `view:feed` — thao tác CÁ NHÂN, SPEC-16 §11.2 nói rõ chúng KHÔNG có cặp riêng.
  // Viết `useCan("create","feed-save")` là bịa cặp: khoá đó không tồn tại trong seed ⇒ nút ẩn vĩnh
  // viễn với MỌI người và không cổng nào bắt được (plan §5.1 luật 5).

  /** POST /social/posts/:postId/view (007) — đánh dấu đã xem. Idempotent ở TẦNG DB (PK tổ hợp). */
  recordPostView: (postId: string): Promise<FeedPostFlagResultDto> =>
    apiFetch(`/social/posts/${postId}/view`, feedPostFlagResultSchema, { method: "POST" }),

  /** POST /social/posts/:postId/save (008) — lưu bài. Idempotent ở tầng DB. */
  savePost: (postId: string): Promise<FeedPostFlagResultDto> =>
    apiFetch(`/social/posts/${postId}/save`, feedPostFlagResultSchema, { method: "POST" }),

  /** DELETE /social/posts/:postId/save (009) — bỏ lưu. */
  unsavePost: (postId: string): Promise<FeedPostFlagResultDto> =>
    apiFetch(`/social/posts/${postId}/save`, feedPostFlagResultSchema, { method: "DELETE" }),

  // ── 011..013 · 018..019 — cảm xúc (cùng bảng `feed_reactions` ĐA HÌNH) ────────────────────────
  //
  // 011/012/018/019 trả **tổng hợp mới của MỤC TIÊU** (`{targetType,targetId,likeCount,reactions}`),
  // không trả bài/bình luận ⇒ call-site thay đúng mảng `reactions` trong cache, không tải lại trang.

  /** PUT /social/posts/:postId/reaction (011) — đặt cảm xúc. Idempotent theo bản chất. */
  putPostReaction: (postId: string, emoji: FeedReactionEmojiDto): Promise<FeedReactionResultDto> =>
    apiFetch(`/social/posts/${postId}/reaction`, feedReactionResultSchema, {
      method: "PUT",
      body: JSON.stringify({ emoji }),
    }),

  /** DELETE /social/posts/:postId/reaction (012) — bỏ cảm xúc. */
  deletePostReaction: (postId: string): Promise<FeedReactionResultDto> =>
    apiFetch(`/social/posts/${postId}/reaction`, feedReactionResultSchema, { method: "DELETE" }),

  /** GET /social/posts/:postId/reactions (013) — ai đã thả gì. **MẢNG TRẦN**, không keyset. */
  listPostReactors: (postId: string): Promise<FeedReactorDto[]> =>
    apiFetch(`/social/posts/${postId}/reactions`, z.array(feedReactorSchema)),

  /** PUT /social/comments/:commentId/reaction (018). */
  putCommentReaction: (
    commentId: string,
    emoji: FeedReactionEmojiDto,
  ): Promise<FeedReactionResultDto> =>
    apiFetch(`/social/comments/${commentId}/reaction`, feedReactionResultSchema, {
      method: "PUT",
      body: JSON.stringify({ emoji }),
    }),

  /** DELETE /social/comments/:commentId/reaction (019). */
  deleteCommentReaction: (commentId: string): Promise<FeedReactionResultDto> =>
    apiFetch(`/social/comments/${commentId}/reaction`, feedReactionResultSchema, {
      method: "DELETE",
    }),

  // ── 014..017 — bình luận (1 cấp + trả lời) ────────────────────────────────────────────────────

  /** GET /social/posts/:postId/comments (014) — keyset. */
  listComments: (
    postId: string,
    query?: Partial<ListCommentsQueryDto>,
  ): Promise<FeedCommentPageDto> =>
    apiFetch(
      `/social/posts/${postId}/comments${buildQueryString(query ?? {})}`,
      feedCommentPageSchema,
    ),

  /**
   * POST /social/posts/:postId/comments (015) — **@Idempotent ở BE**, cùng lý do như `createPost`.
   *
   * `droppedMentions` trong phản hồi là **THÔNG TIN, không phải lỗi** (SPEC-16 §12 `ERR-009`):
   * mention người ngoài audience bị bỏ im lặng mà request vẫn 201. UI nên nói ra, không nuốt.
   */
  createComment: (postId: string, body: CreateFeedCommentDto): Promise<FeedCommentCreatedDto> =>
    apiFetch(
      `/social/posts/${postId}/comments`,
      feedCommentCreatedSchema,
      { method: "POST", body: JSON.stringify(body) },
      { idempotencyKey: idempotencyKeyFor(`social-comment:${postId}`, body) },
    ),

  /** PATCH /social/comments/:commentId (016). */
  updateComment: (commentId: string, body: UpdateFeedCommentDto): Promise<FeedCommentDto> =>
    apiFetch(`/social/comments/${commentId}`, feedCommentSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /social/comments/:commentId (017) — xoá MỀM, trả `{deleted:true}`. */
  deleteComment: (commentId: string): Promise<FeedDeletedResultDto> =>
    apiFetch(`/social/comments/${commentId}`, feedDeletedResultSchema, { method: "DELETE" }),

  // ── 021 · 022 — xác nhận đã đọc tin tức ───────────────────────────────────────────────────────

  /**
   * POST /social/posts/:postId/ack (021) — TỰ xác nhận đã đọc.
   *
   * Gate `view:feed` là ĐỦ: server luôn dùng `actor.id`, body KHÔNG nhận `userId` — không có đường
   * nào ack hộ người khác. Đừng bọc nút này trong một `PermissionGate` quản trị.
   */
  ackPost: (postId: string): Promise<FeedAckResultDto> =>
    apiFetch(`/social/posts/${postId}/ack`, feedAckResultSchema, { method: "POST" }),

  /**
   * GET /social/posts/:postId/acks (022) — ai đã đọc / CHƯA đọc.
   *
   * 🔴 Cặp `manage:feed-news`, **KHÔNG** `view:feed`: nửa "chưa đọc" chiếu tên/avatar của MỌI người
   * trong audience kể cả người chưa tương tác gì — một đường chiếu danh tính toàn công ty. FE phải
   * bọc cả tab/nút mở nó bằng `<PermissionGate action="manage" resourceType="feed-news">`.
   */
  listPostAcks: (postId: string, query?: Partial<ListPostAcksQueryDto>): Promise<FeedAckPageDto> =>
    apiFetch(`/social/posts/${postId}/acks${buildQueryString(query ?? {})}`, feedAckPageSchema),

  // ── 026 — sinh nhật ───────────────────────────────────────────────────────────────────────────

  /**
   * GET /social/birthdays (026) — widget rail phải.
   *
   * Gate `view:feed` và **không** cặp HR nào (SOC-DEC-007) — đây là cửa sau tiềm năng vào PII của HR,
   * nên đừng "nâng cấp" gate lên cặp HR cho chắc: làm thế là đổi spec.
   *
   * ⚠️ `fullName`/`avatar` **nullable** và khoá là **`avatar`** (KHÔNG phải `avatarUrl` như phần còn
   * lại của module) — gõ nhầm ⇒ ZodError dù HTTP 200 ⇒ trắng cả rail phải. Ca **C21** ghim tên khoá.
   */
  listBirthdays: (query?: Partial<ListBirthdaysQueryDto>): Promise<FeedBirthdayListDto> =>
    apiFetch(`/social/birthdays${buildQueryString(query ?? {})}`, feedBirthdayListSchema),
};

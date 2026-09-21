/**
 * S16-SOCIAL-BE-1 — BẢNG HẰNG route → cặp quyền, NGUỒN SỰ THẬT DUY NHẤT cho CẢ BA nơi (khuôn
 * `RECRUIT_ROUTE_PAIRS`):
 *   1. `@RequirePermission(PAIR.action, PAIR.resourceType)` ở decorator route.
 *   2. Assert tầng THỨ HAI trong service (không gõ lại literal).
 *   3. Census 2 tầng (`social-two-layer-guard-census.unit-spec.ts`) so CẢ hai tầng với CHÍNH bảng này
 *      — một tầng sửa lệch là ĐỎ, kể cả khi hai tầng "khớp nhau" do cùng sai.
 *
 * ┌─ `tier1IsFloor` — VÌ SAO CẦN MỘT CỜ RIÊNG (plan §2 D17) ───────────────────────────────────────┐
 * │ Hai route của Nhóm A có cặp tầng-1 **không phải** cặp thật cần kiểm:                            │
 * │   • `002 POST /social/posts` — decorator `create:feed-post` là SÀN; nhánh `type='news'` còn đòi │
 * │     thêm `manage:feed-news` ở tầng 2 (API-19 §5.1b).                                            │
 * │   • `006 PATCH …/moderation` — decorator `manage:feed-post` là SÀN; trường `pinned` đòi          │
 * │     `manage:feed-news` ở tầng 2 (API-19 §5.1c).                                                 │
 * │ Không có cờ, người đọc decorator sẽ kết luận sai theo CẢ HAI chiều: "route này gate lỏng" (vì    │
 * │ decorator không nhắc `manage:feed-news`) hoặc "route này gate đủ rồi" (bỏ qua tầng 2). Cờ biến   │
 * │ câu hỏi đó thành một đẳng thức census kiểm được.                                                │
 * │                                                                                                 │
 * │ ⚠️ SÀN LÀ THẬT, KHÔNG PHẢI TRANG TRÍ — nó CHẶN. Vai tuỳ biến chỉ có `manage:feed-news` mà không  │
 * │ có `manage:feed-post` sẽ bị 403 **ở tầng 1** khi gọi `006`, kể cả khi chỉ đổi `pinned`. Đo thật  │
 * │ (plan M18, `0578:92-95`): hôm nay hai cặp đó cấp cho ĐÚNG CÙNG tập vai canonical (`hr` +         │
 * │ `company-admin`) ⇒ 0 tác động lên vai canonical. Dư lượng ghi nợ `S16-SOCIAL-BE-2`.             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **14 cặp `feed-*` đều `is_sensitive = false`** (migration `0578`) ⇒ wildcard `*:*` mở TẤT CẢ.
 * Đó là hành vi **THIẾT KẾ CỦA ENGINE** (`permission.decide.ts` Priority 4), áp dụng toàn hệ thống,
 * KHÔNG phải lỗ của SOCIAL. **KHÔNG "vá" bằng cách đổi `isSensitive:true`** — đổi cờ ở đây mà catalog
 * DB vẫn `false` chỉ làm `permission.can()` hỏi một câu khác câu seed, và đánh `is_sensitive=true` ở
 * DB là ĐỔI SPEC (phá SOC-DEC-004), việc của một WO có chữ ký owner.
 */
export interface SocialPair {
  readonly action: string;
  readonly resourceType: string;
  /** Mirror cờ catalog `0578` — cả 14 cặp `feed-*` đều false. Khai tường minh để không ai đoán. */
  readonly isSensitive: boolean;
  /**
   * `true` = cặp của decorator là **SÀN**, tầng 2 còn kiểm thêm một cặp KHÁC.
   *
   * ┌─ ĐỊNH NGHĨA CHÍNH XÁC — ĐỌC TRƯỚC KHI ĐẶT CỜ CHO ROUTE MỚI ──────────────────────────────────┐
   * │ `tier1IsFloor = true` ⇔ **cặp quyền route thật sự đòi PHỤ THUỘC VÀO NỘI DUNG REQUEST**, nên   │
   * │ không một cặp tĩnh nào diễn đạt được nó: `002` phụ thuộc `type` (news cần `manage:feed-news`) │
   * │ · `006` phụ thuộc TRƯỜNG nào có mặt (`pinned` cần `manage:feed-news`).                        │
   * │                                                                                               │
   * │ ⚠️ ĐỊNH NGHĨA NÀY HẸP HƠN "tầng 2 có kiểm cặp khác" — và phải hẹp, nếu không cờ vô nghĩa:     │
   * │ `001` cũng hỏi `manage:feed-post` (cho bộ lọc `status`), `004`/`005`/`016`/`017` cũng hỏi nó   │
   * │ (nhánh sửa/xoá của người khác). Nhưng ở NĂM route đó, `view:feed` của decorator ĐÚNG là cặp    │
   * │ gác route: request cơ bản chạy trọn vẹn chỉ với nó, phần thêm là vị từ HÀNG (sở hữu) hoặc một  │
   * │ bộ lọc TUỲ CHỌN. Ở `002`/`006` thì không: một request hợp lệ về cú pháp bị 403 vì cặp mà       │
   * │ decorator KHÔNG hề nhắc tới.                                                                  │
   * │                                                                                               │
   * │ Census (`social-two-layer-guard-census.unit-spec.ts`) đo đẳng thức này bằng một thứ ĐỘC LẬP:   │
   * │ tập `tier1IsFloor===true` phải BẰNG ĐÚNG tập route có bảng cặp-theo-payload                   │
   * │ (`SOCIAL_POST_TYPE_PAIRS` cho `002`, `SOCIAL_MODERATION_FIELD_PAIRS` cho `006`).              │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  readonly tier1IsFloor: boolean;
  /**
   * SÀN SCOPE Company (khuôn `RecruitPair.companyFloor` · memory `dash-widget-gate-needs-scope-floor`):
   * cặp chỉ hợp lệ ở scope Company — grant resolve ra hẹp hơn ⇒ TỪ CHỐI 403, KHÔNG "coi như" Company.
   *
   * ⚠️ **Nhóm A: `companyFloor` = `true` cho TOÀN BỘ 19 route, tập `false` RỖNG CÓ CHỦ Ý.** Seed
   * `0578` cấp mọi cặp `feed-*` ở scope `Company` cho 4 vai canonical, TRỪ ĐÚNG MỘT dòng:
   * `['manager','view','feed-report','Department']` — và `view:feed-report` là cặp của route `028`,
   * thuộc `S16-SOCIAL-BE-1B`. Khi BE-1B mở, nó thêm hàng đó với `companyFloor:false` +
   * `dataScope:"Department"` và PHẢI ép vị từ phòng ban TRONG SQL.
   */
  readonly companyFloor: boolean;
}

const pair = (
  action: string,
  resourceType: string,
  tier1IsFloor = false,
  companyFloor = true,
): SocialPair => ({ action, resourceType, isSensitive: false, tier1IsFloor, companyFloor });

/**
 * Key = mã route API-19 (`SOCIAL-API-XXX`) — đúng 19 route của Nhóm A.
 *
 * `S16-SOCIAL-BE-1B` thêm route `020..029` vào CHÍNH bảng này (không tạo bảng hằng thứ hai);
 * `S16-SOCIAL-BE-2` thêm `030..053`.
 */
export const SOCIAL_ROUTE_PAIRS = {
  // ── Bảng tin & bài 001–013 ──
  /** 001 `GET /social/feed` — `status` khác `published` đòi thêm `manage:feed-post` (ép ở service). */
  feedList: pair("view", "feed"),
  /** 002 `POST /social/posts` — SÀN; `type='news'` đòi thêm `manage:feed-news` (D4). */
  postCreate: pair("create", "feed-post", true),
  postDetail: pair("view", "feed"),
  postUpdate: pair("view", "feed"),
  postDelete: pair("view", "feed"),
  /** 006 `PATCH …/moderation` — SÀN; `pinned` đòi `manage:feed-news` (D5). */
  postModerate: pair("manage", "feed-post", true),
  postView: pair("view", "feed"),
  postSave: pair("view", "feed"),
  postUnsave: pair("view", "feed"),
  savedList: pair("view", "feed"),
  postReactionPut: pair("view", "feed"),
  postReactionDelete: pair("view", "feed"),
  postReactionList: pair("view", "feed"),
  // ── Bình luận 014–019 ──
  commentList: pair("view", "feed"),
  commentCreate: pair("create", "feed-comment"),
  commentUpdate: pair("view", "feed"),
  commentDelete: pair("view", "feed"),
  commentReactionPut: pair("view", "feed"),
  commentReactionDelete: pair("view", "feed"),
} as const satisfies Record<string, SocialPair>;

export type SocialRouteKey = keyof typeof SOCIAL_ROUTE_PAIRS;

/**
 * D4 — cặp quyền BẮT BUỘC THEO `type` ở `SOCIAL-API-002` (API-19 §5.1b).
 *
 * Bảng này là vế tầng-2 của `postCreate.tier1IsFloor`. Chỉ 2 loại ở BE-1 (D2); `poll`/`idea`/`kudos`
 * thuộc BE-2 và được Zod từ chối 400 TRƯỚC khi chạm bảng này.
 *
 * `share` ánh xạ về CHÍNH cặp sàn (không cặp phụ) — ghi tường minh `null` thay vì bỏ trống để census
 * phân biệt "loại này không cần cặp phụ" với "quên khai loại này".
 */
export const SOCIAL_POST_TYPE_PAIRS = {
  share: null,
  news: { action: "manage", resourceType: "feed-news", isSensitive: false },
} as const satisfies Record<
  string,
  { action: string; resourceType: string; isSensitive: boolean } | null
>;

export type SocialCreatablePostType = keyof typeof SOCIAL_POST_TYPE_PAIRS;

/**
 * D5 — cặp quyền theo TỪNG TRƯỜNG ở `SOCIAL-API-006` (API-19 §5.1c).
 *
 * ⚠️ `pinned` → `manage:feed-news`, KHÔNG `manage:feed-post`. API-19 §5.1c ghi rõ nhánh
 * `manage:feed-post` cho `pinned` là **nhánh chết** (CHECK `chk_feed_posts_pinned_news` chỉ cho ghim
 * bài `news`), đừng khai.
 *
 * Mỗi trường đổi = **một dòng audit riêng** `{postId, field, from, to}` (API-19 §8).
 */
export const SOCIAL_MODERATION_FIELD_PAIRS = {
  hidden: { action: "manage", resourceType: "feed-post", isSensitive: false },
  commentsLocked: { action: "manage", resourceType: "feed-post", isSensitive: false },
  pinned: { action: "manage", resourceType: "feed-news", isSensitive: false },
} as const satisfies Record<string, { action: string; resourceType: string; isSensitive: boolean }>;

export type SocialModerationField = keyof typeof SOCIAL_MODERATION_FIELD_PAIRS;

/** Thứ tự ổn định khi lặp 3 trường kiểm duyệt — audit ra dòng theo thứ tự đọc được, không theo hash. */
export const SOCIAL_MODERATION_FIELDS = [
  "hidden",
  "pinned",
  "commentsLocked",
] as const satisfies readonly SocialModerationField[];

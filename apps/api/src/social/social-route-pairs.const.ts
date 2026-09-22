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
   *
   * ✅ **BE-1B (22/09/2026) đã mở đúng hàng đó** — `reportsList`. Tập `companyFloor:false` nay có
   * ĐÚNG MỘT phần tử, và census ép nó phải kèm `dataScope` (xem field dưới).
   */
  readonly companyFloor: boolean;
  /**
   * S16-SOCIAL-BE-1B (plan §1 M3) — **phạm vi dữ liệu HẸP NHẤT mà route này ép TRONG SQL**, khai
   * BẮT BUỘC cho MỌI route `companyFloor:false` (census `social-two-layer-guard-census` assert đẳng
   * thức đó). `undefined` cho route `companyFloor:true` — ở đó sàn Company đã trả lời xong câu hỏi
   * phạm vi, không còn gì để khai.
   *
   * ┌─ VÌ SAO PHẢI LÀ MỘT FIELD, KHÔNG PHẢI "đọc `actor.routeScope` lúc runtime là đủ" ─────────────┐
   * │ Tắt `companyFloor` KHÔNG chỉ mở thêm `Department`: nó mở cho **MỌI** scope mà grant resolve ra │
   * │ được, kể cả `Own`/`Team` — hai giá trị mà SPEC-16 §11.1 không hề định nghĩa cho cặp            │
   * │ `view:feed-report`. Một grant `view:feed-report@Own` sẽ đi lọt `resolveActor` và, nếu           │
   * │ repository chỉ `if (scope === 'Department') … else <không lọc>`, nó đọc được TOÀN BỘ hàng đợi   │
   * │ báo cáo của công ty — fail-OPEN.                                                               │
   * │ Field này là lời hứa MÁY-KIỂM-ĐƯỢC rằng route có ép phạm vi hẹp đó trong SQL; comment của       │
   * │ chính tác giả BE-1 ở ngay trên đã cam kết trước điều này, nay biến nó thành đẳng thức census.  │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  readonly dataScope?: "Company" | "Department";
}

const pair = (
  action: string,
  resourceType: string,
  tier1IsFloor = false,
  companyFloor = true,
): SocialPair => ({ action, resourceType, isSensitive: false, tier1IsFloor, companyFloor });

/**
 * Key = mã route API-19 (`SOCIAL-API-XXX`) — 19 route Nhóm A (`S16-SOCIAL-BE-1`) + 10 route Nhóm B
 * (`S16-SOCIAL-BE-1B`) = **29 route**.
 *
 * `S16-SOCIAL-BE-2` thêm `030..053` vào CHÍNH bảng này (không tạo bảng hằng thứ hai).
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

  // ══ Nhóm B (`S16-SOCIAL-BE-1B`, API-19 §5.1 dòng 85-96) — 10 route `020..029` ══
  // ── Tin tức + xác nhận đã đọc 020–022 ──
  /** 020 `GET /social/news` — danh sách tin tức (`type='news'`, `sort='active'` cố định). */
  newsList: pair("view", "feed"),
  /** 021 `POST /social/posts/{id}/ack` — tự xác nhận đã đọc. `view:feed` là ĐỦ: actor ack cho CHÍNH
   *  mình (server luôn dùng `actor.id`, body không nhận `userId`). */
  postAck: pair("view", "feed"),
  /** 022 `GET /social/posts/{id}/acks` — ai đã đọc / CHƯA đọc. Cặp `manage:feed-news` (KHÔNG
   *  `view:feed`): nửa "chưa đọc" chiếu tên/avatar của MỌI người trong audience của bài, kể cả người
   *  chưa tương tác gì — một đường chiếu danh tính toàn công ty, không phải một danh sách tương tác. */
  postAcksList: pair("manage", "feed-news"),
  // ── Tìm kiếm · thẻ · trang cá nhân · sinh nhật 023–026 ──
  /** 023 `GET /social/search` — tìm toàn văn `tsvector` trong phạm vi bài actor THẤY ĐƯỢC. */
  search: pair("view", "feed"),
  /** 024 `GET /social/tags` — thẻ phổ biến. KHÔNG chiếu danh tính nào. */
  tagsList: pair("view", "feed"),
  /** 025 `GET /social/profiles/{employee_id}/posts` — bài của một nhân viên, qua CÙNG `listFeed`. */
  profilePosts: pair("view", "feed"),
  /** 026 `GET /social/birthdays` — widget sinh nhật. Gate `view:feed` và **không** cấp thêm cặp HR
   *  nào (SOC-DEC-007) — đây là cửa sau tiềm năng vào PII của HR. */
  birthdays: pair("view", "feed"),
  // ── Báo cáo vi phạm 027–029 ──
  /** 027 `POST /social/reports` — bất kỳ ai thấy được nội dung đều báo cáo được. */
  reportCreate: pair("view", "feed"),
  /**
   * 028 `GET /social/reports` — hàng đợi kiểm duyệt.
   *
   * 🔴 ROUTE DUY NHẤT của SOCIAL có `companyFloor:false`. Seed `0578` cấp
   * `['manager','view','feed-report','Department']` — vai `manager` đọc hàng đợi của ĐƠN VỊ MÌNH.
   * Sàn Company sẽ 403 chính vai đó, nên cờ phải tắt; và vì tắt, `dataScope` bên dưới trở thành lời
   * hứa máy-kiểm-được rằng repository CÓ ép vị từ phòng ban trong SQL (`switch` vét cạn, mọi scope
   * ngoài `Company|System|Department` ⇒ `sql\`false\``).
   */
  reportsList: { ...pair("view", "feed-report", false, false), dataScope: "Department" },
  /**
   * 029 `PATCH /social/reports/{id}` — xử lý (resolved/dismissed). Cặp QUẢN LÝ, **sàn Company GIỮ
   * NGUYÊN** — và đó là bất đối xứng CÓ CHỦ Ý với `028`, không phải quên tắt cờ.
   *
   * ĐO THẬT trên seed `0578` (dòng 100-110): `manage:feed-report` chỉ cấp cho `hr` và `company-admin`
   * ở scope **Company**; `manager` chỉ có `view:feed-report@Department`. Nói cách khác: manager ĐỌC
   * được hàng đợi của đơn vị mình nhưng KHÔNG kết thúc báo cáo — HR/company-admin xử lý (D6).
   * Một grant `manage:feed-report@Department` (seed không sinh, nhưng vai tuỳ biến có thể) vì vậy bị
   * TỪ CHỐI 403 `AUTH-ERR-SCOPE-DENIED` ở tầng 2, KHÔNG được "coi như Company".
   *
   * ⚠️ Hệ quả cho người đọc `social-reports.repository.ts`: vị từ D6 trên đường `findReport` hôm nay
   * LUÔN là `true` (scope ở đây luôn Company/System). Nó vẫn phải có mặt — cùng một câu luật cho cả
   * hai đường — nhưng ca đo thật của `switch` vét cạn nằm ở unit spec, không ở int-spec của `029`.
   */
  reportResolve: pair("manage", "feed-report"),

  // ══ NHÓM (`S16-SOCIAL-BE-2A`, API-19 §5.1 dòng 98-107) — 10 route `030..039` ══
  //
  // 🔴 **CẢ 10 ĐỀU `tier1IsFloor: false`, và đó KHÔNG phải sơ suất.** Định nghĩa của cờ (docblock ở
  // đầu file) HẸP: cặp quyền thật sự đòi PHỤ THUỘC NỘI DUNG REQUEST. Vế tầng-2 của nhóm là **vai trò
  // HÀNG** `feed_group_members.role` (SOC-DEC-006) — không phải một cặp quyền khác — cộng nhánh thoát
  // `manage:feed-group` đọc từ `SocialActor.canManageGroups`. Đúng hình dạng của `001`/`004`/`005`
  // (`view:feed` + `manage:feed-post` cho nhánh nội dung người khác), và census assert ĐẲNG THỨC tập
  // `tier1IsFloor===true` với tập route có bảng cặp-theo-payload — đặt `true` ở đây là ĐỎ ngay.
  //
  // `companyFloor: true` cả 10 (`dataScope` bỏ trống): seed `0578:87-97` cấp `create:feed-group` cho
  // cả 4 vai canonical và `manage:feed-group` cho `hr` + `company-admin`, TẤT CẢ ở scope `Company`.
  // Phạm vi dữ liệu của nhóm là membership ép trong SQL, không phải scope của grant.
  /** 030 `GET /social/groups` — public ∪ nhóm của actor; `manage:feed-group` thấy mọi nhóm còn sống. */
  groupsList: pair("view", "feed"),
  /** 031 `POST /social/groups` — cặp RIÊNG (`create:feed-group`), khác 9 route còn lại. */
  groupCreate: pair("create", "feed-group"),
  groupGet: pair("view", "feed"),
  /** 033 `PATCH …/{id}` — tầng 2: vai `owner|admin` HOẶC `manage:feed-group` (+audit khi qua manage). */
  groupUpdate: pair("view", "feed"),
  /** 034 `DELETE …/{id}` — tầng 2: vai **`owner` MỘT MÌNH** (API-19 dòng 102) HOẶC `manage:feed-group`. */
  groupDelete: pair("view", "feed"),
  groupJoin: pair("view", "feed"),
  groupLeave: pair("view", "feed"),
  groupMembersList: pair("view", "feed"),
  /** 038 `PATCH …/members/{uid}` — duyệt/từ chối/đổi vai trò; audit LUÔN (thao tác lên người khác). */
  groupMemberDecide: pair("view", "feed"),
  /** 039 `DELETE …/members/{uid}` — mời ra; audit LUÔN. */
  groupMemberRemove: pair("view", "feed"),
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

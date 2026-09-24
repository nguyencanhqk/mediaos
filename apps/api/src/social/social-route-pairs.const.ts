import type { FeedCreatableTypeDto, FeedTargetTypeDto } from "@mediaos/contracts";
// An toàn về chu trình: `social.errors.ts` KHÔNG còn import gì từ file này (từ BE-2B-2 nó ghép kiểu
// trực tiếp với enum Zod của contracts) ⇒ cạnh phụ thuộc chỉ đi MỘT chiều.
import { SOCIAL_ERR } from "./social.errors";

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
   * │ `001` cũng hỏi `manage:feed-post` (cho bộ lọc `status`), `005`/`017` cũng hỏi nó (nhánh xoá   │
   * │ của người khác). Nhưng ở BA route đó, `view:feed` của decorator ĐÚNG là cặp gác route: request │
   * │ cơ bản chạy trọn vẹn chỉ với nó, phần thêm là vị từ HÀNG (sở hữu) hoặc một bộ lọc TUỲ CHỌN.    │
   * │ Ở `002`/`006` thì không: một request hợp lệ về cú pháp bị 403 vì cặp mà decorator KHÔNG hề      │
   * │ nhắc tới.                                                                                     │
   * │                                                                                               │
   * │ 🔴 **`004`/`016` ĐÃ ĐỔI PHE (S16-SOCIAL-ATTGATE-1, owner ký S-3 ngày 24/09/2026).** Bản trước  │
   * │ xếp chúng cùng nhóm `005`/`017` với lý do "phần thêm chỉ là vị từ HÀNG". Câu đó HẾT ĐÚNG: từ   │
   * │ WO này, một PATCH hợp lệ về cú pháp bị **403** vì cặp `create:feed-post`/`create:feed-comment` │
   * │ — cặp mà decorator không nhắc — và điều kiện phụ thuộc NỘI DUNG REQUEST (`attachmentIds` có    │
   * │ tệp MỚI hay không). Đúng định nghĩa hẹp ở trên, nên chúng mang cờ.                             │
   * │                                                                                               │
   * │ Census (`social-two-layer-guard-census.unit-spec.ts`) đo đẳng thức này bằng một thứ ĐỘC LẬP:   │
   * │ tập `tier1IsFloor===true` phải BẰNG ĐÚNG tập route có bảng cặp-theo-payload                   │
   * │ (`SOCIAL_POST_TYPE_PAIRS` cho `002`, `SOCIAL_MODERATION_FIELD_PAIRS` cho `006`,                │
   * │ `SOCIAL_FILE_TARGET_PAIRS` cho `054`/`055`, và với `004`/`016` là **call-site AST của          │
   * │ `resolveAttachNewGate` ở mức `Class#method`** — pin mức LỚP sẽ cho phép dời cổng từ `update()`  │
   * │ sang `create()` mà census vẫn xanh).                                                           │
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
  /**
   * S16-SOCIAL-BE-2B-2 — thông điệp 403 mà **`resolveActor`** phát cho route này, thay cho chuỗi
   * `AUTH-ERR-*` dùng chung. `undefined` ⇒ giữ chuỗi chung (47/48 route).
   *
   * ┌─ 🔴 VÌ SAO Ở ĐÂY, VÀ VÌ SAO ĐÂY LÀ CHỖ DUY NHẤT ĐÚNG (đo 24/09/2026) ──────────────────────────┐
   * │ SPEC-16 §12 gán `SOCIAL-ERR-020` cho ca «xét duyệt sáng kiến mà không có `approve:feed-idea`».   │
   * │ Plan BE-2B-2 (D20) định phát mã đó từ một hàm `assertApproveIdea` ở service, vì `PermissionGuard` │
   * │ không phát được mã module. **Đo ra thì hàm đó KHÔNG BAO GIỜ CHẠY TỚI:** `resolveActor` đã tự       │
   * │ resolve cặp của route rồi ném `AUTH-ERR-FORBIDDEN` (không có grant) hoặc `AUTH-ERR-SCOPE-DENIED`  │
   * │ (`companyFloor` mà scope hẹp hơn) — CẢ HAI nhánh, trước khi service chạy một dòng nào.            │
   * │                                                                                                 │
   * │ Tức là tầng-2 mà plan đòi **vốn đã tồn tại** (`resolveActor`, xem comment «Tầng 2 — assert cặp    │
   * │ của route, ĐỘC LẬP với decorator»); nó chỉ nói sai "tiếng". Thêm một hàm assert thứ hai ở service │
   * │ chỉ tạo mã CHẾT + code chết trông như một cổng. Nên sửa đúng chỗ: cho bảng hằng chở thông điệp.   │
   * │                                                                                                 │
   * │ ⚠️ Giới hạn CÒN LẠI, phải ghi vào PR: nhánh bị **`PermissionGuard` chặn ở tầng-1** (không có grant │
   * │ nào ⇒ guard 403 `Permission denied: <reason>`) vẫn KHÔNG mang mã này — guard chạy TRƯỚC service   │
   * │ và `@RequirePermission` không nhận message tuỳ biến. Phủ cả ca đó đòi đổi `PermissionGuard` toàn   │
   * │ hệ = WO riêng (plan §10 đã ghi nợ).                                                              │
   * └────────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  readonly denyMessage?: string;
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
  /** 004 `PATCH /social/posts/{id}` — SÀN; THÊM đính kèm mới đòi `create:feed-post` (ATTGATE-1). */
  postUpdate: pair("view", "feed", true),
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
  /** 016 `PATCH /social/comments/{id}` — SÀN; THÊM đính kèm mới đòi `create:feed-comment`. */
  commentUpdate: pair("view", "feed", true),
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

  // ── Bình chọn 040–044 (`S16-SOCIAL-BE-2B-1`) ──
  //
  // Cả năm đều `view:feed`, `tier1IsFloor = false`: vế tầng-2 của chúng là quyền trên HÀNG (bài cha
  // có thấy được không · có phải chủ bài không), KHÔNG phải một bảng cặp-theo-payload. Đặt
  // `tier1IsFloor = true` sẽ làm ca đẳng thức `D17` của census ĐỎ ngay — tập cờ phải BẰNG ĐÚNG tập
  // route có bảng ánh xạ payload→cặp, mà bình chọn thì không có bảng nào như thế.
  //
  // Bình chọn KHÔNG có cặp riêng ở tầng đọc: nó thừa hưởng phạm vi của BÀI CHA qua
  // `visiblePostCondition`. Cấp cho nó một cặp riêng sẽ đẻ ra đường đọc thứ hai vào cùng dữ liệu
  // với luật khác — đúng thứ `read-path-gate-pair-must-match-download-pair` cấm.
  /** 040 `GET /social/polls` — danh sách bình chọn thấy được; OFFSET. */
  pollList: pair("view", "feed"),
  /** 041 `PUT …/poll/vote` — bỏ/đổi phiếu; chỉ khi `open` và trước `closes_at`. */
  pollVote: pair("view", "feed"),
  /** 042 `DELETE …/poll/vote` — rút phiếu; chỉ khi `open`. */
  pollVoteWithdraw: pair("view", "feed"),
  /** 043 `GET …/poll/results` — kết quả; KHÔNG BAO GIỜ trả `user_id` (SOC-DEC-009). */
  pollResults: pair("view", "feed"),
  /** 044 `POST …/poll/close` — đóng tay; chủ bài HOẶC `manage:feed-post`; audit LUÔN. */
  pollClose: pair("view", "feed"),

  // ── Sáng kiến 045–046 · Vinh danh 047–048 (`S16-SOCIAL-BE-2B-2`) ──
  //
  // Cả bốn `tier1IsFloor = false` — không route nào trong cụm này có bảng ánh xạ payload→cặp (đẳng
  // thức `D17` của census: tập cờ BẰNG ĐÚNG tập route CÓ bảng như thế, và hôm nay đó là `002` +
  // `006`). Ba route đọc thừa hưởng phạm vi BÀI CHA qua `visiblePostCondition`, không có cặp đọc
  // riêng.
  //
  // 🔴 `046` là route DUY NHẤT của module gác bằng một cặp `approve:*`, và cũng là chỗ duy nhất
  // decorator KHÔNG phải `view:feed`. Nó vẫn `tier1IsFloor = false` vì cặp `approve:feed-idea` ĐÚNG
  // là cặp gác route — tầng 2 (`resolveActor`) chỉ hỏi LẠI chính cặp đó, chứ không hỏi một cặp KHÁC.
  // Nó cũng là route DUY NHẤT mang `denyMessage` — xem docblock của field đó, và assert ghim tập
  // «route có `denyMessage`» ở `social-two-layer-guard-census.unit-spec.ts`.
  /** 045 `GET /social/ideas` — danh sách sáng kiến thấy được; lọc `status`; OFFSET. */
  ideaList: pair("view", "feed"),
  /**
   * 046 `PATCH …/idea/review` — xét duyệt (FSM 3 cạnh); audit LUÔN + NOTI-032 cho tác giả.
   *
   * Route DUY NHẤT của module mang `denyMessage`: SPEC-16 §12 có mã riêng (`SOCIAL-ERR-020`) cho ca
   * thiếu quyền xét duyệt. Xem docblock của field đó.
   */
  ideaReview: { ...pair("approve", "feed-idea"), denyMessage: SOCIAL_ERR.IDEA_APPROVE_REQUIRED },
  /** 047 `GET /social/kudos` — vinh danh gần đây / theo tháng; OFFSET. */
  kudosList: pair("view", "feed"),
  /** 048 `GET /social/kudos-badges` — catalog huy hiệu ĐANG BẬT; OFFSET. */
  kudosBadgeList: pair("view", "feed"),

  // ── Cửa đăng ký tệp đính kèm 054–055 (`S16-SOCIAL-BE-1C`) ──
  //
  // 🔴 HAI ROUTE DUY NHẤT NGOÀI `002`/`006` mang `tier1IsFloor: true`, và chúng thoả ĐÚNG định nghĩa
  // HẸP của cờ: cặp quyền thật sự đòi PHỤ THUỘC NỘI DUNG REQUEST (`target`), vì
  // `SocialFileResolver.canLinkFile` hỏi `create:feed-post` cho `feed_post` và `create:feed-comment`
  // cho `feed_comment` (vế 6a) — hai cặp KHÁC NHAU mà `@RequirePermission` không khai nổi cùng lúc.
  // Bảng cặp-theo-payload của chúng: `SOCIAL_FILE_TARGET_PAIRS` (nguồn độc lập của đẳng thức D17).
  //
  // ⚠️ SÀN `view:feed` LÀ SÀN THẬT, KHÔNG PHẢI CHỖ ĐỂ TRỐNG: `canLinkFile` cũng đòi đúng cặp đó ở vế
  // `readScope` (`social-file.resolver.ts:141-147`). Ai không đọc được bảng tin thì không gắn được
  // tệp vào nó — hạ decorator xuống `@Public` hay bỏ guard là tháo tầng-1 của một đường GHI.
  /** 054 `POST /social/files/upload-url` — SÀN; `target` quyết định cặp `create` ở tầng 2 (D1). */
  fileUploadUrl: pair("view", "feed", true),
  /** 055 `POST /social/files/{id}/confirm` — SÀN; cùng luật `target` (D1), + owner-check ở service. */
  fileConfirm: pair("view", "feed", true),
} as const satisfies Record<string, SocialPair>;

export type SocialRouteKey = keyof typeof SOCIAL_ROUTE_PAIRS;

/**
 * D4 — cặp quyền BẮT BUỘC THEO `type` ở `SOCIAL-API-002` (API-19 §5.1b).
 *
 * Bảng này là vế tầng-2 của `postCreate.tier1IsFloor`. Từ BE-2B-2 nó phủ **cả 5 loại bài** mà
 * `feedCreatableTypeSchema` chấp nhận — không còn loại nào "Zod từ chối trước khi chạm bảng".
 *
 * `share` ánh xạ về CHÍNH cặp sàn (không cặp phụ) — ghi tường minh `null` thay vì bỏ trống để census
 * phân biệt "loại này không cần cặp phụ" với "quên khai loại này".
 *
 * ┌─ 🔴 D2a — GHÉP VỚI ENUM ZOD Ở TẦNG KIỂU (S16-SOCIAL-BE-2B-2) ──────────────────────────────────┐
 * │ `satisfies Record<FeedCreatableTypeDto, …>` thay cho `Record<string, …>`. Đây không phải chuyện │
 * │ gọn gàng mà là bịt một lỗ CÓ THẬT: trước bản này, `Record<string, …>` cho phép enum Zod mở thêm │
 * │ một giá trị mà bảng KHÔNG có khoá tương ứng, và hậu quả là `SOCIAL_POST_TYPE_PAIRS[type]` trả   │
 * │ `undefined` → `assertCreatablePostType` so `=== null` KHÔNG khớp → đọc `DENIED[type]` cũng      │
 * │ `undefined` → ném `SOCIAL_POST_TYPE_PAIR_DESYNC` (fail-closed, may mắn) — nhưng chỉ phát hiện   │
 * │ LÚC CHẠY, trên đúng một route ghi, bằng một 403 nói sai lý do.                                  │
 * │                                                                                                 │
 * │ Với `Record<FeedCreatableTypeDto, …>`, mở enum mà quên bảng là **TS đỏ lúc build**. Phép đo bổ  │
 * │ sung ở tầng dữ liệu: `social-post-type-pairs-structure.spec.ts` (**C-6**) so TẬP khoá của hai   │
 * │ bảng với `feedCreatableTypeSchema.options` — bắt cả chiều ngược (bảng có khoá lạ mà enum không   │
 * │ có), điều `satisfies` một mình không bắt.                                                       │
 * │                                                                                                 │
 * │ ⚠️ Lý do lưới cũ (`done_when` #8 của backlog: «mỗi cặp non-null xuất hiện ĐÚNG MỘT LẦN dưới     │
 * │ dạng literal trong `social-posts.service.ts`») bị THAY: BE-2B-1 đã dời hết cặp vào bảng này ⇒   │
 * │ phép đếm literal = 0 trong khi assert đòi = 1 ⇒ **đỏ vĩnh viễn**, và cách "sửa" duy nhất là nhét│
 * │ literal trở lại = dựng nguồn sự thật thứ hai. Owner ký **S7** ngày 24/09/2026.                  │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
export const SOCIAL_POST_TYPE_PAIRS = {
  share: null,
  news: { action: "manage", resourceType: "feed-news", isSensitive: false },
  /** S16-SOCIAL-BE-2B-1 — seed `0578:75-86` cấp `create:feed-poll` @Company cho cả 4 vai canonical. */
  poll: { action: "create", resourceType: "feed-poll", isSensitive: false },
  /**
   * S16-SOCIAL-BE-2B-2 — seed `0578:45,79-86` cấp `create:feed-idea` @Company cho cả 4 vai canonical
   * ⇒ **không vai chuẩn nào dựng được ca DENY**. Ca đó dựng bằng VAI TUỲ BIẾN của chính int-spec
   * (`makeUser(label, hash, ["view:feed","create:feed-post"])`), KHÔNG bằng cách sửa
   * `role_permissions` của vai canonical — sửa vai canonical là đóng dấu lên lane DB dùng chung.
   */
  idea: { action: "create", resourceType: "feed-idea", isSensitive: false },
  /** S16-SOCIAL-BE-2B-2 — như `idea`. `isOfficial:true` còn đòi THÊM `manage:feed-kudos`, xem `SOCIAL_KUDOS_FLAG_PAIRS`. */
  kudos: { action: "create", resourceType: "feed-kudos", isSensitive: false },
} as const satisfies Record<
  FeedCreatableTypeDto,
  { action: string; resourceType: string; isSensitive: boolean } | null
>;

export type SocialCreatablePostType = keyof typeof SOCIAL_POST_TYPE_PAIRS;

/**
 * S16-SOCIAL-BE-2B-2 (D22) — cặp quyền của từng CỜ ĐẶC QUYỀN trong payload `type='kudos'`.
 *
 * Tiền lệ: `SOCIAL_MODERATION_FIELD_PAIRS` (cặp theo TỪNG TRƯỜNG của `006`). Hôm nay bảng có đúng
 * một dòng, và một bảng-một-dòng nghe như thừa — nó không thừa:
 *
 * `isOfficial:true` biến một bài ai cũng tạo được thành bài mang DẤU CÔNG TY, và thứ duy nhất phân
 * biệt hai loại đó là một lời gọi `resolveManyOrNull` nằm lẫn trong thân `create()`. Không có bảng
 * này thì cặp đó chỉ được MỘT ca int-spec giữ: xoá dòng gọi đi là mọi census, mọi sổ, mọi ratchet
 * vẫn XANH (không route nào đổi, không cặp nào biến khỏi bảng route). Có bảng thì **C-6** canh được
 * nó ở tầng dữ liệu, độc lập với ca HTTP.
 *
 * ⚠️ **KHÔNG** đưa bảng này vào nguồn độc lập của đẳng thức `tier1IsFloor` (census): `002` đã
 * `tier1IsFloor:true` sẵn vì `SOCIAL_POST_TYPE_PAIRS`, thêm một nguồn thứ hai cho cùng route sẽ làm
 * đẳng thức đó đỏ oan.
 */
export const SOCIAL_KUDOS_FLAG_PAIRS = {
  isOfficial: { action: "manage", resourceType: "feed-kudos", isSensitive: false },
} as const satisfies Record<string, { action: string; resourceType: string; isSensitive: boolean }>;

export type SocialKudosFlag = keyof typeof SOCIAL_KUDOS_FLAG_PAIRS;

/**
 * S16-SOCIAL-BE-1C (D1) — cặp quyền theo `target` của cửa đăng ký tệp (`054`/`055`).
 *
 * ┌─ VÌ SAO BẢNG NÀY PHẢI TỒN TẠI, THAY VÌ MỘT CẶP TĨNH TRÊN DECORATOR ────────────────────────────┐
 * │ `SocialFileResolver.canLinkFile` hỏi `create:feed-post` khi `entity_type='feed_post'` và          │
 * │ `create:feed-comment` khi `='feed_comment'`. `@RequirePermission` khai được ĐÚNG MỘT cặp tĩnh.    │
 * │ Chọn bừa một trong hai ⇒ vai tuỳ biến giữ cặp KIA bị 403 ngay ở cửa: viết được bình luận bằng     │
 * │ chữ mà không đính kèm nổi một tấm ảnh vào chính nó. Đó ĐÚNG là lớp lỗi mà jsdoc                   │
 * │ `ChatFilesController` gọi tên ("tải lên được mà gắn không được"); CHAT không gặp vì nó chỉ có một │
 * │ cặp (`send:chat-message`) cho cả luồng.                                                           │
 * │                                                                                                   │
 * │ ĐO THẬT (`0578:67-74`): hôm nay cả 4 vai canonical giữ CẢ HAI cặp ⇒ tác động lên vai canonical    │
 * │ = 0. Nhưng grant là **per-(permission, role)** và sửa được lúc chạy, nên vai lệch một cặp là dựng │
 * │ được — `social-be1c-file-door.int-spec.ts` dựng đúng hai vai đó (ca D1/A4 và D2/A5).              │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `satisfies Record<FeedTargetTypeDto, …>` (khuôn D2a của `SOCIAL_POST_TYPE_PAIRS`): mở thêm một giá
 * trị `target` mà quên khai ở đây là **TS đỏ lúc build**, không phải một `undefined` chỉ lộ ra lúc
 * chạy trên đúng một route ghi. Neo vào enum của **contracts** (`FeedTargetTypeDto`) chứ KHÔNG vào
 * `SocialTargetType` của `social.types.ts`: file kia đã import `SocialRouteKey` TỪ ĐÂY, nên neo
 * ngược lại là dựng một chu trình — đúng thứ dòng đầu file vừa dọn xong. Enum contracts cũng là thứ
 * đi trên dây, nên neo vào nó chặt hơn. Chiều ngược (bảng có khoá lạ) do
 * `social-file-target-pairs-structure.spec.ts` đo ở tầng DỮ LIỆU, độc lập với TS.
 *
 * ⚠️ **KHÔNG cặp nào ở đây là cặp MỚI**: cả hai đã có trong catalog từ seed `0578:42-43`. WO này
 * không thêm cặp quyền, không migration.
 *
 * 🔴 Bảng này là cổng DUY NHẤT ép được phân biệt post-vs-comment trên đường tệp, và ở cửa `054`/`055`
 * nó ép bằng giá trị CLIENT TỰ KHAI. Điều đó chấp nhận được vì cặp `create` của ĐÍCH THẬT được ép ở
 * đường GHI, **KHÔNG** bởi `canLinkFile` (hàm đó chỉ chạy trên route FOUNDATION): tầng-1 ở `002`/`015`,
 * và tham số `gate` của `syncLinksTx` ở `004`/`016` — cùng bảng này, qua
 * `SocialAccessService.resolveAttachNewGate` (S16-SOCIAL-ATTGATE-1).
 */
export const SOCIAL_FILE_TARGET_PAIRS = {
  post: { action: "create", resourceType: "feed-post", isSensitive: false },
  comment: { action: "create", resourceType: "feed-comment", isSensitive: false },
} as const satisfies Record<
  FeedTargetTypeDto,
  { action: string; resourceType: string; isSensitive: boolean }
>;

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

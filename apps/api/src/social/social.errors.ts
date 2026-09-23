/**
 * S16-SOCIAL-BE-1 — mã lỗi SOCIAL (SPEC-16 §12, quy ước SPEC-01 §9 `MODULE-ERR-XXX`).
 *
 * MỘT CHỖ duy nhất định nghĩa thông điệp ⇒ int-spec assert theo MÃ, không theo câu chữ.
 *
 * ┌─ `POST_NOT_FOUND` / `COMMENT_NOT_FOUND` LÀ HẰNG, KHÔNG PHẢI HÀM ───────────────────────────────┐
 * │ Mọi lý do "không đọc được bài" — không tồn tại · tenant khác · đã xoá mềm · `hidden` mà mình     │
 * │ không phải tác giả · `audience='org_unit'` của đơn vị khác — PHẢI trả về CHUỖI GIỐNG HỆT NHAU.  │
 * │ Thêm chi tiết, dù chỉ là `postId`, là biến 404 thành oracle dò đúng thứ `SOCIAL-ERR-001` dựng    │
 * │ lên để chặn (SPEC-16 §12 «404 trước 403», khuôn `CHAT_ERR.ROOM_NOT_FOUND`).                     │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ `SOCIAL-ERR-002` (403) **CHỈ dùng cho nhánh GHI** — đăng bài/bình luận vào `org_unit`/`group` mà
 * actor tự chọn nhưng không thuộc. Nhánh ĐỌC KHÔNG BAO GIỜ trả mã này (403 ở nhánh đọc xác nhận đối
 * tượng có thật ⇒ rò sự tồn tại). SPEC-16 §12 ghi thẳng luật này dưới bảng mã.
 *
 * ⚠️ `SOCIAL-ERR-009` KHÔNG phải lỗi HTTP: mention ngoài audience bị bỏ im lặng, request vẫn 201 và
 * danh sách bị bỏ trả ở `data.droppedMentions[]`. Hằng dưới đây chỉ để log/tài liệu — KHÔNG được ném.
 *
 * 22 mã của catalog SOCIAL: `001..010` dùng ở Nhóm A (WO này); `011`,`021` thuộc `S16-SOCIAL-BE-1B`;
 * `012..020`,`022` thuộc `S16-SOCIAL-BE-2`. Khai đủ ở đây để BE-1B/BE-2 không đẻ bảng mã thứ hai.
 *
 * Sau khi `S16-SOCIAL-BE-2` tách ba (23/09/2026): `012..015` = BE-2A (nhóm, đã ship) ·
 * **`016..018` = BE-2B-1 (bình chọn, WO hiện tại)** · `019`,`020`,`022` = BE-2B-2 (sáng kiến ·
 * vinh danh). ⚠️ «ĐÃ DÙNG HẾT» trong hai docblock dưới nghĩa là **không còn số TRỐNG cho ca MỚI**
 * ngoài danh sách SPEC-16 §12 — KHÔNG có nghĩa là WO sau phải bịa hằng không-số cho nhánh chính
 * của nó. Ca nào SPEC-16 §12 ĐÃ định nghĩa thì dùng đúng số của nó.
 */
export const SOCIAL_ERR = {
  /**
   * `SOCIAL-ERR-001` (404) — bài lạ. KHÔNG phân biệt "không tồn tại" · "đã xoá mềm" · "hidden mà
   * mình không phải tác giả" · "org_unit khác". Một chuỗi cho mọi lý do.
   */
  POST_NOT_FOUND: "SOCIAL-ERR-001: không tìm thấy bài viết.",

  /** `SOCIAL-ERR-001` — cùng luật, trục BÌNH LUẬN (bình luận lạ, hoặc bài chứa nó không thấy được). */
  COMMENT_NOT_FOUND: "SOCIAL-ERR-001: không tìm thấy bình luận.",

  /**
   * `SOCIAL-ERR-002` (403) — CHỈ NHÁNH GHI: đăng vào đơn vị/nhóm mình không thuộc. Actor tự chọn đích
   * nên đã biết nó tồn tại ⇒ 403 không rò gì thêm.
   */
  WRITE_OUT_OF_AUDIENCE:
    "SOCIAL-ERR-002: không đăng được vào đơn vị hoặc nhóm mà bạn không thuộc về.",

  /** `SOCIAL-ERR-003` (403) — sửa/xoá nội dung của người khác mà không có `manage:feed-post`. */
  NOT_CONTENT_OWNER:
    "SOCIAL-ERR-003: chỉ tác giả hoặc người có quyền quản lý bài viết mới sửa/xoá được nội dung này.",

  /** `SOCIAL-ERR-004` (409) — bài đã khoá bình luận. */
  COMMENTS_LOCKED: "SOCIAL-ERR-004: bài viết này đã khoá bình luận.",

  /** `SOCIAL-ERR-005` (422) — trả lời quá 1 cấp (SPEC-16 §13.2). */
  REPLY_DEPTH: "SOCIAL-ERR-005: chỉ trả lời được vào bình luận gốc (tối đa 1 cấp).",

  /** `SOCIAL-ERR-006` (422) — emoji ngoài bộ dùng chung với CHAT. */
  REACTION_EMOJI_INVALID: "SOCIAL-ERR-006: biểu tượng cảm xúc không nằm trong bộ cho phép.",

  /** `SOCIAL-ERR-007` (422) — vượt giới hạn đính kèm SPEC-16 §16. */
  ATTACHMENT_LIMIT:
    "SOCIAL-ERR-007: đính kèm vượt giới hạn — tối đa 10 ảnh, 1 video, mỗi tệp không quá 20MB.",

  /** `SOCIAL-ERR-007` — tệp không hợp lệ: không tồn tại, của tenant khác, hoặc không phải bạn tải lên. */
  ATTACHMENT_INVALID:
    "SOCIAL-ERR-007: tệp đính kèm không hợp lệ — chỉ đính kèm được tệp do chính bạn tải lên.",

  /** `SOCIAL-ERR-008` (422) — audience thiếu khoá kéo theo. */
  AUDIENCE_KEY_MISSING: "SOCIAL-ERR-008: phạm vi hiển thị thiếu khoá tương ứng (đơn vị hoặc nhóm).",

  /**
   * `SOCIAL-ERR-008` (422) — `audience='group'` CHƯA MỞ ở BE-1 (plan §2 D1, owner chốt 21/09/2026).
   *
   * Từ chối tường minh thay vì im lặng bỏ qua: `feed_groups` chưa có route tạo nhóm nào nên bộ lọc
   * EXISTS membership không test được thật, và một nhánh "coi như company" sẽ phát bài đáng lẽ riêng
   * tư ra cả công ty.
   */
  AUDIENCE_GROUP_NOT_AVAILABLE:
    "SOCIAL-ERR-008: đăng bài vào nhóm chưa khả dụng — tính năng nhóm sẽ mở ở bản cập nhật sau.",

  /**
   * `SOCIAL-ERR-009` — **KHÔNG BAO GIỜ NÉM.** Giữ chỗ để census mã lỗi không báo thiếu, và để ai đọc
   * file này thấy ngay rằng mention-bị-bỏ là kết quả 201 kèm `droppedMentions[]`, không phải lỗi.
   */
  MENTION_DROPPED_NOT_AN_ERROR:
    "SOCIAL-ERR-009: (không phải lỗi) một số lượt nhắc tên bị bỏ vì người được nhắc ngoài phạm vi hiển thị.",

  /** `SOCIAL-ERR-010` (403) — tạo/ghim tin tức mà không có `manage:feed-news`. */
  NEWS_MANAGE_REQUIRED:
    "SOCIAL-ERR-010: cần quyền quản lý tin tức để đăng hoặc ghim tin tức công ty.",

  /** `SOCIAL-ERR-010` (403) — đổi trường kiểm duyệt cụ thể mà thiếu cặp quyền của TRƯỜNG đó. */
  MODERATION_FIELD_DENIED: "SOCIAL-ERR-010: bạn không có quyền thay đổi trường kiểm duyệt này.",

  // ── Nhóm B (`S16-SOCIAL-BE-1B`) ──
  /** `SOCIAL-ERR-011` (409) — xác nhận đã đọc một bài không phải tin tức / không bật yêu cầu ack. */
  ACK_NOT_APPLICABLE: "SOCIAL-ERR-011: bài viết này không yêu cầu xác nhận đã đọc.",
  /** `SOCIAL-ERR-021` (409) — xử lý một báo cáo đã kết thúc. */
  REPORT_ALREADY_DECIDED: "SOCIAL-ERR-021: báo cáo này đã được xử lý.",

  /**
   * `SOCIAL-ERR-001` — cùng luật 404-cho-mọi-lý-do, trục BÁO CÁO: báo cáo không tồn tại · tenant khác
   * · ngoài phạm vi Department của actor. Một chuỗi cho mọi lý do.
   */
  REPORT_NOT_FOUND: "SOCIAL-ERR-001: không tìm thấy báo cáo.",

  /**
   * (409) — **KHÔNG SỐ HOÁ** (D5, cần chữ ký owner ở PR). Báo cáo trùng khi cái cũ còn `open`.
   *
   * ┌─ VÌ SAO KHÔNG CÓ MÃ `SOCIAL-ERR-0XX` ────────────────────────────────────────────────────────┐
   * │ Catalog SOCIAL của SPEC-16 §12 đóng ở `001..022` và ĐÃ DÙNG HẾT; §12 im lặng hoàn toàn về ca  │
   * │ này (quét đủ 22 mã). Bịa thêm một số là sửa SPEC không có chữ ký. Hằng CÓ TÊN dưới đây đủ để   │
   * │ int-spec assert theo HẰNG chứ không theo câu chữ tự do — thứ duy nhất mã số mang lại ở đây.    │
   * │ Nếu owner muốn số hoá sau: thêm dòng SPEC-16 §12 rồi đổi hằng này, một chỗ.                    │
   * └───────────────────────────────────────────────────────────────────────────────────────────────┘
   */
  REPORT_DUPLICATE_OPEN: "SOCIAL-ERR: bạn đã báo cáo nội dung này và báo cáo đó đang chờ xử lý.",

  // ─────────────── S16-SOCIAL-BE-2A — NHÓM (`012..015`) ───────────────

  /**
   * `SOCIAL-ERR-012` (404) — nhóm lạ. KHÔNG phân biệt "không tồn tại" · tenant khác · **đã xoá mềm**
   * (D13) · `private` mà actor không phải thành viên `active`. Một chuỗi cho mọi lý do: phân biệt
   * được tức là xác nhận một nhóm kín CÓ TỒN TẠI.
   */
  GROUP_NOT_FOUND: "SOCIAL-ERR-012: không tìm thấy nhóm.",

  /** `SOCIAL-ERR-013` (409) — đã là thành viên, hoặc đã có yêu cầu vào nhóm đang chờ duyệt. */
  GROUP_MEMBERSHIP_EXISTS: "SOCIAL-ERR-013: bạn đã tham gia hoặc đã gửi yêu cầu vào nhóm này.",

  /**
   * `SOCIAL-ERR-013` (409) — dạng body của `038` KHÔNG khớp trạng thái hàng (M-d): gửi
   * `{role:…}` lên một hàng `pending`, hoặc `{decision:…}` lên một hàng `active`.
   *
   * ⚠️ Vì sao phải bắt ở SERVICE chứ không để DB nói: `chk_feed_group_members_pending_role`
   * (`status='active' OR role='member'`) sẽ ném `23514` ⇒ **500** cho một thao tác quản trị hoàn
   * toàn bình thường (bấm "đổi vai trò" trên đúng hàng đang chờ duyệt).
   */
  GROUP_MEMBER_STATE_MISMATCH:
    "SOCIAL-ERR-013: thao tác không khớp trạng thái của thành viên này (chờ duyệt cần duyệt/từ chối, đang hoạt động mới đổi được vai trò).",

  /**
   * `SOCIAL-ERR-014` (403) — vai trò trong nhóm không đủ.
   *
   * 🔴 **NGHĨA ĐÃ NỚI so với SPEC-16 §12** (D-OWNER-8, owner ký 22/09/2026): §12 viết hẹp "duyệt
   * thành viên / đổi vai trò", còn ở đây dùng cho MỌI 403 vai-trò-nhóm — `033` sửa nhóm · `034` xoá
   * nhóm (owner-ONLY) · `038` · `039`. SPEC-16 §12 được sửa trong CÙNG PR, không để docs trôi.
   */
  GROUP_ROLE_REQUIRED: "SOCIAL-ERR-014: bạn không có quyền thực hiện thao tác này trong nhóm.",

  /**
   * `SOCIAL-ERR-015` (409) — thao tác sẽ làm nhóm **mất owner ACTIVE cuối cùng**.
   *
   * 🔴 **NGHĨA ĐÃ NỚI** (D-OWNER-8): §12 viết hẹp "rời nhóm khi là owner cuối", nhưng bất biến phải
   * ép ở CẢ BA đường mất owner — `036` rời · `038` hạ vai trò owner cuối · `039` mời owner cuối ra.
   * Thiếu một đường là nhóm rơi về **0 owner và khoá vĩnh viễn** (chỉ `manage:feed-group` gỡ được).
   * ⚠️ `034` xoá nhóm KHÔNG thuộc bất biến này (H7) — nó là luật AUTHORIZATION, không phải luật đếm.
   */
  GROUP_LAST_OWNER: "SOCIAL-ERR-015: nhóm phải còn ít nhất một chủ nhóm đang hoạt động.",

  /**
   * (409) — **KHÔNG SỐ HOÁ**, cùng lý do và cùng tiền lệ với `REPORT_DUPLICATE_OPEN` ở trên: catalog
   * SPEC-16 §12 đóng ở `001..022` và **đã dùng hết** (`022` = huy hiệu, thuộc BE-2B). Bịa thêm số là
   * sửa SPEC không chữ ký; D-OWNER-8 chỉ cho nới nghĩa `014`/`015`, không cấp mã mới.
   *
   * Ca thật (W1, plan-reviewer vòng 3): `feed_groups_company_name_uq` là **partial unique**
   * `(company_id, lower(name)) WHERE deleted_at IS NULL` ⇒ `031` tạo trùng tên và `033` đổi sang tên
   * trùng ném `23505` mà trước đây không call-site nào dịch ⇒ **500** cho thao tác bình thường.
   * Trùng tên với một nhóm ĐÃ xoá mềm thì KHÔNG đụng index (partial) ⇒ vẫn tạo được.
   */
  GROUP_NAME_TAKEN: "SOCIAL-ERR: tên nhóm này đã được dùng trong công ty.",

  /**
   * (404) — **KHÔNG SỐ HOÁ** (cùng tiền lệ `REPORT_DUPLICATE_OPEN`/`GROUP_NAME_TAKEN`): không có
   * hàng `feed_group_members` cho `{user_id}` trong nhóm này — `036` rời một nhóm chưa tham gia,
   * `038`/`039` thao tác lên một người không phải thành viên (hoặc ai đó vừa mời họ ra).
   *
   * ⚠️ TÁCH KHỎI `GROUP_NOT_FOUND` có chủ ý: tới được đây thì actor ĐÃ qua cổng nhóm (`032` thấy
   * được nhóm, `038`/`039` còn phải là `owner|admin`), nên nói đúng cái thiếu KHÔNG lộ gì thêm —
   * trong khi trả "không tìm thấy nhóm" cho một nhóm người dùng đang mở là gửi họ đi sai hướng.
   */
  GROUP_MEMBER_NOT_FOUND: "SOCIAL-ERR: người này không phải thành viên của nhóm.",

  // ─────────────── S16-SOCIAL-BE-2B-1 — BÌNH CHỌN (`016..018`) ───────────────

  /**
   * `SOCIAL-ERR-016` (409) — bình chọn KHÔNG còn nhận phiếu. MỘT chuỗi cho HAI nguyên nhân:
   * `status='closed'` (đóng tay qua `044` hoặc job) **và** `closes_at` đã qua trong khi hàng vẫn
   * `open` (job chưa chạy tới). Người dùng không phân biệt được hai cái đó và cũng không cần.
   *
   * ⚠️ Hai nhánh ấy phải có **HAI ca test RIÊNG** (P-1 · P-2): gộp làm một thì bỏ hẳn một nhánh
   * kiểm tra mà ca vẫn xanh.
   */
  POLL_CLOSED: "SOCIAL-ERR-016: bình chọn đã kết thúc.",

  /**
   * `SOCIAL-ERR-017` (409) — đã bỏ phiếu rồi, ở một bình chọn CHỈ CHO CHỌN MỘT.
   *
   * 🔴 Ném từ HAI nguồn khác nhau, phải dịch CẢ HAI (plan §2 D5b):
   *   1. `feed_poll_votes_single_uq` — partial unique `(company, poll, user) WHERE single_choice`:
   *      hai lượt bỏ phiếu cho HAI option KHÁC nhau đua nhau.
   *   2. `feed_poll_votes_pk` — PK `(company, poll, option, user)`: hai lượt cho CÙNG một option.
   *
   * Chỉ dịch (1) là lỗi đã suýt ship: lượt thua của ca đua «cùng option» rơi xuống `23505` không ai
   * dịch ⇒ **500** cho người dùng, trong khi ca đua vẫn XANH vì trạng thái cuối vẫn đúng
   * (1 phiếu, Σ khớp). Ca `P-5a` assert `statuses.every(s => s < 500)` chính là để bắt nhánh này.
   */
  POLL_VOTE_DUPLICATE: "SOCIAL-ERR-017: bạn đã bỏ phiếu cho bình chọn này.",

  /**
   * `SOCIAL-ERR-018` (422) — số lựa chọn ngoài khoảng 2–10.
   *
   * 🔴 ÉP Ở SERVICE, **KHÔNG** ở Zod. Zod từ chối thì NestJS trả **400 vô danh** và mã SPEC này
   * không bao giờ được ném ra — luật viết sẵn ở `packages/contracts/src/social-api.ts:309-310`.
   * Ai thêm `.min(2).max(10)` vào schema sẽ làm ca `P-7b` (422) CHẾT ÂM THẦM: nó chuyển thành 400
   * và assert theo MÃ sẽ đỏ, nhưng assert theo status trần thì vẫn xanh.
   *
   * Vắng HẲN trường `options` là chuyện khác (hình dạng sai) ⇒ 400 của Zod là ĐÚNG — ca `P-7a`.
   */
  POLL_OPTIONS_RANGE: "SOCIAL-ERR-018: bình chọn phải có từ 2 đến 10 lựa chọn.",

  /**
   * (404) — **KHÔNG SỐ HOÁ** (cùng tiền lệ `REPORT_DUPLICATE_OPEN`/`GROUP_NAME_TAKEN`): SPEC-16 §12
   * im lặng về ca này. `optionId` gửi lên không thuộc `pollId` của bài đang thao tác.
   *
   * 🔴 Đây là nợ (e) của DB-2: `feed_poll_votes` có HAI FK RỜI — `(company, poll)` và
   * `(company, option)` — **không cái nào** ràng option THUỘC poll. Gửi chéo poll thì INSERT vẫn
   * thành công, phiếu rơi vào poll người khác và `vote_count` của nó lệch VĨNH VIỄN. Lệch dương
   * không ném gì cả: không lỗi, không log, chỉ là kết quả bình chọn sai.
   *
   * 404 (không phải 422): option của một poll khác là đối tượng mà actor **không được biết là có
   * tồn tại** — cùng luật 404-cho-mọi-lý-do của `POST_NOT_FOUND`.
   */
  POLL_OPTION_NOT_FOUND: "SOCIAL-ERR: không tìm thấy lựa chọn của bình chọn này.",

  /**
   * (422) — **KHÔNG SỐ HOÁ** (SPEC-16 §12 im lặng). Hạn đóng bình chọn nằm trong quá khứ.
   *
   * 🔴 Phát hiện lúc THI CÔNG, plan không liệt: `chk_feed_polls_closes_future` là
   * `closes_at IS NULL OR closes_at > created_at`, mà `created_at` do DB sinh ⇒ Zod **không thể**
   * ép luật này (nó không biết `created_at`), và nếu service không kiểm thì một mốc quá khứ đi
   * thẳng xuống CHECK ⇒ `23514` ⇒ **500** cho một sai sót nhập liệu hoàn toàn bình thường.
   *
   * Kiểm ở service so với `now()`, KHÔNG so với `created_at`: hai mốc chênh nhau vài mili-giây và
   * người dùng nghĩ theo đồng hồ của họ, không theo thời điểm INSERT.
   */
  POLL_CLOSES_AT_PAST: "SOCIAL-ERR: hạn kết thúc bình chọn phải ở tương lai.",
} as const;

export type SocialErrorMessage = (typeof SOCIAL_ERR)[keyof typeof SOCIAL_ERR];

/** Tên constraint DB mà SOCIAL DỊCH thành mã lỗi nghiệp vụ — nguồn sự thật một chỗ (D5). */
export const SOCIAL_CONSTRAINT = {
  /** Partial UNIQUE INDEX `(company_id, target_type, target_id, reporter_user_id) WHERE status='open'`. */
  REPORT_OPEN_UQ: "feed_reports_open_uq",
  /** PK tổ hợp `(company_id, group_id, user_id)` của `feed_group_members` — xin vào nhóm lần hai. */
  GROUP_MEMBER_PK: "feed_group_members_pk",
  /** Partial UNIQUE INDEX `(company_id, lower(name)) WHERE deleted_at IS NULL` của `feed_groups` (W1). */
  GROUP_NAME_UQ: "feed_groups_company_name_uq",

  /**
   * Partial UNIQUE `(company_id, poll_id, user_id) WHERE single_choice` của `feed_poll_votes` —
   * chốt chống phiếu-đôi ở bình chọn MỘT-LỰA-CHỌN. Hai option KHÁC nhau, cùng người, đua nhau.
   */
  POLL_VOTE_SINGLE_UQ: "feed_poll_votes_single_uq",

  /**
   * 🔴 PK `(company_id, poll_id, option_id, user_id)` của `feed_poll_votes` — CÙNG một option, cùng
   * người, hai lượt đua nhau. **Nhánh thứ hai** của `POLL_VOTE_DUPLICATE`.
   *
   * Bỏ sót hằng này là lỗi fail-quiet đã được `plan-reviewer` chặn trước khi code: ca đua vẫn XANH
   * (trạng thái cuối đúng) trong khi lượt thua trả **500 chưa dịch** cho người dùng.
   */
  POLL_VOTE_PK: "feed_poll_votes_pk",
} as const;

/**
 * Bóc lỗi Postgres THẬT ra khỏi vỏ của drizzle (khuôn `assets.errors.ts#pgErrorOf`, đã hỏng thật một
 * lần ở CHAT): `drizzle-orm` bọc lỗi driver trong `DrizzleQueryError` ⇒ `err.code` ở lớp NGOÀI là
 * `undefined`, mã `23505` nằm dưới `err.cause`. Đi theo chuỗi `cause` có cận trên 5 tầng (chuỗi tự
 * tham chiếu sẽ treo).
 *
 * Bản sao CỤC BỘ thay vì import từ `assets/`: một cạnh phụ thuộc SOCIAL → ASSET chỉ để dùng 8 dòng
 * tiện ích là ràng hai module không liên quan vào nhau.
 */
export function socialPgErrorOf(err: unknown): { code?: unknown; constraint?: unknown } | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur; depth += 1) {
    const e = cur as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string") return e;
    cur = e.cause;
  }
  return null;
}

/**
 * `true` ⇔ lỗi là vi phạm UNIQUE của ĐÚNG constraint `name`.
 *
 * ⚠️ Khớp theo **TÊN CONSTRAINT**, KHÔNG theo mã `23505` trần: `feed_reports` còn
 * `feed_reports_company_id_id_uq` (ống nước FK composite) cũng ném `23505`, và nuốt mọi `23505` thành
 * "báo cáo trùng" là dịch SAI nguyên nhân rồi làm lỗi thật biến mất khỏi log điều tra.
 */
export function isUniqueViolationOf(err: unknown, name: string): boolean {
  const e = socialPgErrorOf(err);
  return !!e && e.code === "23505" && e.constraint === name;
}

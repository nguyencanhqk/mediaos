# S16-SOCIAL-BE-1D — Trả mảng mention trong DTO bài & bình luận (lọc theo tầm nhìn)

> Zone: 🟡 yellow · **Gate: FULL** (security-reviewer + database-reviewer + silent-failure-hunter — bắt buộc vì nâng trần `BASIS_CEILINGS`, xem §5) · Nhánh `feat/s16-social-be-1d`
> Plan-review lượt 1 (28/09): BLOCK 5 + nên-sửa 6 → đã vá ở lượt 2 (đánh dấu `[PR1-#]`). Lượt 2: BLOCK 2 + nên-sửa 4 → vá ở lượt 3 (`[PR2-#]`).
> Nguồn: nợ D5/N9/O-1 của `docs/plans/S16-SOCIAL-FE-1.md` · SPEC-16 §12 `SOCIAL-ERR-009` · API-19 §6.1
> Owner chốt 28/09/2026 (hai câu hỏi ở phiên mở WO): **O-1 = «X còn trong audience»** · **O-2 = `{employeeId,label} | {withheld:true}`, KHÔNG `userId`**.

## 1. Vấn đề

`feed_mentions` đã được BE-1 GHI (để bắn NOTI-028) nhưng chưa bao giờ được ĐỌC ra DTO. FE-1 vì thế render
`@Tên` thành span. WO này thêm đường ĐỌC — và câu hỏi thật là **tầm nhìn**, không phải thêm trường: trả nguyên
mảng là mở lại oracle dò danh bạ mà `ERR-009` đóng (`userId → tên`), ở cửa đọc thay vì cửa ghi.

## 2. Quyết định

| # | Quyết định | Lý do | Phương án loại |
|---|---|---|---|
| D1 | **Luật tầm nhìn = «X VẪN trong audience của bài đích, tại thời điểm ĐỌC»** — tái đánh giá bằng CHÍNH vị từ `resolveMentions` dùng lúc ghi (users `active` + chưa xoá; `company` ⇒ mọi người; `org_unit` ⇒ `employee_profiles.org_unit_id` = đơn vị bài HOẶC `head_user_id` của đơn vị đó; `group` ⇒ thành viên `active` + nhân sự `active` + nhóm chưa xoá mềm). Qua ⇒ phần tử có link; trượt (nghỉ việc, đổi đơn vị, rời nhóm, tài khoản khoá) ⇒ phần tử `withheld` | Owner chọn O-1. Người xem V ĐÃ đọc được bài (mọi đường tới decorate đều qua `visiblePostCondition`/`assertPostVisible`); X trong audience ⇒ X là người cũng đọc được bài đó — tên X không vượt biên nào V chưa có (tên tác giả + link `/feed/profiles/:employeeId` đã hiện cho mọi người giữ `view:feed`, và `025` trả byte-giống khi nhân sự không tồn tại) | ② Thêm vế phụ thuộc scope của V (moderator đọc bài ngoài audience ⇒ rút hết) — owner loại: moderator mất link mà không đóng thêm oracle nào |
| D2 | **Vị từ «trong audience» có MỘT nguồn**: tách phần phân loại của `resolveMentions` thành hàm thuần `classifyInAudience(post, person, heads, groupMembers)` + hai helper nạp theo LÔ (`loadOrgUnitHeads`, `loadActiveGroupMembers`) dùng CHUNG cho đường ghi và đường đọc | Hai bản vị từ trôi khỏi nhau ngay lần đầu có người sửa một bên (lớp lỗi `reused-method-must-be-actor-scoped`). Đường ghi giữ NGUYÊN hành vi. 🔴 `[PR1-2]` **Luật tự-nhắc (`userId === actor.actorUserId` ⇒ bỏ) Ở LẠI đường GHI, NGOÀI `classifyInAudience`**: ở đường đọc «actor» là NGƯỜI XEM — đưa luật đó vào hàm chung là X đọc bài nhắc chính X sẽ nhận `withheld`. 🔴 `[PR1-3]` Tập nạp theo lô khoá theo CẶP `${orgUnitId}:${userId}` / `${groupId}:${userId}` (hiện là `Set<userId>` cho MỘT bài) — khoá theo userId trần là Y thuộc nhóm G1 lọt qua cho bài của G2 cùng trang; `activeGroupMemberExists` nhận CỘT group-id, không nhận vô hướng | Viết vị từ SQL riêng cho đường đọc — hai luật |
| D3 | **DTO**: `feedMentionSchema = z.discriminatedUnion("withheld", [{withheld:false, employeeId:uuid, label:string.min(1)}, {withheld:true}])`. KHÔNG `userId` ở nhánh nào. Nhánh `withheld` KHÔNG mang `label` | Owner chọn O-2. `userId` là khoá tài khoản, không ra ngoài (cùng luật `author` — `social.mapper.ts:16-22`). `label` lấy từ `users.full_name` của DB ⇒ trả nó ở nhánh rút là trả lại đúng thứ đang rút. FE giữ nguyên chữ `@…` trong `body` làm span | `{userId, employeeId, label}` như tiêu đề WO — owner loại (xem §6 R2 về hệ quả với luồng sửa bài) |
| D4 | **Ca biên → `withheld`**: X qua vị từ audience nhưng KHÔNG có `employee_profiles` còn sống, hoặc `full_name` rỗng/NULL ⇒ `withheld` | Link đích là `/feed/profiles/:employeeId` — thiếu `employeeId` thì không có gì để trỏ; nhãn rỗng thì FE không khớp được với chữ trong body. «Rút» là hướng an toàn (thiếu thông tin, không rò) | Trả `employeeId:null` — thêm nhánh thứ ba cho FE mà không phục vụ màn hình nào |
| D5 | **Trường OPTIONAL** trên `feedPostSchema` và `feedCommentSchema` (`mentions: z.array(feedMentionSchema).optional()`) | memory `server-masking-needs-optional-fe-schema`; đường `social-posts-moderation.service.ts:147` dựng DTO riêng (response kiểm duyệt) và KHÔNG cần mention — vắng mặt là hợp lệ | Bắt buộc — buộc mọi nơi dựng DTO (kể cả moderation) phải nạp mention |
| D6 | **WS KHÔNG mang `mentions`**: `wsFeedPostCreatedEventSchema`/`wsFeedCommentCreatedEventSchema` thêm `mentions: true` vào `.omit`, và `emitPostCreated`/`emitCommentCreated` bóc `mentions` tại nguồn (hai hàm đang spread `...rest` — thêm khoá vào DTO REST là tự lọt vào WS nếu không bóc) | Payload phát cho CẢ room; dù với D1 kết quả hiện không phụ thuộc người xem, khoá chiều «theo người xem» ở REST là để giữ cửa đổi luật về sau mà không phải xét lại kênh phát. API-19 §7 KHÔNG đổi. FE nhận thẻ qua WS vẫn render span tới lần refetch — chấp nhận | Phát kèm mentions — mở rộng hợp đồng WS + API-19 §7 cho một cải thiện hiển thị vài giây |
| D7 | **Không N+1**: một bộ nạp `loadMentionsForTargets(tx, companyId, targets)` cho CẢ trang — ≤ 3 câu/trang bất kể số bài. `[PR1-8]` Bài: audience/orgUnitId/groupId lấy từ `PostRow` sẵn có (caller truyền vào), KHÔNG JOIN; bình luận: caller truyền audience của BÀI CHA — ba điểm nối ở §3 dòng `social-comments.service.ts` `[PR2-2]`. (a) `feed_mentions` LEFT JOIN `users` + LEFT JOIN `employee_profiles` (`deleted_at IS NULL`) — `[PR1-6]` trạng thái `users.status/deleted_at` là **ĐẦU VÀO PHÂN LOẠI (cột chiếu), KHÔNG phải WHERE** (lọc ở WHERE làm phần tử BIẾN MẤT ⇒ vỡ «độ dài giữ nguyên»); `employeeId` lấy từ join SỐNG, KHÔNG từ snapshot `feed_mentions.mentioned_employee_id`; vế `employee_profiles.status='active'` CHỈ áp cho nhánh group và `[PR2-3]` CHỈ sống trong `loadActiveGroupMembers` dùng chung (câu c) — KHÔNG chiếu lại ở câu (a) (hai bản của cùng một luật). `[PR1-7]` `label` chiếu bằng drizzle `users.fullName` NGAY trong hàm tên đúng `loadMentionsForTargets` — `sql` thô chứa `full_name` bật pin `rawSqlIdentity`, helper lồng đổi khoá `fn` của phán quyết; (b) `org_units.head_user_id` cho tập đơn vị `org_unit` của trang (chỉ khi có); (c) thành viên nhóm cho tập nhóm của trang (chỉ khi có) | Khuôn `getPreferencesForUsers`. Gọi trong CÙNG `withTenant` mà `decorate` đã mở (bài) — không thêm transaction | Gọi `resolveMentions` theo từng bài — N+1 đúng chỗ WO cấm |
| D8 | **Thứ tự phần tử**: `ORDER BY feed_mentions.created_at, feed_mentions.id` — ổn định giữa các lần tải. Phần tử `withheld` GIỮ vị trí (không dồn/gộp) | FE khớp theo nhãn, nhưng thứ tự ổn định giữ snapshot test + tránh nhấp nháy | — |
| D9 | **KHÔNG cặp quyền mới, KHÔNG migration** | `feed_mentions` + unique `(company_id,target_type,target_id,mentioned_user_id)` đã có từ DB-1; mọi đường tới `decorate` đã qua cổng đọc bài | — |

## 3. Tệp đụng

| Tệp | Việc |
|---|---|
| `packages/contracts/src/social-api.ts` | `feedMentionSchema` + `FeedMentionDto`; `mentions` optional trên post/comment schema |
| `packages/contracts/src/realtime.ts` | `.omit({ mentions: true, … })` ở hai schema WS feed |
| `apps/api/src/social/social-mentions.ts` | Tách `classifyInAudience` + `loadOrgUnitHeads` + `loadActiveGroupMembers`; `resolveMentions` dùng lại chúng (hành vi không đổi); thêm `loadMentionsForTargets` |
| `apps/api/src/social/social.mapper.ts` | `extra.mentions` → `dto.mentions` (post + comment) |
| `apps/api/src/social/social-posts.service.ts` | `decorate` nạp mention trong tx sẵn có; `emitPostCreated` bóc `mentions` |
| `apps/api/src/social/social-comments.service.ts` | `decorate(viewer, rows, parentPost)` nạp mention (tx cùng lượt `myReactions`); `emitCommentCreated` bóc `mentions`. 🔴 `[PR2-2]` Ba điểm nối audience BÀI CHA: `list` GIỮ kết quả `assertPostVisible` (`:89`, hiện bị bỏ) và trả nó ra khỏi tx cùng `rows`; `update` trả thêm `comment.post` ra khỏi tx (`:309`, hiện chỉ `{row, dropped}`); `create` đã trả `post` (`:203`). CẤM JOIN thay thế hoặc truyền `undefined` |
| `apps/api/test/foundation/identity-projection-verdicts.ts` | Phán quyết `second-assert` cho điểm chiếu mới `social-mentions.ts#loadMentionsForTargets:users.fullName` (căn cứ = D1 + điểm khẳng định `listFeed`/`findVisible`/`assertPostVisible`/`assertCommentVisible` TRƯỚC decorate) + 🔴 `[PR1-1]` **`BASIS_CEILINGS["second-assert"]` 12→13** kèm comment ghi ngày (khuôn kudos `:816-819`) — ratchet check 4 (`identity-projection-ratchet.unit-spec.ts:127-133`) đòi FULL gate cho việc nâng trần |
| `packages/contracts/src/social-ws.spec.ts` | `[PR1-9]` assert `mentions` KHÔNG nằm trong khoá của hai schema WS feed |
| `docs/API Design/API-19_SOCIAL_API_Design.md` | §6.1 thêm `mentions[]` + luật D1/D3/D4; §7 ghi rõ WS KHÔNG mang |
| Spec mới (xem §4) | |

## 4. Kiểm thử (RED trước)

**Đặc tả hiện trạng TRƯỚC refactor** `[PR1-5]`: KHÔNG có `social-mentions.spec.ts` — lưới đường ghi thật là `test/integration/social-be1-content.int-spec.ts` R19 (org_unit ngoài/cùng đơn vị, tự-nhắc, company) + `src/social/social-group-audience.int.spec.ts`. Thêm vào R19 ca **nhắc head H trên bài org_unit ⇒ accepted** và chạy XANH trên code CŨ trước khi tách hàm.

**Unit** (`social-mentions.spec.ts`, mới, colocated): `classifyInAudience` — bảng 3 audience × {trong, ngoài} + head đơn vị + khoá cặp chéo (Y thuộc G1 xét cho G2 ⇒ ngoài; head của U1 xét cho U2 ⇒ ngoài). KHÔNG có ca tự-nhắc (luật đó ở đường ghi). Unit của bộ nạp: đếm câu `tx.select` ≤ 3 cho một lô trộn 3 audience.

**Unit** (`social.mapper.spec.ts`): `mentions` vắng khi `extra.mentions` undefined; nhánh `withheld` KHÔNG có khoá `label`/`employeeId`; không phần tử nào có khoá `userId`.

**Int (LANE_DB)** — `test/integration/social-be1d-mentions.int-spec.ts`, đi qua HTTP (`GET /social/feed`, `GET /social/posts/:id`, `GET /social/posts/:id/comments`). Mỗi ca DENY đứng CẠNH ca ALLOW của cùng dựng cảnh:

| # | Dựng cảnh | Kỳ vọng |
|---|---|---|
| M1 ALLOW | bài `company` nhắc X (active, có hồ sơ) | `{withheld:false, employeeId:X.emp, label:X.fullName}` |
| M2 DENY | cùng bài, sau đó khoá tài khoản X | phần tử `{withheld:true}` — mảng KHÔNG rỗng, độ dài giữ nguyên |
| M3 ALLOW/DENY | bài `org_unit` U nhắc X∈U và H (head U); sau đó chuyển X sang đơn vị khác | trước: 2 link; sau: X `withheld`, H vẫn link |
| M4a người xem NGOÀI audience | `[PR1-4]` (`manage:feed-post` KHÔNG nới audience — `social-access.service.ts:488-516`) V không là thành viên, đọc bài của nhóm PUBLIC (`visibleGroupPostExists`) qua `[PR2-5]` `GET /social/posts/:id` | V nhận ĐÚNG mảng như thành viên (D1 không phụ thuộc V) |
| M4b | Tác giả A đã rời đơn vị U, đọc bài org_unit U của chính mình | X∈U vẫn link; `[PR2-6]` sau đó X cũng rời U ⇒ `withheld` CẢ với tác giả A (D1 không phụ thuộc người xem, xét từ hai phía) |
| M5 group | bài nhóm `private` nhắc thành viên Y; thành viên Z đọc | trước: link (ALLOW); Y rời nhóm ⇒ `withheld`. Người không là thành viên ⇒ 404 cả bài (cổng đọc bài) |
| M6 comment | bình luận nhắc X trên bài `company` | `GET …/comments` trả `mentions` đúng như M1; khoá X ⇒ `withheld` |
| M7 không rò | quét TOÀN BỘ JSON response của M1–M6 | không xuất hiện `X.userId` ở bất kỳ đâu; nhánh `withheld` không chứa `X.fullName` lẫn `X.employeeId` |
| M8 N+1 | `[PR2-1]` trang `GET /social/saved` 10 bài (để có cả nhánh group), mỗi bài nhắc 2 người, trộn 3 audience | spy `loadMentionsForTargets` gọi ĐÚNG 1 lần/trang với đủ 10 đích (đếm câu SQL ở unit) |
| M10 tự-đọc | `[PR1-2]` X đọc bài nhắc X | X nhận LINK, không `withheld` |
| M11 khoá chéo | `[PR1-3]` một trang có 2 bài nhóm G1, G2; Y chỉ là thành viên G1, bị nhắc ở cả hai (bài G2 ghi mention trực tiếp vào DB) — `[PR2-1]` đọc qua `GET /social/saved` (`groupScope:'include'`, người xem lưu cả hai bài trước), KHÔNG qua `/social/feed` (loại bài nhóm) | Y link ở G1, `withheld` ở G2 |
| M9 WS | tạo bài `company` có mention | payload `feed:post.created` KHÔNG có khoá `mentions`; tương tự `feed:comment.created` |

Census: chạy `identity-projection` ratchet + route census/openapi (nếu response-shape census tồn tại) — phải xanh sau khi thêm phán quyết.

## 5. Gate

**FULL** `[PR1-1]`: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` + `typescript-reviewer` — nâng `BASIS_CEILINGS` là thay đổi ratchet an ninh, chính ratchet đòi FULL gate. Chạy `bash harness/check.sh --lane-db` (int-spec M1–M11 phải THỰC SỰ chạy, không skip).
🛑 `[PR2-4]` DỪNG & LẬP LẠI PLAN nếu lúc thi công phát hiện bộ nạp phải đọc NGOÀI tầm nhìn của bài (dữ liệu nhân sự ngoài những người đã có hàng `feed_mentions` trên bài V đọc được) — lúc đó nó thành đường đọc nhân sự, không còn là bổ sung DTO.

## 6. Rủi ro & nợ

| # | Rủi ro | Xử lý |
|---|---|---|
| R1 | Tách vị từ làm đổi hành vi đường GHI | Lưới: `social-be1-content.int-spec.ts` R19 (+ ca head mới, xanh TRƯỚC refactor) + `social-group-audience.int.spec.ts`; không sửa kỳ vọng cũ |
| R2 | **Nợ có sẵn (không do WO này):** `PATCH` bài/bình luận không gửi `mentionedUserIds` ⇒ `dto.mentionedUserIds ?? []` ⇒ `syncMentions` XOÁ mọi mention cũ. Với D3 (không `userId`), FE sửa bài không có dữ liệu để gửi lại | GHI NỢ thành WO riêng (đề xuất: chỉ đồng bộ mention khi khoá `mentionedUserIds` CÓ MẶT trong DTO — `undefined` = giữ nguyên). KHÔNG sửa ở WO này (ngoài done_when, đổi ngữ nghĩa API-004/016) |
| R3 | FE chưa nối link | Ngoài `paths` (apps/app). Ghi vào backlog: FE-2 (hoặc WO FE nhỏ) đổi token `mention` → `<Link>` khi khớp `label` với phần tử `withheld:false`. `[PR1-11]` Response KIỂM DUYỆT (`social-posts-moderation.service.ts:147`) không mang `mentions` ⇒ FE phải GIỮ mentions cũ trong cache khi merge response đó (hoặc chấp nhận link rơi về span tới lần refetch) |
| R4 | Chi phí: +1..3 câu mỗi trang feed | Chấp nhận; câu (a) đi theo index `feed_mentions_uq` (tiền tố `company_id,target_type,target_id`) |

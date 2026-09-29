# S16-SOCIAL-BE-2D — Khối `kudos?`/`poll?`/`idea?` trên DTO bài + danh bạ người nhận vinh danh (SOCIAL-API-059)

> Zone: 🔴 red · **Gate: FULL** (security-reviewer + database-reviewer + silent-failure-hunter + typescript-reviewer) —
> đường đọc nhân sự MỚI + nâng trần `BASIS_CEILINGS` của identity ratchet · Nhánh `feat/s16-social-be-2d` (base master `f992a086`).
> Nguồn: plan `S16-SOCIAL-FE-2` §2 G1/G2/G4 · `harness/backlog.mjs` BE-2D · workflow Understand 29/09/2026 (5 lane đọc + critic, ~620 lần đọc code).
> Owner ký 29/09/2026 (phiên mở WO): **K1** một luật người nhận + vá xoá mềm · **K2** N=2 / trần 20 / chỉ họ tên · **K3** `GET /social/kudos/recipients` gác **`create:feed-kudos`** (đổi từ `view:feed` của S3(a)) · **K4** avatar giữ raw + seed WO nợ.
> **Plan-review lượt 1 (29/09, 3 lăng kính độc lập):** plan-reviewer BLOCK (1 HIGH · 3 MEDIUM · 7 LOW) · db-perf BLOCK (3 HIGH · 5 MEDIUM · 5 LOW) · security PASS (3 MEDIUM · 4 LOW). Đã tự xác minh các HIGH, vá hết ở **§9 — §9 GHI ĐÈ §3–§5 nơi mâu thuẫn.**

## 1. Vấn đề

Hai khoảng trống chặn `S16-SOCIAL-FE-2C` (vinh danh FE) và một phần FE-2:

- **G1/G4** — `feedPostSchema` không chở chi tiết bài `kudos`/`poll`/`idea`. Thẻ kudos trong feed chỉ còn vỏ; `PollBlock` gọi `043` MỘT lần/thẻ (N thẻ = N request); pill trạng thái sáng kiến không vẽ được.
- **G2** — ô chọn người nhận vinh danh cần liệt kê ĐỒNG NGHIỆP, mà vai `employee` giữ `read:employee@Own` ⇒ `/hr/employees` chỉ trả chính mình; `/org/employees` đòi `view:user`. 45/46 người dùng thấy ô chọn rỗng.

Câu hỏi thật của G1 là **tầm nhìn + ai được thấy tên ai**, và của G2 là **một danh bạ** (cùng lớp oracle `SOCIAL-ERR-009`) — không phải thêm trường.

## 2. Phép đo (29/09/2026 trên `f992a086`)

| # | Đo | Kết quả |
|---|---|---|
| M1 | Chỗ dựng `FeedPostDto` | DUY NHẤT `toFeedPostDto` (`social.mapper.ts:45-89`). Người gọi: `SocialPostsService.decorate` (`social-posts.service.ts:726-769`) — phục vụ 001/002/003/004/010 + 020/023/025 qua `decorateForViewer`/`toPageForViewer`; và `006` (`social-posts-moderation.service.ts:74-92`) dựng riêng, KHÔNG nạp `mentions`. Không route nào nhúng bài trong bài (không có `shared_post_id`). Báo cáo 029 / thùng rác 057 / NOTI có schema riêng. |
| M2 | Tx của `decorate` | MỘT `withTenant` (set_config + `tagsFor` + `myReactions` + `savedPostIds` + `loadMentionsForTargets` 1–3 câu = 5–7 câu), rồi `attachments.decorateMany` NGOÀI tx. Không test nào đếm tổng câu/trang. |
| M3 | Bảng con | `feed_polls` · `feed_ideas` · `feed_kudos` đều `UNIQUE(company_id, post_id)` (1–1 với bài) ⇒ nạp theo lô bằng `post_id IN (…)` có index, **không migration**. Không bảng nào có `deleted_at`. DB KHÔNG ép bài type `poll` phải có hàng `feed_polls` (fixture `s16-social-db1-invariants.int-spec.ts:409` chèn bài poll trần). |
| M4 | WS | `wsFeedPostCreatedEventSchema = feedPostSchema.omit({…,mentions})` (`realtime.ts:350-364`) ⇒ khoá MỚI tự được thừa hưởng. `emitPostCreated` spread `...rest` (`social-posts.service.ts:812-825`) ⇒ khoá mới tự ra room. `social-ws.spec.ts` «WS ⊆ REST» vẫn XANH khi rò. `create()` decorate bằng TÁC GIẢ ⇒ `poll.myVote` của tác giả sẽ phát cho cả công ty. FE `use-feed-realtime` chỉ ĐẾM sự kiện, không vẽ thẻ từ payload. |
| M5 | Người nhận `047` | `recipientsOfTx` (`social-kudos.repository.ts:352-398`): INNER JOIN `employee_profiles` KHÔNG lọc `deleted_at`, LEFT JOIN `users` không lọc trạng thái; `isFormerEmployee = status <> 'active'`. **Xoá mềm HR (`softDeleteEmployeeTx`, `employees.repository.ts:245-257`) CHỈ đặt `deleted_at`, KHÔNG đổi `status`** ⇒ hồ sơ xoá mềm còn `active` hiện tên + avatar với `isFormerEmployee:false` — tức hiện như nhân viên HIỆN TẠI. Trái docblock `:83` («soft-deleted projected nowhere»). Không int-spec nào phủ. |
| M6 | Kết quả poll | `pollResultsTx` = MỘT câu `tx.execute` / poll (H-8: ba câu = ba ảnh chụp READ COMMITTED ⇒ Σ% > 100). `COUNT(DISTINCT)` về từ driver là CHUỖI — bọc `Number()`. `status` giữ `'open'` quá `closes_at` tới khi job chạy (job TẮT ở `NODE_ENV=test`). `043` không phơi `expired`; FE tự suy từ `closesAt` (`poll-format.ts:39-56`). |
| M7 | Sáng kiến | `feed_ideas.status` 4 giá trị, FSM 3 cạnh. `045` KHÔNG che `status` (view:feed); `reviewNote` che theo D19; người duyệt là điểm danh tính #25. Idea KHÔNG có body riêng (= `feed_posts.body`). |
| M8 | Identity ratchet | MỌI trần `BASIS_CEILINGS` đầy đúng mức (waiver 8/8 · second-assert 13/13 · scoped-predicate 25/25 · identity-gated 18/18 …) — `identity-projection-verdicts.ts:809-890`. Chỉ điểm **PROJECTION** bị ratchet (vị từ `.where`/`ilike` và `.orderBy` KHÔNG). Khoá điểm = `file#fn:expr`; đổi method → hàm tự do CÙNG tên giữ khoá. `rawSqlIdentity` = 15 (regex `full_name`/`email` trên CHỮ của template `sql` — nội suy `${users.fullName}` không bị đếm). |
| M9 | Danh bạ hiện có | `/hr/employees` ILIKE email + employee_code KHÔNG thoát `%`/`_`; `/org/employees` không `q`, không trần. Không `@nestjs/throttler` ở đâu cả. `public.f_unaccent` có (mig 0538). |
| M10 | Đo tay trên PG 17.10 / musl / `en_US.utf8` (Docker local) | `f_unaccent('Đặng Đức')='Dang Duc'` · `'Nguyễn' ILIKE 'NGUYỄN'` = **t** · `f_unaccent('Nguyễn') ILIKE f_unaccent('%nguyen%')` = **t** · `f_unaccent(U&'\0301\0303')` dài **0** ⇒ chuỗi toàn dấu tổ hợp co thành RỖNG ⇒ `'%'||''||'%'` khớp TẤT CẢ. Độ dài tối thiểu phải đếm trên chữ/số, không trên độ dài chuỗi. |
| M11 | Seed cặp | `create:feed-kudos` @Company cho `employee`/`manager`/`hr`/`company-admin` (`0578:83-86`), `is_sensitive=false` — cùng tập với `view:feed`. |
| M12 | Contracts import | `social-api-b.ts:8` import `feedPostSchema` rồi `.extend` ở cấp module; `social-api-{polls,ideas,kudos}.ts` import `social-api-b` ⇒ `social-api.ts` import ngược bất kỳ file nào trong ba file đó là VÒNG (feedPostSchema `undefined`/TDZ lúc nạp, cả ESM lẫn CJS). `feedPollResultsSchema` hôm nay ở `social-api-polls.ts:61-83`; người dùng: `social-polls.service.ts` · `web-core/social-api.ts` · FE `PollBlock`/`poll-format` — đều import từ `@mediaos/contracts` (index), không từ đường dẫn file. |
| M13 | Census/gate chạm | two-layer census `toBe(58)` + `ROUTE_TO_KEY` + `SERVICE_SITE_TO_KEYS` + allowlist controller (`SocialKudosController` ĐÃ có); route census artifact `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` phải khớp runtime; route-HTTP coverage `MIN_COVERED_COUNT=682` (đo thật 690); `pipeline-parity.unit-spec.ts` `HAND_ROLLED_BASELINE=269` (**toBe**) ⇒ int-spec mới PHẢI boot qua `applyMainPipeline`; error-code census tầng C (không `new XxxException('…')` trần). |
| M14 | Kích thước | `social-posts.service.ts` 880 (đã vượt 800 — nợ có sẵn, BE-1D ghi) · `social-api.ts` 691 · `social-access.service.ts` 765 · `social-kudos.repository.ts` 582 · `identity-projection-verdicts.ts` 1012. |

## 3. Quyết định

| # | Quyết định | Lý do | Phương án loại |
|---|---|---|---|
| **D1** | **Schema khối ở một file LÁ mới** `packages/contracts/src/social-feed-blocks.ts` (chỉ import `zod` + `./social`): `feedKudosRecipientSchema {employeeId, fullName∣null, avatarUrl∣null, isFormerEmployee}` · `feedKudosBadgeRefSchema {id, code, name, icon∣null}` · `feedKudosBlockSchema {kudosId, message∣null, isOfficial, badge∣null, recipients[]}` · **`feedPollOptionResultSchema` + `feedPollResultsSchema` DỜI vào đây** (định nghĩa giữ nguyên từng trường) · `feedPostIdeaBlockSchema {status}`. `social-api.ts` import từ lá; `social-api-polls.ts` import lại hai schema poll từ lá (KHÔNG re-export — `index.ts` thêm `export * from "./social-feed-blocks"`). Không `.strict()` (khuôn response hiện có). | M12: vòng import. Một định nghĩa cho khối poll trên thẻ VÀ `041..044` ⇒ FE seed thẳng cache `043` từ thẻ, hai bên không trôi | Định nghĩa trong `social-api.ts` (691 dòng, và vẫn phải nhân bản cho `043`); `.extend` từ `feedPollCoreSchema`/`feedIdeaCoreSchema` (mang `reviewedBy`=users.id, `reviewNote`) |
| **D2** | **Ba khoá OPTIONAL trên `feedPostSchema`**: `kudos?` · `poll?` · `idea?`. Có mặt ⇔ `type` khớp **VÀ** hàng con nạp được. Vắng ở: bài type khác · response `006` (dựng riêng, như `mentions`) · payload WS · hàng con mồ côi (D3). **Không bao giờ `null`** — «vắng» là trạng thái duy nhất của «không có». | PROD FE tự deploy còn BE deploy tay (memory `prod-3-way-drift`) ⇒ khoá bắt buộc = ZodError trên HTTP 200 = trang trắng. Một trạng thái «không có» thay vì hai (vắng/null) | `null` cho bài khác type — thêm nhánh thứ ba FE phải xử lý |
| **D3** | **Bộ nạp theo LÔ** `loadPostBlocksTx(tx, companyId, viewerUserId, rows:{id,type}[])` ở file PHẲNG mới `apps/api/src/social/social-post-blocks.ts`, gọi trong CÙNG `withTenant` của `decorate` (sau `mentions`). Chỉ hỏi bảng của type CÓ MẶT trên trang: kudos 2 câu (khối + người nhận) · poll 1 câu · idea 1 câu ⇒ **thêm ≤ 4 câu/trang bất kể số bài; 0 câu khi trang không có ba type đó**. Trả `{kudos, poll, idea: Map<postId,…>, orphans: string[]}`; accessor `blocksFor(blocks, row)` trả `{kudos?, poll?, idea?}`. **Hàng con mồ côi** (type khớp mà thiếu hàng con) ⇒ khối VẮNG + `logger.error` ở `decorate` (id bài, type) — KHÔNG ném. | Khuôn `loadMentionsForTargets` (BE-1D D7). File riêng vì `social-posts.service.ts` đã 880 dòng, và vì `vi.mock` chỉ spy được lời gọi CHÉO module. Mồ côi là dữ liệu hỏng (DB cho phép, M3), không phải lỗi lập trình như khoá thiếu của `mentionsFor`: ném = 500 CẢ trang feed vì một bài; nuốt im = thành công RỖNG — `logger.error` là vế fail-LOUD không giết trang | Gọi `043`/`047` theo từng bài (N+1); ném như `mentionsFor` |
| **D4** | **Người nhận — MỘT luật cho `047` và thẻ bài (owner K1)**: `recipientsOfTx` đổi từ method sang **hàm tự do CÙNG TÊN** trong cùng file (khoá identity giữ nguyên, M8) và SQL thành: `fullName = CASE WHEN ep.deleted_at IS NULL THEN ${users.fullName} END` · `avatarUrl = CASE WHEN ep.deleted_at IS NULL THEN ep.avatar_url END` · `isFormerEmployee = (ep.deleted_at IS NOT NULL OR ep.status <> 'active')`. Nghỉ việc/terminated/inactive ⇒ GIỮ tên + cờ (S6). Tài khoản khoá/xoá ⇒ GIỮ tên (vinh danh là bản ghi lịch sử). Không TK ⇒ `fullName:null`, cờ theo `status`. Thứ tự `employee_id ASC` giữ nguyên. Khối kudos lấy `kudosId` qua `kudosBlocksByPostIdsTx(tx, companyId, postIds)` (feed_kudos LEFT JOIN badges theo `post_id`, **không chiếu users**) rồi gọi `recipientsOfTx` — KHÔNG điểm danh tính mới. Verdict `recipientsOfTx:users.fullName` VIẾT LẠI lý do: `kudosId` đến từ `listKudosTx` (047) HOẶC `kudosBlocksByPostIdsTx` trên `post_id` của hàng ĐÃ qua `visiblePostCondition` (điều kiện của `decorate`); sửa trích dẫn sai `003`→`005` (xoá bài). | Vá lỗi M5 (hồ sơ xoá mềm hiện như nhân viên hiện tại) đúng lúc phạm vi của nó sắp nở từ màn `047` ra MỌI thẻ feed. Làm ở SQL (CASE) để tên của hồ sơ đã xoá không rời DB | Hàm mới chiếu `users.fullName` (điểm mới, second-assert 13→14); vá ở JS (tên vẫn đi qua tầng service); lọc bỏ người nhận xoá mềm (đổi độ dài mảng — FE không phân biệt «2 người» với «3 người, 1 đã bị xoá») |
| **D5** | **Khối poll = ĐÚNG `FeedPollResultsDto`** (hình dạng `043`, gồm `myVote` của NGƯỜI XEM). Hàm lô `pollResultsForPostsTx(tx, companyId, userId, postIds)` = **MỘT câu** `tx.execute`: `feed_polls p LEFT JOIN feed_poll_options o … LEFT JOIN LATERAL (COUNT(DISTINCT v.user_id)) … EXISTS(mine)`, `ORDER BY p.post_id, o.position`, bọc `Number()` mọi đếm. `pollResultsTx` (041..044) **ủy quyền** cho CÙNG bộ dựng SQL (lọc `p.id = pollId`) — một định nghĩa. `status` y như `043` (không thêm `expired`); FE giữ `isPollAcceptingVotes(status, closesAt)`. | FE-2 D5: `PollBlock` bỏ được N request `043` khi thẻ đã chở khối. Một câu giữ bất biến H-8 cho CẢ trang. Một bộ dựng SQL cho thẻ và `043` ⇒ hai bên không trôi (lưới hồi quy: int-spec `social-be2b1-polls` H-8/anonymity + `social-polls.service.vote-conflict.spec`) | Khối «nhẹ» không `myVote`/số phiếu (FE vẫn phải gọi `043`); hai câu (options + đếm) = hồi quy H-8; thêm `expired` (hai hợp đồng cho cùng poll — `043` không có) |
| **D6** | **Khối idea = `{status}` DUY NHẤT**. `ideaStatusByPostIdsTx` 1 câu (`feed_ideas_company_post_uq`). KHÔNG `reviewNote` (mặt nạ D19 theo người xem + 1 lần resolve quyền/trang), KHÔNG người duyệt (điểm danh tính mới). | G4 chỉ cần pill. `status` vốn không che ở `045` (view:feed) ⇒ thẻ không nới gì | Thêm `ideaId`/`reviewedAt` — không màn nào cần |
| **D7** | **WS KHÔNG mang cả ba khối**: bóc tại nguồn (destructure trong `emitPostCreated`) **VÀ** `.omit({kudos, poll, idea})` ở `wsFeedPostCreatedEventSchema`. `social-ws.spec.ts` thêm cặp REST-có / WS-không cho TỪNG khoá (khuôn `mentions`). Int-spec spy đối số emitter (tầng nguồn) + contracts spec `.parse` (tầng schema). API-19 §7 + docblock `realtime.ts` ghi quyết định. | M4: `poll.myVote` là của TÁC GIẢ; FE chỉ đếm sự kiện ⇒ bóc không tốn gì. Hai tầng vì mỗi tầng một mình đều từng bị bỏ quên (`...rest` / `.omit` thừa hưởng) | Giữ `kudos`/`idea` (không theo người xem) — mở rộng hợp đồng WS cho thứ không màn nào vẽ |
| **D8** | **Danh bạ `SOCIAL-API-059` `GET /social/kudos/recipients?q=`** ở `SocialKudosController` (đã trong allowlist census), key **`kudosRecipientSearch: pair("create","feed-kudos")`** (owner K3; `tier1IsFloor=false`, `companyFloor=true`). Service `SocialKudosService.searchRecipients` gọi `resolveActor(user, "kudosRecipientSearch")` ĐÚNG một lần (chuỗi literal). Repo hàm tự do `searchKudosRecipientsTx(tx, companyId, actorUserId, needle)`: `employee_profiles ep INNER JOIN users u ON u.id=ep.user_id AND u.company_id=ep.company_id` · `ep.company_id=$c` · `ep.status='active' AND ep.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL` · **`u.id <> actorUserId`** (loại chính mình, owner K2) · khớp **ĐẦU TỪ** chỉ trên họ tên: `(' ' || f_unaccent(${users.fullName})) ILIKE ('% ' || f_unaccent(${escaped}) || '%') ESCAPE '\'` với `escaped` thoát `\ % _` ở JS · lưới phụ `length(btrim(f_unaccent(${needle}))) >= 2` (M10) · `ORDER BY f_unaccent(${users.fullName}), ep.id` · `LIMIT 21`. Response `{data:[{employeeId, fullName, avatarUrl}], truncated}` (`truncated` = có hàng thứ 21). **KHÔNG `userId`, KHÔNG email/mã NV/đơn vị, KHÔNG `page`/`limit`.** | Owner K2/K3. Gắn cặp `create:feed-kudos` = thu hồi quyền tạo vinh danh là đóng luôn danh bạ; nghĩa `view:feed` không đổi. Khớp ĐẦU TỪ (không substring) thu hẹp kết quả và khớp cách người Việt gõ tên («an» → «Nguyễn Văn **An**», không → «Tu**ấn**»). Không khớp email/mã NV: khớp trên cột KHÔNG trả là oracle dò tồn tại (lớp `ERR-009`, và vị từ `ilike` không bị ratchet — M8). `f_unaccent` hai vế (M10) | Substring; `GET /social/people` chung (mời tái dùng cho @mention — cần `userId`); `view:feed` (S3(a) cũ) |
| **D9** | **Query schema** `kudosRecipientSearchQuerySchema` (`social-api-kudos.ts`, `.strict()`): `q` = `string` → NFC → trim → `max(100)` → cấm ký tự điều khiển (`\p{Cc}`) → **≥ 2 code point `\p{L}`/`\p{N}`** (dấu tổ hợp `\p{M}` KHÔNG tính). Mọi phép biến đổi LUỸ ĐẲNG (pipe chạy HAI lần: `main.ts` + `@UsePipes`). **Thoát LIKE ở repository, KHÔNG ở Zod** (thoát hai lần = `\\%`). Quá ngắn ⇒ 400 `VALIDATION-ERR-001` (không mã SOCIAL mới). `@Query` gõ bằng lớp `createZodDto` (`social.dto.ts`) — kiểu `z.infer` làm pipe không kiểm gì. | M10 (`%%` và dấu tổ hợp qua được `min(2)` của CHAT). Nguyên tắc module: hình dạng ở Zod, luật nghiệp vụ ở service | Mã `SOCIAL-ERR` mới cho q ngắn (census + parity contracts cho một lỗi hình dạng) |
| **D10** | **Identity ratchet**: điểm mới DUY NHẤT `social/social-kudos.repository.ts#searchKudosRecipientsTx:users.fullName`, basis **`waiver`** (tiền lệ sinh nhật `026` — danh bạ cấp công ty có chủ đích, KHÔNG phải scoped-predicate), **`BASIS_CEILINGS.waiver` 8→9** kèm comment ngày + tham chiếu SOC-DEC-013. Lý do verdict nói thẳng: min-2/trần-20/không-phân-trang là giới hạn UX/hiệu năng, **KHÔNG chống liệt kê** (API không có throttler — dò ~26² tiền tố 2 ký tự lấy được toàn danh bạ active + employeeId); rào thật = chỉ tên+avatar+employeeId của người ĐANG làm, không `userId`, cặp `create:feed-kudos`. | Chỉ điểm PROJECTION bị ratchet (M8); owner đã chấp nhận lớp phơi bày này (K2) — ghi rõ để reviewer đọc được | `unconditional('waiver')` thuần tượng trưng; nhãn scoped-predicate (không có vị từ data_scope nào) |
| **D11** | **Typed `047`**: `feedKudosListItemSchema = feedKudosBlockSchema.extend({postId, createdAt})` + `feedKudosPageSchema` ở `social-api-kudos.ts`; `SocialKudosService.list` khai `Promise<FeedKudosPageDto>` (neo kiểu, khuôn D2 của FE-2 — CẤM `as`). Schema danh bạ + response cũng ở `social-api-kudos.ts`. | FE-2C sẽ parse `047`; một nguồn cho hình người nhận (thẻ + 047) | Để `047` không kiểu (FE chép tay) |
| **D12** | **KHÔNG migration, KHÔNG cặp quyền mới, KHÔNG mã lỗi mới.** Chỉ số index đủ (M3); cặp đã seed (M11). | — | — |
| **D13** | **Replay idempotency `002`** trả thẻ LÚC TẠO (khối poll đếm 0, tên người nhận lúc đó) — chấp nhận, ghi API-19 §6.6. | Hành vi sẵn có của interceptor cho mọi trường thẻ | — |
| **D14** | **Không tách `social-posts.service.ts`** trong WO này: diff ròng ở file đó ≤ +15 dòng (gọi bộ nạp + truyền khối + bóc WS). Nợ >800 dòng đã ghi từ BE-1D. | Tách file là refactor rộng chạm đường ghi 002/004 — ngoài phạm vi, tăng bán kính review vùng đỏ | — |

## 4. Tệp đụng

| Tệp | Việc |
|---|---|
| `packages/contracts/src/social-feed-blocks.ts` (MỚI) | D1 — schema khối + dời 2 schema poll |
| `packages/contracts/src/social-api.ts` | `kudos?`/`poll?`/`idea?` trên `feedPostSchema` + docblock (vắng ≠ rỗng, không WS) |
| `packages/contracts/src/social-api-polls.ts` | import `feedPollOptionResultSchema`/`feedPollResultsSchema` từ lá (bỏ định nghĩa tại chỗ) |
| `packages/contracts/src/social-api-kudos.ts` | D9 query schema · response danh bạ · D11 `047` typed |
| `packages/contracts/src/index.ts` | `export * from "./social-feed-blocks"` (additive) |
| `packages/contracts/src/realtime.ts` | `.omit({kudos, poll, idea})` + docblock |
| `packages/contracts/src/social-ws.spec.ts` · `social-api-polls-ideas.spec.ts` · spec mới `social-feed-blocks.spec.ts` | REST-có/WS-không · hình dạng khối · query danh bạ (NFC, `%%`, dấu tổ hợp, ký tự điều khiển, luỹ đẳng khi parse 2 lần, `.strict()` từ chối `limit`) |
| `apps/api/src/social/social-post-blocks.ts` (MỚI, PHẲNG) | D3 bộ nạp + accessor |
| `apps/api/src/social/social-kudos.repository.ts` | D4 `recipientsOfTx` → hàm tự do + SQL một luật; `kudosBlocksByPostIdsTx`; D8 `searchKudosRecipientsTx` + `escapeLike` |
| `apps/api/src/social/social-polls.repository.ts` | D5 bộ dựng SQL chung + `pollResultsForPostsTx`; `pollResultsTx` ủy quyền |
| `apps/api/src/social/social-ideas.repository.ts` | D6 `ideaStatusByPostIdsTx` |
| `apps/api/src/social/social.mapper.ts` | `extra.kudos?/poll?/idea?` — chỉ gán khi có; chép theo DANH SÁCH KHOÁ (khuôn `copyMention`) |
| `apps/api/src/social/social-posts.service.ts` | `decorate` gọi bộ nạp + `logger.error` mồ côi; `emitPostCreated` bóc 3 khoá |
| `apps/api/src/social/social-kudos.service.ts` | `list` dùng `recipientsOfTx` tự do + kiểu `FeedKudosPageDto`; `searchRecipients` mới |
| `apps/api/src/social/social-b2b2.controllers.ts` | `@Get("kudos/recipients")` + guard + `@RequirePermission` từ bảng cặp + `@UsePipes` |
| `apps/api/src/social/social-route-pairs.const.ts` | key `kudosRecipientSearch` + docblock SOC-DEC-013 |
| `apps/api/src/social/social.dto.ts` | `KudosRecipientSearchQuery` (`createZodDto`) |
| `apps/api/src/social/*.spec.ts` | unit: `social-post-blocks.spec.ts` (đếm câu — fakeTx đếm CẢ `select` LẪN `execute`) · `social.mapper.spec.ts` · `social-kudos.repository` escape helper |
| `apps/api/test/foundation/identity-projection-verdicts.ts` | verdict mới (waiver) + `waiver` 8→9 + viết lại lý do `recipientsOfTx` |
| `apps/api/test/foundation/social-two-layer-guard-census.unit-spec.ts` | `ROUTE_TO_KEY` + `SERVICE_SITE_TO_KEYS` + `58→59` |
| `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` | `MIN_COVERED_COUNT` = số ĐO được sau WO (không phải 682+1) |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | regen `ROUTE_CENSUS_WRITE=1` (mở rộng `paths` WO) |
| `apps/api/test/integration/social-be2d-post-blocks.int-spec.ts` · `social-be2d-kudos-recipients.int-spec.ts` (MỚI) | §5 — boot qua `applyMainPipeline` |
| `docs/API Design/API-19_SOCIAL_API_Design.md` | route `059` (bảng §5.1, thứ tự route tĩnh §5.2, tổng 58→59) · §6.1 ba khối + luật D2/D4 · §6.6 replay D13 · §7 WS D7 · sửa ví dụ `avatarUrl "https://…"` (thực tế là fileId thô — M, owner K4) |
| `docs/SPEC/SPEC-16 SOCIAL.md` | §13.4b luật người nhận (D4) + sửa `003`→`005` · §15 tổng route (đang ghi 56 — thêm 057/058/059) · §22 **SOC-DEC-013** (danh bạ `create:feed-kudos`, K2/K3) |
| `docs/permission-matrix-spec.md` | nghĩa `create:feed-kudos` gồm tra danh bạ người nhận (mở rộng `paths` WO) |
| `harness/backlog.mjs` | `plan:`, mở `paths` (`docs/_review/**`, `docs/permission-matrix-spec.md`, `docs/SPEC/**`), seed 2 WO nợ (§7) |

## 5. Kiểm thử (RED trước)

**Unit** (colocated `src/social/*.spec.ts`, contracts `*.spec.ts`):

| # | Ca | Kỳ vọng |
|---|---|---|
| U1 | `loadPostBlocksTx` với fakeTx đếm `select` + `execute` | trang không có 3 type ⇒ **0** câu · chỉ kudos ⇒ 2 · chỉ poll ⇒ 1 · chỉ idea ⇒ 1 · trộn ⇒ 4; mảng rỗng ⇒ 0 |
| U2 | accessor | bài `share` ⇒ không khoá nào; bài `poll` có hàng ⇒ `poll` có mặt; bài `poll` thiếu hàng ⇒ vắng + id nằm trong `orphans` |
| U3 | mapper | khoá vắng khi `extra` không có; người nhận bẩn mang `userId` ⇒ bị bỏ (chép theo danh sách khoá); khối idea chỉ `status` |
| U4 | contracts WS | cho TỪNG khoá `kudos`/`poll`/`idea`: `feedPostSchema` CÓ khoá (neo dương) và `wsFeedPostCreatedEventSchema.shape` KHÔNG có; `.parse` payload có khoá ⇒ khoá bị bóc |
| U5 | query danh bạ | `'a'` ⇒ lỗi · `'%%'` ⇒ lỗi · `U&'\0301\0303'` ⇒ lỗi · `'ab\u0000'` ⇒ lỗi · `'ab%'` ⇒ OK · NFD `'Nguyễn'` ⇒ NFC · parse HAI lần = một lần · `{q, limit}` ⇒ lỗi (`.strict()`) |
| U6 | `escapeLike` | `\ % _` thoát đúng, chuỗi thường giữ nguyên |

**Int (LANE_DB, boot `applyMainPipeline`)** — mỗi ca DENY đứng CẠNH ca ALLOW cùng dựng cảnh; khẳng định «không có X» chỉ sau neo dương.

`social-be2d-post-blocks.int-spec.ts`:

| # | Dựng cảnh | Kỳ vọng |
|---|---|---|
| B1 | bài kudos `company` (huy hiệu + lời nhắn + 2 người nhận) — đọc qua `001`, `003`, `010` | khối `kudos` đủ trường; neo dương `recipients[0].employeeId` rồi JSON KHÔNG chứa `users.id` của người nhận/tác giả |
| B2 | 4 người nhận: nghỉ việc (`resigned`) · hồ sơ xoá mềm còn `status='active'` · TK `locked` · không TK | thẻ **và** `047`: nghỉ việc ⇒ tên + `isFormerEmployee:true`; **xoá mềm ⇒ `fullName:null, avatarUrl:null, isFormerEmployee:true`** (RED trên code cũ ở cả 047); khoá TK ⇒ tên giữ; không TK ⇒ `fullName:null` |
| B3 | bài poll, V1 bỏ phiếu A, V2 chưa | khối `poll` của V1 **deep-equal** response `043` của V1 (`myVote:[A]`); của V2 `myVote:[]`, cùng `totalVoters` |
| B3b | poll ẩn danh, 1 phiếu | neo dương `totalVoters===1` rồi JSON của người xem thứ ba (kể cả `company-admin`) KHÔNG chứa `userId` cử tri |
| B4 | bài idea, sau `046` chuyển `under_review` | `idea` = `{status:'under_review'}` đúng một khoá; không `reviewNote` ở đâu |
| B5 | bài `share` + response `006` của bài kudos | không khoá `kudos`/`poll`/`idea` (neo: cùng bài đọc qua `003` CÓ khối) |
| B6 | tạo bài kudos/poll/idea `company` | spy đối số `emitFeedPostCreated` KHÔNG có 3 khoá (neo: response `002` CÓ) |
| B7 | `/social/saved` trang 1 bài vs 10 bài trộn 3 type + mention | `captureQueries`: số câu SQL của lượt 10 bài = lượt 1 bài + (số type mới xuất hiện) — hằng theo số bài; spy `loadPostBlocksTx` đúng 1 lần/trang |
| B8 | bài kudos `org_unit` U; người ngoài U | người trong U thấy khối (neo); người ngoài: bài không có trong `001`, `003` ⇒ 404 |
| B9 | bài type `poll` không có hàng `feed_polls` (chèn thẳng DB) | `001` 200, bài có mặt KHÔNG khoá `poll`; `logger.error` được gọi với id bài |

`social-be2d-kudos-recipients.int-spec.ts`:

| # | Dựng cảnh | Kỳ vọng |
|---|---|---|
| R1 | vai tuỳ biến CÓ `view:feed` KHÔNG `create:feed-kudos` · cạnh đó vai có cả hai | 403 · 200 (neo) |
| R2 | grant `create:feed-kudos@Department` | 403 `AUTH-ERR-SCOPE-DENIED` · `@Company` ⇒ 200 |
| R3 | `q='a'` · `'%%'` · `'__'` · dấu tổ hợp · `?q=ab&limit=5` | 400 cả năm; `q='ab%'` ⇒ 200 |
| R4 | nhân sự «Nguyễn Văn An», «Đặng Thu Hà», «Trần Tuấn» | `nguyen`/`NGUYỄN`/`nguyễn` ⇒ An · `dang`/`đặng` ⇒ Hà · `an` ⇒ An, KHÔNG Tuấn · `uyen` ⇒ 0 (giữa từ) — mỗi ca 0 đứng cạnh neo |
| R5 | cùng tiền tố «Lê»: active (neo) · nghỉ việc · hồ sơ xoá mềm · TK `suspended` · TK `locked` · TK xoá mềm · không TK · tenant B | chỉ neo |
| R6 | actor tên «Lê A», đồng nghiệp «Lê B» | `q='le'` trả B, KHÔNG A |
| R7 | 25 người khớp · 20 người khớp | 20 + `truncated:true` · 20 + `truncated:false` |
| R8 | neo có kết quả | JSON không chứa `users.id` nào của fixture; mỗi phần tử ĐÚNG 3 khoá |
| R9 | `q` = phần email/mã NV không có trong tên nào | 0 (neo: tên khớp trả ≥1) |
| R10 | employeeId lấy từ R-neo gửi vào `POST /social/posts` type kudos | 201 |

**Lưới hồi quy chạy lại (không sửa kỳ vọng)**: `social-be2b1-polls.int-spec.ts` (H-8 + ẩn danh) · `social-be2b2-kudos.int-spec.ts` (K-4c/K-7/K-8) · `social-be1d-mentions.int-spec.ts` (M8/M9) · `social-polls.service.vote-conflict.spec.ts` · `social-news-noti-cap.spec.ts` (hàm dựng service theo VỊ TRÍ — không thêm tham số giữa).

**ĐO CỔNG (mutant — mỗi cái đỏ ĐÚNG ca + ĐÚNG thông điệp)**: (1) bỏ `kudos` khỏi destructure `emitPostCreated` ⇒ B6 đỏ; (2) bỏ `.omit` `poll` ở realtime ⇒ U4 đỏ; (3) bỏ vế `ep.deleted_at` trong CASE ⇒ B2 đỏ; (4) substring thay đầu-từ ⇒ R4 đỏ; (5) bỏ `escapeLike` ⇒ R3 `ab%`… và U6 đỏ; (6) bỏ `u.id <> actor` ⇒ R6 đỏ; (7) tách poll thành hai câu ⇒ U1 đỏ (đếm 2); (8) bỏ vế `u.status='active'` ⇒ R5 đỏ; (9) ném thay vì vắng ở mồ côi ⇒ B9 đỏ.

**Census/gate**: two-layer census · identity ratchet · route census (regen) · route-HTTP coverage · pipeline-parity · error-code census · contracts build dual (ESM+CJS — bắt vòng import) · `pnpm --filter @mediaos/api typecheck`.

## 6. Gate

**FULL** (4 reviewer Opus, song song, độc lập): `security-reviewer` (danh bạ + mặt nạ người nhận + WS) · `database-reviewer` (SQL lô, H-8, LATERAL, index, escape) · `silent-failure-hunter` (mồ côi, `?? []`, emit nuốt lỗi) · `typescript-reviewer`. Trước PR: `bash harness/check.sh --all --lane-db=be2d` XANH (int-spec THỰC SỰ chạy).

🛑 **DỪNG & LẬP LẠI PLAN** nếu lúc thi công: (a) bộ nạp khối cần đọc hàng KHÔNG gắn với `post_id` đã qua cổng đọc bài; (b) danh bạ cần trả thêm trường ngoài `{employeeId, fullName, avatarUrl}`; (c) `pollResultsTx` ủy quyền làm đỏ bất kỳ ca H-8/ẩn danh sẵn có.

## 7. Rủi ro & nợ

| # | Rủi ro | Xử lý |
|---|---|---|
| R1 | Danh bạ bị liệt kê có hệ thống (không throttler) | Chấp nhận có ghi (owner K2) — SOC-DEC-013 + lý do verdict D10. Rào: chỉ người đang làm, chỉ tên+avatar+employeeId, cặp `create:feed-kudos`, không phân trang |
| R2 | Poll ẩn danh ở audience nhỏ (nhóm 2–3 người) — đếm theo lựa chọn khử ẩn danh được | KHÔNG mới: `043` đã trả đếm cho mọi người xem từ BE-2B-1. Thẻ làm nó thụ động. Không có luật k-anonymity trong spec — ghi rủi ro, không đổi |
| R3 | `status:'open'` cũ quá `closesAt` (job trễ/tắt) | Hợp đồng y `043`; FE đã có `isPollAcceptingVotes` |
| R4 | Người nhận vinh danh ngoài audience của bài org_unit/nhóm (ghi không kiểm, NOTI-033 không kiểm) | Có sẵn, ngoài phạm vi; danh bạ cấp công ty không làm tệ hơn đường ghi vốn nhận MỌI employeeId của tenant |
| R5 | Avatar raw = fileId (FE không tải được) | Owner K4 giữ raw ⇒ seed **`S16-SOCIAL-AVATARPRESIGN-1`** (presign toàn module SOCIAL qua `AvatarPresignService`, bóc URL ký khỏi WS) |
| R6 | Bug FE có sẵn (đọc tĩnh, chưa đo chạy): `use-feed-actions.ts:126-130` gửi `{status}` vào `006` trong khi `moderateFeedPostSchema` `.strict()` nhận `{hidden,pinned,commentsLocked}`; spec FE ghim đúng body sai | Seed **`S16-SOCIAL-FEMODPAYLOAD-1`** (FE, ĐO TRƯỚC khi vá) |
| R7 | `social-posts.service.ts` > 800 dòng | Nợ có sẵn (D14) |
| R8 | Tài liệu trôi có sẵn: SPEC-16 §15 ghi 56 route; API-19 §7 khai room `feedgroup` chưa tồn tại (thuộc BE-2C); SPEC-16 §3.8/§18.2 nói WS = DTO REST | §15 sửa trong WO (docs/SPEC trong paths); §7 chỉ thêm dòng D7, không đụng phần `feedgroup` (BE-2C) |

## 8. Các bước

- **T0** backlog: `plan:` + mở `paths` + seed 2 WO nợ. Chạy baseline: census/ratchet/route-http-coverage (ghi số), `lane-db-setup.sh be2d`.
- **T1** contracts (D1/D2/D7/D9/D11) + spec contracts RED→GREEN; build dual.
- **T2** RED int-spec B1–B9 + R1–R10 + unit U1–U6 (chạy ĐỎ trên code cũ, ghi lại thông điệp đỏ).
- **T3** repo: `recipientsOfTx` tự do + CASE (D4) · `kudosBlocksByPostIdsTx` · poll SQL chung (D5) · idea (D6) · `searchKudosRecipientsTx` (D8).
- **T4** `social-post-blocks.ts` + mapper + `decorate` + `emitPostCreated`.
- **T5** route 059 (pair, DTO, controller, service).
- **T6** census/ratchet/route census regen/coverage floor.
- **T7** docs API-19 + SPEC-16 + permission-matrix.
- **T8** chạy int LANE_DB + mutant 1–9 + `check.sh --all --lane-db=be2d`.
- **T9** FULL gate → vá → PR.

## 9. Lượt 2 — vá theo plan-review (GHI ĐÈ §3–§5)

Nguồn: `P` = plan-reviewer · `D` = db-perf · `S` = security. Mọi HIGH đã tự xác minh lại trước khi vá.

**V1 · P-F1 + D-F2 (HIGH) — timestamptz thô.** Đo: `drizzle-orm@0.45.2/node-postgres/session.js:26-30` ép parser TIMESTAMPTZ thành `(val) => val` ⇒ `tx.execute` trả chuỗi `2026-09-29 08:46:14+00` (không `T`) — FE `z.string().datetime({offset:true})` ⇒ ZodError trên HTTP 200 = feed trắng. Vá D5: hàng thô khai `closes_at: string | null`, đổi bằng `new Date(raw).toISOString()`; mọi đếm `Number()`. Fixture B3 có `closesAt` khác null + một poll đã đóng. B1/B3/B4 parse response bằng `feedPostPageSchema`/`feedPostSchema`. **Mutant 10**: bỏ bước ISO ⇒ B3 đỏ.

**V2 · D-F1 (HIGH) — lưới H-8 không tồn tại.** Đo: `grep "H-8" social-be2b1-polls.int-spec.ts` rỗng; `vote-conflict.spec` stub `pollResultsTx`. Vá: **U7** unit `pollResultsTx` với fakeTx ⇒ đúng 1 `execute`, 0 `select`; **B10** int `captureQueries` trên `043`/`041`/`044` ⇒ đúng MỘT câu chạm `feed_poll_votes` và câu đó chứa `feed_poll_options`, neo `totalVoters>0`. **Mutant 7b**: tách thành hai câu ⇒ U7 + B10 đỏ.

**V3 · P-F2/F5 + S-1/S-2 + D-F3/F4/F5 — bỏ LIKE.** Đo PG local: `f_unaccent(U&'\FF05an')` = `%an` (fullwidth `％ ＿ ＼ ﹪ ﹨` thành ký tự đại diện SAU khi JS đã thoát); `ESCAPE '\'` trong template JS nấu thành `ESCAPE ''`; mutant 5 cũ không đỏ được. Vá D8: khớp đầu-từ bằng `strpos(' ' || lower(norm(users.fullName)), ' ' || lower(f_unaccent(q))) > 0`, với `norm` = `f_unaccent` + đổi NBSP/U+2007/U+202F/tab thành dấu cách + gộp dấu cách đôi. Không ký tự đại diện ⇒ không `escapeLike`, không `ESCAPE`. Đo: `％an` → «Trần Tuấn» = 0 · `an` → «Nguyễn Văn An» > 0 · `an` → «Trần Tuấn» = 0. Zod gộp `\s+` thành một dấu cách (luỹ đẳng). **R3b**: «Lê A_c» + «Lê Abc» — `q='a_c'` ⇒ đúng [A_c]; `q='ab%'` ⇒ 0 cạnh neo `q='ab'` ⇒ [Abc]; `q='％an'` ⇒ không Tuấn cạnh neo `q='tuan'`. **Mutant 5'**: đổi sang `ILIKE '%'||q||'%'` ⇒ R3b đỏ. U6 bỏ.

**V4 · P-F4 + S-3 — K1 áp cho xoá mềm ở CẢ HAI bảng** (diễn giải bảo thủ, ghi trong PR để owner phản đối nếu khác ý): `fullName`/`avatarUrl` chỉ chiếu khi `employee_profiles.deleted_at IS NULL AND users.deleted_at IS NULL` (LEFT JOIN — không TK vẫn qua); `isFormerEmployee = ep.deleted_at IS NOT NULL OR users.deleted_at IS NOT NULL OR ep.status <> 'active'`. TK `locked`/`suspended` GIỮ tên (S6). B2 thêm hàng «TK xoá mềm, hồ sơ active» ở thẻ và `047`.

**V5 · D-F8 + P-F6 — builder, không alias.** D4/D8 là drizzle builder không alias bảng, mọi cột nội suy; `fullName: sql\`CASE WHEN … THEN ${users.fullName} END\`` trong object `.select` (census vẫn PROJECTION, khoá giữ). `searchKudosRecipientsTx` = `.select({…, fullName: users.fullName, …}).from(employeeProfiles).innerJoin(users, …)` — không `tx.execute`, không chữ `full_name` trong template. T6 chạy ratchet TRƯỚC khi nâng trần: phải đỏ đúng khoá `searchKudosRecipientsTx:users.fullName`, khoá `recipientsOfTx` không đổi.

**V6 · P-F3 + D-F6 — B7'.** Làm nóng một request; trang A = k bài mỗi type (kudos/poll/idea, kèm mention), trang B = 4k cùng phối trộn; mỗi bảng con (`feed_polls` · `feed_ideas` · `feed_kudos` · `feed_kudos_recipients`) có ĐÚNG MỘT câu chạm ở cả hai trang (regex nhận cả tên có ngoặc kép lẫn không); trang chỉ `share` ⇒ 0; neo mọi khối có mặt. B7' là cổng mutant 7.

**V7 · D-F7 + D-F13 — SQL poll.** `FROM feed_polls p LEFT JOIN LATERAL (count DISTINCT v.user_id WHERE v.company_id = p.company_id AND v.poll_id = p.id) tv ON true LEFT JOIN feed_poll_options o ON (o.company_id, o.poll_id) = (p.company_id, p.id)` — LATERAL bám `p` trước options. Hàng `o.id IS NULL` chỉ góp cột poll + `totalVoters`. `pollResultsTx` trượt map ⇒ `{options:[], totalVoters:0, myVote:[]}` (đúng hành vi hôm nay). **B9b**: poll 0 lựa chọn ⇒ thẻ `options:[]`, `043` y hệt. U1 fake trả ≥1 hàng kudos.

**V8 · P-F10** — `company_id` tường minh ở mọi bảng, mọi join, cả LATERAL/EXISTS.

**V9 · P-F8 + D-F9** — `badge` chỉ dựng khi `badgeId`, `badgeCode`, `badgeName` đều khác null; `badgeId` có mà thiếu tên ⇒ `logger.error` + bỏ huy hiệu, không `?? ""`. Cùng luật ở `047` và khối thẻ.

**V10 · P-F9** — R2 kiểm 403 + `message` chứa `AUTH-ERR-SCOPE-DENIED` (khuôn `social-be3c-recycle-restore.int-spec.ts:484`); không sửa mã (nợ SCOPEDENIEDCODE-1).

**V11 · P-F7** — `social-api-polls-ideas.spec.ts:10` import schema poll từ đường dẫn file ⇒ đổi sang `./social-feed-blocks` ở T1.

**V12 · P-F11** — `done_when[0]` của WO viết lại theo K2/K3.

**V13 · S-4** — vắng khỏi danh bạ là oracle `users.status` (thẻ hiện người TK khoá như đang làm): chấp nhận có ghi trong verdict D10 + SOC-DEC-013 (cùng lớp sinh nhật `026`).

**V14 · S-5** — vai tuỳ biến chỉ có `create:feed-kudos` mở được danh bạ mà không tạo được kudos: giữ K3, **R1b** ghim 200, ghi bất đối xứng vào SOC-DEC-013 + permission-matrix.

**V15 · S-6** — avatar raw là cột đa-người-ghi (đầu độc được): notes `S16-SOCIAL-AVATARPRESIGN-1` + `S16-SOCIAL-FE-2C` — FE KHÔNG vẽ `avatarUrl` làm `src`/`href` tới khi presign xong.

**V16 · S-7 + D-F10** — B2 tạo kudos với người nhận còn sống RỒI mới xoá mềm (đường ghi 422 hồ sơ đã xoá); fixture có `avatar_url` khác null ở người bị xoá và một người sống (neo). Mutant 3 tách **3a** fullName · **3b** avatarUrl · **3c** isFormerEmployee.

**V17 · D-F12** — lý do verdict `recipientsOfTx` hai phần: `047` cùng tx với `listKudosTx`; thẻ = `post_id` từ câu cổng ở tx TRƯỚC (cùng căn cứ verdict `loadMentionsForTargets`), bỏ «cùng ảnh chụp» cho vế thẻ.

**Chế độ tiết kiệm (owner chọn 29/09 khi chi phí chạm CRITICAL):** thi công solo trong phiên chính; FULL gate cuối = `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (bỏ `typescript-reviewer`; typecheck + lint vẫn chạy).

**ĐO CỔNG sau lượt 2:** 1 · 2 · 3a/3b/3c · 4 · 5' · 6 · 7 (B7') · 7b · 8 · 9 · 10. Ca mới: U7 · B9b · B10 · R1b · R3b.

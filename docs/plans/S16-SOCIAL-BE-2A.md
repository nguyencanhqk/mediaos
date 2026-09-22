# Plan S16-SOCIAL-BE-2A — NHÓM (`SOCIAL-API-030..039` + nhánh `audience='group'` của `002`)

> 🔴 **Crown.** Membership là quyền ở tầng HÀNG mà RLS không biết (SPEC-16 §3.4). Đây là phần DUY NHẤT của track B chạm `visiblePostCondition` — vị từ dùng chung cho **cả màn hình lẫn đường tải tệp** ⇒ một nhánh OR lỏng là rò bài riêng tư Ở HAI ĐƯỜNG.
>
> **Nguồn sự thật:** [API-19](<../API Design/API-19_SOCIAL_API_Design.md>) §5.1 dòng 97-108 · [SPEC-16](<../SPEC/SPEC-16 SOCIAL.md>) §3.4/§12/§13.6/§18 · [BE-1](S16-SOCIAL-BE-1.md) · [BE-1B](S16-SOCIAL-BE-1B.md) §13 · [DB-2](S16-SOCIAL-DB-2.md) §10. Khuôn: `apps/api/src/tasks/project-access.service.ts` (role-là-hàng).
>
> **Lịch sử:** tách 22/09/2026 từ WO `S16-SOCIAL-BE-2` sau khi `plan-reviewer` trả **BLOCK** (4 CRITICAL + 7 HIGH). Owner chốt tách 3 (BE-2A nhóm · BE-2B poll/ý-tưởng/kudos · BE-2C realtime). Bản plan này đã vá toàn bộ finding áp dụng cho BE-2A.

---

## §0. Phạm vi & nợ

### 0.1 Route trong phạm vi

`030..039` (10 route) + **nhánh `audience='group'` của `002`** (hôm nay bị `assertWriteAudience` ném 422 cứng).

**KHÔNG thuộc WO này:** `040..048` + 3 nhánh `type` của `002` → BE-2B · room WS → BE-2C. Hai WO đó **nối tiếp, không song song** (cùng chạm `social-posts.service.ts#create` · `social-route-pairs.const.ts` · `social.errors.ts` · `social.module.ts`).

### 0.2 Nợ mang sang — trạng thái

| Nợ | Nội dung | Xử lý |
| --- | --- | --- |
| (a) DB-2 | Seeder `social.master-data` (5 huy hiệu) chưa đăng ký `MasterDataSeederRegistry`; mig `0582` chỉ seed company ĐANG TỒN TẠI ⇒ PROD cài mới (migrate trước boot) ship catalog RỖNG | ✅ **ĐÃ VÁ 22/09** (commit `7fdfe8f1`): `SocialMasterDataSeeder` + `SocialSeedRegistrar` + `SeedModule`, int-spec 3/3 xanh trên lane `mediaos_be2a`. Xem M-f ở §12 |
| (d) DB-2 | `childTables` của `deleteWithFkRetry` thiếu `feed_*` | ✅ **ĐÃ ĐO 22/09 — KHÔNG vá** (bằng chứng M25/M26 ở §1.b). Xin chữ ký S1 ở PR |
| (f) DB-2 | DTO phải `.pick()+.strict()`, không `.extend()` core schema | **Luật của WO** — §3.3 |
| (g)6 BE-1B | `unackedEmployeesFor` trả RỖNG CÂM cho `audience='group'` | **Vá TRƯỚC khi mở nhóm** (Bước 1.1). Khi nhóm sống, "0 người chưa đọc" đứng cạnh nửa "đã đọc" có số thật sẽ đọc thành "cả nhóm đã đọc xong" |
| (b)(e) DB-2 | Poll: `single_choice`, `optionId ∈ poll`, chặn UPDATE cờ poll | → **BE-2B** (done_when của nó đã ghi đầy đủ, kể cả việc KHÔNG được xả bằng lập luận "không có route PATCH") |
| (c) DB-2 | NOTI-034 `dedupe_strategy='None'` | **Chấp nhận** — theo đúng catalog `0581`. §7.2 |
| (g)1-5,7,8 BE-1B | Hiệu năng/độ chính xác route BE-1B | Không chạm. §10 |

---

## §1. Bảng phép đo (đã chạy thật)

> Mỗi ô = lệnh đã chạy + kết quả. `plan-reviewer` đã **kiểm lại độc lập 9/9** ô liên quan; hai ô bản trước sai đã sửa (M5, M13b).

| # | Nội dung | Kết quả đo | Nguồn |
| --- | --- | --- | --- |
| M1 | Head migration | **`0585`** (`0584`/`0585` là BE-1B) | `apps/api/migrations/` |
| M2 | Route đã build | `001..029` (BE-1: 001-019 · BE-1B: 020-029) | `social.controllers.ts`, `social-b.controllers.ts` |
| M3 | `SOCIAL_ROUTE_PAIRS` | 29 khoá; `dataScope?: "Company"\|"Department"` (BE-1B); `pair()` mặc định `companyFloor:true`; census ghim **29 route** | `social-route-pairs.const.ts:87-197`, `social-two-layer-guard-census.unit-spec.ts:196` |
| M4 | Mã lỗi còn trống | `012..020,022` (comment tự khai). Nghĩa khớp SPEC §12 từng mã. BE-2A dùng: `012` nhóm 404 · `013` trùng 409 · `014` vai trò 403 · `015` owner cuối 409 | `social.errors.ts:21`, SPEC-16 `:322-332` |
| M5 ⚠️SỬA | Core schema contracts | **CHỈ CÓ 3**: `feedGroupMemberCoreSchema` · `feedPollCoreSchema` · `feedIdeaCoreSchema` + 5 enum. **0 hit** cho `feedGroupCoreSchema` ⇒ BE-2A **tự dựng**, không mở rộng | `packages/contracts/src/social.ts:250-372` (grep xác nhận 0 hit) |
| M6 | `feed_group_members` | **DELETE CỨNG có chủ ý** — ngoại lệ đã CHỐT của BẤT BIẾN 2 (DB-17 §4.9), vết ở `audit_logs` | `db/schema/social.ts:499-836` |
| M7 | `deleteWithFkRetry` | `childTables` mặc định `["audit_logs"]`; `DELETE users` (`:853`) dùng **mặc định**; `DELETE companies` (`:868`) truyền `["audit_logs","dead_letter_alerts"]` | `test/helpers/seed.ts:432,853,868` |
| M9 | Ratchet coverage | `MIN_COVERED_COUNT = 661` | `route-http-coverage.e2e-spec.ts:355` |
| M10 | NOTI đã wire | Đúng **5** `registerSource`: MENTIONED·POST_COMMENTED·COMMENT_REPLIED·NEWS_PUBLISHED·POST_REPORTED ⇒ BE-2A chỉ còn **NOTI-034** | `social-noti-bridge.registrar.ts:137,151,162,176,190` |
| M11 | Audit `object_type` | `feed_group` **ĐÃ CÓ** (front-load `0579:58`) ⇒ **không cần migration** | `0579_*.sql:58` |
| M12 | Khuôn role-là-hàng | `assertProjectRoleTx(..., allowedRoles)` — **nhận tập role theo từng lời gọi**, không một tập cứng | `tasks/project-access.service.ts:41-156` |
| M13 ⚠️SỬA | SPEC §13.6 bộ đếm | Liệt **ĐÚNG 5 cột**; `feed_groups.member_count` là cột **DUY NHẤT** của WO này (`feed_poll_options.vote_count` **KHÔNG** trong danh sách — bản trước trích sai "2 cột"). SPEC đòi **script đối soát cả năm cột** | SPEC-16 `:395-405` |
| M14 | `visiblePostCondition` | 3 vế AND: `deleted_at IS NULL` · status · audience. Nhánh `group` hiện **luôn FALSE**; `isAuthor` luôn được OR vào (tác giả thấy bài mình ở mọi audience). Nhận `SocialViewerContext`, có tham số `alias` | `social-access.service.ts:148-185` |
| M15 🔴 | Đường TẢI TỆP | `resolveViewerContext` phục vụ `FilePolicyService`/`SocialFileResolver` và **dùng chung `visiblePostCondition`**. Docblock ghi thẳng: *"cổng MÀN HÌNH và cổng ĐƯỜNG TẢI buộc phải nói cùng một câu"* ⇒ đổi nhánh group là đổi CẢ cổng tải | `social-access.service.ts:131-148`, `social-file.resolver.spec.ts:45` |
| M16 🔴 | `assertWriteAudience` | **SYNC**, chữ ký `(actor, audience, orgUnitId)` — **không** nhận `tx`/`groupId`; gọi ở `social-posts.service.ts:153` **TRƯỚC** `withTenant` ở `:155`. Nhánh `group` ném 422 cứng | `social-access.service.ts:355-369`, `social-posts.service.ts:153-155` |
| M17 | `MasterDataSeederRegistry` | `register(seeder: ModuleMasterDataSeeder)`, đòi `seedKey` (duy nhất toàn hệ) + `seedVersion` khác rỗng; module gọi lúc `onModuleInit`. Khuôn: `attendance/att-master-data.seeder.ts` + `att-seed.registrar.ts` | `foundation/seed/master-data-seeder.registry.ts:20-41` |
| M18 | API-19 vai trò từng route | `033` = `owner\|admin` **hoặc** `manage:feed-group` · **`034` = `owner` nhóm** hoặc `manage:feed-group` (**admin KHÔNG được xoá**) · `038`/`039` = `owner\|admin` hoặc `manage` · `038` làm cả **"Duyệt / từ chối / đổi vai trò"** | API-19 `:101-107` |

### 1.b Ô đo BỔ SUNG — vòng 2 (22/09/2026, sau `plan-reviewer` BLOCK lần 2)

> Ba ô "CHƯA ĐO" của bản trước đã đo xong (M19/M20); phần còn lại là số đo mà vòng review lôi ra —
> **bảng đo cũ đúng ở chỗ nó nhìn và mù ở chỗ nó không nhìn**.

| # | Nội dung | Kết quả đo | Nguồn |
| --- | --- | --- | --- |
| M19 | `0578` cấp `create:feed-group` cho vai nào | **cả 4 vai canonical** (`employee`·`manager`·`hr`·`company-admin`) @`Company`; `manage:feed-group` CHỈ `hr`+`company-admin` ⇒ ca ALLOW của `031` dùng vai bất kỳ, ca G8 **phải** dùng hr/company-admin | `0578_*.sql:87-90,96-97` |
| M20 | Ngưỡng coverage per-file `social-access.service.ts` | lines/funcs/stmts **90**, branches **85**. ⚠️ Chỉ CẮN dưới `test:cov:social`, mà script đó **liệt kê từng int-spec một** ⇒ int-spec mới ở `test/integration/**` phải được THÊM vào `apps/api/package.json:16`, nếu không test mới không tính vào cổng | `vitest.config.ts:144-148`; `package.json:16` |
| M21 🔴 | Số đường đọc đi qua `listFeed` | **NĂM**: `001` (`social-posts.service.ts:94`) · **`010` Đã lưu** (`:119`) · **`020` Tin tức** (`social-news.service.ts:78`) · `023` (`social-discovery.service.ts:52`) · `025` (`:108`). KHÔNG tồn tại "repo của 023/025" như bản trước viết | 5 call-site đã grep |
| M22 🔴 | Đường đọc thứ SÁU, KHÔNG qua `listFeed` | `countUnackedFor(tx, actor, visiblePostCondition(actor))` — badge "tin chưa đọc" nhận vị từ TRỰC TIẾP ⇒ lọc ở `listFeed` mà quên đường này = badge đếm bài mà danh sách không liệt (đúng lớp lỗi BE-1B vừa bịt) | `social-news.service.ts:69`; `social-news.repository.ts:91` |
| M23 🔴 | `listFeedQuerySchema` có `groupId` không | **KHÔNG** — 9 khoá, không có `groupId`; `listFeed` opts cũng không ⇒ cửa thoát "lọc đích danh `groupId`" của D-OWNER-5 **chưa tồn tại** | `packages/contracts/src/social-api.ts:256-269` |
| M24 | Thiếu `groupId` khi `audience='group'` | **Zod `superRefine` chặn trước ⇒ 400**, không tới service ⇒ `ERR-008` (422) là nhánh CHẾT (nhánh `org_unit` ở `social-access.service.ts:360-362` cũng đã chết cùng lý do) | `social-api.ts:314-321`; `social.dto.ts:35` |
| M25 | Writer bất đồng bộ ghi `feed_*` (nợ (d)) | **KHÔNG CÓ** — cả 8 file ghi `feed_*` đều nằm trên đường HTTP; 0 Cron/`@Processor`/outbox consumer ⇒ race "writer sống chèn lại hàng con" không tái lập được | census grep `insert(feed` / `INSERT INTO feed_` |
| M26 | FK `feed_kudos_badges → companies` — nợ (d) sau khi seeder thêm writer boot-time XUYÊN TENANT (`reconcileAllCompanies`) | **`confdeltype='c'` = ON DELETE CASCADE** (đo trên DB thật `mediaos_be2a`) ⇒ hàng mọc lại trong cửa sổ teardown KHÔNG chặn `DELETE FROM companies`; `created_by`/`updated_by` là NO ACTION nhưng seeder để NULL | `pg_constraint` |
| M27 | 3 emitter WS | **fail-closed** trên `audience !== 'company'` ⇒ hoãn BE-2C là AN TOÀN, bài nhóm không tự lọt ra room công ty. Ghi lại để lượt sau không "dọn dẹp" mất | `social-posts.service.ts:553`; `social-comments.service.ts:449`; `social-reactions.service.ts:246` |

**CÒN LẠI CHƯA ĐO** (đo ở đúng bước dùng, **không cộng tay**): số route census JSON sau khi thêm 10 route — §8 bước cuối.

---

## §2. Quyết định

### 2.1 Owner đã ký 22/09/2026

| # | Quyết định | Nội dung |
| --- | --- | --- |
| **D-OWNER-5** 🔴 | Bài nhóm public có vào feed chung không? | **KHÔNG.** `001` feed chung · `023` tìm kiếm · `025` trang cá nhân **LOẠI** `audience='group'` — TRỪ khi request lọc đích danh `groupId`. Giải mâu thuẫn nghĩa-đen của `done_when` cũ (vừa đòi "chỉ trả khi membership active" vừa đòi "public không cần tham gia"): hai câu nói về **hai đường khác nhau**, xem D3 |
| **D-OWNER-2** | Cơ chế room WS | Thêm `feedUserRoomName` (room ĐÁNH DẤU đã qua cổng `view:feed`) + join/leave động → **chuyển sang BE-2C**, không thuộc WO này |

### 2.1b Owner ký LƯỢT 2 — 22/09/2026 (sau `plan-reviewer` BLOCK: 5 CRITICAL + 7 HIGH)

| # | Quyết định | Nội dung |
| --- | --- | --- |
| **D-OWNER-6** 🔴 | D-OWNER-5 áp lên ĐƯỜNG NÀO trong 6 đường đọc (M21/M22) | **Chỉ ẩn khỏi feed khám phá.** LOẠI ở `001` · `023` · `025`. **GIỮ** ở `010` Đã lưu · `020` Tin tức · badge `countUnackedFor` — ba đường này là nội dung người dùng ĐÃ có quan hệ, và membership vẫn bị `visiblePostCondition` gác. **Badge và danh sách phải cùng MỘT tập** ⇒ không tái lập mâu thuẫn "badge 3, danh sách rỗng" mà BE-1B vừa bịt |
| **D-OWNER-7** 🔴 | Đường ĐỌC bài trong nhóm (C2: không có `groupId` ⇒ nhóm write-only) | **Thêm `groupId` vào `001` NGAY trong BE-2A**: `listFeedQuerySchema` + `listFeed` opts + **BẮT BUỘC vào `feedFingerprint`**. Lọc đích danh vẫn đi QUA `visiblePostCondition` — là bộ lọc, KHÔNG phải cửa hậu bỏ qua membership. Không mở route thứ 11 (API-19 §5.1 chỉ liệt `030..039`) |
| **D-OWNER-8** | Nghĩa `ERR-014`/`ERR-015` rộng hơn SPEC-16 §12 (M-a) | **Nới nghĩa + sửa SPEC-16 §12 trong CÙNG PR**: `ERR-014` = mọi 403 vai-trò-nhóm (`033`/`034`/`038`/`039`); `ERR-015` = mọi 409 "mất owner cuối" (`036`/`038`/`039`). Docs là nguồn sự thật ⇒ không để drift |
| **D-OWNER-9** | Vị trí kiểm "thiếu `groupId`" (M24) | **Giữ Zod 400**, sửa plan cho khớp code. KHÔNG đụng contracts dùng chung với FE. Ghi nợ: nhánh `AUDIENCE_KEY_MISSING` cho `org_unit` cũng đã là nhánh chết cùng lý do |

### 2.2 Chốt trong plan (suy được từ spec/code)

| # | Quyết định | Nội dung | Căn cứ |
| --- | --- | --- | --- |
| **D1** 🔴 | **Tách VISIBILITY khỏi FEED COMPOSITION** | `visiblePostCondition` trả lời *"actor ĐƯỢC PHÉP thấy bài này không"* — nhánh group thêm vào đây (D3). Việc *"bài này có nằm trong feed chung không"* là **bộ lọc RIÊNG** ở tầng repository của `001`/`023`/`025` (`audience <> 'group' OR group_id = :requestedGroupId`). **Tuyệt đối không nhồi D-OWNER-5 vào `visiblePostCondition`** — làm thế sẽ chặn luôn `003` chi tiết bài và **cổng tải đính kèm** (M15) | M14/M15; D-OWNER-5 |
| **D2** 🔴 | GHI bài vào nhóm | Actor phải là thành viên **`status='active'`** của group đó, **bất kể `public`/`private`** (API-19 `ERR-002` = "ghi vào nhóm actor không thuộc", không phân biệt visibility). Thiếu `groupId` ⇒ **400 Zod** (D-OWNER-9/M24 — `superRefine` chặn TRƯỚC service; `ERR-008` ở đây là nhánh CHẾT, đừng viết ca test theo nó) | SPEC §12; API-19 `:143`; M24 |
| **D3** 🔴 | ĐỌC bài `audience='group'` | Nhánh OR thứ ba của `visiblePostCondition`: **EXISTS** `feed_group_members` `status='active'` cho `(company, group, actor)` **HOẶC** group `visibility='public'`. EXISTS tương quan TRONG CÂU — **không** resolve mảng id trước (tập nhóm đổi liên tục, không chặn trước được như `orgUnitIds`). `isAuthor` giữ nguyên (tác giả luôn thấy bài mình). 🔴 **Hai ràng buộc bắt buộc:** (i) nhánh EXISTS JOIN `feed_groups` phải mang **`deleted_at IS NULL`** (D13/H1); (ii) bám **`t.groupId`** theo tham số `alias`, KHÔNG `feedPosts.groupId` (M-g — một JOIN có alias sẽ bám nhầm bảng, im lặng) | SPEC §3.4 (chỉ nói nhóm **kín**); SOC-DEC-006; M14 |
| **D4** 🔴 | Vị trí kiểm GHI — **MỘT call-site, TRONG tx** | `assertWriteAudience` đổi thành **async**, chữ ký `(tx, actor, audience, orgUnitId, groupId)`, và **chuyển vào trong** `withTenant` của `create()` (hôm nay nó đứng ngoài — M16). `SocialGroupAccessService` **chỉ nhận `tx`, CẤM tự mở `withTenant`** (lồng = treo IM LẶNG trên PgBouncer, pool `max:20` không `connectionTimeoutMillis`). Kiểm ở tx riêng TRƯỚC rồi ghi sau = TOCTOU, cấm. 🔴 Mở `group` còn **KÍCH HOẠT ba hàm fail-empty CÂM** — xem **D14**, phải vá CẢ BA | M16; bài học BE-1B; C4 |
| **D5** 🔴 | `assertGroupRoleTx` nhận **`allowedRoles` theo từng route** | Khuôn `assertProjectRoleTx`. `033` → `['owner','admin']` · **`034` → `['owner']`** · `038`/`039` → `['owner','admin']`. Mọi route thêm nhánh thoát `manage:feed-group` (+ audit). **Một tập role cứng dùng chung = admin xoá được nhóm, trái API-19 `:102`** | M12/M18 |
| **D6** 🔴 SỬA | Bất biến **≥1 owner ACTIVE** — TÁCH HAI LOẠI LUẬT (H7) | **(i) AUTHORIZATION**: `034` xoá nhóm là **owner-ONLY** (`allowedRoles=['owner']`) — đây mới là nội dung của `done_when`; `034` **KHÔNG** chịu bất biến đếm (đọc theo nghĩa đen "đếm owner còn lại sau thao tác" thì xoá nhóm LUÔN 409 = route bất khả thi, và hai reviewer sẽ đọc ra hai nghĩa). **(ii) BẤT BIẾN ĐẾM ≥1 owner active**: CHỈ `036` leave · **`038` đổi vai trò** (đường chuyển owner mà `done_when` của FE-2 đòi) · `039` mời ra ⇒ `ERR-015`. 🔴 **C3 — PHẢI KHOÁ HÀNG; `COUNT` trần là TOCTOU**: `SELECT 1 FROM feed_groups WHERE company_id=$ AND id=$ **FOR UPDATE**` (một neo dùng chung cho cả ba đường) TRƯỚC câu đếm. Không khoá thì dưới READ COMMITTED hai tx cùng đọc `count=2`, cùng qua cổng, cùng xoá **hai hàng KHÁC nhau** (không đụng khoá nào) ⇒ nhóm **0 owner, khoá vĩnh viễn**, `ERR-015` hoá trang trí, G5/G5b/G5c tuần tự vẫn xanh. Khuôn row-lock có sẵn: `attendance-adjustment.repository.ts:105` · `assets.repository.ts:316` · `auth.service.ts:1070` | M18; C3; H7 |
| **D7** 🔴 | Vị từ "nhân viên đang hoạt động" | `feed_group_members.status='active'` **KHÔNG** đồng nghĩa người đó còn làm việc — nghỉ việc **không** xoá mềm, hàng vẫn còn (`employee_profiles.status='resigned'`). MỌI tập người của WO kèm `employee_profiles.status='active'`, và khi JOIN `users` thêm `users.deleted_at IS NULL AND users.status='active'`. Áp cho: `037` danh sách thành viên · người nhận NOTI-034 · nợ (g)6. Khuôn có sẵn: `social-mentions.ts:195-201` | Bài học BE-1B (3 reviewer hội tụ) |
| **D8** | Vị trí code | `visiblePostCondition`/`assertWriteAudience` sửa **tại chỗ** ở `SocialAccessService` (một luật một bản). Logic THỰC THỂ nhóm (404 `ERR-012`, vai trò, CRUD) ở file mới `social-group-access.service.ts` | M12; CLAUDE.md §5 |
| **D9** 🔴 SỬA | `resolveActor` + cờ `manage:feed-group` | (i) **KHÔNG** thêm `create:feed-group` vào batch cố định — nó đã là **cặp route của `031`** (index [0]); thêm nữa là lặp đúng cặp, chính cái bẫy ghi ở `social-access.service.ts:64-69`. Batch đi 3→**4** vì đúng MỘT mục mới: `manage:feed-group`. (ii) 🔴 **Tuyên bố tường minh: `manage:feed-group` KHÔNG nới `visiblePostCondition`** — nó chỉ mở `033`/`034`/`037`/`038`/`039`. Lý do: `resolveViewerContext` (cổng ĐƯỜNG TẢI) có batch RIÊNG 1 cặp (`social-access.service.ts:134-148`); gắn cờ vào `resolveActor` mà quên đó ⇒ cổng màn hình rộng hơn cổng tải, đúng lớp lỗi M15 — và **G9 KHÔNG bắt được** vì G9 chỉ thử người ngoài nhóm thường | M14; H2 |
| **D10** 🔴 SỬA | Bộ đếm `member_count` — **bảng delta 7 dòng** (C5) | `bumpGroupMemberCount` theo khuôn `bumpPostCounter` (`UPDATE…SET x=x+delta…RETURNING`, cấm đọc-rồi-ghi, cấm `Math.max` ở JS), **cùng tx**. Delta THEO TRẠNG THÁI HÀNG, không theo tên route: `031` tạo nhóm (hàng owner/active) **+1** · `035` join nhóm **public** **+1** · `035` join nhóm **private** (`pending`) **0** · `038` approve (`pending→active`) **+1** · `038` reject **0** · `038` đổi vai trò **0** · `036`/`039` **chỉ −1 khi hàng bị xoá có `status='active'`** — suy delta từ **số hàng THẬT xoá** (`DELETE … WHERE status='active' … RETURNING`), không từ giả định. Thiếu vế `031` ⇒ bất biến §13.6 vỡ ngay thao tác ĐẦU TIÊN (nhóm mới: 1 hàng active, `member_count=0`); trừ nhầm hàng `pending` (huỷ yêu cầu qua `036`, mời ra hàng pending qua `039`) ⇒ chạm `CHECK member_count >= 0` ⇒ **500**, hoặc lệch âm hỏng CÂM | M13; SPEC §13.6; C5 |
| **D11** | `@Idempotent` | `done_when` đòi "**mọi POST**" ⇒ `031` create · `035` join · `036` leave đều có. Không im lặng bỏ sót | backlog `done_when` |
| **D12** | Body `038` | `.strict()`, hai dạng loại trừ nhau: `{decision:'approve'\|'reject'}` (cho hàng `pending`) **hoặc** `{role:'admin'\|'member'\|'owner'}` (cho hàng `active`). `role:'owner'` **hợp lệ** — đó là đường chuyển owner (D6) — nhưng chỉ `owner` hiện tại hoặc `manage:feed-group` được dùng, và phải giữ bất biến ≥1 owner. 🔴 **M-d**: gửi dạng `{role:'admin'}` hoặc `{role:'owner'}` lên một hàng `pending` chạm `chk_feed_group_members_pending_role` (`social.ts:570`: `status='active' OR role='member'`) ⇒ 23514 ⇒ **500**. Server phải tự bắt "dạng body không khớp trạng thái hàng" và trả **409 `ERR-013`** TRƯỚC khi chạm DB (ca RED G16) | API-19 `:106`; D5/D6; M-d |

| **D13** 🔴 MỚI | Vòng đời **xoá mềm nhóm** (H1) | `feed_groups.deleted_at` (`social.ts:519`) KHÔNG xuất hiện ở bất kỳ vị từ nào của bản plan trước. Luật một dòng: **MỌI vị từ chạm `feed_groups` mang `deleted_at IS NULL`** — `visiblePostCondition` nhánh group (D3) · `assertGroupVisibleTx` · kiểm GHI D2 · `030` · `035` · `037`. Thiếu nó: sau `034`, thành viên cũ vẫn **đăng bài được** vào nhóm đã xoá, vẫn đọc bài cũ, vẫn `035` xin vào được; nhóm public đã xoá vẫn phát bài cho cả công ty |
| **D14** 🔴 MỚI | **BA** hàm tập-người phải vá cho nhánh `group`, không phải một (C4) | (1) `unackedEmployeesFor` (`social-news.repository.ts:187`) — nợ (g)6 đã biết. (2) **`audienceUserIds` (`:265`)** — sinh đôi cách đó 78 dòng: tin `type='news'` + `audience='group'` là HỢP LỆ theo CHECK (`social.ts:140-153`) ⇒ `enqueueNewsPublishedNoti` (`social-posts.service.ts:205,427`) nhận tập RỖNG ⇒ **NOTI-031 không tới ai**, trong khi `022` (sau khi vá g6) lại liệt đúng danh sách "chưa đọc" — hai đường nói ngược nhau, đúng lý lẽ plan dùng để đòi vá (g)6 trước. (3) **`resolveMentions` (`social-mentions.ts:239-246`)** — `inAudience` cho `group` = false với MỌI người ⇒ mọi @mention trong bài/bình luận nhóm bị **bỏ IM LẶNG** (vẫn 201 + `droppedMentions[]`, không lỗi, không log); 4 call-site `social-posts.service.ts:180`·`:265` và `social-comments.service.ts:163`·`:240`; hàm phải nhận thêm `groupId` (hôm nay `:183` chỉ truyền `{audience, orgUnitId}`). Cả ba dùng CÙNG vị từ EXISTS membership `active` + D7. Docblock `social-mentions.ts:165` ("`group` ⇒ KHÔNG BAO GIỜ tới đây") phải sửa — D4 làm câu đó thành SAI |

### 2.3 Cần chữ ký ở PR

| # | Vấn đề | Đề xuất |
| --- | --- | --- |
| **S1** | **Nợ (d) "đo rồi có thể không vá"** — "không tái lập được ⇒ không vá" là chấp nhận rủi ro teardown, không phải kết luận kỹ thuật | Ghi kết quả đo vào PR, owner ký |
| **S2** | **Ranh giới `047`/`048` BE-2B ↔ BE-3** — `src` của backlog ghi literal BE-2 `~026..040`, BE-3 `~041..045`; title lại nói khác; API-19 §15 gom `047..051` một cụm | Không chặn BE-2A. Chốt khi mở BE-2B, và sửa `src` của CẢ HAI WO |

---

## §3. Cấu trúc file

### 3.1 File mới (`apps/api/src/social/`)

| File | Trách nhiệm | ~dòng |
| --- | --- | --- |
| `social-group-access.service.ts` | `getMembershipTx(tx, companyId, groupId, userId)` → hàng hoặc `null` · `assertGroupVisibleTx` (404 `ERR-012`) · `assertGroupRoleTx(tx, actor, groupId, allowedRoles)` (403 `ERR-014`, có nhánh thoát `manage:feed-group`) · `assertLastOwnerGuardTx` (409 `ERR-015`, D6). **Chỉ nhận `tx` — cấm mở `withTenant`** | 190-230 |
| `social-groups.repository.ts` | `feed_groups` CRUD: `listGroups` (public ∪ nhóm actor là thành viên) · `createGroupTx` (nhóm + hàng `owner`/`active` cùng tx) · `getGroupTx` · `updateGroupTx` · `softDeleteGroupTx` | 200-240 |
| `social-group-members.repository.ts` | `feed_group_members`: `joinTx` (public→`active`, private→`pending`, trùng→bắt `23505`→`ERR-013`) · `leaveTx` (DELETE cứng) · `listMembersTx` (D7) · `decideMemberTx` · `removeMemberTx` · `countActiveOwnersTx` | 200-240 |
| `social-groups.service.ts` | `030..039` — hoist `resolveActor` TRƯỚC tx, bump `member_count` trong tx, audit `feed_group`, NOTI-034 | 230-270 |
| `social-groups.controller.ts` | 10 route; TĨNH trước `{id}`; `ParseUUIDPipe` cấp method mọi `@Param` | 150-180 |
| `social-master-data.seeder.ts` + `social-seed.registrar.ts` | Nợ (a) — khuôn `att-master-data.seeder.ts`/`att-seed.registrar.ts`; `seedKey='social.master-data'`, `seedVersion` khác rỗng; 5 huy hiệu `ON CONFLICT DO NOTHING` | 70-100 |

Tách `repository` thành **hai file** ngay từ đầu (bản trước gộp, ước lượng chạm 320 dòng) — `feed_groups` và `feed_group_members` là hai bảng, hai vòng đời.

### 3.2 File sửa

| File | Sửa gì |
| --- | --- |
| `social-access.service.ts` | `visiblePostCondition` +nhánh OR group (D3) · `assertWriteAudience` → **async, nhận `tx`+`groupId`** (D4) · `resolveActor` batch 3→4 (D9) · `SocialActor`/`SocialViewerContext` +cờ |
| `social-posts.service.ts` | **Chuyển** lời gọi `assertWriteAudience` từ `:153` (ngoài tx) **vào trong** `withTenant` (D4) · bỏ `groupId: null` cứng ở `:167` |
| `social-posts.repository.ts` (`listFeed` — **MỘT hàm phục vụ NĂM route**, M21) | (i) Bộ lọc D-OWNER-6 ở **tầng feed**, KHÔNG nhồi vào `visiblePostCondition` (D1) — áp **theo call-site**, xem bảng 6 đường đọc ngay dưới. (ii) **+`groupId`** vào opts (D-OWNER-7) |
| `packages/contracts/src/social-api.ts` + `social-feed-cursor.ts` | `listFeedQuerySchema` **+`groupId: uuid().optional()`**; 🔴 **`feedFingerprint` PHẢI chứa `groupId`** — quên ⇒ con trỏ của feed thường dùng lại được cho feed nhóm ⇒ phân trang SAI IM LẶNG (đúng thứ `fingerprintFeedFilter` sinh ra để chặn) |
| `social-mentions.ts` | D14(3) — `inAudience` nhánh `group` (EXISTS membership active + D7) + hàm nhận thêm `groupId`; sửa docblock `:165` |
| `docs/SPEC/SPEC-16 SOCIAL.md` §12 | D-OWNER-8 — nới nghĩa `ERR-014`/`ERR-015` trong **CÙNG PR** (docs là nguồn sự thật, không để drift) |
| `apps/api/package.json` (`test:cov:social`) | M20 — thêm int-spec mới của BE-2A; script liệt kê TỪNG spec nên spec không có tên trong đó **không tính vào cổng coverage** |
| `social-file.resolver.ts` | 🔴 Kiểm lại: nhánh group mới của `visiblePostCondition` đi thẳng vào cổng tải (M15). Không sửa logic, nhưng **phải có ca test** (G9) |
| `social-counters.ts` | +`bumpGroupMemberCount` (D10) |
| `social-route-pairs.const.ts` · `social.errors.ts` · `social.dto.ts` · `social.module.ts` | +10 route · +4 mã lỗi · +DTO · +provider (append, không rewrite) |
| `packages/contracts/src/social.ts` + `social-api-groups.ts` (mới) | `feedGroupCoreSchema` (M5 — dựng mới) + DTO 10 route. File riêng theo khuôn `social-api-b.ts` |
| `social-news.repository.ts` (nợ g6 + C4) | **HAI hàm**: `unackedEmployeesFor` (`:187`) **và `audienceUserIds` (`:265`)** — D14(1)(2) |
| `notifications/social-noti-bridge.registrar.ts` | +`registerSource` NOTI-034 — **eventCode VERBATIM theo `0581`**: `SOCIAL_GROUP_JOIN_DECIDED` |
| `test/helpers/seed.ts` | Nợ (d), **chỉ khi đo được race** |

### 3.2b 🔴 Sáu đường đọc — D-OWNER-6 áp ở đâu (bảng CHỮ KÝ, C1)

> `listFeed` là **một hàm phục vụ năm route** (M21) + một đường thứ sáu nhận vị từ trực tiếp (M22).
> Nhét bộ lọc vào `listFeed` là cắn luôn `010`/`020`; nhét ở ba service call-site là để lọt.
> ⇒ Bộ lọc là **tham số của `listFeed`** (`excludeGroupAudience: boolean`), caller quyết định.

| # | Đường | Hàm | Bài `audience='group'` | Vì sao |
| --- | --- | --- | --- | --- |
| `001` | `GET /social/feed` | `listFeed` (`social-posts.service.ts:94`) | **LOẠI** — trừ khi có `groupId` đích danh (D-OWNER-7) | Feed khám phá |
| `010` | `GET /social/saved` | `listFeed` (`:119`, `savedByActorOnly`) | **GIỮ** | Chính actor đã bấm lưu; ẩn đi = `savedByMe=true` mà không thấy bài, hai đường nói ngược nhau |
| `020` | `GET /social/news` | `listFeed` (`social-news.service.ts:78`, `type:'news'`) | **GIỮ** | Tin tức đăng vào nhóm vẫn là tin của người đó |
| `023` | tìm kiếm tsvector | `listFeed` (`social-discovery.service.ts:52`) | **LOẠI** | Khám phá |
| `025` | trang cá nhân | `listFeed` (`:108`) | **LOẠI** | Khám phá |
| badge | `countUnackedFor` | **KHÔNG qua `listFeed`** (`social-news.service.ts:69`) | **GIỮ** — cùng tập với `020` | 🔴 Lệch với `020` ⇒ "badge 3 tin chưa đọc, danh sách rỗng, HTTP 200" — đúng lớp lỗi BE-1B vừa bịt (`social-news.service.ts:103-107`) |

Ca G4b phải phủ **cả `010` và `020`** (neo dương + neo âm) và G17 phải assert **badge == số dòng liệt kê được**.

### 3.3 Luật DTO (nợ f)

Mọi DTO ghi: `.pick()` từ core schema **rồi** `.strict()`. Cấm `.extend()` thẳng — `feedGroupMemberCoreSchema` mang `role`/`status`/`userId` và **không** `.strict()`; dùng thẳng làm body = người xin vào tự gửi `{role:'owner', status:'active'}`.

---

## §4. Bảng route

| Mã | Method · Path | Tầng-1 | `allowedRoles` (D5) | Tầng-2 | Idem | Audit | NOTI | Lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `002`+group | `POST /social/posts` (`audience=group`) | `create:feed-post` (sàn) | — | D2/D4: member `active` **trong tx**, nhóm `deleted_at IS NULL` (D13) | ✅ | — | — | `ERR-002`; thiếu `groupId` ⇒ **400 Zod** (D-OWNER-9) |
| `001`+`groupId` | `GET /social/feed?groupId=` | `view:feed` | — | D-OWNER-7: lọc đích danh, vẫn QUA `visiblePostCondition`; `groupId` vào `feedFingerprint` | — | — | — | cursor lệch `groupId` ⇒ **400** |
| `030` | `GET /social/groups` | `view:feed` | — | public ∪ nhóm của actor (**không lộ nhóm private ngoài**) | — | — | — | — |
| `031` | `POST /social/groups` | `create:feed-group` | — | tạo + hàng `owner`/`active` cùng tx | ✅ | — | — | — |
| `032` | `GET /social/groups/{id}` | `view:feed` | — | `assertGroupVisibleTx` | — | — | — | `ERR-012` |
| `033` | `PATCH /social/groups/{id}` | `view:feed` | `['owner','admin']` | +thoát `manage:feed-group` | — | khi qua `manage` | — | `ERR-012`,`ERR-014` |
| `034` | `DELETE /social/groups/{id}` | `view:feed` | **`['owner']`** 🔴 | +thoát `manage`; xoá mềm. **KHÔNG** chịu bất biến đếm owner (D6-i, H7) | — | khi qua `manage` | — | `ERR-012`,`ERR-014` |
| `035` | `POST /social/groups/{id}/join` | `view:feed` | — | public→`active`, private→`pending`; trùng ⇒ **`isUniqueViolationOf(err, 'feed_group_members_pk')`** → `ERR-013` (H6: KHÔNG bắt `23505` trần — luật đã ghi ở `social.errors.ts:140-150`) | ✅ | — | — | `ERR-012`,`ERR-013` |
| `036` | `POST /social/groups/{id}/leave` | `view:feed` | — | D6 owner cuối → 409 | ✅ | — | — | `ERR-015` |
| `037` | `GET /social/groups/{id}/members` | `view:feed` | — | membership HOẶC `manage`; D7 | — | — | — | `ERR-012` |
| `038` | `PATCH /social/groups/{id}/members/{uid}` | `view:feed` | `['owner','admin']` | D12 body; **D6-ii bất biến owner (FOR UPDATE)**; delta D10 | — | ✅ `feed_group` | `034` | `ERR-014`,`ERR-015`, **`ERR-013`** (body lệch trạng thái hàng — M-d) |
| `039` | `DELETE /social/groups/{id}/members/{uid}` | `view:feed` | `['owner','admin']` | **D6** | — | ✅ `feed_group` | — | `ERR-014`,`ERR-015` |

---

## §5. Deny-path RED trước + ALLOW đối chứng

> Luật: **mỗi DENY có ALLOW đối chứng**. Assert phủ định trên tập RỖNG là deny vacuous — luôn đặt neo dương (`toContain` + `length > 0`) trước.

| # | DENY | Kỳ vọng | ALLOW đối chứng |
| --- | --- | --- | --- |
| G1 | Người ngoài nhóm **private** đọc **bài** trong nhóm (`003`) | 404 `ERR-001` | Thành viên `active` đọc được đúng bài đó |
| G2 | Người ngoài nhóm private đọc **chính nhóm** (`032`) | 404 `ERR-012` | Thành viên đọc được; nhóm public đọc được không cần tham gia |
| G3 | Ghi bài `audience='group'` vào nhóm không thuộc (`002`) — **cả public lẫn private** | 403 `ERR-002` | Member `active` đăng được |
| G4 | — | Bài nhóm **public** đọc được qua đường nhóm khi không là thành viên (đối chứng D3 nhánh (a) không chặn nhầm) | — |
| **G4b** 🔴 SỬA | Bài nhóm **KHÔNG** xuất hiện ở `001` / `023` / `025`; **CÓ** xuất hiện ở `010` Đã lưu và `020` Tin tức (D-OWNER-6 — bảng §3.2b) | Vắng ở 3 đường, **có mặt** ở 2 đường | Lọc đích danh `groupId` ở `001` ⇒ **có mặt**. Bốn chiều, không phải một |
| **G17** 🔴 MỚI | Badge `countOnly` của `020` vs số dòng `020` thật sự liệt kê được, khi có tin nhóm chưa đọc | **BẰNG NHAU** (M22) | — |
| **G15** 🔴 MỚI | Con trỏ lấy ở `001` **không** `groupId`, lật trang lại kèm `groupId` (và ngược lại) | **400** — `feedFingerprint` bắt được (D-OWNER-7) | Cùng `groupId` ⇒ lật trang bình thường |
| G5 | `owner` duy nhất rời nhóm (`036`) | 409 `ERR-015` | Có owner thứ hai ⇒ rời được |
| **G5b** 🔴 | Admin hạ vai trò owner **cuối cùng** xuống `member` qua `038` | 409 `ERR-015` | Chuyển owner đúng cách (nâng B lên `owner` **trước**, rồi hạ A) ⇒ 200, nhóm luôn ≥1 owner |
| **G5c** 🔴 | Mời ra owner cuối cùng qua `039` | 409 `ERR-015` | — |
| **G5d** 🔴 MỚI (C3) | **ĐUA THẬT**: hai owner cùng gọi `036` ĐỒNG THỜI (khuôn `attendance-adjustment.int.spec.ts:520-523`) | Sau đua: `COUNT(owner active) >= 1` — **bất biến ĐẾM ĐƯỢC**, không phải "409 HOẶC hội tụ" | Một trong hai rời thành công |
| **G12** 🔴 MỚI (D13/H1) | Sau `034` xoá mềm nhóm: thành viên cũ `002` đăng bài vào nhóm đó · đọc bài cũ trong nhóm · `035` xin vào · nhóm public đã xoá còn lộ bài không | 404 `ERR-012` / bài 404 `ERR-001` / vắng mặt ở mọi đường liệt | Trước khi xoá, cả ba đường đều chạy được (neo dương) |
| **G13** 🔴 MỚI (D14-3) | @mention một thành viên trong bài/bình luận thuộc nhóm | Mention **được ghi nhận**, KHÔNG rơi vào `droppedMentions[]` | Mention người NGOÀI nhóm ⇒ rơi vào `droppedMentions[]` (fail-closed vẫn đúng) |
| **G14** 🔴 MỚI (D14-2) | Tin `type='news'` + `audience='group'` + `requiresAck` | NOTI-031 tới **đúng tập thành viên active** (neo dương ≥1), và `022` liệt **cùng tập** đó | Người ngoài nhóm không nhận; người đã nghỉ việc không nhận (D7) |
| **G16** MỚI (M-d) | `038` gửi `{role:'admin'}` lên hàng `pending` | **409 `ERR-013`** — KHÔNG để chạm `chk_feed_group_members_pending_role` ⇒ 23514 ⇒ 500 | `{decision:'approve'}` lên hàng `pending` ⇒ 200; `{role:'admin'}` lên hàng `active` ⇒ 200 |
| **G9b** 🔴 MỚI (H2) | Người giữ `manage:feed-group` xin URL tải đính kèm của bài trong nhóm private mà họ KHÔNG thuộc | **404/403** — cờ `manage` KHÔNG nới `visiblePostCondition` (D9-ii) | Cùng người đó vẫn gọi được `033`/`037`/`038` trên nhóm đó |
| G6 | `member` thường duyệt/từ chối (`038`) | 403 `ERR-014` | `admin`/`owner` duyệt được |
| **G6b** 🔴 | **`admin` gọi `034` xoá nhóm** (API-19: owner-only) | 403 `ERR-014` | `owner` xoá được; `manage:feed-group` xoá được + audit |
| G7 | Xin vào nhóm đã là thành viên / đã `pending` (`035`) | 409 `ERR-013` | Người mới ⇒ `active`(public) / `pending`(private) |
| G8 | `manage:feed-group` can thiệp nhóm không phải của mình (`033`/`038`) | Cho phép **+ audit ghi đúng** | Member thường cùng hành động ⇒ 403 |
| **G9** 🔴 | Người ngoài nhóm private xin **URL tải đính kèm** của bài trong nhóm đó | 404/403 — cổng tải nói **cùng câu** với cổng màn hình (M15) | Thành viên `active` tải được |
| **G10** 🔴 | `030` danh sách nhóm — nhóm **private** actor không thuộc **không xuất hiện**; `037` người ngoài nhóm private đọc danh sách thành viên (rò danh bạ) | Vắng mặt / 404 `ERR-012` | Nhóm public + nhóm của actor có mặt; thành viên đọc được danh sách |
| **G11** 🔴 | Người **đã nghỉ việc** (`employee_profiles.status='resigned'`) còn hàng `feed_group_members` `active` (D7) | Không lọt vào `037`, không nhận NOTI-034, không tính vào `022` unacked | Nhân viên `active` có mặt đủ cả ba |
| N-034 | NOTI-034 | CHỈ tới người xin vào; eventCode `SOCIAL_GROUP_JOIN_DECIDED` verbatim `0581`; `dedupe_strategy='None'` | Ca allow + deny |
| C1 | Census 2 tầng 10 route | `SERVICE_SITES` khớp `ROUTE_TO_KEY`; `tier1IsFloor` đúng tập | — |
| **C2** SỬA | `member_count` — chuỗi bắt đầu từ **`031` tạo nhóm** rồi join public → join private (`pending`) → approve → reject → đổi vai trò → rời → mời ra (đủ **7 dòng** của D10) | `== COUNT(*) feed_group_members status='active'` sau MỖI bước (đối soát SPEC §13.6), và không bước nào chạm `CHECK member_count >= 0` | — |

---

## §6. Migration

**KHÔNG có.** `feed_group` đã trong audit CHECK (`0579:58`, M11); 9 bảng Track B + 14 cặp quyền + NOTI catalog đủ từ DB-2/BE-1B. Nợ (a)/(d) là code TypeScript, không SQL.

---

## §7. Audit · NOTI

**Audit** (`object_type='feed_group'`, M11):
- `033`/`034` — **chỉ khi** actor đi qua `manage:feed-group` (không phải owner/admin của chính nhóm). Khuôn bất đối xứng của `update`/`remove` ở BE-1.
- `038`/`039` — **LUÔN** ghi (hành động lên người khác).

**NOTI-034** — `registerSource` với eventCode **`SOCIAL_GROUP_JOIN_DECIDED`** (verbatim `0581:334`, `Normal`/`None`/`false`). `dedupe_strategy='None'` theo catalog ⇒ **không khai `dedupeKeyOf`** (khai mà catalog bỏ qua = tài liệu nói sai về code). Người nhận: người xin vào, lọc D7.

🔴 **H5 — payload phải đủ BA biến template, nếu không dead-letter hoặc hiện nguyên văn `{group_name}`.** `0581:255-260` khai `variables_schema = {group_name, decision_label, group_id}` và `target_url_template='/social/groups/{group_id}'`; registrar `requireField` **NÉM** khi thiếu biến đã khai (`social-noti-bridge.registrar.ts:210-212`). ⇒ Thêm `group_name`·`decision_label`·**`group_id` (snake)** vào `PAYLOAD_KEYS` + một dòng `TEMPLATE_KEYS.SOCIAL_GROUP_JOIN_DECIDED`. ⚠️ Module giữ **cả `postId` lẫn `post_id`** — deep-link chỉ ăn khoá **snake**; gửi `groupId` mà quên `group_id` ⇒ URL đích hỏng. `group_name` đọc TRONG tx của `038`. Ca N-034 assert **render ra chữ**, không chỉ "có hàng notification".

🔴 **Kiểm kênh NOTI khi che danh tính** (bài học D13-a của BE-1B): payload NOTI-034 chở `groupId` + quyết định; **không** chở danh tính người thứ ba. Nhưng phải rà `PAYLOAD_KEYS` — `payloadOf` forward **mọi khoá trong whitelist, không phân biệt mã sự kiện**, và `my-notifications.mapper.ts` trả payload **nguyên văn** cho người nhận. Hàng `notifications` **sống lâu hơn grant**.

---

## §8. Thứ tự thi công

> Lane DB: `bash scripts/lane-db-setup.sh be2a --reset` → `export LANE_DB=mediaos_be2a` (+ 3 mật khẩu, **cùng một lời gọi Bash** — env không sống qua 2 lệnh). `bash harness/check.sh --lane-db` mỗi checkpoint.

**Bước 0 — đo + hạ tầng · ✅ XONG 22/09/2026 (commit `7fdfe8f1`)**
1. ✅ Đo M9 (`661`) · M19 (`0578` cấp cho cả 4 vai) · M20 (ngưỡng 90/90/85 + bẫy `test:cov:social` liệt từng spec) — §1.b.
2. ✅ Nợ (a): `social-master-data.seeder.ts` + `social-seed.registrar.ts` + `SeedModule`; int-spec RED→GREEN 3/3 (neo dương "trước reconcile catalog RỖNG" + neo chống-drift với `0582`).
3. ✅ Nợ (d): đã đo (M25 không writer bất đồng bộ; M26 FK CASCADE) ⇒ **không vá**, xin chữ ký S1 ở PR.

**Bước 1 — nền quyền (RED trước, chưa route nào sống)**
4. **D14 — BA hàm tập-người** (không phải một): `unackedEmployeesFor` · `audienceUserIds` · `resolveMentions` (+ nhận `groupId`). RED: **G11** (người đã nghỉ không lọt, neo dương trước) · **G13** (mention trong nhóm không bị bỏ câm) · **G14** (NOTI-031 tới đúng tập, và `022` liệt CÙNG tập).
5. `feedGroupCoreSchema` (M5 — dựng mới) + enum · **`listFeedQuerySchema.groupId` + `feedFingerprint`** (D-OWNER-7). RED: **G15** (con trỏ lệch `groupId` ⇒ 400).
6. `social-group-access.service.ts` (D5/D6/D8/**D13**) — **chỉ nhận `tx`**, neo **`FOR UPDATE`** trước mọi câu đếm owner (C3). RED: G2, G6, G6b, G5b, G5c, **G5d (đua thật)**, **G12 (xoá mềm)**.
7. 🔴 **GỘP hai việc vào CÙNG một bước (M-e)** — `social-access.service.ts` (D3 + D4 `assertWriteAudience`→async trong tx + D9) **VÀ** `social-posts.service.ts` bỏ hằng `groupId: null` (`:167`). Tách ra là tạo cửa sổ **không thể GREEN**: mở `assertWriteAudience` cho `group` trong khi vẫn ghim `groupId=null` ⇒ chạm `chk_feed_posts_audience_group` (`social.ts:144`) ⇒ 23514 ⇒ ca ALLOW của G3 nổ **500**. RED: G1, G3, G4, **G9 (đường tải tệp)**, **G9b (`manage` KHÔNG nới cổng đọc)**.
8. Bộ lọc **D-OWNER-6 theo CALL-SITE** — tham số `excludeGroupAudience` của `listFeed`, áp đúng 3/5 đường (bảng §3.2b), **không** nhồi vào `visiblePostCondition` (D1). RED: **G4b bốn chiều** + **G17 (badge == số dòng liệt được)**.

**Bước 2 — route**
9. `social-groups.repository.ts` + `social-group-members.repository.ts` + service + controller. RED: G5, G7, G8, G10, **G16 (body lệch trạng thái ⇒ 409, không 500)**.
10. Chạy lại **nguyên bộ spec BE-1**: `007-010` (audience `company`/`org_unit`) **không đổi hành vi**.
11. `bumpGroupMemberCount` — **bảng delta 7 dòng của D10, bắt đầu từ `031`** (không phải từ "join"). RED: C2.
12. Audit `feed_group` + NOTI-034 **đủ 3 biến template** (H5: `group_name`·`decision_label`·`group_id` snake + `TEMPLATE_KEYS`). RED: N-034 assert **render ra chữ**.
13. `@Idempotent` cho `031`/`035`/`036` (D11).

**Bước 3 — đóng WO**
14. 🔴 Census 2 tầng — **BỐN việc, thiếu một là fail-OPEN IM LẶNG (H3)**: (i) `SOCIAL_CONTROLLERS` **+`SocialGroupsController`** — đây là **danh sách trắng** (`social-two-layer-guard-census.unit-spec.ts:34-42`), quên thêm ⇒ 10 route **vô hình**, count vẫn 29, **cả 4 assert XANH**; (ii) `ROUTE_TO_KEY` +10; (iii) `SERVICE_SITES` +10 site; (iv) `toBe(29)` → **`toBe(39)`**. Khai `tier1IsFloor`/`companyFloor`/`dataScope` cho 10 cặp mới (census assert **đẳng thức tập**). Cộng `identity-projection-verdicts.ts`: điểm chiếu `listMembersTx` + `030` + **bump các sổ đếm ở cuối file**.
15. 🔴 Ba sổ **đo RIÊNG, cấm cộng tay lẫn nhau** (`route-http-coverage.e2e-spec.ts:351-354` ghi thẳng "BA phép đo, BA câu hỏi khác nhau"): (1) `MIN_COVERED_COUNT` · (2) census 2 tầng + `SERVICE_SITES` · (3) route-census JSON.
16. `pnpm --filter @mediaos/contracts build && pnpm typecheck`; `bash harness/check.sh --all` xanh, **không** banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
17. Chạy **TẤT CẢ spec của module trong MỘT lượt trên cùng lane DB** (bài học BE-1B: chạy riêng lẻ giấu lỗi đỏ-CI).
18. **Sửa `SPEC-16` §12** (D-OWNER-8 — nới nghĩa `ERR-014`/`ERR-015`) + **thêm int-spec mới của WO vào `test:cov:social`** (M20). Hai việc docs/cổng làm TRƯỚC gate để reviewer đọc bản đã đồng bộ.
19. **FULL gate** (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) **TRƯỚC khi mở PR** — không phải việc làm sau. → PR.

---

## §9. Rủi ro → cách chặn

| Rủi ro | Chặn |
| --- | --- |
| Nhánh group của `visiblePostCondition` lỏng ⇒ rò bài private ở **cả** màn hình **và** đường tải | G1+G9 RED trước; FULL gate `security-reviewer` |
| Nhồi D-OWNER-5 vào `visiblePostCondition` ⇒ chết `003` + cổng tải | D1 tách hai tầng tường minh; G4b test hai chiều còn G1 vẫn phải xanh |
| `withTenant` lồng (treo IM LẶNG, pool `max:20` không timeout) | D4: `SocialGroupAccessService` chỉ nhận `tx`; hoist `resolveActor`/permission ra TRƯỚC tx |
| Nhóm rơi về **0 owner** (khoá vĩnh viễn, không đường gỡ) | D6 ép ở **cả 4** đường; G5/G5b/G5c |
| Admin xoá nhóm (trái API-19) | D5 `allowedRoles` theo route; G6b |
| Người đã nghỉ việc vẫn nhận NOTI / hiện trong danh sách | D7; G11 |
| `member_count` lệch | D10 bump TRONG SQL; C2 đối soát |
| Ca deny vacuous (assert phủ định trên mảng rỗng) | Luật §5: neo dương trước mọi assert phủ định |
| Đổi hành vi `audience` làm vỡ `007-010` của BE-1 | Bước 2.10 chạy lại nguyên bộ spec BE-1 |
| **Hai owner rời ĐỒNG THỜI ⇒ nhóm 0 owner** (chuỗi tuần tự vẫn xanh) | D6-ii `FOR UPDATE` trên `feed_groups` trước mọi câu đếm; **G5d đua thật** |
| **Census XANH mà không đo route nào** (allowlist controller) | B3.14 bốn việc, `toBe(29)`→`toBe(39)` |
| **Badge đếm bài mà danh sách không liệt** (lọc lệch giữa `020` và `countUnackedFor`) | D-OWNER-6 + bảng §3.2b + **G17** |
| **Nhóm write-only** (không đường HTTP nào đọc bài nhóm) | D-OWNER-7 `001?groupId=` + `feedFingerprint` + G15 |
| **Bài/bình luận nhóm nuốt mention · tin nhóm không báo cho ai** | D14 ba hàm + G13/G14 |
| Xoá mềm nhóm không lan (vẫn đăng/đọc/xin vào được) | D13 `deleted_at IS NULL` ở mọi vị từ + G12 |

---

## §10. Nợ chuyển tiếp

- **BE-2B**: nợ (b)+(e), `ERR-018` phải ở **service** (Zod trả 400 vô danh), `voteTx` giảm đếm option cũ, ca race đếm được, FSM sáng kiến, NOTI-032/033/035, job đóng poll, ranh giới `047`/`048` (S2).
- **BE-2C**: `feedUserRoomName` + join/leave động, nới D8, **sửa API-19 §7**, ratchet `chat-realtime-structure.spec.ts`.
- Nợ (c) NOTI-034 `dedupe_strategy='None'` — chấp nhận.
- **Nợ (d) — KẾT LUẬN ĐO (22/09):** không vá. Bằng chứng: M25 (0 writer bất đồng bộ ghi `feed_*`) + M26 (FK `feed_kudos_badges → companies` là **CASCADE**, nên writer boot-time xuyên tenant do chính WO này thêm vào cũng không chặn `DELETE FROM companies`). Trần đo: census writer toàn `src/` + đo `confdeltype` trên DB thật — không phải "chạy thử vài vòng rồi bỏ" (L-d). Xin chữ ký S1.
- **Nhánh CHẾT `SOCIAL-ERR-008`** (M24): `superRefine` của contracts chặn cả `group` lẫn `org_unit` thiếu khoá ⇒ 400 trước khi tới service. Hằng `AUDIENCE_KEY_MISSING` ở `social-access.service.ts:360-362` hiện **không đường nào chạm tới**. Không dọn ở WO này (đụng contracts dùng chung FE) — giao WO dọn nợ, hoặc BE-2B nếu nó đã phải mở `superRefine` cho `poll`/`idea`.
- **M-c — `037` và `member_count` đo HAI tập khác nhau:** SPEC `:403` định nghĩa `member_count = COUNT(*) status='active'` **không lọc nhân sự**, còn D7/G11 loại người đã nghỉ khỏi `037` ⇒ badge "12 thành viên" đứng cạnh danh sách 10 dòng, và C2 vẫn xanh. WO này **giữ nguyên định nghĩa SPEC cho bộ đếm** (đổi nó là đổi bất biến §13.6 của cả module) và ghi lệch này ra PR; `037.total` lấy từ **câu đếm của chính `037`** (đã lọc D7), KHÔNG lấy `member_count`.
- **L-c** — `030` chưa chốt: DTO nhóm private trả gì cho người ngoài (hiện chỉ nói "không lộ nhóm private"), và mô hình phân trang. Chốt lúc thi công Bước 2.9, ghi vào §12.
- Nợ (g)1-5,7,8 của BE-1B — chưa gán WO.
- Nợ (d) nếu đo ra race rộng hơn 1 dòng `childTables` ⇒ **WO riêng**, không mở rộng BE-2A giữa chừng.
- `feed_poll_options.vote_count` không nằm trong 5 cột §13.6 nhưng vẫn là bộ đếm thật — bổ sung script đối soát ở BE-2B hoặc giao QA-1 tường minh.

---

## §11. Tự kiểm `done_when`

| `done_when` (backlog BE-2A) | Đóng ở |
| --- | --- |
| Bài `audience=group` chỉ trả khi membership active ép TRONG SQL; ngoài nhóm private → 404; `manage:feed-group` can thiệp + audit | B1.7 (D3) · B2.9 · G1/G2/G8 |
| D-OWNER-5 loại bài nhóm khỏi `001`/`023`/`025` trừ khi lọc `groupId`, test hai chiều | B1.8 (D1) · G4b |
| Bất biến ≥1 owner active ở `036`/`038`/`039`/`034`; `034` owner-ONLY; `allowedRoles` theo route | B1.6 (D5/D6) · G5/G5b/G5c/G6b |
| Cổng màn hình khớp cổng đường tải, có ca deny đính kèm | B1.7 · G9 |
| Vị từ `status='active'` ở mọi tập người | B1.4 (D7) · G11 |
| Nợ (g)6 vá trước khi mở nhóm | B1.4 |
| Nợ (a) seeder đăng ký | B0.2 |
| Nợ (d) đo trước khi vá | B0.3 · S1 |
| DTO `.pick()+.strict()`; body `038` tường minh; mọi POST `@Idempotent` | §3.3 (D12) · B2.13 |
| `member_count` bump trong SQL + script đối soát | B2.11 (D10) · C2 · §10 |
| 10 ca deny RED + ALLOW; census 2 tầng; coverage ≥85% LANE_DB | §5 · B3.14-17 · **M20** (ngưỡng thật 90/90/85 per-file; nhánh group mới của `visiblePostCondition` phải có ca cho **cả 4 tổ hợp** member/non-member × public/private) |

**Bổ sung vòng 2 (22/09) — `done_when` ngầm mà bản trước không đóng:**

| Điều phải đóng | Đóng ở |
| --- | --- |
| D-OWNER-6: bộ lọc áp đúng 3/6 đường, badge ↔ danh sách cùng tập | §3.2b · B1.8 · G4b · **G17** |
| D-OWNER-7: có đường HTTP đọc bài nhóm (`001?groupId=`) + `feedFingerprint` | B1.5 · **G15** |
| D-OWNER-8: SPEC-16 §12 sửa cùng PR | B3.18 |
| C3: bất biến owner chịu được ĐUA, không chỉ chuỗi tuần tự | D6-ii (`FOR UPDATE`) · **G5d** |
| C4: ba hàm tập-người, không một | D14 · B1.4 · **G13/G14** |
| C5: `member_count` đúng từ thao tác ĐẦU TIÊN | D10 bảng 7 dòng · B2.11 · **C2** |
| H1: vòng đời xoá mềm nhóm | D13 · **G12** |
| H2: cổng màn hình == cổng đường tải kể cả với `manage:feed-group` | D9-ii · **G9b** |
| H3: census thật sự ĐO 10 route mới | B3.14 bốn việc · `toBe(39)` |
| H5: NOTI-034 render ra chữ, deep-link đúng | §7 · **N-034** |
| H6: 409 `ERR-013` chỉ cho đúng constraint | §4 `035` · `isUniqueViolationOf` |
| H7: `034` owner-only là AUTHORIZATION, không phải bất biến đếm | D6-i · **G6b** |

---

## §12. Sổ vết `plan-reviewer` vòng 2 — 22/09/2026 (BLOCK → đã vá)

> Vòng 1 BLOCK plan **BE-2 gộp** (4 CRITICAL + 7 HIGH) ⇒ owner tách 3 WO. Vòng 2 BLOCK plan
> **BE-2A** này (5 CRITICAL + 7 HIGH + 8 MEDIUM). Reviewer kiểm độc lập 18/18 ô đo cũ — **13/18 tái
> lập đúng**, phần còn lại không sai số mà **mù**: bảng đo đúng ở chỗ nó nhìn.
>
> 4 finding nặng nhất đã được **kiểm chứng lại lần ba** (không nhận nguyên xi lời subagent) — xem cột
> "đã tự kiểm".

| # | Finding | Đã tự kiểm | Vá ở |
| --- | --- | --- | --- |
| **C1** | `listFeed` là MỘT hàm phục vụ NĂM route (`001`·`010`·`020`·`023`·`025`) + đường thứ sáu `countUnackedFor` nhận vị từ trực tiếp. "Repo của `023`/`025`" **không tồn tại** | ✅ 5 call-site + `social-news.service.ts:69` | M21/M22 · **D-OWNER-6** · §3.2b · G4b/G17 |
| **C2** | Cửa thoát `groupId` của D-OWNER-5 **không tồn tại** ⇒ nhóm thành WRITE-ONLY, WO đóng "xanh" với tính năng chết | ✅ `social-api.ts:256-269` | M23 · **D-OWNER-7** · B1.5 · G15 |
| **C3** | D6 đếm owner bằng `COUNT` trần ⇒ TOCTOU: hai owner rời đồng thời ⇒ nhóm **0 owner** — đúng sự cố D6 sinh ra để chặn | ✅ không khoá nào trong plan; khuôn row-lock có sẵn 3 chỗ | **D6-ii `FOR UPDATE`** · G5d |
| **C4** | Mở `group` kích hoạt **ba** hàm fail-empty câm, plan vá một | ✅ `social-news.repository.ts:187`+`:265`, `social-mentions.ts:239-246` (tôi tìm ra `audienceUserIds` độc lập trước khi reviewer trả lời) | **D14** · B1.4 · G13/G14 |
| **C5** | Ma trận bump thiếu vế **tạo nhóm** và không phân biệt `pending` ⇒ sai từ thao tác ĐẦU TIÊN; trừ nhầm hàng `pending` ⇒ `CHECK` 23514 ⇒ 500 | ✅ `social.ts:514,524,558-561` | **D10 bảng 7 dòng** · C2 |
| **H1** | `feed_groups.deleted_at` vắng mặt ở MỌI vị từ ⇒ sau `034` vẫn đăng/đọc/xin-vào được | ✅ `social.ts:519,527-532` | **D13** · G12 |
| **H2** | Cờ `manage:feed-group` không khai ở `resolveViewerContext` ⇒ cổng màn hình lệch cổng tải; D9 còn sai số học (3→4 vs 3→5) | ✅ hai batch tách biệt | **D9 viết lại** · G9b |
| **H3** | `SOCIAL_CONTROLLERS` là **allowlist** ⇒ quên thêm controller thì 10 route vô hình mà census vẫn XANH | ✅ `:34-42,187,196-198` | B3.14 bốn việc |
| **H4** | `ERR-008` là nhánh CHẾT (Zod 400 chặn trước) | ✅ `social-api.ts:314-321` | **D-OWNER-9** · D2 · §4 · §10 |
| **H5** | NOTI-034 thiếu 2/3 biến template ⇒ dead-letter hoặc hiện nguyên văn `{group_name}` | ✅ `0581:255-260` + `requireField` NÉM | §7 |
| **H6** | Bắt `23505` trần trái luật đã ghi của chính module | ✅ `social.errors.ts:140-150` | §4 `035` |
| **H7** | D6 vs §4 mâu thuẫn ở `034`: đọc theo nghĩa đen thì xoá nhóm LUÔN 409 | ✅ §4 dòng `034` không có `ERR-015` | **D6 tách (i)/(ii)** |
| M-a | `ERR-014`/`ERR-015` nới nghĩa ngoài SPEC mà không xin chữ ký | ✅ `SPEC-16:324-325` | **D-OWNER-8** · B3.18 |
| M-b | Cổng coverage thật là **per-file 90/90/85**, plan xếp vào "chưa đo" | ✅ `vitest.config.ts:144-148` | M20 · §11 |
| M-c | `037` (lọc D7) và `member_count` (SPEC) đo hai tập khác nhau | ✅ `SPEC-16:403` | §10 |
| M-d | `{role:'admin'}` lên hàng `pending` ⇒ 23514 ⇒ **500** | ✅ `social.ts:570` | D12 · §4 `038` · G16 |
| M-e | B1.7 → B2.10 tạo cửa sổ **không thể GREEN** | ✅ `social-posts.service.ts:167` + `social.ts:144` | **B1.7 gộp** |
| M-f | Nợ (a) **đã thi công TRƯỚC khi plan qua cổng** | ✅ đúng — ghi nhận trung thực: Bước 0.2/0.3 (seeder + đo) chạy song song với vòng review để không phí thời gian chờ; đó là phần **độc lập với mọi quyết định crown** đang bị soi (không chạm `visiblePostCondition`/quyền/route). Phần crown **chưa viết dòng nào** trước verdict. Vẫn phải qua FULL gate như mọi diff khác của WO | §0.2 · B0 |
| M-g | D3 không ràng `alias` ⇒ JOIN có alias bám nhầm bảng | ✅ `social-access.service.ts:167` | D3 |
| M-h | Ô "chưa đo" #2 đo được ngay | ✅ | M19 |
| L-a | 3 emitter WS fail-closed — **lý do việc hoãn BE-2C là an toàn** | ✅ 3 chỗ | M27 |
| L-b/L-c/L-d | Trích dẫn 337 dòng · DTO `030` · trần đo nợ (d) | — | §10 · L-b bỏ qua |

**Điểm reviewer xác nhận GIỮ NGUYÊN:** D1 (tách visibility ↔ feed composition — thứ cứu `003` + cổng
tải) · D4 (một call-site, trong tx, service chỉ nhận `tx`) · D5 (`allowedRoles` theo route) · D7 · §5
(mỗi DENY có ALLOW + neo dương) · §8 (FULL gate TRƯỚC PR · cả bộ spec một lượt cùng lane DB · ba sổ
đo RIÊNG) · §6 (không migration — `0579:58` đã front-load `feed_group`).

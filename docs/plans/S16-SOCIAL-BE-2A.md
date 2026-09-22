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
| (a) DB-2 | Seeder `social.master-data` (5 huy hiệu) chưa đăng ký `MasterDataSeederRegistry`; mig `0582` chỉ seed company ĐANG TỒN TẠI ⇒ PROD cài mới (migrate trước boot) ship catalog RỖNG | **Vá ở Bước 0.** Độc lập với route nhóm, làm sớm vì là rủi ro PROD đang treo |
| (d) DB-2 | `childTables` của `deleteWithFkRetry` thiếu `feed_*` | **ĐO ở Bước 0**, vá CHỈ KHI tái lập được. Không tái lập được ⇒ ghi "đã đo, không vá" vào §10 |
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

**CHƯA ĐO — đo TRƯỚC bước dùng, không tin số dưới:**
- Ngưỡng coverage per-file của `vitest.config.ts` cho `social-access.service.ts` (WO này sửa file đó).
- `0578` có cấp `create:feed-group` cho vai nào — đo ở Bước 0 (ảnh hưởng ca ALLOW của `031`).
- Số route census JSON thật sau khi thêm 10 route (đo, **không cộng tay** — xem §8 bước cuối).

---

## §2. Quyết định

### 2.1 Owner đã ký 22/09/2026

| # | Quyết định | Nội dung |
| --- | --- | --- |
| **D-OWNER-5** 🔴 | Bài nhóm public có vào feed chung không? | **KHÔNG.** `001` feed chung · `023` tìm kiếm · `025` trang cá nhân **LOẠI** `audience='group'` — TRỪ khi request lọc đích danh `groupId`. Giải mâu thuẫn nghĩa-đen của `done_when` cũ (vừa đòi "chỉ trả khi membership active" vừa đòi "public không cần tham gia"): hai câu nói về **hai đường khác nhau**, xem D3 |
| **D-OWNER-2** | Cơ chế room WS | Thêm `feedUserRoomName` (room ĐÁNH DẤU đã qua cổng `view:feed`) + join/leave động → **chuyển sang BE-2C**, không thuộc WO này |

### 2.2 Chốt trong plan (suy được từ spec/code)

| # | Quyết định | Nội dung | Căn cứ |
| --- | --- | --- | --- |
| **D1** 🔴 | **Tách VISIBILITY khỏi FEED COMPOSITION** | `visiblePostCondition` trả lời *"actor ĐƯỢC PHÉP thấy bài này không"* — nhánh group thêm vào đây (D3). Việc *"bài này có nằm trong feed chung không"* là **bộ lọc RIÊNG** ở tầng repository của `001`/`023`/`025` (`audience <> 'group' OR group_id = :requestedGroupId`). **Tuyệt đối không nhồi D-OWNER-5 vào `visiblePostCondition`** — làm thế sẽ chặn luôn `003` chi tiết bài và **cổng tải đính kèm** (M15) | M14/M15; D-OWNER-5 |
| **D2** 🔴 | GHI bài vào nhóm | Actor phải là thành viên **`status='active'`** của group đó, **bất kể `public`/`private`** (API-19 `ERR-002` = "ghi vào nhóm actor không thuộc", không phân biệt visibility). Thiếu `groupId` ⇒ 422 `ERR-008` (khuôn `org_unit`) | SPEC §12; API-19 `:143` |
| **D3** 🔴 | ĐỌC bài `audience='group'` | Nhánh OR thứ ba của `visiblePostCondition`: **EXISTS** `feed_group_members` `status='active'` cho `(company, group, actor)` **HOẶC** group `visibility='public'`. EXISTS tương quan TRONG CÂU — **không** resolve mảng id trước (tập nhóm đổi liên tục, không chặn trước được như `orgUnitIds`). `isAuthor` giữ nguyên (tác giả luôn thấy bài mình) | SPEC §3.4 (chỉ nói nhóm **kín**); SOC-DEC-006; M14 |
| **D4** 🔴 | Vị trí kiểm GHI — **MỘT call-site, TRONG tx** | `assertWriteAudience` đổi thành **async**, chữ ký `(tx, actor, audience, orgUnitId, groupId)`, và **chuyển vào trong** `withTenant` của `create()` (hôm nay nó đứng ngoài — M16). `SocialGroupAccessService` **chỉ nhận `tx`, CẤM tự mở `withTenant`** (lồng = treo IM LẶNG trên PgBouncer, pool `max:20` không `connectionTimeoutMillis`). Kiểm ở tx riêng TRƯỚC rồi ghi sau = TOCTOU, cấm | M16; bài học BE-1B |
| **D5** 🔴 | `assertGroupRoleTx` nhận **`allowedRoles` theo từng route** | Khuôn `assertProjectRoleTx`. `033` → `['owner','admin']` · **`034` → `['owner']`** · `038`/`039` → `['owner','admin']`. Mọi route thêm nhánh thoát `manage:feed-group` (+ audit). **Một tập role cứng dùng chung = admin xoá được nhóm, trái API-19 `:102`** | M12/M18 |
| **D6** 🔴 | Bất biến **≥1 owner ACTIVE** | Ép ở **MỌI** đường làm mất owner, không chỉ `036`: `036` leave · **`038` đổi vai trò** (đây CHÍNH LÀ đường chuyển owner mà `done_when` của FE-2 đòi) · `039` mời ra · `034` xoá nhóm. Kiểm bằng `COUNT(*) WHERE role='owner' AND status='active'` **trong cùng tx** trước khi ghi ⇒ `ERR-015`. Thiếu vế `038` ⇒ admin hạ owner cuối ⇒ nhóm **0 owner, khoá vĩnh viễn**, và `036` trở nên vô nghĩa | M18; reviewer F3 |
| **D7** 🔴 | Vị từ "nhân viên đang hoạt động" | `feed_group_members.status='active'` **KHÔNG** đồng nghĩa người đó còn làm việc — nghỉ việc **không** xoá mềm, hàng vẫn còn (`employee_profiles.status='resigned'`). MỌI tập người của WO kèm `employee_profiles.status='active'`, và khi JOIN `users` thêm `users.deleted_at IS NULL AND users.status='active'`. Áp cho: `037` danh sách thành viên · người nhận NOTI-034 · nợ (g)6. Khuôn có sẵn: `social-mentions.ts:195-201` | Bài học BE-1B (3 reviewer hội tụ) |
| **D8** | Vị trí code | `visiblePostCondition`/`assertWriteAudience` sửa **tại chỗ** ở `SocialAccessService` (một luật một bản). Logic THỰC THỂ nhóm (404 `ERR-012`, vai trò, CRUD) ở file mới `social-group-access.service.ts` | M12; CLAUDE.md §5 |
| **D9** | `resolveActor` | Thêm `create:feed-group` vào batch `resolveManyOrNull` HIỆN CÓ (3→4, vẫn 1 round-trip). Không tạo `resolveActor` thứ hai. Cờ `manage:feed-group` cũng vào batch này | M14 |
| **D10** | Bộ đếm | `bumpGroupMemberCount` theo khuôn `bumpPostCounter` (`UPDATE…SET x=x+delta…RETURNING`, cấm đọc-rồi-ghi, cấm `Math.max` ở JS), **cùng tx** với join/duyệt/rời/mời-ra | M13; SPEC §13.6 |
| **D11** | `@Idempotent` | `done_when` đòi "**mọi POST**" ⇒ `031` create · `035` join · `036` leave đều có. Không im lặng bỏ sót | backlog `done_when` |
| **D12** | Body `038` | `.strict()`, hai dạng loại trừ nhau: `{decision:'approve'\|'reject'}` (cho hàng `pending`) **hoặc** `{role:'admin'\|'member'\|'owner'}` (cho hàng `active`). `role:'owner'` **hợp lệ** — đó là đường chuyển owner (D6) — nhưng chỉ `owner` hiện tại hoặc `manage:feed-group` được dùng, và phải giữ bất biến ≥1 owner | API-19 `:106`; D5/D6 |

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
| `social-posts.repository.ts` + repo của `023`/`025` | Bộ lọc D-OWNER-5: `audience <> 'group' OR group_id = :requestedGroupId` — **tầng feed, KHÔNG phải `visiblePostCondition`** (D1) |
| `social-file.resolver.ts` | 🔴 Kiểm lại: nhánh group mới của `visiblePostCondition` đi thẳng vào cổng tải (M15). Không sửa logic, nhưng **phải có ca test** (G9) |
| `social-counters.ts` | +`bumpGroupMemberCount` (D10) |
| `social-route-pairs.const.ts` · `social.errors.ts` · `social.dto.ts` · `social.module.ts` | +10 route · +4 mã lỗi · +DTO · +provider (append, không rewrite) |
| `packages/contracts/src/social.ts` + `social-api-groups.ts` (mới) | `feedGroupCoreSchema` (M5 — dựng mới) + DTO 10 route. File riêng theo khuôn `social-api-b.ts` |
| `social-news.repository.ts` (nợ g6) | `unackedEmployeesFor` nhánh `audience='group'` + D7 |
| `notifications/social-noti-bridge.registrar.ts` | +`registerSource` NOTI-034 — **eventCode VERBATIM theo `0581`**: `SOCIAL_GROUP_JOIN_DECIDED` |
| `test/helpers/seed.ts` | Nợ (d), **chỉ khi đo được race** |

### 3.3 Luật DTO (nợ f)

Mọi DTO ghi: `.pick()` từ core schema **rồi** `.strict()`. Cấm `.extend()` thẳng — `feedGroupMemberCoreSchema` mang `role`/`status`/`userId` và **không** `.strict()`; dùng thẳng làm body = người xin vào tự gửi `{role:'owner', status:'active'}`.

---

## §4. Bảng route

| Mã | Method · Path | Tầng-1 | `allowedRoles` (D5) | Tầng-2 | Idem | Audit | NOTI | Lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `002`+group | `POST /social/posts` (`audience=group`) | `create:feed-post` (sàn) | — | D2/D4: member `active` **trong tx** | ✅ | — | — | `ERR-002`,`ERR-008` |
| `030` | `GET /social/groups` | `view:feed` | — | public ∪ nhóm của actor (**không lộ nhóm private ngoài**) | — | — | — | — |
| `031` | `POST /social/groups` | `create:feed-group` | — | tạo + hàng `owner`/`active` cùng tx | ✅ | — | — | — |
| `032` | `GET /social/groups/{id}` | `view:feed` | — | `assertGroupVisibleTx` | — | — | — | `ERR-012` |
| `033` | `PATCH /social/groups/{id}` | `view:feed` | `['owner','admin']` | +thoát `manage:feed-group` | — | khi qua `manage` | — | `ERR-012`,`ERR-014` |
| `034` | `DELETE /social/groups/{id}` | `view:feed` | **`['owner']`** 🔴 | +thoát `manage`; xoá mềm | — | khi qua `manage` | — | `ERR-012`,`ERR-014` |
| `035` | `POST /social/groups/{id}/join` | `view:feed` | — | public→`active`, private→`pending`; `23505`→`ERR-013` | ✅ | — | — | `ERR-012`,`ERR-013` |
| `036` | `POST /social/groups/{id}/leave` | `view:feed` | — | D6 owner cuối → 409 | ✅ | — | — | `ERR-015` |
| `037` | `GET /social/groups/{id}/members` | `view:feed` | — | membership HOẶC `manage`; D7 | — | — | — | `ERR-012` |
| `038` | `PATCH /social/groups/{id}/members/{uid}` | `view:feed` | `['owner','admin']` | D12 body; **D6 bất biến owner** | — | ✅ `feed_group` | `034` | `ERR-014`,`ERR-015` |
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
| **G4b** 🔴 | Cùng bài nhóm public đó **KHÔNG** xuất hiện ở feed chung `001` / tìm kiếm `023` / trang cá nhân `025` (D-OWNER-5) | Vắng mặt | Lọc đích danh `groupId` ⇒ **có mặt**. Hai chiều, không chỉ một |
| G5 | `owner` duy nhất rời nhóm (`036`) | 409 `ERR-015` | Có owner thứ hai ⇒ rời được |
| **G5b** 🔴 | Admin hạ vai trò owner **cuối cùng** xuống `member` qua `038` | 409 `ERR-015` | Chuyển owner đúng cách (nâng B lên `owner` **trước**, rồi hạ A) ⇒ 200, nhóm luôn ≥1 owner |
| **G5c** 🔴 | Mời ra owner cuối cùng qua `039` | 409 `ERR-015` | — |
| G6 | `member` thường duyệt/từ chối (`038`) | 403 `ERR-014` | `admin`/`owner` duyệt được |
| **G6b** 🔴 | **`admin` gọi `034` xoá nhóm** (API-19: owner-only) | 403 `ERR-014` | `owner` xoá được; `manage:feed-group` xoá được + audit |
| G7 | Xin vào nhóm đã là thành viên / đã `pending` (`035`) | 409 `ERR-013` | Người mới ⇒ `active`(public) / `pending`(private) |
| G8 | `manage:feed-group` can thiệp nhóm không phải của mình (`033`/`038`) | Cho phép **+ audit ghi đúng** | Member thường cùng hành động ⇒ 403 |
| **G9** 🔴 | Người ngoài nhóm private xin **URL tải đính kèm** của bài trong nhóm đó | 404/403 — cổng tải nói **cùng câu** với cổng màn hình (M15) | Thành viên `active` tải được |
| **G10** 🔴 | `030` danh sách nhóm — nhóm **private** actor không thuộc **không xuất hiện**; `037` người ngoài nhóm private đọc danh sách thành viên (rò danh bạ) | Vắng mặt / 404 `ERR-012` | Nhóm public + nhóm của actor có mặt; thành viên đọc được danh sách |
| **G11** 🔴 | Người **đã nghỉ việc** (`employee_profiles.status='resigned'`) còn hàng `feed_group_members` `active` (D7) | Không lọt vào `037`, không nhận NOTI-034, không tính vào `022` unacked | Nhân viên `active` có mặt đủ cả ba |
| N-034 | NOTI-034 | CHỈ tới người xin vào; eventCode `SOCIAL_GROUP_JOIN_DECIDED` verbatim `0581`; `dedupe_strategy='None'` | Ca allow + deny |
| C1 | Census 2 tầng 10 route | `SERVICE_SITES` khớp `ROUTE_TO_KEY`; `tier1IsFloor` đúng tập | — |
| **C2** | `member_count` sau chuỗi join→duyệt→rời→mời-ra | `== COUNT(*) feed_group_members status='active'` (đối soát SPEC §13.6) | — |

---

## §6. Migration

**KHÔNG có.** `feed_group` đã trong audit CHECK (`0579:58`, M11); 9 bảng Track B + 14 cặp quyền + NOTI catalog đủ từ DB-2/BE-1B. Nợ (a)/(d) là code TypeScript, không SQL.

---

## §7. Audit · NOTI

**Audit** (`object_type='feed_group'`, M11):
- `033`/`034` — **chỉ khi** actor đi qua `manage:feed-group` (không phải owner/admin của chính nhóm). Khuôn bất đối xứng của `update`/`remove` ở BE-1.
- `038`/`039` — **LUÔN** ghi (hành động lên người khác).

**NOTI-034** — `registerSource` với eventCode **`SOCIAL_GROUP_JOIN_DECIDED`** (verbatim `0581:334`, `Normal`/`None`/`false`). `dedupe_strategy='None'` theo catalog ⇒ **không khai `dedupeKeyOf`** (khai mà catalog bỏ qua = tài liệu nói sai về code). Người nhận: người xin vào, lọc D7.

🔴 **Kiểm kênh NOTI khi che danh tính** (bài học D13-a của BE-1B): payload NOTI-034 chở `groupId` + quyết định; **không** chở danh tính người thứ ba. Nhưng phải rà `PAYLOAD_KEYS` — `payloadOf` forward **mọi khoá trong whitelist, không phân biệt mã sự kiện**, và `my-notifications.mapper.ts` trả payload **nguyên văn** cho người nhận. Hàng `notifications` **sống lâu hơn grant**.

---

## §8. Thứ tự thi công

> Lane DB: `bash scripts/lane-db-setup.sh be2a --reset` → `export LANE_DB=mediaos_be2a` (+ 3 mật khẩu, **cùng một lời gọi Bash** — env không sống qua 2 lệnh). `bash harness/check.sh --lane-db` mỗi checkpoint.

**Bước 0 — đo + hạ tầng**
1. Đo lại M9, `0578` cấp `create:feed-group` cho vai nào, ngưỡng coverage per-file của `social-access.service.ts`.
2. Nợ (a): `social-master-data.seeder.ts` + registrar (M17). Test: company mới boot ⇒ có đủ 5 huy hiệu.
3. Nợ (d): ĐO race `childTables`. Tái lập được ⇒ vá; không ⇒ ghi §10 + xin chữ ký S1.

**Bước 1 — nền quyền (RED trước, chưa route nào sống)**
4. Nợ (g)6: `unackedEmployeesFor` nhánh `group` + D7. RED: tin `news` `audience='group'`, thành viên chưa ack ⇒ `022` liệt đúng người (neo dương), người đã nghỉ việc **không** lọt (G11).
5. `feedGroupCoreSchema` (M5 — dựng mới) + enum.
6. `social-group-access.service.ts` (D5/D6/D8) — **chỉ nhận `tx`**. RED: G2, G6, G6b, G5b, G5c.
7. `social-access.service.ts`: D3 (`visiblePostCondition`) + D4 (`assertWriteAudience` → async, vào trong tx) + D9. RED: G1, G3, G4, **G9 (đường tải tệp)**.
8. Bộ lọc D-OWNER-5 ở tầng feed (D1 — **không** nhồi vào `visiblePostCondition`). RED: G4b **hai chiều**.

**Bước 2 — route**
9. `social-groups.repository.ts` + `social-group-members.repository.ts` + service + controller. RED: G5, G7, G8, G10.
10. `social-posts.service.ts`: bỏ `groupId: null` cứng; kiểm `007-010` (audience `company`/`org_unit`) **không đổi hành vi**.
11. `bumpGroupMemberCount` (D10) ở join/duyệt/rời/mời-ra. RED: C2.
12. Audit `feed_group` + NOTI-034 (§7). RED: N-034.
13. `@Idempotent` cho `031`/`035`/`036` (D11).

**Bước 3 — đóng WO**
14. Census 2 tầng 10 route (C1). `identity-projection-verdicts.ts`: điểm chiếu `listMembersTx` + `030` (chiếu owner) + **bump các sổ đếm ở cuối file**.
15. 🔴 Ba sổ **đo RIÊNG, cấm cộng tay lẫn nhau** (`route-http-coverage.e2e-spec.ts:351-354` ghi thẳng "BA phép đo, BA câu hỏi khác nhau"): (1) `MIN_COVERED_COUNT` · (2) census 2 tầng + `SERVICE_SITES` · (3) route-census JSON.
16. `pnpm --filter @mediaos/contracts build && pnpm typecheck`; `bash harness/check.sh --all` xanh, **không** banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
17. Chạy **TẤT CẢ spec của module trong MỘT lượt trên cùng lane DB** (bài học BE-1B: chạy riêng lẻ giấu lỗi đỏ-CI).
18. **FULL gate** (`security-reviewer` + `database-reviewer` + `silent-failure-hunter`) **TRƯỚC khi mở PR** — không phải việc làm sau. → PR.

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

---

## §10. Nợ chuyển tiếp

- **BE-2B**: nợ (b)+(e), `ERR-018` phải ở **service** (Zod trả 400 vô danh), `voteTx` giảm đếm option cũ, ca race đếm được, FSM sáng kiến, NOTI-032/033/035, job đóng poll, ranh giới `047`/`048` (S2).
- **BE-2C**: `feedUserRoomName` + join/leave động, nới D8, **sửa API-19 §7**, ratchet `chat-realtime-structure.spec.ts`.
- Nợ (c) NOTI-034 `dedupe_strategy='None'` — chấp nhận.
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
| 10 ca deny RED + ALLOW; census 2 tầng; coverage ≥85% LANE_DB | §5 · B3.14-17 |

# Plan S16-SOCIAL-BE-2B-2 — SÁNG KIẾN · VINH DANH (`SOCIAL-API-045..048` + nhánh `type='idea'|'kudos'` của `002`)

> 🔴 **Crown.** Ba thứ crown chồng lên nhau: (1) **đường DUYỆT đầu tiên của SOCIAL** — `046` là route
> duy nhất của module gác bằng một cặp `approve:*`, và nó ghi một cặp vết `reviewed_by`/`reviewed_at`
> mà `chk_feed_ideas_reviewed_pair` bắt buộc phải đi CÙNG NHAU; (2) **vinh danh neo theo
> `employee_id` còn NOTI gửi theo `user_id`** — chỗ nối hai khoá đó là đúng lớp lỗi mà BA reviewer độc
> lập hội tụ ở BE-1B (nghỉ việc KHÔNG xoá mềm); (3) **`isOfficial`** biến một bài ai cũng tạo được
> thành một bài mang dấu công ty, phân biệt bằng đúng một cặp `manage:feed-kudos`.
>
> **Nguồn sự thật:** SPEC-16 §12 (`:329-332`) · §13.3 (`:365-376`) · §15 (`:439-453`) · §17 ·
> SOC-DEC-009 (`:590`) · API-19 §5.1 (`:115-122`) · §5.1b (`:133-145`) · §6.4 (`:245-251`) ·
> §6.6 (`:266-272`) · DB-17 §7.6-§7.9 · [DB-2](S16-SOCIAL-DB-2.md) §10 ·
> [BE-2A](S16-SOCIAL-BE-2A.md) · [BE-2B-1](S16-SOCIAL-BE-2B-1.md) §10/§13/§14.
>
> **Khuôn:** `payroll/payroll-fsm.ts` · `social-reports.repository.ts#resolveReport` (UPDATE cặp vết
> MỘT câu + `WHERE`-điều-kiện + `RETURNING`) · `social-polls.repository.ts#listPollsTx` (OFFSET +
> `visiblePostCondition` + `total` window function) · `social-post-types.ts#createPollTx` ·
> `social-access.service.ts#assertCreatablePostType` (cổng tầng-2 đọc bảng hằng) ·
> `social-mentions.ts` (map employee→user + lọc người còn hoạt động) · `social-news-noti-cap.spec.ts`.
>
> **Lịch sử:** tách 23/09/2026 từ `S16-SOCIAL-BE-2B`. Phần BÌNH CHỌN đã ship ở **BE-2B-1** (PR #534,
> `70869365`). Plan viết lại TOÀN BỘ trên `master` sau #534+#535 — mọi số dòng của bản nháp cũ đã trôi.
> **Lượt 2 (24/09/2026):** vá 10 finding CRITICAL/HIGH của `plan-reviewer` (F1..F10) + 13 finding nhẹ;
> mọi chỗ vá ghi dấu **⟲F\<n\>** và liệt kê ở §15. Nối tiếp BE-2B-1, **KHÔNG song song**.

---

## §0. Phạm vi & nợ

### 0.1 Route trong phạm vi — **4 route + 2 nhánh `type`**

`045` `GET /social/ideas` · `046` `PATCH /social/posts/{post_id}/idea/review` ·
`047` `GET /social/kudos` · `048` `GET /social/kudos-badges`
**+ 2 nhánh `type` của `002`** (`idea` · `kudos` — hôm nay bị Zod từ chối 400, M12).

**KHÔNG thuộc WO này:** `049`/`050`/`051` CRUD catalog huy hiệu (`manage:feed-kudos`) → BE-3 ·
`052`/`053` thống kê → BE-3 · room WS `feedgroup` → BE-2C · route khôi phục bài đã xoá → BE-3 ·
throttle `035` → BE-3.

### 0.2 Nợ mang sang

| Nợ | Nội dung | Xử lý ở WO này |
| --- | --- | --- |
| **BE-2B-1 M55** | Hai bảng `SOCIAL_POST_TYPE_PAIRS` ↔ `SOCIAL_POST_TYPE_DENIED` chưa ghép với `feedCreatableTypeSchema` | **Đóng ở đây** — D2 + **C-6** |
| **BE-2B-1** | `POLL_CREATE_REQUIRED` ship mà **không ca int nào chạm** (seed cấp cặp cho cả 4 vai — `social.errors.ts:254-256`) | **Đóng lớp lỗi** — D23 (vai tuỳ biến cho spec) + **C-7** census mã lỗi |
| **BE-1B (g)1-5,7,8** | Hiệu năng/độ chính xác route BE-1B | Không chạm |
| **BE-2A §13 T1** | Avatar nhóm write-only | Không chạm |
| **DB-2 (c)** | NOTI-034 `dedupe_strategy='None'` | Không chạm |

---

## §1. Bảng ĐO TRƯỚC

> Đo trên `master` = `f407c1d1` (sau #534, #535), ngày 23-24/09/2026. Ô nào không đo được ghi **CHƯA
> ĐO** (§1.e). Lượt 2 đã sửa 3 ô sai do `plan-reviewer` bắt (M4 đếm thiếu · M15 trích thiếu vế CHECK ·
> M20 lệch số dòng) và thêm 2 ô còn thiếu hẳn (M39 · M40).

### 1.a Nền — migration · route · mã lỗi

| # | Câu hỏi | Nguồn | Kết quả THỰC TẾ | Hệ quả cho plan |
| --- | --- | --- | --- | --- |
| **M1** | Head migration? | `apps/api/migrations/` | **`0586_s16socialfe1_enable_social_module`** (idx 253) | **§6: KHÔNG migration.** Cần `0587` ⇒ tín hiệu DỪNG |
| **M2** | Route đã build? | census `:246` | `toBe(44)` (19 A + 10 B + 10 NHÓM + 5 BÌNH CHỌN) | +4 ⇒ **48** |
| **M3** | `SOCIAL_ROUTE_PAIRS` hình dạng? | `social-route-pairs.const.ts` | 44 khoá; `pair(action, resourceType, tier1IsFloor=false, companyFloor=true[, dataScope])`; tập `companyFloor:false` có ĐÚNG 1 phần tử (`reportsList`) | Thêm 4 khoá additive, `tier1IsFloor:false`, `companyFloor:true` |
| **M4** 🔴 ⟲F11 | `SOCIAL-ERR-019/020/022` đã khai chưa? | `grep` trong `social.errors.ts` | **CHƯA — 0 kết quả.** File (358 dòng) khai `001..018` + `021` + **8** hằng KHÔNG SỐ: `:118` · `:172` · `:183` · `:235` · `:248` · **`:258` `POLL_CREATE_REQUIRED`** · **`:273` `POLL_WRITE_BUSY`** · **`:300` `SOCIAL_POST_TYPE_PAIR_DESYNC`** | 3 mã là của chính WO này; tiền lệ hằng-có-tên vững (8 cái) |
| **M5** | Nghĩa 3 mã theo SPEC | `SPEC-16:329-332` | `019` 409 chuyển trạng thái sai · `020` 403 thiếu `approve:feed-idea` · `022` 422 huy hiệu không có/đã tắt | Ánh xạ 1-1, **không nới nghĩa** |
| **M6** | Ca nào KHÔNG có mã catalog? | `done_when` ↔ `SPEC-16:311-332` | **K1** · **K2** · **note rỗng sau btrim** · **recipient không thuộc tenant** | Hằng CÓ TÊN. K1/K2 owner ĐÃ KÝ (S3) |
| **M7** | `SOCIAL_POST_TYPE_PAIRS` hiện có gì? | `social-route-pairs.const.ts:241-249` | **3 khoá**: `share: null` · `news` · `poll` | +`idea` +`kudos` |
| **M8** 🔴 | Cổng cặp-theo-`type` gác ở đâu? | `social-access.service.ts:161-177` | **`assertCreatablePostType`** — đọc THẲNG bảng hằng; `null` ⇒ qua; bảng `DENIED` lệch ⇒ `SOCIAL_POST_TYPE_PAIR_DESYNC` (fail-closed); `resolveManyOrNull` + `isCompany()` | 🔴 Kiến trúc đã ĐỔI so với nháp cũ: WO này chỉ **thêm 2 dòng vào 2 bảng** (D1) |
| **M9** 🔴 ⟲F13 | `done_when` #8 («mỗi cặp non-null xuất hiện ĐÚNG MỘT LẦN dưới dạng literal trong `social-posts.service.ts`/`social-post-types.ts`») còn đúng không? | `grep resourceType` hai file đó | **KHÔNG — 0 kết quả ở CẢ HAI file** (plan-reviewer xác minh độc lập). Cặp chỉ còn trong bảng hằng | 🔴 Lưới đó **KHÔNG THOẢ ĐƯỢC**: assert đẳng thức `0 === 1` ⇒ **đỏ vĩnh viễn**, và cách «sửa» duy nhất là nhét literal trở lại `social-posts.service.ts` = **thoái lui kiến trúc BE-2B-1** (memory `gate-measurement-row-can-be-unsatisfiable`). Thay bằng **D2 + C-6** |
| **M10** | Seed `0578` cấp cho vai nào? | `0578:45-46,51,53` · `:79-86,98-99,102-103` | `create:feed-idea` · `create:feed-kudos` @Company cho **cả 4 vai canonical**; `manage:feed-kudos` và `approve:feed-idea` **chỉ `hr` + `company-admin`** | 🔴 Không vai chuẩn nào deny được 2 cặp `create` ⇒ **D23** |
| **M11** | Grant DB 4 bảng | `0580:553-559` | `feed_ideas` S/I/**U** · `feed_kudos` S/I/U · `feed_kudos_recipients` S/I/**D** · `feed_kudos_badges` S/I/U (**không DELETE**) | `reviewTx` UPDATE hợp lệ; spec tự INSERT badge được (U6) |
| **M12** 🔴 | `createFeedPostSchema` nhận `type` nào? | `contracts/social-api.ts:88` · `:321-444` | `z.enum(["share","news","poll"])`; object phẳng `.strict().superRefine()`; vế `:437` «`body` bắt buộc cho mọi type TRỪ `poll`» | (a) enum 3→5; (b) khoá `kudos` ràng hai chiều; (c) nới vế `body` thành «trừ `poll` VÀ `kudos`» |
| **M13** | Luật «ép ở SERVICE, không ở Zod» viết ở đâu? | `contracts/social-api.ts:309-310` · `:341-345` | «từ chối ở SERVICE … chứ không ở đây — Zod từ chối sẽ trả **400 vô danh**» | `ERR-022` · K1 · K2 · note-rỗng ném ở SERVICE |
| **M14** 🔴 | Union hoá `createFeedPostSchema` được không? | `social.dto.ts:62-74` | UNION ⇒ `createZodDto` ném **TS2509** | **CẤM** union (kéo theo sửa `002` đã ship) |

### 1.b Schema (mig `0580`, `db/schema/social.ts`)

| # | Câu hỏi | Nguồn | Kết quả THỰC TẾ | Hệ quả |
| --- | --- | --- | --- | --- |
| **M15** 🔴 ⟲F26 | `feed_ideas` có gì? | `social.ts:703-740` · `0580:263-301` | `status varchar(16) NOT NULL` **KHÔNG DEFAULT** · `reviewed_by` FK `SET NULL` · `reviewed_at` · `review_note text`. CHECK: `chk_feed_ideas_status` (4 giá trị) · **`chk_feed_ideas_reviewed_pair`** (`status IN ('submitted','under_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)`) · **`chk_feed_ideas_reject_note`** (`status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0)` — trích ĐỦ cả vế `IS NOT NULL`). UNIQUE `(company_id, post_id)` | (a) `createIdeaTx` ghi `status='submitted'` **tường minh** (quên = `23502`); (b) `reviewTx` một câu 4 cột; (c) `rejected` cần note không-rỗng-sau-btrim (Zod `.min(1)` cho lọt `"   "` ⇒ 23514 ⇒ **500**) |
| **M16** 🔴 | `feed_kudos` · `recipients` · `badges`? | `social.ts:778-833` · `:811-829` · `:747-773` | `feed_kudos`: `badge_id` nullable NO ACTION · `message` · `is_official` default false, UNIQUE `(company_id, post_id)`. `recipients`: PK `(company_id, kudos_id, employee_id)`, **KHÔNG có `created_at`**, FK `employee_profiles.id`. `badges`: `code(32)` · `is_active` · `position`, UNIQUE `(company_id, code)` | 🔴 Người nhận neo `employee_id`, NOTI gửi `user_id` ⇒ map TRONG tx (D18) |
| **M17** | Catalog huy hiệu có dữ liệu chưa? | `0582:62-74` · `social-master-data.seeder.ts:129` | **5 huy hiệu/công ty** (`teamwork`·`innovation`·`customer-first`·`mentor`·`above-beyond`), `ON CONFLICT DO NOTHING` | ⚠️ **CHƯA ĐO tenant fixture của int-spec có đi qua seeder không** ⇒ **U6** |
| **M18** | `chk_feed_posts_body_required`? | `social.ts:154-157` | `type IN ('poll','kudos') OR (body IS NOT NULL AND btrim ≠ '')` | `kudos` được `body` NULL; **`idea` thì KHÔNG** |
| **M19** | RLS + FORCE? | `0580:102-103,292-325` | Cả 4 bảng ENABLE + FORCE, policy `tenant_isolation` | Cross-tenant đo được ở tầng DB |
| **M19b** | FK chéo tenant của recipients? | `0580:439` | `feed_kudos_recipients_employee_tenant_fk (company_id, employee_id)` | Cross-tenant recipient bị chặn ở DB (`23503`) **kể cả khi** D12a hỏng ⇒ K-2b là ca **chất lượng mã lỗi**, không phải lỗ bảo mật |

### 1.c Sổ · ratchet · cổng

| # | Sổ | Nguồn | HIỆN TẠI | Hệ quả |
| --- | --- | --- | --- | --- |
| **M20** 🔴 ⟲F25/F24 | Census 2 tầng — **5 chỗ** | `social-two-layer-guard-census.unit-spec.ts` | (i) `SOCIAL_CONTROLLERS` `:34-49` — **8 tên, DANH SÁCH TRẮNG** («không có tên ở đây ⇒ route VÔ HÌNH, cả 4 assert vẫn XANH») · (ii) `ROUTE_TO_KEY` `:51-115` (44) · (iii) `SERVICE_SITE_TO_KEYS` `:123-172` (44) · (iv) `toBe(44)` `:246` · (v) **thông điệp assert `:245` còn ghi «39»** | 5 việc, thiếu một là **fail-OPEN IM LẶNG** |
| **M21** | `test:cov:social` gồm gì? | `apps/api/package.json:16` | `src/social` + census unit-spec + **13 int-spec liệt kê TỪNG CÁI** + `social-noti-bridge.registrar.spec.ts` | Int-spec mới **phải THÊM TAY**; spec colocated trong `src/social/**` tự vào |
| **M22** 🔴 | Census quét thư mục thế nào? | cùng file `:177`, `:205` | `fs.readdirSync` — **PHẲNG, KHÔNG đệ quy** | Mọi file mới PHẢI phẳng trong `apps/api/src/social/` |
| **M23** | `MIN_COVERED_COUNT` | `route-http-coverage.e2e-spec.ts:363` | **`676`** (BE-2B-1 đã trả cả nợ 10 của BE-2A) | Đặt = số spec IN RA (`:407`) — **U2** |
| **M24** ⟲F17 | Route census JSON | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json:7,9,13` | `routes 676` · `gated 637` · `needVerdict 39` | Sau WO ghim **cả ba** (regen rồi đọc, không suy) |
| **M25** | `identity-projection-verdicts` | `identity-projection-verdicts.ts:669-763` · `BASIS_CEILINGS:780+` | SOCIAL **11 dòng**. Trần: `waiver 8` · `no-actor 7` · `second-assert 11` · `self-bound-route 9` · `order-only 1` · `scoped-predicate 24` · `membership 12` · `self-bound-row 5` | `045` **và** `047` đều chiếu danh tính ⇒ thêm dòng + bump đúng basis — **U4** |
| **M26** | Ngưỡng coverage per-file | `vitest.config.ts:144-149` | `social-access.service.ts` 90/90/85 | WO **có** chạm file đó (D20) ⇒ nhánh mới phải có ca |
| **M27** | Ratchet `@Param` | `param-uuid-ratchet.unit-spec.ts:67,199` | `UNPIPED_CEILING = 1`, assert **ĐẲNG THỨC** | `@Param("post_id")` của `046` BẮT BUỘC `ParseUUIDPipe` |
| **M28** | Ratchet body-validation | `body-validation-ratchet.unit-spec.ts:53` | `toBe(0)` | `046` phải `@UsePipes(ZodValidationPipe)` |

### 1.d Cái sẽ TÁI DÙNG

| # | Câu hỏi | Kết quả THỰC TẾ | Hệ quả |
| --- | --- | --- | --- |
| **M29** | Khuôn danh sách OFFSET | `social-polls.repository.ts:376-425` + `social-polls.service.ts:54-82` — `visiblePostCondition` NGAY TRONG câu · `.limit().offset()` · `total` window function · envelope `{data,page,limit,total}` | Khuôn cho `045`/`047`/`048`; API-19 §6.4 `:249-251` đòi envelope + **khoá phá-hoà duy nhất** ⇒ `ORDER BY …, id` |
| **M30** | Khuôn UPDATE cặp vết MỘT câu | `social-reports.repository.ts#resolveReport` — `.set({...}).where(and(id, companyId, eq(status,'open'))).returning({id})`; caller 409 khi rỗng. ⚠️ Khuôn **chỉ** `.returning({id})` | Khuôn cho `reviewTx` (D5) — và là bằng chứng của **F5** |
| **M31** 🔴 | Khuôn FSM PAYROLL áp nguyên xi được không? | `payroll-fsm.ts` ném `ConflictException({code, message, details})`. SOCIAL: `SOCIAL_ERR` là **chuỗi trần** | Ném chuỗi trần, **không** dựng envelope lỗi thứ hai (D4) |
| **M32** | Map employee→user + lọc người còn hoạt động | `social-mentions.ts:187-224` (`users.status='active'` + `employee_profiles.status='active'` + `deleted_at IS NULL` cả hai) · `social-news.repository.ts:200,239,285` | Nguyên liệu VERBATIM của **D18** |
| **M33** | Khuôn unit không cần DB | `social-news-noti-cap.spec.ts` (`fakeTx()`, service với `null as never`) | Ma trận FSM · K2 · C-6 |
| **M34** | NOTI pin VERBATIM | `0581:194,196` · `:243-254` · `:332-333`: `SOCIAL_IDEA_STATUS_CHANGED` `Normal`/**`DedupeKey`**/`is_system_event=false`, vars `{status_label, post_id}`, comment `:242` «CHỈ `status_label` — KHÔNG nhúng `review_note`» · `SOCIAL_KUDOS_RECEIVED` `Normal`/**`DedupeKey`**/`false`, vars `{actor_name, post_id}` | CẢ HAI `DedupeKey` ⇒ BẮT BUỘC `dedupeKeyOf` |
| **M34b** | Tuple dedupe thật | `notification-dedupe.service.ts:37` partial-unique `(company_id, recipient_user_id, event_code, dedupe_key)` · `:78` `computeKey = ${eventCode}:${dedupeKey}` · `:111` lọc đúng 4 cột (plan-reviewer xác minh) | `{post_id}` ĐỦ cho 033; `{post_id}:{status}` BẮT BUỘC cho 032. `dedupeKeyOf` đọc `ctx.payload` **THÔ** ⇒ `status` không cần vào `PAYLOAD_KEYS` |
| **M35** | Registrar hôm nay | `social-noti-bridge.registrar.ts:21` `PAYLOAD_KEYS` (12 khoá, **có `actor_name`, thiếu `status_label`**) · `:44` `TEMPLATE_KEYS` · `:76` `PAYLOAD_KEYS_DENIED` (`SOCIAL_POLL_CLOSED: ["actorUserId","actor_name"]`) · `:253-268` mẫu BE-2B-1 | `PAYLOAD_KEYS` +1 · `TEMPLATE_KEYS` +2 · `DENIED` +1 |
| **M36** | Bảng mã sự kiện nội bộ | `social-noti.payload.ts:30` `_CODES` · `:87` `_B` · `:180` `_C` · `:221` `_D` | Thêm **`_E`** — không sửa 4 bảng cũ |
| **M37** 🔴 | Audit `object_type` có `feed_idea`/`feed_kudos`? | `db/schema/audit.ts` + `0583:9-15` | **KHÔNG** — `0583` ghi CHỦ Ý «vinh danh là một BÀI (`feed_post`)». CHECK đã có `feed_post` | Audit `046` ghi `feed_post`/`postId`. **KHÔNG migration** |
| **M38** | Tên `action` audit SOCIAL (`social-posts.service.ts:287,352` · `social-polls.service.ts:217`) | `social.post.update` · `social.post.delete` · `social.poll.close` | `046` ⇒ **`social.idea.review`** |
| **M39** 🔴 ⟲F1 | **`PermissionGuard` deny bằng thông điệp gì?** | `permission.guard.ts:140` ném `ForbiddenException("Permission denied: " + decision.reason)`; `require-permission.decorator.ts` **không nhận message tuỳ biến** (chỉ `action`/`resourceType`/`isSensitive`/`requiresReauth`) | 🔴 **Tầng-1 KHÔNG BAO GIỜ phát được `SOCIAL-ERR-020`.** Khai hằng mà chỉ dựa vào decorator ⇒ **hằng CHẾT** (đúng lớp `SOCIAL-ERR-008` mà §10 đang nợ) ⇒ **D20** |
| **M40** ⟲F9 | Outbox NOTI của `create()` trong hay ngoài tx? | `social-posts.service.ts:233-246` — `enqueueMentionNotis` và `enqueueNewsPublishedNoti` đều gọi **TRONG** `withTenant`; comment `:237-239` «CÙNG tx với INSERT (C8)»; chỉ `emitPostCreated` (WS) chạy sau commit | NOTI-033 **INSERT hàng outbox TRONG tx**; chỉ dispatch/WS sau commit (D24) |

### 1.e CHƯA ĐO — phải đo ở Bước 0

| # | Việc | Vì sao chưa đo | Đo khi nào |
| --- | --- | --- | --- |
| **U2** | `coveredCount` thật sau khi thêm 4 route | Phải chạy spec; **cấm cộng tay 676+4** | Bước 6 |
| **U4** | Điểm chiếu + basis mà census IN RA cho `listIdeasTx` **và** `listKudosTx` | Census phải chạy mới biết `pointKey` | Bước 6, trước khi bump trần |
| **U6** 🆕 ⟲F8 | Tenant fixture của `social-*.int-spec.ts` có bao nhiêu hàng `feed_kudos_badges`? | M17 chỉ đo migration `0582`, chưa đo fixture runtime (memory `seeder chạy mỗi boot`) | **Bước 0.** Nếu 0 ⇒ spec tự INSERT badge (grant có, `0580:559`) và ghi §13 |
| **U7** 🆕 ⟲F23 | Fixture tạo được `employee_profiles` KHÔNG kèm `users` không? | Quyết định ca **K-4c** có dựng được không | **Bước 0.** Không dựng được ⇒ xoá K-4c, ghi §13 thay vì kê ca giả |
| **U8** 🆕 ⟲F7 | Tạo vai tuỳ biến (không phải 4 vai canonical) trong int-spec bằng đường nào, có sạch sau teardown không? | Quyết định T-1..T-3 có dựng được không | **Bước 0** — xem D23 |

### 1.f ĐÃ ĐO trong lượt sửa plan (24/09/2026)

| # | Câu hỏi | Kết quả | Hệ quả |
| --- | --- | --- | --- |
| **U1** ✅ | Ai ghim `feedCreatableTypeSchema` 3 giá trị? | **Không ai.** Định nghĩa duy nhất `social-api.ts:88`; `apps/app/.../FeedComposer.tsx` + `.spec.tsx` chỉ nhắc trong **COMMENT**. `contracts/social.spec.ts:34` ghim `feedPostTypeSchema` = **5 giá trị** — đó là enum của CHECK `0577`, **khác** enum creatable | Mở 3→5 **an toàn**; ⟲F15: **không cần** `apps/app/**` trong `paths`. FE đỏ ⇒ DỪNG, tách WO |
| **U3** ✅ | `045`/`047` tái dùng `listFeed` được không? | `social-posts.repository.ts:61-74` — `listFeed` có `type?` nhưng **cursor-based** và không JOIN `feed_ideas`/`feed_kudos` | Dùng câu RIÊNG theo khuôn `listPollsTx` (M29) |
| **U5** ✅ | `feedPostSchema` (thẻ bài) có chở chi tiết idea/kudos? | `contracts/social-api.ts:154-181` — `type: z.string()`, **không** trường nào cho poll/idea/kudos | **KHÔNG nới** DTO thẻ bài ở WO này; FE-2 gọi `045`/`047` riêng (§10) |
| **U9** ✅ ⟲F16 | `apps/api/vitest.config.ts` có phải sửa không? | Ngưỡng per-file chỉ khai cho `social-access.service.ts`; WO không thêm file nào cần ngưỡng riêng | **Không chạm** ⇒ không cần trong `paths` |

---

## §2. Quyết định

| # | Quyết định | Nội dung | Căn cứ |
| --- | --- | --- | --- |
| **D1** 🔴 | **Cặp theo `type` = THÊM 2 DÒNG vào 2 bảng** | `SOCIAL_POST_TYPE_PAIRS` += `idea:{create,feed-idea}` · `kudos:{create,feed-kudos}`; `SOCIAL_POST_TYPE_DENIED` += 2 chuỗi 403. `assertCreatablePostType` **không đổi một dòng** | M7; M8 |
| **D2** 🔴 ⟲F13 | **Ghép hai bảng với enum ở TẦNG KIỂU + spec C-6** | (a) `satisfies Record<FeedCreatableTypeDto, …>` cho CẢ hai bảng ⇒ thêm giá trị vào enum mà quên bảng = **TS đỏ**. Hôm nay `social.errors.ts:289` mới chỉ ghép `DENIED`↔`PAIRS` (`SocialCreatablePostType`), **chưa** ghép với enum Zod — lỗ có thật; (b) spec **C-6** so TẬP khoá. **Không** viết lưới `done_when` #8 vì nó **KHÔNG THOẢ ĐƯỢC** (M9) | M9; BE-2B-1 M55 |
| **D3** | **Thân riêng theo loại ở `social-post-types.ts`** | `createIdeaTx` · `createKudosTx` (append). Hàm thuần nhận `tx`, **không** tự mở `withTenant`, **không** gọi `resolveActor` | khuôn `createPollTx`; `social-posts.service.ts` 653/800 |
| **D4** 🔴 | **FSM — bảng cạnh literal + MỘT hàm assert, ném CHUỖI TRẦN** | `social-idea-fsm.ts`: `IDEA_TRANSITIONS` = **ĐÚNG 3 cạnh** (`submitted→under_review`, `under_review→accepted`, `under_review→rejected`), terminal, không reopen, không nhảy cóc; `assertIdeaTransition` ném `ConflictException(SOCIAL_ERR.IDEA_TRANSITION)`. KHÔNG envelope kiểu PAYROLL | M31; SPEC-16 §13.3 |
| **D5** 🔴 ⟲F5 | **`reviewTx` — SELECT-khoá lấy `from`, rồi MỘT câu UPDATE 4 cột + `WHERE status=<from>` + `RETURNING {id}`** | `UPDATE … RETURNING` trả **giá trị SAU cập nhật** ⇒ **không lấy được `status` cũ từ chính câu đó** (khuôn `resolveReport` cũng chỉ `.returning({id})` — M30). `from` lấy từ **`getIdeaForReviewTx`** (`SELECT id, status … FOR UPDATE`, CÙNG tx, chạy TRƯỚC). 0 hàng UPDATE ⇒ **409 `ERR-019`** (thua đua). Thiếu vế cặp vết ⇒ 23514 ⇒ 500. **CẤM mapped-write** | M15; M30 |
| **D6** 🔴 ⟲F6 | **Không có hàng `feed_ideas` ⇒ 404, KHÔNG phải 409** | `assertPostVisible` cho bài `type='share'` đi QUA (nó chỉ gác tầm nhìn). Để `reviewTx` 0 hàng nuốt luôn ca này thì `PATCH /social/posts/{bài share}/idea/review` trả 409 «chuyển trạng thái sáng kiến sai» — sai mã, sai nghĩa. `getIdeaForReviewTx` không có hàng ⇒ **404 `ERR-001`** | API-19 §6.5 (404 trước 403) |
| **D7** 🔴 | **`rejected` ⇒ `btrim(note).length > 0` ép Ở SERVICE** | Zod `z.string().trim().max(2000).optional()` — **không `.min(1)`**. Service ⇒ **422 `IDEA_REJECT_NOTE_REQUIRED`** | M15(c); M13 |
| **D8** 🔴 | **Audit + outbox CHỈ khi UPDATE ≠ 0 hàng, TRONG CÙNG tx** | `audit_logs` append-only. Đua hai người duyệt ⇒ `COUNT(*) audit = 1` VÀ outbox NOTI-032 = 1. Audit: `feed_post`/`postId`/`social.idea.review`/`{postId, ideaId, from, to}` — **KHÔNG** `review_note` | M37; M38; `0581:242` |
| **D9** 🔴 | **K1 + K2 ép ở SERVICE (owner ký S3)** | K1 ⇒ 422 `KUDOS_SELF_RECIPIENT`; K2 (`KUDOS_RECIPIENT_MAX = 10`, hằng module-level) ⇒ 422 `KUDOS_RECIPIENT_LIMIT`. Zod chỉ chặn hình dạng. Bổ sung 2 dòng SPEC-16 §13 **sau khi** dán grep phủ định vào §13 | owner ký 23/09; M6 |
| **D10** 🔴 | **`isOfficial:true` đòi `manage:feed-kudos` — cổng thứ hai ở service** | `resolveManyOrNull([{manage, feed-kudos}])` + `isCompany()`; thiếu ⇒ **403 `KUDOS_OFFICIAL_DENIED`**, `COUNT(*) feed_kudos = 0`. Không nhét vào batch `resolveActor` (chạy cho cả 48 route) | M10; M8 |
| **D11** 🔴 | **`ERR-022` — huy hiệu phải TỒN TẠI trong tenant VÀ `is_active`** | Một câu `SELECT … WHERE company_id AND id AND is_active` cùng tx; 0 hàng ⇒ **422 `ERR-022`** cho cả ba nguyên nhân (không có · đã tắt · tenant khác), **cùng chuỗi**. `badgeId` vắng là hợp lệ | M5; M16 |
| **D12** 🔴 ⟲F4 | **Người nhận — GHI, ĐỌC, NOTI là BA quyết định RIÊNG** | **(a) GHI:** phải là `employee_profiles` của tenant, `deleted_at IS NULL`; số hàng BẰNG số id distinct, lệch ⇒ 422 `KUDOS_RECIPIENT_INVALID`. **KHÔNG** lọc `status='active'` ở đây — người đã nghỉ vẫn được vinh danh (lời cảm ơn khi chia tay là ca thật) và `done_when` K-4 mô tả đúng một bài có CẢ hai. **(b) ĐỌC (`047`):** DTO người nhận chở ĐÚNG `{employeeId, fullName, avatar, isFormerEmployee}` — **không `userId`** (K-7); `isFormerEmployee = employee_profiles.status <> 'active'`. Bề mặt phơi = tên người đã nghỉ trong MỘT bài mà người xem vốn đã thấy (thừa hưởng `visiblePostCondition`) — **hẹp hơn** widget sinh nhật BE-1B (danh bạ toàn công ty). **(c) NOTI:** lọc `active` — D18. **Đường tự gỡ** (vế BE-1B thiếu): xoá mềm bài (`003`, tác giả hoặc `manage:feed-post`) làm cả bài lẫn danh sách người nhận biến khỏi `047` — ca K-9; ghi §13 + báo QA-1 | `done_when` #4; bài học BE-1B; M19b |
| **D13** | **`048` trả envelope OFFSET** | `{data,page,limit,total}`, `is_active = true`, `ORDER BY position, id` | M29; API-19 §6.4 |
| **D14** | **Cổng ĐỌC `045`/`047` đi qua `visiblePostCondition` NGAY TRONG CÂU** | Sáng kiến/vinh danh thừa hưởng phạm vi BÀI CHA. `046` gọi `assertPostVisible` trước. `048` không JOIN bài | BE-2A D1; M29 |
| **D15** | **File mới PHẲNG trong `src/social/`** | Census `readdirSync` không đệ quy | M22 |
| **D16** 🔴 ⟲F20 | **NOTI — `dedupeKeyOf` BẮT BUỘC cả hai mã; hai đường lọc người nhận KHÁC NHAU** | 032 khoá **`"{post_id}:{status}"`** (chỉ `post_id` sẽ NUỐT lượt chuyển thứ hai); 033 khoá `"{post_id}"`. **Người nhận 032 = tác giả bài (`author_user_id`) ⇒ lọc bằng `activeUserIdsTx` (2 vế: `users.status='active' AND users.deleted_at IS NULL`), KHÔNG dùng D18** (D18 là map employee→user, sai kiểu cho đường này). `PAYLOAD_KEYS` += `status_label`. 🔴 `PAYLOAD_KEYS_DENIED.SOCIAL_IDEA_STATUS_CHANGED = ["actorUserId","actor_name"]` — danh tính NGƯỜI DUYỆT không vào `notifications.payload` (kênh trả đũa; hàng sống lâu hơn grant) | M34; M34b; M35 |
| **D17** | **`status_label` là bảng nhãn ĐÓNG enum→tiếng Việt ở service** | `{submitted:"Đã gửi", under_review:"Đang xét duyệt", accepted:"Được duyệt", rejected:"Từ chối"}` | `0581:243-248` |
| **D18** 🔴 | **Vị từ NGƯỜI CÒN HOẠT ĐỘNG cho NOTI-033 — VIẾT RA VERBATIM** | `userIdsOfEmployeesTx` JOIN `employee_profiles` → `users`, ĐÚNG bốn vế: `employee_profiles.status = 'active'` **AND** `employee_profiles.deleted_at IS NULL` **AND** `users.status = 'active'` **AND** `users.deleted_at IS NULL`. Nghỉ việc KHÔNG xoá mềm ⇒ chỉ lọc `deleted_at` là **hở**. Nhân sự không có tài khoản ⇒ INNER JOIN làm họ rụng, **có chủ ý**. `recipientUserIds` rỗng ⇒ **KHÔNG enqueue** | `done_when` #4; M32 |
| **D19** 🔴 ⟲F3 | **DTO `045`/`046` — khai TƯỜNG MINH ai thấy `reviewNote`, KHÔNG chiếu `reviewed_by` thô** | `045` gác **chỉ `view:feed`** (mọi nhân viên). Nếu DTO chở `reviewNote` cho tất cả thì lý do loại nó khỏi audit (D8) và khỏi payload NOTI (D16) sụp — audit ít ra còn cổng đọc riêng, `045` thì không. Quy định: `reviewNote` **chỉ** chiếu cho **tác giả sáng kiến** HOẶC người có `approve:feed-idea` (đo bằng `isCompany(scope)` đã resolve); người khác nhận `reviewNote: null`. `reviewedBy` **không chiếu `users.id`** — chiếu `reviewer: {fullName}` hoặc bỏ hẳn. Thêm dòng `listIdeasTx` vào identity-projection (U4) | SPEC-16 §12; API-19:115 |
| **D20** 🔴 ⟲F1 | **`ERR-020` — GIỮ decorator tầng-1 VÀ tự resolve lại ở service** (owner chọn 24/09/2026 — S5) | Tầng-1 `046` = `approve:feed-idea` (**không hạ xuống `view:feed`**). Nhưng guard chỉ ném `Permission denied: <reason>` và decorator không nhận message (M39) ⇒ service thêm **`assertApproveIdea(actor)`** (khuôn `assertCreatablePostType`): `resolveManyOrNull([{approve, feed-idea}])` + `isCompany()`; sai ⇒ **403 `SOCIAL_ERR.IDEA_APPROVE_REQUIRED` = `SOCIAL-ERR-020`**. 🔴 Vùng phủ THẬT: ca **«có grant nhưng scope hẹp hơn Company»**; ca «không có grant» vẫn là 403 chung của guard — **ghi rõ vào §13 và PR**, không tuyên bố mã phủ cả hai | M39; SPEC-16:330, T16 `:568` |
| **D21** ⟲F21 | **`review_note` là vết của LẦN DUYỆT CUỐI — ghi đè có chủ ý** | `.set({reviewNote: dto.reviewNote ?? null})` mọi lượt: `reviewed_by`/`reviewed_at` cũng là "lần cuối"; để `review_note` lệch kiểu sẽ thành ba cột kể ba câu chuyện. Hệ quả ĐO ĐƯỢC: `submitted→under_review` (note A) rồi `→accepted` (không note) ⇒ note A **mất**. Ai cần lịch sử đọc `audit_logs` (mỗi lượt một dòng) | M15; D8 |
| **D22** ⟲F12 | **Cặp `manage:feed-kudos` của `isOfficial` cũng phải có bảng hằng** | Khai `SOCIAL_KUDOS_FLAG_PAIRS = { isOfficial: {manage, feed-kudos} }` (tiền lệ `SOCIAL_MODERATION_FIELD_PAIRS`, `social-route-pairs.const.ts:262-266`) và **C-6 phủ luôn nó**. Không có bảng thì cặp này chỉ được K-3 giữ: xoá dòng `resolveManyOrNull` ⇒ mọi census/sổ XANH. ⚠️ **KHÔNG** đưa vào nguồn độc lập của đẳng thức `tier1IsFloor` (`census:319-329`) — `002` đã `tier1IsFloor:true` sẵn, thêm nữa sẽ đỏ oan | M8; census |
| **D23** ⟲F7 | **Ca DENY của cặp `create:feed-*` dựng bằng VAI TUỲ BIẾN, không đụng 4 vai canonical** | Seed cấp 2 cặp cho cả 4 vai (M10) ⇒ không vai chuẩn nào deny được; `POLL_CREATE_REQUIRED` của BE-2B-1 đã ship **không ca nào chạm**. Spec tạo **vai riêng** (chỉ `view:feed` + `create:feed-post`) gán cho user riêng của chính spec. Sửa `role_permissions` của vai canonical là **CẤM** (memory `test-fixture-stamps-global-permission-catalog` · `flake-rate-tracks-lane-db-dirtiness`). Không dựng được (U8) ⇒ **ghi thẳng «T-1..T-3 KHÔNG dựng được, nhánh 403 chỉ có lưới C-6»**, không kê ca giả | M10; U8 |
| **D24** ⟲F9 | **Outbox NOTI-033 INSERT TRONG tx; chỉ dispatch/WS sau commit** | Khuôn đã đo ở M40. Ghi hàng outbox sau commit = at-most-once (chết giữa chừng ⇒ mất sự kiện) và phá luật CLAUDE.md §3 | M40 |

### 2.3 Chữ ký owner

| # | Việc | Trạng thái |
| --- | --- | --- |
| **S1** | `047`/`048` thuộc WO này; `049..051` thuộc BE-3 | ✅ **KÝ 23/09/2026.** Sửa `src` CẢ HAI WO cùng PR |
| **S3** | K1 + K2 ép ở service + bổ sung 2 dòng SPEC-16 §13 | ✅ **KÝ 23/09/2026**, kèm điều kiện dán grep phủ định |
| **S5** | `ERR-020`: giữ decorator tầng-1 + service tự resolve (D20) | ✅ **KÝ 24/09/2026.** Ghi rõ vùng phủ thật của mã vào §13 + PR |
| **S6** ✅ ⟲F10 | **D12(a) — cho phép vinh danh người ĐÃ NGHỈ (chặn ở NOTI + cờ `isFormerEmployee` ở DTO), thay vì chặn ở đường ghi** | ✅ **KÝ 24/09/2026 — phương án A.** _(PHẢI KÝ TRƯỚC Bước 1 — xây rồi xin là sai chiều với một quyết định mở bề mặt chiếu danh tính.<br>⚠️ Lý lẽ cũ («phương án B làm K-4 thành ca không dựng được») **đã rút — SAI một nửa**: dưới B vẫn dựng được ca D18 ở tầng repository (gọi thẳng `userIdsOfEmployeesTx`); chỉ **ca HTTP đúng như `done_when` mô tả** (một bài có cả người đã nghỉ lẫn người active) là không dựng được. Lý do THẬT chọn A: (i) `done_when` #4 do owner viết mô tả đúng hình dạng đó; (ii) vinh danh là **lịch sử**, chặn ở ghi làm mất ca «cảm ơn lúc chia tay»; (iii) bề mặt phơi hẹp + CÓ đường tự gỡ (D12c) |
| **S7** ✅ ⟲F13 | **D2/C-6 thay lưới `done_when` #8** | ✅ **KÝ 24/09/2026.** Lưới đó **không thoả được** (đếm literal = 0, assert đòi = 1) ⇒ hoặc spec đỏ vĩnh viễn, hoặc phải khôi phục literal hard-code = thoái lui kiến trúc BE-2B-1. Thay bằng ghép-kiểu + C-6 (bắt ở TS, so TẬP với enum, phủ thêm `SOCIAL_KUDOS_FLAG_PAIRS`) |

---

## §3. Cấu trúc file

### 3.1 File MỚI (`apps/api/src/social/` — PHẲNG, M22)

| File | Trách nhiệm | ~dòng |
| --- | --- | --- |
| `social-idea-fsm.ts` | `IDEA_TRANSITIONS` (3 cạnh) · `assertIdeaTransition` · `IDEA_STATUS_LABEL` (D17). Thuần TS | 70-100 |
| `social-ideas.repository.ts` | `listIdeasTx` (D14/D19) · `getIdeaForReviewTx` (`FOR UPDATE`, D5/D6) · `reviewTx` (D5) | 160-200 |
| `social-ideas.service.ts` | `045` · `046` (gồm `assertApproveIdea` D20, audit + NOTI-032 trong tx) | 160-200 |
| `social-kudos.repository.ts` | `listKudosTx` (D12b) · `listBadgesTx` (D13) · `activeBadgeTx` (D11) · `assertRecipientsTx` (D12a) · `userIdsOfEmployeesTx` (**D18**) · `activeUserIdsTx` (D16) | 180-220 |
| `social-kudos.service.ts` | `047` · `048` | 100-140 |
| `social-b2b2.controllers.ts` | `SocialIdeasController` · `SocialKudosController` (mỏng) | 120-160 |
| `social-post-type-pairs-structure.spec.ts` | **C-6** (D2b + D22) — unit | 70-100 |
| `social-error-code-census.spec.ts` ⟲F22 | **C-7** — mọi hằng MỚI của WO phải có ≥1 throw-site trong `src/social/**`; neo dương đếm > 0. Khuôn `payroll-error-code-census.unit-spec.ts` | 60-90 |

### 3.2 File SỬA

| File | Sửa gì | Bẫy đã biết |
| --- | --- | --- |
| `social-post-types.ts` (172) | +`createIdeaTx` (`status='submitted'` TƯỜNG MINH) +`createKudosTx` | `status` KHÔNG có DEFAULT ⇒ `23502` |
| `social-posts.service.ts` (**653**) | `create()` +2 nhánh; **NOTI-033 enqueue TRONG tx** (D24) | 🔴 Trần 800. Site census `#create → postCreate` KHÔNG đổi |
| `social-access.service.ts` (496) | +`assertApproveIdea` (D20) | ⚠️ Chạm ⇒ cổng 90/90/85 (M26): I-2 + I-2b phải phủ cả hai nhánh |
| `social.errors.ts` (358) | +3 mã SỐ (`019` `IDEA_TRANSITION` · `020` `IDEA_APPROVE_REQUIRED` · `022` `KUDOS_BADGE_INVALID`) + 5 hằng CÓ TÊN (`IDEA_REJECT_NOTE_REQUIRED` · `KUDOS_SELF_RECIPIENT` · `KUDOS_RECIPIENT_LIMIT` · `KUDOS_RECIPIENT_INVALID` · `KUDOS_OFFICIAL_DENIED`) + 2 dòng `DENIED` | Khối additive; sửa header `:20-21` |
| `social-route-pairs.const.ts` (275) | +4 khoá route + `SOCIAL_POST_TYPE_PAIRS` +2 + **`SOCIAL_KUDOS_FLAG_PAIRS`** (D22) + ghép kiểu D2a | 4 khoá đều `tier1IsFloor:false` |
| `social.dto.ts` (74) | +4 class DTO | `createZodDto` không bọc union (M14) |
| `social.module.ts` (130) | +2 controller +4 provider | 🔴 +2 dòng `SOCIAL_CONTROLLERS` |
| `contracts/social-api.ts` (470) | enum 3→5 (`:88`) · khoá `kudos` · 2 vế `superRefine` · nới vế `body` | U1 đã đo ✅ |
| `contracts/social-api-ideas.ts` · `-kudos.ts` (**mới**) | DTO 4 route (khuôn `social-api-polls.ts`). 🔴 `046`: `status: z.enum(["under_review","accepted","rejected"])` (⟲F14 — `submitted` không là đích của cạnh nào) | Tự dựng DTO kudos |
| `contracts/index.ts` | export 2 file mới | Quên = DTO không thấy |
| `social-noti.payload.ts` (247) | +`SOCIAL_EVENT_CODES_E` + 2 interface | M36 |
| `notifications/social-noti-bridge.registrar.ts` | +2 `registerSource` · `PAYLOAD_KEYS` +1 · `TEMPLATE_KEYS` +2 · `PAYLOAD_KEYS_DENIED` +1 | 🔴 cả hai phải có `dedupeKeyOf` |
| `apps/api/package.json:16` | `test:cov:social` +int-spec mới | M21 |
| `test/foundation/social-two-layer-guard-census.unit-spec.ts` | **5 việc** (M20) gồm sửa thông điệp `:245` | Thiếu (i) ⇒ fail-OPEN |
| `test/foundation/route-http-coverage.e2e-spec.ts:363` | `MIN_COVERED_COUNT` ← số ĐO ĐƯỢC (U2) | Cấm cộng tay |
| `test/foundation/identity-projection-verdicts.ts` | +dòng cho `listIdeasTx` **và** `listKudosTx` + bump đúng basis | M25 · U4 |
| `docs/_review/…route-census.json` | Regen, ghim **3 số** | ⟲F17 |
| `docs/API Design/API-19…md` §6.4 | Thêm `045`/`047`/`048` vào danh sách offset | Cùng PR |
| `docs/SPEC/SPEC-16 SOCIAL.md` §13 | +2 dòng K1/K2 (S3) | Sau khi dán grep phủ định |
| `harness/backlog.mjs` | `src` CẢ HAI WO (S1) · ghi chỗ lệch `done_when` #8 (S7) + #4 (S6) | Không sửa ⇒ mâu thuẫn chỉ **dời chỗ** |

### 3.3 Luật DTO

`.pick()` rồi `.strict()`. **Cấm `.extend()`** — `feedIdeaCoreSchema` (`contracts/social.ts:344`) mang
`status`/`reviewedBy`/`reviewedAt`/`reviewNote` ⇒ `.extend()` biến body `046` thành **TỰ DUYỆT**
(`{status:'accepted', reviewedBy:<mình>}`), bỏ qua `approve:feed-idea`.

---

## §4. Bảng route

| Mã | Method · Path | Tầng-1 | Tầng-2 | Idem | Audit | NOTI | Lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `002`+`idea` | `POST /social/posts` | `create:feed-post` (SÀN) | D1 `create:feed-idea`; `status='submitted'`; `body` BẮT BUỘC (M18) | ✅ | — | — | 403 hằng-tên |
| `002`+`kudos` | như trên | `create:feed-post` (SÀN) | D1 `create:feed-kudos` · D10 `manage:feed-kudos` nếu `isOfficial` · D11 · D12a · K1/K2 | ✅ | — | **033** | 422 `ERR-022` · 422 hằng-tên ×3 · 403 ×2 |
| `045` | `GET /social/ideas` | `view:feed` | D14; lọc `status`; OFFSET; **D19** (mask `reviewNote`) | — | — | — | — |
| `046` | `PATCH …/idea/review` | **`approve:feed-idea`** | **D20 `assertApproveIdea`** → `assertPostVisible` → **D6** `getIdeaForReviewTx` → **D4** → **D5** → D7 → D8 | ❌ | ✅ `feed_post` | **032** | **409 `ERR-019`** · **403 `ERR-020`** · 422 note rỗng · **404 `ERR-001`** |
| `047` | `GET /social/kudos` | `view:feed` | D14; lọc tháng/năm; OFFSET; **D12b** | — | — | — | — |
| `048` | `GET /social/kudos-badges` | `view:feed` | D13 `is_active=true` | — | — | — | — |

🔴 Cả 4 route `tier1IsFloor: false`. `ParseUUIDPipe` cấp method trên `@Param("post_id")` của `046`
(M27 — ĐẲNG THỨC, trần đã dùng hết). **WO KHÔNG có POST mới** ⇒ không thêm `@Idempotent()` nào.

---

## §5. Deny-path RED trước + ALLOW đối chứng

> Mỗi DENY có ALLOW đối chứng; assert phủ định trên tập RỖNG là **deny vacuous**. Assert theo **MÃ LỖI**.

### 5.1 Cặp quyền theo `type` — ⟲F7: dựng bằng **vai tuỳ biến** (D23), phụ thuộc **U8**

| # | DENY | Kỳ vọng ĐẾM ĐƯỢC | ALLOW đối chứng | DB? |
| --- | --- | --- | --- | --- |
| **T-1** | User mang **vai tuỳ biến** (chỉ `view:feed` + `create:feed-post`) tạo `type='idea'` | 403 chuỗi hằng-tên; `COUNT(*) feed_ideas = 0` | Vai `employee` ⇒ 201 + 1 hàng `status='submitted'` | ✅ |
| **T-2** | Cùng vai đó tạo `type='kudos'` | 403; `COUNT(*) feed_kudos = 0` | `employee` ⇒ 201 | ✅ |
| **T-3** 🔴 | Vai tuỳ biến có `create:feed-idea` **@Department** | 403 (sàn `isCompany()` fail-closed) | @Company ⇒ 201 | ✅ |
| **T-3b** | Cách ly fixture | Sau T-1..T-3, ALLOW của T-1 vẫn 201 (vai canonical KHÔNG bị sửa) | — | ✅ |
| **T-4** ⟲F18 | `type='idea'` không có `body` | **400 của Zod** (`superRefine`) — chốt MỘT mã | `kudos` không `body` ⇒ 201 | ✅ |

### 5.2 Sáng kiến

| # | DENY | Kỳ vọng | ALLOW | DB? |
| --- | --- | --- | --- | --- |
| **I-1** 🔴 | **Ma trận 4×4 vét cạn** (⟲F14: tầng **UNIT**; 4 ô cột `to='submitted'` KHÔNG tới được qua HTTP vì DTO enum 3 giá trị — spec ghi rõ) | **13 ô** ném 409 `ERR-019` | **3 ô** hợp lệ; neo dương `IDEA_TRANSITIONS.length === 3` | ❌ unit |
| **I-2** ⟲F1 | `046` bởi vai `employee` (**không có grant**) | 403 — thông điệp là của `PermissionGuard`; assert đúng hình dạng đó + `status` không đổi. **KHÔNG** assert `ERR-020` ở ca này | Vai `hr` ⇒ 200 | ✅ |
| **I-2b** 🔴 ⟲F1 | `046` bởi user có `approve:feed-idea` **@Department** | **403 `SOCIAL-ERR-020`** (D20) + `status` không đổi | `hr` @Company ⇒ 200 | ✅ |
| **I-3** 🔴 | `rejected` với `note = "   "` | **422 `IDEA_REJECT_NOTE_REQUIRED`** — không rơi xuống 23514 ⇒ 500 | note có chữ ⇒ 200, lưu bản đã trim | ✅ |
| **I-5** | `under_review → accepted` | `status`·`reviewed_by`·`reviewed_at` đều khác NULL sau MỘT câu | — | ✅ |
| **I-6** 🔴 | Đua hai người cùng duyệt | `COUNT(*) audit_logs action='social.idea.review' = 1` **VÀ** outbox NOTI-032 = 1 | Duyệt đơn lẻ ⇒ audit 1 dòng | ✅ |
| **I-7** | `046` trên bài ngoài audience | **404 `ERR-001`** (KHÔNG 403) | Trong audience + `hr` ⇒ 200 | ✅ |
| **I-8** | `045` liệt kê bài ngoài audience | Vắng mặt | Bài trong audience có mặt, `total ≥ 1` | ✅ |
| **I-9** | Cross-tenant `046` | 404 `ERR-001`; hàng tenant B không đổi | — | ✅ |
| **I-10** 🔴 ⟲F3 | `045` bởi nhân viên thường trên sáng kiến đã `rejected` | `reviewNote` **null** (`JSON.stringify` không chứa chuỗi note) | **Neo dương**: tác giả sáng kiến VÀ user có `approve:feed-idea` ĐỀU thấy note | ✅ |
| **I-11** 🔴 ⟲F6 | `046` lên `post_id` của bài `type='share'` | **404 `ERR-001`** (không phải 409) | Bài `idea` ⇒ 200 | ✅ |
| **I-12** ⟲F21 | `submitted→under_review` (note A) rồi `→accepted` (không note) | `review_note` = NULL sau lượt 2 (ghi đè CÓ CHỦ Ý — D21); **neo dương**: `audit_logs` có **2** dòng, dòng 1 còn `from='submitted'` | ✅ |

### 5.3 Vinh danh

| # | DENY | Kỳ vọng | ALLOW | DB? |
| --- | --- | --- | --- | --- |
| **K-0** | `badgeId` của huy hiệu `is_active=false` | **422 `ERR-022`**, `COUNT(*) feed_kudos = 0` | Huy hiệu bật ⇒ 201 | ✅ (**U6**) |
| **K-0b** | `badgeId` của tenant khác | 422 `ERR-022` — cùng chuỗi | — | ✅ |
| **K-1** | Người nhận trùng tác giả | 422 `KUDOS_SELF_RECIPIENT`, `COUNT = 0` | Người khác ⇒ 201 | ✅ |
| **K-2** | 11 người nhận | 422 `KUDOS_RECIPIENT_LIMIT` | 10 ⇒ 201, `COUNT(*) recipients = 10` | ❌ unit + 1 int |
| **K-2b** | `employeeId` không thuộc tenant / đã xoá mềm | 422 `KUDOS_RECIPIENT_INVALID`, `COUNT = 0`. ⚠️ M19b: FK đã chặn cross-tenant ở DB ⇒ ca này đo **chất lượng mã lỗi** | Nhân sự hợp lệ ⇒ 201 | ✅ |
| **K-3** 🔴 | `isOfficial:true` thiếu `manage:feed-kudos` | **403 `KUDOS_OFFICIAL_DENIED`**, `COUNT(*) feed_kudos = 0` | `hr` ⇒ 201, `is_official=true` | ✅ |
| **K-4** 🔴 | Người nhận đã NGHỈ (`status='resigned'`, không xoá mềm) | Không có hàng outbox NOTI-033 cho user đó; **neo dương**: người `active` CÙNG bài CÓ hàng | — | ✅ |
| **K-4b** 🔴 | Người nhận `active` nhưng `users.status='inactive'` | Không nhận NOTI; neo dương như K-4 | — | ✅ |
| **K-4c** | Người nhận không có tài khoản `users` (**U7**) | Không nhận NOTI, không 500; `feed_kudos_recipients` vẫn đủ hàng | — | ✅ |
| **K-5** | `047` trên bài kudos ngoài audience | Vắng mặt | Bài trong audience có mặt `total ≥ 1` | ✅ |
| **K-6** | `048` sau khi tắt 1 huy hiệu | Huy hiệu tắt vắng mặt; neo dương: các huy hiệu còn lại có mặt | — | ✅ (**U6**) |
| **K-7** 🔴 ⟲F19 | `047` không lộ `userId` | Assert THU HẸP: liệt kê tường minh UUID user của fixture và `expect(JSON.stringify(data[*].recipients)).not.toContain(uuid)`; **neo dương** `recipients.length > 0` và có `fullName` | — | ✅ |
| **K-8** 🔴 ⟲F4 | `047` với người nhận đã nghỉ | DTO chở `isFormerEmployee: true` + `fullName`, **không** `userId`; **neo dương**: người `active` cùng bài có `isFormerEmployee: false` | — | ✅ |
| **K-9** ⟲F4 | Đường tự gỡ: xoá mềm bài kudos (`003`) | Bài **và** danh sách người nhận biến khỏi `047`; neo dương: trước khi xoá có mặt | — | ✅ |

### 5.4 NOTI

| # | Ca | Kỳ vọng | DB? |
| --- | --- | --- | --- |
| **N-032** | `046` | 1 hàng `SOCIAL_IDEA_STATUS_CHANGED`, người nhận = tác giả sáng kiến, render ra CHỮ, `target_url` không còn `{post_id}`. **Deny:** người duyệt KHÔNG nhận | ✅ |
| **N-032b** 🔴 | Payload không chở `review_note`, không chở người duyệt | `not.toContain(noteText)` + `payload.actorUserId` undefined + neo dương `payload.status_label` có chữ | ✅ |
| **N-032c** 🔴 | Hai lượt chuyển liên tiếp | **2** hàng `notifications` — lưới DUY NHẤT bắt lỗi khoá dedupe thiếu `:{status}` | ✅ |
| **N-033** | `002/kudos` | Tới đúng tập user map từ `employee_id`, lọc D18. **Deny:** tác giả không nhận | ✅ |
| **N-033b** 🔴 ⟲F9 | Lỗi sau INSERT `feed_kudos` (giả lập ném trong tx) | `COUNT(*) feed_kudos = 0` **VÀ** `COUNT(*) outbox = 0` (cùng rollback — D24) | ✅ |
| **N-dedupe** 🔴 | Phát lại cùng đối tượng | Mỗi mã ⇒ `COUNT(*) notifications = 1` | ✅ |
| **N-boot** | Registrar không dead-letter | 2 mã `registerSource` chạy được lúc boot; `TEMPLATE_KEYS` khớp `variables_schema` | ✅ |

### 5.5 Census · sổ

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| **C-1** 🔴 | Census 2 tầng | `toBe(48)`; `SOCIAL_CONTROLLERS` +2; `ROUTE_TO_KEY` 48; `SERVICE_SITE_TO_KEYS` 48; thông điệp `:245` sửa theo; đẳng thức `tier1IsFloor` giữ nguyên |
| **C-2** | `MIN_COVERED_COUNT` | Xanh với sàn = số spec IN RA (U2) |
| **C-3** ⟲F17 | Route census JSON | Ghim **cả ba**: `routes` · `gated` · `needVerdict` (đọc sau regen, không suy) |
| **C-4** | Identity projection | Xanh sau khi thêm dòng `listIdeasTx` + `listKudosTx` + bump đúng basis (U4) |
| **C-5** 🔴 | **ĐO CỔNG**: bỏ tên controller khỏi `SOCIAL_CONTROLLERS` | **C-1 phải ĐỎ.** XANH = census fail-open |
| **C-6** 🔴 | **Cấu trúc bảng cặp** (D2b + D22) | `keys(PAIRS)` = `keys(DENIED)` = `feedCreatableTypeSchema.options` (so TẬP); mọi cặp non-null có `action`/`resourceType` không rỗng; `SOCIAL_KUDOS_FLAG_PAIRS.isOfficial` = `{manage, feed-kudos}`; **neo dương** 5 khoá / ≥4 cặp non-null |
| **C-7** ⟲F22 | Census mã lỗi SOCIAL | Mỗi hằng MỚI của WO có ≥1 throw-site trong `src/social/**`; neo dương đếm > 0 (bắt lớp lỗi `POLL_CREATE_REQUIRED` ship câm) |

---

## §6. Migration

**KHÔNG CÓ.** Bốn phép đo độc lập (plan-reviewer xác minh lại cả bốn): (1) 4 bảng đã land `0580` +
RLS/FORCE; (2) 4 cặp quyền đã seed `0578:45-53,79-103`; (3) 2 event + 2 template đã seed `0581`
(verify-block `:304-345`); (4) CHECK `audit_logs.object_type` đã có `feed_post` (`0583:9-15`).
⇒ Head giữ **`0586`**. Phát hiện **phải** có migration ⇒ **tín hiệu dừng**.

---

## §7. Audit · NOTI

### 7.1 Audit (D8)

| Route | `object_type` | `object_id` | `action` | `metadata` |
| --- | --- | --- | --- | --- |
| `046` | `feed_post` | `postId` | `social.idea.review` | `{postId, ideaId, from, to}` — 🔴 KHÔNG `review_note` |

`from` lấy từ `getIdeaForReviewTx` (D5), **không** từ `RETURNING`.

### 7.2 NOTI — pin VERBATIM (`0581`)

| Mã | `eventCode` | dedupe | `dedupeKeyOf` | Người nhận | Biến |
| --- | --- | --- | --- | --- | --- |
| 032 | `SOCIAL_IDEA_STATUS_CHANGED` | `DedupeKey` | 🔴 `"{post_id}:{status}"` | tác giả bài — lọc **`activeUserIdsTx`** (2 vế, ⟲F20) | `status_label` · `post_id` |
| 033 | `SOCIAL_KUDOS_RECEIVED` | `DedupeKey` | `"{post_id}"` | recipients map employee→user — lọc **D18** (4 vế) | `actor_name` · `post_id` |

- `PAYLOAD_KEYS` += `status_label`; `TEMPLATE_KEYS` +2 mirror `0581:243-254` (thiếu `post_id` ⇒
  `target_url` giữ `{post_id}` ⇒ `assertInternalTargetUrl` từ chối ⇒ **dead-letter CÂM**).
- 🔴 `PAYLOAD_KEYS_DENIED.SOCIAL_IDEA_STATUS_CHANGED = ["actorUserId","actor_name"]` (D16).
- `recipientUserIds` rỗng ⇒ **KHÔNG enqueue**. Hàng outbox nằm **TRONG** tx (D24).

---

## §8. Thứ tự thi công

> Lane DB đã dựng: `mediaos_be2b2` (chain `0000→0586` áp sạch, 24/09/2026). Chạy trong **MỘT lời gọi**:
>
> ```bash
> export APP_DB_PASSWORD="$(sed -n 's/^APP_DB_PASSWORD=//p' .env)" WORKER_DB_PASSWORD="$(sed -n 's/^WORKER_DB_PASSWORD=//p' .env)" SUPERUSER_DB_PASSWORD="$(sed -n 's/^SUPERUSER_DB_PASSWORD=//p' .env)" LANE_DB=mediaos_be2b2 && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && pnpm --filter @mediaos/api exec vitest run <spec>
> ```
>
> **Đừng pipe `harness/check.sh` qua `tail`.**

**Bước 0 — CHỮ KÝ + ĐO.** ⟲F10: **S6 và S7 phải ký TRƯỚC khi viết code**. Rồi đo **U6** (badge
fixture) · **U7** (employee không có user) · **U8** (vai tuỳ biến), và đọc `coveredCount` baseline.

**Bước 1 — nền (RED trước). ⟲F2 — THỨ TỰ NÀY LÀ BẮT BUỘC** (`social.errors.ts:289` đã
`satisfies Record<SocialCreatablePostType, …>` nên sửa `DENIED` trước `PAIRS` là TS đỏ; ghép kiểu D2a
trước khi mở enum cũng TS đỏ, và C-6 đỏ theo):

1. `social-idea-fsm.ts` + ma trận **I-1** (unit, không phụ thuộc gì).
2. **contracts**: enum 3→5 · khoá `kudos` · 2 vế `superRefine` · nới vế `body` · 2 file DTO mới ·
   export ⇒ `pnpm build && pnpm typecheck`.
3. `SOCIAL_POST_TYPE_PAIRS` +2 · `SOCIAL_KUDOS_FLAG_PAIRS` · ghép kiểu **D2a**.
4. `social.errors.ts` +3 mã +5 hằng +2 dòng `DENIED`.
5. `social-post-type-pairs-structure.spec.ts` (**C-6**) + ĐO CỔNG; `social-error-code-census.spec.ts` (**C-7**).

**Bước 2 — nhánh `002`:**

6. `createIdeaTx` · `createKudosTx` (D11/D12a/D9/D10) + 2 nhánh trong `create()` + NOTI-033 **trong tx**
   (RED: T-1..T-4, K-0..K-3, K-2b, N-033, N-033b).
7. 🔴 Chạy lại **nguyên bộ spec BE-1/1B/2A/2B-1** — `share`/`news`/`poll` không đổi hành vi.

**Bước 3 — sáng kiến:**

8. `assertApproveIdea` (**D20**) + `social-ideas.repository.ts` (D5/D6) + service `045`/`046` +
   controller (RED: I-2, I-2b, I-3, I-5, I-7..I-12).
9. Audit + NOTI-032 trong cùng tx (RED: I-6, N-032, N-032b, N-032c).

**Bước 4 — vinh danh:**

10. `social-kudos.repository.ts` (**D18** verbatim + `activeUserIdsTx`) + service `047`/`048` +
    controller (RED: K-4..K-9).

**Bước 5 — NOTI registrar:**

11. 2 `registerSource` (cả hai `dedupeKeyOf`) + `PAYLOAD_KEYS`/`TEMPLATE_KEYS`/`DENIED`
    (RED: N-dedupe, N-boot).

**Bước 6 — sổ + đóng WO:**

12. 🔴 Census 2 tầng — **NĂM việc** (M20); ĐO CỔNG **C-5**.
13. 🔴 **Bốn sổ đo RIÊNG, cấm cộng tay**: `MIN_COVERED_COUNT` ← số spec IN RA · census 2 tầng ·
    route-census JSON (ghim 3 số) · `identity-projection-verdicts` (2 dòng mới) + bump đúng basis.
14. `package.json:16` +int-spec; `test:cov:social` với `LANE_DB` (≥85%).
15. Đồng bộ tài liệu: API-19 §6.4 · SPEC-16 §13 (sau khi dán grep phủ định) · `harness/backlog.mjs`.
16. `pnpm build && typecheck && lint`; `bash harness/check.sh --all` — không banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».
17. 🔴 **TẤT CẢ spec SOCIAL trong MỘT lượt, cùng lane DB**.
18. 🔴 **FULL gate TRƯỚC khi mở PR** (+ `santa-method` cho `reviewTx` · `userIdsOfEmployeesTx`) → PR
    kèm §2.3 (S6/S7 đã ký; S5 ghi rõ vùng phủ của `ERR-020`).

---

## §9. Rủi ro → cách chặn

| Rủi ro | Chặn |
| --- | --- |
| 🔴 `ERR-020` thành hằng CHẾT (decorator không phát được mã) | M39 + **D20** + **I-2b**; I-2 assert đúng thông điệp guard |
| 🔴 Lưới `done_when` #8 không thoả được ⇒ đỏ vĩnh viễn hoặc thoái lui kiến trúc | M9 + **D2** + **C-6** + S7 |
| 🔴 `RETURNING` không trả giá trị CŨ ⇒ `from` sai/thiếu | **D5** lấy `from` từ `getIdeaForReviewTx` |
| 🔴 409 nuốt mất 404 cho bài không phải `idea` | **D6** + **I-11** |
| 🔴 `reviewTx` thiếu vế cặp vết ⇒ 500 | D5 một câu 4 cột + ĐO CỔNG §13 |
| 🔴 Hai người cùng duyệt ⇒ 2 dòng audit append-only | D5 `WHERE status=<from>` + D8 + **I-6** |
| 🔴 `045` phơi `review_note` cho toàn công ty | **D19** + **I-10** |
| 🔴 `047` phơi tên người đã nghỉ mà không có đường gỡ | **D12b/c** + **K-8** + **K-9** |
| 🔴 Danh tính người duyệt rò qua `notifications.payload` | D16 `PAYLOAD_KEYS_DENIED` + **N-032b** |
| 🔴 Khoá dedupe 032 thiếu `:{status}` ⇒ nuốt lượt thứ hai | D16 + **N-032c** |
| 🔴 Outbox ghi sau commit ⇒ mất sự kiện | **D24** + **N-033b** |
| 🔴 Cặp `manage:feed-kudos` không sổ nào canh | **D22** + C-6 |
| 🔴 Hằng 403 mới ship mà không ca nào chạm (tiền lệ `POLL_CREATE_REQUIRED`) | **D23** + **C-7** |
| 🔴 Census XANH mà không đo route nào | M20 năm việc + **C-5** |
| 🔴 File service trong thư mục con ⇒ census mù | D15 + M22 |
| `ERR-022`/K1/K2 ép ở Zod ⇒ 400 vô danh | D9/D11 + assert theo MÃ |
| `status` `feed_ideas` không DEFAULT ⇒ `23502` | D3 ghi tường minh + T-1 ALLOW |
| Sửa `role_permissions` của vai canonical làm bẩn lane | **D23** + **T-3b** |
| Ca K-0/K-6 dựa vào badge fixture chưa đo | **U6** ở Bước 0 |
| `MIN_COVERED_COUNT` cộng tay 676+4 | U2 |
| `social-posts.service.ts` vượt 800 | D3 (653 + ~12) |
| Cross-tenant recipient | Đã có FK `0580:439` (M19b) — **không** đi tìm lỗ không có |

---

## §10. Nợ chuyển tiếp

- **BE-2C**: `feedUserRoomName` + join/leave động · sửa API-19 §7. Bài `idea`/`kudos`
  `audience='group'` sẽ fan-out qua room nhóm.
- **BE-3**: `049`/`050`/`051` catalog huy hiệu · `052`/`053` thống kê · route khôi phục + recycle-bin ·
  throttle `035`.
- **FE-2**: (a) DTO thẻ bài **không** chở chi tiết idea/kudos (U5) ⇒ FE gọi `045`/`047` riêng;
  (b) màn xét duyệt chỉ dựng nút cho 3 cạnh có thật; (c) OFFSET envelope; (d) hiển thị
  `isFormerEmployee`.
- **QA-1 S16**: ma trận per-pair 4 route mới · ca `isOfficial` · ca người đã nghỉ (K-8/K-9) · ca
  `reviewNote` masking (I-10).
- **Nhánh CHẾT `SOCIAL-ERR-008`** (BE-1): WO này chạm `superRefine` nhưng **không** gộp việc dọn.
- **Vùng KHÔNG phủ của `ERR-020`**: ca «không có grant» vẫn trả 403 chung của `PermissionGuard`.
  Muốn mã phủ cả hai phải đổi `PermissionGuard` (toàn hệ) — WO riêng.

---

## §11. Tự kiểm `done_when`

| # | `done_when` (backlog) | Đóng ở | Đo bằng |
| --- | --- | --- | --- |
| 1 | FSM 3 cạnh + ma trận 16 ô + neo dương | **D4** | **I-1** (ghi rõ 4 ô unit-only) |
| 2 | `reviewTx` một câu + `approve:feed-idea` + audit + NOTI-032 | **D5·D20·D8·D16** | **I-2b**·**I-5**·**N-032** |
| 3 | Audit/outbox chỉ khi RETURNING ≠ rỗng; đua ⇒ audit = 1 | **D8·D24** | **I-6**·**N-033b** |
| 4 | Vị từ người còn hoạt động VERBATIM | **D18** (+`activeUserIdsTx` cho 032) | **K-4**·**K-4b**·**K-4c** |
| 5 | S1 — `047`/`048` thuộc WO này | §3.2 · B6.15 | diff `harness/backlog.mjs` |
| 6 | S3 — K1+K2 + 2 dòng SPEC-16 §13 | **D9** | **K-1**·**K-2** + grep phủ định ở §13 |
| 7 | `ERR-022` ở service; `isOfficial` ⇒ 403 + `COUNT=0` | **D11·D10·D22** | **K-0**·**K-0b**·**K-3** |
| 8 | NOTI VERBATIM + `dedupeKeyOf` + `status_label` enum đóng | **D16·D17** | **N-032c**·**N-dedupe**·**N-boot** |
| 9 | Điểm mù census cặp-theo-type ⇒ assert CẤU TRÚC + neo dương | **D2** (thay lưới — **S7**) | **C-6** + ĐO CỔNG |
| 10 | 4 sổ đo RIÊNG + identity-projection | §3.2 · B6.13 | **C-1..C-4** |
| 11 | Coverage ≥85%; DTO `.pick()+.strict()` | §3.3 · B6.14 | `test:cov:social` (M21) |

**Điều `done_when` KHÔNG nói mà plan vẫn phải đóng:** `ERR-020` không phát được từ decorator (D20) ·
`045` phơi `review_note` (D19) · `047` phơi người đã nghỉ + đường tự gỡ (D12) · `RETURNING` không trả
giá trị cũ (D5) · bài `share` nuốt 404 (D6) · outbox phải trong tx (D24) · ca DENY cặp `create` không
dựng được bằng vai canonical (D23) · `body` bắt buộc cho `idea` (T-4) · `review_note` bị ghi đè (D21).

---

## §12. Cổng · lệnh · sổ

### 12.1 Bốn sổ

| Sổ | File · dòng | HIỆN TẠI | Đích |
| --- | --- | --- | --- |
| (1) Ratchet test-HTTP | `route-http-coverage.e2e-spec.ts:363` | **676** | số spec IN RA (dự kiến 680) |
| (2) Census 2 tầng | `social-two-layer-guard-census.unit-spec.ts:34,51,123,245,246` | 8 · 44 · 44 · «39» · `toBe(44)` | 10 · 48 · 48 · «48» · `toBe(48)` |
| (3) Route census JSON | `docs/_review/…:7,9,13` | `676` · `637` · `39` | ghim **3 số** sau regen |
| (4) Điểm chiếu danh tính | `identity-projection-verdicts.ts` (11 dòng SOCIAL) + `BASIS_CEILINGS` | `scoped-predicate 24` · `second-assert 11` · … | +`listIdeasTx` +`listKudosTx`, bump đúng basis (U4) |

### 12.2 Cổng khác

`social-access.service.ts` 90/90/85 · `src/social/**` ≥85% · `@Param` không pipe `toBe(1)` ĐẲNG THỨC ·
body không validate `toBe(0)` · `MAX_UNCOVERED_TOTAL = 0` · file > 800 dòng **không cổng nào ép**.

### 12.3 `paths` của WO — ĐỦ (kiểm lại ở lượt 2)

Phủ `apps/api/src/social/**` · `apps/api/src/notifications/**` · `apps/api/test/**` ·
`packages/contracts/**` · `apps/api/package.json` · `docs/_review/**` · `docs/API Design/**` ·
`docs/SPEC/**` · `docs/plans/**` · `harness/backlog.mjs`.
**Không cần** `apps/api/migrations/**` (§6) · `apps/app/**` (U1) · `apps/api/vitest.config.ts` (U9).
Buộc phải chạm một trong ba ⇒ **DỪNG**: scope đã đổi.

### 12.4 Lệnh đóng WO

```bash
export APP_DB_PASSWORD="$(sed -n 's/^APP_DB_PASSWORD=//p' .env)" WORKER_DB_PASSWORD="$(sed -n 's/^WORKER_DB_PASSWORD=//p' .env)" SUPERUSER_DB_PASSWORD="$(sed -n 's/^SUPERUSER_DB_PASSWORD=//p' .env)" LANE_DB=mediaos_be2b2 && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && pnpm --filter @mediaos/api exec vitest run src/social test/integration/social-*.int-spec.ts test/foundation/social-*.unit-spec.ts
bash harness/check.sh --all
```

---

## §13. Sổ vết THI CÔNG — *(điền 24/09/2026)*

| # | Điểm | Quyết định thi công | Vì sao (đo được) |
| --- | --- | --- | --- |
| **T1** 🔴 | **D20 SAI — `assertApproveIdea` KHÔNG BAO GIỜ chạy tới** | Bỏ hàm đó. `SOCIAL-ERR-020` phát từ **`SocialPair.denyMessage`** của `ideaReview`, đọc trong chính `resolveActor`. Thêm field `denyMessage?: string` (additive; 47/48 route giữ nguyên chuỗi `AUTH-ERR-*`) | Plan M39 đo `permission.guard.ts:140` nhưng **bỏ sót `social-access.service.ts:101-115`**: `resolveActor` tự resolve cặp của route rồi ném `AUTH-ERR-FORBIDDEN` (không grant) / `AUTH-ERR-SCOPE-DENIED` (`companyFloor` mà scope hẹp) — CẢ HAI nhánh, trước khi service chạy. Ca `I-2b` bắt được: nhận `AUTH-ERR-…` thay vì `SOCIAL-ERR-020`. Tầng-2 mà D20 đòi **vốn đã tồn tại**, nó chỉ nói sai "tiếng" |
| **T2** 🔴 | **Tiền đề §0.2 SAI — `POLL_CREATE_REQUIRED` KHÔNG ship câm** | Giữ census C-7 nhưng đổi lý do; sửa docblock đã cũ ở `social.errors.ts` | `social-be2b1-polls-isolation.int-spec.ts` ca **N1** đã dựng đúng ca đó bằng vai tuỳ biến `NO_POLL_PAIRS`, có neo dương + đếm bài mồ côi trên DB. Docblock cũ viết «không vai CHUẨN nào chạm được» và bị đọc thành «không ca nào chạm» |
| **T3** | **C-7 có HAI tầng bằng chứng**, không một | Tầng A (tham chiếu HẰNG) cho 10 hằng của WO + `POLL_CREATE_REQUIRED`; tầng B (còn ném không) cho TOÀN bảng | Đo: int-spec BE-1/1B/2A assert bằng **chuỗi mã** (`toContain("SOCIAL-ERR-004")`). Nhận chuỗi mã làm bằng chứng thì 8 hằng "mượn" được ca của hằng anh em cùng số (`001` có 3 hằng; `010`/`007`/`008` mỗi cái 2). Nâng tầng A ra toàn module = sửa cách assert ở 13 int-spec ⇒ **nợ**, ghi §10 |
| **T4** | **`AUDIENCE_GROUP_NOT_AVAILABLE` là hằng CHẾT** | Đưa vào `NEVER_THROWN` của C-7 kèm lý do; **KHÔNG dọn** (plan §10 đã ghi nợ nhánh chết `SOCIAL-ERR-008`) | Tầng B của C-7 phát hiện: BE-2A đã MỞ `audience='group'` nên nhánh "chưa khả dụng" bị gỡ khỏi `src/social` mà hằng còn lại. Census giữ nó HIỆN HÌNH thay vì để nó ngủ trong bảng |
| **T5** | **Trần `reviewNote` = `FEED_NOTE_MAX` (1000)**, không phải 2000 như plan D7 | Dùng hằng SOCIAL có sẵn | `social-api.ts:48` đã khai `FEED_NOTE_MAX = 1000` kèm chú thích «định nghĩa ở đây để 1 chỗ giữ mọi trần SOCIAL». `review_note` là `text` ở DB (không trần), nên 2000 của plan là con số không có nguồn — thêm nó là dựng trần thứ hai |
| **T6** | **`047` lọc tháng bằng MỘT trường `YYYY-MM`**, không phải cặp `month`+`year` | `kudosMonthSchema` regex; biên tính theo **múi giờ CÔNG TY** trong chính câu SQL | Cặp rời sinh 4 tổ hợp mà 3 phải tự đặt luật chéo ⇒ rơi vào `superRefine` ⇒ FE gửi thiếu nửa nhận 400 vô danh. Biên theo UTC thì ở VN (+07) một lời vinh danh đăng 03:00 ngày 1 rơi vào **tháng trước** — sai hiển nhiên, không lỗi nào báo. `resolveCompanyTz` KHÔNG dùng được (nó tự mở `withTenant` ⇒ lồng = treo im lặng), nên đọc tz bằng scalar subquery trong cùng câu; hai biên là hằng ⇒ index `idx_feed_kudos_company_created` vẫn dùng được |
| **T7** | **Ca `R14` của BE-1 là cổng ĐÃ CŨ** — đã viết lại, không nới cho qua | Đổi từ «3 loại chưa mở ⇒ 400» sang «payload SAI HÌNH DẠNG cho loại có khoá riêng ⇒ 400, không 500, không để lại hàng», 4 hình dạng sai | Ba loại nay mở hết. Và ca đó **đã đo sai lời khai của nó cả một WO**: sau BE-2B-1, `poll` đi qua nhánh "thiếu khoá `poll`" chứ không còn nhánh "enum từ chối" |
| **T8** | `users.status` hợp lệ = `{active, invited, suspended, locked}` — **KHÔNG có `inactive`** | Ca `K-4b` dùng `suspended` | Đo `users_status_chk` trên lane. `inactive` là giá trị của `employee_profiles.status` (tập KHÁC). Gõ nhầm ⇒ fixture chết `23514` trong `beforeAll` ⇒ **cả 29 ca SKIP**, trông y hệt "spec chưa chạy" |
| **T9** | `seedUser` KHÔNG đặt `full_name` | Fixture `UPDATE users SET full_name` tường minh | Không có nó, `reviewer.fullName` của `045` là `null` ⇒ ca "vẫn nói được AI đã duyệt" **xanh-RỖNG**: DTO trả `null` vì THIẾU DỮ LIỆU, không vì masking đúng |
| **T10** | Ca `K-9` không được assert `not.toContain(<employeeId>)` | Đo theo `kudosId` + một `message` duy nhất của chính bài đó | Cùng một người được vinh danh ở NHIỀU bài (K-4/K-8 vẫn còn) ⇒ assert theo `employeeId` là **đỏ oan**. Đã vấp đúng một lần |
| **T11** | `dedupe_key` lưu ở DB mang **tiền tố mã sự kiện** | Assert `SOCIAL_IDEA_STATUS_CHANGED:{post_id}:{status}` | `notification-dedupe.service.ts`: `computeKey = ${eventCode}:${dedupeKey}`. Assert dạng producer trả sẽ đỏ; assert lỏng hơn sẽ không bắt được khi ai đó đổi `computeKey` |
| **T12** | `social-posts.service.ts` = **724/800 dòng** (plan dự kiến ~665) | Giữ nguyên, ghi NỢ | +71 dòng thay vì +12: `enqueueKudosReceivedNoti` + 2 nhánh + docblock. Còn 76 dòng đệm; BE-2C/BE-3 **phải tách trước khi thêm**. Không tách ở WO này vì `resolveActorName` sống trong chính file đó ⇒ tách ra sẽ tạo import vòng |
| **T13** | Lệnh chạy "tất cả spec SOCIAL" phải dùng **filter chuỗi con**, không glob | `vitest run src/social test/integration/social test/foundation/social` | Glob `test/integration/social-*.int-spec.ts` nở ở **thư mục gốc repo**, không phải `apps/api` ⇒ không khớp gì, vitest lặng lẽ chỉ chạy `src/social`: **18 file / 213 test** trông như XANH trong khi 644 test thật chưa chạy. Đúng lớp "xanh không đủ bằng chứng" |
| **T14** | Nhánh **vượt biên OFFSET** của 3 câu danh sách có ca riêng | `page=999` ⇒ `data` rỗng mà `total > 0` | `count(*) over ()` chỉ tồn tại KHI CÓ HÀNG ⇒ trang rỗng phải hỏi tổng bằng câu thứ hai. Thiếu nhánh đó thì `total = 0` cho một tập KHÔNG rỗng ⇒ FE không phân biệt «trang cuối» với «không có gì» và mất nút lùi. Coverage chỉ ra đúng ba khối này chưa phủ |

### Phải ghi vào đây trước khi mở PR

1. ✅ **Vùng phủ thật của `SOCIAL-ERR-020`** (T1): mã ra ở CẢ HAI nhánh mà service tới được — «không có grant» (khi guard cho qua) và «có grant, scope hẹp hơn Company» — vì nó phát từ `resolveActor`. **Vùng KHÔNG phủ:** nhánh bị `PermissionGuard` chặn ở tầng-1 vẫn trả `Permission denied: <reason>` (ca `I-2` assert đúng điều đang xảy ra, không assert điều mong muốn). Phủ nốt đòi đổi `PermissionGuard` toàn hệ = WO riêng.
2. ✅ **Grep phủ định cho S3** — chạy 24/09/2026, dán NGUYÊN VĂN:

```text
$ grep -rniE "tự vinh danh|self.?recipient|tối đa 10 người|recipient.?limit|10 người được vinh danh" docs/ --include=*.md
docs/plans/S16-SOCIAL-BE-2B-2.md:153   (chính plan này)
docs/plans/S16-SOCIAL-BE-2B-2.md:204   (chính plan này)
docs/plans/S16-SOCIAL-BE-2B-2.md:283   (chính plan này)
docs/plans/S16-SOCIAL-BE-2B-2.md:284   (chính plan này)
=> 4 dòng, TẤT CẢ thuộc plan của chính WO này. SPEC-16 và DB-17: 0 dòng.
```

   ⇒ Điều kiện của S3 thoả. Đã thêm **SPEC-16 §13.4b** (3 gạch đầu dòng: K1 · K2 · người đã nghỉ).
3. ✅ **Đường tự gỡ của D12** đã đo bằng ca `K-9` (xoá mềm bài ⇒ bài + danh sách người nhận biến khỏi `047`; assert theo `kudosId`, xem T10).

### Phép ĐO CỔNG (tháo lưới, xác minh ca tương ứng ĐỎ, khôi phục)

| Tháo gì | Test kỳ vọng ĐỎ | Thông điệp thực tế |
| --- | --- | --- |
| Xoá khoá `kudos` khỏi `SOCIAL_POST_TYPE_DENIED` | **C-6** (và TS) | ✅ **ĐÃ CHẠY 24/09.** TS: `TS1360` (không thoả `Record<…>`) + `TS7053` ở `social-access.service.ts:165`. C-6 đỏ **3 assert**: «expected 4 to be 5» · «expected [idea,news,poll,share] to deeply equal [idea,kudos,news,…]» · «kudos mã lỗi rỗng». Đã khôi phục, và siết assert đầu dùng `denied ?? null` (khoá VẮNG trả `undefined` nên `.not.toBeNull()` trần cho nó đi qua — đúng kết quả, sai lý do) |
| Bỏ `assertApproveIdea` | **I-2b** | ✅ **ĐÃ CHẠY 24/09 (ngoài ý muốn)** — lượt chạy ĐẦU của `I-2b` chính là phép đo này: nhận `{"success":false,"message":"AUTH-ERR-…"}` thay vì `SOCIAL-ERR-020` ⇒ chứng minh hàm đó **không bao giờ tới được**. Lưới THẬT nay là `denyMessage`; tháo nó ⇒ `I-2b` nhận `AUTH-ERR-SCOPE-DENIED` |
| Bỏ `getIdeaForReviewTx` (0 hàng ⇒ 409) | **I-11** | ⏳ chưa tháo lại. `I-11` assert CẢ HAI chiều (`toContain(POST_NOT_FOUND)` **và** `not.toContain(IDEA_TRANSITION)`) nên nó phân biệt được 404 thật với 409-nuốt-404 |
| Bỏ `reviewedAt` khỏi `reviewTx` | **I-5** (23514) | ⏳ chưa tháo lại. `I-5` assert `reviewed_by` **và** `reviewed_at` đều khác NULL |
| Bỏ `WHERE status=<from>` | **I-6** (audit 2 dòng) | ⏳ chưa tháo lại. `I-6` đếm `audit_logs = 1` **và** outbox `= 1` sau `Promise.allSettled` |
| Bỏ vế `status='active'` của D18 | **K-4** | ⏳ chưa tháo lại. `K-4` có neo dương (người `active` CÙNG bài PHẢI nhận) nên không xanh-rỗng được |
| Bỏ mask `reviewNote` của D19 | **I-10** | ⏳ chưa tháo lại. `I-10` có neo dương ở CẢ HAI người được phép thấy |
| Bỏ `:{status}` khỏi khoá dedupe 032 | **N-032c** | ⏳ chưa tháo lại. `N-032c` assert `notis.length === 2` **và** so TẬP hai `dedupe_key` |
| Bỏ tên controller khỏi `SOCIAL_CONTROLLERS` | **C-1** (XANH = fail-open) | ⏳ chưa tháo lại |

> ⚠️ Bảy dòng ⏳ là **nợ của lượt FULL gate**, KHÔNG phải đã đo. Mỗi dòng ghi rõ vì sao ca tương ứng không xanh-rỗng được, nhưng "không xanh-rỗng" ≠ "đã chứng minh ĐỎ khi tháo" — đúng cái bẫy `gate-measurement-row-can-be-unsatisfiable` cảnh báo: cột kết quả trống đọc y hệt cột đã chạy.

### Kết quả U2 · U4 · U6 · U7 · U8

| # | Câu hỏi | Kết quả đo | Hệ quả |
| --- | --- | --- | --- |
| **U2** | `coveredCount` thật | baseline **676/676**; sau WO **680/680**, CHƯA phủ **0** (dòng console nguyên văn của chính spec) | `MIN_COVERED_COUNT` 676 → **680** |
| **U4** | Điểm chiếu + basis | census IN RA đúng hai khoá: `social-ideas.repository.ts#listIdeasTx:users.fullName` · `social-kudos.repository.ts#recipientsOfTx:users.fullName` | `scoped-predicate` 24→**25** (`listIdeasTx` — `visiblePostCondition` trong chính câu) · `second-assert` 11→**12** (`recipientsOfTx` — `kudosId` đến từ câu đã lọc, cùng tx) |
| **U6** | Badge trong tenant fixture | **0**. `MasterDataSeedBootstrapService.onApplicationBootstrap` `return` ngay khi `NODE_ENV=test`; `0582` CROSS JOIN chạy lúc lane có 0 công ty; `seed.ts:491` chỉ DELETE | Spec **tự INSERT** badge. Có ca `U6` ghim chính phép đo này (seeder chạy trong test ⇒ đỏ) |
| **U7** | Employee không có `users`? | **ĐƯỢC** — `employees.ts:44` `userId` nullable (mig `0442`) | `K-4c` dựng được; `recipientsOfTx` phải LEFT JOIN `users` |
| **U8** | Vai tuỳ biến trong int-spec | **ĐƯỢC, và đã là khuôn sẵn** — `makeUser(label, hash, pairs)` tạo role `p-<label>-<uuid>` riêng, cấp ĐÚNG `pairs`; role có `company_id` ⇒ `cleanupTenants` dọn | `T-1`/`T-2`/`T-3` dựng được; vai canonical KHÔNG bị chạm (ca `T-3b`) |

---

## §14. Sổ vết FULL GATE — *(để trống; chạy TRƯỚC khi mở PR)*

`security-reviewer` · `database-reviewer` · `silent-failure-hunter` ĐỘC LẬP trên diff
`f407c1d1..<HEAD>` (+ `santa-method` cho `reviewTx` · `userIdsOfEmployeesTx`).

> **Nhắc:** reviewer có thể **hội tụ vào cùng một lỗi thật** (BE-1B: ba reviewer độc lập cùng bắt đúng
> một lỗi) **và** có thể **cùng kết luận sai** (`database-reviewer` từng khẳng định «không có deadlock»
> ở đúng chỗ có deadlock). Kiểm chứng lại mọi finding nặng.

### 14.1 Điểm HỘI TỤ — *(để trống)*

### 14.2 Đã vá trong lượt gate

| Nguồn | Sev | Vá |
| --- | --- | --- |

### 14.3 Chữ ký owner

| # | Việc | Trạng thái |
| --- | --- | --- |
| S1 | `047`/`048` thuộc WO này | ✅ 23/09/2026 |
| S3 | K1/K2 + SPEC-16 §13 | ✅ 23/09/2026 (kèm grep phủ định) |
| S5 | `ERR-020`: decorator + service resolve (D20) | ✅ 24/09/2026 |
| S6 | D12 — vinh danh người đã nghỉ (phương án A) | ✅ 24/09/2026 |
| S7 | D2/C-6 thay lưới `done_when` #8 | ✅ 24/09/2026 |

### 14.4 Ghi nhận — không phải finding — *(để trống)*

---

## §15. Lượt plan-review (23-24/09/2026)

**Lượt 1 — `plan-reviewer`: BLOCK** (4 CRITICAL + 6 HIGH + 13 nhẹ). Đã vá **toàn bộ F1..F27**; mỗi
chỗ vá mang dấu **⟲F\<n\>**.

| F | Sev | Nội dung | Vá ở |
| --- | --- | --- | --- |
| F1 | CRITICAL | `ERR-020` không phát được từ decorator (tự kiểm: `permission.guard.ts:140` + decorator không nhận message) | M39 · **D20** · I-2/I-2b · S5 |
| F2 | CRITICAL | Thứ tự §8 làm TS đỏ ngay bước 2 (`social.errors.ts:289` đã ghép kiểu) | §8 Bước 1 xếp lại |
| F3 | CRITICAL | `045` là bề mặt đọc rộng nhất của `review_note`/`reviewed_by` | **D19** · I-10 · U4 |
| F4 | CRITICAL | `047` chiếu tên người đã nghỉ, plan không có vế ĐỌC | **D12b/c** · K-8 · K-9 |
| F5 | HIGH | `UPDATE … RETURNING` trả hàng MỚI ⇒ không lấy được `from` | **D5** |
| F6 | HIGH | 0 hàng ⇒ 409 nuốt ca 404 (bài `share`) | **D6** · I-11 |
| F7 | HIGH | T-1..T-3 không dựng được bằng vai canonical | **D23** · U8 · T-3b |
| F8 | HIGH | K-0/K-6 dựa vào badge fixture chưa đo | **U6** |
| F9 | HIGH | «NOTI sau commit» mâu thuẫn outbox-trong-tx (tự kiểm M40) | **D24** · N-033b |
| F10 | HIGH | Lý lẽ S6 sai + ký sau khi xây | S6 viết lại · §8 Bước 0 |
| F11 | MED | M4 đếm 5, thật là **8** hằng | M4 |
| F12 | MED | `manage:feed-kudos` của `isOfficial` không sổ nào canh | **D22** · C-6 |
| F13 | MED | Lưới `done_when` #8 là **đỏ vĩnh viễn**, không phải «xanh rỗng» | M9 · D2 · S7 |
| F14 | MED | I-1 16 ô là tầng UNIT; DTO enum 3 giá trị | I-1 · §3.2 |
| F15/F16 | MED | `paths` thiếu `apps/app`/`vitest.config`? | U1 · U9 · §12.3 (đo: **không cần**) |
| F17 | MED | C-3 chỉ ghim 1 trong 3 số | M24 · C-3 |
| F18 | MED | T-4 assert hai vế | T-4 (chốt 400) |
| F19 | MED | K-7 assert quá rộng ⇒ đỏ oan | K-7 |
| F20 | MED | D18 sai kiểu cho NOTI-032 (author là `user_id`) | **D16** · `activeUserIdsTx` |
| F21 | MED | `review_note` bị xoá ở lượt chuyển thứ hai | **D21** · I-12 |
| F22 | MED | Không có census mã lỗi SOCIAL ⇒ mã ship câm | **C-7** · §3.1 |
| F23 | MED | K-4c chưa đo dựng được không | **U7** |
| F24-F27 | LOW | Thông điệp census «39» · số dòng M20 · trích thiếu vế CHECK M15 · I-4 là ĐO CỔNG | M20 · M15 · §13 |

**Reviewer xác nhận ĐÚNG (giữ nguyên):** M9/D2/C-6 (đếm literal = 0 ở CẢ HAI file) · hợp đồng dedupe
(`notification-dedupe.service.ts:37,78,111`) · §6 không migration (4/4 phép đo) · D4 khớp SPEC-16
§13.3 · D15/M22 census phẳng · không scope creep.

**Ô §1 reviewer CHƯA kiểm** (đừng đọc «không báo lỗi» thành «đã kiểm»): M2 (một phần) · M3 · M6 ·
M11 · M13 · M14 · M17 · M19 · M21 · M24 · M25 · M26 · M29 · M30 · M32 · M33 · M35 · M36 · M38.

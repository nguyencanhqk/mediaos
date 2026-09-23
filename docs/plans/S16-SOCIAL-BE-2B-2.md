> # NHAP - CHUA DUYET
>
> File nay la PHAN CON LAI cua plan S16-SOCIAL-BE-2B truoc khi owner chot TACH DOI (23/09/2026).
> Phan BINH CHON da chuyen sang S16-SOCIAL-BE-2B-1.md (da va 20 finding cua plan-reviewer).
> Giu file nay de KHONG MAT bang do M1..M54. TRUOC KHI MO WO BE-2B-2 phai:
> (1) cat bo phan poll; (2) do lai moi so dong (BE-2B-1 se lam troi); (3) bo sung D18 (vi tu nguoi
> con hoat dong, viet VERBATIM) va C-6 (assert cau truc SOCIAL_POST_TYPE_PAIRS); (4) sua 2 o SAI da
> biet: M24 la 10 int-spec khong phai 11, M54 trich sai cho - nguon dung la
> packages/contracts/src/social-api.ts:309-310; (5) chay lai plan-reviewer.
> Owner DA KY: 047/048 thuoc WO nay (khong phai BE-3); ep CA K1 lan K2 + bo sung SPEC-16 par.13.
>
# Plan S16-SOCIAL-BE-2B — BÌNH CHỌN · SÁNG KIẾN · VINH DANH (`SOCIAL-API-040..048` + 3 nhánh `type` của `002`)

> 🔴 **Crown.** Ba thứ crown chồng lên nhau trong một WO: (1) **đường UPDATE ĐẦU TIÊN vào `feed_polls`**
> — schema ghi thẳng «service PHẢI chặn UPDATE» (`db/schema/social.ts:596-600`) và tới hôm nay chưa
> call-site nào chứng minh được điều đó; (2) **bộ đếm `feed_poll_options.vote_count`** có `CHECK >= 0`
> nhưng KHÔNG nằm trong 5 cột của SPEC-16 §13.6 ⇒ không sổ đối soát nào nhìn nó; (3) **poll ẩn danh** —
> `feed_poll_votes.user_id` LUÔN được lưu, và DTO là thứ duy nhất ngăn nó đi ra.
>
> **Nguồn sự thật:** SPEC-16 §12 · §13.3 · §13.4 · §13.6 · §15 · §17.1 · §18 ·
> SOC-DEC-009 (`:575`) · API-19 §5.1 dòng 108-122 · §5.1b · §5.1d ·
> §6.3 · §6.6 · DB-17 §7.3-§7.9 · [DB-2](S16-SOCIAL-DB-2.md) §10 ·
> [BE-2A](S16-SOCIAL-BE-2A.md) §10/§13/§14.
>
> **Khuôn:** `payroll/payroll-fsm.ts` (FSM thuần TS, bảng cạnh literal) · `social-reports.repository.ts#resolveReport`
> (UPDATE cặp vết MỘT câu + `WHERE`-điều-kiện + `RETURNING`) · `scheduler/job-handler.ts` (`@SystemJobHandler`) ·
> `social-group-access.service.ts#lockGroupRowTx` (neo chống đua) · `social-news-noti-cap.spec.ts` (unit + `fakeTx()`).
>
> **Lịch sử:** tách 22/09/2026 từ WO `S16-SOCIAL-BE-2` (owner chốt tách 3: BE-2A nhóm · **BE-2B poll/ý-tưởng/kudos** ·
> BE-2C realtime). Nối tiếp BE-2A (PR #533, merge `5f8434c0`), **KHÔNG song song** — cùng chạm
> `social-posts.service.ts#create` · `social-route-pairs.const.ts` · `social.errors.ts` · `social.module.ts`.

---

## §0. Phạm vi & nợ

### 0.1 Route trong phạm vi — **9 route**

`040` `GET /social/polls` · `041` `PUT /social/posts/{post_id}/poll/vote` · `042` `DELETE …/poll/vote` ·
`043` `GET …/poll/results` · `044` `POST …/poll/close` · `045` `GET /social/ideas` ·
`046` `PATCH …/idea/review` · `047` `GET /social/kudos` · `048` `GET /social/kudos-badges`
**+ 3 nhánh `type` của `002`** (`poll` · `idea` · `kudos`, hôm nay bị Zod từ chối 400 — M31)
**+ 1 system-job** đóng poll theo hạn (KHÔNG phải route HTTP — API-19 §5.1d).

**KHÔNG thuộc WO này:** `049`/`050`/`051` CRUD catalog huy hiệu → BE-3 (**cần chữ ký — S1**) ·
`052`/`053` thống kê → BE-3 · room WS `feedgroup` → BE-2C · route khôi phục bài đã xoá → BE-3.

### 0.2 Nợ mang sang — trạng thái

| Nợ | Nội dung | Xử lý ở WO này |
| --- | --- | --- |
| **(b) DB-2** 🔴 | `multiple_choice` / `is_anonymous` BẤT BIẾN sau khi tạo poll — «service PHẢI chặn UPDATE» | **Đóng ở đây.** Ba vế bắt buộc: `closeTx` UPDATE tường minh ĐÚNG 2 cột · structure-spec chống-drift · ca RED. §2 D2, §5 P-b |
| **(e) DB-2** 🔴 | `option_id` phải thuộc đúng `poll_id` — hai FK RỜI, không nối | **Đóng ở đây.** Kiểm CÙNG TX trước mỗi INSERT phiếu. §2 D4, §5 P-e (M13) |
| **(c) DB-2** | NOTI-034 `dedupe_strategy='None'` | Không chạm (thuộc BE-2A, đã chấp nhận) |
| **(d) DB-2** | `childTables` của `deleteWithFkRetry` | **ĐÃ ĐO — không vá** ở BE-2A (M25/M26 của plan đó). Không mở lại |
| **(f) DB-2** | DTO `.pick()+.strict()`, cấm `.extend()` core schema | **Luật của WO** — §3.3 (M33) |
| BE-2A §10 | `feed_poll_options.vote_count` ngoài 5 cột §13.6 nhưng vẫn là bộ đếm thật | **Cần chữ ký — S2.** §2.3 |
| BE-2A §14.3 S3 | `035` bị từ chối rồi xin lại vô hạn (không throttle) | **KHÔNG thuộc WO này** — giao BE-3. Ghi lại để không trôi |
| BE-2A §13 T1 | Avatar nhóm write-only (chưa có resolver `(SOCIAL, feed_group)`) | Không chạm |
| BE-1B (g)1-5,7,8 | Hiệu năng/độ chính xác route BE-1B | Không chạm |

---

## §1. Bảng ĐO TRƯỚC — câu hỏi → lệnh → kết quả THỰC TẾ → hệ quả

> Mỗi dòng là một phép đo ĐÃ CHẠY trên `feat/s16-social-be-2b` (23/09/2026). Con số nào không đo được
> thì ghi thẳng **CHƯA ĐO** — bài học §13/§14 của BE-2A: một câu khẳng định sai trong bảng đo đắt hơn
> một ô trống (câu "T2" của BE-2A sai hoàn toàn và suýt lấy được chữ ký owner).

### 1.a Nền — migration · route · mã lỗi

| # | Câu hỏi | Lệnh đo | Kết quả THỰC TẾ | Hệ quả cho plan |
| --- | --- | --- | --- | --- |
| **M1** | Head migration? | `ls apps/api/migrations/058*.sql` | `0580`·`0581`·`0582`·`0583` (DB-2) · `0584`·`0585` (BE-1B). **Head = `0585`** (idx 252) | Số kế tiếp nếu cần = `0586`. **§6: WO này KHÔNG có migration** |
| **M2** | Route đã build? | `social-two-layer-guard-census.unit-spec.ts:48,233` | `001..039` (19 A + 10 B + 10 NHÓM), `toBe(39)` | BE-2B thêm 9 ⇒ **48** |
| **M3** | `SOCIAL_ROUTE_PAIRS` hình dạng? | `social-route-pairs.const.ts:90-95,103-207` | 39 khoá; `pair(action, resourceType, tier1IsFloor=false, companyFloor=true)`; khoá cuối `groupMemberRemove:206` | Thêm 9 khoá theo khối additive, **không rewrite** |
| **M4** 🔴 | `SOCIAL-ERR-016..020,022` đã khai trong code chưa? | đọc HẾT `social.errors.ts` | **CHƯA** — file khai `001..015` + `021` + **3 hằng KHÔNG SỐ** (`REPORT_DUPLICATE_OPEN:110` · `GROUP_NAME_TAKEN:164` · `GROUP_MEMBER_NOT_FOUND:175`). Header `:20-21` ghi «`012..020`,`022` thuộc S16-SOCIAL-BE-2» | **WO này KHÔNG phải bịa mã mới cho nhánh chính** — `016·017·018·019·020·022` là của chính nó, SPEC-16 §12 (`:326-332`) đã định nghĩa đủ 6. Câu «catalog đã cạn» của BE-2A nói về việc **không còn số TRỐNG**, không phải «không còn số cho WO này» |
| **M5** | Nghĩa 6 mã đó theo SPEC? | `SPEC-16:326-332` | `016` 409 poll `closed`/quá hạn · `017` 409 phiếu đôi poll một-lựa-chọn · `018` 422 ngoài 2–10 lựa chọn · `019` 409 chuyển trạng thái sáng kiến sai · `020` 403 thiếu `approve:feed-idea` · `022` 422 huy hiệu không có/đã tắt | Ánh xạ 1-1 vào hằng mới; **không nới nghĩa** ⇒ không cần chữ ký kiểu D-OWNER-8 |
| **M6** | Ca nào KHÔNG có mã trong catalog? | đối chiếu `done_when` ↔ `SPEC-16:311-332` | **K1** (người nhận kudos trùng tác giả) · **K2** (>10 người nhận) · **P-opt** (`option_id` không thuộc poll) — SPEC **im lặng cả ba** | Dùng hằng **CÓ TÊN, không số hoá** theo tiền lệ `REPORT_DUPLICATE_OPEN`/`GROUP_NAME_TAKEN`; K1/K2 còn cần chữ ký vì **bản thân luật** chưa có nguồn (S3) |

### 1.b Schema Track B — tên cột · constraint · index (mig `0580`, schema `db/schema/social.ts`)

| # | Câu hỏi | Lệnh đo | Kết quả THỰC TẾ | Hệ quả cho plan |
| --- | --- | --- | --- | --- |
| **M7** | `feed_polls` có gì? | `social.ts:584-621` | `id·company_id·post_id·question(varchar 500)·multiple_choice·is_anonymous·status(varchar 16, default 'open')·closes_at·closed_at·created_at·updated_at`. CHECK: `chk_feed_polls_status` · `chk_feed_polls_closed_pair` (`status='open' OR closed_at IS NOT NULL`) · `chk_feed_polls_closes_future` (`closes_at IS NULL OR closes_at > created_at`). UNIQUE `feed_polls_company_post_uq`·`feed_polls_company_id_id_uq` | `closeTx` **phải ghi `closed_at` cùng lúc `status='closed'`**, thiếu ⇒ `23514` ⇒ 500 |
| **M8** 🔴 | Comment «service PHẢI chặn UPDATE» ở đâu, nguyên văn? | `social.ts:596-600` | `multipleChoice`: *«⚠️ BẤT BIẾN sau khi tạo — service PHẢI chặn UPDATE (D1): đổi giữa chừng làm chốt `feed_poll_votes_single_uq` sai lệch IM LẶNG (partial index không đọc được bảng khác)»*; `isAnonymous`: *«BẤT BIẾN sau khi tạo — như trên (SPEC-16 §13.4)»* | Nợ (b) **KHÔNG xả được** bằng «không có route PATCH». §2 D2 |
| **M9** 🔴 | Index job đóng poll quét qua? | `social.ts:617-619` | `idx_feed_polls_open_deadline (company_id, closes_at) WHERE status='open' AND closes_at IS NOT NULL` | Câu `closeExpiredTx` phải giữ **đúng hình dạng vị từ này** để dùng được index |
| **M10** | `feed_poll_options`? | `social.ts:629-652` | `id·company_id·poll_id·label(255)·position(smallint)·vote_count(int default 0)`. CHECK `chk_feed_poll_options_vote_count (vote_count >= 0)`. UNIQUE `feed_poll_options_company_id_id_uq` · **`feed_poll_options_position_uq (company_id, poll_id, position)`** | Lệch âm `vote_count` ⇒ `23514` ⇒ **500**; `position` phải sinh 0..n-1 không trùng |
| **M11** 🔴 | `feed_poll_votes` có khoá gì? | `social.ts:660-695` | PK **`feed_poll_votes_pk (company_id, poll_id, option_id, user_id)`** · partial unique **`feed_poll_votes_single_uq (company_id, poll_id, user_id) WHERE single_choice`** · index `idx_feed_poll_votes_company_poll_user` | 409 `ERR-017` bắt theo **TÊN** `feed_poll_votes_single_uq`, KHÔNG `23505` trần (luật `social.errors.ts:210-219`) |
| **M12** 🔴 | `single_choice` có DEFAULT không? | `social.ts:676-679` + `DB-17:623,629` | **KHÔNG** — cố ý. `DEFAULT false` sẽ biến một lần quên ghi thành vô hiệu hoá chốt chống-phiếu-đôi IM LẶNG; không default ⇒ `23502` ồn ào | Mọi INSERT (kể cả fixture test) phải truyền tường minh; giá trị = `NOT feed_polls.multiple_choice` **đọc trong CÙNG câu** |
| **M13** 🔴 | Có FK nào nối `option_id` với `poll_id` không? (nợ (e)) | `0580:416-422` | **KHÔNG.** Chỉ hai FK RỜI: `feed_poll_votes_poll_tenant_fk (company_id, poll_id) → feed_polls(company_id,id)` và `feed_poll_votes_option_tenant_fk (company_id, option_id) → feed_poll_options(company_id,id) ON DELETE NO ACTION` | Gửi `optionId` của poll KHÁC vẫn INSERT được ⇒ nhồi phiếu + `vote_count` lệch VĨNH VIỄN. §2 D4 |
| **M14** | `feed_ideas`? | `social.ts:703-739` | `status varchar(16) NOT NULL` **KHÔNG DEFAULT** (khác `feed_polls`). CHECK `chk_feed_ideas_status` (4 giá trị) · **`chk_feed_ideas_reviewed_pair`** (`status IN ('submitted','under_review') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)`) · **`chk_feed_ideas_reject_note`** (`status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0)`). `reviewed_by` FK `ON DELETE SET NULL` | (a) `createIdeaTx` PHẢI ghi `status='submitted'` tường minh; (b) `reviewTx` một câu 4 cột; (c) **`rejected` bắt buộc `note` không-rỗng-sau-btrim** — Zod `.min(1)` KHÔNG đủ (chuỗi `"   "` lọt Zod, chạm CHECK ⇒ 500) |
| **M15** | `feed_kudos` / `feed_kudos_recipients` / `feed_kudos_badges`? | `social.ts:778-832`, `:747-772` | `feed_kudos`: `post_id`·`badge_id`(nullable, NO ACTION)·`message`·`is_official`. `feed_kudos_recipients`: PK `(company_id, kudos_id, employee_id)`, **KHÔNG có `created_at`**, `employee_id → employee_profiles.id`. `feed_kudos_badges`: `code(32)`·`name`·`icon`·`is_active`·`position`, UNIQUE `(company_id, code)` | 🔴 **Người nhận neo theo `employee_id`, KHÔNG phải `user_id`** ⇒ NOTI-033 phải map employee→user TRONG tx (khuôn `social-mentions.ts` D7) |
| **M16** | Quyền của app role trên 3 bảng phiếu? | `0580:545-557` | `feed_poll_options`: `SELECT, INSERT, UPDATE` · **`feed_poll_votes`: `SELECT, INSERT, DELETE`** (KHÔNG UPDATE) · `feed_ideas`: `SELECT, INSERT, UPDATE` · `feed_kudos_recipients`: `SELECT, INSERT, DELETE` | Đổi/rút phiếu = **DELETE + INSERT**, không UPDATE — khớp docblock `social.ts:658-659` |
| **M17** | `chk_feed_posts_body_required`? | `social.ts:154-157` | `type IN ('poll','kudos') OR (body IS NOT NULL AND length(btrim(body)) > 0)` | `poll`/`kudos` được phép `body = NULL` ⇒ DTO phải cho phép, xem M31 |

### 1.c Sổ · ratchet · cổng — ĐO RIÊNG TỪNG CÁI (done_when #10)

| # | Sổ | Lệnh đo | Giá trị HIỆN TẠI | Hệ quả |
| --- | --- | --- | --- | --- |
| **M18** 🔴 | `MIN_COVERED_COUNT` của route-http-coverage | `route-http-coverage.e2e-spec.ts:355` | **`661`** — và dòng comment cuối cùng là *«S16-SOCIAL-BE-1B: 651 → 661»* (`:347-348`). **BE-2A KHÔNG bump** dù thêm 10 route | Sàn đang **LỎNG 10 đơn vị**. `MAX_UNCOVERED_TOTAL = 0` (`:324`) là cổng CHÍNH nên không có route nào thiếu test — nhưng WO này **phải đặt sàn = SỐ ĐO THẬT**, không «661 + 9». Xem M19 |
| **M19** | Tổng route thật của hệ | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json:6-14` | `totals.routes = **671**`, `gated 632`, `needVerdict 39`, `GAP 0`. Regen: `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts` (`:4`) | `671` (census JSON, **BE-2A ĐÃ regen**) vs `661` (`MIN_COVERED_COUNT`) ⇒ chênh đúng 10 = nợ bump của BE-2A. Sau BE-2B: census JSON **680**; `MIN_COVERED_COUNT` = số `coveredCount` mà chính spec IN RA, **đọc rồi mới gõ** |
| **M20** 🔴 | Census 2 tầng — 4 chỗ phải sửa | `social-two-layer-guard-census.unit-spec.ts` | (i) `SOCIAL_CONTROLLERS` **`:34-46`, 7 tên — DANH SÁCH TRẮNG**, comment `:42-44` ghi thẳng «quên thêm ⇒ route VÔ HÌNH, cả 4 assert vẫn XANH» · (ii) `ROUTE_TO_KEY` `:49-107` (39 dòng) · (iii) **`SERVICE_SITE_TO_KEYS`** `:115-159` (39 site — **tên thật, KHÔNG phải `SERVICE_SITES`**) · (iv) `toBe(39)` `:233` | 4 việc, thiếu một là **fail-OPEN IM LẶNG**. `toBe(39)` → `toBe(48)` |
| **M21** 🔴 | Census quét thư mục thế nào? | `social-two-layer-guard-census.unit-spec.ts:162-187` | `fs.readdirSync(SRC_SOCIAL)` — **PHẲNG, KHÔNG đệ quy** | 🔴 **Mọi file service mới PHẢI nằm phẳng trong `apps/api/src/social/`.** Đặt vào thư mục con ⇒ site `resolveActor` vô hình ⇒ census xanh rỗng |
| **M22** | `identity-projection-verdicts` | `identity-projection-verdicts.ts:669-765`, `BASIS_CEILINGS:780-832` | SOCIAL hiện **11 dòng** (4 BE-1 · 6 BE-1B · 1 BE-2A `listMembersTx:738-742`). Trần: `waiver 8` · `no-actor 7` · **`second-assert 11`** · `self-bound-route 9` · `order-only 1` · **`scoped-predicate 24`** · `membership 12` · `self-bound-row 5` | `047` chiếu **tên người được vinh danh** + **tên người gửi** ⇒ +điểm; chọn basis rồi **bump đúng trần ở cuối file** (mỗi basis một sổ đếm riêng — cấm cộng tay lẫn nhau) |
| **M23** | Ngưỡng coverage per-file | `vitest.config.ts:144-149` | `src/social/social-access.service.ts`: lines/functions/statements **90**, branches **85**. Comment `:141-143`: «cổng coverage THẬT duy nhất của module» | Nếu WO này chạm `social-access.service.ts` thì mọi nhánh mới phải có ca |
| **M24** 🔴 | `test:cov:social` gồm spec nào? | `apps/api/package.json:16` | `src/social` + `test/foundation/social-two-layer-guard-census.unit-spec.ts` + **11 int-spec liệt kê TỪNG CÁI** (4 BE-1 · 3 BE-1B · 3 BE-2A: `social-be2a-feed-group` · `social-be2a-groups` · `social-be2a-group-members`) | **Int-spec mới ở `test/integration/**` phải THÊM TAY vào dòng này**, không thì không tính vào cổng. Spec colocated trong `src/social/**` thì tự vào |
| **M25** | Ratchet `@Param` | `param-uuid-ratchet.unit-spec.ts:67,199`; `param-uuid-verdicts.ts:1555-1603` | `UNPIPED_CEILING = 1` và assert là **ĐẲNG THỨC** `toBe(UNPIPED_CEILING)`. `PARAM_UUID_MEASURED_FILES` = 29 controller, **KHÔNG có controller SOCIAL nào**; `PARAM_UUID_MEASURED_SIZE = 183` | Mọi `@Param("post_id")` mới **BẮT BUỘC** `ParseUUIDPipe` cấp method; **KHÔNG** phải ký dòng verdict |
| **M26** | Ratchet body-validation | `body-validation-ratchet.unit-spec.ts:53` | `toBe(0)` — handler có body mà không validate ở biên phải = 0 | `041`/`044`/`046` phải có `@UsePipes(ZodValidationPipe)` (hoặc `@Body(new ZodValidationPipe(...))`) |

### 1.d Cái sẽ TÁI DÙNG — đo để biết tái dùng được tới đâu

| # | Câu hỏi | Kết quả THỰC TẾ | Hệ quả |
| --- | --- | --- | --- |
| **M27** 🔴 | `resolveActor` batch hiện mấy cặp? | `social-access.service.ts:79-91` — **4**: `[0]` cặp của route · `[1]` `manage:feed-post` · `[2]` `manage:feed-news` · `[3]` `manage:feed-group`. Cờ trên `SocialActor`: `canManagePosts`·`canManageNews`·`canManageGroups`. Bẫy ghi ở `:87-89`: **cấm thêm cặp vốn ĐÃ là cặp của một route** | `approve:feed-idea` **là cặp của route `046`** ⇒ **KHÔNG** thêm vào batch. §2 D7 |
| **M28** | Cờ scope ép sàn thế nào? | `:101-105` `companyFloor` → 403 `AUTH-ERR-SCOPE-DENIED`; `:122-125` cờ dùng `isCompany()` để `undefined` **fail-closed** | Cờ mới bắt buộc qua `SocialAccessService.isCompany(...)`, **TUYỆT ĐỐI KHÔNG `!== null`** |
| **M29** | Seed `0578` cấp cho vai nào? | `:75-86` `create:feed-poll`·`-idea`·`-kudos` cho **cả 4 vai canonical** @`Company`; `:98-99` `manage:feed-kudos` chỉ `hr`+`company-admin`; `:102-103` `approve:feed-idea` chỉ `hr`+`company-admin` | Ca ALLOW `002/poll|idea|kudos` dùng vai bất kỳ; DENY `046` dùng `employee`; ALLOW `046` dùng `hr` |
| **M30** | `SOCIAL_POST_TYPE_PAIRS`? | `social-route-pairs.const.ts:220-226` — **chỉ 2 khoá**: `share: null` · `news: {manage, feed-news}`. Census assert **ĐẲNG THỨC** tập `tier1IsFloor===true` ↔ tập route có bảng cặp-theo-payload (`:185-186`) | Thêm 3 khoá `poll`/`idea`/`kudos`. Giữ `postCreate.tier1IsFloor = true` |
| **M31** 🔴 | `createFeedPostSchema` cho `type` nào? | `contracts/social-api.ts:82` `feedCreatableTypeSchema = z.enum(["share","news"])`; `:312-372` object `.strict().superRefine()`; **`:318` `body: feedBody()` = `z.string().trim().min(1).max(FEED_BODY_MAX)` — BẮT BUỘC** (`:92`) | Hai việc: (a) enum 2 → 5; (b) `body` thành tuỳ chọn cho `poll`/`kudos` (M17 cho phép) **mà không nới cho `share`/`news`/`idea`** ⇒ `superRefine` |
| **M32** 🔴 | Biến `createFeedPostSchema` thành union được không? | `social.dto.ts:39` `CreateFeedPostBody extends createZodDto(createFeedPostSchema)`; tiền lệ `:65` — `decideFeedGroupMemberSchema` là UNION nên **`createZodDto` ném TS2509**, phải dùng `@Body(new ZodValidationPipe(...))` | **CẤM** biến `createFeedPostSchema` thành discriminated union. §2 D6 |
| **M33** | 3 core schema Track B? | `contracts/social.ts:292-372` — `feedGroupMemberCoreSchema`·`feedPollCoreSchema`·`feedIdeaCoreSchema`. **KHÔNG có** `feedKudosCoreSchema`/`feedKudosBadgeCoreSchema`/`feedPollOptionCoreSchema`. Cảnh báo mass-assignment `:278-286` | DTO kudos + option **tự dựng**; DTO poll/idea `.pick()` từ core rồi `.strict()` |
| **M34** | Khuôn UPDATE cặp vết MỘT câu? | `social-reports.repository.ts:351-376` — `.set({status, resolvedBy, resolvedAt, resolutionNote, updatedAt}).where(and(id, companyId, **eq(status,'open')**)).returning({id})`, trả `updated.length > 0`; caller 409 khi `false` (`social-reports.service.ts:140`) | Khuôn CHÍNH XÁC cho cả `closeTx` (044/job) lẫn `reviewTx` (046) |
| **M35** 🔴 | Khuôn FSM của PAYROLL áp được nguyên xi không? | `payroll-fsm.ts:132-137,153-160` — ném `ConflictException({code: PAYROLL_ERR_CODE.*, message, details: payrollDetails(kind)})`. **SOCIAL KHÔNG có envelope đó**: `SOCIAL_ERR` là **chuỗi trần** và mọi throw hiện tại là `new ConflictException(SOCIAL_ERR.X)` | «`assertXTransition` ném 409 **có `kind`**» của backlog **KHÔNG áp được** mà không dựng envelope lỗi THỨ HAI cho cả module. §2 D10 |
| **M36** | Khuôn neo chống đua? | `social-group-access.service.ts:145-151` `lockGroupRowTx` = `SELECT 1 FROM feed_groups WHERE company_id AND id FOR UPDATE`; `:162-181` `assertOwnerRemainsTx` gọi SAU khoá | Sao nguyên hình dạng cho `lockPollRowTx` |
| **M37** | Khuôn bộ đếm? | `social-counters.ts:40-62` `bumpPostCounter` · `:285-308` `bumpGroupMemberCount` — `UPDATE … SET x = x + delta … RETURNING`, **cấm đọc-rồi-ghi, cấm `Math.max` ở JS**, NÉM khi khớp 0 dòng (`:305-307`) | `bumpPollOptionVotes` theo đúng khuôn, thêm ở CÙNG file (append) |
| **M38** | Khuôn unit không cần DB? | `social-news-noti-cap.spec.ts:35-48` (dựng service với `null as never`) · `:60-69` `fakeTx()` · `:72-81` gọi private qua chỉ số | Dùng cho ca FSM, ca 2–10 lựa chọn, ca K1/K2 — **không cần `LANE_DB`** |
| **M39** | Khuôn structure-spec? | `realtime/chat-realtime-structure.spec.ts:2-4,25` — đọc file bằng `node:fs`, **có `stripComments`** ở `:25` | 🔴 Structure-spec của nợ (b) **PHẢI strip comment**, nếu không chính docblock `social.ts` làm nó đỏ oan |

### 1.e NOTI — pin VERBATIM theo `0581`

| # | Câu hỏi | Kết quả THỰC TẾ (nguyên văn) | Hệ quả |
| --- | --- | --- | --- |
| **M40** 🔴 | 3 `event_code` + `dedupe_strategy`? | `0581:194-203` và bảng verify `:327-337`:<br>· **`SOCIAL_IDEA_STATUS_CHANGED`** — `Normal`, **`DedupeKey`**, `is_system_event=false`<br>· **`SOCIAL_KUDOS_RECEIVED`** — `Normal`, **`DedupeKey`**, `false`<br>· **`SOCIAL_POLL_CLOSED`** — `Low`, **`DedupeKey`**, **`is_system_event = true`** | 🔴 **CẢ BA đều `DedupeKey`** ⇒ **BẮT BUỘC khai `dedupeKeyOf`** (registrar `:133-135`: bỏ trống ⇒ fallback `ctx.eventId` LUÔN khác nhau ⇒ dedupe biến mất CÂM). ⚠️ `done_when` #9 viết «`034` dedupe_strategy='None'» — **`034` thuộc BE-2A** |
| **M41** 🔴 | `variables_schema` từng mã? | `0581:243-248` `IDEA` = `{"status_label":"string","post_id":"uuid"}` — **KHÔNG `actor_name`**, comment `:242` «CHỈ `status_label` — KHÔNG nhúng `review_note`».<br>`:249-254` `KUDOS` = `{"actor_name":"string","post_id":"uuid"}`.<br>`:262-267` `POLL_CLOSED` = `{"poll_question":"string","post_id":"uuid"}`, comment `:261` «KHÔNG biến nào lộ người bỏ phiếu» | `TEMPLATE_KEYS` +3 dòng ĐÚNG các khoá này. `requireField` NÉM khi thiếu (`registrar:86-94,239`) |
| **M42** | `PAYLOAD_KEYS` hiện có gì? | `social-noti-bridge.registrar.ts:19-37` — 12 khoá: `postId·commentId·targetType·targetId·actorUserId·actor_name·post_id·target_type_label·reason_label·group_id·group_name·decision_label` | **Thiếu `status_label` và `poll_question`** ⇒ thêm đúng 2 khoá (append) |
| **M43** | Bảng mã sự kiện nội bộ? | `social-noti.payload.ts:30` `SOCIAL_EVENT_CODES` · `:87` `_B` · `:180` `_C` | Thêm bảng thứ TƯ `SOCIAL_EVENT_CODES_D` — **không sửa 3 bảng cũ** |
| **M44** 🔴 | Audit `object_type` có `feed_poll`/`feed_idea`/`feed_kudos` không? | `db/schema/audit.ts:415-418,438` — có `feed_post`·`feed_comment`·`feed_group`·`feed_report`·`feed_kudos_badge`. **KHÔNG có 3 cái kia**, và `0583:14-15` ghi rõ CHỦ Ý: *«`feed_kudos` KHÔNG cần mã riêng — vinh danh là một BÀI (`feed_post`)»* | Audit `044`/`046` ghi `object_type='feed_post'`, `object_id = postId`. **§6: KHÔNG migration audit** |
| **M45** | `audit.record` chữ ký? | `social-groups.service.ts:539-549` — `this.audit.record(tx, {action, objectType, objectId, actorUserId, moduleCode, entityType, entityId, resultStatus, metadata})`. `audit.service.ts:238` đọc lại `row.actorUserId ?? null` ⇒ **cột nullable** | **CHƯA ĐO:** kiểu TS của `actorUserId` trong `record()` có nhận `null` không — **U1** |

### 1.f Job hệ thống

| # | Câu hỏi | Kết quả THỰC TẾ | Hệ quả |
| --- | --- | --- | --- |
| **M46** | Hợp đồng `JobHandler`? | `scheduler/job-handler.ts:50-53` `{jobCode, run(ctx)}`; `:23-32` `JobRunContext = {companyId, today?}` — **KHÔNG có `tx`**, handler **TỰ mở `withTenant`** (`:19-22`); `:38-43` `JobRunResult = {total, success, failed, metadata?}` | Handler tự `withTenant(ctx.companyId, …)` |
| **M47** | Đăng ký ở đâu? | `worker-scheduler.service.ts:98-111` DiscoveryService gom provider có metadata `SYSTEM_JOB_HANDLER`, dedup theo `jobCode`. `system_job_locks.job_code` `varchar(100)` **PK, KHÔNG CHECK enum** (`db/schema/system-jobs.ts:85`) | Chỉ cần class + `@SystemJobHandler()` + `providers` của `SocialModule`. **KHÔNG seed/catalog/migration** |
| **M48** 🔴 | `@Optional()` như `src` backlog gợi ý — đúng không? | `room-booking-reminder.job-handler.ts:48`: *«Dep đều là provider thật ⇒ không cần `@Optional()`»*; `chat-call-ringing-timeout.job-handler.ts:33-39`: *«Gắn `@Optional()` cho một provider CÓ THẬT sẽ biến lỗi wiring thành `undefined` im lặng»* | 🔴 **Gợi ý `@Optional` của backlog SAI với ca này.** Bằng chứng thay thế: int-spec dựng **AppModule THẬT** + assert `jobCode` có mặt đúng 1 lần |
| **M49** | Nhịp chạy? | `worker-scheduler.service.ts:79-83` một interval `system-jobs` chung; `:37` tắt khi `NODE_ENV='test'` | Job **không chạy trong test** ⇒ ca test gọi thẳng `handler.run({companyId})` |

### 1.g Tài liệu — chỗ `done_when`/`notes` LỆCH thực tế

| # | Khẳng định trong backlog | Đo được | Kết luận |
| --- | --- | --- | --- |
| **M50** 🔴 | *«API-19 §15 lại gom 047..051 thành một cụm»* (`notes` ⚠️ #1) | API-19 chỉ có **10 mục** (`## 1..10`). **API-19 KHÔNG CÓ §15.** Nguồn THẬT là **SPEC-16 §15** (`:439` «Vinh danh & huy hiệu · `SOCIAL-API-047..051` · 5») và sub-header «Vinh danh — Track B» của API-19 §5.1 (`:117`) | Câu trong `notes` **sai địa chỉ**. Mâu thuẫn THẬT nhưng giữa **SPEC-16 §15** ↔ `src` backlog. Sửa `notes` cùng PR |
| **M51** | *«044 có `@Idempotent`»* (`done_when` #7) | API-19 §6.6 (`:263`) liệt `@Idempotent()` cho **`002`·`015`·`027`·`031`·`049`** — **KHÔNG có `044`**; `:267` ghi `PUT …/poll/vote` idempotent **theo bản chất** | Lệch tài liệu ↔ backlog. Plan **theo backlog** và **sửa API-19 §6.6 cùng PR**. §2 D12 |
| **M52** 🔴 | *«recipients ≠ tác giả, ≤10» (K1/K2)* | `grep -i '10 người\|recipients\|tối đa 10\|tự vinh danh' docs/` → **SPEC-16 và DB-17 im lặng hoàn toàn**. Chỉ `ERR-022` có nguồn (`SPEC-16:332`) | **K1/K2 là luật do `done_when` tự đặt, KHÔNG có nguồn SPEC** ⇒ **S3** |
| **M53** | *«§13.6 liệt ĐÚNG 5 cột…»* (`notes` ⚠️ #2) | `SPEC-16:393-405` — **ĐÚNG**: `like_count`·`comment_count`·`view_count`·`feed_tags.usage_count`·`feed_groups.member_count`. `vote_count` vắng, nhưng có CHECK `>= 0` | Khẳng định **CHÍNH XÁC** ⇒ **S2** |
| **M54** | *«`social-access.service.ts:353` ghi luật ép-ở-service-không-ở-Zod»* | BE-2A đã dịch dòng. `:353` nay là nhánh `targetType === "post"`. Luật ấy nay ở **`:392-394`** (docblock `assertWriteAudience`) | Số dòng đã CŨ; **luật vẫn đúng**: `ERR-018` **phải ném ở SERVICE** (Zod trả 400 vô danh) |

### 1.h CHƯA ĐO — người thi công phải đo TRƯỚC khi code

| # | Việc | Vì sao chưa đo | Đo khi nào |
| --- | --- | --- | --- |
| **U1** | `AuditService.record` có nhận `actorUserId: null` không (M45) | Chưa mở signature; ảnh hưởng dòng audit của job | Bước 0, TRƯỚC khi viết job |
| **U2** | `coveredCount` thật sau khi thêm 9 route (M18/M19) | Phải chạy spec mới biết; **cấm cộng tay** | Bước 6, đọc số spec IN RA |
| **U3** | `040`/`045`/`047` đi qua `listFeed` hay câu riêng | `listFeed` phục vụ 5 route và có `groupScope` **BẮT BUỘC** (BE-2A W6); chưa đo `opts` có nhận `type`-filter không | Bước 0/3 |
| **U4** | Spec contracts nào ghim `feedCreatableTypeSchema` 2 giá trị | Mở enum 2→5 có thể làm đỏ spec đang ghim | Bước 0 |
| **U5** | `feedPostSchema` có chỗ chở chi tiết poll/idea/kudos không | API-19 §6.1 (`:184-207`) **không có** trường nào cho 3 loại | Bước 0; nếu nới thì ghi §13 + báo FE-2 |

---

## §2. Quyết định

| # | Quyết định | Nội dung | Căn cứ |
| --- | --- | --- | --- |
| **D1** 🔴 | **Một neo khoá cho MỌI đường ghi của một poll** | `lockPollRowTx(tx, companyId, pollId)` = `SELECT 1 FROM feed_polls WHERE company_id=$ AND id=$ FOR UPDATE`, gọi **đầu tiên** trong `voteTx` · `withdrawVoteTx` · `closeTx` (cả `044` lẫn job). Ba lý do: **(i)** TOCTOU thật — đọc `status`/`closes_at` rồi INSERT, một `044` song song đóng poll giữa hai câu ⇒ phiếu rơi vào poll đã đóng; **(ii)** biến `done_when` #5 thành bất biến ĐẾM ĐƯỢC; **(iii)** **chống deadlock nâng-cấp-khoá**: INSERT `feed_poll_votes` lấy `FOR KEY SHARE` trên hàng `feed_poll_options` (RI), rồi `bumpPollOptionVotes` đòi khoá GHI trên chính hàng đó — đúng lớp lỗi `035` mà FULL gate BE-2A bắt. **Giá phải trả:** người bỏ phiếu cùng poll bị tuần tự hoá — chấp nhận | M36; BE-2A §14.2 |
| **D2** 🔴 | **Nợ (b) — ba vế** | (a) `closeTx` UPDATE **tường minh ĐÚNG 2 cột** `status`+`closed_at` (+`updated_at`), **CẤM mapped-write** (drizzle **bỏ qua im lặng** khoá không phải cột — `payroll-fsm.ts:37-38`); (b) **structure-spec** (khuôn M39, **có `stripComments`**): không site nào trong `src/social/**` ghi `multipleChoice`/`isAnonymous` **ngoài `createPollTx`**; (c) ca RED cho chính spec đó. Lý lẽ «không có route PATCH nên tự động đúng» **BỊ CẤM** | M8 |
| **D3** 🔴 | **`single_choice` đọc từ `feed_polls` NGAY TRONG câu INSERT** | `INSERT … SELECT …, NOT p.multiple_choice FROM feed_polls p WHERE …` — không đọc ra JS rồi ghi lại. Quên ⇒ `23502` (ồn ào); ghi SAI ⇒ partial index không áp, **phiếu đôi lọt IM LẶNG** | M12; DB-17 `:629` |
| **D4** 🔴 | **Nợ (e) — `optionId ∈ pollId` cùng TX, TRƯỚC mỗi INSERT** | `SELECT id FROM feed_poll_options WHERE company_id=$ AND poll_id=$ AND id = ANY($ids)` ⇒ số hàng **BẰNG** số `optionId` distinct, nếu không ⇒ **404 `POLL_OPTION_NOT_FOUND`** (hằng CÓ TÊN). 404 chứ không 422: option của poll khác là đối tượng actor không được biết tồn tại | M13 |
| **D5** 🔴 | **`voteTx` một tx, bù trừ ĐỐI XỨNG** | `lockPollRowTx` → đọc poll → cổng `open`+`closes_at` → D4 → `DELETE … RETURNING option_id` → **`-1` cho MỌI option vừa xoá** → `INSERT` (D3) → **`+1`**. Cấm bỏ vế `-1`: lệch ngay ở luồng **đổi phiếu BÌNH THƯỜNG**. Bắt `isUniqueViolationOf(err, "feed_poll_votes_single_uq")` → **409 `ERR-017`**, KHÔNG `23505` trần | M11; M16 |
| **D6** 🔴 | **`createFeedPostSchema` GIỮ object phẳng `.strict()` + `superRefine`** | Enum 2→5; thêm trường tuỳ chọn theo type; `superRefine` ép: trường của type này **cấm xuất hiện** ở type khác, `body` bắt buộc cho `share`/`news`/`idea`, tuỳ chọn cho `poll`/`kudos`. **CẤM** discriminated union (TS2509 — M32) | M31; M32; M17 |
| **D7** | **Cặp quyền theo `type` — resolve TRONG `create()`, KHÔNG nhét vào batch** | `SOCIAL_POST_TYPE_PAIRS` +3; `create()` sau khi biết `dto.type` gọi **một** `resolveManyOrNull` cho ĐÚNG cặp đó (+`manage:feed-kudos` khi `isOfficial`), ép sàn `isCompany()`. Không vào batch vì batch chạy cho **cả 48 route** và sẽ kéo `SocialActor` phình thêm 4 cờ mà `SocialViewerContext` không có (bẫy W3/H2 BE-2A). ⚠️ **Đánh đổi:** lời gọi này **census không nhìn thấy** ⇒ phải có ca DENY riêng T1-T3 | M27; M30 |
| **D8** 🔴 | **2–10 lựa chọn ép Ở SERVICE → 422 `ERR-018`** | Zod **chỉ** chặn hình dạng, **KHÔNG** `.min(2).max(10)`. Cùng luật cho **K2** và **`ERR-022`**. Ca test assert **đúng MÃ** | M54 |
| **D9** | **Lựa chọn BẤT BIẾN sau khi tạo** | Không route nào sửa/thêm/xoá `feed_poll_options`. `position` sinh ở server `0..n-1` | M10; DB-17 §7.4 |
| **D10** 🔴 | **FSM sáng kiến — bảng cạnh literal + MỘT hàm assert, ném chuỗi trần** | `social-idea-fsm.ts` thuần TS: `IDEA_TRANSITIONS` = **ĐÚNG 3 cạnh** (`submitted→under_review`, `under_review→accepted`, `under_review→rejected`). Terminal, KHÔNG reopen, KHÔNG nhảy cóc. `assertIdeaTransition` ném `ConflictException(SOCIAL_ERR.IDEA_TRANSITION)`. ⚠️ **KHÔNG** dựng envelope `{code, details.kind}` kiểu PAYROLL (M35). Ma trận **4×4 = 16 ô**: 3 hợp lệ, 13 phải 409 | M35 |
| **D11** 🔴 | **`reviewTx` — MỘT câu UPDATE 4 cột + `WHERE status = <from>` + `RETURNING`** | 0 hàng ⇒ **409 `ERR-019`**. Thiếu một vế cặp `reviewed_by`/`reviewed_at` ⇒ `chk_feed_ideas_reviewed_pair` ⇒ 500. 🔴 **`rejected` phải `btrim(note).length > 0` ở SERVICE** — Zod `.min(1)` cho lọt `"   "` ⇒ 23514 ⇒ **500** | M14; M34 |
| **D12** | **`@Idempotent` — theo backlog, SỬA API-19 §6.6 cùng PR** | `044` có `@Idempotent()`. `041` (PUT) và `042` (DELETE) không; `046` (PATCH) không ⇒ **WO có ĐÚNG MỘT POST**, và nó có decorator | M51 |
| **D13** 🔴 | **Job đóng poll — idempotent bằng CHÍNH câu ghi** | `UPDATE feed_polls SET status='closed', closed_at=now(), updated_at=now() WHERE company_id=$ AND status='open' AND closes_at IS NOT NULL AND closes_at <= now() RETURNING id, post_id, question` (giữ hình dạng vị từ của `idx_feed_polls_open_deadline`). NOTI-035 enqueue **TRONG CÙNG tx** | M9; M34 |
| **D14** 🔴 | **Poll ẩn danh — tập cột TƯỜNG MINH, cấm `select()` trần** | `043` trả đúng bộ trường API-19 §6.3: `{pollId, question, isAnonymous, status, totalVoters, myVote[], options[{id,label,voteCount}]}`. `user_id` **KHÔNG BAO GIỜ** vào DTO — kể cả `company-admin`, kể cả khi `isAnonymous=false`. `totalVoters = COUNT(DISTINCT user_id)` | API-19 §6.3; SOC-DEC-009 |
| **D15** | **Cổng ĐỌC của cả 9 route đi qua `visiblePostCondition`** | Poll/idea/kudos **không có phạm vi riêng** — thừa hưởng phạm vi BÀI CHA. `040`/`043`/`045`/`047` JOIN `feed_posts` + vị từ NGAY TRONG câu; `041`/`042`/`044`/`046` gọi `assertPostVisible` trước. ⚠️ Nếu tái dùng `listFeed` thì **BẮT BUỘC** khai `groupScope` tường minh — **U3** | BE-2A D1 |
| **D16** | **Audit** | `046` **LUÔN** (`feed_post`, `{postId, ideaId, from, to}` — **KHÔNG** `review_note`). `044` **LUÔN** (đóng poll không đảo ngược được), `{postId, pollId, via:'manual'|'job'}` — **U1/S4** | M44; M45 |
| **D17** | **File mới nằm PHẲNG trong `src/social/`** | Census `readdirSync` không đệ quy | M21 |

### 2.3 Cần CHỮ KÝ OWNER — KHÔNG tự quyết

| # | Câu hỏi | Hiện trạng ĐO ĐƯỢC | Phương án A | Phương án B | Khuyến nghị |
| --- | --- | --- | --- | --- | --- |
| **S1** 🔴 | **`047`/`048` (ĐỌC) thuộc BE-2B hay BE-3?** | `src` backlog: BE-2 ghi *«~026..040»*, BE-3 *«~041..045»* — **cả hai lệch** API-19. **SPEC-16 §15 `:439`** gom `047..051` thành MỘT cụm 5. **API-19 KHÔNG CÓ §15** (M50). Cặp quyền TÁCH RÕ: `047`/`048` = `view:feed`; `049..051` = `manage:feed-kudos` (chỉ hr + company-admin, `0578:98-99`) | **`047`+`048` thuộc BE-2B**; `049..051` thuộc BE-3 | Dời cả `047..051` sang BE-3 ⇒ BE-2B còn 7 route | **A.** (i) cặp quyền khác hẳn ⇒ hai bề mặt bảo mật; (ii) `0583:11-12` ghi thẳng «BE-3 (CRUD catalog huy hiệu, `manage:feed-kudos`)» — DB-2 đã ký ranh giới; (iii) tạo được kudos mà **không đường HTTP nào đọc** đúng là «WRITE-ONLY» mà D-OWNER-7 của BE-2A vừa từ chối. **Ký thì sửa `src` CẢ HAI WO + `notes` cùng PR** |
| **S2** 🔴 | **`vote_count` đối soát ở đâu?** | SPEC-16 §13.6 liệt **ĐÚNG 5 cột** và đòi «script đối soát cả năm cột»; `vote_count` không trong đó nhưng có `CHECK >= 0` (M10) ⇒ lệch âm = **500**, lệch dương = hỏng câm | **Bổ sung `vote_count` vào script đối soát + sửa SPEC-16 §13.6 thành SÁU cột** cùng PR | Giữ SPEC 5 cột, ghi **nợ tường minh** cho QA-1 | **A.** Bộ đếm có CHECK mà không sổ nào đối soát là «cổng CHẾT trông y hệt cổng sống». Sửa SPEC = một dòng; để nợ là để trôi qua QA (tiền lệ M-c BE-2A). Nếu chọn B ⇒ **phải** ghi vào `done_when` của QA-1 |
| **S3** 🔴 | **K1/K2 có nguồn nào không?** | SPEC-16 và DB-17 **im lặng hoàn toàn** (M52). PK `(company, kudos, employee)` chỉ chặn TRÙNG người nhận, không chặn tự-vinh-danh, không chặn 500 người | **Ép cả hai ở service** (K1 → 422 `KUDOS_SELF_RECIPIENT`; K2 → 422 `KUDOS_RECIPIENT_LIMIT`, trần là hằng module-level) **+ bổ sung 2 dòng SPEC-16 §13** | Ép **chỉ K2** (trần kỹ thuật chống fan-out NOTI), bỏ K1 | **A, có điều kiện:** K2 có **hệ quả NOTI thật** (mỗi người nhận = một hàng `notifications`) ⇒ trần kỹ thuật chính đáng. K1 **không** có hệ quả kỹ thuật nào — nó là luật NGHIỆP VỤ mà owner phải ký. Không ký ⇒ bỏ K1 và **xoá vế đó khỏi `done_when` #3**, không để một câu không ai thực thi |
| **S4** | **Actor audit của job?** | API-19 §5.1d `:165` đòi «dòng audit ghi rõ nguồn là job, không phải người». Cột nullable (M45), kiểu TS **CHƯA ĐO** (U1) | `actorUserId: null` + `metadata.via='job'` | Dựng «user hệ thống» per-tenant | **A** nếu U1 cho phép. B đẻ một user ảo có `user_id` thật — sẽ xuất hiện ở mọi màn lọc audit theo người và ở `?actorUserId=`. Nếu U1 **không** cho `null` ⇒ **dừng, hỏi owner lại** |
| **S5** | **Phân trang `040`/`045`/`047`** | API-19 §6.4 `:246-247` chỉ nói về feed (cursor) và danh sách quản trị (offset). **Ba danh sách này không nằm trong câu nào** | **OFFSET** (khuôn `030`) | Cursor | **A.** Rẻ hơn, khớp `030`/`028` đã ship, và FE-2 vẽ chúng ở rail phải (widget). Ghi bổ sung một dòng vào API-19 §6.4 cùng PR |

---

## §3. Cấu trúc file

### 3.1 File MỚI (`apps/api/src/social/` — PHẲNG, M21)

| File | Trách nhiệm | ~dòng |
| --- | --- | --- |
| `social-idea-fsm.ts` | `IDEA_TRANSITIONS` (3 cạnh literal) · `assertIdeaTransition` (409 `ERR-019`). Thuần TS | 60-90 |
| `social-polls.repository.ts` | `lockPollRowTx` · `getPollForWriteTx` · `optionsOfPollTx` (D4) · `deleteVotesOfUserTx` (RETURNING) · `insertVotesTx` (D3) · `closeTx` (D2a) · `closeExpiredTx` (D13) · `listPollsTx` · `resultsTx` (D14) | 250-300 |
| `social-polls.service.ts` | `040`·`041`·`042`·`043`·`044` | 220-270 |
| `social-poll-close.job-handler.ts` | `jobCode = "SOCIAL_POLL_CLOSE_EXPIRED"`, tự `withTenant`. **KHÔNG `@Optional()`** (M48) | 70-100 |
| `social-ideas.repository.ts` | `listIdeasTx` · `getIdeaForReviewTx` · `reviewTx` (D11) | 140-180 |
| `social-ideas.service.ts` | `045`·`046` | 140-180 |
| `social-kudos.repository.ts` | `listKudosTx` · `listBadgesTx` · `activeBadgeTx` (`ERR-022`) · `userIdsOfEmployeesTx` (M15, lọc D7) | 160-200 |
| `social-kudos.service.ts` | `047`·`048` | 100-140 |
| `social-post-types.ts` | Hàm thuần nhận `tx` — `createPollTx` (🔴 **site DUY NHẤT** ghi `multipleChoice`/`isAnonymous`) · `createIdeaTx` · `createKudosTx`. Không gọi `resolveActor` ⇒ không sinh site census | 180-220 |
| `social-b2b.controllers.ts` | `SocialPollsController` · `SocialIdeasController` · `SocialKudosController` | 180-220 |
| `social-poll-flags-structure.spec.ts` | D2b — **có `stripComments`** (M39) | 70-100 |

### 3.2 File SỬA

| File | Sửa gì | Bẫy đã biết |
| --- | --- | --- |
| `social-posts.service.ts` (**636 dòng**) | `create()` +nhánh `type` (D7) → gọi `social-post-types.ts`; NOTI-033 | 🔴 **Trần 800.** Thân 3 loại ở file khác. Site census `SocialPostsService#create → postCreate` **KHÔNG đổi** |
| `social-access.service.ts` (448) | **CHƯA CHẮC phải sửa** nếu theo D7 | ⚠️ Chạm = chạm cổng coverage 90/90/85 (M23) + bẫy W3/H2 BE-2A. Ưu tiên KHÔNG chạm |
| `social-counters.ts` (309) | +`bumpPollOptionVotes` (append, NÉM khi 0 dòng) | Cấm `Math.max` ở JS (M37) |
| `social.errors.ts` (219) | +6 mã SỐ + hằng CÓ TÊN (`POLL_OPTION_NOT_FOUND`, và nếu S3 ký: `KUDOS_SELF_RECIPIENT`/`KUDOS_RECIPIENT_LIMIT`) + `SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ` | Khối additive; sửa header `:20-21` |
| `social-route-pairs.const.ts` (252) | +9 khoá route + `SOCIAL_POST_TYPE_PAIRS` +3 | Census đẳng thức `tier1IsFloor` (M30) |
| `social.dto.ts` (74) | +class DTO 9 route | `createZodDto` không bọc union (M32) |
| `social.module.ts` (130) | +3 controller +6 provider +1 job handler | 🔴 Thêm controller ⇒ **BẮT BUỘC** thêm dòng `SOCIAL_CONTROLLERS` |
| `contracts/social-api.ts` (470) | enum 2→5 · `createFeedPostSchema` (D6) | ⚠️ **U4** trước |
| `contracts/social-api-b2b.ts` (**mới**) | DTO 9 route (khuôn `social-api-groups.ts`) | M33: tự dựng DTO kudos/option |
| `social-noti.payload.ts` (212) | +`SOCIAL_EVENT_CODES_D` + 3 interface | M43 |
| `notifications/social-noti-bridge.registrar.ts` | +3 `registerSource` · `PAYLOAD_KEYS` +2 · `TEMPLATE_KEYS` +3 | 🔴 **CẢ BA phải có `dedupeKeyOf`** (M40) |
| `apps/api/package.json:16` | `test:cov:social` +int-spec mới | M24 |
| `test/foundation/social-two-layer-guard-census.unit-spec.ts` | 4 việc (M20) | Thiếu (i) ⇒ fail-OPEN |
| `test/foundation/route-http-coverage.e2e-spec.ts:355` | `MIN_COVERED_COUNT` ← **số ĐO ĐƯỢC** (U2), comment ghi **cả nợ 10 đơn vị của BE-2A** | Cấm cộng tay |
| `test/foundation/identity-projection-verdicts.ts` | +dòng `listKudosTx` + bump trần basis | M22 |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | Regen | ⚠️ ngoài `paths` — §12.3 |
| `docs/API Design/API-19…md` §6.4 · §6.6 | S5 · D12 | Sửa CÙNG PR |
| `docs/SPEC/SPEC-16 SOCIAL.md` §13.6 (+§13) | S2 · S3 nếu ký | Chỉ sau chữ ký |
| `harness/backlog.mjs` | `notes` #1 (M50) · `done_when` #7/#9 · `src` CẢ HAI WO nếu S1 ký | Không sửa ⇒ mâu thuẫn chỉ **dời chỗ** |

### 3.3 Luật DTO (nợ (f))

`.pick()` rồi `.strict()`. **Cấm `.extend()`** — cảnh báo có sẵn `contracts/social.ts:278-286`:
`feedIdeaCoreSchema` mang `status`/`reviewedBy`/`reviewedAt`/`reviewNote` ⇒ `.extend()` làm body `046` =
**tác giả tự gửi `{status:'accepted', reviewedBy:<mình>}` là TỰ DUYỆT**, bỏ qua `approve:feed-idea`.
Tương tự `feedPollCoreSchema` mang `status`/`closedAt` ⇒ tự đóng poll không qua `044`.

---

## §4. Bảng route

| Mã | Method · Path | Tầng-1 | Tầng-2 | Idem | Audit | NOTI | Lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `002`+`poll` | `POST /social/posts` | `create:feed-post` (SÀN) | D7 `create:feed-poll` · D8 2–10 | ✅ | — | — | 403 hằng-tên · **422 `ERR-018`** |
| `002`+`idea` | như trên | `create:feed-post` (SÀN) | D7 `create:feed-idea`; `status='submitted'` tường minh | ✅ | — | — | 403 hằng-tên |
| `002`+`kudos` | như trên | `create:feed-post` (SÀN) | D7 `create:feed-kudos` (+`manage:feed-kudos` nếu `isOfficial`) · `ERR-022` · K1/K2 (**S3**) | ✅ | — | **033** | **422 `ERR-022`** · 403 |
| `040` | `GET /social/polls` | `view:feed` | D15; lọc `status`; OFFSET (**S5**) | — | — | — | — |
| `041` | `PUT …/poll/vote` | `view:feed` | `assertPostVisible` → D1 → cổng → **D4** → **D5** → D3 | ❌ (bản chất) | — | — | **409 `ERR-016`** · **409 `ERR-017`** · 404 `POLL_OPTION_NOT_FOUND` |
| `042` | `DELETE …/poll/vote` | `view:feed` | D1 → cổng `open` → DELETE RETURNING → `-1` | ❌ | — | — | `ERR-016` |
| `043` | `GET …/poll/results` | `view:feed` | `assertPostVisible`; **D14** | — | — | — | 404 `ERR-001` |
| `044` | `POST …/poll/close` | `view:feed` | Chủ bài **HOẶC** `canManagePosts`; D1 → **D2a** | ✅ **D12** | ✅ `feed_post` | **035** | `ERR-016` · 403 `ERR-003` |
| `045` | `GET /social/ideas` | `view:feed` | D15; lọc `status`; OFFSET | — | — | — | — |
| `046` | `PATCH …/idea/review` | **`approve:feed-idea`** | `assertPostVisible` → **D10** → **D11** | ❌ | ✅ `feed_post` | **032** | **409 `ERR-019`** · **403 `ERR-020`** · 422 note rỗng |
| `047` | `GET /social/kudos` | `view:feed` | D15; lọc tháng/năm; +2 điểm chiếu (M22) | — | — | — | — |
| `048` | `GET /social/kudos-badges` | `view:feed` | `is_active = true` | — | — | — | — |

🔴 **Cả 9 route `tier1IsFloor: false`** — vế tầng-2 là quyền trên HÀNG (chủ bài · phạm vi bài), không phải
bảng cặp-theo-payload ⇒ đặt `true` sẽ làm census ĐỎ ngay (M30).
`ParseUUIDPipe` cấp method trên **mọi** `@Param` (M25 — ĐẲNG THỨC, trần đã dùng hết).

---

## §5. Deny-path RED trước + ALLOW đối chứng

> Mỗi DENY có ALLOW đối chứng; assert phủ định trên tập RỖNG là **deny vacuous** ⇒ luôn neo dương trước.
> Assert theo **MÃ LỖI**, không theo status trần.

### 5.1 Bình chọn

| # | DENY | Kỳ vọng ĐẾM ĐƯỢC | ALLOW đối chứng | DB? |
| --- | --- | --- | --- | --- |
| **P-b** 🔴 | Structure-spec: site ngoài `createPollTx` ghi cờ poll | Danh sách vi phạm **`toEqual([])`** + neo dương: spec thấy đúng 1 site hợp lệ **`toBe(1)`** | Tháo thử `.set({multipleChoice:…})` ⇒ spec ĐỎ | ❌ unit |
| **P-b2** 🔴 | `closeTx` ghi thừa cột | `.set({…})` có **ĐÚNG** tập khoá `{status, closedAt, updatedAt}` | — | ❌ unit |
| **P-e** 🔴 | Vote với `optionId` của poll KHÁC | **404 `POLL_OPTION_NOT_FOUND`**, `vote_count` poll kia **`toBe(before)`**, `COUNT(*)` phiếu poll kia không đổi | Option đúng poll ⇒ 200, `vote_count` **+1** | ✅ |
| **P-1** | Vote vào poll `status='closed'` | 409 **`ERR-016`** (assert chuỗi mã) | Poll `open` ⇒ 200 | ✅ |
| **P-2** | Vote vào poll `closes_at` đã qua (vẫn `open`) | 409 **`ERR-016`** — **ca RIÊNG với P-1** (hai nhánh khác nhau; gộp thì bỏ một nhánh vẫn xanh) | `closes_at` tương lai ⇒ 200 | ✅ |
| **P-3** 🔴 | Poll một-lựa-chọn, gửi **2 optionId** | 409 **`ERR-017`** ở service, `COUNT(*)` phiếu user `== 0` | Poll ĐA-lựa-chọn 2 option ⇒ 200, `COUNT(*) == 2` | ✅ |
| **P-4** 🔴 | **Đổi phiếu** A→B (một-lựa-chọn) | `vote_count(A)` **-1**, `vote_count(B)` **+1**, **`Σ vote_count == COUNT(*) phiếu`** sau mỗi bước | Phiếu đầu ⇒ Σ == 1 | ✅ |
| **P-5** 🔴 | **ĐUA phiếu đôi** — cùng user gọi `041` 2 lần đồng thời (khuôn `attendance-adjustment.int.spec.ts:520-523`) | **(i)** `COUNT(*) feed_poll_votes WHERE (poll,user) == 1`; **(ii)** `Σ vote_count == COUNT(*) phiếu`. **Không assert mã HTTP của hai lượt** | Trước đua Σ == 0; sau đua Σ == 1 (neo dương: có ghi thật) | ✅ |
| **P-6** 🔴 | Tháo D3: ghi cứng `single_choice=false` | **P-3** hoặc **P-5** phải ĐỎ | — | ✅ (ĐO CỔNG) |
| **P-7** | 1 lựa chọn · 11 lựa chọn | **422 `ERR-018`** (assert MÃ) | 2 ⇒ 201; 10 ⇒ 201 | ❌ unit + 1 int |
| **P-8** 🔴 | `043` poll ẩn danh, `company-admin` gọi | `expect(JSON.stringify(body)).not.toContain(voterUserId)` + **neo dương** `options[0].voteCount > 0` | Người thường ⇒ cùng bộ trường, `myVote` chỉ của mình | ✅ |
| **P-9** | `043` poll KHÔNG ẩn danh | Vẫn **KHÔNG** có `user_id` (D14) | `myVote` đúng option mình chọn | ✅ |
| **P-10** | `044` bởi người không phải chủ bài, không `manage:feed-post` | 403 `ERR-003`, poll vẫn `open` | Chủ bài đóng được; `manage` đóng được + **audit đúng** | ✅ |
| **P-11** | `044` đóng poll ĐÃ đóng | 409 `ERR-016`, `closed_at` **không đổi** | Poll `open` ⇒ 200, `closed_at != null` | ✅ |
| **P-12** | `040`/`043` trên bài ngoài audience | 404 `ERR-001` / vắng mặt | Người trong audience thấy | ✅ |

### 5.2 Job

| # | Ca | Kỳ vọng ĐẾM ĐƯỢC | DB? |
| --- | --- | --- | --- |
| **J-1** | 1 poll quá hạn, 1 chưa hạn, 1 đã `closed` | `result.total == 1`; poll chưa hạn vẫn `open`; poll đã đóng giữ `closed_at` cũ | ✅ |
| **J-2** 🔴 | `run()` hai lần | Lượt 2 `total == 0`, `closed_at` không đổi, số hàng outbox NOTI-035 **không tăng** | ✅ |
| **J-3** 🔴 | Đua job ↔ `044` | `COUNT(*) outbox NOTI-035 cho poll == 1` VÀ `status='closed'` | ✅ |
| **J-4** | Đăng ký handler | AppModule THẬT, `SYSTEM_JOB_HANDLER[]` chứa `jobCode` đúng **1 lần** (M48) | ✅ |
| **J-5** | Cô lập tenant | Poll quá hạn tenant B không bị job tenant A đóng | ✅ |

### 5.3 Sáng kiến

| # | DENY | Kỳ vọng | ALLOW | DB? |
| --- | --- | --- | --- | --- |
| **I-1** 🔴 | **Ma trận 4×4 vét cạn** | **13 ô** 409 `ERR-019`, đặc biệt từ `accepted`/`rejected` (terminal) và `submitted→accepted` | **3 ô** hợp lệ; neo dương `IDEA_TRANSITIONS.length === 3` | ❌ unit |
| **I-2** | `046` bởi `employee` (M29) | **403 `ERR-020`**, `status` không đổi | Vai `hr` ⇒ 200 | ✅ |
| **I-3** 🔴 | `rejected` với `note = "   "` | **422** hằng-tên ở SERVICE — **không để chạm 23514 ⇒ 500** | `note` có chữ ⇒ 200 | ✅ |
| **I-4** 🔴 | Tháo `reviewedAt` khỏi `.set()` | **I-5** ĐỎ với 23514 | — | ✅ (ĐO CỔNG) |
| **I-5** | `under_review → accepted` | `status`·`reviewed_by`·`reviewed_at` đều khác NULL sau một câu | — | ✅ |
| **I-6** 🔴 | Đua hai người duyệt | `COUNT(*) audit_logs action='idea.review' == 1`, `reviewed_by` không NULL | Duyệt đơn lẻ ⇒ audit 1 dòng | ✅ |
| **I-7** | `046` trên bài ngoài audience | 404 `ERR-001` (KHÔNG 403) | Trong audience + `hr` ⇒ 200 | ✅ |

### 5.4 Vinh danh

| # | DENY | Kỳ vọng | ALLOW | DB? |
| --- | --- | --- | --- | --- |
| **K-0** | `badgeId` của huy hiệu `is_active=false` | **422 `ERR-022`**, `COUNT(*) feed_kudos == 0` | Huy hiệu bật ⇒ 201 | ✅ |
| **K-0b** | `badgeId` của tenant khác | 422 `ERR-022` (cùng chuỗi) | — | ✅ |
| **K-1** | *(S3-A)* người nhận trùng tác giả | 422 `KUDOS_SELF_RECIPIENT`, `COUNT(*) == 0` | Người khác ⇒ 201 | ✅ |
| **K-2** | *(S3)* 11 người nhận | 422 `KUDOS_RECIPIENT_LIMIT` | 10 ⇒ 201, `COUNT(*) recipients == 10` | ❌ unit + 1 int |
| **K-3** 🔴 | `isOfficial:true` thiếu `manage:feed-kudos` | 403 hằng-tên, `COUNT(*) feed_kudos == 0` | `hr` ⇒ 201, `is_official=true` | ✅ |
| **K-4** 🔴 | Người nhận **đã nghỉ việc** | Không nhận NOTI-033 (`COUNT(*)` outbox recipient == 0); **neo dương**: người `active` cùng lời vinh danh CÓ nhận | — | ✅ |
| **K-5** | `047` trên bài kudos ngoài audience | Vắng mặt; neo dương: bài trong audience CÓ mặt `length > 0` | — | ✅ |
| **K-6** | `048` | Chỉ `is_active=true`; huy hiệu tắt vắng mặt; neo dương ≥1 có mặt | — | ✅ |

### 5.5 NOTI

| # | Ca | Kỳ vọng | DB? |
| --- | --- | --- | --- |
| **N-032** | `046` | 1 hàng `SOCIAL_IDEA_STATUS_CHANGED`, người nhận = tác giả sáng kiến, render ra **CHỮ**, `target_url` không còn `{post_id}`. **Deny:** người khác không nhận | ✅ |
| **N-032b** 🔴 | Payload KHÔNG chở `review_note` | `not.toContain(noteText)` + neo dương `payload.status_label` có chữ | ✅ |
| **N-033** | `002/kudos` | Tới **đúng tập user của recipients** (map từ `employee_id`), lọc D7 (K-4). **Deny:** tác giả không nhận | ✅ |
| **N-035** | Job + `044` | Tới **người tạo poll**, render `{poll_question}` ra chữ. **Deny:** người bỏ phiếu không nhận | ✅ |
| **N-dedupe** 🔴 | Cả 3 mã có `dedupeKeyOf` | Phát 2 lần cùng đối tượng ⇒ `COUNT(*) notifications == 1` mỗi mã | ✅ |
| **N-boot** | Registrar không dead-letter | `registerSource` 3 mã chạy được lúc boot | ✅ |

### 5.6 Census · sổ · bộ đếm

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| **C-1** 🔴 | Census 2 tầng | `toBe(48)`; `SOCIAL_CONTROLLERS` +3 tên; `ROUTE_TO_KEY` 48; `SERVICE_SITE_TO_KEYS` 48; đẳng thức `tier1IsFloor` giữ nguyên |
| **C-2** 🔴 | Chuỗi đầy đủ: tạo poll → vote → đổi phiếu → vote thêm option → rút phiếu → job đóng | Sau **MỖI** bước `Σ vote_count == COUNT(*) phiếu`; không bước nào chạm `chk_feed_poll_options_vote_count` |
| **C-3** | `MIN_COVERED_COUNT` | Xanh với sàn = số ĐO ĐƯỢC (U2) |
| **C-4** | Route census JSON | `totals.routes == 680` sau regen (đo lại) |
| **C-5** | Identity projection | Ratchet xanh sau khi thêm dòng + bump trần |

---

## §6. Migration

**KHÔNG CÓ.** Bốn phép đo độc lập: (1) 9 bảng Track B đã land ở `0580`; (2) 6 cặp quyền đã seed
`0578:44-53,75-103`; (3) 3 event + 3 template đã seed `0581` (verify-block `:304-345` ép set-equality
9 mã); (4) `feed_post` đủ cho audit `044`/`046` — `0583:14-15` đã ký CHỦ Ý việc không cấp mã riêng.
⇒ Head giữ `0585`. Nếu thi công phát hiện **phải** có migration, đó là **tín hiệu dừng** — việc của một WO DB.

---

## §7. Audit · NOTI

### 7.1 Audit (D16)

| Route | `object_type` | `object_id` | `action` | `metadata` |
| --- | --- | --- | --- | --- |
| `044` (tay) | `feed_post` | `postId` | `social.poll.close` | `{postId, pollId, via:'manual'}` |
| `044` (job) | `feed_post` | `postId` | `social.poll.close` | `{postId, pollId, via:'job'}` — **S4/U1** |
| `046` | `feed_post` | `postId` | `social.idea.review` | `{postId, ideaId, from, to}` — 🔴 **KHÔNG** `review_note` |

Bỏ `review_note` khỏi audit: cùng lý lẽ `0581:242` — chữ TỰ DO của người duyệt, và `audit_logs` có bề mặt
đọc RIÊNG (`audit.controller.ts`, lọc `?actorUserId=`) rộng hơn bề mặt đọc của chính hàng `feed_ideas`.
Hàng audit **append-only, sống lâu hơn grant**.

### 7.2 NOTI — pin VERBATIM

| Mã | `eventCode` (verbatim `0581`) | `dedupe_strategy` | `dedupeKeyOf` | `sourceEntityType` | Người nhận | Biến template |
| --- | --- | --- | --- | --- | --- | --- |
| 032 | `SOCIAL_IDEA_STATUS_CHANGED` | **`DedupeKey`** | 🔴 `"{post_id}:{status}"` — chỉ `{post_id}` sẽ **NUỐT** lượt chuyển thứ hai `submitted→under_review→accepted` | `feed_post` | tác giả sáng kiến | `status_label` · `post_id` |
| 033 | `SOCIAL_KUDOS_RECEIVED` | **`DedupeKey`** | 🔴 `"{post_id}"` (`recipient_user_id` đã là cột riêng của tuple dedupe) | `feed_post` | recipients (map employee→user, lọc D7) | `actor_name` · `post_id` |
| 035 | `SOCIAL_POLL_CLOSED` | **`DedupeKey`**, `is_system_event = **true**` | 🔴 `"{post_id}"` (poll đóng đúng một lần) | `feed_post` | tác giả bài | `poll_question` · `post_id` |

- `PAYLOAD_KEYS` +**`status_label`**, +**`poll_question`** (M42).
- `TEMPLATE_KEYS` +3 dòng mirror `variables_schema` `0581:243-267`; thiếu `post_id` ⇒ `target_url` giữ
  `{post_id}` ⇒ `assertInternalTargetUrl` từ chối ⇒ **dead-letter CÂM**.
- 🔴 `status_label` là **bảng nhãn ĐÓNG** enum→tiếng Việt ở service, không phải chữ tự do.
- 🔴 Rà rò danh tính: `payloadOf` forward **mọi** khoá whitelist **không phân biệt mã**;
  `my-notifications.mapper.ts` trả payload NGUYÊN VĂN. Ba payload này không chở
  `reviewedBy`/`voterUserId`; nếu cần chặn theo mã dùng `PAYLOAD_KEYS_DENIED` (`registrar:69-71`).
- ⚠️ `done_when` #9 nhắc «`034` = None» — **`034` thuộc BE-2A**; đọc nghĩa đen sẽ bỏ cả 3 `dedupeKeyOf`.

---

## §8. Thứ tự thi công

> Lane DB `mediaos_be2b` đã sẵn sàng. Chạy trong **MỘT lời gọi Bash duy nhất**:
> ```bash
> export APP_DB_PASSWORD="$(sed -n 's/^APP_DB_PASSWORD=//p' .env)" WORKER_DB_PASSWORD="$(sed -n 's/^WORKER_DB_PASSWORD=//p' .env)" SUPERUSER_DB_PASSWORD="$(sed -n 's/^SUPERUSER_DB_PASSWORD=//p' .env)" LANE_DB=mediaos_be2b && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && pnpm --filter @mediaos/api exec vitest run <spec>
> ```
> **Đừng pipe `harness/check.sh` qua `tail`.**

**Bước 0 — đo U1..U5 + baseline `coveredCount`.**

**Bước 1 — nền (RED trước):** 6. structure-spec nợ (b) (P-b/P-b2) · 7. `social-idea-fsm.ts` (I-1) ·
8. `social.errors.ts` +6 mã + hằng · 9. contracts (D6) + `build && typecheck`.

**Bước 2 — `002` ba nhánh:** 10. `social-post-types.ts` + `SOCIAL_POST_TYPE_PAIRS` +3 + nhánh `type`
(RED: T1/T2/T3, P-7, K-0/K-0b, K-3, K-1/K-2 nếu S3 ký) · 11. 🔴 chạy lại **nguyên bộ spec BE-1/1B/2A** —
`type='share'|'news'` **không đổi hành vi**.

**Bước 3 — bình chọn:** 12. repository (D1·D3·D4·D5·D2a) + `bumpPollOptionVotes` (RED: P-e, P-1..P-5, C-2) ·
13. service + controller `040..044`, `043` tập cột tường minh (RED: P-8..P-12).

**Bước 4 — job + sáng kiến:** 14. job handler (**KHÔNG `@Optional()`**) + `closeExpiredTx` + NOTI-035
(RED: J-1..J-5) · 15. `social-ideas.*` + `046` (RED: I-2..I-7).

**Bước 5 — vinh danh (nếu S1-A):** 16. `social-kudos.*` + `047`/`048` (RED: K-4..K-6).

**Bước 6 — NOTI + sổ + đóng WO:**
17. Registrar 3 `registerSource` + 2 `PAYLOAD_KEYS` + 3 `TEMPLATE_KEYS`, **cả ba có `dedupeKeyOf`**
    (RED: N-032, N-032b, N-033, N-035, N-dedupe, N-boot).
18. 🔴 Census 2 tầng — **BỐN việc** (M20), `toBe(39)` → **`toBe(48)`**.
19. 🔴 **Bốn sổ đo RIÊNG, cấm cộng tay** (`route-http-coverage.e2e-spec.ts:349-354`: «BA phép đo, BA câu
    hỏi khác nhau»): (1) `MIN_COVERED_COUNT` ← số spec IN RA · (2) census 2 tầng + `SERVICE_SITE_TO_KEYS` ·
    (3) route-census JSON (regen) · (4) `identity-projection-verdicts` + bump trần basis.
20. `package.json:16` +int-spec; `test:cov:social` với `LANE_DB`.
21. Đồng bộ tài liệu/sổ TRƯỚC gate: API-19 §6.4/§6.6 · SPEC-16 §13.6/§13 (nếu ký) · `harness/backlog.mjs`.
22. `build && typecheck && lint`; `bash harness/check.sh --all` — không banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».
23. 🔴 **TẤT CẢ spec SOCIAL trong MỘT lượt, cùng lane DB** (chạy riêng lẻ từng spec đã từng GIẤU lỗi đỏ-CI).
24. 🔴 **FULL gate TRƯỚC khi mở PR** (+`santa-method` cho `voteTx`/`closeTx`). → PR kèm §2.3 cho owner ký.

---

## §9. Rủi ro → cách chặn

| Rủi ro | Chặn |
| --- | --- |
| 🔴 Nợ (b) xả bằng lập luận «không có route PATCH» | D2 ba vế + P-b/P-b2 (ratchet, không phải ca một lần) |
| 🔴 `option_id` chéo poll ⇒ nhồi phiếu + lệch VĨNH VIỄN | D4 + P-e (assert `vote_count` poll kia không đổi) |
| 🔴 `single_choice` ghi sai ⇒ phiếu đôi lọt IM LẶNG | D3 + P-6 tháo cơ chế đo |
| 🔴 Đổi phiếu không giảm đếm cũ — lệch ở luồng BÌNH THƯỜNG | D5 vế `-1`; P-4 + C-2 |
| 🔴 Ca đua viết «409 HOẶC hội tụ» = deny vacuous | P-5 hai bất biến ĐẾM ĐƯỢC, cấm assert mã HTTP |
| 🔴 Deadlock nâng-cấp-khoá RI → UPDATE `vote_count` (lớp lỗi `035` BE-2A) | D1 neo `FOR UPDATE` serialize mọi writer của cùng poll |
| 🔴 Lộ người bỏ phiếu qua `043` | D14 tập cột tường minh; P-8/P-9 grep + neo dương `voteCount > 0` |
| 🔴 `ERR-018`/`ERR-022`/K2 ép ở Zod ⇒ 400 vô danh | D8; assert MÃ |
| 🔴 `rejected` note khoảng trắng ⇒ 23514 ⇒ 500 | D11 `btrim` ở service; I-3 |
| 🔴 3 `dedupeKeyOf` bị bỏ vì đọc nhầm câu «034 = None» | M40 pin §7.2; N-dedupe |
| 🔴 Census XANH mà không đo route nào | B6.18 bốn việc; `toBe(48)` |
| 🔴 File service đặt trong thư mục con ⇒ census mù | D17 + M21; C-1 |
| Job đóng trùng NOTI với `044` | D13 `WHERE status='open' RETURNING`; J-2/J-3 |
| Mass-assignment qua `.extend()` (tự duyệt / tự đóng poll) | §3.3 |
| `createZodDto` + union ⇒ TS2509 kéo theo sửa route `002` đã ship | D6 |
| `social-posts.service.ts` vượt 800 dòng | Thân 3 loại ở `social-post-types.ts` |
| Mở enum 2→5 làm đỏ spec contracts đang ghim | U4 + B2.11 |
| `MIN_COVERED_COUNT` cộng tay 661+9 trong khi sàn lỏng 10 | M18/M19 + U2 |
| `vote_count` không sổ nào đối soát | S2 + C-2 |
| K1/K2 ép một luật không ai ký | S3 — không ký thì **xoá vế khỏi `done_when`** |
| `@Optional()` theo gợi ý `src` | M48; J-4 AppModule THẬT |

---

## §10. Nợ chuyển tiếp

- **BE-2C**: `feedUserRoomName` + join/leave động · sửa API-19 §7 · ratchet `chat-realtime-structure.spec.ts`.
  ⚠️ Bài poll/kudos/idea `audience='group'` sẽ fan-out qua room nhóm.
- **BE-3**: `049`/`050`/`051` catalog huy hiệu · `052`/`053` thống kê · route khôi phục + recycle-bin
  registry · **throttle `035`** (BE-2A §14.3 S3).
- **FE-2**: (a) DTO thẻ bài có chở chi tiết poll không (U5); (b) `myVote` là mảng; (c) OFFSET (S5).
- **QA-1 S16**: script đối soát — **6 cột** nếu S2-A, 5 + nợ nếu S2-B.
- **Nhánh CHẾT `SOCIAL-ERR-008`**: WO này CÓ mở `superRefine` (D6) nhưng **không gộp** việc dọn nhánh chết
  (đụng contracts dùng chung FE) — giao WO dọn nợ.
- Nợ (g)1-5,7,8 của BE-1B — chưa gán WO.
- Nếu Bước 0 phát hiện **phải** có migration ⇒ **WO DB riêng**.

---

## §11. Tự kiểm `done_when`

| # | `done_when` | Đóng ở | Đo bằng |
| --- | --- | --- | --- |
| 1 | 🔴 Nợ (b) — `closeTx` 2 cột · structure-spec · ca RED | **D2** · B1.6 | **P-b** (`toEqual([])` + neo dương `toBe(1)`) · **P-b2** |
| 2 | 🔴 Nợ (e) | **D4** · B3.12 | **P-e** |
| 3 | 🔴 2–10 → 422 `ERR-018`; K1/K2; `ERR-022` | **D8** · B2.10 | **P-7** · **K-0/K-0b** · **K-1/K-2** (⚠️ **S3**) |
| 4 | 🔴 `voteTx` một tx, Σ đối chứng, 409 `ERR-017` | **D5** · B3.12 | **P-4** · **C-2** · **P-3** |
| 5 | 🔴 Race phiếu đôi = bất biến đếm được | **D1** · B3.12 | **P-5** |
| 6 | `single_choice` đọc trong câu vote | **D3** · B3.12 | **P-3/P-5** + **P-6** |
| 7 | Cổng `open`+`closes_at` · ẩn danh · job idempotent + NOTI-035 · `044` `@Idempotent` | **D1·D13·D14·D12** | **P-1/P-2** · **P-8/P-9** · **J-1..J-5** · **N-035** |
| 8 | FSM 3 cạnh + ma trận + `approve:feed-idea` + `reviewTx` một câu + audit + NOTI-032 | **D10·D11·D16** | **I-1** (16 ô) · **I-2** · **I-4/I-5** · **N-032/032b** |
| 9 | NOTI VERBATIM + dedupe + allow/deny | **§7.2** | **N-032/033/035** · **N-dedupe** · **N-boot** |
| 10 | 4 sổ đo RIÊNG + bump sổ đếm cuối file | **§3.2** · B6.18-19 | **C-1** · **C-3** · **C-4** · **C-5** |
| 11 | Coverage ≥85%; mọi POST `@Idempotent`; DTO `.pick()+.strict()` | **§3.3·D12** | `test:cov:social` (M24); WO có **đúng 1 POST** |

**Điều `done_when` KHÔNG nói mà plan vẫn phải đóng:** cặp quyền theo `type` census không thấy (D7/T1-T3) ·
`body` bắt buộc ở Zod nhưng CHECK cho phép rỗng (D6) · note khoảng trắng ⇒ 500 (D11/I-3) · recipients neo
`employee_id` còn NOTI gửi `user_id` (K-4/N-033) · đua hai người duyệt (I-6) · `MIN_COVERED_COUNT` lỏng 10
(U2) · file phải phẳng (D17/C-1) · `@Optional` sai (J-4) · «API-19 §15» không tồn tại (M50).

---

## §12. Cổng · lệnh · sổ

### 12.1 Bốn sổ

| Sổ | File · dòng | HIỆN TẠI | Đích |
| --- | --- | --- | --- |
| (1) Ratchet test-HTTP | `route-http-coverage.e2e-spec.ts:355` | **661** (BE-2A quên bump) | **số spec IN RA** (dự kiến 680) |
| (2) Census 2 tầng | `social-two-layer-guard-census.unit-spec.ts:34,49,115,233` | 7 · 39 · 39 · `toBe(39)` | 10 · 48 · 48 · `toBe(48)` |
| (3) Route census JSON | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json:7` | `totals.routes = **671**` | **680** (`ROUTE_CENSUS_WRITE=1 … route-guard-coverage.e2e-spec.ts`) |
| (4) Điểm chiếu danh tính | `identity-projection-verdicts.ts` (11 dòng SOCIAL) + `BASIS_CEILINGS:780-832` | `second-assert 11` · `scoped-predicate 24` · … | +dòng `listKudosTx`, bump ĐÚNG basis |

### 12.2 Cổng khác

`social-access.service.ts` 90/90/85 (`vitest.config.ts:144-149`) · `src/social/**` ≥85% · `@Param` không
pipe `toBe(1)` **ĐẲNG THỨC** (`param-uuid-ratchet.unit-spec.ts:199`) · body không validate `toBe(0)` ·
`MAX_UNCOVERED_TOTAL = 0` · file > 800 dòng **không cổng nào ép — tự kiểm**.

### 12.3 ⚠️ `paths` của WO **THIẾU** 4 đường

| Đường | Vì sao | Xử lý |
| --- | --- | --- |
| `apps/api/package.json` | `test:cov:social` (M24) | Thêm vào `paths` cùng PR |
| `docs/_review/**` | Regen route-census JSON | Thêm vào `paths` |
| `docs/API Design/**` | D12 (§6.6) + S5 (§6.4) | Thêm vào `paths` |
| `docs/SPEC/**` | S2/S3 nếu ký | Thêm vào `paths` |

### 12.4 Lệnh đóng WO

```bash
export APP_DB_PASSWORD="$(sed -n 's/^APP_DB_PASSWORD=//p' .env)" WORKER_DB_PASSWORD="$(sed -n 's/^WORKER_DB_PASSWORD=//p' .env)" SUPERUSER_DB_PASSWORD="$(sed -n 's/^SUPERUSER_DB_PASSWORD=//p' .env)" LANE_DB=mediaos_be2b && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && pnpm --filter @mediaos/api exec vitest run src/social test/integration/social-*.int-spec.ts test/foundation/social-*.unit-spec.ts
bash harness/check.sh --all
```

---

## §13. Sổ vết THI CÔNG — *(để trống)*

> Ghi **mọi chỗ code khác plan**, kèm lý do ĐO ĐƯỢC. Tiền lệ: câu «T2» ở §13 của BE-2A viết sai thực tế,
> chỉ bị bắt ở FULL gate — owner suýt ký một mô tả rủi ro sai.

| # | Điểm | Quyết định thi công | Vì sao (đo được) |
| --- | --- | --- | --- |
| T1 | | | |
| T2 | | | |

### Phép ĐO CỔNG (tháo lưới, xác minh ca tương ứng ĐỎ, khôi phục)

| Tháo gì | Test kỳ vọng ĐỎ | Thông điệp thực tế |
| --- | --- | --- |
| Bỏ vế `-1` trong `voteTx` | **P-4** · **C-2** | |
| Ghi cứng `single_choice = false` | **P-3**/**P-5** | |
| Bỏ kiểm `optionId ∈ pollId` | **P-e** | |
| Bỏ `reviewedAt` khỏi `reviewTx` | **I-5** (23514) | |
| Thêm site ghi `multipleChoice` ngoài `createPollTx` | **P-b** | |
| Bỏ `dedupeKeyOf` một mã NOTI | **N-dedupe** | |
| Bỏ tên controller khỏi `SOCIAL_CONTROLLERS` | **C-1** (XANH = census fail-open) | |

### Kết quả U1..U5

| # | Câu hỏi | Kết quả đo | Hệ quả |
| --- | --- | --- | --- |
| U1 | `record()` nhận `actorUserId: null`? | | |
| U2 | `coveredCount` thật | | |
| U3 | `040/045/047` tái dùng `listFeed`? | | |
| U4 | Spec contracts nào đỏ khi mở enum? | | |
| U5 | DTO thẻ bài có nới không? | | |

---

## §14. Sổ vết FULL GATE — *(để trống; chạy TRƯỚC khi mở PR)*

`security-reviewer` · `database-reviewer` · `silent-failure-hunter` ĐỘC LẬP trên diff
`5f8434c0..<HEAD>` (+ `santa-method` cho `voteTx`/`closeTx`).

> **Nhắc:** reviewer có thể **hội tụ vào cùng một lỗi thật** (tín hiệu MẠNH) **và** có thể **cùng kết luận
> sai** (`database-reviewer` từng khẳng định «không có deadlock» ở đúng chỗ có deadlock, vì bỏ qua khoá
> ngầm RI yếu hơn khoá câu sau đòi — đúng lớp rủi ro của **D1**). Kiểm chứng lại mọi finding nặng.

### 14.1 Điểm HỘI TỤ — *(để trống)*

### 14.2 Đã vá trong lượt gate

| Nguồn | Sev | Vá |
| --- | --- | --- |

### 14.3 Cần chữ ký owner

| # | Việc | Trạng thái |
| --- | --- | --- |
| S1 | Ranh giới `047`/`048` ↔ BE-3 | ⏳ |
| S2 | `vote_count` vào script đối soát + SPEC §13.6 thành 6 cột | ⏳ |
| S3 | K1/K2 — luật không có nguồn SPEC | ⏳ |
| S4 | Actor audit của job (phụ thuộc U1) | ⏳ |
| S5 | Phân trang OFFSET cho `040`/`045`/`047` | ⏳ |

### 14.4 Ghi nhận — không phải finding — *(để trống)*

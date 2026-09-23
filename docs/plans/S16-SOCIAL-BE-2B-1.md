# Plan S16-SOCIAL-BE-2B-1 — BÌNH CHỌN (`SOCIAL-API-040..044` + nhánh `type='poll'` của `002` + system-job đóng poll)

> 🔴 **Crown.** Ba thứ crown chồng lên nhau: (1) **đường UPDATE ĐẦU TIÊN vào `feed_polls`** — schema ghi
> thẳng «service PHẢI chặn UPDATE» (`db/schema/social.ts:596-600`) và tới hôm nay chưa call-site nào chứng
> minh được điều đó; (2) **bộ đếm `feed_poll_options.vote_count`** có `CHECK >= 0` nhưng KHÔNG nằm trong
> 5 cột của SPEC-16 §13.6 ⇒ không sổ đối soát nào nhìn nó; (3) **poll ẩn danh** —
> `feed_poll_votes.user_id` LUÔN được lưu, và DTO là thứ duy nhất ngăn nó đi ra.
>
> **Lịch sử tách:** WO `S16-SOCIAL-BE-2` → (22/09) BE-2A · BE-2B · BE-2C → (**23/09, owner chốt sau khi
> `plan-reviewer` BLOCK lần hai**) BE-2B tách tiếp thành **BE-2B-1 (bình chọn — WO này)** và
> **BE-2B-2 (sáng kiến + vinh danh)**. Lý do tách: 3 hệ con crown độc lập + 1 job + ~2000 dòng qua MỘT
> lượt FULL gate, trong khi BE-2A với diff NHỎ HƠN vẫn ra 5 finding.
>
> **Nối tiếp BE-2A (`5f8434c0`), KHÔNG song song** — cùng chạm `social-posts.service.ts#create` ·
> `social-route-pairs.const.ts` · `social.errors.ts` · `social.module.ts`.
>
> **Nguồn sự thật:** SPEC-16 §12 · §13.4 · §13.6 · SOC-DEC-009 · API-19 §5.1b · §5.1d · §6.3 · §6.6 ·
> DB-17 §4 (dòng 121) · §7.3-§7.5 · [DB-2](S16-SOCIAL-DB-2.md) §10 · [BE-2A](S16-SOCIAL-BE-2A.md) §13/§14.
>
> **Khuôn:** `social-reports.repository.ts#resolveReport` (UPDATE cặp vết MỘT câu + `WHERE` điều kiện +
> `RETURNING`) · `social-group-access.service.ts#lockGroupRowTx` (neo `FOR UPDATE`) ·
> `social-counters.ts#bumpGroupMemberCount` (`UPDATE x = x + delta … RETURNING`, ném khi 0 dòng) ·
> `scheduler/job-handler.ts` (`@SystemJobHandler`) · `social-news-noti-cap.spec.ts` (unit + `fakeTx()`) ·
> `realtime/chat-realtime-structure.spec.ts` (structure-spec có `stripComments`).

---

## §0. Phạm vi & nợ

### 0.1 Trong phạm vi — **5 route + 1 nhánh `type` + 1 job**

`040` `GET /social/polls` · `041` `PUT /social/posts/{post_id}/poll/vote` · `042` `DELETE …/poll/vote` ·
`043` `GET …/poll/results` · `044` `POST …/poll/close`
**+ nhánh `type='poll'` của `002`** · **+ system-job đóng poll theo hạn** (API-19 §5.1d — KHÔNG phải route HTTP).

**KHÔNG thuộc WO này:** `002/idea` · `002/kudos` · `045..048` → **BE-2B-2** · `049..053` → BE-3 ·
room WS `feedgroup` → BE-2C.

### 0.2 Nợ mang sang

| Nợ | Nội dung | Xử lý |
| --- | --- | --- |
| **(b) DB-2** 🔴 | `multiple_choice`/`is_anonymous` BẤT BIẾN sau khi tạo | **Đóng ở đây** — D2 ba vế |
| **(e) DB-2** 🔴 | `option_id` phải thuộc đúng `poll_id` — hai FK RỜI | **Đóng ở đây** — D4 |
| **(f) DB-2** | DTO `.pick()+.strict()`, cấm `.extend()` | Luật của WO — §3.3 |
| BE-2A §10 | `vote_count` ngoài 5 cột §13.6 | **Chữ ký S2** |
| BE-2A §14.3 S3 | `035` xin lại vô hạn | Giao BE-3 |
| (c)/(d) DB-2 | NOTI-034 · `childTables` | Thuộc BE-2A, đã đóng — không mở lại |

### 0.3 🔴 Ngoại lệ BẤT BIẾN #2 (không hard-delete) — **PHẢI trích trong PR**

`0580:549` `GRANT SELECT, INSERT, DELETE ON feed_poll_votes` — **DELETE CỨNG có chủ đích**, ngoại lệ đã ký
ở **DB-17 §4 bảng dòng 121** («đổi/rút phiếu khi poll còn `open`»). Không trích ⇒ reviewer FULL gate sẽ
đòi «sửa thành soft-delete» (tiền lệ BE-2A). Đã kiểm: cả 9 bảng Track B **đã** nằm trong
`retention.service.ts:191-199` `PROTECTED_TABLES` ⇒ GRANT DELETE không tạo lỗ retention.

---

## §1. Bảng ĐO TRƯỚC

> Mọi ô dưới đây đã đo trên `feat/s16-social-be-2b` (23/09/2026) và **đã qua `plan-reviewer` xác minh
> ĐỘC LẬP** — cột cuối ghi kết quả đối chứng. Ô nào reviewer không mở được thì đánh **⚠️ chưa đối chứng**.
> Bài học §13/§14 của BE-2A: một câu khẳng định sai trong bảng đo đắt hơn một ô trống.

### 1.a Nền — mã lỗi · route

| # | Câu hỏi | Kết quả THỰC TẾ | Hệ quả | Đối chứng |
| --- | --- | --- | --- | --- |
| **M1** | Head migration? | `0585` (idx 252). `0580..0583` = DB-2; `0584/0585` = BE-1B | §6: WO này **KHÔNG có migration** | ✅ |
| **M2** | Route đã build? | `social-two-layer-guard-census.unit-spec.ts:48,233` — `001..039`, `toBe(39)` | +5 ⇒ **`toBe(44)`** | ✅ |
| **M3** | `SOCIAL_ROUTE_PAIRS`? | `social-route-pairs.const.ts:90-95,103-207` — 39 khoá; `pair(action, resourceType, tier1IsFloor=false, companyFloor=true)`; khoá cuối `groupMemberRemove:206` | +5 khoá khối additive | ✅ |
| **M4** 🔴 | `SOCIAL-ERR-016..018` đã khai chưa? | **CHƯA.** File khai `001..015` + `021` + 3 hằng KHÔNG SỐ (`REPORT_DUPLICATE_OPEN:110` · `GROUP_NAME_TAKEN:164` · `GROUP_MEMBER_NOT_FOUND:175`). Header `:20-21`: *«`012..020`,`022` thuộc `S16-SOCIAL-BE-2`»* | **KHÔNG phải bịa hằng có tên cho nhánh chính** — `016/017/018` là của chính WO này. Câu «catalog đã cạn» của BE-2A nghĩa là *không còn số TRỐNG cho ca MỚI* | ✅ reviewer xác nhận, + `GROUP_NAME_TAKEN:155-157` tự ghi «`022` = huy hiệu, thuộc BE-2B» |
| **M5** | Nghĩa 3 mã theo SPEC-16 §12 (`:326-332`) | `016` 409 poll `closed`/quá hạn · `017` 409 phiếu đôi poll một-lựa-chọn · `018` 422 ngoài 2–10 lựa chọn | Ánh xạ 1-1, **không nới nghĩa** | ⚠️ chưa đối chứng trực tiếp (reviewer xác minh gián tiếp qua `API-19:139-141`) |
| **M6** | Ca nào SPEC im lặng? | `option_id` không thuộc poll | Hằng CÓ TÊN `POLL_OPTION_NOT_FOUND` (tiền lệ `GROUP_NAME_TAKEN`) | ✅ |

### 1.b Schema (mig `0580`, `db/schema/social.ts`)

| # | Câu hỏi | Kết quả THỰC TẾ | Hệ quả | Đối chứng |
| --- | --- | --- | --- | --- |
| **M7** | `feed_polls`? | `:584-621` — `id·company_id·post_id·question(500)·multiple_choice·is_anonymous·status(16, default 'open')·closes_at·closed_at·created_at·updated_at`. CHECK `chk_feed_polls_status` · `chk_feed_polls_closed_pair` (`status='open' OR closed_at IS NOT NULL`) · `chk_feed_polls_closes_future`. UNIQUE `feed_polls_company_post_uq`·`feed_polls_company_id_id_uq` | `closeTx` **phải ghi `closed_at` cùng lúc** `status='closed'`, thiếu ⇒ `23514` ⇒ 500 | ✅ |
| **M8** 🔴 | Comment «service PHẢI chặn UPDATE» nguyên văn? | `:596-600` — `multipleChoice`: *«⚠️ BẤT BIẾN sau khi tạo — service PHẢI chặn UPDATE (D1): đổi giữa chừng làm chốt `feed_poll_votes_single_uq` sai lệch IM LẶNG (partial index không đọc được bảng khác)»*; `isAnonymous`: *«BẤT BIẾN sau khi tạo — như trên»* | Nợ (b) **KHÔNG xả được** bằng «không có route PATCH» | ✅ nguyên văn |
| **M9** 🔴 | Index job quét qua? | `:617-619` `idx_feed_polls_open_deadline (company_id, closes_at) WHERE status='open' AND closes_at IS NOT NULL` | `closeExpiredTx` giữ **đúng hình dạng vị từ này** | ✅ |
| **M10** | `feed_poll_options`? | `:629-652` — `id·company_id·poll_id·label(255)·position(smallint)·vote_count(int default 0)`. CHECK `chk_feed_poll_options_vote_count (>= 0)`. UNIQUE `…_company_id_id_uq` · **`feed_poll_options_position_uq (company_id, poll_id, position)`** | Lệch âm ⇒ `23514` ⇒ **500**; `position` sinh `0..n-1` | ✅ |
| **M11** 🔴 | Khoá của `feed_poll_votes`? | `:660-695` — PK **`feed_poll_votes_pk (company_id, poll_id, option_id, user_id)`** · partial unique **`feed_poll_votes_single_uq (company_id, poll_id, user_id) WHERE single_choice`** · index `idx_feed_poll_votes_company_poll_user` | 🔴 **HAI chốt, HAI nhánh lỗi khác nhau** — xem D5b/P-5 | ✅ PK `:683-686` |
| **M12** 🔴 | `single_choice` có DEFAULT? | `:676-679` + `DB-17:623,629` — **KHÔNG**, cố ý. `DEFAULT false` biến một lần quên ghi thành vô hiệu hoá chốt chống-phiếu-đôi IM LẶNG | Mọi INSERT (kể cả fixture) truyền tường minh | ✅ |
| **M13** 🔴 | FK nối `option_id` ↔ `poll_id`? (nợ (e)) | `0580:416-422` — **KHÔNG.** Hai FK RỜI: `…poll_tenant_fk (company_id, poll_id)` và `…option_tenant_fk (company_id, option_id) ON DELETE NO ACTION` | Gửi `optionId` chéo poll vẫn INSERT được | ✅ |
| **M16** | Quyền app role? | `0580:541-559` — `feed_poll_options`: `SELECT, INSERT, UPDATE` · **`feed_poll_votes`: `SELECT, INSERT, DELETE`** (KHÔNG UPDATE) · `feed_polls`: có `UPDATE` | Đổi/rút phiếu = **DELETE + INSERT**. Job UPDATE được bằng role app | ✅ (plan cũ ghi `:545-557`, **trôi dòng**) |
| **M17** | `chk_feed_posts_body_required`? | `:154-157` `type IN ('poll','kudos') OR (body IS NOT NULL AND length(btrim(body)) > 0)` | `poll` được phép `body = NULL` ⇒ DTO phải cho phép | ✅ |

### 1.c Sổ · ratchet · cổng — **ĐO RIÊNG TỪNG CÁI**

| # | Sổ | Giá trị HIỆN TẠI | Hệ quả | Đối chứng |
| --- | --- | --- | --- | --- |
| **M18** 🔴 | `MIN_COVERED_COUNT` — `route-http-coverage.e2e-spec.ts:355` | **`661`**; comment cuối `:347-348` = «BE-1B: 651 → 661». **BE-2A thêm 10 route mà KHÔNG bump** | `MAX_UNCOVERED_TOTAL = 0` (`:324`) được assert **cứng** (`:442`) ⇒ `coveredCount == routes.length` ⇒ sàn đang **LỎNG đúng 10**. **Cấm cộng tay `661+5`** — đặt = SỐ SPEC IN RA | ✅ reviewer: «không có cách giải thích thay thế nào cứu được» |
| **M19** | Route census JSON — `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json:6-14` | `totals.routes = 671`, `gated 632`, `GAP 0`. Regen: `ROUTE_CENSUS_WRITE=1 … route-guard-coverage.e2e-spec.ts` | Sau WO: **676** (đo lại, đừng gõ mò) | ✅ |
| **M20** 🔴 | Census 2 tầng — **BỐN chỗ** | (i) `SOCIAL_CONTROLLERS` `:34-46`, **7 tên — ALLOWLIST**, comment `:42-44` tự cảnh báo *«quên thêm ⇒ route VÔ HÌNH, cả 4 assert vẫn XANH»* · (ii) `ROUTE_TO_KEY` `:49-107` · (iii) **`SERVICE_SITE_TO_KEYS`** `:115-159` (tên thật) · (iv) `toBe(39)` `:233` | Thiếu một là **fail-OPEN IM LẶNG** | ✅ |
| **M21** 🔴 | Census quét thư mục ra sao? | `:164` và `:192` đều `fs.readdirSync(SRC_SOCIAL)` — **PHẲNG, KHÔNG đệ quy** | 🔴 **File service mới PHẢI nằm phẳng** trong `apps/api/src/social/` | ✅ |
| **M22** | `identity-projection-verdicts` | SOCIAL **11 dòng**; 9 basis, 4 trong đó «không đo được bằng máy» (`:20-37`) | WO này **không** thêm điểm chiếu danh tính (`040`/`043` không trả tên người) — xác minh lại ở Bước 6 | ⚠️ giá trị từng trần `BASIS_CEILINGS:780-832` **chưa đối chứng** |
| **M23/M15b** 🔴 | Cổng coverage THẬT | `vitest.config.ts:141-143` nguyên văn: *«cổng coverage THẬT **duy nhất** của module (không có cơ chế per-directory — `test:cov:social` chỉ ĐO, không gate)»*; `:144-149` `social-access.service.ts` 90/90/85 | 🔴 **`src/social/** ≥85%` KHÔNG PHẢI CỔNG** — nó chỉ được ĐO. Xếp vào nhóm tự-kiểm cùng trần 800 dòng | ✅ (sửa lỗi plan cũ gọi nó là cổng) |
| **M24** | `test:cov:social` gồm gì? | `apps/api/package.json:16` — `src/social` + census unit-spec + **10 int-spec liệt kê TỪNG CÁI** (4 BE-1 · 3 BE-1B · 3 BE-2A) | Int-spec mới ở `test/integration/**` **phải THÊM TAY** | ✅ (plan cũ ghi «11» — **SAI**, đã sửa) |
| **M25** | Ratchet `@Param` | `param-uuid-ratchet.unit-spec.ts:67` `UNPIPED_CEILING = 1`, assert **ĐẲNG THỨC** `:199`. `PARAM_UUID_MEASURED_FILES` **không có controller SOCIAL** | Mọi `@Param` mới **BẮT BUỘC** `ParseUUIDPipe`; không phải ký verdict | ✅ |
| **M26** | Ratchet body-validation | `body-validation-ratchet.unit-spec.ts:53` `toBe(0)` | `041`/`044` phải validate body ở biên | ⚠️ chưa đối chứng |

### 1.d Cái sẽ TÁI DÙNG

| # | Kết quả THỰC TẾ | Hệ quả | Đối chứng |
| --- | --- | --- | --- |
| **M27** 🔴 | `social-access.service.ts:79-91` — `resolveActor` batch **4 cặp**: `[0]` cặp route · `[1]` `manage:feed-post` · `[2]` `manage:feed-news` · `[3]` `manage:feed-group`. Bẫy `:87-89`: **cấm thêm cặp vốn ĐÃ là cặp của một route** | `create:feed-poll` resolve trong `create()`, **không** vào batch — D7 | ✅ |
| **M28** | `:101-105` `companyFloor` → 403 `AUTH-ERR-SCOPE-DENIED`; `:122-125` cờ dùng `isCompany()` để `undefined` **fail-closed** | Cờ mới bắt buộc qua `isCompany(...)`, **TUYỆT ĐỐI KHÔNG `!== null`** | ✅ |
| **M29** 🔴 | `0578:75-86` — `create:feed-poll` cấp @`Company` cho **CẢ 4 vai canonical** | 🔴 **KHÔNG vai nào dựng được ca DENY theo vai** ⇒ lưới cho D7 phải là **assert CẤU TRÚC**, không phải ca quyền — xem D19/C-6 | ✅ |
| **M30** | `social-route-pairs.const.ts:220-226` `SOCIAL_POST_TYPE_PAIRS` — **2 khoá**: `share: null` · `news: {manage, feed-news}`. Test đẳng thức tập `tier1IsFloor===true` ở **`:306-330`** của census spec | +1 khoá `poll`. Giữ `postCreate.tier1IsFloor = true` | ✅ (plan cũ ghi `:185-186` — **trôi dòng**, chỗ đó là cuối `serviceResolveActorCalls()`) |
| **M31** 🔴 | `contracts/social-api.ts:82` `feedCreatableTypeSchema = z.enum(["share","news"])`; `:312-372` object `.strict().superRefine()`; `:318` `body: feedBody()` = `z.string().trim().min(1)` — **BẮT BUỘC** | (a) enum **2 → 3** (`+poll`; BE-2B-2 mở tiếp 3→5); (b) `body` tuỳ chọn cho `poll` **mà không nới cho `share`/`news`** ⇒ `superRefine` | ✅ |
| **M32** 🔴 | `social.dto.ts:39` `createZodDto(createFeedPostSchema)`; tiền lệ `:62-74` — schema UNION làm `createZodDto` ném **TS2509** | **CẤM** biến `createFeedPostSchema` thành discriminated union | ✅ |
| **M33** | `contracts/social.ts:292-372` có `feedPollCoreSchema`; **KHÔNG có** `feedPollOptionCoreSchema`. Cảnh báo mass-assignment `:278-286` | DTO option **tự dựng**; DTO poll `.pick()` rồi `.strict()` | ⚠️ chưa đối chứng |
| **M34** | `social-reports.repository.ts:351-376` — `.set({…}).where(and(id, companyId, eq(status,'open'))).returning({id})`, trả `updated.length > 0`; caller 409 khi `false` (`social-reports.service.ts:140`) | Khuôn CHÍNH XÁC cho `closeTx` | ✅ |
| **M36** | `social-group-access.service.ts:145-151` `lockGroupRowTx` = `SELECT 1 … FOR UPDATE` | Sao nguyên hình dạng cho `lockPollRowTx` | ✅ |
| **M37** | `social-counters.ts:40` `bumpPostCounter` · `:285` `bumpGroupMemberCount` — `UPDATE … SET x = x + delta … RETURNING`, **ném khi 0 dòng `:292-306`**, cấm `Math.max` ở JS (`:14`, `:274`) | `bumpPollOptionVotes` theo đúng khuôn, **append** cùng file | ✅ (plan cũ ghi `:305-307` — trôi dòng) |
| **M38** | `social-news-noti-cap.spec.ts:35-48` (service với `null as never`) · `:60-69` `fakeTx()` | Ca FSM/2–10/structure chạy **không cần `LANE_DB`** | ⚠️ chưa đối chứng |
| **M39** | `realtime/chat-realtime-structure.spec.ts:2-4`, **`stripComments` ở `:25`** | 🔴 Structure-spec nợ (b) **PHẢI** strip comment, nếu không chính docblock `social.ts:596-600` làm nó đỏ oan | ⚠️ chưa đối chứng |

### 1.e NOTI

| # | Kết quả THỰC TẾ | Hệ quả | Đối chứng |
| --- | --- | --- | --- |
| **M40** 🔴 | `0581` verify-block `:332-335`: **`SOCIAL_POLL_CLOSED`** — `Low`, **`DedupeKey`**, **`is_system_event = true`**. Dòng `:334` là `SOCIAL_GROUP_JOIN_DECIDED = 'None'` | 🔴 **`DedupeKey` ⇒ BẮT BUỘC `dedupeKeyOf`** (`registrar:133-135` + `:82`: bỏ trống ⇒ fallback `ctx.eventId` LUÔN khác nhau ⇒ dedupe biến mất CÂM). ⚠️ Câu «`034` dedupe None» của backlog cũ là nói về **`SOCIAL_GROUP_JOIN_DECIDED` của BE-2A** — reviewer đã xác nhận bằng chính dòng `:334` | ✅ |
| **M41** | `0581:262-267` `POLL_CLOSED` `variables_schema` = `{"poll_question":"string","post_id":"uuid"}`; comment `:261` «KHÔNG biến nào lộ người bỏ phiếu» | `TEMPLATE_KEYS` +1 dòng ĐÚNG hai khoá này. `requireField` NÉM khi thiếu | ✅ |
| **M42** | `social-noti-bridge.registrar.ts:19-37` `PAYLOAD_KEYS` — 12 khoá, **thiếu `poll_question`** | +1 khoá (append) | ✅ |
| **M43** | `social-noti.payload.ts:30/:87/:180` — ba bảng `SOCIAL_EVENT_CODES`/`_B`/`_C` | Thêm bảng thứ TƯ `_D`, **không sửa 3 bảng cũ** | ⚠️ chưa đối chứng |
| **M44** 🔴 | `db/schema/audit.ts:415-418,438` — có `feed_post`·`feed_comment`·`feed_group`·`feed_report`·`feed_kudos_badge`, **KHÔNG có `feed_poll`**; `0583:14-15` ghi CHỦ Ý | Audit `044` ghi `object_type='feed_post'`, `object_id = postId`. **KHÔNG migration audit** | ✅ |
| **M45** | `social-groups.service.ts:539-549` `audit.record(tx, {…, actorUserId, …})`; `audit.service.ts:238` đọc `row.actorUserId ?? null` ⇒ **cột nullable** | **CHƯA ĐO kiểu TS** — **U1** | ⚠️ |

### 1.f Job

| # | Kết quả THỰC TẾ | Hệ quả | Đối chứng |
| --- | --- | --- | --- |
| **M46** | `scheduler/job-handler.ts:50-53` `{jobCode, run(ctx)}`; `:23-32` `JobRunContext = {companyId, today?}` — **KHÔNG có `tx`**; `:19-22` handler **TỰ mở `withTenant`**; `:38-43` `JobRunResult = {total, success, failed, metadata?}` | Handler tự `withTenant(ctx.companyId, …)` | ✅ |
| **M47** | `worker-scheduler.service.ts:100-115` DiscoveryService gom provider có metadata `SYSTEM_JOB_HANDLER`, dedup theo `jobCode`. `system_job_locks.job_code` `varchar(100)` **PK, KHÔNG CHECK enum** | Chỉ cần class + decorator + `providers`. **KHÔNG seed/catalog/migration** | ✅ (+ reviewer đo thêm: `system_job_runs.job_code` cũng không CHECK) |
| **M47b** 🔴 | **Reviewer đo bổ sung:** job chạy bằng role **`mediaos_app`** (`DatabaseService.withTenant` → pool app), KHÔNG phải `mediaos_worker`; `0580:541` đã cấp `UPDATE ON feed_polls` cho app; `API-19:166` ghi thẳng «**Không** cấp thêm quyền ghi cho `mediaos_worker`» | ⇒ job UPDATE được, **không cần GRANT mới** | ✅ |
| **M48** 🔴 | `chat-call-ringing-timeout.job-handler.ts:33-39`: *«Gắn `@Optional()` cho một provider CÓ THẬT sẽ biến lỗi wiring thành `undefined` im lặng»*; `room-booking-reminder.job-handler.ts:48` tương tự | 🔴 **Gợi ý `@Optional` trong `src` backlog (`:17123`) SAI với ca này.** ⚠️ Reviewer lưu ý: docblock đó nói `@Optional` chỉ áp cho tham số **KHÔNG phải provider** (`workerDb: Database`) ⇒ plan phải ghi **chữ ký constructor** của job mới (chỉ `DatabaseService` + service SOCIAL) để kết luận có căn cứ, không chỉ theo tiền lệ | ✅ |
| **M49** | `worker-scheduler.service.ts:60-65` tắt khi `NODE_ENV='test'` | Job **không chạy trong test** ⇒ ca test gọi thẳng `handler.run({companyId})` | ✅ (plan cũ ghi `:37` — trôi dòng) |

### 1.g Tài liệu LỆCH thực tế — sửa CÙNG PR

| # | Khẳng định | Đo được | Xử lý |
| --- | --- | --- | --- |
| **M51** | `done_when` cũ: «`044` có `@Idempotent`» | `API-19 §6.6:263` liệt `002`·`015`·`027`·`031`·`049` — **KHÔNG có `044`**; `:267` ghi `PUT …/poll/vote` idempotent **theo bản chất** | Theo backlog (có decorator) + **sửa API-19 §6.6**. Khoá **suy từ nội dung** (`API-19:265` + memory `idempotency-key-must-be-content-derived`): đề xuất `close:{postId}` |
| **M54** 🔴 | Plan cũ trích «luật ép-ở-service ở `social-access.service.ts:392-394`» | **TRÍCH SAI CHỖ.** `:392-394` thật ra viết: *«Thiếu `groupId` KHÔNG tới được đây: `createFeedPostSchema.superRefine` chặn từ Zod ⇒ **400** … vế `AUDIENCE_KEY_MISSING` là **nhánh chết** … **đừng viết ca test kỳ vọng 422 ở đó**»* | Nguồn ĐÚNG: **`packages/contracts/src/social-api.ts:309-310`**. 🔴 Và đoạn bị trích nhầm mang **cảnh báo ngược chiều**: nếu ai thêm `.min(2).max(10)` vào Zod thì **P-7 chuyển sang 400 và ca 422 CHẾT** — ghi cảnh báo tại chỗ |
| **M55** | API-19 §5.1b (`:139-141`) ghi cặp của `poll` là **chỉ** `create:feed-poll` | Hiện thực đòi **cả** `create:feed-post` (tầng-1 sàn — `social-route-pairs.const.ts:108` `postCreate: pair("create","feed-post", true)`) | Hôm nay không quan sát được (0578 cấp cả hai cho cả 4 vai) nhưng là lệch doc↔code ⇒ sửa §5.1b thành «`create:feed-post` ＋ `create:feed-poll`» |

### 1.h CHƯA ĐO — đo TRƯỚC khi code

| # | Việc | Đo khi nào |
| --- | --- | --- |
| **U1** | `AuditService.record` có nhận `actorUserId: null` không (M45) — **S4 treo vào đây**; không cho `null` ⇒ **DỪNG hỏi owner**, KHÔNG tự dựng user ảo | Bước 0 |
| **U2** | `coveredCount` thật sau +5 route. **Bằng chứng bắt buộc:** dán dòng console nguyên văn `[S10-QA-ROUTEHTTP-1] Route HTTP coverage: X/Y` vào §13 | Bước 6 |
| **U2b** | `uncovered == 0` HÔM NAY (tiền đề của «sàn lỏng 10») — chỉ chứng minh được bằng cách CHẠY spec với `LANE_DB` | Bước 0 |
| **U3** | `040` đi qua `listFeed` hay câu riêng (`listFeed` phục vụ 5 route, `groupScope` BẮT BUỘC) | Bước 0/3 |
| **U4** | Spec contracts nào ghim `feedCreatableTypeSchema` 2 giá trị | Bước 0 |
| **U5** | `feedPostSchema` có chỗ chở chi tiết poll không (API-19 §6.1 `:184-207` không có) | Bước 0; nới thì ghi §13 + báo FE-2 |

---

## §2. Quyết định

| # | Quyết định | Nội dung | Căn cứ |
| --- | --- | --- | --- |
| **D1** 🔴 | **Neo khoá cho mọi đường ghi đi qua MỘT HÀNG POLL CỤ THỂ** | `lockPollRowTx(tx, companyId, pollId)` = `SELECT 1 FROM feed_polls WHERE company_id=$ AND id=$ FOR UPDATE`, gọi **đầu tiên** trong `voteTx` · `withdrawVoteTx` · `closeTx` **của `044`**. 🔴 **JOB KHÔNG NEO** — nó set-based một câu (D13), thêm lock sẽ phá hình dạng vị từ của `idx_feed_polls_open_deadline` (M9); an toàn vì chỉ chạm `feed_polls` và PG **re-check `WHERE`** sau khi chờ khoá ở READ COMMITTED. Ba lý do cần neo: (i) TOCTOU — đọc `status`/`closes_at` rồi INSERT, một `044` song song đóng poll giữa hai câu ⇒ phiếu rơi vào poll đã đóng; (ii) biến ca đua thành bất biến ĐẾM ĐƯỢC; (iii) chống **deadlock nâng-cấp-khoá**: INSERT `feed_poll_votes` lấy `FOR KEY SHARE` trên hàng `feed_poll_options` (RI), rồi `bumpPollOptionVotes` đòi khoá GHI trên chính hàng đó — đúng lớp lỗi `035` mà FULL gate BE-2A bắt | M36; BE-2A §14.2 |
| **D1b** 🔴 | **Chân trụ của chứng minh — phải viết thành một dòng ĐO ĐƯỢC** | **D9 ⇒ KHÔNG writer nào khác chạm `feed_poll_options`** ⇒ hai tx cùng UPDATE một hàng option **bắt buộc** đã tuần tự hoá trên hàng `feed_polls` trước đó (nhờ D4 bảo đảm `option ∈ poll`) ⇒ **thứ tự khoá toàn hệ là DUY NHẤT `feed_polls → feed_poll_options`**. Không tạo deadlock MỚI: `bumpPostCounter` chạm `feed_posts` (vote không khoá `feed_posts`; `FOR UPDATE` trên con không khoá cha; `UPDATE feed_polls` không đổi cột FK nên không re-check RI); job chỉ chạm `feed_polls` | reviewer xác nhận lập luận ĐÚNG, nhưng đòi viết ra |
| **D2** 🔴 | **Nợ (b) — ba vế** | (a) `closeTx` UPDATE **tường minh ĐÚNG 2 cột** `status`+`closedAt` (+`updatedAt`), **CẤM mapped-write** (drizzle **bỏ qua im lặng** khoá không phải cột — `payroll-fsm.ts:37-38`); (b) **structure-spec** (M39, **có `stripComments`**): không site nào trong `src/social/**` ghi `multipleChoice`/`isAnonymous` **ngoài `createPollTx`** — `toEqual([])` **KÈM neo dương `toBe(1)`**; (c) ca RED cho chính spec đó. Lý lẽ «không có route PATCH nên tự động đúng» **BỊ CẤM** | M8 |
| **D3** 🔴 | **`single_choice` đọc từ `feed_polls` NGAY TRONG câu INSERT** | `INSERT … SELECT …, NOT p.multiple_choice FROM feed_polls p WHERE …` — không đọc ra JS rồi ghi lại. Quên ⇒ `23502` (ồn ào); ghi SAI ⇒ partial index không áp, **phiếu đôi lọt IM LẶNG** | M12; DB-17 `:629` |
| **D4** 🔴 | **Nợ (e) — `optionId ∈ pollId` cùng TX, TRƯỚC mỗi INSERT** | `SELECT id FROM feed_poll_options WHERE company_id=$ AND poll_id=$ AND id = ANY($ids)` ⇒ số hàng **BẰNG** số `optionId` distinct, nếu không ⇒ **404 `POLL_OPTION_NOT_FOUND`**. 404 chứ không 422: option của poll khác là đối tượng actor không được biết tồn tại | M13 |
| **D5** 🔴 | **`voteTx` một tx, bù trừ ĐỐI XỨNG** | `lockPollRowTx` → đọc poll → cổng `open`+`closes_at` → D4 → `DELETE … RETURNING option_id` → **`-1` cho MỌI option vừa xoá** → `INSERT` (D3) → **`+1`**. Cấm bỏ vế `-1`: lệch ngay ở luồng **đổi phiếu BÌNH THƯỜNG** | M11; M16 |
| **D5b** 🔴 | **HAI chốt DB ⇒ HAI đường dịch lỗi** | `SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ` = `feed_poll_votes_single_uq` → **409 `ERR-017`**. **VÀ** `POLL_VOTE_PK` = `feed_poll_votes_pk` → cũng 409 `ERR-017` (cùng nghĩa người dùng: «bạn đã bỏ phiếu cho lựa chọn này»). Không khai vế PK ⇒ hai lượt vote **cùng option** đồng thời trả **500 chưa dịch** mà ca đua vẫn XANH | reviewer B2; M11 |
| **D6** 🔴 | **`createFeedPostSchema` GIỮ object phẳng `.strict()` + `superRefine`** | Enum **2→3** (`share,news,poll`); thêm `poll?: {question, options[], multipleChoice?, isAnonymous?, closesAt?}`; `superRefine` ép: `poll` cấm xuất hiện ở type khác, `body` bắt buộc cho `share`/`news` và tuỳ chọn cho `poll`. **CẤM** discriminated union (TS2509 — M32). 🔴 **KHÔNG** đặt `.min(2).max(10)` ở Zod — xem M54 | M31; M32; M17 |
| **D7** | **Cặp quyền theo `type` — resolve TRONG `create()`, KHÔNG nhét vào batch** | `SOCIAL_POST_TYPE_PAIRS` +`poll`; `create()` sau khi biết `dto.type` gọi **một** `resolveManyOrNull` cho đúng cặp, ép sàn `isCompany()`. Không vào batch vì batch chạy cho **cả 44 route** (bẫy `:87-89`) | M27; M30 |
| **D19** 🔴 | **Lưới cho điểm mù của D7 là assert CẤU TRÚC, KHÔNG phải ca quyền** | Seed cấp `create:feed-poll` cho **cả 4 vai** (M29) ⇒ **không dựng được ca DENY theo vai**; và census tầng-2 chỉ đo `resolveActor(x,"key")` (`:270-298`) nên `resolveManyOrNull` **vô hình**. ⇒ Thêm vào census spec: mỗi giá trị non-null của `SOCIAL_POST_TYPE_PAIRS` phải xuất hiện **ĐÚNG MỘT LẦN** dưới dạng literal `{action,resourceType}` trong `social-posts.service.ts`/`social-post-types.ts`; assert **ĐẲNG THỨC số lượng + neo dương**. Nếu `create()` quên hẳn kiểm cặp ⇒ spec này ĐỎ (mọi lưới khác đều xanh) | reviewer B1 (CRITICAL) |
| **D8** 🔴 | **2–10 lựa chọn ép Ở SERVICE → 422 `ERR-018`** | Zod **chỉ** chặn hình dạng. Ca test assert **đúng MÃ**. Ba ca tách bạch: vắng hẳn `options` (Zod **400**) · `[]` hoặc 1 phần tử (service **422**) · 11 phần tử (service **422**) | M54; reviewer B18 |
| **D9** | **Lựa chọn BẤT BIẾN sau khi tạo** | Không route nào sửa/thêm/xoá `feed_poll_options`. `position` sinh ở server `0..n-1`. **Đây là chân trụ của D1b** | M10; DB-17 §7.4 |
| **D12** | **`@Idempotent` trên `044`, khoá SUY TỪ NỘI DUNG** | `close:{postId}` — không theo timestamp (decorator sẽ vô dụng). `041` (PUT) / `042` (DELETE) không cần ⇒ **WO có ĐÚNG MỘT POST** và nó có decorator. Sửa API-19 §6.6 cùng PR | M51; reviewer B16 |
| **D13** 🔴 | **Job — idempotent bằng CHÍNH câu ghi, KHÔNG neo khoá** | `UPDATE feed_polls SET status='closed', closed_at=now(), updated_at=now() WHERE company_id=$ AND status='open' AND closes_at IS NOT NULL AND closes_at <= now() RETURNING id, post_id, question`. NOTI-035 enqueue **TRONG CÙNG tx**, **chỉ cho các hàng `RETURNING` trả về** | M9; M34 |
| **D14** 🔴 | **Poll ẩn danh — tập cột TƯỜNG MINH, cấm `select()` trần** | `043` trả đúng bộ trường API-19 §6.3 (`:229-242`): `{pollId, question, isAnonymous, status, totalVoters, myVote[], options[{id,label,voteCount}]}`. `user_id` **KHÔNG BAO GIỜ** vào DTO — kể cả `company-admin`, kể cả khi `isAnonymous=false`. `totalVoters = COUNT(DISTINCT user_id)`. 🔴 **Ghim tập cột cho CẢ `040`·`041`·`042`·`043`** (plan cũ chỉ ghim `043`) | API-19 §6.3; SOC-DEC-009; reviewer |
| **D15** | **Cổng ĐỌC đi qua `visiblePostCondition`** | Poll thừa hưởng phạm vi BÀI CHA. `040`/`043` JOIN `feed_posts` + vị từ NGAY TRONG câu; `041`/`042`/`044` gọi `assertPostVisible` trước. Tái dùng `listFeed` thì **BẮT BUỘC** khai `groupScope` tường minh — **U3** | BE-2A D1 |
| **D16** 🔴 | **Audit — và chỗ CỐ Ý KHÔNG audit** | `044` **LUÔN** (đóng poll không đảo ngược được): `feed_post`/`postId`/`social.poll.close`/`{postId, pollId, via:'manual' hoặc 'job'}`. 🔴 **KHÔNG audit `041`/`042` — CỐ Ý**: audit một lượt bỏ phiếu (`actor_user_id` + `object_id=postId`) **TÁI DỰNG ĐƯỢC danh sách cử tri** ⇒ phá SOC-DEC-009, mà `audit_logs` **append-only, sống lâu hơn grant**. Phải tuyên bố trong PR để reviewer không «sửa cho đủ DoD» | M44; reviewer B10 |
| **D20** 🔴 | **audit + outbox CHỈ phát khi `RETURNING` ≠ rỗng, TRONG CÙNG tx** | Viết audit trước khi kiểm `updated.length > 0` ⇒ hai dòng audit cho một lần đóng; `audit_logs` append-only nên **không gỡ lại được** | reviewer B9 |
| **D21** | **Hành vi CHƯA XÁC ĐỊNH — quyết tường minh** | `042` khi user chưa có phiếu ⇒ **200 no-op** (idempotent, không 404). `041`/`043`/`044` trên bài KHÔNG mang poll ⇒ **404 `ERR-001`** (không 500, không 422) | reviewer B8 |
| **D17** | **File mới nằm PHẲNG trong `src/social/`** | Census `readdirSync` không đệ quy | M21 |
| **D22** | **`totalVoters` không có sàn k-ẩn-danh** | Poll ẩn danh có đúng 1 cử tri ⇒ `totalVoters=1`; chỉ chính cử tri đó tự suy ra được (qua `myVote` của mình) ⇒ **chấp nhận**, ghi nhận không vá | reviewer B20 |

### 2.3 Cần CHỮ KÝ OWNER (3 mục — S1/S3 đã ký và chuyển sang BE-2B-2)

| # | Câu hỏi | Hiện trạng ĐO ĐƯỢC | A | B | Khuyến nghị |
| --- | --- | --- | --- | --- | --- |
| **S2** 🔴 | `vote_count` đối soát ở đâu? | SPEC-16 §13.6 liệt **ĐÚNG 5 cột** và đòi «script đối soát cả năm»; `vote_count` không trong đó nhưng có `CHECK >= 0` ⇒ lệch âm = **500**, lệch dương = **hỏng câm** | Bổ sung `vote_count` vào script đối soát + sửa SPEC-16 §13.6 thành **6 cột** | Giữ 5 cột, ghi **nợ tường minh** cho QA-1 | **A.** Bộ đếm có CHECK mà không sổ nào đối soát là «cổng CHẾT trông y hệt cổng sống». Chọn B ⇒ **phải** ghi vào `done_when` của QA-1 |
| ~~**S4**~~ | ~~Actor audit của job?~~ | ✅ **ĐÓNG 23/09 BẰNG PHÉP ĐO U1 — KHÔNG CẦN CHỮ KÝ.** Cả hai phương án plan đưa ra đều SAI: `actorUserId` có kiểu `?: string` (**optional, không nullable**) nên A (`null`) **không biên dịch được**; và B (user ảo) là thừa vì enum `AUDIT_ACTOR_TYPES` (`events/audit.service.ts:59`, CHECK `0432`) **đã có sẵn `"Job"`**. Đường đúng: **bỏ hẳn `actorUserId`** + `actorType: "Job"`, y như `leave-accrual.service.ts:206-222` · `lms-user-sync.job-handler.ts:197` · `chat-calls.service.ts:478` | — | — | **Bài học ghi lại:** plan đặt một câu hỏi nhị phân cho owner trên một tiền đề CHƯA ĐO (*«cột nullable nên chắc truyền null được»*). Đo xong thì câu hỏi biến mất. **Đo trước khi soạn phương án, đừng soạn phương án rồi đo sau** |
| **S5** | Phân trang `040` | API-19 §6.4 `:246-247` chỉ nói về feed (cursor) và danh sách quản trị (offset) | **OFFSET** (khuôn `030`) | Cursor | **A.** Rẻ hơn, khớp `030`/`028` đã ship, FE-2 vẽ ở rail phải. Ghi bổ sung một dòng vào API-19 §6.4 |

---

## §3. Cấu trúc file

### 3.1 MỚI (`apps/api/src/social/` — PHẲNG, M21)

| File | Trách nhiệm | ~dòng |
| --- | --- | --- |
| `social-polls.repository.ts` | `lockPollRowTx` · `getPollForWriteTx` · `optionsOfPollTx` (D4) · `deleteVotesOfUserTx` (RETURNING) · `insertVotesTx` (D3) · `closeTx` (D2a) · `closeExpiredTx` (D13) · `listPollsTx` · `resultsTx` (D14) | 250-300 |
| `social-polls.service.ts` | `040`·`041`·`042`·`043`·`044` | 220-270 |
| `social-poll-close.job-handler.ts` | `jobCode = "SOCIAL_POLL_CLOSE_EXPIRED"`, tự `withTenant`. 🔴 **KHÔNG `@Optional()`** — constructor CHỈ nhận `DatabaseService` + service SOCIAL (đều là provider thật); ghi chữ ký constructor vào §13 làm căn cứ (M48) | 70-100 |
| `social-post-types.ts` | `createPollTx` — 🔴 **site DUY NHẤT** ghi `multipleChoice`/`isAnonymous`. Hàm thuần nhận `tx`, không gọi `resolveActor` | 90-120 |
| `social-polls.controller.ts` | `SocialPollsController` | 120-160 |
| `social-poll-flags-structure.spec.ts` | D2b — **có `stripComments`** (M39) | 70-100 |

### 3.2 SỬA

| File | Sửa gì | Bẫy |
| --- | --- | --- |
| `social-posts.service.ts` (**636**) | `create()` +nhánh `poll` (D7) → gọi `social-post-types.ts` | 🔴 Trần 800. Site census `#create → postCreate` **KHÔNG đổi** |
| `social-counters.ts` (309) | +`bumpPollOptionVotes` (append, **ném khi 0 dòng**) | Cấm `Math.max` ở JS |
| `social.errors.ts` (219) | +`016`/`017`/`018` + `POLL_OPTION_NOT_FOUND` + `SOCIAL_CONSTRAINT.POLL_VOTE_SINGLE_UQ` **và `POLL_VOTE_PK`** (D5b) | Khối additive; sửa header `:20-21` |
| `social-route-pairs.const.ts` (252) | +5 khoá route + `SOCIAL_POST_TYPE_PAIRS.poll` | Census đẳng thức `:306-330` |
| `social.dto.ts` (74) | +class DTO 5 route | `createZodDto` không bọc union |
| `social.module.ts` (130) | +1 controller +3 provider +1 job handler | 🔴 Thêm controller ⇒ **BẮT BUỘC** thêm `SOCIAL_CONTROLLERS` |
| `contracts/social-api.ts` (470) | enum **2→3** · `createFeedPostSchema` (D6) | ⚠️ **U4** trước |
| `contracts/social-api-polls.ts` (**mới**) | DTO 5 route (khuôn `social-api-groups.ts`) | M33: DTO option tự dựng |
| `social-noti.payload.ts` (212) | +`SOCIAL_EVENT_CODES_D` + interface `POLL_CLOSED` | M43 |
| `notifications/social-noti-bridge.registrar.ts` | +1 `registerSource` · `PAYLOAD_KEYS` +`poll_question` · `TEMPLATE_KEYS` +1 | 🔴 **PHẢI có `dedupeKeyOf`** (M40) |
| `apps/api/package.json:16` | `test:cov:social` +int-spec mới | M24 |
| `test/foundation/social-two-layer-guard-census.unit-spec.ts` | **4 việc** (M20) + **assert cấu trúc D19** | Thiếu (i) ⇒ fail-OPEN |
| `test/foundation/route-http-coverage.e2e-spec.ts:355` | `MIN_COVERED_COUNT` ← **số ĐO ĐƯỢC** (U2); comment ghi **cả nợ 10 đơn vị của BE-2A** | Cấm cộng tay |
| `docs/_review/…route-census.json` | Regen | |
| `docs/API Design/API-19…` §5.1b · §6.4 · §6.6 | M55 · S5 · D12 | Cùng PR |
| `docs/SPEC/SPEC-16 SOCIAL.md` §13.6 | S2 (nếu ký A) | Chỉ sau chữ ký |
| `harness/backlog.mjs` | Đóng WO | |

### 3.3 Luật DTO (nợ (f))

`.pick()` rồi `.strict()`. **Cấm `.extend()`** — `contracts/social.ts:278-286` cảnh báo sẵn:
`feedPollCoreSchema` mang `status`/`closedAt` ⇒ `.extend()` cho phép **tự đóng poll không qua `044`**.

---

## §4. Bảng route

| Mã | Method · Path | Tầng-1 | Tầng-2 | Idem | Audit | NOTI | Lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `002`+`poll` | `POST /social/posts` | `create:feed-post` (SÀN) | D7 `create:feed-poll` · D8 2–10 | ✅ | — | — | **422 `ERR-018`** · 400 (vắng `options`) |
| `040` | `GET /social/polls` | `view:feed` | D15; lọc `status`; OFFSET (**S5**) | — | — | — | — |
| `041` | `PUT …/poll/vote` | `view:feed` | `assertPostVisible` → D1 → cổng → **D4** → **D5** | ❌ (bản chất) | 🔴 **KHÔNG — D16** | — | **409 `ERR-016`** · **409 `ERR-017`** (2 chốt — D5b) · 404 `POLL_OPTION_NOT_FOUND` · 404 `ERR-001` (bài không mang poll) |
| `042` | `DELETE …/poll/vote` | `view:feed` | D1 → cổng `open` → DELETE RETURNING → `-1` | ❌ | 🔴 **KHÔNG — D16** | — | `ERR-016` · **200 no-op** khi chưa có phiếu (D21) |
| `043` | `GET …/poll/results` | `view:feed` | `assertPostVisible`; **D14** | — | — | — | 404 `ERR-001` |
| `044` | `POST …/poll/close` | `view:feed` | Chủ bài **HOẶC** `canManagePosts`; D1 → **D2a** → **D20** | ✅ **D12** `close:{postId}` | ✅ `feed_post` | **035** | `ERR-016` · 403 `ERR-003` |

🔴 **Cả 5 route `tier1IsFloor: false`** — vế tầng-2 là quyền trên HÀNG, không phải bảng cặp-theo-payload.
`ParseUUIDPipe` cấp method trên **mọi** `@Param` (M25 — ĐẲNG THỨC, trần đã dùng hết).

---

## §5. Deny-path RED trước + ALLOW đối chứng

> Mỗi DENY có ALLOW đối chứng; assert phủ định trên tập RỖNG là **deny vacuous** ⇒ luôn neo dương trước.
> Assert theo **MÃ LỖI**, không theo status trần.

| # | DENY | Kỳ vọng ĐẾM ĐƯỢC | ALLOW đối chứng | DB? |
| --- | --- | --- | --- | --- |
| **P-b** 🔴 | Structure-spec: site ngoài `createPollTx` ghi cờ poll | Vi phạm **`toEqual([])`** + **neo dương `toBe(1)`** | Tháo thử `.set({multipleChoice:…})` ⇒ ĐỎ | ❌ |
| **P-b2** 🔴 | `closeTx` ghi thừa cột | `.set({…})` có **ĐÚNG** tập khoá `{status, closedAt, updatedAt}` | — | ❌ |
| **P-e** 🔴 | Vote `optionId` của poll KHÁC | **404 `POLL_OPTION_NOT_FOUND`**; `vote_count` poll kia **`toBe(before)`**; `COUNT(*)` phiếu poll kia không đổi | Option đúng poll ⇒ 200, `vote_count` **+1** | ✅ |
| **P-1** | Vote poll `status='closed'` | 409 **`ERR-016`** | Poll `open` ⇒ 200 | ✅ |
| **P-2** | Vote poll `closes_at` đã qua (vẫn `open`) | 409 **`ERR-016`** — **ca RIÊNG với P-1** | `closes_at` tương lai ⇒ 200 | ✅ |
| **P-3** 🔴 | Poll một-lựa-chọn, gửi **2 optionId** | 409 **`ERR-017`**, `COUNT(*)` phiếu user `== 0` | Poll ĐA-lựa-chọn 2 option ⇒ 200, `COUNT(*) == 2` | ✅ |
| **P-4** 🔴 | **Đổi phiếu** A→B | `vote_count(A)` **-1**, `vote_count(B)` **+1**; **Σ `vote_count` == COUNT(*) phiếu** sau mỗi bước | Phiếu đầu ⇒ Σ == **1** | ✅ |
| **P-5a** 🔴 | **ĐUA — cùng user, CÙNG option** (nhánh **PK**) | (i) `COUNT(*) == 1`; (ii) Σ == COUNT(*); (iii) 🔴 **`statuses.every(s => s < 500)`** | Σ trước đua == 0, sau == 1 | ✅ |
| **P-5b** 🔴 | **ĐUA — cùng user, KHÁC option**, poll một-lựa-chọn (nhánh **single_uq**) | như trên | như trên | ✅ |
| **P-5c** 🔴 | **ĐUA** trên poll **ĐA lựa chọn** (`single_uq` KHÔNG áp) | `COUNT(*) == 2` (hai option khác nhau, hợp lệ) VÀ Σ == COUNT(*) VÀ mọi status `< 500` | — | ✅ |
| **P-6** 🔴 | **ĐO CỔNG:** ghi cứng `single_choice=false` | **P-3** hoặc **P-5b** phải ĐỎ | — | ✅ |
| **P-7a** | Vắng hẳn `options` | **400** (Zod) | — | ❌ |
| **P-7b** | `[]` · 1 lựa chọn · 11 lựa chọn | **422 `ERR-018`** (assert MÃ) | 2 ⇒ 201; 10 ⇒ 201 | ❌ unit + 1 int |
| **P-8** 🔴 | `043` poll ẩn danh, `company-admin` gọi | `JSON.stringify(body)` **`not.toContain(voterUserId)`** + **neo dương** `options[0].voteCount > 0` | Người thường ⇒ cùng bộ trường | ✅ |
| **P-8b** 🔴 | Grep `user_id` trên body của **`040`·`041`·`042`** (không chỉ `043`) | `not.toContain(voterUserId)` mỗi route + neo dương mỗi route trả ≥1 trường thật | — | ✅ |
| **P-9** | `043` poll KHÔNG ẩn danh | Vẫn **KHÔNG** có `user_id` (D14) | `myVote` đúng option mình chọn | ✅ |
| **P-10** | `044` bởi người không phải chủ bài, không `manage:feed-post` | 403 `ERR-003`, poll vẫn `open` | Chủ bài đóng được; `manage` đóng được + **audit đúng** | ✅ |
| **P-11** | `044` đóng poll ĐÃ đóng | 409 `ERR-016`, `closed_at` **không đổi**, **audit KHÔNG thêm dòng** (D20) | Poll `open` ⇒ 200, `closed_at != null`, audit +1 | ✅ |
| **P-12** | `040`/`043` trên bài ngoài audience | 404 `ERR-001` / vắng mặt | Người trong audience thấy | ✅ |
| **P-13** | `041`/`043`/`044` trên bài **không mang poll** (D21) | **404 `ERR-001`** (không 500) | Bài có poll ⇒ 200 | ✅ |
| **P-14** | `042` khi chưa có phiếu (D21) | **200 no-op**, Σ không đổi | Có phiếu ⇒ 200, Σ **-1** | ✅ |

### Job

| # | Ca | Kỳ vọng ĐẾM ĐƯỢC | DB? |
| --- | --- | --- | --- |
| **J-1** | 1 poll quá hạn · 1 chưa hạn · 1 đã `closed` | `result.total == 1`; poll chưa hạn vẫn `open`; poll đã đóng giữ `closed_at` CŨ | ✅ |
| **J-2** 🔴 | `run()` hai lần | Lượt 2 `total == 0`, `closed_at` không đổi, **outbox NOTI-035 không tăng** | ✅ |
| **J-3** 🔴 | Đua job ↔ `044` | `COUNT(*)` outbox NOTI-035 cho poll **== 1** VÀ `status='closed'` | ✅ |
| **J-4** | Đăng ký handler | AppModule THẬT, `SYSTEM_JOB_HANDLER[]` chứa `jobCode` đúng **1 lần** (M48) | ✅ |
| **J-5** | Cô lập tenant | Poll quá hạn tenant B không bị job tenant A đóng | ✅ |

### NOTI

| # | Ca | Kỳ vọng | DB? |
| --- | --- | --- | --- |
| **N-035** | Job + `044` | Tới **người tạo poll**, render `{poll_question}` ra CHỮ, `target_url` không còn `{post_id}`. **Deny:** người bỏ phiếu không nhận | ✅ |
| **N-dedupe** 🔴 | `dedupeKeyOf` có khai | Phát 2 lần cùng poll ⇒ `COUNT(*) notifications == 1` | ✅ |
| **N-boot** | Registrar không dead-letter | `registerSource` chạy được lúc boot | ✅ |

### Census · sổ · bộ đếm

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| **C-1** 🔴 | Census 2 tầng | `toBe(44)`; `SOCIAL_CONTROLLERS` +1 tên; `ROUTE_TO_KEY` 44; `SERVICE_SITE_TO_KEYS` 44; đẳng thức `tier1IsFloor` giữ |
| **C-6** 🔴 | **Assert cấu trúc D19** | Mỗi giá trị non-null của `SOCIAL_POST_TYPE_PAIRS` xuất hiện **ĐÚNG 1 LẦN** dạng literal trong `social-posts.service.ts`/`social-post-types.ts`; **ĐẲNG THỨC** + neo dương |
| **C-2** 🔴 | Chuỗi đầy đủ: tạo poll(2 option) → vote A → đổi sang B → vote thêm (đa lựa chọn) → rút phiếu → job đóng | 🔴 **Giá trị TUYỆT ĐỐI từng bước**: Σ = `0 → 1 → 1 → 2 → 1 → 1`; **Σ > 0 ở ít nhất 2 bước**; không bước nào chạm `chk_feed_poll_options_vote_count` |
| **C-3** | `MIN_COVERED_COUNT` | Xanh với sàn = số ĐO ĐƯỢC (U2), dán dòng console vào §13 |
| **C-4** | Route census JSON | `totals.routes == 676` sau regen (đo lại) |

---

## §6. Migration

**KHÔNG CÓ.** Bảy phép đo độc lập (4 của plan + 3 reviewer đo thêm): (1) 9 bảng Track B đã land `0580`;
(2) cặp quyền đã seed `0578`; (3) event+template đã seed `0581` (verify-block ép set-equality);
(4) `feed_post` đủ cho audit `044` (`0583:14-15` ký CHỦ Ý); (5) **job chạy bằng role `mediaos_app`** đã có
`UPDATE ON feed_polls` (`0580:541`), `API-19:166` cấm cấp thêm cho `mediaos_worker`; (6) `job_code` là
`varchar` **không CHECK enum** ở cả `system_job_locks` lẫn `system_job_runs` ⇒ không cần seed;
(7) 9 bảng đã trong `PROTECTED_TABLES`. ⇒ Head giữ `0585`. Phát hiện **phải** có migration ⇒ **tín hiệu
DỪNG**, đó là việc của một WO DB.

---

## §7. Audit · NOTI

### 7.1 Audit

| Route | `object_type` | `object_id` | `action` | `metadata` |
| --- | --- | --- | --- | --- |
| `044` (tay) | `feed_post` | `postId` | `social.poll.close` | `{postId, pollId, via:'manual'}` |
| `044` (job) | `feed_post` | `postId` | `social.poll.close` | `{postId, pollId, via:'job'}` — **S4/U1** |
| `041`/`042` | 🔴 **KHÔNG GHI — CỐ Ý** | | | Lý do ở D16; **tuyên bố trong PR** |

D20: audit chỉ phát khi `RETURNING` ≠ rỗng, cùng tx.

### 7.2 NOTI — pin VERBATIM

| Mã | `eventCode` (verbatim `0581`) | `dedupe_strategy` | `dedupeKeyOf` | `sourceEntityType` | Người nhận | Biến |
| --- | --- | --- | --- | --- | --- | --- |
| 035 | `SOCIAL_POLL_CLOSED` | **`DedupeKey`**, `is_system_event = true`, `Low` | 🔴 `"{post_id}"` (poll đóng đúng một lần) | `feed_post` | tác giả bài | `poll_question` · `post_id` |

- `PAYLOAD_KEYS` +`poll_question`; `TEMPLATE_KEYS` mirror `variables_schema` `0581:262-267`.
  Thiếu `post_id` ⇒ `target_url` giữ `{post_id}` ⇒ `assertInternalTargetUrl` từ chối ⇒ **dead-letter CÂM**.
- 🔴 `payloadOf` forward **mọi** khoá whitelist **không phân biệt mã**, và `my-notifications.mapper.ts`
  trả payload NGUYÊN VĂN ⇒ payload này **không** được chở `voterUserId`; cân nhắc thêm `actorUserId`
  vào `PAYLOAD_KEYS_DENIED` (`registrar:69-71`) cho mã này.

---

## §8. Thứ tự thi công

> Lane DB `mediaos_be2b` đã dựng sạch. Một lời gọi Bash duy nhất (env không sống qua 2 lệnh):
> ```bash
> export APP_DB_PASSWORD="$(sed -n 's/^APP_DB_PASSWORD=//p' .env)" WORKER_DB_PASSWORD="$(sed -n 's/^WORKER_DB_PASSWORD=//p' .env)" SUPERUSER_DB_PASSWORD="$(sed -n 's/^SUPERUSER_DB_PASSWORD=//p' .env)" LANE_DB=mediaos_be2b && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && pnpm --filter @mediaos/api exec vitest run <spec>
> ```
> **Đừng pipe `harness/check.sh` qua `tail`** (mất chi tiết ca đỏ, phải chạy lại ~10 phút).

**Bước 0 — đo U1·U2b·U3·U4·U5** + baseline `coveredCount`.

**Bước 1 — nền (RED trước):** structure-spec nợ (b) (P-b/P-b2) · `social.errors.ts` +3 mã + hằng +
**2 hằng constraint** (D5b) · contracts (D6, enum 2→3) + `build && typecheck`.

**Bước 2 — `002/poll`:** `social-post-types.ts#createPollTx` + `SOCIAL_POST_TYPE_PAIRS.poll` + nhánh `type`
(RED: **C-6**, P-7a/P-7b) · 🔴 chạy lại **nguyên bộ spec BE-1/1B/2A** — `share`/`news` không đổi hành vi.

**Bước 3 — bình chọn:** repository (D1·D3·D4·D5·D5b·D2a) + `bumpPollOptionVotes`
(RED: P-e, P-1..P-6, C-2) · service + controller `040..044`, tập cột tường minh
(RED: P-8/P-8b/P-9..P-14).

**Bước 4 — job:** handler (**KHÔNG `@Optional()`**, ghi chữ ký constructor vào §13) + `closeExpiredTx` +
NOTI-035 + D20 (RED: J-1..J-5, N-035, N-dedupe, N-boot).

**Bước 5 — sổ + đóng WO:**
1. Census 2 tầng **BỐN việc** (M20) + **assert cấu trúc C-6**; `toBe(39)` → **`toBe(44)`**.
2. 🔴 **Bốn sổ đo RIÊNG, cấm cộng tay** (`route-http-coverage.e2e-spec.ts:349-354`: «BA phép đo, BA câu
   hỏi khác nhau»): `MIN_COVERED_COUNT` ← **số spec IN RA** · census 2 tầng · route-census JSON regen ·
   `identity-projection-verdicts` (xác minh WO này **không** thêm điểm chiếu).
3. `package.json:16` +int-spec; `test:cov:social` với `LANE_DB`.
4. Đồng bộ tài liệu: API-19 §5.1b/§6.4/§6.6 · SPEC-16 §13.6 (nếu S2-A) · `harness/backlog.mjs`.
5. `build && typecheck && lint`; `bash harness/check.sh --all` — không banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».
6. 🔴 **TẤT CẢ spec SOCIAL trong MỘT lượt, cùng lane DB** (chạy riêng lẻ đã từng GIẤU lỗi đỏ-CI: câu
   census `scoped` của `s16-social-db1-invariants` quét cả role tuỳ biến do fixture spec khác gieo).
7. 🔴 **FULL gate TRƯỚC khi mở PR** (+`santa-method` cho `voteTx`/`closeTx`). → PR kèm §2.3 cho owner ký.

---

## §9. Rủi ro → cách chặn

| Rủi ro | Chặn |
| --- | --- |
| 🔴 **`vote_count` lệch âm thầm mà KHÔNG sổ nào nhìn** — giao của ba lỗ: ngoài 5 cột §13.6 · hai FK rời · đổi phiếu là DELETE+INSERT. Lệch dương chỉ làm kết quả SAI (không lỗi, không log); lệch âm mới chạm CHECK ⇒ **nhánh dễ phát hiện là nhánh ÍT xảy ra hơn** | **C-2** (giá trị tuyệt đối từng bước) + **P-e** + S2. Bắt buộc ĐO CỔNG ở §13 |
| 🔴 Ca đua XANH trong khi người dùng ăn **500** (nhánh PK không được dịch) | **D5b** + **P-5a/5b/5c** với `statuses.every(s => s < 500)` |
| 🔴 D7 fail-OPEN mà census mù và seed không cho dựng ca DENY | **D19** + **C-6** (assert cấu trúc, không phụ thuộc seed) |
| 🔴 Nợ (b) xả bằng lập luận «không có route PATCH» | D2 ba vế + P-b/P-b2 (ratchet, không phải ca một lần) |
| 🔴 `single_choice` ghi sai ⇒ phiếu đôi lọt IM LẶNG | D3 + **P-6** tháo cơ chế đo |
| 🔴 Đổi phiếu không giảm đếm cũ — lệch ở luồng BÌNH THƯỜNG | D5 vế `-1`; P-4 + C-2 |
| 🔴 Deadlock nâng-cấp-khoá RI → UPDATE `vote_count` | D1 + **D1b** (viết ra mệnh đề chân trụ) |
| 🔴 Lộ cử tri | D14 ghim tập cột **4 route**; P-8/P-8b/P-9; **D16** không audit `041`/`042` |
| 🔴 Hai dòng audit cho một lần đóng (append-only, không gỡ được) | **D20**; P-11 assert audit không tăng |
| 🔴 `ERR-018` ép ở Zod ⇒ 400 vô danh; hoặc ai đó thêm `.min(2)` vào Zod làm ca 422 CHẾT | D8 + cảnh báo tại chỗ (M54) |
| 🔴 `dedupeKeyOf` bị bỏ vì đọc nhầm câu «034 = None» | M40 pin §7.2; N-dedupe |
| 🔴 Census XANH mà không đo route nào | Bước 5.1 bốn việc; `toBe(44)` |
| 🔴 File service đặt trong thư mục con ⇒ census mù | D17 + M21; C-1 |
| 🔴 Lệnh đóng WO không chạy 4 sổ ⇒ U2 không thực hiện được | §12.4 gồm cả 4 spec sổ |
| Job đóng trùng NOTI với `044` | D13 `WHERE status='open' RETURNING`; J-2/J-3 |
| Mass-assignment `.extend()` ⇒ tự đóng poll | §3.3 |
| `createZodDto` + union ⇒ TS2509 kéo theo sửa `002` đã ship | D6 |
| `social-posts.service.ts` vượt 800 dòng | Thân nhánh poll ở `social-post-types.ts` |
| Mở enum 2→3 làm đỏ spec contracts đang ghim | U4 + Bước 2 |
| `MIN_COVERED_COUNT` cộng tay trong khi sàn lỏng 10 | M18 + U2 |
| `@Optional()` theo gợi ý `src` | M48; J-4 AppModule THẬT + ghi chữ ký constructor |

---

## §10. Nợ chuyển tiếp

- **BE-2B-2**: `002/idea`·`002/kudos` · `045..048` · FSM sáng kiến · NOTI-032/033 · **D18 vị từ người
  còn hoạt động** (viết VERBATIM, không trỏ mơ hồ) · mở enum 3→5 · K1/K2 (**owner đã ký ép cả hai +
  bổ sung SPEC-16 §13**) · `047`/`048` (**owner đã ký: thuộc BE-2B-2, không phải BE-3**).
- **BE-2C**: `feedUserRoomName` + join/leave động · sửa API-19 §7. ⚠️ Bài poll `audience='group'` sẽ
  fan-out qua room nhóm.
- **BE-3**: `049..053` · **throttle `035`** (BE-2A §14.3 S3).
- **FE-2**: (a) DTO thẻ bài có chở chi tiết poll không (U5); (b) `myVote` là MẢNG; (c) OFFSET (S5).
- **QA-1 S16**: script đối soát — **6 cột** nếu S2-A, 5 + nợ nếu S2-B.
- **Nhánh CHẾT `SOCIAL-ERR-008`**: WO này CÓ mở `superRefine` nhưng **không gộp** việc dọn nhánh chết
  (đụng contracts dùng chung FE) — giao WO dọn nợ.
- Nợ (g)1-5,7,8 của BE-1B — chưa gán WO.

---

## §11. Cổng · lệnh · sổ

### 11.1 Bốn sổ

| Sổ | File · dòng | HIỆN TẠI | Đích |
| --- | --- | --- | --- |
| (1) Ratchet test-HTTP | `route-http-coverage.e2e-spec.ts:355` | **661** (BE-2A quên bump) | **số spec IN RA** (dự kiến 676) |
| (2) Census 2 tầng | `social-two-layer-guard-census.unit-spec.ts:34,49,115,233` | 7 · 39 · 39 · `toBe(39)` | 8 · 44 · 44 · `toBe(44)` **+ assert C-6** |
| (3) Route census JSON | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json:7` | `totals.routes = 671` | **676** (regen) |
| (4) Điểm chiếu danh tính | `identity-projection-verdicts.ts` (11 dòng SOCIAL) | — | Xác minh **không đổi** |

### 11.2 Cổng THẬT vs chỉ-ĐO

| Là CỔNG (CI đỏ) | Chỉ ĐO / tự kiểm |
| --- | --- |
| `social-access.service.ts` 90/90/85 (`vitest.config.ts:144-149`) · `@Param` không pipe `toBe(1)` **ĐẲNG THỨC** · body không validate `toBe(0)` · `MAX_UNCOVERED_TOTAL = 0` · `MIN_COVERED_COUNT` · census 2 tầng | 🔴 `src/social/** ≥85%` (`vitest.config.ts:141-143`: *«`test:cov:social` chỉ ĐO, không gate»*) · file > 800 dòng |

### 11.3 Lệnh đóng WO — **PHẢI gồm cả 4 sổ**

```bash
export APP_DB_PASSWORD="$(sed -n 's/^APP_DB_PASSWORD=//p' .env)" WORKER_DB_PASSWORD="$(sed -n 's/^WORKER_DB_PASSWORD=//p' .env)" SUPERUSER_DB_PASSWORD="$(sed -n 's/^SUPERUSER_DB_PASSWORD=//p' .env)" LANE_DB=mediaos_be2b && unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL && pnpm --filter @mediaos/api exec vitest run src/social test/integration/social-*.int-spec.ts test/foundation/social-*.unit-spec.ts test/foundation/route-http-coverage.e2e-spec.ts test/foundation/route-guard-coverage.e2e-spec.ts test/foundation/param-uuid-ratchet.unit-spec.ts test/foundation/body-validation-ratchet.unit-spec.ts
bash harness/check.sh --all
```

---

## §12. Sổ vết THI CÔNG — *(để trống)*

> Ghi **mọi chỗ code khác plan**, kèm lý do ĐO ĐƯỢC. Tiền lệ: câu «T2» ở §13 của BE-2A viết sai thực tế,
> chỉ bị bắt ở FULL gate — owner suýt ký một mô tả rủi ro sai. Và chính plan này đã có **2 ô SAI**
> (M24 đếm nhầm 11/10 · M54 trích sai chỗ) do `plan-reviewer` bắt — bảng đo không miễn nhiễm.

| # | Điểm | Quyết định thi công | Vì sao (đo được) |
| --- | --- | --- | --- |
| **T1** 🔴 | **LỆCH D7/D19.** Plan định: resolve cặp theo `type` bằng một nhánh `if` trong `create()`, rồi bù điểm mù census bằng một spec **quét mã nguồn** tìm literal `{action,resourceType}` | Thay bằng: `SocialAccessService.assertCreatablePostType(actor, type)` **ĐỌC** `SOCIAL_POST_TYPE_PAIRS`. `news` cũng chuyển sang cùng cổng (bỏ nhánh `if` + cờ `canManageNews` ở `create()`) | Đo được: bảng `SOCIAL_POST_TYPE_PAIRS` **không có call-site runtime nào** — `grep` toàn `apps/api` chỉ ra 2 chỗ: chính nó và census spec. Tức là thứ census dùng để kết luận «mọi loại bài đều có cặp gác» chưa bao giờ được code chạy đọc. Quên một loại ⇒ tạo được không qua cặp nào, census vẫn XANH. Cho cổng đọc chính bảng thì **quên khai một loại là lỗi TS**, mạnh hơn hẳn một spec regex. Giá: một round-trip quyền lặp cho riêng đường tạo tin tức; mã lỗi giữ nguyên theo loại |
| **T2** | `SOCIAL_POST_TYPE_DENIED` phải là `Record<SocialCreatablePostType, string \| null>` (có `share: null`), không phải map chỉ-loại-có-cặp | TS không suy được «`pair` non-null ⇒ `denied` non-null» từ phép index, và ép kiểu ở call-site là mở cửa hậu. Thêm chân **fail-closed** `SOCIAL_POST_TYPE_PAIR_DESYNC`: hai bảng lệch nhau thì CHẶN, vì lựa chọn còn lại là bỏ qua cổng quyền vì một lỗi khai báo | |
| **T3** 🔴 | **Neo dương của `P-b2` sai số.** Plan đặt «đúng 2 site `.set()`» cho hai đường đóng poll | Thực tế **1 builder + 1 SQL thô**: đường job phải set-based (neo/loop sẽ mất `idx_feed_polls_open_deadline`). Spec sửa để gác **CẢ HAI dạng câu**, mỗi dạng một neo dương | Giữ giả định cũ thì **nửa đường ghi vào `feed_polls` không được gác gì** — đúng lớp lỗi spec này sinh ra để chặn |
| **T4** | Ca `J-1` ban đầu assert `total === 1` | Đổi sang: đếm số poll «quá hạn mà vẫn `open`» TRƯỚC khi chạy job, rồi so `total` với số đó + neo dương `> 0` | Mọi ca trong file dùng CHUNG một tenant và ca `P-2` **cố ý** để lại một poll quá hạn ⇒ con số tuyệt đối phụ thuộc THỨ TỰ CHẠY. Đã đỏ thật một lượt (`expected 2 to be 1`) |
| **T5** 🔴 | **`chk_feed_polls_closes_future` phủ CẢ UPDATE** | Fixture không thể chỉ kéo `closes_at` về quá khứ — phải lùi **cả `created_at`** | Đỏ thật hai ca với `violates check constraint "chk_feed_polls_closes_future"`. Hệ quả rộng hơn fixture: trạng thái «quá hạn mà vẫn mở» **không dựng được bằng cách sửa mỗi hạn** — trong đời thật nó chỉ sinh ra do thời gian trôi |
| **T6** | Thêm `POLL_CLOSES_AT_PAST` (không có trong plan) | `closes_at` quá khứ ⇒ vỡ CHECK ⇒ **500** cho một sai sót nhập liệu bình thường | Zod KHÔNG ép được: CHECK so với `created_at`, một giá trị DB sinh lúc INSERT. Chính docblock schema đã ghi trước «`closesAt > now()` lúc validate — `created_at` chưa tồn tại khi đó» |
| **T7** | Đổi `body` thành tuỳ chọn **KHÔNG** làm typecheck đỏ | Ghi nhận, không vá | `feed_posts.body` nullable nên drizzle nhận `undefined`. Tức là **TS không gác gì ở đây** — chỉ `superRefine` + CHECK gác. Ai bỏ vế `superRefine` sẽ không được cảnh báo |
| **T8** | Audit của job: `actorType: "Job"`, **KHÔNG** `actorUserId`; và chỉ ghi **MỘT dòng cho cả lượt chạy** | `AuditEntry.actorUserId` là `?: string` (optional, không nullable). Ghi mỗi poll một dòng sẽ làm một nhịp gặt 500 poll đẻ 500 dòng cho MỘT hành động của hệ thống, trong bảng append-only | Tiền lệ `leave-accrual.service.ts:206-208` («~526k dòng rác/năm») |

### Phép ĐO CỔNG (tháo lưới → xác minh ca tương ứng ĐỎ → khôi phục)

> 🔴 **SỬA 23/09/2026 sau FULL gate — bảng này TRƯỚC ĐÂY trống hết cột 3, và HAI dòng của nó ghi một
> kỳ vọng SAI VỀ NGUYÊN LÝ.** Bốn reviewer độc lập hội tụ vào cùng kết luận (xem §13.1 H-1). Giữ bảng
> ở đây làm vết: một dòng «phép đo» chưa chạy trông y hệt một dòng đã chạy, và đó là chính xác cái
> **S2** của plan này lấy làm lý lẽ («cổng CHẾT trông y hệt cổng sống»).

| Tháo gì | Test kỳ vọng ĐỎ | Thông điệp thực tế |
| --- | --- | --- |
| Bỏ vế `-1` trong `voteTx` | **P-4** · **C-2** | ⏳ **CHƯA ĐO.** Và **`P-4` KHÔNG TỒN TẠI** — không spec nào mang mã đó; chỉ `C-2` đo được vế này (nhưng xem §13.1 M-1: `C-2` chỉ assert **Σ**, không assert phân bố từng option ⇒ lỗi "trừ sai option" vẫn XANH) |
| Ghi cứng `single_choice = false` | **P-3** / **P-5b** | 🔴 **KHÔNG ĐO ĐƯỢC.** `P-5b` **không tồn tại**; và `P-3` đo vế **service** (`!poll.multipleChoice && wanted.length > 1`) đọc `feed_polls.multiple_choice` — **không liên quan** cột `feed_poll_votes.single_choice`. ⇒ ghi sai `single_choice` KHÔNG test nào đỏ |
| Bỏ kiểm `optionId ∈ pollId` | **P-e** | ⏳ CHƯA ĐO. Ca `P-e` CÓ tồn tại và assert đúng vế; phép tháo lưới thì chưa chạy |
| Bỏ vế dịch `POLL_VOTE_PK` | **P-5a** (statuses < 500) | 🔴 **KỲ VỌNG SAI — P-5a KHÔNG THỂ ĐỎ.** `lockPollRowTx` (`FOR UPDATE`) tuần tự hoá hai lượt đua, rồi `deleteVotesOfUserTx` chạy TRƯỚC `INSERT` nên lượt sau **xoá phiếu vừa commit của lượt trước** rồi ghi lại ⇒ **không bao giờ đâm 23505**. `santa-A` đã kiểm bằng `EXPLAIN` trên PG sống. ⇒ assert `statuses.every(s<500)` đúng **một cách RỖNG**; cả hai nhánh `isUniqueViolationOf` là **phòng thủ tầng hai**, không phải đường nóng. **Đừng đọc P-5a xanh thành «nhánh PK đã được thực thi»** |
| Thêm site ghi `multipleChoice` ngoài `createPollTx` | **P-b** | ⏳ CHƯA ĐO bằng tháo lưới, NHƯNG lượt RED đầu tiên đã chứng minh spec sống (trượt ở `legitWriteSites 0 !== 1`). ⚠️ §13.1 M-2: lưới chỉ quét **literal** trong `src/social` **phẳng** ⇒ SQL thô nội suy / mapped-write / file khác vẫn vô hình |
| Bỏ hẳn kiểm cặp `create:feed-poll` trong `create()` | **C-6** | 🔴 **`C-6` KHÔNG ĐƯỢC THI CÔNG.** T1 đổi thiết kế (bảng thành load-bearing, quên khai = lỗi TS) và **không dựng lại phép đo thay thế**. Lưới còn lại là `social-be1-scope.int-spec.ts` R10 — nhưng nó ghim **nhánh `news`**, không ghim dòng `poll` của bảng |
| Bỏ `dedupeKeyOf` | **N-dedupe** | 🔴 **`N-dedupe` KHÔNG TỒN TẠI.** `dedupeKeyOf` CÓ mặt (đã đọc), nhưng không ca nào gác việc nó biến mất |
| Bỏ tên controller khỏi `SOCIAL_CONTROLLERS` | **C-1** (XANH = census fail-open) | ⏳ CHƯA ĐO. `SocialPollsController` ĐÃ có trong allowlist (đã đọc) |
| Viết audit TRƯỚC khi kiểm `RETURNING` | **P-11** | ⏳ CHƯA ĐO bằng tháo lưới. Ca `P-11` CÓ và assert «audit KHÔNG thêm dòng» ⇒ vế này đo được nếu chạy |

### Kết quả U1..U5 + chữ ký constructor job

| # | Câu hỏi | Kết quả đo (Bước 0 — 23/09/2026) | Hệ quả |
| --- | --- | --- | --- |
| **U1** 🔴 | `record()` nhận `actorUserId: null`? | **KHÔNG.** `AuditService` thật nằm ở **`apps/api/src/events/audit.service.ts`** (KHÔNG phải `foundation/audit/` — M45 trích nhầm cây), `:15` `interface AuditEntry`, `:19` **`actorUserId?: string`** — *optional, KHÔNG nullable* ⇒ truyền `null` là **lỗi TS**. NHƯNG `:59` `AUDIT_ACTOR_TYPES = ["User","System","Job","Integration"]` (CHECK gốc ở mig `0432:61-67`) | 🔴 **S4 ĐÓNG BẰNG PHÉP ĐO — không cần owner chọn A/B.** Đường đúng là vế thứ BA mà plan không thấy: **BỎ HẲN** `actorUserId` (undefined ⇒ cột NULL) + **`actorType: "Job"`**. Tiền lệ y hệt: `leave-accrual.service.ts:206-222` · `lms-user-sync.job-handler.ts:197` · `chat-calls.service.ts:478`. Nhánh tay của `044` giữ `actorType:"User"` + `actorUserId`. `metadata.via` GIỮ để phân biệt trong cùng `action` |
| **U1b** | Tiền lệ `leave-accrual` còn dạy gì? | `:206-208` nguyên văn: *«Audit CHỈ khi thực sự cấp. `granted=0` là trạng thái BÌNH THƯỜNG gần như mọi nhịp 60s — ghi audit ở đó = ~526k dòng rác/năm trong bảng append-only (đúng quả bom đã phải đi gỡ ở LMS sync)»* | **Củng cố D20**: job chỉ ghi audit khi `RETURNING` trả ≥1 hàng. Không chỉ là chuyện đúng/sai — còn là chuyện bom rác trong bảng append-only |
| **U2b** 🔴 | `uncovered == 0` HÔM NAY? | **CÓ.** Chạy thật trên `LANE_DB=mediaos_be2b`: `[S10-QA-ROUTEHTTP-1] Route HTTP coverage: **671/671 (100.0%) — CHƯA phủ: 0**` (9/9 test pass) | ⇒ `coveredCount == routes.length == 671` == census JSON ⇒ **tiền đề «sàn 661 lỏng đúng 10» ĐÃ CHỨNG MINH**, không còn là suy luận. Reviewer B6 đóng |
| **U2** | `coveredCount` sau +5 route | ⏳ đo ở Bước 5 — dán dòng console vào đây | Dự kiến 676, **nhưng gõ theo số IN RA** |
| **U3** 🔴 | `040` tái dùng `listFeed`? | **KHÔNG — nhưng cũng KHÔNG chép lại vị từ.** `listFeed` (`social-posts.repository.ts:61-83`) CÓ `type?: string` nhưng trả **THẺ BÀI**, còn `040` trả **dữ liệu POLL** (API-19 §6.3). Đo được đường thứ ba: **`SocialAccessService.visiblePostCondition(actor, t)`** (`social-access.service.ts:179`) nhận **tham số alias `t`** nên JOIN được, và `:186-199` cho thấy nó **ĐÃ có đủ ba vế** gồm nhánh `group` (BE-2A D3, EXISTS tương quan TRONG CÂU) | `040`/`043` viết câu riêng trong `social-polls.repository.ts` **JOIN `feed_posts` + gọi `visiblePostCondition`** — docblock `:41` ghi «một luật, một bản», chép lại là trôi. ⚠️ **KHÔNG** có tham số `groupScope` ở đây: `groupScope` là khái niệm của FEED (bài nhóm có nằm trong tập kết quả không), còn ở `040` ngữ nghĩa đúng là «mọi poll trên bài tôi thấy được» ⇒ vị từ một mình là đủ và đúng |
| **U4** | Spec nào ghim `feedCreatableTypeSchema` 2 giá trị? | **KHÔNG CÓ.** Chỉ `packages/contracts/src/social-api.ts:82-83` (nguồn) + `dist/cjs/social-api.d.ts:63` (**bản build CŨ**) | Mở enum 2→3 **an toàn**. 🔴 Nhớ `pnpm build` contracts trước khi typecheck — `dist` cũ gây **đỏ oan** (memory `stale-contracts-dist-typecheck-false-red`) |
| **U5** | DTO thẻ bài có nới không? | **KHÔNG nới.** `feedPostSchema:145-172` có `type: z.string()` (lỏng) và **không trường nào** cho poll; API-19 §6.1 cũng không khai | Giữ nguyên. **Nợ cho FE-2:** thẻ bài `type='poll'` phải gọi `043` riêng để vẽ kết quả — ghi vào §10 |
| **—** | Chữ ký constructor job (căn cứ KHÔNG `@Optional`) | ⏳ điền ở Bước 4 | Chỉ nhận provider THẬT ⇒ không `@Optional` |

---

## §13. Sổ vết FULL GATE — **ĐÃ CHẠY 23/09/2026**

Năm reviewer ĐỘC LẬP trên diff `5f8434c0..d0ac809f` (28 file · +3514/−70):
`security-reviewer` · `database-reviewer` · `silent-failure-hunter` · `santa-method` A (đúng-đắn
logic) · `santa-method` B (đối kháng). Tất cả Opus 5.

| Reviewer | Verdict | Findings |
| --- | --- | --- |
| `security-reviewer` | 🔴 **BLOCK** | 2 HIGH · 4 MEDIUM · 3 LOW · 1 INFO |
| `database-reviewer` | 🔴 **BLOCK** | 2 HIGH · 5 MEDIUM · 5 LOW |
| `silent-failure-hunter` | 🔴 **BLOCK** | 2 HIGH · 7 MEDIUM · 7 LOW |
| `santa-method` A | ✅ PASS (3 điều kiện bắt buộc) | 6 MEDIUM · 5 LOW |
| `santa-method` B | ✅ PASS (điều kiện F1) | 2 MEDIUM · 4 LOW |

**KẾT LUẬN GATE: BLOCK.** Cả ba reviewer FULL gate đều BLOCK. Điều đáng ghi: **không reviewer nào tìm
được lỗ authz/tenant/ẩn danh khai thác được** — cả ba nói phần phân quyền của WO viết **chặt hơn
baseline**. BLOCK đứng trên (a) hai HIGH kỹ thuật vá cục bộ, (b) **khoảng trống BẰNG CHỨNG** ở vùng
crown-jewel. Không secret nào lộ ⇒ không cần rotate.

> **Nhắc đã ỨNG NGHIỆM:** dòng cảnh báo cũ của §13 («reviewer có thể cùng kết luận SAI về deadlock»)
> đã được xử lý đúng cách — `santa-A` **từ chối suy luận** và chạy `EXPLAIN` thật trên
> `mediaos_be2b` để kiểm tiền đề EPQ (`status='open'` còn nguyên trong `Filter`, không bị bỏ vì được
> hàm ý bởi predicate của partial index). `database-reviewer` lần này cũng dựng **sổ khoá tường minh**
> gồm khoá ngầm RI (`FOR KEY SHARE` ở bước INSERT → nâng cấp lên `FOR NO KEY UPDATE` ở bước `+1`)
> thay vì kết luận suông. **Không có deadlock** — kết luận này giờ có căn cứ đo được.

### 13.1 Điểm HỘI TỤ — nhiều nguồn độc lập cùng chỉ MỘT lỗi

| # | Lỗi | Nguồn | Vá |
| --- | --- | --- | --- |
| **H-1** 🔴 | **Hai nhánh dịch `POLL_VOTE_PK`/`SINGLE_UQ` KHÔNG tới được** ⇒ `P-5a` đúng RỖNG, và dòng §12 «Bỏ vế dịch → P-5a ĐỎ» sai về nguyên lý. Cột «Thông điệp thực tế» của **cả 9 dòng** ĐO CỔNG trống | **4** (orchestrator · `santa-A` F2 · `santa-B` · `DB` M-3 · `SFH` H-2) | ✍️ **§12 đã sửa** — giữ code phòng thủ, ghi đúng sự thật. Ca đo thật = nợ (13.5) |
| **H-2** 🔴 | **Thiếu `p.deleted_at IS NULL`** ⇒ job đóng + phát NOTI-035 mang `poll_question` cho bài **đã xoá mềm**; người nhận bấm vào ăn 404, câu hỏi tái xuất hiện qua bảng `notifications` (sống lâu hơn bài). `044` không làm được vậy ⇒ hai nửa CÙNG một FSM khác luật | **5** (`Sec` F5 · `santa-A` F4 · `santa-B` F1 · `SFH` M-2 · orchestrator) | ✅ **ĐÃ VÁ** — `closeExpiredTx` +`EXISTS`, `enqueuePollClosedNotiManyTx` +`p.deleted_at IS NULL` |
| **H-3** 🔴 | **Job không chặn LÔ**: `closeExpiredTx` không `LIMIT`, handler bọc `1+2N+1` câu trong MỘT tx đang giữ khoá ghi trên N hàng ⇒ ghim connection PgBouncer (pool `max:20`, không `connectionTimeoutMillis`), **treo** mọi `041/042/044` trên cả lô, vỡ giữa chừng = rollback toàn phần. Đi ngược **luật thành văn** của `OutboxService.enqueueMany` | **4** (`DB` H-1 · `santa-A` F7 · `santa-B` F2 · `SFH` M-6) | ✅ **ĐÃ VÁ** — lô 200 + `FOR UPDATE SKIP LOCKED`, mỗi lô 1 tx, trần 50 lô, `enqueueMany`, `metadata.postIds` chặn 20 |
| **H-4** | **`lockPollRowTx` trả `void`, khớp 0 hàng = không khoá, không lỗi** — neo chống-đua DUY NHẤT của cả 3 đường ghi, chân trụ chứng minh không-deadlock | **3** (`Sec` F3 · `DB` L-1 · orchestrator) | ✅ **ĐÃ VÁ** — ném khi `rows.length !== 1` |
| **H-5** | **`insertVotesTx` trả `void`, không đối chiếu rowCount**, rồi `+1` bơm vô điều kiện ⇒ lệch **DƯƠNG** im lặng (rủi ro số 1 của §9) | **4** (`santa-A` F3 · `santa-B` F4 · `DB` H-2b · `SFH` L-1) | ✅ **ĐÃ VÁ** — `RETURNING option_id` + service ném khi lệch |
| **H-6** | **`040`: `asc(status)` trên `varchar`** ⇒ `'closed' < 'open'` ⇒ poll ĐÃ KẾT THÚC lên đầu; **không khoá phá-hoà duy nhất** ⇒ hàng lặp/MẤT giữa hai trang (`created_at` = mốc BẮT ĐẦU TX nên mọi poll tạo cùng tx giống hệt nhau) | **4** (orchestrator · `santa-B` F5 · `DB` M-1 · `santa-A` F10) | ✅ **ĐÃ VÁ** — `CASE WHEN status='open' THEN 0 ELSE 1` + `asc(id)` |
| **H-7** | **Một bất biến, HAI đồng hồ**: cổng ghi so `Date.now()` (APP), job so `now()` (DB) ⇒ app chậm δ thì phiếu vẫn được nhận trong δ sau khi hệ thống đã coi bình chọn hết hạn | **2** (`santa-A` F1 · `santa-B` F3) | ✅ **ĐÃ VÁ** — `PollForWrite.expired` tính TRONG SQL |
| **H-8** | **`Promise.all` ba câu trên CÙNG tx** ở `043` ⇒ ba snapshot READ COMMITTED ⇒ response có thể `Σ vote_count ≠ totalVoters` (FE tính tỉ lệ >100%) — đúng bất biến mà cả WO dựng lưới bảo vệ, vỡ ở **đường ĐỌC** | **3** (orchestrator · `santa-B` F6 · `DB` L-3) | ❌ **CHƯA VÁ** — xem 13.3 O-6 |
| **H-9** | **Thiếu deny-path**: 0 ca cross-tenant, 0 ca ngoài audience cho 5 route + job, 0 ca DENY cho cặp MỚI `create:feed-poll`. §5 liệt `P-4·P-5b·P-5c·P-6·P-9·P-12·J-3·J-4·J-5·N-035·C-6·N-dedupe` — **không mã nào tồn tại** trong kho | **3** (`Sec` F1+F2 · `SFH` H-1+M-7 · orchestrator) | ❌ **NỢ** — xem 13.5 |

### 13.2 Đã vá trong lượt gate (25 edit / 4 file · `tsc` + `eslint` sạch)

| Nguồn | Sev | Vá |
| --- | --- | --- |
| Hội tụ H-2 (5 nguồn) | HIGH | `closeExpiredTx` +`EXISTS (feed_posts … deleted_at IS NULL)`; `enqueuePollClosedNotiManyTx` +`p.deleted_at IS NULL` |
| `DB` H-1 + 3 nguồn | HIGH | `closeExpiredTx(tx, companyId, **limit**)` + sub-select `ORDER BY closes_at LIMIT $ FOR UPDATE SKIP LOCKED`, **giữ `AND status='open'` ở câu NGOÀI** để không mất lập luận EPQ đã đo; `run()` gặt theo lô 200, **mỗi lô MỘT tx**, trần `MAX_BATCHES_PER_RUN=50` |
| `DB` H-2 · `SFH` L-3 | HIGH | `bumpPollOptionVotes` nhận `pollId` + `AND poll_id = ${pollId}` vào vị từ UPDATE. Trước đó vị từ chỉ có `company_id`+`id` nên **không thể** phát hiện vế "thuộc poll" mà chính thông điệp lỗi của nó khẳng định — lưới nằm ở call-site, không ở hàm |
| Hội tụ H-5 (4 nguồn) | HIGH | `insertVotesTx` → `Promise<number>` + `RETURNING option_id`; `vote()` ném khi `written !== wanted.length` |
| `Sec` F3 · `DB` L-1 | MED | `lockPollRowTx` ném khi khoá 0 hàng |
| `santa-A` F1 · `santa-B` F3 | MED | `PollForWrite.expired` (`closes_at <= now()` trong SQL); `openPollForWriteTx` bỏ `Date.now()` |
| Hội tụ H-6 (4 nguồn) | MED | `listPollsTx`: `CASE WHEN status='open'` + `asc(feedPolls.id)` |
| `SFH` M-1 · `DB` M-2 | MED | NOTI-035 tập rỗng ⇒ **`logger.warn`** rồi mới `return` (luật thành văn của `social-noti-bridge.registrar.ts`, hai producer SOCIAL khác đã tuân) |
| `santa-A` F9 · `SFH` L-2 | LOW | `close()` bỏ `fresh ?? poll` → ném. `poll` là ảnh chụp TRƯỚC UPDATE ⇒ trả `status:'open'` cho poll vừa đóng |
| `DB` L-5 | LOW | dedupe `optionIds` chuẩn hoá `.toLowerCase()` — `Set` so CHUỖI, PG so `uuid`, Zod `.uuid()` nhận cả hai |
| `santa-A` F8 | LOW | `closeManualTx` MỘT mốc `now` cho cả `closedAt`+`updatedAt` |
| `Sec` F9 | LOW | bỏ import chết `ForbiddenException` |
| `DB` H-1 | LOW | `metadata.postIds` chặn 20 + cờ `postIdsTruncated` (mảng không giới hạn vào `jsonb` append-only = không gỡ được) |

**Bằng chứng không hồi quy:** `LANE_DB=mediaos_be2b` → **26 file / 394 test PASS, 0 fail, exit 0**;
`[S10-QA-ROUTEHTTP-1] Route HTTP coverage: 676/676 (100.0%) — CHƯA phủ: 0`.
🔴 **Lệch phải ghi:** baseline trước vá là **31 file / 504 test**; lượt này là tập `test:cov:social` +
`route-http-coverage` = **tập CON**. ~5 file / ~110 test chưa chạy lại. **Không được đọc thành parity.**
Điểm sáng: `social-poll-flags-structure.spec.ts` (ratchet tập cột câu đóng poll) **vẫn xanh** sau khi
`closeExpiredTx` bị viết lại — đó là rủi ro lớn nhất của lượt vá và nó không vỡ.

**Vá nào ĐÃ có ca hiện có đi qua:** `lockPollRowTx` · `insertVotesTx` rowCount ·
`bumpPollOptionVotes`+`poll_id` (mọi ca vote) · `expired` (`P-1`/`P-2`) · `closeExpiredTx` lô
(`J-1`/`J-2`, đường happy) · `close()` ném (`P-10`/`P-11`).
**Vá nào CHƯA có ca nào:** loại bài đã xoá mềm · NOTI `deleted_at` + WARN · thứ tự `040` ·
`enqueueMany` với lô > 1. ⇒ đều nằm ở 13.5.

### 13.3 Cần chữ ký owner

| # | Việc | Trạng thái |
| --- | --- | --- |
| ~~**S2**~~ | ✍️ **OWNER KÝ 23/09: doc 6 cột NGAY, `recountPollTx` mở WO nợ.** SPEC-16 §13.6 đã thành **6 cột** + ghi rõ «đối soát phải xuống tới TỪNG option» (lỗi trừ-sai-option cho Σ đúng). `recountPollTx` tách WO vì nó thêm **writer thứ hai** vào `feed_poll_options` — đúng chân trụ «không writer nào khác chạm bảng này» mà chứng minh không-deadlock đang đứng lên ⇒ phải qua lượt gate riêng | ✅ ĐÓNG (phần doc) · ⏳ nợ `recountPollTx` + SPEC-16 §13.6 thành 6 cột — ⏳ **Gate làm S2 GẤP HƠN:** `DB` H-2 chỉ ra một lỗ chờ làm `vote_count` lệch DƯƠNG mà **không script nào đối soát VÀ không hàm `recountPollTx` nào tồn tại** để sửa khi đã lệch (`restorePostTx` có đường tính lại cho `feed_posts`, poll thì không) |
| ~~S4~~ | ~~Actor audit của job~~ | ✅ ĐÓNG bằng phép đo U1 (xem §2.3) |
| ~~**S5**~~ | ✍️ **OWNER KÝ 23/09: đổi sang envelope NGAY.** `040` trả `{data,page,limit,total}` (khuôn `030`); `listPollsTx` thêm câu `count()` đi qua **CÙNG `innerJoin` + CÙNG `where`**; service nhận `page` thay `offset` để phép `(page-1)*limit` nằm đúng một chỗ. API-19 §6.4 đã sửa + ghi luật chung cho mọi danh sách offset | ✅ ĐÓNG — ⏳ Gate thêm **HAI** dữ kiện: (a) `040` trả **MẢNG TRẦN**, không envelope `{data,page,limit,total}` như `030` (khuôn mà chính plan khai) ⇒ FE-2 **không dựng được pager**, không phân biệt trang cuối với trang rỗng; (b) `FEED_PAGE_MAX=10_000` × `limit≤100` ⇒ `OFFSET 999_900` **không index nào phục vụ**, mở sẵn cho mọi người giữ `view:feed` |
| ~~**O-1**~~ | ✍️ **OWNER KÝ 23/09: 1 dòng/poll LUÔN** (không theo ngưỡng ≤50 của `SFH` M-5). Căn cứ tách khỏi tiền lệ `leave-accrual` là **bậc độ lớn**, không phải khẩu vị: leave-accrual sinh theo `nhân viên × kỳ` (tăng vô hạn theo thời gian), đóng poll sinh theo **số bình chọn có hạn** và mỗi poll đóng ĐÚNG MỘT LẦN. Thi công bằng `AuditService.recordMany` (MỘT câu INSERT nhiều hàng) — vòng `for` gọi `record()` là `N` round-trip trong tx đang giữ khoá, đúng hình dạng H-3 đã chặn | ✅ ĐÓNG (`objectId = closed[0].postId`). Hệ quả: poll thứ 2..N **không tra được** bằng `object_id` của chính nó (chỉ nằm trong `metadata.postIds`, thứ mọi màn lọc audit theo đối tượng không đọc); `044` ghi 1 dòng/poll ⇒ CÙNG một `action` có HAI hình dạng audit. T8 chốt vậy để chống bom rác (tiền lệ `leave-accrual` «~526k dòng/năm») và lý lẽ đó ĐÚNG — ⏳ `SFH` M-5 đề nghị: 1 dòng/poll khi `≤50`, rơi về dòng tổng hợp khi vượt. **Đổi hợp đồng trên bảng append-only ⇒ không tự quyết** |
| ~~**O-2**~~ | ✍️ **OWNER KÝ 23/09: GIỮ INNER JOIN — đây là LUẬT MODULE.** Dữ kiện quyết định mà plan không có: `social-groups.service.ts#isActiveRecipient` (NOTI-031, BE-2A **đã qua gate và đã ship**) dùng **đúng cùng hai vế**. Đổi riêng poll sang LEFT JOIN sẽ làm nó khác nhóm ⇒ muốn đổi phải đổi CẢ hai producer trong WO riêng. Đã ghi thành docblock để lượt gate sau không «phát hiện» lại; ca `N5b` gác cả hai vế (FSM vẫn chạy · người nhận rỗng) | ✅ ĐÓNG `employeeIdOf` trả `string \ — null` ⇒ tài khoản console/tích hợp **tạo được** bài+poll, nhưng INNER JOIN `employee_profiles` ⇒ họ **không bao giờ** nhận thông báo. Docblock cũ chỉ giải thích ca **nghỉ việc**, không ca **chưa bao giờ là nhân viên** — ⏳ Gate đã vá vế IM LẶNG (thêm `logger.warn`). Đổi INNER→LEFT JOIN là đổi **chính sách người nhận** ⇒ chữ ký owner |
| ~~**O-3**~~ | ✍️ **OWNER KÝ 23/09: GIỮ hành vi, thêm ca test** (theo `santa-A`, không theo `SFH` M-3). Ca `O-3` ở file chính chứng minh `[]` chỉ rút phiếu của CHÍNH người gọi (phiếu người khác còn nguyên) và idempotent ở lượt hai | ✅ ĐÓNG ⚠️ **HAI reviewer KHÔNG đồng ý nhau:** `SFH` M-3 gọi là lỗi câm, đòi 422 dẫn sang `042`. `santa-A` nói **có chủ đích, đã khai tường minh ở `social-api-polls.ts`**, và **xác minh cả 5 route dùng CÙNG cặp `view:feed`** ⇒ KHÔNG lách quyền `042` — ⏳ Orchestrator nghiêng về `santa-A`: giữ hành vi, thiếu sót thật là **không có ca test**. Owner chốt |
| **O-4** | **`M-5` của `database-reviewer` — CÓ TRƯỚC PR này:** `db/schema/social.ts` khai `.references()` **đơn-cột** cho `feedPollVotes.pollId/optionId/userId` + `feedPolls.postId`, nhưng DDL `0580` **không có FK đơn-cột nào** (chỉ composite tenant-FK ở `:408-422`). ⇒ `db:generate` lần tới sẽ đẻ ~5 `ADD CONSTRAINT` **không ai yêu cầu**, thêm khoá ngầm RI thứ hai trên đúng cặp bảng mà phân tích deadlock phải đếm | ⏳ **Ngoài phạm vi WO** — mở WO nợ, **đừng vá trong PR này**. Ghi vào `docs/erd-current.md` Phụ lục A |
| ~~**O-5**~~ | ✅ **ĐÃ CÓ LƯỚI** (`social-be2b1-polls-counters.int-spec.ts` đo `[vote_count, COUNT(*)]` theo TỪNG option; phép đo cổng ở **13.8**). Nguyên văn: **`santa-A` F6 — `C-2` chỉ assert Σ, không assert phân bố từng option.** Lỗi "trừ sai option" (`-1` vào B thay vì A) cho `Σ` đúng, `COUNT(*)` đúng, `CHECK >= 0` không chạm ⇒ **C-2 XANH** mà kết quả bình chọn sai NGƯỜI. Code hiện tại đúng ⇒ đây là lỗ của **LƯỚI** | ⏳ Rẻ: `counters()` trả thêm map `optionId → vote_count` + `COUNT(*) GROUP BY option_id`, assert từng cặp |
| ~~**O-6**~~ | ~~H-8 (`Promise.all` ba snapshot ở `043`)~~ | ✅ **ĐÃ VÁ 23/09** — gộp MỘT câu (`pollResultsTx`). Xem **13.7** |
| ~~**O-7**~~ | ~~`lock_timeout`/`statement_timeout` cho tx của job~~ | ✅ **ĐÃ VÁ 23/09** — `set local` mỗi lô. Xem **13.7** |

### 13.4 Ghi nhận — KHÔNG phải finding (để lượt sau không đo lại)

- **Không deadlock** — `santa-A` + `santa-B` + `database-reviewer` mỗi người dựng **sổ khoá tường minh**
  độc lập, gồm khoá ngầm RI (`FOR KEY SHARE` trên `feed_poll_options` ở bước INSERT → nâng cấp lên
  khoá ghi ở bước `+1`). Không thành deadlock vì: nâng cấp trong CÙNG tx không tự-deadlock; `FOR KEY
  SHARE` **không** xung đột với `FOR NO KEY UPDATE`; và chân trụ **D1b** kiểm được bằng GRANT + grep —
  mọi writer của `feed_poll_options` đi qua `lockPollRowTx` trước, nên hai tx cùng hàng option **buộc**
  đã tuần tự hoá trên hàng `feed_polls`. ⚠️ **D1b là bất biến mà KHÔNG sổ nào ép** (`DB` M-4) — xem 13.5.
- **EPQ re-check là THẬT, đã đo** (`santa-A`, `EXPLAIN` trên `mediaos_be2b`, có và không có RLS):
  `Filter: ((status)::text = 'open'::text)` **còn nguyên** — PG **không** bỏ qual dù nó được hàm ý bởi
  predicate của `idx_feed_polls_open_deadline`. ⇒ lập luận «NOTI-035 không nhân đôi» ĐÚNG. Đây là điểm
  mà reviewer **từ chối suy luận** và đi đo — đúng bài học của WO trước.
- **Migration:** WO này **không thêm migration nào**. `0580`/`0581` CÓ trong `_journal.json`
  (`:1738`, `:1745`) ⇒ không bẫy «migration thiếu journal bị bỏ qua». RLS+FORCE của 3 bảng poll tạo
  trong CÙNG `0580` ngay sau `CREATE TABLE`, TRƯỚC mọi dữ liệu; **không có backfill**.
- **Không đường CASCADE/retention nào làm mất phiếu mà đếm không giảm** (đã truy hết): 3 FK tenant đều
  `ON DELETE NO ACTION`; `company_id → companies` CASCADE = mất cả tenant; nghỉ việc = xoá MỀM;
  `feed_poll_votes` **không có `deleted_at`**; cả 3 bảng poll trong `PROTECTED_TABLES` của retention;
  **0 trigger** không-internal (đo trên PG sống); `feed_polls`/`feed_poll_options` **không có GRANT
  DELETE**, `feed_poll_votes` **không có GRANT UPDATE**.
- **Rò cử tri: sạch.** ⚠️ **Đính chính sau lượt vá 2** (`santa-B` F-4): dòng dưới đây viện dẫn
  `totalVotersTx` và `myVoteOptionIdsTx` — **hai hàm đó đã bị lượt vá O-6 XOÁ**, gộp vào
  `pollResultsTx`. Kết luận «sạch» vẫn đứng và còn CHẶT HƠN (`security-reviewer` lượt 2 đo lại:
  `mine` suy từ `o.id` của CHÍNH poll này, nên kể cả khi một hàng `feed_poll_votes` trỏ option của
  poll khác thì `myVote` vẫn không chở id lạ ra — `myVoteOptionIdsTx` cũ thì có). Giữ nguyên văn
  bên dưới làm sử liệu, đừng trích nó như mô tả code hiện tại.
  `totalVotersTx` trả con SỐ; `myVoteOptionIdsTx` ghim `userId = actor`;
  `readResultsTx` tập cột tường minh; **không `io.emit`/Gateway nào** trong module poll; `postDetail`
  không chở poll. `041`/`042` **cố ý không audit** — lý lẽ đứng được (`audit_logs` append-only +
  `object_id=postId` + `actor_user_id` **tái dựng được danh sách cử tri**, sống lâu hơn grant).
- **`assertCreatablePostType` không fail-OPEN:** `pair===null` chỉ đúng với `share`; lệch bảng ⇒
  `throw` DESYNC (không `return`); `isCompany()` ⇒ `undefined`/`null` **fail-closed**;
  `resolveStrongestScopes` index-aligned và trả `null` cho mọi phần tử khi lỗi hạ tầng. Chỉ **MỘT**
  call-site INSERT `feed_posts` trong toàn `src` ⇒ cổng phủ mọi đường tạo bài, và `social-be1-scope`
  R10 (nhánh `news`) vẫn ghim call-site đó.
- 🔴 **`Sec` F7 SAI — đã đo lại 23/09 và bác bỏ.** F7 khai «decorator chỉ `SetMetadata`, không
  header ⇒ **không khoá server-side nào**». Thực tế: `IdempotencyInterceptor`
  (`common/idempotency/idempotency.interceptor.ts`) đăng ký **toàn cục** qua `APP_INTERCEPTOR`
  (`idempotency.module.ts:20`), ĐỌC đúng metadata `IDEMPOTENT` đó và khoá thật qua Valkey —
  in-flight ⇒ 409, replay nguyên trạng + header `Idempotency-Replayed`, key dùng lại với payload
  khác ⇒ 409, handler ném ⇒ nhả khoá. Chính F7 tự mâu thuẫn khi viện dẫn «scope key đã gắn
  company+user+path+fingerprint» — thứ chỉ tồn tại NẾU interceptor có chạy.
  **Sự thật đúng nằm ở giữa:** khoá là THẬT nhưng **có điều kiện client gửi header**
  (`interceptor:72` — `key === "" ⇒ next.handle()`, back-compat có chủ ý). Nên lưới
  KHÔNG-ĐIỀU-KIỆN của `044` vẫn là `closeManualTx` `WHERE status='open'` + `RETURNING` (P-11 đã
  chứng minh). ✅ Docblock `044` + API-19 §6.6 đã sửa theo bản đo này (không theo F7).
  👉 Cùng họ [[check-is-null-branch-is-intent-not-guard]]: reviewer đọc MỘT nửa cơ chế rồi kết luận
  về cả cái. Hỏi «ai ĐỌC metadata này?» trước khi tuyên một decorator là vô dụng.
- **INFO:** không có rate limit trên 5 route (toàn hệ chỉ có `LoginRateLimiter`) — ngoài phạm vi WO,
  ghi để lượt sau không "phát hiện" thành lỗi của WO này.
- **CI CÓ chạy int-spec này:** `.github/workflows/api.yml` đặt `LANE_DB=mediaos` cho step Test ⇒
  không skip câm.

### 13.5 ✅ NỢ TEST — **ĐÃ ĐÓNG HẾT 7/7 ngày 23/09/2026** (phiên sau gate)

> Owner chốt lần đầu 23/09 (chi phí phiên): lượt gate **chỉ vá CODE, không viết test**. Bảng dưới là
> bản ghi NGUYÊN VĂN của lúc đó — giữ lại để đọc được lý lẽ từng ca. **Trạng thái hiện tại: cả 7
> nhóm đã có lưới, và mỗi lưới đã qua PHÉP ĐO CỔNG** (xem **13.8**).

| Nhóm | Đóng ở đâu |
| --- | --- |
| **N1** | `social-be2b1-polls-isolation.int-spec.ts` — ca `N1` (kèm đếm bài mồ côi trên DB: 403 mà vẫn ghi = cổng đặt sai chỗ) |
| **N2** | cùng file — `P-12` (5 route + liệt kê, bài `org_unit`) · `J-5` (2 tenant, 4 route + job + ALLOW đối chứng nhịp của B) |
| **N3** | cùng file — `J-4` qua `DiscoveryService` trên AppModule THẬT |
| **N4** | `src/social/social-poll-conflict-translate.spec.ts` (10 ca: 2 nhánh × 2 dạng lỗi, 4 vế phủ định, trần độ sâu `cause`) + `N4-db` (tên constraint có THẬT trong `pg_class`) |
| **N5** | isolation spec — `N5a` (bài xoá mềm) · `N5b` (tác giả không hồ sơ: FSM vẫn chạy, người nhận rỗng) |
| **N6** | `social-be2b1-polls-counters.int-spec.ts` — `P-4/O-5` · phân bố 2 người · `P-5b` · `P-5c` · `P-9` |
| **N7** | isolation spec (`J-3` · `N-035` người nhận · lô > 1 · audit 1 dòng/poll) · `src/notifications/social-noti-bridge.registrar.spec.ts` (`N-dedupe`) · file chính (`O-3` · thứ tự `040`) |

| # | Ca | Vì sao đắt/quan trọng | Giao ai |
| --- | --- | --- | --- |
| **N1** 🔴 | **DENY `create:feed-poll`** — actor có `view:feed`+`create:feed-post` nhưng KHÔNG `create:feed-poll` ⇒ 403 assert **đúng chuỗi** `POLL_CREATE_REQUIRED` + ALLOW đối chứng | Cặp quyền MỚI của WO, **chưa chạy lần nào** (`BASE_PAIRS` cấp cho cả 4 user). Đổi dòng `poll` của bảng sang cặp SÀN ⇒ mọi lưới vẫn XANH | QA WO kế |
| **N2** 🔴 | **Cross-tenant (`J-5`) + ngoài audience (`P-12`)** cho 5 route + job. File int-spec hiện gieo **MỘT** tenant, mọi bài `audience:'company'` | `listPollsTx` là **SQL MỚI** với `innerJoin` riêng; vế audience/tenant của nó **không có assert nào**. Bỏ `visiblePostCondition` khỏi mảng `where` ⇒ rò mọi câu hỏi bình chọn của cả công ty, suite vẫn 100% xanh | QA WO kế |
| **N3** 🔴 | **`J-4`** — AppModule THẬT, `Reflect.getMetadata(SYSTEM_JOB_HANDLER, …)` + `jobCode` xuất hiện ĐÚNG 1 lần | int-spec gọi `app.get(Handler).run()` ⇒ **đi tắt** qua `DiscoveryService`; + `NODE_ENV=test` làm scheduler TỰ TẮT. Gỡ `@SystemJobHandler()` ⇒ 504/504 vẫn XANH, PROD thì `closes_at` trôi mãi mà poll vẫn `open`, NOTI-035 **không bao giờ phát**. 4 handler khác CÓ ca này | QA WO kế |
| **N4** 🔴 | **Unit-spec `isUniqueViolationOf`** với lỗi giả `cause.code='23505'` + `cause.constraint` = TỪNG tên ⇒ 409 `ERR-017` | Đường HTTP **không tới được** hai nhánh này (H-1) ⇒ đây là cách DUY NHẤT đo chúng | QA WO kế |
| **N5** | **Bài đã xoá mềm**: poll quá hạn của bài trong thùng rác ⇒ job **KHÔNG** đóng, outbox = 0. Và tác giả không có `employee_profiles` ⇒ outbox 0 **kèm** WARN | Vá H-2 + WARN của lượt này **chưa có ca nào** | QA WO kế |
| **N6** | **`P-4`** (đổi phiếu A→B, từng-option) · **`O-5`** (`C-2` xuống mức từng option) · **`P-5b`/`P-5c`** · **`P-9`** | Bộ đếm nguy hiểm nhất module chỉ có lưới ở mức **tổng** | QA WO kế |
| **N7** | **`J-3`** (đua job ↔ `044`, outbox == 1) · **`N-035`** assert **người nhận** (hiện chỉ đếm outbox, không kiểm `recipientUserIds` = tác giả, không kiểm cử tri KHÔNG nhận) · **`N-dedupe`** · thứ tự `040` · `enqueueMany` lô > 1 · `optionIds: []` (O-3) | Tính chất phụ thuộc **hình dạng plan** của PG (EPQ) không có lưới chống hồi quy | QA WO kế |

### 13.6 Tài liệu §3.2 đòi «Cùng PR» mà **CHƯA làm**

`docs/API Design/API-19…` §5.1b (**M55**: spec ghi cặp của `poll` chỉ `create:feed-poll`, code đòi
**cả** `create:feed-post`) · §6.4 (**S5** offset cho `040`) · §6.6 (**D12** `044` idempotent — và giờ
phải sửa theo `Sec` F7: idempotency ép bởi `WHERE status='open'`, không bởi decorator).
Diff `5f8434c0..d0ac809f` **không chạm** file API-19. ⇒ nợ, ghi ở đây để không mất.

**Trạng thái sau lượt 23/09 (xem 13.7):** §5.1b ✅ đã sửa (kèm một dòng nói rõ cột cặp quyền là
SÀN ＋ theo-loại, để `idea`/`kudos` sau này không đọc sai lại) · §6.6 ✅ đã sửa **nhưng KHÔNG theo
F7** — F7 sai, xem 13.4 · §6.4 ⏳ **vẫn nợ**, chờ chữ ký owner S5.

---

### 13.7 Vá TIẾP SAU gate (lượt 23/09/2026, phiên sau)

> Lượt gate chỉ vá CODE của các finding hội tụ. Lượt này đóng nốt hai mục `⏳` mà **không cần chữ ký
> owner** (thuần kỹ thuật, không đổi hợp đồng API / chính sách người nhận / hình dạng audit).

| # | Vá | File | Vì sao chọn đường này |
| --- | --- | --- | --- |
| **O-6** (H-8) | Ba câu `Promise.all` → **MỘT câu** `pollResultsTx`: `vote_count` theo option + `EXISTS(...) AS mine` (tương quan) + `COUNT(DISTINCT user_id)` (KHÔNG tương quan ⇒ InitPlan, chạy 1 lần) | `social-polls.repository.ts` · `social-polls.service.ts` | `repeatable read` **không dùng được**: `041`/`042`/`044` gọi `readResultsTx` bên trong tx ĐANG GHI, đổi isolation giữa chừng là không hợp lệ. `FOR SHARE` giữ khoá đọc trên bảng phiếu — ngược hướng H-3. Gộp câu là đường duy nhất không đánh đổi gì. ⚠️ Ghi nhận thêm: `Promise.all` **che** lỗi này (trông như cửa sổ bằng 0) trong khi driver vẫn tuần tự hoá ba câu trên MỘT connection — chạy rời hay `Promise.all` hở như nhau |
| **O-7** | `set local lock_timeout='5s'` + `set local statement_timeout='30s'` ở ĐẦU mỗi tx-lô của job | `social-poll-close.job-handler.ts` | Tiền lệ `db.service.ts:199`. `SET LOCAL` **không nhận bind param** (giới hạn PG) ⇒ `sql.raw` với hằng literal của chính module. LOCAL = tự reset khi commit ⇒ an toàn PgBouncer. Ném ⇒ `JobRunner` finalize `'Failed'`, nhịp kế làm lại — vị từ gặt idempotent nên lùi không mất gì |
| **F7** | **Bác bỏ finding**, sửa docblock `044` + API-19 §6.6 theo bản ĐO | `social-polls.controller.ts` · API-19 | Xem 13.4 — interceptor toàn cục CÓ khoá thật, chỉ là **có điều kiện header** |
| **M55** | API-19 §5.1b: dòng `poll` thành `create:feed-post` **＋** `create:feed-poll` | API-19 | Đo ở `social-route-pairs.const.ts:108` (`postCreate` = cặp sàn, tầng 1) + `social-access.service.ts:161` (cặp theo loại, tầng 2) |
| **—** | **Plan doc hỏng:** một bản sao TOÀN VĂN (§0…§12, 510 dòng) bị chèn vào GIỮA ô bảng §13.2 ở commit `415a0ca7`, cắt ô `DB H-2 · SFH L-3` làm đôi | plan này | Gỡ bằng script có **chốt an toàn**: chỉ xoá sau khi so khối nghi-là-bản-sao trùng BYTE với bản gốc. 1169 → 658 dòng. Cùng họ [[bash-heredoc-eats-backslash-and-dies]] |

**Bằng chứng:** `pnpm --filter @mediaos/api typecheck` sạch · `eslint` 3 file sạch ·
`LANE_DB=mediaos_be2b` → `social-be2b1-polls.int-spec` + `social-poll-flags-structure.spec` +
`social-two-layer-guard-census.unit-spec` = **3 file / 27 test PASS, 0 fail, exit 0**.
⚠️ **KHÔNG phải parity toàn suite** — vẫn là tập CON như lượt gate (xem cảnh báo ở 13.2).

**Lượt hai của cùng phiên (sau khi owner ký 5 mục — xem 13.3):**

| # | Vá | File |
| --- | --- | --- |
| **O-1** | Audit job → **1 dòng/poll**; thêm `AuditService.recordMany` (MỘT câu INSERT nhiều hàng, dùng CHUNG `buildRow` với `record()` nên enum-guard/mask/`changed_fields` không thể trôi thành hai bản) | `events/audit.service.ts` · `social-poll-close.job-handler.ts` |
| **S5** | `040` → envelope `{data,page,limit,total}`; `count()` qua CÙNG join+where; service nhận `page` thay `offset` | `social-polls.repository.ts` · `.service.ts` · `.controller.ts` · API-19 §6.4 |
| **S2** | SPEC-16 §13.6 → **6 cột** (+`feed_poll_options.vote_count`), kèm luật «đối soát tới TỪNG option» và nợ `recountPollTx` ghi tường minh | `docs/SPEC/SPEC-16 SOCIAL.md` |
| **O-2** | Ghi INNER JOIN thành **luật module** trong docblock, dẫn chứng NOTI-031 đã ship | `social-polls.service.ts` |
| **O-3** | Giữ hành vi — đóng bằng CA TEST, không bằng đổi code | int-spec chính |
| **🔎 MỚI** | **Lưới N7 tìm ra một fail-open latent:** `PAYLOAD_KEYS` của bridge NOTI là allowlist **toàn module**, nên `actorUserId`/`actor_name` (có vì NOTI-028 cần) đi lọt được vào payload NOTI-035 — đúng thứ docblock `SocialPollClosedPayload` khẳng định là không có. Chưa bị khai thác (producer không set chúng), nhưng nó là tính chất TÌNH CỜ của producer chứ không phải luật. Vá: thêm `SOCIAL_POLL_CLOSED` vào `PAYLOAD_KEYS_DENIED` | `notifications/social-noti-bridge.registrar.ts` |

🔴 **CÒN NGUYÊN (cập nhật sau FULL gate lượt 2):**

| Nợ | Nguồn | Vì sao không vá ở PR này |
| --- | --- | --- |
| **O-4** — `.references()` đơn-cột trong schema mà DDL `0580` không có | plan §13.3 | Plan ghi rõ «đừng vá trong PR này». Mở WO + ghi `docs/erd-current.md` Phụ lục A |
| **`recountPollTx`** | owner S2 | Thêm **writer thứ hai** vào `feed_poll_options` ⇒ đụng chân trụ chứng minh không-deadlock ⇒ lượt gate riêng |
| **OFFSET sâu của `040`** (`page ≤ 10_000 × limit ≤ 100` ⇒ `OFFSET 999_900`) | `security-reviewer` LOW | **Vế (b) của S5 — tôi để RƠI khỏi sổ này ở bản đầu.** Chữ ký owner chỉ phủ envelope. ⚠️ Đính chính kèm theo: câu «không index nào phục vụ ⇒ mở sẵn cho mọi người giữ `view:feed`» ở §13.3 là **nói quá** — chi phí bị chặn bởi số poll của tenant, và `030` có đúng cặp trần này |
| **`PAYLOAD_KEYS` cấp MODULE, cổng theo-mã là blocklist** | `security-reviewer` M-3 + `santa-B` F-6 (2 nguồn) | Đảo thành allowlist theo-mã suy từ `TEMPLATE_KEYS` là đổi hình cổng NOTI của cả module ⇒ WO riêng. Đã kiểm: **không mã SOCIAL nào đang rò thật** |
| **`pollResultsTx` 0 hàng ⇒ `?? 0`** | `santa-B` F-2 | Hai reviewer KHÔNG đồng ý: `silent-failure-hunter` đo và nói `?? 0` là SỰ THẬT (FK `option_id` ⇒ 0 option thì 0 phiếu); `santa-B` nói câu hỏi đúng là «0 option có phải dị thường cần ỒN không», và chỉ ra `lockPollRowTx` cách đó 40 dòng vừa siết đúng hình dạng ấy. Chưa ai đo được có CHECK/trigger nào ép poll ≥1 option ⇒ **cần đo trước khi quyết** |
| **D-6 — timeout giữa lô xoá sổ tiến-độ-từng-phần** | `silent-failure-hunter` D-6 | Lô 1–5 đã commit thật mà run-row ghi `Failed, success=0`. Không mất dữ liệu, là lỗ BÁO CÁO. `JobRunner` có sẵn `'Partial'` |
| **Lưới cho O-6 / O-7 / D-1** | `santa-B` F-4 | Xem bảng «Lưới KHÔNG TỒN TẠI» ở 13.8 |

---

### 13.8 PHÉP ĐO CỔNG cho lưới MỚI — tháo lưới → xác minh ca ĐỎ → khôi phục

> 42 ca mới **xanh ngay lượt đầu**. Đó chính là hình dạng "xanh giả" mà §5 cấm tin, nên mỗi lưới
> đắt tiền đều bị tháo ra đo. Cột «Thông điệp thực tế» KHÔNG để trống — đó là lỗi mà chính §13.1
> H-1 đã bắt ở lượt gate trước.

| Lưới | Mutant (tháo gì) | Ca kỳ vọng ĐỎ | Thông điệp THỰC TẾ | Kết luận |
| --- | --- | --- | --- | --- |
| **N1** | bỏ `assertCreatablePostType` ở `create()` | `N1` | `expected 201 to be 403` | ✅ lưới SỐNG |
| **P-12** | bỏ `visiblePostCondition` khỏi `listPollsTx` | `P-12` | ``` `listPollsTx` là SQL MỚI — vế audience của nó phải có lưới: expected [ …(2) ] to not include '<postId>' ``` | ✅ lưới SỐNG |
| **J-4** | gỡ `@SystemJobHandler()` | `J-4` | `expected [ 'LMS_USER_SYNC', …(14) ] to include 'SOCIAL_POLL_CLOSE_EXPIRED'` | ✅ lưới SỐNG |
| **N5a** | bỏ `AND p.deleted_at IS NULL` trong `closeExpiredTx` | `N5a` | `bài trong thùng rác KHÔNG được đóng: expected 'closed' to be 'open'` | ✅ lưới SỐNG |
| **O-1** | audit quay về 1 dòng/lô (`closed.slice(0,1)`) | `O-1/N7` | `audit của <postId>: expected +0 to be 1` | ✅ lưới SỐNG |
| **O-5** 🔴 | `+1` bơm vào **`removed.length ? removed : wanted`** thay vì `wanted` | `P-4/O-5` | `A phải về 0 và B lên 1: expected [[1,0],[0,1],[0,0]] to deeply equal [[0,0],[1,1],[0,0]]` | ✅ lưới SỐNG — **đúng hình dạng O-5**: bộ đếm nói A=1 (thật 0), B=0 (thật 1), trong khi `Σ = COUNT(*) = 1` |

> 🔴 **Đính chính dòng O-5 (FULL gate lượt 2, `silent-failure-hunter` F-4).** Bản đầu của dòng này
> ghi mutant là «`+1` bơm vào `removed` thay vì `wanted`» — **không tái lập được**: lượt bỏ phiếu
> ĐẦU có `removed = []` và `bumpPollOptionVotes` trả sớm với mảng rỗng, nên `+1` thành no-op và ca
> đỏ ngay ở **neo dương bước 1**, không phải ở dòng 191 như thông điệp đã chép. Mutant THẬT đã chạy
> là biểu thức `removed.length ? removed : wanted` (giữ đúng bước 1, chỉ làm lệch bước ĐỔI phiếu).
> Thông điệp trong cột là thật; **mô tả mutant thì sai**, và một dòng đo cổng mô tả sai thì không
> dùng làm bằng chứng được. Cùng họ [[gate-measurement-row-can-be-unsatisfiable]] —
> [[mutant-red-must-match-expected-message]].

#### Lưới KHÔNG TỒN TẠI — ghi thẳng, không để trống (`santa-B` F-4)

> `santa-B` chỉ ra: **5/6 dòng trên là lưới cho lượt vá THỨ NHẤT**. Ba thay đổi rủi ro nhất của
> *lượt thứ hai* không có dòng mutant nào, và để trống thì đọc y hệt "đã đo".

| Thay đổi của lượt 2 | Có lưới không | Vì sao |
| --- | --- | --- |
| **O-6 / H-8** — `pollResultsTx` gộp 3 câu → 1 | 🔴 **KHÔNG** | Revert về `Promise.all` ba câu thì 42 ca vẫn xanh. Lỗi nó vá là **cửa sổ đua giữa hai câu**; muốn đo phải ghi đồng thời TRONG lúc đọc — không ca nào dựng được cửa sổ đó. Lưới thật nằm ở tầng khác: `EXPLAIN` đo được `total_voters` là InitPlan chạy 1 lần (gate lượt 2, `database-reviewer` A-1) ⇒ một câu = một ảnh chụp là tính chất CẤU TRÚC, không phải hành vi quan sát được từ test |
| **O-7** — hai dòng `set local` của job | 🔴 **KHÔNG** | Xoá cả hai ⇒ 42 ca vẫn xanh. Đo được thì cần giữ `FOR UPDATE` trên một hàng `feed_polls` từ `direct` quá 5s rồi assert `job().run()` reject — ca lane-DB chậm, chưa viết. `database-reviewer` A-7 đã đo được vế KHÁC (SET LOCAL reset đúng sau COMMIT **và** ROLLBACK), nhưng đó không phải lưới hồi quy |
| **S5** — envelope `040` | 🟡 **MỘT NỬA** | Ca `S5` đo hình dạng + `openOnly.total + closedOnly.total === all.total` (bắt được câu đếm rơi mất filter/join). Nhưng **không dòng mutant nào**, và vế «cùng ảnh chụp» thì ca không đo được — nó là ba lượt HTTP rời |
| **D-1** — `lock_timeout` phía request | 🔴 **KHÔNG** | Cùng lý do O-7. Ghi thành nợ |

⚠️ **Ghi trung thực hai điều, để lượt sau không đọc quá lời:**

1. Mutant **`AUDIENCE` KHÔNG làm `J-5` đỏ** — và đó là ĐÚNG: cô lập chéo tenant do
   `eq(feedPolls.companyId, …)` + RLS gác, không phải `visiblePostCondition`. Hai vế khác nhau,
   mỗi vế lưới riêng (`J-5` có lưới của nó: 4 route 404 + job + ALLOW đối chứng nhịp của B).
2. Dưới mutant O-5, ca **`C-2` (Σ) CŨNG đỏ** — nhưng bằng `expected 500 to be 200` ở một bước
   **SAU đó**, khi lệch tích luỹ đủ để đâm `chk_feed_poll_options_vote_count`. Nghĩa là Σ chỉ nói
   «có gì đó nổ», còn lưới từng-option nói **đúng bước nào, sai option nào**. Lệch DƯƠNG thuần thì
   CHECK không bao giờ chạm ⇒ chỉ lưới từng-option thấy.

**Lệnh đóng WO (đã cập nhật `test:cov:social` để gồm 3 spec mới):**

```
LANE_DB=mediaos_be2b pnpm --filter @mediaos/api test:cov:social
  → 29 file / 420 test PASS, 0 fail · coverage src/social 96.42% stmts, 88.94% branch
LANE_DB=mediaos_be2b … vitest run test/foundation/route-http-coverage.e2e-spec.ts src/events
  → 7 file / 53 test PASS · Route HTTP coverage 676/676 (100.0%), chưa phủ 0
tsc --noEmit sạch · eslint sạch (1 warning CÓ TRƯỚC ở `social.errors.ts`, ngoài diff)
```

Baseline trước phiên này: **25 file / 385 test**. ⇒ **+4 file / +35 test**, không ca nào đỏ.

---

## §14. FULL GATE LƯỢT 2 — chạy 23/09/2026 trên diff `415a0ca7..working tree`

Bốn reviewer độc lập (Opus 5) trên 1576 dòng diff + 3 file spec mới. Reviewer thứ năm
(`santa-method` A) bị **dừng giữa chừng theo lệnh owner vì chi phí phiên** ($685) — ghi ra đây để
không ai đọc bảng này thành "5/5 đã chạy".

| Reviewer | Verdict | Findings |
| --- | --- | --- |
| `security-reviewer` | ✅ **PASS** | 3 MEDIUM (latent) · 3 LOW · 1 NOTE |
| `database-reviewer` | ✅ **PASS** | 1 MEDIUM · 5 LOW · 2 INFO |
| `silent-failure-hunter` | 🔴 **BLOCK** | 4 MEDIUM · 4 LOW |
| `santa-method` B (đối kháng) | ⚠️ **PASS có điều kiện** | 4 MEDIUM · 2 LOW |
| `santa-method` A | — | **DỪNG vì chi phí** |

**KẾT LUẬN GATE: 0 CRITICAL · 0 HIGH.** Không reviewer nào tìm được lỗ rò cử tri, vượt tenant,
fail-open phân quyền hay injection. BLOCK duy nhất đứng trên **tính toàn vẹn của BẰNG CHỨNG**
(§13.8) và một lưới thiếu ở tầng service — không trên lỗi sản phẩm.

### 14.1 Điểm HỘI TỤ

| # | Lỗi | Nguồn | Xử lý |
| --- | --- | --- | --- |
| **G-1** 🔴 | **`listPollsTx` đếm bằng câu THỨ HAI ⇒ hai ảnh chụp READ COMMITTED** — dựng lại ĐÚNG lớp lỗi H-8 mà chính diff này gộp câu để đóng ở `pollResultsTx` 40 dòng bên dưới. Docblock cũ chỉ lập luận «cùng vị từ», không một lần nhắc «cùng ảnh chụp» | **4/4** | ✅ **ĐÃ VÁ** — `count(*) OVER ()` thành cột của chính câu lấy trang; bỏ hẳn câu đếm (phụ thu: hết một lượt quét tập thấy-được). Trang rỗng vượt-biên mới hỏi lại bằng câu đếm |
| **G-2** 🔴 | **Comment `P-5b`/`P-5c` khai đo nhánh 23505** mà H-1 chứng minh KHÔNG tới được qua HTTP — và chính spec anh em trong CÙNG changeset nói điều ngược lại | **3/4** | ✅ **ĐÃ VÁ** — viết lại cả hai comment; ghi rõ ca thật sự đo «bất biến trạng thái cuối dưới tải song song», và lưới của hai nhánh đó ở đâu |
| **G-3** | **`recordMany` không có trần** — 31 bind param/hàng, trần PG 65535 ⇒ vỡ ở **2113 hàng**; trần thật lại nằm ở module KHÁC (`SOCIAL_POLL_CLOSE_BATCH_SIZE`) | **3/4** | ✅ **ĐÃ VÁ** — `AUDIT_RECORD_MANY_MAX = 1000` + ném, kèm phép tính trong docblock |
| **G-4** | **`recordMany` không có lưới mask/enum** — bất biến đứng nhờ `entries.map(buildRow)`, là bằng chứng CẤU TRÚC chứ không phải lưới | **2/4** | ✅ **ĐÃ VÁ** — 4 ca vào `audit.service.spec.ts` (mask mọi hàng · enum sai ⇒ 0 câu INSERT · rỗng · vượt trần + neo dương tại trần) |
| **G-5** 🔴 | **§13.8 không toàn vẹn** — (a) dòng O-5 mô tả mutant SAI nên không tái lập được; (b) 5/6 dòng là lưới cho lượt vá THỨ NHẤT, ba thay đổi rủi ro nhất của lượt 2 không có dòng nào | **2/4** | ✅ **ĐÃ VÁ** — đính chính mutant O-5 + thêm bảng «Lưới KHÔNG TỒN TẠI» ghi thẳng O-6/O-7/S5/D-1 |

### 14.2 Finding ĐƠN NGUỒN đã vá

| # | Nguồn | Vá |
| --- | --- | --- |
| **F-3** 🔴 | `silent-failure-hunter` | **Hai nhánh `catch` dịch 23505 không có lưới ở tầng SERVICE.** Unit-spec `isUniqueViolationOf` đóng vế «hằng gõ sai», KHÔNG đóng vế «service dùng SAI hằng» — chép-dán làm cả hai dòng thành `POLL_VOTE_PK` xoá hẳn nhánh single-choice mà 42 ca vẫn xanh. ✅ Thêm `social-polls.service.vote-conflict.spec.ts` (5 ca, repo stub) |
| **F-2** | `silent-failure-hunter` | **Chạm trần `MAX_BATCHES_PER_RUN` báo cáo là `'Success'`** — tồn đọng vĩnh viễn và vô hình với mọi dashboard, vì `system_job_runs` là thứ người vận hành thật sự đọc. ✅ `metadata: { batches, batchCeilingHit }` |
| **D-1** | `database-reviewer` | **O-7 chỉ bó phía JOB; phía REQUEST vẫn chờ vô hạn.** Đo được: role `mediaos_app` có `lock_timeout=0` VÀ `statement_timeout=0` mức session, pool `max:20` không `connectionTimeoutMillis` ⇒ job giữ `FOR UPDATE` trên 200 hàng, người bỏ phiếu TREO im lặng, 20 request là cạn pool. ✅ `lock_timeout='3s'` trong `lockPollRowTx` + dịch `55P03` → 409 `POLL_WRITE_BUSY` |

### 14.3 PHÉP ĐO CỔNG cho lưới F-3 (mutant = đúng lỗi chép-dán mà finding mô tả)

| Mutant | Ca kỳ vọng ĐỎ | Thông điệp THỰC TẾ | Kết luận |
| --- | --- | --- | --- |
| Hai dòng `isUniqueViolationOf` đều thành `POLL_VOTE_PK` | nhánh `SINGLE_UQ` của `vote-conflict.spec` | `expected Error: Failed query to be an instance of ConflictException` | ✅ lưới SỐNG — và `social-poll-conflict-translate.spec.ts` **vẫn xanh 10/10**, chứng minh đúng luận điểm F-3: spec dịch cô lập MÙ với lỗi này |

### 14.4 Reviewer đo và BÁC BỎ lời của chính lượt vá

Ghi lại vì đây là phần đắt nhất của gate và sẽ tiết kiệm lượt sau:

- **`total_voters` ĐÚNG là InitPlan** — `EXPLAIN (ANALYZE, VERBOSE)`: `InitPlan 3 → Aggregate … count(DISTINCT v2.user_id), loops=1`, đúng ở CẢ hai kế hoạch. Docblock nói đúng.
- **`EXISTS … AS mine` RẺ HƠN docblock tự nhận** — PG **băm** thành `ANY (o.id = (hashed SubPlan 2).col1)`, `loops=1`, không chạy per-option. Comment «tương quan theo `o.id` — đó là chủ ý» **nói quá chi phí**.
- **`SET LOCAL` reset sau CẢ `COMMIT` LẪN `ROLLBACK`** — đo trực tiếp (`5s/30s` trong tx → `0/0` sau). Lập luận an-toàn-PgBouncer ĐỨNG.
- **`record()` và `recordMany()` sinh SQL CÙNG hình dạng** — reviewer đã NGỜ chúng khác (hành vi có thật ở vài phiên bản drizzle) rồi đọc nguồn `drizzle-orm@0.45.2` `pg-core/dialect.cjs:361`: cùng `colEntries`, khoá vắng đẩy thành từ khoá `default` (không tốn param). ⇒ «đi qua đúng một đường» đúng **cả ở tầng SQL**, không chỉ tầng `buildRow`.
- **`feed_poll_options.vote_count` là `integer`, KHÔNG `bigint`** ⇒ node-pg trả `number` ⇒ `toEqual([[1,1]])` của counters-spec đúng. ⚠️ Ai đổi sang `bigint` thì driver trả **string** và cả file counters đỏ oan.
- **`audit_logs_company_object_idx (company_id, object_type, object_id)` CÓ TỒN TẠI** ⇒ lý lẽ O-1 («1 dòng/poll thì tra được bằng `object_id` của chính nó») có index phục vụ, không phải lời suông.
- **Sổ khoá đầy đủ, gồm khoá NGẦM do RI**: thứ tự toàn hệ `feed_polls → feed_poll_votes → feed_poll_options → companies/users`; job dùng `SKIP LOCKED` nên **không bao giờ CHỜ** request ⇒ chờ một chiều ⇒ **không chu trình**. Và **toàn bộ SQL MỚI của lượt này thêm ĐÚNG 0 khoá hàng** (`pollResultsTx` không có node `LockRows`).

### 14.5 Bất đồng giữa reviewer — CHƯA giải, đừng đọc thành đã chốt

**`pollResultsTx` 0 hàng ⇒ `?? 0`:** `silent-failure-hunter` đo và kết luận đó là **SỰ THẬT**
(`feed_poll_votes.option_id` là FK vào `feed_poll_options` ⇒ 0 option thì 0 phiếu). `santa-B` nói
câu hỏi đúng không phải «0 có đúng không» mà **«0 option có phải dị thường cần ỒN không»**, và chỉ
ra `lockPollRowTx` cách đó 40 dòng vừa được siết vì đúng hình dạng ấy. **Chưa ai đo** có CHECK hay
trigger nào ép poll ≥1 option — phải đo trước khi quyết. Ghi ở 13.7 thành nợ.

### 14.6 Bằng chứng sau lượt vá gate

```
tsc --noEmit sạch
src/events/audit.service.spec.ts              → 27/27 PASS (gồm 4 ca recordMany MỚI)
src/social/social-polls.service.vote-conflict  → 5/5 PASS (MỚI)
src/social/social-poll-conflict-translate      → 10/10 PASS
```

⚠️ Con số toàn suite phải chạy lại sau lượt vá này — xem dòng cuối 13.8 để biết lệnh.

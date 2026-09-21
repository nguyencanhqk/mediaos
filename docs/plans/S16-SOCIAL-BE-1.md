# Plan S16-SOCIAL-BE-1 — Module `apps/api/src/social/` Nhóm A (19 route: bảng tin/bài 001-013 + bình luận 014-019)

> 🔴 Crown (permission guard 2 tầng + audience/ownership + đính kèm + audit). **Nguồn sự thật thi công = [API-19](<../API Design/API-19_SOCIAL_API_Design.md>) + [SPEC-16 §3/§8.1/§11/§12/§13/§16/§17/§18](<../SPEC/SPEC-16 SOCIAL.md>) + [DB-17 Track A](<../DB/DB-17 SOCIAL Database Design.md>)** + hai tiền lệ [S16-SOCIAL-DB-1](S16-SOCIAL-DB-1.md)/[S16-SOCIAL-DB-2](S16-SOCIAL-DB-2.md). File này KHÔNG lặp lại thiết kế API/DB — chỉ chốt **thứ tự thao tác, khuôn code cụ thể (file:line), các điểm chưa có tiền lệ phải tự thiết kế, và bằng chứng nghiệm thu**.
>
> Reasoning effort **xhigh**. **VÁ SAU REVIEW 21/09/2026** (11 điều kiện tự-mở-cổng của `plan-reviewer` + cảnh báo "nên vá") — bản này thay bản trước, không cần vòng review 2 nếu đủ 11 điều kiện.

---

## §0. Phạm vi & nợ mang sang

### 0.0 QUYẾT ĐỊNH ĐÃ CHỐT (owner, 21/09/2026): TÁCH `BE-1` thành `BE-1` (Nhóm A) + `BE-1B` (Nhóm B)

**Đã chốt, không còn là câu hỏi mở.** Đường cắt theo CỤM ROUTE của API-19 §5.1 (không cắt ngang một cụm):

| Nhóm | Cụm API-19 | Route | Bảng chạm | WO |
| --- | --- | --- | --- | --- |
| **A** | Bảng tin & bài (001–013) + Bình luận (014–019) | **19** | `feed_posts` · `feed_comments` · `feed_reactions` · `feed_mentions` · `feed_tags` · `feed_post_tags` · `feed_saved_posts` · `feed_post_views` | `S16-SOCIAL-BE-1` (WO này) — dựng TOÀN BỘ hạ tầng dùng chung (guard 2 tầng, audience/org_unit filter, IDOR helper, counter SQL atomic, room WS, module DI, đính kèm, cross-user preference reader) |
| **B** | Tin tức & ack (020–022) + Tìm kiếm/thẻ/profile/sinh nhật (023–026) + Báo cáo (027–029) | **10** | `feed_post_acks` · `feed_reports` | `S16-SOCIAL-BE-1B` (WO MỚI, `todo`, `depends_on: ["S16-SOCIAL-BE-1"]`) — thuần tiêu thụ hạ tầng Nhóm A |

**Lý do (tóm tắt, đã duyệt):** kiểm soát chi phí 1 phiên (khuôn PAYROLL BE-1..BE-5 hơn RECRUIT-BE-1); Nhóm A tự đứng được (đăng/sửa/xoá/bình luận/reaction/lưu/xem hoạt động đầy đủ không cần Nhóm B); rủi ro tách THẤP vì Nhóm B thuần tiêu thụ hạ tầng Nhóm A dựng; 2 lượt FULL gate hẹp hơn dễ bắt lỗi hơn 1 lượt rộng.

**Đã thực hiện TRONG PHIÊN VÁ NÀY (không phải việc để ngỏ):**
- `harness/backlog.mjs`: entry `S16-SOCIAL-BE-1` thu hẹp `title`/`done_when`/`paths` còn đúng Nhóm A; entry MỚI `S16-SOCIAL-BE-1B` đã tạo (`status:"todo"`, `depends_on:["S16-SOCIAL-BE-1"]`); `S16-SOCIAL-FE-1.depends_on` đã sửa thành `["S16-SOCIAL-BE-1","S16-SOCIAL-BE-1B"]`. Chi tiết xem commit/diff của `harness/backlog.mjs` cùng đợt vá này — **không lặp lại nội dung ở đây để tránh trôi**.
- Câu SAI ở bản trước ("Plan này KHÔNG tự sửa `harness/backlog.mjs`") đã bị XOÁ — `harness/backlog.mjs` đã NẰM TRONG `paths` từ trước (là 1 trong 4 nợ C3 phải thêm, xem §0.1b) và đã được sửa thật trong phiên vá này.

Mọi mục §1-§10 dưới đây **CHỈ còn phạm vi Nhóm A** (19 route). Nội dung Nhóm B đã dồn hết về §9 làm nợ tường minh cho `S16-SOCIAL-BE-1B`.

### 0.1 `depends_on` — đã đúng, không cần sửa

DB-1 plan §0.4 đã tự sửa `depends_on` của `S16-SOCIAL-BE-1` thành `["S16-SOCIAL-DB-1","S16-SOCIAL-DB-2"]`. Cả hai đã merge master (`9e17ae51`, `f68c3f78`, `a3637274`) — không nợ DB nào tồn đọng. `S16-SOCIAL-BE-1B.depends_on` chỉ cần `["S16-SOCIAL-BE-1"]` (kế thừa DB qua BE-1, không cần liệt lại DB-1/DB-2).

### 0.1b `paths` — 4 đường dẫn thêm (điều kiện C3)

Bản trước thiếu 4 `paths` mà việc thi công BE-1 CHẮC CHẮN phải chạm: `apps/api/src/config/openapi-modules.ts` (D12) · `apps/api/package.json` (D11, `test:cov:social`) · `apps/api/vitest.config.ts` (D11, per-file threshold) · `docs/_review/**` (§7, regen route-census). Đã thêm cả 4 vào `paths` của `S16-SOCIAL-BE-1` trong `harness/backlog.mjs` (phiên vá này). Đã CHỌN thêm thứ 5: `apps/api/src/foundation/**` — lý do ở D15 (sửa comment sai lệch ở `notification-event-catalog.const.ts:215`), KHÔNG ghi nợ vì đây là 1 dòng comment, sửa ngay rẻ hơn mở WO riêng.

### 0.2 `done_when` gốc — 3 điểm cần đính chính (đo được, không phải khẩu vị)

1. **"recycle-bin khôi phục trả lại đủ"** — **SỬA LẠI kết luận bản trước** (bản trước tuyên bố "nợ ĐÃ ĐÓNG", SAI — xem D10 và Phần 3/H4). Đo lại: đúng là 53 route API-19 không có route restore nào, và soft-delete là vị từ lọc thuần (không xoá quan hệ) — NHƯNG `recycle-bin.repository.ts:46-56` hard-code `employeeProfiles`, không có registry, VÀ SPEC-16 §3.6/§13.1/§7 CÓ hứa "thùng rác" cho bài trong khi API-19 không có route restore ⇒ đây là **drift SPEC↔API**, không phải "không có gì để đăng ký". `done_when` #3 cụm này sửa thành: *"soft-delete là vị từ lọc thuần; ca test khôi phục-thủ-công qua `restorePostTx()` nội bộ (D10) trả lại đủ đếm/quan hệ — KHÔNG có route HTTP restore ở BE-1; drift SPEC↔API ghi nợ §9, mở WO doc/BE-3 riêng"*.
2. **Coverage `social/` ≥85%** — không có cơ chế directory-level tự động (M12). `test:cov:social` (D11) đo tay; per-file threshold cho `social-access.service.ts` (crown-jewel) là cổng THẬT duy nhất.
3. **Route census "53"**: KHÔNG áp dụng cho BE-1. Sau riêng BE-1 (Nhóm A), route SOCIAL mới = **19** (không phải 29 — 10 route Nhóm B đã chuyển hẳn sang BE-1B). Baseline hiện tại (trước BE-1): `routes:632`.

### 0.3 Trong / ngoài phạm vi

**Trong phạm vi (Nhóm A — 19 route, `SOCIAL-API-001..019`):** bảng tin/bài (001-013), bình luận (014-019), guard 2 tầng (kèm cờ `tier1IsFloor` — D17), audience/org_unit filter trong SQL, IDOR helper đa hình (D6, cho reaction/mention — biến thể report dùng LẠI helper này ở BE-1B), counter atomic (D7), đính kèm ảnh/video (D18, MỚI so với bản trước), audit cho `manage:*`, outbox NOTI cho **3/9 event** (028/029/030 — SỬA so với bản trước, xem D15), WS 3 sự kiện, `@Idempotent()` trên 002/015, contracts DTO `.pick()+.strict()`, trần độ dài body/bình luận (D19, MỚI), hàm đọc `user_preferences` nhiều người dùng CHUNG 1 chỗ (D20, MỚI — hạ tầng cho BE-1B dùng), coverage `social/`.

**Ngoài phạm vi (chuyển `S16-SOCIAL-BE-1B`, xem §9):** route 020-029 (tin tức+ack, tìm kiếm/thẻ/profile/sinh nhật, báo cáo) — TOÀN BỘ, không còn thuộc WO này.

**Ngoài phạm vi (chuyển `S16-SOCIAL-BE-2`, không đổi so với bản trước):**
- `audience='group'` implement đầy đủ (EXISTS membership filter) — TỪ CHỐI 422 ở BE-1 (D1, **owner chốt 21/09/2026**). `feed_groups`/`feed_group_members` đã có schema (DB-2) nhưng chưa có route quản lý nhóm.
- `type IN ('idea','poll','kudos')` khi tạo bài — BE-1 chỉ nhận `type IN ('share','news')` (D2, **owner chốt 21/09/2026**).
- Nhóm/bình chọn/sáng kiến/vinh danh (route 030-051), thống kê (052-053).
- `apps/api/src/recycle-bin/**` — ngoài `paths`.
- Migration/schema mới — không, mọi bảng đã tồn tại từ DB-1/DB-2.
- Bật `modules.is_active` SOCIAL, sidebar, 3 màn FE — `S16-SOCIAL-FE-1`.

### 0.4 Rollback / feature flag

Rollback = revert PR (không có dữ liệu di trú, module mới hoàn toàn). `modules.is_active` cho SOCIAL do `S16-SOCIAL-FE-1` bật (khuôn mig `0567`) — BE-1 route sống nhưng không lộ ra FE tới khi FE-1 bật cờ.

---

## §1. Bảng phép đo M1..M18 (mọi dòng có `file:line`, chưa đo ⇒ ghi rõ)

| # | Nội dung | Kết luận | Nguồn |
| --- | --- | --- | --- |
| M1 | Wildcard `*:*` có mở `feed-*` không | **CÓ, với MỌI cặp `feed-*` — vì cả 14 cặp SOCIAL đều `is_sensitive=false`.** `decideCan()` (`apps/api/src/permission/permission.decide.ts:57-61` `matchesCompanyGrant`) → nhánh Priority 4 (`:162-172`) trả `allow:true` khi `effectivelySensitive===false`. Đây là hành vi **THIẾT KẾ CỦA ENGINE, áp dụng toàn hệ thống**. Ca test cụ thể minh hoạ bằng route `GET /social/reports` (`view:feed-report`) — route đó thuộc **Nhóm B**, nên ca test CỤ THỂ (W1 gốc) đã CHUYỂN sang §9 nợ BE-1B; kết luận M1 (foundational, áp dụng cho MỌI cặp `feed-*` kể cả của Nhóm A) vẫn giữ ở đây làm bối cảnh cho review permission của BE-1. | `apps/api/src/permission/permission.decide.ts:57-61,103,129-172` |
| M2 | Guard 2 tầng — tên thật + khuôn | `@RequirePermission(action,resourceType,{isSensitive?,requiresReauth?})` (`apps/api/src/permission/require-permission.decorator.ts:18-23`); `PermissionGuard` (`apps/api/src/permission/guards/permission.guard.ts:41-158`) fail-closed 403 nếu THIẾU decorator (`:78-85`). Tầng 2 = khuôn RECRUIT: `RECRUIT_ROUTE_PAIRS` (`apps/api/src/recruit/recruit-route-pairs.const.ts:20-93`) dùng CHUNG cho decorator + `RecruitAccessService.resolveActor()` (`apps/api/src/recruit/recruit-access.service.ts:46-84`). Census 2 tầng: `apps/api/test/foundation/recruit-two-layer-guard-census.unit-spec.ts` (dùng `collectRoutes` từ `route-census.ts`). | như trên |
| M3 | Route yêu cầu cặp THEO BODY (002) hoặc THEO TRƯỜNG (006) — có tiền lệ không | **KHÔNG có tiền lệ 1:1.** `RECRUIT_ROUTE_PAIRS`/`PAYROLL_ROUTE_PAIRS` đều 1 route = 1 cặp tĩnh. Tiền lệ GẦN: `payroll-report-source-pairs.unit-spec.ts` — "route có kiểm tra BỔ SUNG ngoài bảng hằng phẳng" được khai riêng, không nới bảng hằng. 002/006 SOCIAL là thiết kế MỚI D4/D5, được đóng khung bằng cờ `tier1IsFloor` (D17, MỚI trong lần vá này — không có ở bản trước). | `apps/api/src/recruit/recruit-route-pairs.const.ts` · `apps/api/test/foundation/payroll-report-source-pairs.unit-spec.ts:12` |
| M4 | Khuôn module gần nhất — CHAT reactions/attachments/mentions | `ChatReactionsService.react/unreact` (`apps/api/src/chat/chat-reactions.service.ts:48-87`): emit WS SAU khi `await withTenant` resolve, CHỈ khi `changed===true` (`:64,86`). `parseEmoji` (`:122-128`). `ChatAttachmentPresignService.decorate` (`chat-attachments.service.ts:92-116`): presign PHẢI gọi NGOÀI transaction caller (jsdoc `:79-83`); fail-soft `url:null` khi deny (`:217`). `ChatAccessService.assertMessageAccess` (`chat-access.service.ts:252-346`): MỘT JOIN, MỘT thông điệp 404 cho MỌI lý do — khuôn cho `SocialAccessService.assertPostVisible`. **Dùng lại NGUYÊN KHUÔN NÀY cho `social-attachments.service.ts` (D18).** | file:line như trên |
| M5 | Khuôn RECRUIT guard tầng 2 + masking | `RecruitAccessService.resolveActor` (`recruit-access.service.ts:46-84`): resolve N cặp scope 1 lượt bằng `dataScope.resolveManyOrNull` (mảng THEO CHỈ SỐ), assert cặp CHÍNH (`:62-65`), sàn scope Company cho cặp `companyFloor:true` (`:69-73`). `RECRUIT_ROUTE_PAIRS` là NGUỒN SỰ THẬT DUY NHẤT cho decorator + tầng 2 + census. | như trên |
| M6 | Cách gọi `withTenant` + audit + outbox CÙNG transaction | Khuôn RECRUIT `candidates.service.ts:233-262`: `audit.record(tx,...)` RỒI `outbox.enqueue(tx,{eventType,payload})` TRONG CÙNG `tx`. `EventsModule` là `@Global` (`recruit.module.ts:35`) ⇒ không cần import trong `social.module.ts`. | `apps/api/src/recruit/candidates.service.ts:233-262` · `apps/api/src/events/outbox.service.ts:16-39` · `apps/api/src/events/audit.service.ts:103-118` |
| M7 | Đẩy WS SAU commit | `RealtimeEmitterService` docblock (`realtime-emitter.service.ts:1-52`): MỌI method gọi SAU KHI tx COMMIT. `emitToRoom` (`:501-515`) bọc try/catch, không throw. Payload luôn `.parse()` Zod TRƯỚC khi emit. | `apps/api/src/realtime/realtime-emitter.service.ts` |
| M8 | Room naming + gate lúc join | `co:{companyId}:...` (ADR-0013, `rooms.ts:3-4`). `RealtimeGateway.handleConnection` (`realtime.gateway.ts:127-197`): join `userRoomName` trước; check `permission.can()`, thiếu ⇒ fail-SOFT không disconnect (`:145-157`); join room thật SAU KHI qua cổng. **BE-1 PHẢI THÊM bước join/gate `co:{c}:feed` tại `handleConnection` — bản trước chỉ nói "emit", THIẾU bước join (đã vá ở §7 Bước 1, mục 13b).** | `apps/api/src/realtime/rooms.ts` · `apps/api/src/realtime/realtime.gateway.ts:79-197` |
| M9 | `@Idempotent()` cơ chế đầy đủ | Decorator `idempotency.decorator.ts:14`. `IdempotencyInterceptor.intercept` (`idempotency.interceptor.ts:55-124`): khoá `sha256(companyId,userId,method,path,client-key)` (`:130-136`); khác payload ⇒ 409 `KEY_REUSED` (`:103-109`); lỗi handler ⇒ nhả khoá (`:116-120`). TTL 900s. Route cần: `002`, `015` (Nhóm A — `027` thuộc BE-1B). | `apps/api/src/common/idempotency/*.ts` |
| M10 | Route census + OpenAPI enrich cơ chế | `collectRoutes()` (`route-census.ts:127-207`) so khớp artifact `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` qua `route-guard-coverage.e2e-spec.ts:260-284`. Baseline hiện tại: `{routes:632,...}`. BE-1 (Nhóm A) thêm **19** route, không phải 29. Regen: `ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts`. | `apps/api/test/foundation/route-census.ts` |
| M11 | Module OpenAPI tag `SOCIAL` — tiền đề SAI trong API-19 §5.1 | API-19 §5.1 SAI khi nói "fbpost đã khai tag SOCIAL". `API_MODULE_TAGS` (`openapi-modules.ts:38-160`) KHÔNG có entry `SOCIAL`. Route fbpost (`GET /api/v1/integrations/social/sso-link`) có segment đầu `"integrations"` — thuộc FND, KHÔNG đụng SOCIAL (segment `"social"`). ⇒ chỉ cần THÊM entry mới, KHÔNG đụng FND. | `apps/api/src/config/openapi-modules.ts` · `apps/api/src/integrations/social/social-sso.controller.ts` |
| M12 | Coverage ≥85% `social/` — cơ chế enforcement | KHÔNG có cơ chế per-directory (`vitest.config.ts:96-352`). `test:cov:recruit`/`asset`/`room` đo được nhưng KHÔNG gate. ⇒ D11: thêm `test:cov:social` + per-file threshold cho `social-access.service.ts`. | `apps/api/vitest.config.ts:96-352` · `apps/api/package.json:14-17` |
| M13 | Ratchet có thể bị BE-1 làm đỏ | `param-uuid-ratchet.unit-spec.ts:67,179-197`: `UNPIPED_CEILING=1` đã dùng hết. 19 route Nhóm A có nhiều `:post_id`/`:comment_id` — THIẾU `ParseUUIDPipe` Ở BẤT KỲ đâu ⇒ ĐỎ NGAY (D14). CLEAN_PREFIXES (`:128-151`) chưa có `"social/"` — thêm ở §7 Bước 2 (D19 cùng chỗ). | `apps/api/test/foundation/param-uuid-ratchet.unit-spec.ts` |
| M14 | `search_vector` — migration đã tạo | Thuộc route `023` (tìm kiếm) — **Nhóm B, chuyển BE-1B.** Ghi lại nguồn cho BE-1B: `apps/api/migrations/0577_s16socialdb1_feed_track_a_ddl.sql:510-542`. Không còn liên quan trực tiếp BE-1, giữ hàng này để KHÔNG mất thông tin khi BE-1B mở plan riêng. | `apps/api/migrations/0577...sql:510-542` |
| M15 | Mention — khuôn TASK + khác biệt BẮT BUỘC | `task-comments.service.ts:296-313`: input `mentionEmployeeIds: string[]`, lỗi THROW. **SOCIAL PHẢI NGƯỢC LẠI** theo SPEC-16 §12 `ERR-009`: mention ngoài audience BỊ BỎ IM LẶNG, 201 kèm `data.droppedMentions[]`. `feed_mentions` là bảng mention THẬT đầu tiên trong repo. | `apps/api/src/tasks/task-comments.service.ts:55-58,296-313` |
| M16 | Counter denormalized — khuôn atomic | `tasks.repository.ts:416-433` (`allocateSequenceTx`) và `chat-messages.repository.ts:94-109` (`allocateRoomSeq`) — `UPDATE...RETURNING` khoá hàng cha CÙNG transaction. Dùng cho `like_count`/`comment_count`/`view_count`/`usage_count` — memory `clamp-must-be-sql-not-js`. | `apps/api/src/tasks/tasks.repository.ts:416-433` · `apps/api/src/chat/chat-messages.repository.ts:94-109` |
| M17 | Sinh nhật — cột + preference + query day/month | Route `026` là **Nhóm B, chuyển BE-1B.** NHƯNG hàm đọc `user_preferences` NHIỀU người dùng (dùng bởi `026` ở BE-1B) được **DỰNG ở BE-1** (D20, Phần 3 cảnh báo) vì đây là hạ tầng chung, không riêng sinh nhật. `date_of_birth` ở `employee_profiles` (`employees.ts:66`). `user_preferences` (`user-preferences.ts:24-63`, comment `:18-19`: "CROSS-USER KHÔNG do RLS — ép ở BE"). | `apps/api/src/db/schema/employees.ts:66` · `apps/api/src/db/schema/user-preferences.ts:18-19,24-63` |
| **M18** | **(MỚI)** Cấp `manage:feed-news` và `manage:feed-post` — có lệch vai canonical không (đo cho quyết định C1/D5) | **KHÔNG lệch — cấp cho ĐÚNG CÙNG tập vai canonical `hr` + `company-admin`.** Nguồn: `apps/api/migrations/0578_s16socialdb1_permission_seed.sql:92-95` và `docs/spec/SPEC-16 SOCIAL.md` §11.1 dòng 8-9. ⇒ chọn `manage:feed-post` làm tầng-1 (floor) cho route `006` có **0 tác động lên vai canonical hôm nay**. Dư lượng DUY NHẤT: role TUỲ BIẾN của tenant có `manage:feed-news` mà KHÔNG có `manage:feed-post` sẽ bị 403 Ở TẦNG 1 khi gọi `006` dù chỉ định đổi `pinned` — **ghi nợ BE-2 ở §9, KHÔNG xử lý ở BE-1.** | `apps/api/migrations/0578_s16socialdb1_permission_seed.sql:92-95` · `docs/spec/SPEC-16 SOCIAL.md §11.1 dòng 8-9` |

**CHƯA ĐO (giữ nguyên, không suy diễn):**
- Regex parse hashtag `#tag` — 0 tiền lệ. Tự thiết kế D8.
- `departmentOrgUnitIds()` (`data-scope.service.ts:161-166`) không đệ quy cây con — D13 (nay là quyết định NGHIỆP VỤ cần owner ký, xem §2).
- Coverage % thật của `social/` — chưa tồn tại, không đo trước được.
- Hằng số CHAT tương ứng cho giới hạn đính kèm (D18) — SPEC-16 §16 cho số (≤10 ảnh/bài·≤1 video·≤20MB/tệp) dùng làm chuẩn; KHÔNG đo lại hằng CHAT numeric (chỉ mượn KHUÔN CODE của `chat-attachments.service.ts`, không mượn SỐ).
- Hằng CHAT cho trường `note`/`resolutionNote` dạng ngắn (D19) — KHÔNG có tiền lệ tương đương trong CHAT (chỉ có `body` dài `packages/contracts/src/chat.ts:323: max(4000)`); trần cho `note`/`resolutionNote` là quyết định MỚI, không phải mirror đo được.

---

## §2. Các quyết định phải chốt (D1..D20)

| # | Quyết định | Chốt | Lý do | Hệ quả nếu sai |
| --- | --- | --- | --- | --- |
| **D1** | `audience='group'` (**owner chốt 21/09/2026**) | **TỪ CHỐI 422** (`SOCIAL-ERR-008`) | `feed_groups` rỗng (chưa có route tạo nhóm) ⇒ filter EXISTS không test được thật | Implement nửa vời, không test được thật, rủi ro fail-open không phát hiện |
| **D2** | `type` BE-1 chấp nhận ở `POST /social/posts` (**owner chốt 21/09/2026**) | **CHỈ `share`/`news`** — `feedPostCoreSchema.pick(...).extend({type: z.enum(['share','news'])})` | `idea`/`poll`/`kudos` thuộc BE-2 | Trùng công, 2 nguồn sự thật khi BE-2 mở lại |
| **D3** | Mass-assignment — `.pick()` từng DTO | KHÔNG BAO GIỜ `.extend()` thẳng `feedPostCoreSchema` | cảnh báo sẵn trong `packages/contracts/src/social.ts:279-286` | Tự duyệt/tự ghim/tự sửa trạng thái |
| **D4** | Cặp quyền tầng-1 (decorator) cho `SOCIAL-API-002` — **SỬA (H1)** | **`@RequirePermission("create","feed-post")`** làm SÀN (KHÔNG còn là `view:feed` như bản trước) | Ở phạm vi D2 (chỉ `share`+`news`), CẢ HAI loại đều bắt buộc `create:feed-post` (API-19 §5.1b) ⇒ dùng nó làm sàn có **0 rủi ro 403 oan hôm nay** — chặt hơn `view:feed` nhưng đúng ngữ nghĩa "phải có quyền tạo bài mới được vào route tạo bài", tránh hiểu lầm route "không gate" khi đọc decorator | Cờ `tier1IsFloor:true` (D17) — tầng 2 CÒN check thêm `manage:feed-news` cho nhánh `type=news`. Nợ §9 cho BE-2: khi mở poll/idea/kudos, cặp tầng-1 phải thiết kế lại |
| **D5** | Cặp quyền tầng-1 cho `SOCIAL-API-006` — **SỬA theo C1 phương án (b)** ⚠️ quyết định KỸ THUẬT của phiên (căn cứ phép đo M18), **CHƯA có chữ ký owner** | **`@RequirePermission("manage","feed-post")`** làm SÀN (KHÔNG phải `view:feed`, KHÔNG tách route, KHÔNG sửa API-19) | M18: `manage:feed-post`/`manage:feed-news` cấp CÙNG vai canonical ⇒ 0 tác động hôm nay. Route GIỮ NGUYÊN 1 route | Cờ `tier1IsFloor:true` (D17) — tầng 2 check `manage:feed-news` RIÊNG cho nhánh `pinned`. Dư lượng: role tuỳ biến chỉ có `manage:feed-news` bị 403 Ở TẦNG 1 khi gọi route này (kể cả chỉ đổi `pinned`) — **nợ BE-2 ở §9, KHÔNG xử lý ở BE-1** |
| **D6** | IDOR đa hình — hàm dùng chung | `SocialAccessService.assertTargetVisible(tx, actor, targetType, targetId)` — `targetType='post'`\|`'comment'`. Biến thể `targetType='report'` (bảng `feed_reports`) dùng LẠI hàm này nhưng thuộc BE-1B (route 027 ngoài phạm vi) | `feed_reactions`/`feed_mentions` (Nhóm A) và `feed_reports` (Nhóm B) đều KHÔNG FK (đa hình, DB-17 §11 R1) | Thiếu ⇒ actor cùng tenant tạo được reaction/mention trỏ vào bài `hidden`/`org_unit` khác actor không thấy được |
| **D7** | Counter atomic | `UPDATE feed_posts SET like_count = like_count + $delta WHERE id=$1 AND company_id=$2 RETURNING like_count` — CÙNG `tx` | memory `clamp-must-be-sql-not-js` | Race 2 lượt thích đồng thời → đếm sai |
| **D8** | Hashtag parse | Regex Unicode-aware `#([\p{L}\p{N}_]+)/gu`, lowercase, `varchar(64)`, upsert `feed_tags ON CONFLICT DO NOTHING` + `feed_post_tags` + `usage_count+1` CÙNG tx | Không tiền lệ; Unicode bắt buộc cho hashtag tiếng Việt có dấu | Regex ASCII-only bỏ sót hashtag có dấu |
| **D9** | Sinh nhật — query ngày/tháng | **CHUYỂN §9 — thuộc route `026`, ngoài phạm vi BE-1 (Nhóm B).** Giữ chỗ trong bảng này để BE-1B kế thừa nguyên quyết định khi mở plan riêng: `SELECT employee_id, full_name, avatar_url, EXTRACT(DAY/MONTH FROM date_of_birth)::int` — tập cột TƯỜNG MINH, `date_of_birth` KHÔNG BAO GIỜ xuất hiện trong SELECT list. | — | — |
| **D10** | Recycle-bin / khôi phục — **SỬA (H4, ĐÍNH CHÍNH kết luận SAI của bản trước)** | KHÔNG dựng route restore ở BE-1 (đúng, không đổi). **NHƯNG:** viết hàm nội bộ `restorePostTx(tx, postId)` (đối xứng thật — khôi phục counter cha khi flip `deleted_at=NULL`, dùng trong test R18 VÀ để sẵn cho WO restore sau); và **KHÔNG tuyên bố nợ recycle-bin "đã đóng"** — `recycle-bin.repository.ts:46-56` hard-code `employeeProfiles`, không registry, trong khi SPEC-16 §3.6/§13.1/§7 hứa thùng rác cho bài ⇒ **drift SPEC↔API**, ghi nợ §9 + mở WO doc/BE-3 riêng | Mâu thuẫn thật: `done_when` gốc #2 đòi "biến khỏi đếm trong cùng tx" (giảm counter lúc xoá), còn SPEC-16 §16 (`SPEC-16 SOCIAL.md:446`) đòi counter "đảo ngược được" khi khôi phục — nếu giảm counter lúc xoá mà không có hàm khôi phục đối xứng, `UPDATE...SET deleted_at=NULL` thủ công KHÔNG phục hồi counter | Thiếu `restorePostTx` ⇒ R18 hoặc đỏ hoặc bị viết yếu cho xanh (chỉ flip cột, không phục counter, test "xanh giả") |
| **D11** | Coverage gate | `test:cov:social` (khuôn `test:cov:recruit`) + per-file threshold cho `social-access.service.ts` (khuôn `payroll-access.service.ts` 90/90/90/90) | M12 | `done_when` "≥85%" bị hiểu nhầm là cổng CI tự động — phải NÊU RÕ trong PR là số đo tay |
| **D12** | OpenAPI module tag | Entry MỚI `{code:"SOCIAL", tagPrefix:"Social", description:"...", segments:["social"]}` chèn SAU khối CHAT, TRƯỚC khối FND | M11 | Thiếu ⇒ `openapi-contract.e2e-spec.ts` ĐỎ ngay route đầu |
| **D13** | Audience `org_unit` — phạm vi — **NÂNG thành quyết định NGHIỆP VỤ cần owner ký (Phần 3 cảnh báo)** | Đúng-BẰNG `org_unit_id` của bài (KHÔNG suy diễn cây con) — dùng `dataScope.departmentOrgUnitIds(ctx)` | Không có hạ tầng cây con thật (M1 §1); API-19 §5.1b: `orgUnitId` là 1 khoá đơn | **❗ HỆ QUẢ NGHIỆP VỤ CẦN OWNER KÝ TRƯỚC KHI THI CÔNG:** manager của đơn vị **CHA** sẽ KHÔNG đọc được bài của đơn vị **CON** (không có suy diễn cây), dù trực giác quản lý thường mong "thấy được cả cây con mình phụ trách". Nếu owner không đồng ý hệ quả này, D13 phải đổi TRƯỚC khi code chạy |
| **D14** | `ParseUUIDPipe` | BẮT BUỘC ở MỌI param `:id`-dạng của 19 route, khai CẤP METHOD | M13 — ratchet ceiling=1 đã dùng hết | Thiếu ⇒ `param-uuid-ratchet.unit-spec.ts` ĐỎ ngay |
| **D15** | NOTI event nào BE-1 thực sự EMIT — **SỬA (H5, thu hẹp so với bản trước)** | **3/9: `NOTI-EVENT-028`(mention)·`-029`(bình luận vào bài của tôi)·`-030`(trả lời).** `-031`(tin tức mới) và `-036`(bài bị báo cáo) **CHUYỂN sang nợ BE-1B** (dù route tạo tin tức `002` là Nhóm A, việc PHÁT thông báo "tin tức mới" gắn với luồng ack/đọc thuộc Nhóm B — quyết định KỸ THUẬT của phiên: giữ notify này ở BE-1B để không tách rời khỏi luồng ack; **CHƯA có chữ ký owner**). 4 còn lại (032-035) vẫn thuộc BE-2, không đổi | Registrar outbox (`notification-event-catalog.const.ts:215`) hiện ghi SAI "đăng ký ở BE-2" cho CẢ khối SOCIAL — BE-1 phải SỬA comment này vì BE-1 CẦN đăng ký 3 mã (028/029/030) NGAY, không thể đợi BE-2 (`registerSource()` fail-loud nếu mã chưa registered mà đã emit) | Emit nhầm event chưa thuộc phạm vi BE-1 = outbox rác; registrar thiếu mã BE-1 cần = fail-loud lúc boot |
| **D16** | Thứ tự thi công NỘI BỘ Nhóm A — **SỬA (repurpose, D16 gốc về A-trước-B nay VÔ NGHĨA vì B là WO khác)** | Xem §7: hạ tầng dùng chung → bài → reaction → bình luận → mention/hashtag/đính kèm → NOTI/WS → đóng WO | Tối thiểu hoá rework nội bộ 1 WO | — |
| **D17** | **(MỚI, C1+C2)** `SOCIAL_ROUTE_PAIRS` — cột mở rộng `tier1IsFloor` + `dataScope`/`companyFloor` | Bảng hằng (khuôn `RECRUIT_ROUTE_PAIRS`) thêm 2 nhóm cột: (i) `tier1IsFloor:boolean` — `true` cho MỌI route mà cặp tầng-1 (decorator) ≠ cặp thật cần kiểm ở tầng-2 (hiện tại: **`002`, `006`** — cả hai đều D4/D5); (ii) `dataScope`/`companyFloor:boolean` — chuẩn bị hạ tầng cho scope khác Company (BE-1B sẽ dùng cho `view:feed-report`, xem C2/§9). **Nhóm A hôm nay: tập `companyFloor:true` = RỖNG có chủ ý** (comment trong code: `// BE-1B sẽ thêm view:feed-report — scope Company, manager Department`) | M3 (không có tiền lệ 1:1), M18 (đo lệch vai) | Thiếu cờ ⇒ census 2 tầng không phân biệt được route "sàn ≠ cặp thật" — review lầm route là "gate lỏng" hoặc bỏ sót gap thật |
| **D18** | **(MỚI, C4)** Đính kèm ảnh/video — nằm TRONG BE-1 (C4 phương án (a)) ⚠️ quyết định KỸ THUẬT của phiên, **CHƯA có chữ ký owner** | `social-attachments.service.ts` MỚI (§3). Căn cứ: `apps/api/migrations/0579_s16socialdb1_audit_union_object_type.sql:17-22` ghi rõ gắn file vào bài/bình luận "hoàn toàn ở tầng SERVICE (BE-1)"; `file_links.entity_type` KHÔNG CHECK, KHÔNG allow-list ⇒ DB không đỡ, code BE-1 là lớp DUY NHẤT | Không tách route mới — LINK qua `attachmentIds[]` trong DTO tạo/sửa bài-bình luận (002/004/015/016), dùng `FilesModule` generic presign (giống `chat-attachments.service.ts`, KHÔNG viết lại presign) | Thiếu gate ⇒ actor gắn được file KHÔNG PHẢI của mình, hoặc đọc được đính kèm của bài KHÔNG THẤY ĐƯỢC (rò rỉ qua "cửa" file thay vì "cửa" bài) |
| **D19** | **(MỚI, nợ (d) FULL gate DB-1 — bản cũ rơi mất hoàn toàn)** Trần độ dài `body`/`note` | `feed_posts.body`/`feed_comments.body`: **`.max(4000)`** — mirror TRỰC TIẾP `packages/contracts/src/chat.ts:323` (`body: z.string().max(4000)`). `feed_reports.note`/`resolutionNote` (dùng ở BE-1B nhưng ĐỊNH NGHĨA hằng ở BE-1 cùng chỗ contracts SOCIAL): **`.max(1000)`** — KHÔNG có tiền lệ CHAT tương đương (CHƯA ĐO), chọn 1000 vì đây là trường lý do ngắn không phải nội dung chính, ghi rõ trong contracts đây là quyết định MỚI không phải mirror | Bản plan cũ rơi mất hoàn toàn nợ (d) (grep 0 hit ở bản trước) | Không trần ⇒ actor gửi body vô hạn — DoS lưu trữ + phá layout FE |
| **D20** | **(MỚI, Phần 3 cảnh báo)** Đọc `user_preferences` của NHIỀU người — 1 hàm dùng chung | `social-preferences.ts`: `getPreferencesForUsers(tx, userIds: string[])` — DUY NHẤT 1 hàm, `WHERE user_id = ANY($ids)` TRONG SQL, KHÔNG `SELECT *`. Dựng ở BE-1 (hạ tầng), dùng THẬT ở BE-1B (route `026` sinh nhật) | Schema comment `user-preferences.ts:18-19`: "CROSS-USER KHÔNG do RLS — ép ở BE" | Đọc preference người khác qua nhiều đường/nhiều hàm ⇒ 1 đường quên ép `user_id` = rò rỉ preference riêng tư (vd `showBirthday=false`) |

---

## §3. Cấu trúc file module `apps/api/src/social/`

> Luật CLAUDE.md §5: 200–400 dòng/file, max 800. **Tách `social-posts-moderation.service.ts` NGAY TỪ ĐẦU** (KHÔNG "nếu vượt thì tách" như bản trước) — `social-posts.service.ts` dự 380-400 dòng TRƯỚC KHI cộng đính kèm (D18) + moderation, chắc chắn vượt trần 800 nếu gộp.

| File | Trách nhiệm | Ước lượng dòng |
| --- | --- | --- |
| `social.module.ts` | DI wiring (`PermissionModule`,`RealtimeEmitterModule`,`FilesModule`) + controllers/providers/exports + `OnModuleInit` đăng ký 3 mã NOTI (028/029/030, D15) | 150-200 |
| `social.errors.ts` | `SOCIAL_ERR` map 22 mã (dùng ~14 mã ở Nhóm A) + helper throw | 80-120 |
| `social-route-pairs.const.ts` | `SOCIAL_ROUTE_PAIRS` (19 route 1:1 + cột `tier1IsFloor`/`dataScope`/`companyFloor`, D17) + `SOCIAL_POST_TYPE_PAIRS` (D4) + `SOCIAL_MODERATION_FIELD_PAIRS` (D5) — NGUỒN SỰ THẬT DUY NHẤT | 150-220 |
| `social-access.service.ts` | Tầng 2 guard + `assertPostVisible`/`assertCommentVisible`/`assertTargetVisible` (D6) + `departmentOrgUnitIds` wrapper (D13) — **crown-jewel, per-file coverage threshold (D11)** | 350-400 |
| `social-counters.ts` | `bumpLikeCount`/`bumpCommentCount`/`bumpViewCount`/`bumpTagUsage` + `restorePostTx` (D10) | 100-150 |
| `social-mentions.ts` | `resolveMentions` silent-drop (D15/M15) + parse hashtag (D8) | 150-200 |
| `social-attachments.service.ts` | **MỚI (D18).** Presign upload/đọc qua `FilesModule`, gate tenant+uploader khi LINK, `assertPostVisible` TRƯỚC presign đọc, giới hạn SPEC-16 §16, khuôn `chat-attachments.service.ts` | 150-200 |
| `social-preferences.ts` | **MỚI (D20).** `getPreferencesForUsers(tx, userIds)` — 1 hàm cross-user duy nhất | 60-100 |
| `social-noti.payload.ts` | Hằng `SOCIAL_EVENT_*` (3 event D15: 028/029/030) + kiểu payload + `dedupeKeyOf` — khuôn `recruit-noti.payload.ts` | 100-150 |
| `social-posts.repository.ts` | Query `feed_posts` set-based (keyset `(last_activity_at,id)`/`(published_at,id)`, audience+status filter TRONG SQL) | 300-380 |
| `social-posts.service.ts` | Tạo/sửa/xoá/view/save bài (KHÔNG còn moderation — đã tách) | 280-320 |
| `social-posts-moderation.service.ts` | **MỚI, tách từ đầu.** Route `006` — per-field check `manage:feed-post`/`manage:feed-news` độc lập (D5/D17) | 150-200 |
| `social-posts.controller.ts` | 001-010 | 250-300 |
| `social-reactions.repository.ts` + `.service.ts` | `feed_reactions` cho CẢ post+comment, khuôn `ChatReactionsService` | 150+180 |
| `social-reactions.controller.ts` | 011-013, 018-019 | 150-180 |
| `social-comments.repository.ts` + `.service.ts` | `feed_comments` 1 cấp, mention/hashtag resync | 180+280 |
| `social-comments.controller.ts` | 014-017 | 180-220 |

**Tổng 19 file** (16 gốc + 3 mới: `social-attachments.service.ts`, `social-preferences.ts`, `social-posts-moderation.service.ts`), không file nào >400 dòng. Ba file Nhóm B (`social-news.*`/`social-discovery.*`/`social-reports.*`) của bản trước **ĐÃ XOÁ khỏi phạm vi WO này** — chuyển nguyên khuôn thiết kế cho `S16-SOCIAL-BE-1B` (xem §9).

---

## §4. Bảng 19 route Nhóm A (`SOCIAL-API-001..019`)

> Thứ tự khai TĨNH-TRƯỚC-`{id}` bắt buộc (API-19 §5.2). `Guard` = cặp tầng-1 (decorator, kèm `floor` nếu `tier1IsFloor:true`); `Tầng 2` = cặp tầng-2 (service, khi khác tầng-1).

| Mã | Method · Path | Guard (tầng-1) | `tier1IsFloor` | Tầng 2 | Idemp | Audit | NOTI | WS | Mã lỗi chính |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 001 | `GET /social/feed` (TĨNH) | `view:feed` | false | +`manage:feed-post` nếu `status≠published` | — | — | — | — | — |
| 002 | `POST /social/posts` | **`create:feed-post`** (SỬA, D4/H1) | **true** | `create:feed-post`[+`manage:feed-news` nếu `type=news`] | ✅ | — | 028 (mention) | `feed:post.created` | 007,008,009(non-err) |
| 003 | `GET /social/posts/{id}` | `view:feed` | false | — | — | — | — | — | 001 |
| 004 | `PATCH /social/posts/{id}` | `view:feed` | false | chủ bài HOẶC `manage:feed-post` | — | — | 028 nếu mention mới | — | 001,003 |
| 005 | `DELETE /social/posts/{id}` | `view:feed` | false | chủ bài HOẶC `manage:feed-post` | — | Có nếu xoá bài NGƯỜI KHÁC | — | — | 001,003 |
| 006 | `PATCH /social/posts/{id}/moderation` | **`manage:feed-post`** (SỬA, D5/C1) | **true** | per-field: `manage:feed-post`(hidden,commentsLocked)/`manage:feed-news`(pinned) | — | ✅ mỗi field | — | — | 010 |
| 007 | `POST /social/posts/{id}/view` | `view:feed` | false | hàng `user_id=actor` | — | — | — | — | — |
| 008 | `POST /social/posts/{id}/save` | `view:feed` | false | hàng `user_id=actor` | — | — | — | — | — |
| 009 | `DELETE /social/posts/{id}/save` | `view:feed` | false | hàng `user_id=actor` | — | — | — | — | — |
| 010 | `GET /social/saved` (TĨNH) | `view:feed` | false | chỉ actor | — | — | — | — | — |
| 011 | `PUT /social/posts/{id}/reaction` | `view:feed` | false | hàng `user_id=actor` | — | — | — | `feed:reaction.changed` | 006 |
| 012 | `DELETE /social/posts/{id}/reaction` | `view:feed` | false | hàng `user_id=actor` | — | — | — | `feed:reaction.changed` | — |
| 013 | `GET /social/posts/{id}/reactions` | `view:feed` | false | — | — | — | — | — | — |
| 014 | `GET /social/posts/{id}/comments` | `view:feed` | false | — | — | — | — | — | — |
| 015 | `POST /social/posts/{id}/comments` | `create:feed-comment` | false | — | ✅ | — | 028(mention)·029(bình luận)·030(trả lời) | `feed:comment.created` | 004,005,006,007 |
| 016 | `PATCH /social/comments/{id}` | `view:feed` | false | chủ bình luận HOẶC `manage:feed-post` | — | — | 028 nếu mention mới | — | 001 |
| 017 | `DELETE /social/comments/{id}` | `view:feed` | false | chủ bình luận HOẶC `manage:feed-post` | — | Có nếu xoá NGƯỜI KHÁC | — | — | 001 |
| 018 | `PUT /social/comments/{id}/reaction` | `view:feed` | false | hàng `user_id=actor` | — | — | — | `feed:reaction.changed` | 006 |
| 019 | `DELETE /social/comments/{id}/reaction` | `view:feed` | false | hàng `user_id=actor` | — | — | — | `feed:reaction.changed` | — |

**Thứ tự khai TĨNH-trước-`{id}` trong `social-posts.controller.ts`:** `saved` → `feed` → `posts` (POST) → `posts/{id}` và route con.

### 4.1 Bảng mã lỗi ↔ route (Nhóm A, để FULL gate soi được)

| Mã lỗi | Dùng ở route | Ý nghĩa |
| --- | --- | --- |
| `SOCIAL-ERR-001` | 003,004,005,016,017 | Không tìm thấy / không thấy được (404 IDOR-safe) |
| `SOCIAL-ERR-003` | 004,005,016,017 | Thiếu quyền sửa/xoá của người khác |
| `SOCIAL-ERR-004` | 015 | Bình luận vào bài đã khoá comment |
| `SOCIAL-ERR-005` | 015 | Trả lời vào một trả lời (chỉ 1 cấp) |
| `SOCIAL-ERR-006` | 011,018 | Emoji ngoài bộ CHAT |
| `SOCIAL-ERR-007` | 002,015 | Đính kèm vượt giới hạn (D18) |
| `SOCIAL-ERR-008` | 002 | `audience='group'` bị từ chối (D1) |
| `SOCIAL-ERR-009` | 002,015 | (không phải lỗi) mention bị drop — trả trong `data.droppedMentions[]` |
| `SOCIAL-ERR-010` | 006 | Thiếu quyền đổi field moderation cụ thể |

19 mã còn lại của 22 mã catalog SOCIAL (`011..022`) thuộc phạm vi BE-1B — liệt kê khi mở plan riêng.

---

## §5. Deny-path RED trước + ALLOW đối chứng (H2)

> Viết TRƯỚC code nghiệp vụ. **MỌI ca deny quyền/visibility PHẢI có ca ALLOW đối chứng** dùng CÙNG fixture/route, chỉ đổi actor/điều kiện, assert 2xx + nội dung ≠ rỗng (lớp lỗi `deny-cases-vacuous-without-allow-case` — route hỏng-toàn-tập làm mọi ca deny xanh giả). Ca thuộc Nhóm B (R3/R6/R7/R16 bản trước, W1 dùng route Nhóm B) đã **CHUYỂN §9** vì route không còn trong phạm vi BE-1.

| # | Ca DENY | Kỳ vọng | Ca ALLOW đối chứng | Vì sao |
| --- | --- | --- | --- | --- |
| R1 | Đọc bài `hidden`/`deleted` của người khác qua `GET /posts/{id}` | 404 `ERR-001` | Cùng route, actor = tác giả HOẶC có `manage:feed-post` → 200 + body đủ trường | done_when #1 câu 1 |
| R2 | Sửa/xoá bài người khác không có `manage:feed-post` | 403 `ERR-003` | Actor có `manage:feed-post` → 200/204 | done_when #1 câu 2 |
| R4 | Đọc bài `audience=org_unit` từ đơn vị KHÁC | 404 `ERR-001` | Actor CÙNG đơn vị (hoặc đứng đầu đơn vị đó) → 200 | done_when #1 câu 4 |
| R5 | Reaction emoji ngoài bộ CHAT | 422 `ERR-006` | Emoji trong bộ → 200 + `likeCount` cập nhật | done_when #1 câu 5 |
| D1t (D6) | `feed_reactions`/`feed_mentions` `target_id` UUID hợp lệ NHƯNG thuộc TENANT KHÁC | 404 (IDOR — `assertTargetVisible` chặn TRƯỚC INSERT) | `target_id` cùng tenant, actor thấy được → 200 | nợ FULL gate DB-1 (b) |
| D2t (D6) | `target_id` CÙNG tenant nhưng bài `hidden`/`org_unit` khác — actor không thấy được | 404 | actor thấy được bài đích → 200 | như trên |
| R8 | Bình luận đã khoá (`commentsLocked=true`) | 409 `ERR-004` | Bài chưa khoá comment → 201 | SPEC-16 §12 |
| R9 | Trả lời vào một trả lời (`parent_comment_id` trỏ bình luận đã có `parent_comment_id`) | 422 `ERR-005` | Trả lời vào bình luận GỐC (1 cấp) → 201 | SPEC-16 §13.2 |
| R10 | Tạo tin tức (`type=news`) không có `manage:feed-news` | 403 `ERR-010` | Actor có `create:feed-post`+`manage:feed-news` → 201 | API-19 §5.1b, cùng ca chứng minh D17 gap cho route `002` |
| R11 | Ghim (`pinned=true`) một bài KHÔNG phải `type=news` qua `/moderation` | 422 CHECK | `pinned=true` trên bài `type=news` → 200 | API-19 §5.1c |
| R12 | Actor có `manage:feed-news` NHƯNG KHÔNG `manage:feed-post` gọi `/moderation` CHỈ đổi `pinned` | **403 Ở TẦNG 1** (floor D5 chặn trước khi vào service — XÁC NHẬN dư lượng M18, KHÔNG phải bug BE-1, ghi nợ BE-2) | Actor có CẢ HAI (`manage:feed-post`+`manage:feed-news`, đúng canonical hôm nay) → 200 | D5/D17 — chứng minh gap thật của floor |
| R13 | Actor có `manage:feed-post` NHƯNG KHÔNG `manage:feed-news` gọi `/moderation` CHỈ đổi `hidden`/`commentsLocked` | 200 (floor ĐỦ cho nhánh này) | Cùng actor gọi ĐỔI `pinned` trong CÙNG request → 403 riêng cho field đó | D5 — 2 quyền độc lập |
| R14 | `POST /social/posts` với `type='poll'` (hoặc `idea`/`kudos`) | 400 Zod, KHÔNG 500, KHÔNG tạo hàng | `type='share'`/`'news'` → 201 | D2 |
| R15 | `POST /social/posts` body mang `{status:'published',pinned:true,likeCount:999}` | Field bị BỎ QUA — `likeCount` LUÔN 0, `pinned` LUÔN false trừ khi qua `/moderation` | Cùng payload trừ 3 field đó → 201 với default đúng | D3 (mass-assignment) |
| R17 | Hai lượt thích ĐỒNG THỜI (2 tx chồng nhau thật, không tuần tự) | `like_count` đúng bằng `COUNT(*)` sau cùng | 1 lượt thích tuần tự → tăng đúng 1 | D7, memory `clamp-must-be-sql-not-js` |
| R18 | Xoá mềm bài rồi gọi `restorePostTx()` (D10, KHÔNG tự flip cột thủ công) | Bài + đếm/quan hệ (comment/reaction/tag/saved) HIỆN LẠI ĐỦ | Bài chưa xoá → mọi quan hệ đọc bình thường | D10 |
| R19 | Mention một người NGOÀI audience của bài | 201 + `data.droppedMentions[]` chứa id bị bỏ + KHÔNG có hàng `feed_mentions` | Mention người TRONG audience → 201 + hàng `feed_mentions` thật + NOTI-028 gửi ĐÚNG người đó | D15/M15, `ERR-009` |
| R20 | Idempotency-Key lặp lại với BODY KHÁC trên `POST /social/posts` | 409 `KEY_REUSED` | Key mới + body mới → 201 | M9 |
| R21 | Idempotency-Key lặp lại với BODY GIỐNG HỆT | 200/201 replay + header `Idempotency-Replayed:true`, KHÔNG tạo hàng thứ 2 | Key đầu tiên → 201 tạo hàng | M9 |
| R22 | `payroll-officer`/`recruiter` gọi `POST /social/posts` (type=share) | 201 — đúng bộ mặc định employee | SPEC-16 T21 |
| R23 | Cross-tenant: company B đọc `GET /social/posts/{id}` của company A | 404 (RLS chặn) | Company A tự đọc → 200 | T19 |
| R24 | So payload WS `feed:post.created`/`feed:comment.created`/`feed:reaction.changed` với DTO REST | Trùng tập trường, KHÔNG cột thừa (`status`/`deletedAt`/`authorUserId` không lộ cho non-tác giả) | — | T20 |
| R25 | Hashtag tiếng Việt có dấu `#tuyểndụng` | Parse đúng, lưu lowercase, `usage_count+1` | Hashtag ASCII thường → parse đúng | D8 |
| R26 | **(MỚI)** `GET /social/feed?status=hidden` bởi actor THƯỜNG (không `manage:feed-post`) | 403 (hoặc ép về `status=published`, chọn 1 hành vi và ghi rõ trong contracts) | Actor có `manage:feed-post` gọi CÙNG query → 200, thấy cả bài `hidden` | §4 dòng 001 — bản trước thiếu ca RED cho nhánh `status≠published` |
| R27 | **(MỚI, D18)** LINK file KHÔNG PHẢI actor upload (hoặc file tenant khác) vào bài | 403/404 | LINK file actor tự upload, cùng tenant → 200 | C4 ca (i) |
| R28 | **(MỚI, D18)** Đọc presign đính kèm của bài `hidden`/`org_unit` khác actor không thấy được | 404 (qua `assertPostVisible` TRƯỚC presign) | Đọc đính kèm của bài actor thấy được → presign URL hợp lệ | C4 ca (ii), memory `read-path-gate-pair-must-match-download-pair` |
| R29 | **(MỚI, D18)** Vượt giới hạn đính kèm (>10 ảnh / >1 video / >20MB/tệp) | 422 `ERR-007` | Đúng giới hạn (≤10 ảnh, ≤1 video, ≤20MB) → 201 | C4 ca (iii), SPEC-16 §16 |
| R30 | **(MỚI, D19)** `body` bài/bình luận vượt 4000 ký tự | 422 Zod | `body` ≤4000 → 201 | D19, mirror `chat.ts:323` |

**Ghi chú "không cần ALLOW đối chứng"** (không phải ca deny quyền/visibility, không thuộc lớp lỗi `deny-cases-vacuous-without-allow-case`): R14/R15/R20/R21/R25/R17/R18/R22/R23/R24/R30 — validate Zod thuần, idempotency, race, hashtag positive-path, hoặc chính ca đó ĐÃ là phép so sánh 2 nhánh.

---

## §6. Audit · NOTI outbox · WS emit — bảng ánh xạ 5 cột (H5, mở rộng so với bản trước)

| Hành động | `audit_logs.object_type` | `eventCode` canonical (outbox) | `sourceEntityType` | `resolveRecipients` | `dedupeKeyOf` |
| --- | --- | --- | --- | --- | --- |
| Ẩn/hiện bài (`hidden`) | `feed_post` | — | — | — | — |
| Ghim/bỏ ghim (`pinned`) | `feed_post` | — | — | — | — |
| Khoá/mở bình luận (`commentsLocked`) | `feed_post` | — | — | — | — |
| Xoá bài NGƯỜI KHÁC | `feed_post` | — | — | — | — |
| Xoá bình luận NGƯỜI KHÁC | `feed_comment` | — | — | — | — |
| Mention (@) trong bài/bình luận | — | `SOCIAL_MENTIONED` (`NOTI-EVENT-028`) | `feed_post`\|`feed_comment` (theo nơi mention xảy ra) | Người được mention (từ `feed_mentions` vừa insert), TRỪ khi `mentionedUserId===actor.id` | `{target_type}:{target_id}` (khớp comment nguồn `notification-event-catalog.const.ts:210`) |
| Bình luận mới vào bài của actor khác | — | `SOCIAL_POST_COMMENTED` (`NOTI-EVENT-029`) | `feed_comment` | Tác giả bài (`feed_posts.author_user_id`), TRỪ khi `authorUserId===actor.id` | `{comment_id}` |
| Trả lời vào bình luận của actor khác | — | `SOCIAL_COMMENT_REPLIED` (`NOTI-EVENT-030`) | `feed_comment` | Tác giả bình luận CHA, TRỪ khi `parentAuthorUserId===actor.id` | `{comment_id}` |
| Tạo bài (bất kỳ) | — | (theo trên nếu mention) | — | — | `feed:post.created` WS, room `co:{c}:feed` |
| Tạo bình luận | — | (theo trên) | — | — | `feed:comment.created` WS, room `co:{c}:feed` |
| Đặt/đổi/gỡ reaction (bài hoặc bình luận) | — | — | — | — | `feed:reaction.changed` `{targetType,targetId,likeCount}` WS, room `co:{c}:feed` |

Payload audit theo API-19 §8: `{postId, field, from, to}` — **MỖI TRƯỜNG 1 DÒNG AUDIT RIÊNG**.

**Registrar outbox (D15):** `SocialModule.onModuleInit()` gọi `registerSource({module:"SOCIAL", eventCodes:["SOCIAL_MENTIONED","SOCIAL_POST_COMMENTED","SOCIAL_COMMENT_REPLIED"]})` — CHỈ 3 mã BE-1 thực sự emit. **Sửa comment SAI tại `apps/api/src/foundation/seed/notification-event-catalog.const.ts:215`** (hiện ghi "Registrar outbox đăng ký ở S16-SOCIAL-BE-2" cho CẢ khối SOCIAL — sai vì BE-1 cần đăng ký 3 mã NGAY) thành: *"Registrar outbox đăng ký theo từng WO: BE-1 đăng ký 028/029/030; BE-1B đăng ký 031/036; BE-2 đăng ký 032-035 (registerSource() fail-loud nếu mã đã emit mà chưa registered)."* — file thuộc `apps/api/src/foundation/**`, đã thêm vào `paths` (§0.1b).

`dedupeKeyOf` **content-derived theo ĐỐI TƯỢNG** (`target_id`/`comment_id`), **KHÔNG nhét `user_id`** (memory `idempotency-key-must-be-content-derived`, khớp comment nguồn `notification-event-catalog.const.ts:207-209`).

**Ca test ≥1 cho mỗi event BE-1 emit:** actor A mention actor B trong bài của actor C → NOTI có mặt cho B, KHÔNG có cho A (chính actor) và KHÔNG BẮT BUỘC có cho C (trừ khi C cũng bị mention) — R19 đã bao ca "có mặt + đúng người nhận"; thêm 1 ca riêng xác nhận "KHÔNG gửi cho chính actor" khi actor tự mention chính mình (self-mention, nếu cho phép ở DTO — nếu DTO chặn self-mention thì ghi rõ chặn ở Zod, không cần ca NOTI).

---

## §7. Thứ tự thi công theo bước

> `LANE_DB` bắt buộc cho mọi bước có DB thật. **Trước lượt int-spec ĐẦU TIÊN: `bash scripts/lane-db-setup.sh <lane> --reset`** (memory `lane-db-setup-keeps-existing-db` — không `--reset` thì DB lane cũ có thể còn state từ phiên trước, xanh giả/đỏ giả). `bash harness/check.sh --lane-db` trước mỗi checkpoint.

### Bước 0 — Hạ tầng dùng chung
1. `social.module.ts` (khung DI) + đăng ký `app.module.ts` (additive).
2. `social.errors.ts` — 14 mã Track A.
3. `social-route-pairs.const.ts` — `SOCIAL_ROUTE_PAIRS` với `tier1IsFloor`/`dataScope`/`companyFloor` (D17). RED trước: unit-spec đẳng thức (§7 mục 3b).
   - **3b.** `apps/api/test/social/social-two-layer-guard-census.unit-spec.ts` (khuôn `recruit-two-layer-guard-census.unit-spec.ts:220-247`): tập route `tier1IsFloor===true` PHẢI `toEqual` (KHÔNG `toContain`) tập route mà AST chứng minh có lời gọi `permission.can()` với cặp KHÁC cặp decorator trong service tương ứng. **Neo chống-xanh-rỗng:** `expect(tier1FloorRoutes.length).toBeGreaterThan(0)` VÀ `expect(tier2GapRoutes.length).toBeGreaterThan(0)` (hôm nay cả hai đều `{002,006}`, 2 phần tử).
   - **3c.** `apps/api/test/social/social-be1-scope.int-spec.ts` (khuôn `recruit-be1-scope.int-spec.ts`) — ma trận A/B cho `002`/`006`: actor CHỈ có cặp sàn → như R10/R12/R13 mô tả ở §5; actor có cặp thật → 2xx.
4. `apps/api/src/realtime/rooms.ts` — `feedRoomName(companyId) => co:{c}:feed` (additive).
5. `apps/api/src/realtime/realtime.gateway.ts` — **THÊM bước join/gate room `co:{c}:feed` tại `handleConnection` (M8, bản trước THIẾU bước này, chỉ nói emit)**: khuôn `handleConnection:127-197`, fail-SOFT KHÔNG disconnect nếu thiếu `view:feed`.
6. `apps/api/src/config/openapi-modules.ts` — entry `SOCIAL` (D12) — SỚM, trước route đầu tiên lên.
7. `social-access.service.ts` — `assertPostVisible`/`assertCommentVisible`/`assertTargetVisible` (D6) + `departmentOrgUnitIds` (D13). Unit-spec thuần (mock tx) từng nhánh audience.
8. `social-counters.ts` — 4 hàm atomic (D7) + `restorePostTx` (D10). Unit-spec race (R17) và restore (R18) RED trước dù chưa có caller thật.
9. `social-preferences.ts` — `getPreferencesForUsers` (D20). Unit-spec: gọi 1 lần với N id, KHÔNG N lần với 1 id.

### Bước 1 — Bài + bình luận + reaction + mention/hashtag + đính kèm (19 route)
10. `social-mentions.ts` (D8/D15) — RED trước: R19, R25.
11. `social-attachments.service.ts` (D18) — RED trước: R27, R28, R29.
12. `social-posts.repository.ts` + `.service.ts` + `.controller.ts` — route 001-005,007-010. RED trước: R1,R2,R4,R14,R15,R18,R23,R26.
13. `social-posts-moderation.service.ts` — route 006. RED trước: R10,R11,R12,R13.
14. `social-reactions.*` — route 011-013,018-019. RED trước: R5,R17,R24.
15. `social-comments.*` — route 014-017. RED trước: R8,R9,R22.
16. `social-noti.payload.ts` + outbox wiring cho 028/029/030 + registrar `OnModuleInit` (§6) + sửa comment `notification-event-catalog.const.ts:215` (§6).
17. WS wiring: `emitFeedPostCreated`/`emitFeedCommentCreated`/`emitFeedReactionChanged` (additive). RED trước: R24.
18. `@Idempotent()` trên 002,015. RED trước: R20,R21.
19. Trần độ dài `body` (D19) ở contracts SOCIAL. RED trước: R30.
20. Thêm `"social/"` vào `CLEAN_PREFIXES` của `apps/api/test/foundation/param-uuid-ratchet.unit-spec.ts:128-151` (M13) — chạy `param-uuid-ratchet.unit-spec.ts` SAU MỖI controller mới, không đợi cuối (D14).

### Bước 2 — Đóng WO
21. `test:cov:social` script (`package.json`, D11) + per-file threshold `social-access.service.ts` (D11).
22. `pnpm --filter @mediaos/contracts build && pnpm typecheck` xanh.
23. `bash harness/check.sh --all` (hoặc `REQUIRE_LANE_DB=1`) xanh, KHÔNG banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
24. **BƯỚC CUỐI TRƯỚC COMMIT (siết theo Phần 3 cảnh báo):** Regen `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` (`ROUTE_CENSUS_WRITE=1 pnpm --filter @mediaos/api exec vitest run test/foundation/route-guard-coverage.e2e-spec.ts`). Nếu PR khác đã land route mới VÀO master giữa lúc thi công BE-1, PHẢI **rebase rồi chạy lại bước này** trước khi commit — regen cũ (trước rebase) sẽ làm census đỏ oan hoặc bỏ sót route của PR kia.
25. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` — hỏi xác nhận TƯỜNG MINH cho D6 (IDOR), D1 (audience=group reject), D2 (type scope), D13 (org_unit không đệ quy — **cần owner ký**), M1 (ghi chú `*:*` là hành vi engine, không xử lý ở BE-1) → PR.

---

## §8. Rủi ro → cách chặn

| Rủi ro | Cách chặn |
| --- | --- |
| Decorator tầng-1 bị hiểu lầm "quá lỏng"/"quá chặt" | Cờ `tier1IsFloor` (D17) + census đẳng thức (§7 mục 3b) làm rõ CHÍNH XÁC route nào có gap, KHÔNG dựa cảm tính đọc decorator |
| IDOR đa hình (D6) bị quên ở MỘT call-site | `assertTargetVisible` là hàm DUY NHẤT, review kiểm TỪNG call-site (`feed_reactions`/`feed_mentions`) có gọi nó TRƯỚC insert |
| Counter race (D7) bị "tối ưu" thành đọc-rồi-ghi | R17 ép 2 tx chồng nhau thật — memory `clamp-must-be-sql-not-js` |
| Mention SOCIAL copy nhầm logic THROW của TASK (M15) | R19 RED-trước |
| OpenAPI tag thiếu (D12) làm `openapi-contract.e2e-spec` đỏ muộn | Bước 0 mục 6 — TRƯỚC route đầu tiên |
| `ParseUUIDPipe` thiếu 1 param | Chạy `param-uuid-ratchet.unit-spec.ts` SAU MỖI controller (Bước 1 mục 20), không đợi cuối |
| Coverage 85% bị hiểu nhầm là cổng CI tự động | Ghi RÕ trong PR: số đo bằng `test:cov:social`, dán output vào PR |
| Audience `org_unit` dùng nhầm cây con tưởng tượng | Test actor thuộc org_unit CON của org_unit bài KHÔNG thấy được; **D13 cần owner ký TRƯỚC khi thi công** |
| **`*:*` wildcard (M1) bị hiểu là "lỗ SOCIAL" và có người cố "vá" bằng `isSensitive:true`** | Ghi rõ trong PR + review: hành vi ENGINE toàn hệ thống, SPEC-16 §11.1 CHỦ Ý không đánh dấu sensitive; "vá" phá SOC-DEC-004. **Test liên quan (route `view:feed-report`) thuộc BE-1B — khi viết ở đó PHẢI ghi rõ nó PIN hành vi ENGINE (memory `tests-can-pin-a-hole-open`), và PR phải nêu tường minh cho owner ký: "role tuỳ biến `*:*` đọc được toàn bộ báo cáo vi phạm — chấp nhận". Đánh `is_sensitive=true` cho `feed-report` là ĐỔI SPEC, KHÔNG làm ở BE-1 lẫn BE-1B** |
| Split BE-1/BE-1B không đồng bộ backlog | §0.0 — đã sửa `harness/backlog.mjs` TRONG phiên vá này, không còn "để ngỏ" |
| Đính kèm (D18) rò rỉ qua "cửa file" dù "cửa bài" đã khoá | `assertPostVisible` PHẢI gọi TRƯỚC mọi presign đọc (R28); presign NGOÀI transaction (M4) |
| Registrar outbox thiếu mã BE-1 cần khi boot | Sửa comment sai + đăng ký ĐÚNG 3 mã ở `OnModuleInit` (Bước 1 mục 16) |

---

## §9. Nợ chuyển WO sau

### 9.1 `S16-SOCIAL-BE-1B` (WO MỚI — Nhóm B, 10 route 020-029) — TOÀN BỘ mục sau chuyển nguyên sang plan riêng khi mở

- **Route + hạ tầng tiêu thụ:** `social-news.*`, `social-discovery.*`, `social-reports.*` (thiết kế file ở bản trước của plan này, xem lịch sử git nếu cần khuôn cũ) — dùng LẠI `SocialAccessService`, `assertTargetVisible` (biến thể `targetType='report'`), `social-preferences.ts` (D20), `SOCIAL_ROUTE_PAIRS` (thêm route mới vào CÙNG bảng hằng, không tạo bảng riêng).
- **D9 (sinh nhật, nguyên quyết định giữ ở §2 bảng D-list phía trên):** `SELECT ... EXTRACT(DAY/MONTH FROM date_of_birth)` — route `026`.
- **M14 (`search_vector`):** route `023`, migration `0577:510-542` đã sẵn, chỉ cần dùng.
- **3 ca test yếu cần viết lại (H3, nguyên văn yêu cầu từ review):**
  - **R6 (sinh nhật, route `026`):** (i) assert `Object.keys(item)` **BẰNG ĐÚNG** `{employeeId,fullName,avatar,day,month}`; (ii) grep regex năm `\b(19|20)\d{2}\b` trên **TOÀN BỘ** `JSON.stringify(res.body)`, không chỉ field `day`/`month`; (iii) **neo dương** ≥1 hàng thật (không phải mảng rỗng làm ca xanh giả).
  - **R3 (ack tin tức, route `021`):** phải assert `feed_post_acks` có ĐÚNG 1 hàng `user_id=A` và 0 hàng cho B (không chỉ assert response 200).
  - **R7 (showBirthday=false, route `026`+`023`+mention-autocomplete):** liệt kê **danh sách ĐÓNG** mọi đường đọc trả tên/avatar nhân viên (birthdays · search · tags · profiles · mention-resolve), viết 1 ca test cho MỖI đường, không chỉ `/birthdays`.
  - **R16 (report resolved/dismissed, route `029`):** 409 `ERR-021` khi PATCH report đã xử lý.
  - **W1 (`*:*` mở `view:feed-report`, route `028`):** ca ALLOW xác nhận hành vi ENGINE + 1 ca ĐỐI CHỨNG deny-override tường minh trên `('view','feed-report')`. Ghi PIN warning (memory `tests-can-pin-a-hole-open`) + xin owner ký trong PR.
- **C2 (scope Department cho báo cáo):** `view:feed-report` là cặp DUY NHẤT có scope ≠ Company (Company cho hr, **Department cho manager** — SPEC-16 §11.1 dòng 14, API-19 `SOCIAL-API-028`). BE-1B PHẢI ép vị từ phòng ban **TRONG SQL** (không lọc JS sau khi lấy về) + 1 ca deny (manager đọc report NGOÀI phòng ban → 403/lọc rỗng) + 1 ca allow (hr đọc Company-wide). Cột `companyFloor` trong `SOCIAL_ROUTE_PAIRS` (D17, hiện RỖNG có chủ ý ở BE-1) sẽ thêm route `028` với `companyFloor:false` + `dataScope:"Department"` khi BE-1B mở.
- **D15 (NOTI):** BE-1B đăng ký + emit `SOCIAL_NEWS_PUBLISHED`(031) và `SOCIAL_POST_REPORTED`(036) — registrar hiện đã sửa comment ở BE-1 nêu rõ điều này (§6).
- **@Idempotent() trên route `027`** (báo cáo) — cùng khuôn `002`/`015`.

### 9.2 `S16-SOCIAL-BE-2` (không đổi diện, cộng thêm 2 nợ mới từ lần vá này)

- `type IN ('idea','poll','kudos')` (D2) — mở rộng `feedPostCoreSchema` DTO của BE-1, không viết lại route.
- `audience='group'` EXISTS-filter thật (D1) — cần route tạo/duyệt nhóm.
- 4 NOTI event còn lại (032-035, D15) — không đổi.
- **MỚI (M18/D5):** khi mở lại cặp `manage:feed-news` cho role tuỳ biến KHÔNG có `manage:feed-post`, floor `manage:feed-post` của route `006` (D5) sẽ chặn actor đó Ở TẦNG 1 dù chỉ đổi `pinned` — cần thiết kế lại floor (có thể tách route hoặc đổi floor thành `view:feed`+kiểm đủ cả 2 cặp ở tầng 2).
- **MỚI (M18/D4):** tương tự, khi mở `create:feed-poll`/`-idea`/`-kudos` không kèm `create:feed-post`, floor `create:feed-post` của route `002` (D4) cần thiết kế lại.

### 9.3 `S16-SOCIAL-FE-1`

- Cần route census SOCIAL đã regen (§7 Bước 2 mục 24) để biết chính xác 19 route đang có (KHÔNG phải 29 — 10 route Nhóm B chưa tồn tại tới khi BE-1B merge).
- Cần `test:cov:social` output để biết coverage baseline.
- `depends_on` ĐÃ sửa thành `["S16-SOCIAL-BE-1","S16-SOCIAL-BE-1B"]` trong `harness/backlog.mjs` (phiên vá này) — composer chỉ render 2 nút (share/news) vì BE-1 chỉ nhận `type` share|news (D2); 3 nút poll/idea/kudos mở sau BE-2. Note này đã thêm vào `notes` của FE-1.

### 9.4 `QA-1`

- Mở rộng census `feed-*` (M13) — thu hẹp về `ro.company_id IS NULL` NGAY KHI BE-1B/FE-1/BE-2 cho tenant admin cấp `feed-*` cho role tuỳ biến (BE-1 không có route cấp quyền nên chưa cần).

### 9.5 Doc follow-up (ngoài `paths` của WO này)

- `docs/API Design/**` không nằm trong `paths` — API-19 §5.1 dòng 129 cần sửa câu "fbpost đã khai tag SOCIAL" (SAI, M11) — mở 1 WO doc nhỏ hoặc gộp vào lần cập nhật API-19 tiếp theo.
- **MỚI (D10/H4):** drift SPEC↔API cho recycle-bin — SPEC-16 §3.6/§13.1/§7 hứa "thùng rác" cho bài, API-19 không có route restore nào trong 53 route. Mở WO doc (sửa SPEC bỏ lời hứa thùng rác NẾU quyết định không làm) HOẶC WO `BE-3` (dựng route restore thật NẾU quyết định giữ lời hứa SPEC) — **owner cần chọn 1 trong 2**, chưa chọn ở phiên vá này.

---

## §10. Tự kiểm đối chiếu `done_when`

| Gạch đầu dòng backlog (SAU khi thu hẹp — xem `harness/backlog.mjs`) | Cách chứng minh |
| --- | --- |
| Deny-path RED trước rồi GREEN (7 ca gốc, nay là tập con của §5 vì 3 ca gốc thuộc Nhóm B) | §5 R1,R2,R4,R5 + D1t/D2t — mỗi ca có tên file test cụ thể trong PR; 3 ca gốc còn lại (ack/sinh nhật/showBirthday) đã CHUYỂN §9.1 vì route thuộc BE-1B |
| Listing feed SQL set-based, audience+status trong SQL, keyset, counter cùng tx, view ON CONFLICT DO NOTHING | `social-posts.repository.ts` — review trực tiếp câu SQL |
| Audit cho mọi `manage:*`; mention/bình luận → outbox (3/9 event, D15 SỬA); WS sau commit; room gate `view:feed` (§7 Bước 0 mục 5, MỚI so với bản trước) | §6 bảng 5 cột + R24 |
| Soft-delete biến khỏi feed/đếm/saved cùng tx (tìm kiếm/tag thuộc BE-1B); `restorePostTx` đối xứng thật (D10, KHÔNG còn "recycle-bin đã đóng"); `@Idempotent()` trên 002/015 (027 → BE-1B); coverage ≥85% (đo tay, D11); route census 19 route + OpenAPI enrich xanh | R18 (qua `restorePostTx`); R20/R21; D11; §7 Bước 2 mục 21-24 |
| **MỚI:** cờ `tier1IsFloor` đẳng thức + ma trận A/B floor-route | §7 Bước 0 mục 3b/3c |
| **MỚI:** đính kèm gate + giới hạn | §5 R27-R29 |
| **MỚI:** trần độ dài `body` | §5 R30 |

---

**Tổng kết cho plan-reviewer (bản vá 21/09/2026):** 11/11 điều kiện tự-mở-cổng đã vá (C1→D5/D17/§7 mục 3b-3c/M18; C2→D17 cột `companyFloor` rỗng có chủ ý + nợ §9.1; C3→`paths` đã thêm 5 mục, đã sửa trong `harness/backlog.mjs`; C4→D18/§3/§5 R27-29; H1→D4; H2→cột ALLOW đối chứng §5; H3→3 ca chuyển §9.1 kèm yêu cầu nguyên văn; H4→D10 sửa kết luận sai + `restorePostTx`; H5→§6 5 cột + registrar fix; H6→backlog FE-1 đã sửa; H7→đóng bởi Phần 1). 8 cảnh báo Phần 3 đã vá (`@Idempotent` lý do 007/008 không cần — XEM GHI CHÚ dưới; `user_preferences` cross-user→D20; §7 lane-db-setup --reset + census-cuối-cùng; §3 tách moderation từ đầu; W1 pin-warning; feature-flag §0.4; D13 nâng owner-sign-off; §4 R26 + bảng mã lỗi 4.1; WS room gate §7 Bước 0 mục 5).

**Ghi chú `@Idempotent()` (cảnh báo cuối, Phần 3):** `done_when` gốc nói "mọi POST tạo" nhưng Nhóm A chỉ đặt trên `002`/`015` — route `007`(view)/`008`(save) là POST nhưng KHÔNG cần `@Idempotent()` vì `ON CONFLICT DO NOTHING`/PK tổ hợp (`user_id`+`post_id`) đã tự nhiên idempotent ở tầng DB, gọi lại nhiều lần không tạo hàng trùng — khác với `002`/`015` tạo hàng MỚI mỗi lần (không có khoá tự nhiên chống trùng).

**Còn "CHƯA ĐO" (không bịa):** hằng CHAT số ảnh/video/dung lượng tương ứng D18 (dùng SPEC-16 §16 làm chuẩn); hằng CHAT cho trường `note` ngắn (D19, không có tiền lệ, là quyết định mới không phải mirror). **Còn cần owner ký trước khi thi công:** D13 (hệ quả org_unit không đệ quy cây con); §9.5 lựa chọn sửa SPEC hay mở WO `BE-3` cho recycle-bin.

---

## §11. ĐÍNH CHÍNH SAU THI CÔNG (21/09/2026) — plan ↔ code thật

> Ghi **sau khi code chạy và test xanh**. Mỗi mục là một chỗ plan mô tả sai hiện thực, kèm phép đo.
> Đây là phần bắt buộc đọc trước khi mở `S16-SOCIAL-BE-1B`/`BE-2`: bốn mục đầu là **hợp đồng kỹ
> thuật đã đổi**, không phải khẩu vị.

### 11.1 D2/D3 — `feedPostCoreSchema.pick()/.extend()` **KHÔNG TỒN TẠI**

**Đo:** zod 3.25.76, `feedPostCoreSchema` kết thúc bằng `.superRefine()` ⇒ nó là `ZodEffects`, và
`ZodEffects` không có `.pick`/`.extend` (cả hai `undefined`). Cơ chế plan mô tả **không biên dịch được**.

**Thay bằng:** mỗi DTO ghi là một **allowlist tường minh** `z.object({…}).strict()` ở
`packages/contracts/src/social-api.ts`. Chặt hơn `.pick()`: `.pick()` là "bỏ bớt khỏi danh sách đầy
đủ" (quên bỏ một trường ⇒ lọt), allowlist là "chỉ nhận tên có ở đây" (quên thêm ⇒ 400, không phải rò).
Ca R15 xác nhận `{status,pinned,likeCount}` bị **từ chối 400**, không phải im lặng bỏ qua.

### 11.2 D21 (MỚI) — WS chỉ fan-out bài `audience='company'` + `status='published'`

API-19 §7 khai ĐÚNG hai room: `co:{c}:feed` (cả công ty) và `co:{c}:feedgroup:{groupId}`. **KHÔNG có
room nào cho `audience='org_unit'`.** Phát một bài org_unit vào room cả-công-ty là rò đúng nội dung mà
REST trả 404 cho chính những người đó — một cổng quyền bị đi vòng qua kênh phụ.

⇒ BE-1 thu hẹp: `SocialPostsService.emitPostCreated` / `SocialCommentsService.emitCommentCreated` chỉ
phát khi bài (hoặc bài CHA) là `company` + `published`. Vế thứ hai nằm ở schema:
`wsFeedPostCreatedEventSchema` khoá cứng `audience: z.literal("company")` ⇒ một bài org_unit lọt tới
emitter sẽ NÉM ở `.parse()` chứ không âm thầm phát ra. **Nợ `S16-SOCIAL-BE-2`:** dựng room
`co:{c}:feedgroup:{groupId}` (có gate membership riêng) và cân nhắc room cho `org_unit`.

### 11.3 §6 — registrar NOTI sống ở `notifications/**`, KHÔNG ở `SocialModule.onModuleInit()`

Plan viết `SocialModule.onModuleInit()` gọi `registerSource`. Làm vậy buộc `SocialModule` import
`NotificationsModule` — **ngược chiều với cả 12 registrar hiện có** (GOAL/ASSET/RECRUIT/CHAT/ATT/…
đều nằm ở `notifications/**`) và tạo vòng phụ thuộc. Đã theo tiền lệ:
`apps/api/src/notifications/social-noti-bridge.registrar.ts`, đăng ký ở `notifications.module.ts`.
`SocialModule.onModuleInit()` vẫn tồn tại nhưng cho việc KHÁC: đăng ký `SocialFileResolver`.

### 11.4 D17 — định nghĩa `tier1IsFloor` phải HẸP hơn plan, nếu không cờ vô nghĩa

Plan định nghĩa "cặp tầng-1 ≠ cặp thật kiểm ở tầng-2". Định nghĩa đó **quét cả `001`/`004`/`005`/
`016`/`017`** (chúng cũng hỏi `manage:feed-post` ở tầng 2 — cho bộ lọc `status`, và cho nhánh
sửa/xoá của người khác) ⇒ gần như mọi route đều `true` và cờ mất hết giá trị chẩn đoán.

**Định nghĩa đã chốt:** `tier1IsFloor = true` ⇔ **cặp quyền route đòi PHỤ THUỘC VÀO NỘI DUNG REQUEST**
(`002` theo `type`, `006` theo TRƯỜNG có mặt) — không một cặp tĩnh nào diễn đạt được. Ở năm route kia,
`view:feed` ĐÚNG là cặp gác route; phần thêm là vị từ HÀNG (sở hữu) hoặc bộ lọc TUỲ CHỌN.
Census đo đẳng thức này bằng nguồn ĐỘC LẬP: tập `tier1IsFloor===true` phải BẰNG ĐÚNG tập route có
bảng cặp-theo-payload (`SOCIAL_POST_TYPE_PAIRS` / `SOCIAL_MODERATION_FIELD_PAIRS`).

### 11.5 Bốn bẫy thi công đã cắn (đo thật, không suy diễn)

| # | Bẫy | Triệu chứng | Sự thật |
| --- | --- | --- | --- |
| 1 | `sql\`${col} = ANY(${jsArray})\`` | 500 `Failed query`, typecheck XANH | drizzle bind mảng JS vào fragment `sql` THÔ mà không ép kiểu ⇒ Postgres từ chối `= ANY($1)`. Dùng `inArray()`. |
| 2 | `file_links.link_type = "attachment"` | 500 vô danh; drizzle giấu mã PG trong `error.cause` nên log chỉ có "Failed query: insert into file_links" | `chk_file_links_link_type` chỉ nhận giá trị **VIẾT HOA** (`Attachment`). |
| 3 | Bộ cảm xúc là **TÊN**, không phải ký tự emoji | ca IDOR trả 400 (Zod) thay vì 404 ⇒ xanh giả vì lý do SAI | `chatReactionEmojiSchema` = `like|love|haha|wow|sad|angry` (`chat.ts:216`). |
| 4 | `storage_path` không mang tiền tố `<companyId>/` | 500 ở tầng storage TRƯỚC khi đọc được kết luận policy ⇒ ca "ALLOW" dạng phủ định (`not 403/404`) XANH GIẢ | `assertKeyInTenant` (`storage-key.ts:107`). Ca ALLOW phải assert **200 + có URL**, không assert phủ định. |

### 11.6 `SocialAccessService` — thêm `resolveViewerContext` (không có trong plan)

`FilePolicyService` hỏi quyền tệp qua `FilePermissionInput` **không có `routeKey`** (đường tải là route
của FOUNDATION). Nếu vị từ visibility chỉ nhận `SocialActor` đầy đủ, resolver buộc phải bịa một
`routeKey` hoặc **tự viết lại vị từ** — và bản viết lại sẽ trôi khỏi bản gốc, tức đúng lớp lỗi
`read-path-gate-pair-must-match-download-pair`. Đã tách `SocialViewerContext` (phần ngữ cảnh XEM) để
cổng MÀN HÌNH và cổng ĐƯỜNG TẢI dùng CHUNG một `visiblePostCondition`.

### 11.7 `SocialFileResolver` là BẮT BUỘC, không phải tuỳ chọn

`FilePolicyService.decideForLinkedFile` DENY `deny-no-resolver` khi một link có cặp `(module,entity)`
chưa ai đăng ký, và **không leo thang lên `FOUNDATION.FILE.*`**. Vì luật là AND trên MỌI link của một
tệp, thiếu resolver không chỉ làm đính kèm SOCIAL không ký được URL — nó làm **tệp đó không tải được ở
mọi module khác**. Đăng ký ở `SocialModule.onModuleInit()`.

### 11.8 D20 — 🔴 `user_preferences.feed.showBirthday` **CHƯA TỒN TẠI** (nợ BE-1B)

SPEC-16 §3.5 + SOC-DEC-007 chốt nhân viên tự ẩn sinh nhật bằng `user_preferences.feed.showBirthday`.
Đo thật trên `schema/user-preferences.ts:24-63` + grep toàn bộ `db/schema/*.ts`: **không có cột `feed`,
không có `show_birthday`**, không jsonb nào mang ngữ nghĩa đó (`me_layout_config` là bố cục màn ME).
⇒ `getPreferencesForUsers` CHƯA trả `showBirthday` — trả một cờ luôn `true` từ hư không là **fail-OPEN
có vẻ ngoài hoàn chỉnh**: route `026` sẽ hiện sinh nhật của mọi người và mọi ca test «người đã ẩn không
xuất hiện» xanh giả vì không ai ẩn được. **BE-1B phải mở migration thêm chỗ chứa nó TRƯỚC route `026`.**

### 11.9 Census `feed-*` đếm TOÀN CỤC — đã chạm, chưa vỡ

`s16-social-db1-invariants` + verify block của mig `0578` đếm grant `feed-*` trên **MỌI role**, kỳ vọng
đúng 43. Int-spec của BE-1 gieo role tenant mang cặp `feed-*` ⇒ trên một lane DB **bẩn** (rác tích tụ
từ các lượt chạy hỏng) con số lên 156 và hai ca đó ĐỎ.

**Đo trên lane DB SẠCH sau lượt chạy đầy đủ:** `canonical = 43` · `tenant-role = 0` · 0 company sót ⇒
`cleanupTenants` dọn ĐÚNG, và hai ca đó XANH (98/98). Không phải lỗi sản phẩm, không phải lỗi dọn dẹp.

⚠️ **Nợ `QA-1` GIỮ NGUYÊN và nay có bằng chứng:** census phải thu hẹp về `ro.company_id IS NULL`
(`invariant-count-must-filter-owned-rows`) NGAY KHI có route cho tenant admin cấp `feed-*` cho role
tuỳ biến (BE-1 **không** có route đó — chỉ test mới gieo). Tới lúc đó, cách chạy đúng là
`bash scripts/lane-db-setup.sh <lane> --reset` trước mỗi lượt đo bất biến.

### 11.10 Phạm vi KHÔNG đổi

19 route `SOCIAL-API-001..019` đúng như §4. Route census: **632 → 651** (+19). Không migration mới.

### 11.11 BA CỔNG TOÀN CỤC BẮT ĐƯỢC LỖI THẬT SAU KHI test-của-WO ĐÃ XANH

> Cả ba đều đỏ **sau khi** 148 test của WO đã xanh. Ghi lại vì chúng là bằng chứng cho một điều:
> test của chính WO không đủ để đóng một WO vùng đỏ — cổng toàn cục mới thấy được thứ WO không nhìn.

**(1) `identity-projection-ratchet` — tìm ra một RÒ THẬT, không phải thủ tục.**
Cổng đòi mọi điểm chiếu danh tính có một dòng phán quyết. Nó lôi ra 5 điểm của SOCIAL, và điểm thứ
năm (`resolveMentions:users.fullName`) là **lỗ đang mở**: `droppedMentions[]` trả `fullName` cho một
`userId` mà caller chỉ cần ĐOÁN ⇒ ô soạn thảo thành oracle dò danh bạ, đúng trên đường mà SPEC-16 §12
`ERR-009` dựng ra để không rò gì. Docblock của chính tôi lúc đó khẳng định "không thêm thông tin nào
mới" — câu đó SAI.
**Vá:** `droppedMentions` nay là `string[]` dội lại đúng `userId` caller vừa gửi (thông tin mới = 0);
`users.fullName` bị gỡ khỏi `resolveMentions` ⇒ điểm chiếu thứ năm BIẾN MẤT thay vì xin waiver.
4 điểm còn lại đã ký: `POST_COLUMNS` (`scoped-predicate` — `visiblePostCondition` nằm ngay trong câu)
· `COMMENT_COLUMNS` + `listReactors` (`second-assert` — `assertPostVisible` ở tầng service trước mọi
truy vấn) · `resolveActorName` (`self-bound-row`). Trần: `scoped-predicate` 23→24 · `second-assert`
3→5 · `self-bound-row` 4→5.

**(2) `route-http-coverage` — 4/19 route KHÔNG có ca test nào.**
`GET /social/saved` · `POST|DELETE /social/posts/:post_id/save` · `GET /social/posts/:post_id/reactions`.
Bốn route ghi/đọc THẬT của người dùng lọt lưới vì bộ test của WO đi theo *kịch bản deny-path* chứ
không theo *danh sách route*. Đã viết 7 ca thật (lưu/bỏ lưu/danh sách đã lưu là trạng thái CÁ NHÂN;
danh sách người thả cảm xúc không chở `userId`), rồi mới nâng `MIN_COVERED_COUNT` 632→651.

**(3) `supertest-listen-ratchet` — ca R17 xanh do MAY.**
Ca đua 3 lượt thích (`Promise.all` supertest) thiếu `await app.listen(0)`: không có server đang lắng
nghe thì supertest dựng server tạm cho TỪNG request trên cùng một app, và response ĐẦU TIÊN về đóng
server dùng chung (memory `supertest-closes-shared-server-on-first-response`). Ca vẫn xanh — tức nó
chưa từng đo được lost-update như nó tuyên bố. Đã thêm `app.listen(0)`; **KHÔNG** đổi `Promise.all`
thành vòng `await` tuần tự (làm vậy là bỏ luôn thứ ca đó sinh ra để đo).

**Số đo cuối:** 293 test SOCIAL xanh · 44/44 cổng `test/foundation` xanh · coverage `social/`
**92.36% stmts · 86.3% branches · 93.57% funcs** (ngưỡng 85%) · per-file `social-access.service.ts`
100/86.84 (ngưỡng 90/85).

### 11.12 Lane DB bẩn làm census `feed-*` ĐỎ OAN — cách chạy đúng

Ba lượt debug hỏng để lại 10 company + 27 role test trong lane DB, đẩy grant `feed-*` toàn cục từ 43
lên 156 và làm `s16-social-db1-invariants` đỏ. Sau `lane-db-setup.sh <lane> --reset` + một lượt chạy
sạch: `canonical = 43` · `tenant-role = 0` · 0 company sót ⇒ `cleanupTenants` dọn ĐÚNG.
**Luật:** trước mỗi lượt đo BẤT BIẾN, reset lane DB. Xem §11.9 cho nợ QA-1 đi kèm.

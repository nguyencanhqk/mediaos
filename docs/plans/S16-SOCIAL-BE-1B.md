# Plan S16-SOCIAL-BE-1B — Module `apps/api/src/social/` Nhóm B (10 route: tin tức+ack 020-022 · tìm kiếm/thẻ/profile/sinh nhật 023-026 · báo cáo 027-029)

> 🔴 Crown (permission guard 2 tầng tái dùng từ BE-1 + PII sinh nhật + IDOR đa hình báo cáo). **Nguồn sự thật thi công = [API-19](<../API Design/API-19_SOCIAL_API_Design.md>) §5.1/§5.1b (dòng 85-96)/§7/§8 + [SPEC-16 §3.5/§11/§12/§13/§16/§18.2/§19/§22](<../SPEC/SPEC-16 SOCIAL.md>) + [DB-17 §6.5/§6.6/§6.9/§6.10](<../DB/DB-17 SOCIAL Database Design.md>)** + tiền lệ DUY NHẤT [S16-SOCIAL-BE-1](S16-SOCIAL-BE-1.md).
>
> Reasoning effort **xhigh**. **VÁ SAU REVIEW 22/09/2026** (verdict BLOCK — 2 CRITICAL nhóm C2/C3/C4/C5/C6/C8, 3 HIGH H3/H5/H4-ii-iii, 6 MEDIUM, cộng 7 quyết định A1-A7 owner đã ký). Bản này thay bản trước; không cần vòng review 2 nếu đủ các mục A/C/H/M dưới.

---

## §0. Phạm vi & nợ mang sang

### 0.0 🔴 GAP HỢP ĐỒNG `paths` — 4 thư mục thiếu, phải vá TRƯỚC khi code

Đo trực tiếp `harness/backlog.mjs` (grep `id: "S16-SOCIAL-BE-1B"`): `paths` hiện có `apps/api/src/social/**, apps/api/src/app.module.ts, apps/api/src/realtime/**, apps/api/src/notifications/**, apps/api/src/foundation/**, apps/api/src/config/openapi-modules.ts, apps/api/package.json, apps/api/vitest.config.ts, apps/api/test/**, packages/contracts/**, docs/plans/**, docs/_review/**, harness/backlog.mjs`.

**THIẾU 4 thư mục mà chính `done_when`/quyết định owner của WO này bắt buộc phải chạm:**

1. `apps/api/migrations/**` + `apps/api/src/db/schema/**` — cột `show_birthday` (§6) và migration sửa template NOTI (§7.2, A4).
2. `docs/spec/**` — A2 (owner ký) đòi sửa `docs/SPEC/SPEC-16 SOCIAL.md` dòng 254/502/548 NGAY TRONG WO NÀY.
3. `apps/api/src/me/**` — A3 (owner ký) đòi mở đường ghi `show_birthday` qua API ME thật, không chỉ SQL.

**Áp dụng ĐÚNG tiền lệ BE-1 §0.1b:** vì `harness/backlog.mjs` NẰM TRONG `paths` của chính WO này, bước ĐẦU TIÊN của thi công là tự sửa `harness/backlog.mjs` thêm CẢ 4 mục:

```
"apps/api/migrations/**",
"apps/api/src/db/schema/**",
"docs/spec/**",
"apps/api/src/me/**",
```

vào `paths` của entry `S16-SOCIAL-BE-1B`, kèm `notes` trỏ về mục này. **Cùng một commit** phải xử lý cả 3 việc (migration+schema / SPEC / ME) — KHÔNG phát hiện thư mục thiếu thứ tư giữa chừng rồi vá rời rạc (M-c của review).

### 0.1 `depends_on` — đã đúng, không cần sửa

`depends_on: ["S16-SOCIAL-BE-1"]`. `S16-SOCIAL-BE-1` đã merge (PR #530, `71021c2b`).

### 0.2 Trong / ngoài phạm vi

**Trong phạm vi (10 route `SOCIAL-API-020..029` + 2 nghĩa vụ văn bản đã owner-ký):**

- 10 route như bản trước.
- **A2 (SPEC edit bắt buộc, owner ký 22/09):** sửa `docs/SPEC/SPEC-16 SOCIAL.md` dòng 254 (`SOCIAL-FUNC-009`), dòng 502 (bảng rủi ro §18.2), dòng 548 (`T13`) — cả ba hiện viết "Tôn trọng `showBirthday` ở **mọi** đường ra" / "không ở gắn thẻ/tìm kiếm" — SAI theo hướng owner vừa chọn (C1 = cờ chỉ chặn `day`/`month`, KHÔNG ẩn danh tính). Viết lại thành: _"hai trường `day`/`month` không lộ ở BẤT KỲ đường ra nào (kể cả `023`/`024`/`025`); cờ `showBirthday` KHÔNG ẩn danh tính nhân viên (tên/avatar) khỏi tìm kiếm/thẻ/trang cá nhân — phạm vi của nó là widget sinh nhật (`026`) và mọi trường ngày-tháng phái sinh từ `date_of_birth`."_ Sửa `harness/backlog.mjs` gạch `done_when` route 026 cho khớp (bỏ chữ "mọi đường đọc khác" nếu đang ngụ ý ẩn danh tính, giữ đúng ý "không lộ day/month ở đường khác").
- **A3 (đường ghi, owner ký 22/09):** mở PATCH ghi `show_birthday` qua `apps/api/src/me/**` (mở rộng `mePreferencesSchema`/`mePreferencesPatchSchema` ở `packages/contracts/src/me.ts:294-335`) — KHÔNG chỉ migrate cột rồi để trống đường ghi.
- Migration `0584` (cột `show_birthday`, NULLABLE — §6) + migration `0585` (sửa template NOTI `SOCIAL_NEWS_PUBLISHED`, bỏ `{post_title}` — A4, §7.2).
- Cập nhật `getPreferencesForUsers` (BE-1) trả `showBirthday: boolean | null`.
- Đăng ký NOTI `031`/`036` vào `social-noti-bridge.registrar.ts` (file BE-1).
- Emit NOTI-031 tại `social-posts.service.ts#create()` (file BE-1, điểm chạm chéo §0.3) — **producer tính tập người nhận TRONG CÙNG tx** (C8).
- `@Idempotent()` trên `027`.
- **Census 2 tầng + ratchet toàn cục** (C2/C3/C4/C6) — không còn là "chạy sau", là một phần bắt buộc của §3/§4/§8.

**Ngoài phạm vi:** không đổi so với bản trước (route 030-053, poll/idea/kudos type, `audience='group'`, đính kèm cho báo cáo).

### 0.3 Điểm chạm CHÉO vào file của BE-1 — không đổi

NOTI-031 phát tại `SocialPostsService.create()` khi `type='news'` — sửa file BE-1 `social-posts.service.ts`, không route mới. NOTI-036 phát tại `POST /social/reports` (`027`) — route của chính BE-1B.

### 0.4 Rollback / feature flag — không đổi

Migration `0584` additive (`ADD COLUMN ... NULLABLE`, không DEFAULT — A3), migration `0585` là UPDATE văn bản template (không DDL) — cả hai revert an toàn.

---

## §1. Bảng phép đo M1..M15 (đã sửa M3/M9/M15 theo review; M1/M2/M4/M5/M6/M7/M8/M10/M11/M12/M13/M14 reviewer xác nhận ĐÚNG — giữ nguyên kết luận bản trước, không chép lại ở đây để tránh trôi, xem lịch sử git nếu cần đối chiếu)

| # | Nội dung | Kết luận | Nguồn |
| --- | --- | --- | --- |
| M3 | `SOCIAL_ROUTE_PAIRS` — hình dạng bảng hằng, **SỬA sau H3** | `SocialPair` hiện `{action,resourceType,isSensitive,tier1IsFloor,companyFloor}` — **KHÔNG có `dataScope`**. Bản trước của plan này kết luận "không cần thêm field, dùng `actor.routeScope` lúc runtime là đủ" — **SAI theo review H3**: comment CHÍNH TÁC GIẢ BE-1 để lại ở `social-route-pairs.const.ts:61-66` đã cam kết trước "khi BE-1B mở, nó thêm hàng đó với `companyFloor:false` + `dataScope:"Department"`" — đây là lời hứa MÁY-KIỂM-ĐƯỢC duy nhất rằng route `028` có ép Department, không phải chỉ đúng lúc runtime. ⇒ **THÊM field mới** `dataScope?: "Company" \| "Department"` vào `SocialPair` (optional, `undefined` cho 28/29 route còn lại vì `companyFloor:true` đã đủ); route `reportsList` khai `{..., companyFloor:false, dataScope:"Department"}`. Thêm 1 dòng census: MỌI route `companyFloor:false` BẮT BUỘC có `dataScope` xác định (không `undefined`) — nếu không, census đỏ. | `apps/api/src/social/social-route-pairs.const.ts:31-75,61-66` (comment đã có sẵn từ BE-1) |
| M9 | Cơ chế ép scope Department — **SỬA sau H3** | Khuôn `AssetAccessService.buildReadScopeExists` (`asset-access.service.ts:81-104`) vẫn là tiền lệ đúng NHƯNG chỉ xử lý 2 nhánh (`Department`/mặc định-Own). `DataScopeService` trả về CÒN CÓ `Own`/`Team` (`data-scope.service.ts:181-192` case `"Department"`/`"Team"`, `:320-330` case tương tự cho detail) — route `028` PHẢI xử lý bằng **`switch` VÉT CẠN cả 5 giá trị** (`Company`,`System`,`Department`,`Team`,`Own`), không phải `if (scope==='Department') ... else`: `Company\|System` ⇒ không lọc; `Department` ⇒ `inArray(orgUnitIds)`, rỗng ⇒ `sql\`false\``; **`Team`/`Own`/bất kỳ giá trị khác ⇒ `sql\`false\`` + throw hoặc log — KHÔNG rơi vào nhánh mặc định của Asset (nhánh đó ngầm coi Own=Team=lọc theo actor, sai ngữ nghĩa cho báo cáo: một cặp `view:feed-report@Own` không có nghĩa gì trong SPEC-16 §11.1, để lọt qua `companyFloor:false` là fail-OPEN)**. Lý do `companyFloor:false` không tự chặn `Own`/`Team`: nó chỉ chặn scope HẸP HƠN Company khi cờ `companyFloor:true`; tắt cờ đó (như route 028 cần, để Department lọt qua) đồng thời mở toang cho MỌI scope khác resolve được, kể cả `Own`/`Team` mà SPEC không hề định nghĩa cho cặp này. | `apps/api/src/permission/data-scope.service.ts:181-192,320-330`; `apps/api/src/assets/asset-access.service.ts:81-104` |
| M15 | Danh sách ĐÓNG đường đọc trả tên/avatar nhân viên — **SỬA, thêm route `022`** | Bản trước bỏ sót route `022` (`GET /social/posts/{id}/acks` — "ai đã đọc/chưa đọc") — đây LÀ một đường chiếu danh tính TOÀN BỘ nhân viên trong audience của bài (nửa "chưa đọc" cần liệt kê ai CHƯA có hàng `feed_post_acks`, tức lấy danh sách người thuộc audience rồi trừ đi người đã ack — chiếu tên/avatar của MỌI người trong audience, không chỉ người đã tương tác). Danh sách ĐÓNG đúng: `026`(birthdays, gate showBirthday) · `023`(search) · `025`(profiles) · **`022`(acks list, MỚI)**. `024`(tags) không có identity — loại. "mention-resolve" xác nhận KHÔNG PHẢI route SOCIAL (giữ kết luận bản trước, reviewer xác nhận ĐÚNG). | API-19 §5.1 dòng 87; DB-17 §6.9 |

**CHƯA ĐO (giữ nguyên từ bản trước):** giá trị hiện tại `unpipedIdParamSites().length` — tự đo lại trước khi viết controller đầu tiên (§8), không tin số cũ.

---

## §2. Các quyết định (D1..D13) — đã tách CHỐT (owner ký 22/09) khỏi CẦN CHỮ KÝ Ở PR

### 2.1 ĐÃ CHỐT — không còn cần chữ ký, chỉ cần trích nguồn khi code

| # | Quyết định | Chốt | Căn cứ |
| --- | --- | --- | --- |
| **D3** (thay D3 cũ) | Default/ý nghĩa `showBirthday` | **"Hiện" là mặc định** — SPEC đã tự trả lời, KHÔNG cần hỏi lại owner (A1) | SPEC-16 dòng chứa `SOC-DEC-007`: _"Nhân viên ẩn sinh nhật qua `user_preferences.feed.showBirthday=false` **(mặc định hiện)**."_ — trích NGUYÊN VĂN |
| **D10** (MỚI, A2) | Phạm vi `showBirthday` | Cờ CHỈ chặn `day`/`month` (và mọi trường phái sinh `date_of_birth`); KHÔNG ẩn danh tính (tên/avatar) khỏi `023`/`024`/`025`. Kèm SỬA VĂN BẢN SPEC-16 dòng 254/502/548 (§0.2) | Owner chốt 22/09 (C1 phương án "cờ hẹp + sửa SPEC") |
| **D6** (SỬA, A5+A6) | Department scope báo cáo = nội dung, không phải reporter | Manager Department **KHÔNG** thấy báo cáo về bài `audience='company'` (`org_unit_id IS NULL`) — HR/company-admin (Company) xử lý loại này. Định nghĩa nhất quán với cách repo LUÔN gắn `data_scope` theo org_unit của HÀNG CHỦ THỂ (không phải hàng người thao tác) | `data-scope.service.ts:183-185,326`; `asset-access.service.ts:81-104`; SOC-DEC-010 (SPEC-16, đoạn "Thống kê theo tuần & đơn vị: sàn scope Company (manager Department)" — cùng khuôn Company/Department cho SOCIAL) |

### 2.2 CẦN CHỮ KÝ Ở PR (SPEC thật sự im lặng — không phải khẩu vị kỹ thuật)

| # | Quyết định | Đề xuất của plan | Vì sao chưa tự chốt được |
| --- | --- | --- | --- |
| **D2** (SỬA, A3) | Cột `show_birthday` — hình dạng lưu trữ | **NULLABLE, KHÔNG DEFAULT** (`boolean` đơn, không jsonb) — `NULL` = kế thừa "hiện" (đúng luật cột override của CHÍNH bảng này: `user-preferences.ts:21,36` "Cột override NULLABLE = kế thừa company/system default"). KHÔNG cần chữ ký thêm — đây là ÁP DỤNG quy ước sẵn có của bảng, ghi ở đây để không lẫn với D3 (ý nghĩa) | — |
| **D5** | Mã lỗi "báo cáo trùng còn mở" | 409, bắt theo **TÊN constraint** `feed_reports_open_uq` (KHÔNG chỉ mã PG `23505`, vì mọi UNIQUE khác trên `feed_reports` cũng ném `23505` — bắt theo mã trần sẽ dịch NHẦM unique violation khác thành "báo cáo trùng"); khai một hằng CÓ TÊN trong `SOCIAL_ERR` (`REPORT_DUPLICATE_OPEN` — KHÔNG số hoá `SOCIAL-ERR-XXX`, catalog 001-022 đã dùng hết) để test assert theo hằng, không theo câu chữ tự do; nhớ drizzle giấu mã PG gốc trong `error.cause`, phải đào `error.cause.cause?.constraint` (hoặc tương đương của driver đang dùng — đo lại khi code, không giả định tên field) | SPEC-16 §12 im lặng hoàn toàn về ca này (đã quét hết 001-022) |
| **D13** (MỚI, H5) | DTO route `028`/`029` — trường nào lộ | `{id, targetType, targetId, targetSnapshot: {postId, authorEmployeeId, authorFullName, avatarUrl, bodyExcerpt(≤200 ký tự), status, deletedAt} \| null, reporter: {employeeId, fullName, avatarUrl}, reason, note, status, resolvedBy?, resolvedAt?, resolutionNote?, createdAt, updatedAt}` — **CÓ lộ danh tính người báo cáo** (đối lập với ẩn danh) vì SPEC không có điều khoản báo cáo ẩn danh (khác poll, nơi SPEC MINH THỊ ẩn danh — SOC-DEC-009) và trách nhiệm giải trình khi xử lý vi phạm cần biết ai báo cáo (chống báo cáo bừa). **CÓ lộ trích đoạn nội dung** (`bodyExcerpt`) vì đây LÀ mục đích của hàng đợi kiểm duyệt | Đánh đổi hiệu ứng chùn-tay-tố-giác chưa có câu trả lời SPEC — nêu tường minh trong PR |
| — (H4-ii) | `targetSnapshot` đọc bài `hidden`/đã xoá mềm SAU KHI báo cáo | `targetSnapshot` đọc **TRỰC TIẾP** `feed_posts`/`feed_comments`, **BYPASS `visiblePostCondition`/`assertPostVisible`** — chỉ lọc `company_id` (+ org_unit nếu Department, D6) — vì actor đã qua cổng `view:feed-report`/`manage:feed-report` (một cặp quyền RIÊNG, cao hơn `view:feed`), và mục đích của hàng đợi là xem ĐƯỢC nội dung dù đã bị ẩn/xoá để ra quyết định. UI hiện `status`/`deletedAt` để đánh dấu "[đã xoá]"/"[đã ẩn]" thay vì che nội dung. Đây là một BYPASS CÓ CHỦ Ý của cổng crown-jewel `visiblePostCondition` — PHẢI nêu tường minh trong PR để FULL gate soi kỹ, KHÔNG âm thầm | Không có tiền lệ "đọc xuyên gate" nào trong BE-1 — quyết định MỚI |
| **D13-R** (RÀNG BUỘC bắt buộc của D13) | Hình dạng code của snapshot đích | **KHÔNG tồn tại hàm public nhận `(targetType,targetId)` rời.** Snapshot là một **JOIN NẰM TRONG CHÍNH câu `listReports`/`getReport`** — câu đó đã lọc `company_id` + vị từ D6 — và `target_id` lấy từ chính hàng `feed_reports` vừa qua vị từ đó, KHÔNG BAO GIỜ từ tham số caller. Lý do: một helper nhận id rời chỉ cần THÊM MỘT call-site nữa là biến thành "đọc bất kỳ bài nào trong tenant, xuyên mọi vị từ" — lớp lỗi `reused-method-must-be-actor-scoped`. Ca chứng minh: N-D13-c/d/e | Ràng buộc kỹ thuật, không cần chữ ký — nhưng FULL gate phải soi đúng điểm này |
| — (H4-iii) | Người nhận NOTI-036 | Chỉ gửi cho actor có `manage:feed-report` **VÀ** (Company scope HOẶC Department scope mà báo cáo thuộc org_unit của actor) — **KHÔNG** gửi cho MỌI người có `view:feed-report`/`manage:feed-report` như SPEC-16 dòng "Người có `view:feed-report`" viết literal (SPEC dùng câu ngắn gọn, không tính tới Department — sửa hành vi cho khớp D6, không sửa NOTI catalog). Producer (`social-reports.service.ts#create`) tính tập người nhận TRONG tx bằng CÙNG vị từ Department đã dùng ở route `028` | Diễn giải SPEC câu ngắn cho khớp D6 — cần PR nêu rõ để không ai đọc SPEC rồi tưởng bug |

### 2.3 Bảng D còn lại (không đổi kết luận, giữ cho đủ mạch D1..D13)

| # | Nội dung | Trạng thái |
| --- | --- | --- |
| D1 | Vá `paths` backlog | ĐÃ MỞ RỘNG — 4 mục, không phải 2 (§0.0) |
| D4 | Không cần RLS/policy mới cho migration `0584` | Không đổi |
| D7 | `025`/`020` tái dùng `listFeed`; `023`/`026`/`022` cần repository/hàm mới | Không đổi, nhưng `022` nay được gọi tên rõ là điểm chiếu identity thứ 3 (M15) |
| D8 | Tách 3 domain file (news/discovery/reports) | Không đổi |
| D9 | `021` KHÔNG cần `@Idempotent()` | Reviewer xác nhận ĐÚNG, giữ nguyên |
| D11 (MỚI) | Đường ghi `show_birthday` qua ME API | `PATCH /me/preferences` (khuôn hiện có) — mở rộng `mePreferencesSchema`/`mePreferencesPatchSchema` (`packages/contracts/src/me.ts:294-335`) thêm `showBirthday: z.boolean().nullable().optional()`; `mePreferencesPatchSchema` đang `.strict()` — thêm field vào allowlist đó (A3) |
| D12 (MỚI) | Sửa template NOTI `SOCIAL_NEWS_PUBLISHED` | Bỏ `{post_title}` khỏi `title_template`/`variables_schema` (A4, §7.2) |

---

## §3. Cấu trúc file module (BỔ SUNG vào `apps/api/src/social/`)

| File | Trách nhiệm | Ước lượng dòng |
| --- | --- | --- |
| `social-news.repository.ts` | `ackPost` · `ackedPostIds` (batch) · **`unackedEmployeesFor(tx,companyId,postId)`** (route `022` nửa "chưa đọc" — nguồn: TOÀN BỘ nhân viên có `view:feed` hiệu lực trong audience của bài, TRỪ người đã có hàng `feed_post_acks`; phân trang **offset** — SPEC-16 NFR "offset cho các danh sách quản trị", M-e) · `countUnackedFor` | 180-220 |
| `social-news.service.ts` | `020`(list, `sort='active'` cố định + `ackedByMe`) · `021`(ack) · `022`(acks list, gọi `resolveActor(user,"postAcksList")` — census C2) | 150-200 |
| `social-news.controller.ts` | 3 route, `ParseUUIDPipe` cấp method trên MỌI `@Param` (`021`/`022` có `:post_id`) | 100-150 |
| `social-discovery.repository.ts` | `search` (tsvector, điểm chiếu identity MỚI #1) · `listTags` (không identity) · `birthdays` (điểm chiếu identity MỚI #2 — **KHÔNG dùng `visiblePostCondition`**, xem M15/§9: vị từ thật là `company_id` + lọc `show_birthday`, sàn `view:feed`) | 200-250 |
| `social-discovery.service.ts` | `023`/`024`/`025`(tái dùng `listFeed` với `authorUserId` suy từ `employee_id` param — **C5, xem §4.1**)/`026`, mỗi method gọi `resolveActor(user,"<key>")` riêng | 200-250 |
| `social-discovery.controller.ts` | 4 route TĨNH, `ParseUUIDPipe` cho `:employee_id` của `025` | 120-160 |
| `social-reports.repository.ts` | `createReport` (bắt `23505` theo TÊN constraint, D5) · `listReports` (D6 switch vét cạn, M9) · `resolveReport`: UPDATE đặt **ĐỒNG THỜI** `status`, `resolved_by`, `resolved_at`, `resolution_note`, `updated_at` trong **MỘT** câu, `WHERE status='open' RETURNING` — thiếu MỘT trong cặp `resolved_by`/`resolved_at` ⇒ vỡ `chk_feed_reports_resolved_pair` (`db/schema/social.ts:465-468`), **KHÔNG được "sửa" bằng cách nới CHECK** (M-f) · snapshot đích: **KHÔNG có hàm public nhận `(targetType,targetId)` rời** — xem ràng buộc D13-R dưới §2.2 | 200-250 |
| `social-reports.service.ts` | `027`(assertTargetVisible rồi createReport, `@Idempotent()`, tính người nhận NOTI-036 TRONG tx theo D6) · `028`(resolveActor companyFloor:false, switch D6/M9) · `029`(manage:feed-report, audit `feed_report`, NOTI-036) | 200-240 |
| `social-reports.controller.ts` | 3 route | 100-150 |
| `apps/api/src/me/**` | **MỚI theo A3.** Mở rộng handler PATCH preferences hiện có để chấp nhận `showBirthday` — KHÔNG route mới, sửa DTO + service ghi cột | +10-20 dòng vào file ME đã có |
| `social.module.ts` | +3 controller, +6 provider | +15-20 |
| `social-route-pairs.const.ts` | +10 khoá, **+field `dataScope` cho interface** (M3), route `028` = `{...pair("view","feed-report",false,false), dataScope:"Department"}` | +30-40 |
| `social-preferences.ts` | `showBirthday: boolean \| null` | +3-5 |
| `social-posts.service.ts` (BE-1) | Emit `031`, tính người nhận TRONG tx (C8) | +10-15 |
| `social-noti-bridge.registrar.ts` (BE-1) | 2 `registerSource()`; khoá nới **ĐÃ ĐO** (`registrar.ts:14-30`, 22/09): `PAYLOAD_KEYS` đã có `actor_name`·`post_id`·`target_type_label` ⇒ **031 không cần thêm khoá nào**, thiếu **đúng MỘT**: `reason_label`. `TEMPLATE_KEYS` thêm **đúng 2** entry: `SOCIAL_NEWS_PUBLISHED: ["actor_name","post_id"]` (sau khi `0585` bỏ `post_title`) · `SOCIAL_POST_REPORTED: ["target_type_label","reason_label"]`. ⚠️ **Bẫy:** `PAYLOAD_KEYS` có CẢ `postId` LẪN `post_id`; deep-link `/social/posts/{post_id}` chỉ ăn khoá **snake** ⇒ producer phải emit `post_id` (không chỉ `postId`), nếu không `assertInternalTargetUrl` từ chối URL còn placeholder (docblock `:38-43`) | +35-45 |
| `apps/api/test/foundation/social-two-layer-guard-census.unit-spec.ts` | `19→29` ở `toBe`; +10 `ROUTE_TO_KEY`; +10 `SERVICE_SITES`; +1 assert `companyFloor:false ⇒ dataScope` xác định | +40-60 |
| `apps/api/test/foundation/route-http-coverage.e2e-spec.ts` | `MIN_COVERED_COUNT 651→661` | 1 dòng + comment |
| `apps/api/test/foundation/identity-projection-verdicts.ts` | **+4 điểm chiếu (KHÔNG phải 3)**: `search` · `birthdays` · `unackedEmployeesFor` (route `022`) dán `scoped-predicate` ⇒ `BASIS_CEILINGS["scoped-predicate"] 24→27`; **điểm thứ 4 = snapshot đích của `028`/`029`** (`authorFullName`/`avatarUrl`) **KHÔNG ĐƯỢC dán `scoped-predicate`** — đường đó CỐ Ý không mang vị từ visibility, dán nhãn scope lên nó là khai sai trong chính sổ sinh ra để chống khai sai ⇒ dán `second-assert` (căn cứ: hàng `feed_reports` đã qua vị từ D6 + cặp `view/manage:feed-report`) ⇒ `BASIS_CEILINGS["second-assert"] 5→6`. Số nền `scoped-predicate:24`/`second-assert:5` đo `identity-projection-verdicts.ts:720-741` (22/09) — **đo lại trước khi sửa**, đừng tin số này nếu có WO khác land giữa chừng | +25-35 |
| `apps/api/test/foundation/param-uuid-ratchet.unit-spec.ts` | Không sửa NỘI DUNG (đẳng thức tự-đo-lại) — chỉ chạy lại sau mỗi controller | 0 |
| `packages/contracts/src/social-api.ts` | DTO 10 route + `FeedReportDto`/`FeedReportListItemDto` (D13) | +180-220 |
| `packages/contracts/src/me.ts` | `showBirthday` vào `mePreferencesSchema`/`mePreferencesPatchSchema` (D11) | +4-6 |
| `apps/api/migrations/0585_...sql` | UPDATE template `SOCIAL_NEWS_PUBLISHED` (D12) | ~20 |

**Tổng ~11 file mới/đáng kể + 10 file BE-1/hạ tầng sửa additive.**

---

## §4. Bảng 10 route Nhóm B (Tầng 2 = key `resolveActor` THẬT — C2)

| Mã | Method · Path | Guard (tầng-1) | `tier1IsFloor` | `dataScope` | Tầng 2 = `resolveActor(user,"<key>")` | Idemp | Audit | NOTI | Mã lỗi |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 020 | `GET /social/news` (TĨNH) | `view:feed` | false | — | `"newsList"` | — | — | — | — |
| 021 | `POST /social/posts/{id}/ack` | `view:feed` | false | — | `"postAck"` | — (D9) | — | — | `ERR-011` |
| 022 | `GET /social/posts/{id}/acks` | `manage:feed-news` | false | — | `"postAcksList"` | — | — | — | `ERR-001` |
| 023 | `GET /social/search` (TĨNH) | `view:feed` | false | — | `"search"` | — | — | — | — |
| 024 | `GET /social/tags` (TĨNH) | `view:feed` | false | — | `"tagsList"` | — | — | — | — |
| 025 | `GET /social/profiles/{employee_id}/posts` | `view:feed` | false | — | `"profilePosts"` | — | — | — | — |
| 026 | `GET /social/birthdays` (TĨNH) | `view:feed` | false | — | `"birthdays"` | — | — | — | — |
| 027 | `POST /social/reports` | `view:feed` | false | — | `"reportCreate"` | ✅ | — | — | D5 (409, không số) |
| 028 | `GET /social/reports` (TĨNH) | **`view:feed-report`** | false | **`"Department"`** | `"reportsList"` | — | — | — | — |
| 029 | `PATCH /social/reports/{id}` | `manage:feed-report` | false | — | `"reportResolve"` | — | ✅ `feed_report` | `036` | `ERR-021` |

**Thứ tự khai TĨNH-trước-`{id}`:** `news`·`search`·`tags`·`birthdays`·`reports`(GET) trước `posts/{id}/ack`·`posts/{id}/acks`·`profiles/{employee_id}/posts`·`reports/{id}`. `ParseUUIDPipe` cấp method trên MỌI `@Param` của `021/022/025/029` (ratchet §8).

### 4.1 C5 — `employee_id` (param `025`) → `author_user_id` (cột `listFeed` nhận)

`SocialPostsRepository.listFeed` (`social-posts.repository.ts:61-75`) nhận `authorUserId?: string`, KHÔNG có `authorEmployeeId` — nhưng `feedPosts.authorEmployeeId` LÀ một cột thật (dòng 260, `POST_COLUMNS`). **Chốt:** service `025` tra `employeeProfiles` MỘT LẦN (`eq(companyId) AND eq(id, employeeIdParam) AND deleted_at IS NULL`) lấy `userId`, rồi gọi `listFeed({authorUserId: đó})` — KHÔNG lọc thẳng bằng `authorEmployeeId` trên `feedPosts` (tránh mở thêm một đường lọc song song với `authorUserId` mà `POST_COLUMNS`/mapper đã dựa vào). `employee_id` không tồn tại hoặc thuộc tenant khác ⇒ tra rỗng ⇒ `listFeed({authorUserId: undefined-nhưng-không-match-gì})` phải trả **DANH SÁCH RỖNG, KHÔNG 404** — cùng một câu trả lời với "nhân viên có tồn tại nhưng chưa đăng bài nào actor thấy được" (không tạo oracle phân biệt "employee_id sai" với "employee_id đúng nhưng không có bài"). Thiết kế: nếu tra không ra `userId`, truyền một UUID không thể khớp (hoặc rẽ nhánh trả `[]` thẳng) — KHÔNG throw `NotFoundException`.

---

## §5. Deny-path RED trước + ALLOW đối chứng

> Luật fixture riêng mỗi describe (BE-1 §11.13, reviewer xác nhận ĐÚNG) — giữ nguyên.

**NGUYÊN VĂN §9.1 BE-1 (H3 review gốc) + `done_when` backlog — giữ y hệt bản trước, không chép lại ở đây để tránh trôi (xem bản git trước hoặc §5 gốc đã publish).**

### 5.1 Bảng ca test (bổ sung theo C2/C3/C4/C5/C6/D5/D6/D13/H3/H4)

| # | Ca | Kỳ vọng | Đối chứng / đo được |
| --- | --- | --- | --- |
| N1-N13, W1', R27'/R28'/R30' | — như bản trước, không đổi — | — | — |
| **C2-a** | Census 2 tầng: mỗi route 020-029 có ĐÚNG MỘT lời gọi `resolveActor(user,"<key literal>")` trong service tương ứng | `SERVICE_SITES` khớp `ROUTE_TO_KEY` — không route nào thiếu, không route nào gọi sai key | `social-two-layer-guard-census.unit-spec.ts` — đẳng thức hai chiều (BE-1 khuôn dòng 173-181) |
| **C2-b** | Không route nào trong 10 route mới đặt `tier1IsFloor=true` | Tất cả 10 route có cặp tầng-1 = cặp tầng-2 (API-19 §5.1 không có route nào rẽ theo nội dung request trong nhóm này) | Assert tập `tier1IsFloor===true` của 10 route MỚI rỗng |
| **C2-c** | Route `companyFloor:false` (chỉ `028`) BẮT BUỘC có `dataScope` xác định | `028.dataScope === "Department"`; mọi route khác `dataScope === undefined` | Assert lặp `SOCIAL_ROUTE_PAIRS` |
| **C3-a** (route 020) | Bài ghim lên đầu, `ackedByMe` đúng theo TỪNG actor (2 actor khác nhau, 1 đã ack 1 chưa) | Thứ tự đúng, cờ đúng | So `res.body.items[i].ackedByMe` với `feed_post_acks` thật |
| **C3-b** (route 020) | `unackedOnly=true` + `countOnly=true` | Trả đúng tập/đúng số (nguồn `SOCIAL-WIDGET-002`) | Đếm khớp `SELECT count(*) FROM feed_posts p WHERE requires_ack AND NOT EXISTS(ack của actor)` |
| **C3-c** (route 020) | Tin `audience='org_unit'` đơn vị KHÁC | KHÔNG lọt vào `/social/news` của actor ngoài đơn vị | 404-tương-đương ở mức liệt kê: bài đó vắng mặt trong response |
| **C4** (route 023) | Gieo 4 bài cùng từ khoá: (a) thấy được (b) `hidden` tác giả khác (c) `org_unit` khác (d) tenant khác | Tập id trả về **BẰNG ĐÚNG** `[a]` — `toEqual` mảng id đã sort, KHÔNG `toContain`; neo dương `length===1` (chống lệch cấu hình `'simple'` cho 0-kết-quả im lặng, M5) | `social-be1b-discovery.int-spec.ts` |
| **C5** | `employee_id` tenant khác | Trả **CÙNG MỘT** response rỗng như `employee_id` hợp lệ nhưng chưa có bài — KHÔNG 404 khác biệt | So 2 response byte-giống-nhau (không oracle) |
| **C6** | Điểm chiếu `022` (`unackedEmployeesFor`) chỉ lộ cho actor có `manage:feed-news` | Actor thường gọi `022` → 403 tầng 1, KHÔNG tới được truy vấn | N4 (giữ từ bản trước) |
| **N-D6-a** | Manager Department đọc report về bài `audience='company'` | **KHÔNG xuất hiện** (D6 chốt) | Đếm không đổi khi thêm report loại này |
| **N-D6-b** | HR (Company) đọc report về bài `org_unit` bất kỳ | Xuất hiện | N12 (giữ) |
| **N-H3** | `resolveActor("reportsList")` nạp một scope KHÔNG PHẢI `Company\|System\|Department` (giả lập `Own`/`Team` hoặc giá trị lạ qua mock) | Trả **0 hàng** (`sql\`false\``), KHÔNG throw 500, KHÔNG lộ dữ liệu | Unit test mock `dataScope.resolveManyOrNull` trả `"Own"` cho cặp `view:feed-report` |
| **N-D5** | Tạo 2 báo cáo trùng `(targetType,targetId,reporter)` khi cái đầu còn `open`, RỒI tạo 1 báo cáo trùng `(targetType,targetId)` nhưng KHÁC `reporter` | Cái đầu 409; cái thứ hai (reporter khác) → 201 (unique index chỉ khoá theo BỘ BA, không theo target đơn) | Kiểm đúng field nào bị khoá — tránh hiểu nhầm "1 target chỉ nhận 1 báo cáo" |
| **N-D13-a** | `targetSnapshot` của report trên bài ĐÃ bị ẩn (`status='hidden'`) SAU KHI report tạo | Vẫn trả `targetSnapshot` đầy đủ (đọc xuyên gate, D13/H4-ii), kèm `status:"hidden"` | Actor gọi `028`/`029` có `manage:feed-report`, không qua `assertPostVisible` |
| **N-D13-b** | `targetSnapshot` của report trên bài ĐÃ xoá mềm | Vẫn trả, kèm `deletedAt` khác null | như trên |
| **N-H4-iii** | Report về bài `org_unit` X được tạo | NOTI-036 CHỈ tới actor có `manage:feed-report`@Company HOẶC @Department-của-X — KHÔNG tới manager của đơn vị Y | Đếm hàng `notifications` theo `recipient_user_id` |
| **N-C8** | Bài `type='news', audience='org_unit'` được tạo | NOTI-031 CHỈ tới user thuộc đơn vị đó, KHÔNG toàn công ty | Đếm hàng `notifications` |
| **N-D13-c** (deny) | Actor CHỈ có `view:feed`, không có cặp `view/manage:feed-report`, gọi `028`/`029` | **403 tầng 1** — không tới được đường snapshot | Assert KHÔNG có truy vấn snapshot nào chạy (spy repository) — chứng minh bypass nằm SAU cổng quyền, không song song với nó |
| **N-D13-d** (deny) | Manager Department gọi `028`; tenant có report về bài `org_unit` KHÁC | Response KHÔNG chứa `targetSnapshot` của bài đó (và không chứa cả hàng report đó) | Chứng minh bypass bị D6 chặn ở CHÍNH câu truy vấn, không phải chỉ chặn ở tầng danh sách rồi snapshot vẫn chạy riêng |
| **N-D13-e** (oracle) | Tạo bài `hidden` **KHÔNG bị báo cáo**; actor có `manage:feed-report` gọi mọi đường của `028`/`029` | Không đường nào trả nội dung bài đó | Chứng minh snapshot KHÔNG dùng được như oracle đọc bài bất kỳ (D13-R) |
| **H5-keys** | DTO `028`: `Object.keys(item)` và `Object.keys(item.targetSnapshot)` | **BẰNG ĐÚNG** tập trường liệt kê ở D13 — `toEqual`, KHÔNG `toMatchObject` | DTO này chở danh tính người tố giác + trích đoạn nội dung ⇒ cột thừa lọt vào sẽ VÔ HÌNH nếu chỉ assert lỏng |
| **N-C8-trần** | Hạ trần người nhận qua hằng/config TRONG TEST (rẻ hơn gieo 501 user) rồi tạo bài `news` vượt trần | ĐÚNG `<trần>` hàng `notifications`; payload outbox có `recipientsTruncated:true` + `totalRecipients:N`; log WARN có `post_id`+tổng+trần | Cắt CÂM là thứ duy nhất bị cấm (§7.1) — ca này đo cờ/log, không chỉ đếm hàng |
| **N-A4-a** | Render template `SOCIAL_NEWS_PUBLISHED` sau vá | Title/body KHÔNG còn `{post_title}`, KHÔNG còn `{` nào sau render (mọi biến đã thay) | `payloadOf`/render pipeline |
| **N-A4-b** | Render template `SOCIAL_POST_REPORTED` | `{target_type_label}`/`{reason_label}` render đúng nhãn tiếng Việt từ bảng ĐÓNG (enum→nhãn) | 2 ca: `target_type='post'`/`'comment'`, ≥2 giá trị `reason` |

---

## §6. Migration `0584` — cột `show_birthday` (SỬA theo A3: NULLABLE, không DEFAULT)

### 6.1 Thứ tự

1. Vá `harness/backlog.mjs` (§0.0, 4 mục).
2. Sửa `apps/api/src/db/schema/user-preferences.ts`: `showBirthday: boolean("show_birthday")` — **KHÔNG `.notNull()`, KHÔNG `.default(...)`** (đổi từ bản trước).
3. Migration `0584` bằng tay (không `db:generate`, giữ quy ước hiện có của file).
4. Không RLS/policy/GRANT mới (D4, không đổi).

### 6.2 Nội dung migration

```sql
-- 0584_s16socialbe1b_feed_show_birthday.sql
-- NULLABLE, KHÔNG DEFAULT (A3, owner 22/09) — NULL = kế thừa "hiện" (SOC-DEC-007, D3).
-- ⚠️ ALTER TABLE ADD COLUMN giữ ACCESS EXCLUSIVE lock ngắn trên user_preferences — bảng NÓNG
--    của module ME (mọi request đọc preference đi qua nó). Chạy ngoài giờ cao điểm nếu PROD.

ALTER TABLE user_preferences
  ADD COLUMN show_birthday boolean;

COMMENT ON COLUMN user_preferences.show_birthday IS
  'S16-SOCIAL-BE-1B — NULL = kế thừa mặc định "hiện" (SOC-DEC-007). '
  'Chỉ gate 2 trường day/month ở /social/birthdays — KHÔNG ẩn danh tính ở search/tags/profiles (D10).';

DO $$
DECLARE
  v_is_nullable text;
  v_default     text;
BEGIN
  SELECT is_nullable, column_default
    INTO v_is_nullable, v_default
    FROM information_schema.columns
   WHERE table_name = 'user_preferences' AND column_name = 'show_birthday';

  -- Kiểm CẢ HAI thuộc tính, không chỉ "cột tồn tại": một lượt sửa sau vô tình thêm NOT NULL/DEFAULT
  -- sẽ phá đúng quyết định A3 (NULLABLE = kế thừa) mà verify kiểu "đếm hàng" sẽ KHÔNG bắt được —
  -- đọc information_schema là kiểm THUỘC TÍNH SCHEMA, không phải dữ liệu, nên không dính bẫy
  -- "verify đếm hàng xanh rỗng" đã cắn ở DB-2 (0 hàng vẫn qua nếu đếm điều kiện sai).
  IF v_is_nullable IS DISTINCT FROM 'YES' OR v_default IS NOT NULL THEN
    RAISE EXCEPTION '[0584] show_birthday phai NULLABLE khong DEFAULT (nullable=%, default=%) — fail-closed',
      v_is_nullable, v_default;
  END IF;
END $$;
```

### 6.3 Cập nhật `getPreferencesForUsers` + đường ghi ME (D11)

```ts
export interface SocialUserPreference {
  userId: string;
  locale: string | null;
  timezone: string | null;
  showBirthday: boolean | null; // NULL = kế thừa "hiện" — caller KHÔNG tự áp default ngược
}
```

Caller ở `026`: `showBirthday === false` ⇒ ẩn; `true`/`null`/vắng-mặt-trong-Map ⇒ hiện (BA trạng thái gộp về MỘT nhánh "hiện", viết rõ trong code để không ai tưởng `null` cần xử lý riêng).

**D11 — đường ghi:** `packages/contracts/src/me.ts:294-335` — thêm `showBirthday: z.boolean().nullable().optional()` vào CẢ `mePreferencesSchema` (đọc) và `mePreferencesPatchSchema` (`.strict()`, ghi). Handler PATCH hiện có của `apps/api/src/me/**` chỉ cần propagate field mới qua UPDATE hiện có (không route mới). Ca test: đặt cờ QUA `PATCH /me/preferences` (không UPDATE SQL trực tiếp) rồi gọi `GET /social/birthdays` xác nhận có hiệu lực — chứng minh đường ghi THẬT hoạt động, không chỉ migration chạy được.

---

## §7. Audit · NOTI outbox

### 7.1 Bảng ánh xạ (không đổi khung, sửa `resolveRecipients` theo C8/H4-iii/D6)

| Hành động | `audit_logs.object_type` | `eventCode` | `sourceEntityType` | `resolveRecipients` | `dedupeKeyOf` |
| --- | --- | --- | --- | --- | --- |
| Tạo bài `news` (`social-posts.service.ts#create`) | — | `SOCIAL_NEWS_PUBLISHED` (`031`) | `feed_post` | **Producer tính TRONG tx** (C8): truy vấn user thuộc audience (company-wide hoặc `org_unit` của bài) NGAY LÚC TẠO, nhét mảng `userIds` vào payload — registrar CHỈ đọc lại, KHÔNG tự tra DB (khác khuôn ASSET/LEAVE) | `{post_id}` |
| Xử lý báo cáo (`029`) | `feed_report` (đã có trong CHECK từ `0579`) | — | — | — | — |
| Tạo báo cáo (`027`) | — | `SOCIAL_POST_REPORTED` (`036`) | `feed_report` | **Producer tính TRONG tx** bằng CÙNG vị từ Department mà `028` dùng (D6/H4-iii) — Company-scope actor LUÔN nhận; Department-scope actor CHỈ nhận nếu bài đích thuộc org_unit của họ | `{report_id}` |

**Trần người nhận NOTI-031 (C8-ii, chốt NGAY Ở WO NÀY, không đẩy BE-2):** giới hạn cứng **500 người nhận/lượt phát**, v1 không chia lô (công ty >500 người vẫn đọc tin qua `/social/news`; NOTI là kênh đẩy phụ). **Nhưng CẮT CÂM BỊ CẤM** — cắt im lặng là đúng hình dạng "thành công RỖNG = fail-OPEN": không ai biết, và hệ quả nghiệp vụ THẬT là tin `requiresAck` — người thứ 501+ không hề được báo nhưng route `022` vẫn liệt họ vào danh sách "chưa đọc". Ba ràng buộc bắt buộc:

1. **Xác định (deterministic):** sắp xếp tập người nhận theo khoá ổn định (`user_id` tăng dần) **TRƯỚC** khi cắt — cắt theo thứ tự ngẫu nhiên của query là không tái lập được, ca test sẽ flaky và sự cố thật không truy được ai bị bỏ.
2. **Quan sát được:** khi cắt, ghi log WARN kèm `post_id` + tổng số người đúng-ra-phải-nhận + trần, **VÀ** ghi `recipientsTruncated: true` + `totalRecipients: <N>` vào payload outbox (để hàng dữ liệu tự mang bằng chứng, không chỉ log dễ trôi).
3. **Đo được:** ca `N-C8-trần` ở §5.1 — hạ trần qua hằng/config trong test rồi assert ĐÚNG `<trần>` hàng `notifications` + cờ truncation + log.

### 7.2 D12 — Migration `0585`, sửa template `SOCIAL_NEWS_PUBLISHED`

Seed hiện tại (`0581:236-241`, đã đo): `title_template:'Tin tức mới: {post_title}'`, `variables_schema:{"actor_name":"string","post_title":"string","post_id":"uuid"}`. `post_title` = trích nội dung bài, đẩy body vào `notifications.payload` — vi phạm ranh giới (A4). `SOCIAL_POST_REPORTED` (`0581:268-273`) GIỮ NGUYÊN (`{target_type_label}`+`{reason_label}` — không chở nội dung bài, chỉ nhãn phân loại đóng).

```sql
-- 0585_s16socialbe1b_noti_news_template_fix.sql
-- A4 (owner 22/09) — bỏ {post_title} khỏi template SOCIAL_NEWS_PUBLISHED (0581): không đẩy trích
-- đoạn nội dung bài vào notifications.payload. UPDATE, KHÔNG INSERT — 3 literal ratchet canonical-seed
-- (noti-seed-catalog-permissions, s5-noti-fix1-deeplink) PHẢI ĐO LẠI sau khi chạy, KHÔNG giả định
-- không đổi chỉ vì đây là UPDATE thay vì thêm hàng — số HÀNG catalog không đổi nhưng nội dung template
-- có thể là thứ một trong ba ratchet đó đối chiếu.

UPDATE notification_templates
   SET title_template    = 'Có tin tức công ty mới',
       body_template     = '{actor_name} đã đăng một tin tức công ty mới. Mở để đọc.',
       variables_schema  = '{"actor_name":"string","post_id":"uuid"}'::jsonb,
       updated_at        = now()
 WHERE template_code = 'SOCIAL_NEWS_PUBLISHED__IN_APP__vi-VN'
   AND company_id IS NULL AND deleted_at IS NULL;

DO $$
DECLARE v_cnt int;
BEGIN
  -- Vi tu PHAI SOI GUONG vi tu cua UPDATE (company_id IS NULL AND deleted_at IS NULL):
  -- thieu chung, mot ban sao company-scope / da soft-delete khong chua post_title se duoc dem
  -- va verify PASS trong khi hang LIVE VAN con {post_title} => fail-OPEN.
  -- Va phai kiem CA title_template/body_template: thu render ra tieu de la template, khong phai schema.
  SELECT count(*) INTO v_cnt FROM notification_templates
   WHERE template_code = 'SOCIAL_NEWS_PUBLISHED__IN_APP__vi-VN'
     AND company_id IS NULL AND deleted_at IS NULL
     AND variables_schema::text NOT LIKE '%post_title%'
     AND title_template NOT LIKE '%{post_title}%'
     AND body_template  NOT LIKE '%{post_title}%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '[0585] UPDATE template SOCIAL_NEWS_PUBLISHED khong nhu ky vong (matched=%) — fail-closed', v_cnt;
  END IF;
END $$;
```

**Việc PHẢI làm ở Bước 8 của §8:** chạy `noti-seed-catalog-permissions` + `s5-noti-fix1-deeplink` SAU migration `0585` và ĐO xem 3 literal có đỏ không — nếu đỏ, đó là tín hiệu ratchet đối chiếu NỘI DUNG template (không chỉ đếm hàng) và literal phải cập nhật CÓ CHỦ Ý, không phải bị nới ẩu.

**`SOCIAL_POST_REPORTED` — bảng nhãn ĐÓNG (không migration, code thuần):**

```ts
const TARGET_TYPE_LABEL: Record<"post" | "comment", string> = { post: "bài viết", comment: "bình luận" };
const REPORT_REASON_LABEL: Record<FeedReportReasonDto, string> = {
  spam: "Spam", harassment: "Quấy rối", inappropriate: "Nội dung không phù hợp",
  misinformation: "Thông tin sai lệch", other: "Khác",
};
```

---

## §8. Thứ tự thi công theo bước

> `bash scripts/lane-db-setup.sh <lane> --reset` trước lượt int-spec đầu tiên. `bash harness/check.sh --lane-db` trước mỗi checkpoint.

### Bước 0 — Gỡ gap hợp đồng + hạ tầng showBirthday

1. Vá `harness/backlog.mjs` — 4 `paths` (D1, §0.0).
2. Migration `0584` (NULLABLE) + `schema/user-preferences.ts` (§6).
3. `social-preferences.ts` — `showBirthday: boolean | null` (§6.3).
4. **A2 — sửa SPEC-16 dòng 254/502/548** (§0.2/D10) — cùng commit với bước 2/3, KHÔNG tách PR riêng.
5. **A3 — mở đường ghi ME** (D11, §6.3) — `packages/contracts/src/me.ts` + handler `apps/api/src/me/**`. RED trước: ca `PATCH /me/preferences {showBirthday:false}` rồi `GET /social/birthdays` xác nhận ẩn.

### Bước 1 — Báo cáo (rủi ro cao nhất)

6. `social-route-pairs.const.ts` — +10 khoá, field `dataScope` mới (M3), route `028` = `dataScope:"Department"`.
7. `social-reports.repository.ts` — `listReports` dùng `switch` VÉT CẠN 5 scope (M9/H3). RED trước: N-H3 (scope lạ → 0 hàng, KHÔNG throw).
8. `createReport` — bắt `23505` theo TÊN constraint `feed_reports_open_uq` (D5). RED trước: N-D5.
9. `targetSnapshotFor` — đọc XUYÊN gate (D13/H4-ii). RED trước: N-D13-a, N-D13-b.
10. `social-reports.service.ts` + `.controller.ts`. RED trước: R27', R28', N10(cũ)→N-D5, N-D6-a, N-D6-b(=N12 cũ), N13, W1'.
11. `@Idempotent()` trên `027`. RED trước: R30'.
12. Registrar +`036`, người nhận TRONG tx theo D6 (H4-iii). RED trước: N-H4-iii.
13. Audit `feed_report` cho `029`. RED trước: ca kiểm `audit_logs` có hàng sau resolve/dismiss.
14. **Census 2 tầng** — thêm `reportCreate`/`reportsList`/`reportResolve` vào `ROUTE_TO_KEY`+`SERVICE_SITES`. Chạy `social-two-layer-guard-census.unit-spec.ts` NGAY (không đợi hết 10 route) — RED trước: C2-a/b/c cho 3 route này.

### Bước 2 — Tin tức + ack

15. `social-news.repository.ts` (bao gồm `unackedEmployeesFor`, offset pagination — M-e) + `.service.ts` + `.controller.ts`. RED trước: N1-N5, C3-a/b/c, C6.
16. `social-posts.service.ts#create()` (BE-1, điểm chạm chéo) — emit `031`, tính người nhận TRONG tx. RED trước: N-C8.
17. Migration `0585` (D12). RED trước: N-A4-a. `036` template render — RED trước: N-A4-b.
18. Census 2 tầng — thêm `newsList`/`postAck`/`postAcksList`.

### Bước 3 — Tìm kiếm/thẻ/profile/sinh nhật

19. `social-discovery.repository.ts` — `listTags` trước (dễ nhất), rồi `search` (điểm chiếu identity mới #1), rồi `birthdays` (điểm chiếu identity mới #2, vị từ `company_id`+`show_birthday`, KHÔNG `visiblePostCondition` — M15/§9).
20. `social-discovery.service.ts` + `.controller.ts`. RED trước: N6-N9 (giữ từ bản trước), C4.
21. Route `025` — tái dùng `listFeed`, resolve `employee_id→userId` (C5). RED trước: C5, cùng 1 ca `hidden`-của-người-khác-trong-profile (giữ ý §8 Bước 3 mục 13 cũ, nay đánh số ở §5.1 thay vì để cuối).
22. Census 2 tầng — thêm `search`/`tagsList`/`profilePosts`/`birthdays`.

### Bước 4 — Ratchet toàn cục còn lại

23. `param-uuid-ratchet.unit-spec.ts` — chạy lại (đẳng thức tự-đo, không sửa nội dung ratchet) sau MỖI controller — đã lồng vào bước 15/20 nhưng chạy TỔNG lại ở đây để chắc chắn không route nào thiếu `ParseUUIDPipe`.
24. `identity-projection-verdicts.ts` — **4 điểm chiếu mới**: `search` · `birthdays` · `unackedEmployeesFor` dán `scoped-predicate` (`BASIS_CEILINGS["scoped-predicate"] 24→27`) và **snapshot đích của `028`/`029`** dán `second-assert` (`5→6`) — KHÔNG được dán `scoped-predicate` cho điểm thứ 4 vì đường đó CỐ Ý không mang vị từ visibility (C6/D13-R). `reason` của `birthdays` viết ĐÚNG (company_id + show_birthday + sàn view:feed, KHÔNG nhắc `visiblePostCondition` — C6). Chạy `identity-projection-ratchet.unit-spec.ts` chiều 7 (`ROW_SCOPE_MINT_PINS`, dòng 175-186) — nếu code mới gọi `fromScope(...,"scoped-predicate",...)`, pin dạng DANH SÁCH cũng phải cập nhật.
25. `route-http-coverage.e2e-spec.ts` — `MIN_COVERED_COUNT 651→661` + đảm bảo route `020` có ≥3 ca HTTP thật khớp verb/path (C3).
26. `test:cov:social` (`package.json:16`) — thêm tên file int-spec MỚI **CÙNG COMMIT với chính int-spec đó** (M-d, không dồn về cuối).

### Bước 5 — Đóng WO

27. `pnpm --filter @mediaos/contracts build && pnpm typecheck` xanh.
28. `bash harness/check.sh --all` xanh, KHÔNG banner "XANH KHÔNG ĐỦ BẰNG CHỨNG".
29. Regen `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` — kỳ vọng **661**.
30. FULL gate: `security-reviewer`+`database-reviewer`+`silent-failure-hunter` — hỏi xác nhận TƯỜNG MINH cho D5 (mã lỗi không số hoá), D13/H4-ii (bypass `visiblePostCondition` cho `targetSnapshot`), H4-iii (NOTI-036 lọc theo Department), W1' (pin `*:*`) → PR. **PR mô tả PHẢI mở đầu bằng diff `docs/SPEC/SPEC-16 SOCIAL.md`** (M-c) rồi mới tới diff code.

---

## §9. Rủi ro → cách chặn (bổ sung mục C2/C3/C4/C6/C8/H3/H4/H5 lên đầu, giữ các mục cũ)

| Rủi ro | Cách chặn |
| --- | --- |
| Census 2 tầng đỏ vì quên gọi `resolveActor` đúng key ở 1/10 route (C2) | Chạy census SAU MỖI cụm route (Bước 1/2/3 đều có bước "Census 2 tầng" riêng), không đợi cuối |
| `route-http-coverage`/route census tưởng nhầm là CÙNG MỘT cơ chế (C3) | §1 M13 cũ đã lẫn — bản này tách RÕ: JSON census (`docs/_review/...json`, quy mô "có route hay không") vs `route-http-coverage.e2e-spec.ts` (`MIN_COVERED_COUNT`, quy mô "có ca HTTP thật gọi verb+path hay không") — 2 số, 2 file, bump CẢ HAI |
| `023` trả 0 kết quả im lặng vì lệch cấu hình `'simple'`/`unaccent` | C4 neo dương `length===1`, không chỉ kiểm KHÔNG có id sai |
| `022` bị bỏ sót khỏi kiểm PII (M15 cũ thiếu nó) | M15 đã sửa; C6 test riêng |
| Scope `Own`/`Team` lọt qua route `028` vì chỉ if/else Department (H3) | `switch` vét cạn + N-H3 RED trước |
| `targetSnapshot` (D13) bị hiểu nhầm là lỗ IDOR khi review (đọc xuyên `assertPostVisible`) | Ghi tường minh trong code + PR (§8 Bước 5 mục 30) — đây là bypass CÓ CHỦ Ý, không phải quên gọi assert |
| NOTI-031 gửi quá nhiều người (công ty lớn) làm outbox nghẽn | Trần 500 cứng (§7.1), ghi nợ nâng cấp ở §10 nếu cần |
| NOTI-036 gửi nhầm cho manager ngoài phạm vi Department (H4-iii) | Producer dùng CÙNG vị từ D6, N-H4-iii RED trước |
| Migration `0585` (UPDATE template) làm ratchet catalog NOTI đỏ mà không ai để ý vì tưởng "chỉ UPDATE không đổi số hàng" | §7.2 ghi rõ PHẢI đo lại 3 literal, không giả định |
| `param-uuid-ratchet` đỏ vì `UNPIPED_CEILING=1` là ĐẲNG THỨC trên census sống (không phải trần lỏng) | §8 Bước 4 mục 23 — chạy SAU MỖI controller, rebase+chạy lại ngay trước commit cuối nếu PR khác chạm cùng ratchet |
| (giữ từ bản trước) Gap `paths` D1, D5 mã lỗi, D2 nullable, D9 idempotent, fixture riêng describe | Không đổi |

---

## §10. Nợ chuyển WO sau

- **BE-2:** không đổi diện (poll/idea/kudos, `audience='group'`, 4 NOTI còn lại, floor 002/006 khi mở role tuỳ biến). **MỚI:** nếu công ty >500 người cần NOTI-031 phát hết (không cắt ở trần 500, §7.1) — nâng cấp thành gửi theo lô. **Hệ quả NGHIỆP VỤ phải ghi vào WO đó, không chỉ "hiệu năng":** với tin `requiresAck`, tập ĐƯỢC-BÁO ≠ tập PHẢI-ACK — người bị cắt vẫn nằm trong danh sách "chưa đọc" của route `022` mà chưa từng nhận thông báo nào.
- **FE-1:** cần census 661 + `test:cov:social` mới. Cần biết diễn giải D10 (cờ chỉ chặn day/month) để KHÔNG tự ý ẩn nhân viên khỏi search/profiles ở FE.
- **QA-1:** không đổi so với BE-1 §9.4.
- **Doc follow-up:** nếu D5 owner sau này muốn số hoá mã lỗi, thêm dòng SPEC-16 §12 + đổi `REPORT_DUPLICATE_OPEN` từ hằng-không-số thành `SOCIAL-ERR-0XX`.

---

## §11. Tự kiểm đối chiếu `done_when`

| Gạch đầu dòng backlog | Cách chứng minh |
| --- | --- |
| Route sinh nhật (026): `Object.keys` đúng 5 khoá + regex năm + neo dương + showBirthday đóng | §5.1 N6-N9 (giữ) + D10 (diễn giải phạm vi cờ, SPEC đã sửa khớp — §0.2) |
| Ack tin tức (021) | §5.1 N2, N3 (giữ) |
| Báo cáo: IDOR + scope Department + 409 resolved + pin `*:*` | §5.1 R27'/R28', N-D6-a/b, N13, W1' — **D6 nay đã chốt (A5/A6), không còn "cần owner ký" cho PHẦN ĐỊNH NGHĨA scope**; D13/H4-ii/H4-iii vẫn cần chữ ký PR (đánh đổi DTO/bypass gate/lọc NOTI) |
| `@Idempotent` 027; NOTI 031/036; route census 29 nội bộ (≠ 661 tổng, M13 cũ) + coverage ≥85% lần 2 | §5.1 R30', §7, §8 Bước 5 |
| **MỚI:** gỡ 4-mục gap `paths` | §0.0/D1/§8 Bước 0 mục 1 |
| **MỚI:** sửa SPEC-16 + mở đường ghi ME cùng WO | §0.2/D10/D11/§8 Bước 0 mục 4-5 |
| **MỚI:** census 2 tầng phủ đủ 29 route nội bộ, `dataScope` máy-kiểm-được cho `028` | §3/§4/§8 (mục "Census 2 tầng" ở mỗi bước) |
| **MỚI:** 3 điểm chiếu identity (không phải 2), trần `scoped-predicate` 24→27 | §8 Bước 4 mục 24 |

---

**Tổng kết cho plan-reviewer:** 7/7 quyết định owner (A1-A7) đã nạp — A1/A5/A6 nay là quyết định CHỐT không cần chữ ký thêm (D3/D6); A2/A3/A4 là NGHĨA VỤ THI CÔNG cụ thể (sửa SPEC + mở API ME + migration `0585`), không còn là lựa chọn; A7/D5 và D13 (DTO report + bypass gate) VẪN cần chữ ký ở PR vì SPEC thật sự im lặng. 6/6 CRITICAL (C2-C8, trừ C1 đã là quyết định A) đã vá bằng census/ratchet cụ thể theo bước. 3/3 HIGH (H3/H5/H4-ii-iii) đã có switch vét cạn + DTO tường minh + lọc NOTI theo Department. 6/6 MEDIUM (M-b..M-f + ratchet UNPIPED) đã nạp vào §6/§8.

**Còn cần chữ ký ở PR (không tự chốt được):** D5 (mã lỗi báo cáo trùng, không số hoá) · D13 (DTO report lộ danh tính reporter + bypass `visiblePostCondition` cho `targetSnapshot`) · diễn giải NOTI-036 theo Department (H4-iii, suy luận từ D6 chứ SPEC viết câu ngắn hơn).

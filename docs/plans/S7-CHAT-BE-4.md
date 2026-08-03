# Micro-plan — `S7-CHAT-BE-4` (🔴 red · crown · FULL gate)

> **WO:** Tìm kiếm toàn văn tiếng Việt (có dấu/không dấu) — CHAT-API-015 `GET /chat/search`.
> **Nguồn sự thật:** [SPEC-15 §13.7 · §12 (CHAT-ERR-017) · §19 · §20 ca 11 · §21](<../SPEC/SPEC-15 CHAT.md>) ·
> [API-13 §5 dòng CHAT-API-015 · §5.3 ràng buộc 5](<../API Design/API-13_CHAT_API_Design.md>) ·
> [DB-12 §6](<../DB/DB-12 CHAT Database Design.md>) · [WAVE §3.1 dòng "KHÔNG mở tìm kiếm"](S7-CHAT-WAVE.md)
> **Nền:** `BE-1` (`c77f48e0`) · `BE-2` (`54b4d8cd`) · vá gate `631d683e` · GATE-2 `5365e0d0` · `BE-3` (sha điền khi land).
> **Nhánh:** `wave/s7-chat`. **KHÔNG migration ở WO này** — hạ tầng search đã có từ mig `0538`.

> ⚠️ **Đây là đường đọc RỘNG NHẤT của module.** Mọi đường đọc khác bó theo **một** `roomId` đã đi qua
> `assertMember`. Đường này quét **toàn bộ `chat_messages` của tenant** rồi mới lọc. Sai một vế = rò
> nguyên nội dung công ty, và rò **im lặng** (HTTP 200, kết quả trông hợp lý). Vì vậy §1.1 là mục quan
> trọng nhất của plan, và test deny-path viết TRƯỚC là bắt buộc, không phải khuyến nghị.

---

## 0. Đo thật trước khi thiết kế (03/08/2026)

| Thứ | Đo được | Nguồn |
| --- | --- | --- |
| **KHÔNG cần migration** | `search_vector` là cột **GENERATED STORED** + GIN index đã tồn tại | `0538:376-380` |
| `f_unaccent` **IMMUTABLE** wrapper đã có | `SELECT public.unaccent('public.unaccent'::regdictionary, $1)` | `0538:366-372` |
| Cột generated dùng `coalesce(body,'')` | tin `body=''` (chỉ-có-ảnh của BE-3) vẫn có vector hợp lệ, rỗng | `0538:377` |
| **KHÔNG có index `(company_id, created_at)`** trên `chat_messages` | index hiện có: `idx_chat_messages_room_seq (company_id,room_id,room_seq DESC)` · `idx_chat_messages_search` GIN · `chat_messages_pinned_idx` · `idx_chat_messages_reply` · `uq_chat_messages_client_id` · `uq_chat_messages_room_seq` | `\d chat_messages` trên `mediaos_s7chatbe3` |
| `room_seq` là **PER-ROOM** | ⇒ **không dùng được** làm con trỏ cho tìm kiếm ĐA PHÒNG (hai phòng có cùng `room_seq=5`) | `0539` |
| `chat_messages.seq` là identity **CẤP BẢNG** | tăng xuyên mọi phòng **và mọi tenant** ⇒ phơi ra là **rò lưu lượng** — chính lỗ mà `S7-CHAT-DB-2` vừa bịt | `chat-visibility.ts:21-25` |
| `ChatAccessService.activeMembershipJoin` + `visibleRoom` là **private** | hai vị từ này đúng là thứ đường tìm kiếm đa phòng cần | `chat-access.service.ts:305,315` |
| `assertMember` trả `membership.visibleFromSeq` | dùng cho nhánh có `roomId` chỉ định | `chat-access.service.ts:95` |
| **Greenfield** — 0 stub search | `grep -n "search" chat.errors.ts packages/contracts/src/chat.ts` = **0 hit** | đo 03/08 |
| Cặp quyền | `('view','chat-room')` — **không** đẻ cặp mới, **không** cặp `('search','chat-message')` | API-13 §5 · SPEC-15 §11 dòng 311 |
| Thu hồi **KHÔNG** xoá `body` | append-only ⇒ `search_vector` của tin đã thu hồi **vẫn còn nguyên** | SPEC-15 §13.6 |
| `ZodValidationPipe` khai ở controller ⇒ lỗi schema là **400** | BE-3 §6.1 mục 3 đã đóng đinh tầng ném lỗi này | `chat-messages.controller.ts:49` |

---

## 1. Lựa chọn thiết kế — chốt ở đây

### 1.1 Ranh giới bảo mật — HAI chế độ, KHÔNG chế độ nào bỏ qua membership

| Chế độ | Đường khẳng định | Vị từ §13.4 |
| --- | --- | --- |
| **có `roomId`** | `ChatAccessService.assertMember(companyId, roomId, actorId)` — 404 fail-closed, y hệt mọi route khác | `visibleFromSeqScalar(membership.visibleFromSeq)` |
| **không `roomId`** (đa phòng) | **JOIN `chat_room_members` ngay trong truy vấn** theo `actorUserId` | `visibleFromSeqColumn()` (dạng CỘT) |

⚠️ **Chế độ đa phòng KHÔNG đi qua `assertMember`** — không thể, vì nó không biết trước tập phòng. Đây là
**ngoại lệ duy nhất** của "điểm khẳng định membership duy nhất" (SPEC-15 §3.2), và nó phải được đóng khung
chứ không được để trôi:

1. **Tái dùng ĐÚNG hai vị từ của `ChatAccessService`**, không viết bản sao thứ ba. Chốt: đổi
   `activeMembershipJoin` và `visibleRoom` từ `private` → **`public`** (chỉ đổi khả kiến, **không** đổi
   thân hàm, **không** đổi caller cũ). Bản sao của luật quyền là bản sao sẽ trôi
   (`module-closed-by-second-assert-not-scope`) — và ở đây bản sao sẽ trôi trên đường đọc rộng nhất.
2. **Kiểm bằng SQL đã render**, không bằng "gọi API rồi nhìn kết quả" — cùng cách `chat-visibility.spec.ts`
   kiểm vị từ §13.4. Một truy vấn thiếu vế membership vẫn trả kết quả **trông đúng** trên dữ liệu test nhỏ
   (người test thường là thành viên của mọi phòng trong fixture).
3. Vế `deleted_at IS NULL` của phòng (`visibleRoom`) là **bắt buộc** — thiếu nó thì phòng đã xoá mềm vẫn
   tìm ra được, mà `/rooms` và `/messages` đều đã chặn.

`company_id` viết **tường minh** trên cả ba bảng (`chat_messages`, `chat_room_members`, `chat_rooms`) chứ
không chỉ dựa RLS (CLAUDE.md §2 mục 1) — đây là vế duy nhất chặn một hàng membership tenant khác ghép vào
nếu GUC bị đặt sai.

> **KHÔNG có nhánh đọc-vượt ở WO này.** SPEC-15 §3.3 và API-13 §5.3 ràng buộc 5 chốt: `/chat/search` giữ
> nguyên vị từ membership cho **mọi** role, kể cả Super Admin; **không** có `/chat/oversight/search`. Cặp
> `('view','chat-oversight')` **không được** xuất hiện ở bất kỳ file nào của WO này. Nếu lúc thi công thấy
> "tiện thì thêm" ⇒ **DỪNG**, đó là mở lại CHAT-DEC-004 với owner.

### 1.2 Con trỏ — vì sao KHÔNG dùng `seq`, KHÔNG dùng `room_seq`, KHÔNG dùng offset

| Ứng viên | Vì sao loại |
| --- | --- |
| `offset` | trôi khi có tin mới chèn vào giữa lúc cuộn (API-13 §6.4) — cấm toàn module |
| `room_seq` | **per-room** (`0539`) ⇒ trộn nhiều phòng thì hai tin khác phòng có cùng số, con trỏ cắt nhầm |
| `seq` (identity cấp bảng) | phơi ra là **rò lưu lượng toàn công ty** — hai lần tìm cách nhau 1 giờ, hiệu số `seq` cho biết công ty gửi bao nhiêu tin. Đây đúng là lỗ `S7-CHAT-DB-2` vừa bịt; mở lại nó qua ô search là đi lùi |

**Chốt:** con trỏ **keyset** trên `(created_at DESC, id DESC)`, mã hoá **opaque base64url** của
`"<epochMillis>.<uuid>"`.

- `createdAt` và `id` **đã nằm sẵn trong DTO tin nhắn** ⇒ con trỏ **không phơi thông tin mới**. Đây là lý do
  chọn cặp này chứ không phải một số thứ tự nào khác.
- Cặp `(created_at, id)` là **toàn phần** (`id` là UUID PK) ⇒ không sót/không trùng khi hai tin cùng
  mốc thời gian.
- Opaque (base64url) không phải để bảo mật — nó để **client không parse rồi tự chế con trỏ**. Server vẫn
  validate: giải mã hỏng / không đúng hình dạng ⇒ **400**, không im lặng rơi về trang đầu (rơi về trang đầu
  là vòng lặp vô hạn ở FE).

**Xếp hạng theo thời gian giảm dần (mới nhất trước), KHÔNG theo `ts_rank`.** `ts_rank` phụ thuộc tần suất từ
trong toàn bảng, nên điểm của cùng một hàng **đổi giữa hai lần gọi** khi có tin mới ⇒ keyset trên rank không
ổn định (trang 2 sót/lặp hàng). Tìm tin nhắn theo thời gian cũng đúng thói quen người dùng hơn. Ghi vào §6
nợ: muốn xếp theo liên quan thì phải đổi con trỏ sang `(rank, created_at, id)` và chấp nhận rank trôi.

### 1.3 Truy vấn toàn văn — hai vế phải cùng `f_unaccent`

```sql
search_vector @@ websearch_to_tsquery('simple', public.f_unaccent($q))
```

- **`websearch_to_tsquery`, KHÔNG `to_tsquery`.** `to_tsquery` **ném lỗi cú pháp** trên input người dùng
  (`&`, `|`, `!`, ngoặc lệch) ⇒ 500 từ một ô tìm kiếm. `websearch_to_tsquery` nuốt mọi thứ.
- **`f_unaccent` phải áp cho CẢ vế truy vấn.** Cột generated đã unaccent lúc INSERT; quên unaccent vế query
  thì gõ **có dấu** ra **0 kết quả** — hỏng lặng lẽ theo chiều khó phát hiện nhất (người test gõ không dấu
  thấy chạy, tưởng xong).
- **`'simple'`, không `'english'`** — tiếng Việt không có bộ stemming trong Postgres (SPEC-15 §13.7).
- ⚠️ **`websearch_to_tsquery` có thể trả tsquery RỖNG** (q toàn dấu câu, ví dụ `q = "..."`). tsquery rỗng
  `@@` bất kỳ vector = **false** ⇒ **0 kết quả**, đúng chiều fail-closed — nhưng phải có ca test đóng đinh
  là **200 + rỗng**, không phải 500 và cũng không phải "trả tất".

### 1.4 Vế loại trừ — tin đã thu hồi

`recalled_at IS NULL` là **vế bắt buộc trong truy vấn**, không phải việc của mapper.

Thu hồi **không xoá `body`** (append-only, SPEC-15 §13.6) ⇒ `search_vector` của tin đã thu hồi **vẫn khớp**.
Mapper che `body` nên nội dung không rò, **nhưng số lượng kết quả thì rò**: gõ một từ khoá và đếm số hit là
đọc được nội dung tin đã thu hồi từng chữ một. Đây là oracle, cùng lớp với CHAT-ERR-001.

### 1.5 DTO kết quả — schema RIÊNG, KHÔNG tái dùng `chatMessageSchema`

`chatSearchResultSchema` **không** extend `chatMessageSchema`. Lý do là bảo mật, không phải gọn code:

- `chatMessageSchema` (sau BE-3) mang `attachments: ChatAttachmentDto[]` **kèm URL ký**. Tái dùng nó ở đây
  biến một ô tìm kiếm thành máy phát URL ký hàng loạt trên toàn bộ kho tệp mà người dùng có quyền —
  50 URL ký/trang, mỗi lần gõ phím. **Chốt: đường tìm kiếm KHÔNG ký URL nào**, chỉ trả `attachmentCount`.
  Muốn tệp thì mở phòng (`/rooms/:id/files`, có access-log).
- Trường phục vụ CHAT-SCREEN-005 "nhảy tới tin trong ngữ cảnh": `roomId` · `roomName` · `roomType` ·
  **`roomSeq`**. `roomSeq` phơi ở đây **an toàn** — nó per-room và người tìm đã là thành viên đúng phòng đó.

```text
chatSearchResultSchema  { id, roomId, roomName|null, roomType, roomSeq, senderId, senderName|null,
                          body, createdAt, attachmentCount }
chatSearchResponseSchema{ data: chatSearchResultSchema[], nextCursor: string|null }
```

`nextCursor: null` ở trang cuối. `roomName`/`senderName` `.nullable()` — DM không có tên phòng, và
`leftJoin(users)` có thể trả null (`server-masking-needs-optional-fe-schema`).

### 1.6 Validate đầu vào — trần ở Zod

```text
chatSearchQuerySchema  q: trim → min(2) max(200)          → 400 (CHAT-ERR-017)
                       roomId?: uuid
                       cursor?: string max(200)
                       limit: coerce.number int 1..50 default 20     (z.coerce ⇒ idempotent 2 lần)
```

- `min(2)` **sau `.trim()`** — `q = "  a  "` phải trượt, không được lọt vì đếm khoảng trắng.
- `max(200)`: không có trần thì một câu 10KB đi thẳng vào `websearch_to_tsquery`.
- `limit` max 50, mặc định 20 — thấp hơn `/messages` vì mỗi hàng search kéo thêm join `chat_rooms` + `users`.
- `z.coerce` bắt buộc: pipe Zod chạy **2 lần** trên query-param, phải idempotent
  (`zod-query-param-double-pipe-idempotent`).

### 1.7 CHAT-ERR-017 — `roomId` không thuộc phải GIỐNG HỆT `roomId` không tồn tại

Cả hai → **404 `ROOM_NOT_FOUND`** (hằng đã có từ BE-1). Trả mã khác nhau biến ô tìm kiếm thành oracle dò sự
tồn tại của phòng — đúng thứ 404-thay-403 của BE-1 dựng ra để chặn. Đường này **tự do** vì nó gọi thẳng
`assertMember`, vốn đã ném đúng `NotFoundException`; việc của WO này là **không** bọc lại nó thành gì khác.

### 1.8 Tách file riêng — `chat-search.*`

Tách `chat-search.controller.ts` / `.service.ts` / `.repository.ts` thay vì nhét vào
`ChatMessagesController` (đang 166 dòng, còn chỗ). Lý do là **review được**, không phải kích thước:

đường tìm kiếm là ngoại lệ membership duy nhất của module (§1.1). Để nó nằm lẫn giữa 8 route đều gọi
`assertMember` là làm mất tín hiệu: người đọc `chat-messages.controller.ts` sẽ mặc định "route nào ở đây
cũng qua điểm khẳng định". File riêng làm ngoại lệ **grep được** — cùng lý do `S7-CHAT-BE-7` tách riêng.

Route `GET /chat/search` khai trong controller riêng, cùng prefix `/chat`; không đụng `chat-messages.controller.ts`.

### 1.9 Hiệu năng — mục tiêu, và cái KHÔNG được assert

SPEC-15 §19: `<800ms` ở quy mô ~1 triệu tin. Kế hoạch: GIN lọc trước theo `search_vector`, join membership
thu hẹp, `LIMIT` sớm.

⚠️ **CẤM assert trong test rằng planner chọn đích danh `idx_chat_messages_search`**
(`pg-planner-index-assert-trap`): trên bảng test vài trăm hàng, planner chọn seq-scan là **đúng**, và test
sẽ đỏ oan trên chính hành vi tối ưu. Đo hiệu năng là việc của `S7-CHAT-QA-1` với dữ liệu quy mô thật.

Nếu lúc thi công phát hiện cần index mới (ví dụ `(company_id, created_at DESC)`) ⇒ **DỪNG**: `paths` của WO
này **không có** `migrations/**`, thiếu nó thì gate rơi xuống LIGHT + trùng số migration
(`wo-paths-drive-gate-and-scheduler`).

---

## 2. Phạm vi — file chạm

| File | Loại | Việc |
| --- | --- | --- |
| `packages/contracts/src/chat.ts` | sửa (additive) | `chatSearchQuerySchema` · `chatSearchResultSchema` · `chatSearchResponseSchema` |
| `apps/api/src/chat/chat-search-cursor.ts` | **mới** | encode/decode con trỏ opaque (§1.2) — hàm thuần, không phụ thuộc Nest |
| `apps/api/src/chat/chat-search.repository.ts` | **mới** | truy vấn tsquery + join membership (§1.1, §1.3) |
| `apps/api/src/chat/chat-search.service.ts` | **mới** | hai chế độ (§1.1) · dựng `nextCursor` |
| `apps/api/src/chat/chat-search.controller.ts` | **mới** | `GET /chat/search`, cặp `view:chat-room` |
| `apps/api/src/chat/chat-access.service.ts` | sửa (khả kiến) | `activeMembershipJoin` · `visibleRoom`: `private` → `public`. **Không** đổi thân hàm |
| `apps/api/src/chat/chat.dto.ts` | sửa (additive) | `ChatSearchQueryDto` |
| `apps/api/src/chat/chat.module.ts` | sửa (additive) | controller + 2 provider mới |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | regen | route mới ⇒ census ĐỎ nếu không regen (`ROUTE_CENSUS_WRITE=1`) |

**KHÔNG migration. KHÔNG đụng `app.module.ts`. KHÔNG đụng `chat-messages.*`** (tránh xung đột merge với
BE-6, vốn cũng sửa `chat-messages.service.ts`).

---

## 3. Test RED-trước (viết TRƯỚC khi có code)

`apps/api/test/integration/chat-be4-search.int-spec.ts` — gate cứng `hasDb && LANE_DB`, chủ thể
**không phải Super Admin** (SA có `*:*` ⇒ mọi ca deny đều lọt, tautology).

Fixture: 2 tenant · tenant A có 3 phòng — `P1` (actor là thành viên) · `P2` (actor **không** thuộc) ·
`P3` (actor **đã `left_at`**). Mỗi phòng có tin chứa cùng từ khoá "báo cáo tài chính".

| # | Ca | Kỳ vọng | Bắt được gì |
| --- | --- | --- | --- |
| 1 | Tìm "bao cao" (không dấu) | thấy tin của **P1**, **KHÔNG** thấy P2/P3 | Ranh giới membership — ca quan trọng nhất WO |
| 2 | Tìm "báo cáo" (có dấu) | cùng kết quả ca 1 | `f_unaccent` áp cả vế query (§1.3) |
| 3 | `roomId = P2` (không thuộc) | **404** | §1.7 |
| 4 | `roomId` = UUID ngẫu nhiên | **404 giống hệt** ca 3 (cùng mã, cùng body) | Không phải oracle |
| 5 | `roomId = P1` | chỉ tin P1 | Chế độ có roomId |
| 6 | Actor **đã rời** P3 | 0 kết quả từ P3 | `left_at IS NULL` |
| 7 | Cross-tenant: user tenant B tìm từ khoá khớp tin tenant A | **0 kết quả** | RLS + `company_id` tường minh |
| 8 | Tin **đã thu hồi** chứa từ khoá | **không** xuất hiện | §1.4 — `search_vector` vẫn còn sau thu hồi |
| 9 | Role có `('view','chat-oversight')` (**không phải SA**) tìm | **chỉ** phòng mình là thành viên | SPEC-15 §20 ca 11 — DEC-004 không mở tìm kiếm |
| 10 | `q = "a"` · `q = "  a  "` | **400** cả hai | `min(2)` sau `.trim()` |
| 11 | `q = "..."` (toàn dấu câu) | **200 + `data: []`** | tsquery rỗng, không 500, không trả tất |
| 12 | `q` chứa `& | ! ( )` | **200**, không 500 | `websearch_to_tsquery` nuốt cú pháp |
| 13 | Phân trang 2 trang (`limit=2`) | không sót, không lặp; trang cuối `nextCursor: null` | Keyset toàn phần |
| 14 | `cursor` rác / base64 hỏng | **400** | Không im lặng rơi về trang đầu |
| 15 | Con trỏ giải mã ra **không chứa** `seq` toàn cục | assert trên chuỗi đã giải mã | §1.2 — không mở lại lỗ DB-2 |
| 16 | `limit=51` | **400** | Trần |
| 17 | Kết quả **không chứa** khoá `url`/`thumbnailUrl` nào | assert vắng khoá | §1.5 — search không ký URL |
| 18 | Kết quả có `roomSeq` + `roomId` | | CHAT-SCREEN-005 nhảy tới ngữ cảnh |
| 19 | Phòng **xoá mềm** chứa tin khớp | 0 kết quả | `visibleRoom` |

Unit `apps/api/src/chat/chat-search-cursor.spec.ts`: round-trip encode/decode · chuỗi rác → ném ·
`epochMillis` không phải số → ném · uuid sai hình dạng → ném · cursor rỗng → ném.

Unit SQL-đã-render (mẫu `chat-visibility.spec.ts`): truy vấn đa phòng **có** đủ 4 vế membership
(`user_id`, `left_at IS NULL`, `company_id` hai vế, `deleted_at IS NULL` của phòng) + vị từ §13.4 + vế
`recalled_at IS NULL`. Kiểm trên SQL đã render, **không** qua gọi API.

Chạy: `bash harness/check.sh --lane-db=s7chatbe4`.

---

## 4. Definition of Done

- [ ] `GET /chat/search` cặp `('view','chat-room')` — **trùng nguyên văn** cặp đường đọc tin; **không** cặp mới
- [ ] Chế độ có `roomId` đi qua `ChatAccessService.assertMember` (404 fail-closed)
- [ ] Chế độ đa phòng JOIN membership bằng **đúng** `activeMembershipJoin` + `visibleRoom` của `ChatAccessService` — **0 bản sao** của luật membership
- [ ] Vị từ §13.4 có mặt trên đường tìm kiếm (dạng cột), lấy từ `chat-visibility.ts`
- [ ] `recalled_at IS NULL` trong truy vấn (không chỉ ở mapper)
- [ ] Con trỏ keyset `(created_at, id)` opaque — **không** phơi `seq` toàn cục, **không** offset
- [ ] `f_unaccent` áp **cả hai** vế; `websearch_to_tsquery`; `'simple'`
- [ ] DTO kết quả **không chứa URL ký nào**
- [ ] **Không** cặp `('view','chat-oversight')` ở bất kỳ file nào của WO
- [ ] 19 ca int-spec + unit cursor + unit SQL-đã-render XANH trên `LANE_DB` (`mediaos_s7chatbe4`)
- [ ] `pnpm typecheck` + `pnpm lint` 0 error + census regen
- [ ] FULL gate PASS (`security-reviewer` + tenant-isolation + silent-failure)

---

## 5. Ngoài phạm vi (nói thẳng, không để thành "coi như xong")

1. **Xếp theo độ liên quan (`ts_rank`)** — v1 xếp theo thời gian (§1.2). Đổi sau phải đổi cả con trỏ.
2. **Đoạn trích bôi đậm (`ts_headline`)** — v1 trả nguyên `body` (≤4000 ký tự), FE tự bôi. `ts_headline`
   re-parse `body` từng hàng, tốn CPU trên đường nóng, và SPEC không đòi.
3. **Tìm theo người gửi / theo khoảng thời gian / theo loại tệp** — SPEC-15 §13.7 không có; thêm là scope creep.
4. **Đo hiệu năng ở quy mô 1 triệu tin** — việc của `S7-CHAT-QA-1` (§1.9).
5. **Index mới** — nếu cần thì đó là lane migration nối tiếp, không phải WO này (§1.9).

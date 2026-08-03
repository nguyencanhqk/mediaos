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

1. **MỘT hàm public duy nhất** trên `ChatAccessService` trả **nguyên bộ** điều kiện đọc tin đa phòng —
   `messageReadConditions(companyId, actorUserId): SQL[]`. **KHÔNG** mở `private → public` hai núm rời
   (`activeMembershipJoin` + `visibleRoom`) như rev 1 chốt.

   > **Vì sao đổi (plan-reviewer, mục chặn 1):** hai helper đó **không chứa vế nối tin↔phòng**.
   > `activeMembershipJoin` chỉ nối `chat_room_members ↔ chat_rooms`; `assertMember` không cần vế đó (nó đi
   > từ `chat_rooms`), còn `assertMessageAccess` phải tự viết tay. Một hiện thực rất tự nhiên —
   > `.from(chatMessages).innerJoin(chatRooms, access.visibleRoom(companyId))` — là **SQL hợp lệ, chạy
   > được, và là TÍCH DESCARTES** giữa mọi tin của tenant với mọi phòng actor là thành viên ⇒ rò toàn bộ
   > nội dung công ty kèm `roomId`/`roomName` **sai**. Danh sách "4 vế" của rev 1 sẽ PASS trên chính truy
   > vấn hỏng đó. Trả cả bộ làm cho **không ai dùng được nửa luật**.

   Bộ điều kiện gồm **5 vế** (thiếu vế nào cũng là lỗ, không phải tối ưu):

   | # | Vế | Thiếu nó thì |
   | --- | --- | --- |
   | 1 | `chat_rooms.id = chat_messages.room_id` **AND** `chat_rooms.company_id = chat_messages.company_id` | tích Descartes — rò toàn bộ nội dung tenant |
   | 2 | `chat_room_members.room_id = chat_rooms.id` **AND** `.company_id = chat_rooms.company_id` | ghép membership của phòng khác |
   | 3 | `chat_room_members.user_id = <actor>` **AND** `left_at IS NULL` | đọc phòng mình không thuộc / đã rời |
   | 4 | `chat_rooms.deleted_at IS NULL` | phòng xoá mềm vẫn tìm ra được |
   | 5 | `visibleFromSeqColumn()` (§13.4) | lịch sử trước mốc vào phòng |

2. **Kiểm bằng SQL đã render**, không bằng "gọi API rồi nhìn kết quả" — cùng cách `chat-visibility.spec.ts`
   kiểm vị từ §13.4. Một truy vấn thiếu vế membership vẫn trả kết quả **trông đúng** trên dữ liệu test nhỏ
   (người test thường là thành viên của mọi phòng trong fixture). Test đếm **5 vế + 4 lần `company_id`**.

3. **Một hàm repo duy nhất cho CẢ HAI chế độ** (dạng CỘT). Nhánh có `roomId` chỉ **thêm**
   `assertMember` (để có 404 đúng hằng) và `eq(chatMessages.roomId, roomId)` vào **cùng** truy vấn. Hai bộ
   dựng truy vấn là hai thứ sẽ trôi, và làm ca census scalar/column nhập nhằng.

4. `leftJoin(users)` phải **bó tenant**: `and(eq(users.id, senderId), eq(users.companyId, companyId))` —
   sao đúng `chat-messages.repository.ts`.

5. **`q` là tham số BIND, cấm `sql.raw`.** Test SQL-đã-render assert chuỗi SQL **không chứa** giá trị `q`,
   `params` thì có. Đây là đường rộng nhất module; nối chuỗi ở đây là SQL injection trên chính nó.

6. **KHÔNG ghi audit cho `/chat/search`** — tường minh, không phải bỏ quên. SPEC-15 §3.3/§18 chốt audit
   theo *phòng*, không theo *câu truy vấn*; ghi ở đây là lưu lại **nội dung người dùng gõ** vào bảng
   append-only dùng chung. Reviewer FULL gate sẽ đòi thêm audit nếu không có dòng cấm này.

7. Service mở **đúng một** `withTenant` cho cả hai chế độ; repo nhận `tx` (bất biến #1, CLAUDE.md §2).

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

**Chốt:** con trỏ **keyset** trên **`(date_trunc('milliseconds', created_at) DESC, id DESC)`**, mã hoá
**opaque base64url** của `"<isoMillis>|<uuid>"`.

> ⚠️ **`date_trunc('milliseconds', …)` là BẮT BUỘC ở CẢ khoá sắp xếp lẫn con trỏ** (plan-reviewer, mục chặn
> 3). `chat_messages.created_at` là `timestamptz` — Postgres lưu **micro-giây**, còn JS `Date` (nguồn để
> dựng con trỏ) **cắt mất phần µs**. Nếu sắp xếp theo `created_at` thô mà con trỏ chỉ mang mili-giây: hai
> tin cách nhau 300µs trong cùng mili-giây làm vế `(created_at, id) < ($ms, $id)` **loại luôn những hàng cũ
> hơn nằm trong chính mili-giây đó** ⇒ trang sau **sót tin, HTTP 200, không lỗi**. Cắt về mili-giây làm
> khoá sắp xếp **bằng đúng** thứ con trỏ chứa, nên phép so sánh toàn phần trở lại.
>
> Fixture gieo trong một `tx` có `now()` bằng nhau **từng bit** nên ca phân trang thường **không tái hiện
> được** lỗi này — vì vậy §3 có ca gieo thẳng bằng `directPool` với `created_at` lệch nhau 1µs.

- `createdAt` và `id` **đã nằm sẵn trong DTO tin nhắn** ⇒ con trỏ **không phơi thông tin mới**. Đây là lý do
  chọn cặp này chứ không phải một số thứ tự nào khác.
- Cặp `(trunc(created_at), id)` là **toàn phần** (`id` là UUID PK) ⇒ không sót/không trùng khi hai tin cùng
  mốc thời gian.
- `nextCursor` lấy bằng cách fetch **`limit + 1`** rồi cắt: hàng thứ `limit+1` tồn tại ⇒ còn trang sau,
  `nextCursor` dựng từ hàng thứ `limit`; không tồn tại ⇒ **`null`**.
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

### 1.5b Ba quyết định nhỏ — ghi ra để chúng là QUYẾT ĐỊNH, không phải tai nạn

| Điểm | Chốt | Vì sao |
| --- | --- | --- |
| Phòng **đã lưu trữ** | **CÓ** trong kết quả | Vẫn là thành viên; FE-4 mở phòng ở chế độ chỉ-đọc. `unreadTotals` loại phòng archived vì đó là badge "việc cần làm" — câu hỏi khác |
| Tin `messageType='system'` | **CÓ** | `body` do server sinh, không nhạy cảm hơn phần còn lại; loại ra làm "tìm không thấy thứ mình đang nhìn thấy trong phòng" |
| Hình dạng phản hồi | `{ data, nextCursor }`, **không** qua `paginated()` | Khối `Pagination` của repo là page/offset, không dùng cho keyset. Sau `ResponseEnvelopeInterceptor` thành `data.data` + `data.nextCursor` — ghi ra để FE-4 không dính `apifetch-drops-pagination-bare-array` |

`roomName`/`senderName` **`.nullable()`**: phòng DM không có tên, `leftJoin(users)` có thể trả null
(`server-masking-needs-optional-fe-schema`). FE-4 lấy tên đối phương của phòng DM từ đâu là **câu hỏi mở**
— DTO này không mang thông tin peer; ghi vào §5 để FE-4 không phát hiện lúc dựng màn.

### 1.6 Validate đầu vào — trần ở Zod

```text
chatSearchQuerySchema  q: trim → NFC → min(2) max(200)    → 400 (CHAT-ERR-017)
                       roomId?: uuid
                       cursor?: string max(200)
                       limit: coerce.number int 1..50 default 20     (z.coerce ⇒ idempotent 2 lần)
```

- `min(2)` **sau `.trim()`** — `q = "  a  "` phải trượt, không được lọt vì đếm khoảng trắng.
- `max(200)`: không có trần thì một câu 10KB đi thẳng vào `websearch_to_tsquery`.
- `limit` max 50, mặc định 20 — thấp hơn `/messages` vì mỗi hàng search kéo thêm join `chat_rooms` + `users`.
- `z.coerce` bắt buộc: pipe Zod chạy **2 lần** trên query-param, phải idempotent
  (`zod-query-param-double-pipe-idempotent`). `.trim()` và `.normalize("NFC")` cũng idempotent nên an toàn
  với pipe chạy hai lần.
- **`.normalize("NFC")`**: macOS/iOS gửi tiếng Việt ở dạng **NFD** (ký tự cơ sở + dấu tổ hợp).
  `f_unaccent` không gỡ được dấu tổ hợp ⇒ người gõ có dấu từ máy Mac ra **0 kết quả** — đúng chiều
  hỏng-lặng-lẽ mà §1.3 đang lo. Nợ ghi ở §5: tin **đã lưu** ở dạng NFD thì `search_vector` cũng lệch, không
  sửa được ở WO này vì cột là GENERATED.
- **Controller mới PHẢI khai `@UsePipes(ZodValidationPipe)`** (mẫu `chat-messages.controller.ts`). Quên là
  `q`/`limit`/`cursor` **không được validate gì cả** — mọi trần ở trên thành trang trí.
- **CHAT-ERR-017 phải là literal trong message của Zod** (mẫu `CHAT-ERR-004` ở `sendMessageSchema`), không
  chỉ HTTP 400: SPEC-15 §21 nhóm Validate đòi mỗi mã ≥1 ca, và `S7-CHAT-QA-1` sẽ tìm chuỗi `CHAT-ERR-017`.
  Con trỏ rác dùng **mã riêng**, KHÔNG tái dùng `CHAT_ERR.CURSOR_EXCLUSIVE` (mã đó nói về
  `beforeSeq`/`afterSeq`, sai nghĩa).

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
| `apps/api/src/chat/chat-access.service.ts` | sửa (additive) | **một** method public `messageReadConditions` (§1.1). **Không** đổi thân hàm cũ, **không** đổi caller cũ |
| `apps/api/src/chat/chat-visibility.spec.ts` | sửa (census) | thêm `chat-search.repository.ts` vào **cả hai** ca + nới bộ lọc — xem §3 |
| `apps/api/src/chat/chat.errors.ts` | sửa (additive) | mã lỗi con trỏ hỏng |
| `apps/api/src/chat/chat.dto.ts` | sửa (additive) | `ChatSearchQueryDto` |
| `apps/api/src/chat/chat.module.ts` | sửa (additive) | controller + 2 provider mới |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | regen | route mới ⇒ census ĐỎ nếu không regen (`ROUTE_CENSUS_WRITE=1`) |
| `harness/backlog.mjs` | sửa | `paths` thiếu `packages/contracts/src/chat.ts`; `done_when` §19 chuyển giao cho QA-1 — xem dưới |

**KHÔNG migration. KHÔNG đụng `app.module.ts`. KHÔNG đụng `chat-messages.*`** (tránh xung đột merge với
BE-6, vốn cũng sửa `chat-messages.service.ts`).

**Hai sửa `harness/backlog.mjs` bắt buộc** (plan-reviewer, mục chặn 5 + 6):

1. `paths` của WO **thiếu `packages/contracts/src/chat.ts`** — đúng file §2 nói sẽ sửa. Hệ quả:
   `guard-scope` kêu ngoài phạm vi giữa chừng, và scheduler **không thấy** BE-4 tranh chấp file này với
   FE-1/BE-5/BE-6 (`wo-paths-drive-gate-and-scheduler`). Thêm cả `harness/backlog.mjs`.
2. `done_when` có dòng *"Đo ngưỡng §19 (< 800ms ở ~1 triệu tin)"*, mà §1.9 lại chuyển giao cho `QA-1`.
   Ledger đóng WO theo **commit**, không theo plan ⇒ WO sẽ được đóng dấu "xong" trong khi một dòng nghiệm
   thu không ai làm và không ai ghi là đã chuyển giao (`wo-status-auto-ledger`). **Chốt:** sửa `done_when`
   trỏ tường minh sang `S7-CHAT-QA-1`.

**Kỷ luật hot-file:** `packages/contracts/src/chat.ts` đang bị 4 WO của wave cùng chạm — **append cuối
file**, không sắp xếp lại, không đụng khối của WO khác.

---

## 3. Test RED-trước (viết TRƯỚC khi có code)

`apps/api/test/integration/chat-be4-search.int-spec.ts` — gate cứng `hasDb && LANE_DB`, chủ thể
**không phải Super Admin** (SA có `*:*` ⇒ mọi ca deny đều lọt, tautology).

Fixture: 2 tenant · tenant A có **4** phòng — `P1` (actor là thành viên) · `P2` (actor **không** thuộc) ·
`P3` (actor **đã `left_at`**) · **`P4`** (actor là thành viên `left_at IS NULL` NHƯNG phòng
`deleted_at IS NOT NULL`). Mỗi phòng có tin chứa cùng từ khoá "báo cáo tài chính".

> ⚠️ **`P4` là fixture BẮT BUỘC** (plan-reviewer, mục chặn 4). Không có nó, ca "phòng xoá mềm → 0 kết quả"
> phải mượn `P2`/`P3` — và khi đó **gỡ hẳn** vế `chat_rooms.deleted_at IS NULL` khỏi truy vấn thì test
> **vẫn xanh**, vì membership đã loại rồi. Ca không canh gì cả.

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
| 12 | `q` chứa ký tự cú pháp tsquery (`&` `\|` `!` `(` `:*`) | **200**, không 500 | `websearch_to_tsquery` nuốt cú pháp |
| 12b | `q` chứa ký tự **điều khiển** (`%00`, `%01`, `%1F`) | **400**, không 500 | FULL gate §6 mục 1 — kèm đối chứng dương `a.b` → 200 |
| 13 | Phân trang 2 trang (`limit=2`) | không sót, không lặp; trang cuối `nextCursor: null` | Keyset toàn phần |
| 14 | `cursor` rác / base64 hỏng | **400** | Không im lặng rơi về trang đầu |
| 15 | Con trỏ giải mã ra **không chứa** `seq` toàn cục | assert trên chuỗi đã giải mã | §1.2 — không mở lại lỗ DB-2 |
| 16 | `limit=51` | **400** | Trần |
| 17 | Kết quả **không chứa** khoá `url`/`thumbnailUrl` nào | assert vắng khoá | §1.5 — search không ký URL |
| 18 | Kết quả có `roomSeq` + `roomId` | | CHAT-SCREEN-005 nhảy tới ngữ cảnh |
| 19 | **`P4`** — actor LÀ thành viên, phòng `deleted_at IS NOT NULL` | 0 kết quả | Vế 4 (`deleted_at` của phòng) — chỉ ca này canh được nó |
| 20 | `roomId` = phòng của **tenant B** | **404 giống hệt** ca 3/4 | Trục `roomId` cũng phải có vế cross-tenant |
| 21 | Gieo bằng `directPool` **3 tin lệch nhau 1µs trong CÙNG mili-giây**, phân trang `limit=1` | trả đủ **3**, không sót | §1.2 — chính xác của con trỏ; fixture gieo-trong-1-tx KHÔNG tái hiện được |
| 22 | `limit=0` · `limit=-1` · `limit=abc` | **400** cả ba | Trần dưới + kiểu |
| 23 | Con trỏ HỢP LỆ của **người khác** dùng bởi actor | không rò gì (vị từ membership vẫn áp) | Đây là lý do duy nhất khiến "opaque không cần ký" là an toàn |
| 24 | Phòng **đã lưu trữ** mà actor vẫn là thành viên | **CÓ** trả kết quả | Quyết định tường minh (§1.5b), không phải tai nạn |

Unit `apps/api/src/chat/chat-search-cursor.spec.ts`: round-trip encode/decode · chuỗi rác → ném ·
mốc thời gian không hợp lệ → ném · uuid sai hình dạng → ném · cursor rỗng → ném · **round-trip giữ nguyên
mili-giây** (`…T01:02:03.399Z` ra đúng `.399`, không làm tròn).

**Census §13.4 — sửa `chat-visibility.spec.ts`** (plan-reviewer, mục chặn 2). Census hiện liệt kê **cứng**
đúng 2 file repo và lọc bằng chuỗi `visibleFromSeqScalar(`. `chat-search.repository.ts` sẽ **không bị
quét** — đúng lớp lỗi GATE-2 vừa bắt. Ba việc:

1. thêm `chat-search.repository.ts` vào **cả hai** ca census (ca "mỗi hàm SELECT trên `chat_messages`" và
   ca "không file nào tự viết `visible_from_seq` thô");
2. **nới bộ lọc** chấp nhận `visibleFromSeqScalar(` **hoặc** `visibleFromSeqColumn(` — không nới thì hàm đa
   phòng bị báo offender, và cách sửa rẻ nhất lúc đó là nhét tên hàm vào `DOCUMENTED_EXCEPTIONS`, tức
   **đóng đinh lỗ mở** (`tests-can-pin-a-hole-open`);
3. **CẤM** thêm bất kỳ hàm search nào vào `DOCUMENTED_EXCEPTIONS`.

**Unit SQL-đã-render** (mẫu `chat-visibility.spec.ts`): truy vấn đa phòng có **đủ 5 vế** của §1.1 +
**4 lần `company_id`** + `recalled_at IS NULL`; và chuỗi SQL **không chứa** giá trị `q` (nó phải nằm trong
`params`). Kiểm trên SQL đã render, **không** qua gọi API.

**Lưới miễn phí đã có sẵn:** ca 14 của `chat-be1-access.int-spec.ts` ("KHÔNG file nào ngoài
`chat-access.service.ts` dựng lại BỘ ĐIỀU KIỆN") chính là bộ dò tự động cho "bản sao thứ ba". Nó phải giữ
**xanh mà KHÔNG được nới**.

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
- [ ] Census §13.4 (`chat-visibility.spec.ts`) đã phủ `chat-search.repository.ts`; **0** mục mới trong `DOCUMENTED_EXCEPTIONS`
- [ ] Ca 14 của `chat-be1-access.int-spec.ts` giữ **xanh mà không nới**
- [ ] `harness/backlog.mjs`: `paths` += `packages/contracts/src/chat.ts`; `done_when` §19 chuyển giao QA-1
- [ ] **24 ca** int-spec + unit cursor + unit SQL-đã-render XANH trên `LANE_DB` (`mediaos_s7chatbe4`)
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
6. **Tin ĐÃ LƯU ở dạng NFD.** `q` được `.normalize("NFC")` ở biên đọc, nhưng `sendMessageSchema.body`
   **không** normalize và `search_vector` là cột **GENERATED** trên `body` thô. Tin gõ từ macOS/iOS lưu ở
   dạng NFD ⇒ `f_unaccent` không gỡ được dấu tổ hợp ⇒ **gõ đúng chữ vẫn 0 kết quả, HTTP 200**. Không sửa
   được ở WO này (đổi cột generated = migration). Hướng: normalize NFC **lúc ghi** + backfill, là WO
   migration riêng.
7. **Không có tiết chế tần suất** cho endpoint đắt nhất module (mỗi lần gõ phím ⇒ GIN scan + 2 join +
   sort toàn tập vì `ORDER BY date_trunc(...)` không dùng được thứ tự index). FE-4 **phải** debounce.
   Hình dạng cần đo ở `QA-1` là "gõ-là-tìm × không throttle × sort toàn tập", không phải một truy vấn lẻ.
8. **Tên đối phương của phòng DM.** `chatSearchResultSchema.roomName` là `null` cho phòng `direct` — DTO
   không mang thông tin peer. FE-4 phải lấy từ đâu là **câu hỏi mở**, chốt khi dựng màn tìm kiếm.

---

## 6. FULL gate 03/08/2026 — cả hai reviewer **PASS**, 1 MEDIUM đường-chạy đã vá

`security-reviewer` dựng SQL **đã render** từ chính `ChatSearchRepository.search` rồi `EXPLAIN` trên lane
DB: đủ 5 vế, `company_id` tường minh **4 lần**, mọi nút join mang join-filter ⇒ **không có tích Descartes**;
`q` nằm ở `params` (`$4`) với payload `bao' OR 1=1 --`, không trong SQL. silent-failure-hunter mô phỏng
mutation "gỡ `messageReadConditions` khỏi mảng `conds`" và census trả ĐỎ ⇒ neo là thật.

| # | Phát hiện | Vá |
| --- | --- | --- |
| 1 | **MEDIUM (đường chạy)** — `q` chứa ký tự **điều khiển** làm `websearch_to_tsquery` ném `22021 invalid byte sequence for encoding "UTF8"` ⇒ **500**. Mỗi request mở rồi rollback một tx và bơm stack vào log | `SEARCH_CONTROL_CHAR_RE` ở `chatSearchQuerySchema` + int-spec ca 12b (kèm đối chứng dương: dấu câu thường vẫn lọt) |
| 2 | **Neo GIẢ** — hai assert quan trọng nhất của `chat-search.sql.spec.ts` (`messageReadConditions` và `date_trunc`) chạy trên nguồn **nguyên bản**, mà cả hai chuỗi đều có trong jsdoc ⇒ PASS kể cả khi xoá lời gọi thật | đổi sang `repoCode` (nguồn đã gỡ comment) |
| 3 | **Ca 23 no-op** — P2 chỉ có 1 tin khớp ⇒ `nextCursor = null` ⇒ `if (!cursor) return;` thoát trước mọi assert. Ca "lý do duy nhất khiến con trỏ opaque không cần ký vẫn an toàn" **chưa từng chạy** | gieo thêm tin vào P2 + `expect(cursor).not.toBeNull()` |
| 4 | `chat.permissions.spec.ts` lặp **cứng** 2 controller ⇒ `/chat/search` đứng ngoài **cả ba** lưới cấp-module của chính suite tự nhận là "nơi DUY NHẤT soi cặp quyền" | hằng `CHAT_CONTROLLERS` + dòng `ROUTE_GATES` cho `searchMessages` |
| 5 | `@UsePipes(ZodValidationPipe)` không có neo nào chạy trong CI (int-spec SKIP khi thiếu `LANE_DB`) | thêm assert ở `chat-search.sql.spec.ts` |
| 6 | Int-spec truyền `is_sensitive=false` cho **mọi** cặp, kể cả `('view','chat-oversight')` — helper ghi `ON CONFLICT DO UPDATE` lên catalog **toàn cục**, `cleanupTenants` không khôi phục ⇒ lật cờ vĩnh viễn trên lane DB, và cờ đó lái `getCapabilities()` ⇒ int-spec BE-7 sẽ phụ thuộc **thứ tự chạy** (`canonical-seed-pin-regression`) | khớp seed thật: `chat-oversight` → `true` |
| 7 | `truncateToMillisecond` export nhưng **0 caller** và là **no-op** — `Date` vốn chỉ có mili-giây. Tên hứa một bảo đảm mà thân hàm không cấp | gỡ, thay bằng khối comment "đừng thêm lại" |

**Bằng chứng sau khi vá:** `src/chat` **166 unit** + `chat-be4-search.int-spec.ts` **21 ca** = 187 test xanh
trên `LANE_DB=mediaos_s7chatbe4` (đã `--reset`); `pnpm typecheck` + `pnpm lint` 0 error; census route regen
(gated 423→424, `view:chat-room`).

**Còn mở, chuyển giao tường minh:** `CHAT-ERR-016` đang dùng chung số cho hai trục con trỏ
(`beforeSeq`/`afterSeq` của `/messages` và cursor opaque của `/search`) — hằng riêng, số chung. Nới câu chữ
SPEC-15 §12 hay cấp mã mới là việc của `S7-CHAT-QA-1` khi rà đủ 20 mã.

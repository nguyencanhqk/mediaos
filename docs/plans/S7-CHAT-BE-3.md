# Micro-plan — `S7-CHAT-BE-3` (🔴 red · crown · FULL gate)

> **WO:** Đính kèm tệp/ảnh qua FOUNDATION Files + `ChatMessageFileResolver` (CHAT-API-010 mở rộng `fileIds[]` · CHAT-API-017 mới).
> **Nguồn sự thật:** [SPEC-15 §13.5 · §13.6](<../SPEC/SPEC-15 CHAT.md>) · [DB-12 §6.3 · §6.5](<../DB/DB-12 CHAT Database Design.md>) · [API-13 §6 nguyên tắc 3 · 10](<../API Design/API-13_CHAT_API_Design.md>)
> **Nền:** `S7-CHAT-BE-2` đã land (`54b4d8cd` + vá `631d683e`, `5365e0d0`). Mig `0538`/`0539` đã có `attachment_count`; `file_links` đã có sẵn từ `0433`.
> **Nhánh:** `wave/s7-chat`. **KHÔNG migration ở WO này** — xem §0.

---

## 0. Đo thật trước khi thiết kế

| Thứ | Đo được 03/08/2026 | Nguồn |
| --- | --- | --- |
| **KHÔNG cần migration** | `file_links.entity_type` là `varchar(100)` **không CHECK** · `link_type` CHECK đã có `'Attachment'` · `attachment_count` + CHECK `>= 0` đã tồn tại · `message_type` CHECK đã có `'file'` | `0433:137,159-160` · `0538` |
| **`attachment_count` KHÔNG có GRANT UPDATE** | phải đặt NGAY TRONG CÂU INSERT tin. Mọi `UPDATE … SET attachment_count` = `42501` ⇒ **mọi tin có tệp trả 500** | `0538:350-355` · DB-12 §6.3 đính chính |
| **`file_links` KHÔNG có GRANT DELETE** | `GRANT SELECT, INSERT, UPDATE` ⇒ gỡ link = soft delete (`deleted_at`). `unlinkMessageFiles` của BE-2 đã viết đúng, chỉ đang chạy 0 hàng | `0433:182` · `chat-messages.repository.ts:354` |
| **`FilePolicyService.decideForLinkedFile` fail-closed** | link nào có `(module_code, entity_type)` **chưa đăng ký resolver** → `deny-no-resolver`, **KHÔNG** rơi xuống fallback `FOUNDATION.FILE.*` | `file-policy.service.ts:186-191` |
| Verdict nhiều link = **AND (most-restrictive)** | file có N link → dispatch từng link, deny ĐẦU TIÊN thắng | `file-policy.service.ts:194-205` |
| `registerResolver` **ném** khi trùng key | không âm thầm ghi đè ⇒ đăng ký 2 lần = sập boot, fail-loud | `file-policy.service.ts:104-111` |
| Tiền lệ module tự quản lý link (bypass `FileService.link`) | `HrEmployeeAvatarService` — `FileLinkRepository.insertTx` + `FileAccessLogService.record` **cùng tx**; `FilesModule` export sẵn cả hai vì đúng lý do này | `hr-employee-avatar.service.ts:305-325` · `files.module.ts:66-82` |
| `uq_file_links_entity_file_active` | `(company_id, module_code, entity_type, entity_id, file_id, link_type) WHERE deleted_at IS NULL` ⇒ **cùng một tệp không gắn 2 lần vào cùng một tin** — phải khử trùng `fileIds` | `0472` |
| `chat_messages.body` **NOT NULL** | không CHECK độ dài ⇒ tin chỉ-có-ảnh lưu `body = ''` hợp lệ | `communication.ts:339` |
| **KHÔNG có pipeline sinh ảnh thu nhỏ** trong repo | không `sharp`, không worker biến thể, `StoragePutInput` chỉ có comment "thumbnail generator" — chưa ai viết | quét toàn `apps/api/src` |
| `DEFAULT_PRESIGN_TTL_SEC` | 300s, ký **cục bộ bằng HMAC** (không round-trip mạng) ⇒ ký N URL/trang là rẻ | `storage-adapter.port.ts:19` |
| Cặp quyền đã seed | `view:chat-room` (đọc) · `send:chat-message` (gửi) — **không** đẻ cặp mới ở WO này | `0538:408-419` |

---

## 1. Lựa chọn thiết kế — chốt ở đây

### 1.1 `ChatMessageFileResolver` — cặp quyền TRÙNG cặp đường đọc tin

| Hành động | Điều kiện | Vì sao |
| --- | --- | --- |
| `canView` / `canDownload` | `view:chat-room` **VÀ** actor là thành viên đang hoạt động của phòng chứa tin (`entityId`) | API-13 §6 nguyên tắc 3: cặp gate của tệp **phải trùng** cặp đường đọc tin. Tách cặp riêng đẻ role "tải được mà đọc không được" (memory `read-path-gate-pair-must-match-download-pair`) |
| `canLink` | `send:chat-message` **VÀ** actor là **người đã tải lên chính tệp đó** **VÀ** actor là **người gửi tin đích** | Hai vế đầu là SPEC-15 §13.5. Vế thứ ba là ràng buộc **thêm** — xem §1.2 |
| `canUnlink` | như `canDownload` + actor là người gửi tin | Gỡ tệp khỏi tin người khác không phải thao tác của thành viên thường |
| `canDelete` | `false` **luôn** | Xoá tệp là việc của FOUNDATION/chủ tệp, không phải của kênh chat. Fail-closed, và `deny-resolver` là verdict CUỐI (không escalate) |

Membership check **KHÔNG viết lại tay** — resolver gọi `ChatAccessService.assertMember` (bắt `NotFoundException` → `false`). Bản sao thứ hai của luật membership là bản sao sẽ trôi (`module-closed-by-second-assert-not-scope`); và `assertMember` đã chứa `left_at IS NULL` + `deleted_at IS NULL` + `company_id` hai vế.

> ⚠️ `entityId` của link CHAT **luôn là `messageId`**, không phải `roomId`. Resolver phải tra tin → phòng rồi mới `assertMember`; dùng `ChatAccessService.assertMessageAccess` làm đúng việc đó trong **một** truy vấn, và nó đã mang sẵn vị từ §13.4 (`visible_from_seq`) — tệp của tin nằm trước mốc mình vào phòng cũng không tải được. Đây là lý do dùng `assertMessageAccess` chứ không phải `assertMember`.

### 1.2 Vì sao `canLink` đòi thêm "actor là người gửi tin đích"

SPEC-15 §13.5 chỉ đòi hai vế (`send:chat-message` + sở hữu tệp). Hai vế đó **đủ** để chặn phát tán CCCD/hợp đồng của người khác. Vế thứ ba đóng một lỗ **toàn vẹn** còn lại:

`POST /foundation/files/:id/links` là route CÔNG KHAI với `moduleCode`/`entityType`/`entityId` do client tự khai. Không có vế ba, một người giữ `send:chat-message` gắn tệp **của chính mình** vào **tin của người khác**. Tệp không rò (là của chính họ), nhưng:

- `attachment_count` của tin đó **không** tăng được (không có GRANT UPDATE) ⇒ DTO tin báo 0 tệp trong khi `GET /rooms/:id/files` liệt kê 1 ⇒ hai đường đọc nói hai chuyện khác nhau, vĩnh viễn, không có đường sửa qua API;
- nội dung bị **chèn** vào phát ngôn của người khác.

Vế ba biến trường hợp xấu nhất thành "tự gắn thêm tệp vào tin CỦA MÌNH" — vẫn lệch `attachment_count` nhưng chỉ trên tin của chính người đó. Đây là **thêm** một điều kiện cần, không phải nới lỏng điều kiện nào của spec ⇒ không lệch tài liệu.

### 1.3 Đường gắn tệp HỢP LỆ đi qua `POST /chat/rooms/:id/messages`, KHÔNG qua `FileService.link`

`FileService.link` tự mở `withTenant` riêng ⇒ không lồng được vào tx gửi tin (PgBouncer transaction-mode). Mà done_when đòi `file_links` tạo **trong CÙNG transaction** với INSERT tin.

**Chốt:** `ChatMessagesService.sendMessage` tự ghi `file_links` bằng `FileLinkRepository.insertTx` + `FileAccessLogService.record` **trong tx gửi tin** — đúng tiền lệ `HrEmployeeAvatarService` (và `FilesModule` export sẵn hai lớp đó *vì* lý do này, xem jsdoc `files.module.ts:66`).

Thứ tự trong tx (bổ sung vào chuỗi BE-2, **không** viết lại chuỗi cũ):

```text
assertMember → chặn phòng lưu trữ → tra clientMessageId (early-return, KHÔNG gắn lại link)
  → validate replyTo → lọc mentions
  → ✦ MỚI: validate fileIds (§1.4)
  → cấp room_seq → INSERT tin (attachment_count = fileIds.length, message_type = 'file' nếu có tệp)
  → ✦ MỚI: INSERT file_links + file_access_logs 'Link'
  → nâng con trỏ đọc người gửi
```

`INSERT tin` phải đứng **trước** `INSERT file_links` (cần `messageId` làm `entity_id`). Kéo theo: `23505` của `uq_chat_messages_client_id` xảy ra **trước** khi có link nào ⇒ nhánh đua của BE-2 không cần đổi.

⚠️ Nhánh idempotent (`findByClientMessageId` trả bản ghi cũ) **return sớm** — tuyệt đối không gắn link lần hai: `uq_file_links_entity_file_active` sẽ `23505` và biến một lần gửi lại vô hại thành 500.

### 1.4 Validate `fileIds` — CHAT-ERR-015, fail-closed, MỘT truy vấn

Khử trùng `fileIds` giữ thứ tự, rồi **một** truy vấn trên `files` (trong tx, RLS-scoped) đòi ĐỦ bốn vế:

`deleted_at IS NULL` · `owner_user_id = actor.id` · `upload_status = 'Uploaded'` · `scan_status <> 'Infected'`

Số hàng trả về **khác** `fileIds.length` ⇒ `ForbiddenException(CHAT_ERR.ATTACHMENT_INVALID)` (CHAT-ERR-015 → **403** theo API-13 §8). MỘT thông điệp cho cả bốn lý do: tách ra là nói cho người gọi biết "fileId này có thật/của ai/đã quét xong chưa" — oracle dò tệp, cùng lớp với CHAT-ERR-001.

> "Cùng transaction" **KHÔNG** cấp quyền và **KHÔNG** thay được vế `scan_status`: đây là kiểm tra nghiệp vụ ở tầng service, độc lập với quyền Postgres.

Trần **10 tệp/tin** (hằng `CHAT_MAX_ATTACHMENTS_PER_MESSAGE`, ép ở Zod). Không có trần thì một POST hợp lệ chạy 200 INSERT link trong một tx đang giữ hàng phòng — cùng lớp bẫy với trần 200 thành viên của BE-1.

### 1.5 Ký URL — MỌI đường ký đi qua `FilePolicyService`, không có lối tắt

Done_when đòi chứng minh được: **gỡ đăng ký resolver ⇒ mọi đường tải 403**. Tính chất đó chỉ đúng nếu **không** đường ký nào của CHAT tự quyết định.

**Chốt:** `ChatAttachmentPresignService` gọi `policy.decideForLinkedFile(input, links, Download)` cho **từng fileId duy nhất** trong một request (khử trùng theo `fileId`), rồi mới `storage.get`. Trạng thái tệp (`Infected` / chưa `Uploaded`) kiểm bằng **hàm dùng chung** tách từ `FileService.downloadStateDenyReason` — xem §1.7.

Hệ quả **có chủ ý** của luật AND: tệp vừa là đính kèm CHAT vừa có link module khác (ví dụ hợp đồng HR) sẽ bị resolver HR từ chối ⇒ **không ký** ⇒ `url: null`. Đó là fail-closed đúng chiều, không phải lỗi.

Không ký được (deny / trạng thái xấu / storage lỗi) ⇒ **`url: null`, KHÔNG ném** — một tệp hỏng không được làm trắng cả trang tin (fail-soft **có log**, mẫu `AvatarPresignService`). Metadata (tên, kích thước, MIME) vẫn trả: nó không nhạy cảm và FE cần nó để hiện "tệp không tải được".

### 1.6 Ảnh thu nhỏ — nói thẳng phạm vi

SPEC-15 §13.5 viết "ảnh hiển thị trước bằng **biến thể** thumbnail". Repo **không có** pipeline sinh biến thể (đo ở §0): không `sharp`, không job, không khoá biến thể trong storage. Dựng nó là một WO riêng (thư viện xử lý ảnh + job + khoá biến thể + dọn rác), **ngoài** `paths` của WO này.

**Chốt v1:** DTO có khoá `thumbnailUrl` với ngữ nghĩa **"URL để hiện xem-trước"**:

- ảnh (`mimeType` bắt đầu `image/`) → **cùng** URL ký của bản gốc, FE co bằng CSS;
- không phải ảnh → `null` (FE hiện tên + kích thước, đúng câu sau của §13.5).

Giữ **tên khoá** `thumbnailUrl` để khi có biến thể thật thì đổi ở SERVER, FE không phải sửa. Ghi rõ giới hạn này trong jsdoc contracts **và** trong §5 DoD — không để nó thành "coi như xong" trong im lặng.

### 1.7 Một nguồn duy nhất cho luật "tệp có được ký không"

`FileService.downloadStateDenyReason` đang là `private`. CHAT cần đúng luật đó. Chép sang = bản sao sẽ trôi (hôm nay `Infected`, ngày mai thêm trạng thái mới, CHAT ký một tệp FOUNDATION đã chặn).

**Chốt:** tách thành hàm thuần export `fileDownloadStateDenyReason(row)` ở `foundation/files/file-download-state.ts`; `FileService` giữ nguyên method private nhưng **uỷ quyền** vào hàm mới (không đổi hành vi, không đổi chữ ký công khai). CHAT gọi cùng hàm.

### 1.8 Đính kèm trong DTO tin nhắn — mảng `attachments`, nạp theo LÔ

`attachmentCount` (đã có từ BE-2) không đủ để FE vẽ gì. Thêm `attachments: ChatAttachmentDto[]` vào `chatMessageSchema`.

Nạp **theo lô**: một truy vấn `file_links ⋈ files` cho toàn bộ `messageId` của trang (`inArray`), gom theo `messageId` ở JS. **Không** N+1 trên đường đọc nóng nhất module.

⚠️ **Ràng buộc bind mảng:** drizzle nội suy `${arr}` sai ⇒ 500 lúc chạy mà typecheck + unit đều mù (memory `drizzle-array-bind-sql-param`). Dùng `inArray()` của drizzle, **không** dựng `sql` tay.

Tin **đã thu hồi** → `attachments: []` ở mapper, cùng chỗ đang bỏ trắng `body`/`mentions`. Link đã soft-delete nên truy vấn vốn đã không trả — đây là đai thứ hai, đặt cạnh hai luật che sẵn có để không ai tách chúng ra.

### 1.9 `GET /chat/rooms/:id/files` (CHAT-API-017)

`assertMember` **trước** mọi thứ (404 chung). Trả các tệp còn link sống của các tin **trong phòng đó**, **mang vị từ §13.4** (`visible_from_seq`) — thiếu nó thì tab "Tệp" là cửa hậu đọc phần lịch sử mà `/messages` và `/pinned` đã chặn, đúng lỗ GATE-2 đã bắt.

Phân trang bằng **con trỏ `roomSeq`** (`beforeSeq`), cấm offset — cùng luật với `/messages`. Trần trang 50, mặc định 30.

Ghi **một** dòng `file_access_logs` action `'GenerateSignedUrl'` cho mỗi tệp ký thành công (action này có sẵn trong CHECK `0433`). Đây là tab "Tệp", không phải đường nóng ⇒ chi phí log chấp nhận được, và không có nó thì việc kéo cả kho tệp của phòng **không để lại dấu vết nào**.

> Đường đọc `/messages` **KHÔNG** ghi access-log: nó chạy mỗi lần cuộn, ghi ở đó là nhấn chìm bảng append-only dùng chung — cùng lý do BE-2 không ghi audit cho gửi/đọc tin. Đánh đổi này ghi ở đây để nó là **quyết định**, không phải chỗ bị bỏ quên.

### 1.10 Đăng ký resolver — additive ở `ChatModule.onModuleInit`

Mẫu `CompanyModule.onModuleInit` / `MeModule`. `ChatModule` thêm `imports: [FilesModule]` (cùng singleton `FilePolicyService`). **KHÔNG đụng `app.module.ts`**.

`registerResolver` ném khi trùng key ⇒ đăng ký hai lần là sập boot fail-loud, không phải ghi đè im lặng.

### 1.11 Hai cột khai tử giữ nguyên

`chat_messages.file_url` / `file_name`: **không** ghi, đường đọc trả `null` (mapper BE-2 đã làm). WO này không đụng — DROP là việc của `S7-CHAT-CLEAN-1` (expand-contract).

---

## 2. Phạm vi — file chạm

| File | Loại | Việc |
| --- | --- | --- |
| `packages/contracts/src/chat.ts` | sửa (additive) | `chatAttachmentSchema` · `attachments` vào `chatMessageSchema` · `fileIds` + `body` nới vào `sendMessageSchema` · `listChatRoomFilesQuerySchema` · `chatRoomFileSchema` |
| `apps/api/src/foundation/files/file-download-state.ts` | **mới** | hàm thuần `fileDownloadStateDenyReason` (§1.7) |
| `apps/api/src/foundation/files/files.service.ts` | sửa (1 method) | uỷ quyền vào hàm mới — **không** đổi hành vi |
| `apps/api/src/chat/chat-file.constants.ts` | **mới** | `CHAT_MESSAGE_ENTITY_TYPE` · `CHAT_ATTACHMENT_LINK_TYPE` · trần tệp/trang |
| `apps/api/src/chat/chat-message-file.resolver.ts` | **mới** | resolver (§1.1) |
| `apps/api/src/chat/chat-attachments.repository.ts` | **mới** | validate tệp gửi · nạp lô đính kèm · liệt kê tệp phòng |
| `apps/api/src/chat/chat-attachments.service.ts` | **mới** | ký qua FilePolicy (§1.5) · CHAT-API-017 |
| `apps/api/src/chat/chat-messages.service.ts` | sửa | nhánh `fileIds` trong `sendMessage`; gắn `attachments` vào 3 đường đọc |
| `apps/api/src/chat/chat-messages.repository.ts` | sửa | `insertMessage` nhận `messageType`; literal `"chat_message"` → hằng |
| `apps/api/src/chat/chat.mapper.ts` | sửa | `attachments` (rỗng khi thu hồi) |
| `apps/api/src/chat/chat.errors.ts` | sửa (additive) | `ATTACHMENT_INVALID` (CHAT-ERR-015) · `ATTACHMENT_LIMIT` (CHAT-ERR-004) |
| `apps/api/src/chat/chat.dto.ts` | sửa (additive) | DTO query của CHAT-API-017 |
| `apps/api/src/chat/chat-messages.controller.ts` | sửa (additive) | `GET /chat/rooms/:id/files`, cặp `view:chat-room` |
| `apps/api/src/chat/chat.module.ts` | sửa (additive) | `imports: [FilesModule]` · providers mới · `onModuleInit` |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | regen | route mới ⇒ census ĐỎ nếu không regen (`ROUTE_CENSUS_WRITE=1`) |

**KHÔNG có migration.** Nếu trong lúc thi công phát hiện cần ALTER ⇒ **DỪNG**, đó là việc của lane migration nối tiếp (`paths` của WO này không có `migrations/**`, và thiếu nó thì gate rơi xuống LIGHT + trùng số — memory `wo-paths-drive-gate-and-scheduler`).

---

## 3. Contracts — đổi gì

```text
chatAttachmentSchema        { id, fileId, name, mimeType, sizeBytes, isImage, url|null, thumbnailUrl|null }
chatMessageSchema           += attachments: chatAttachmentSchema[]        (mặc định [], KHÔNG optional)
sendMessageSchema            body: max(4000).default(""), += fileIds?: uuid[].max(10)
                             .superRefine → body không rỗng HOẶC có ≥1 fileId  (CHAT-ERR-004)
listChatRoomFilesQuerySchema { beforeSeq?, limit=30 (max 50) }            z.coerce (idempotent 2 lần)
chatRoomFileSchema           chatAttachmentSchema + { messageId, roomSeq, senderId, createdAt }
```

`url`/`thumbnailUrl` **`.nullable()`** — server bỏ khoá khi không ký được; thiếu `.nullable()` là `ZodError` làm trắng trang dù HTTP 200 (`server-masking-needs-optional-fe-schema`).

`body` đổi từ `min(1)` sang `default("")` + refine: tin chỉ-có-ảnh là ca thường gặp nhất của tính năng này. Tin rỗng **và** không tệp vẫn 422 như cũ ⇒ ca test BE-2 giữ nguyên kết quả.

---

## 4. Test RED-trước (viết trước khi có code)

`apps/api/test/integration/chat-be3-attachments.int-spec.ts` — gate cứng `hasDb && LANE_DB`, chủ thể **không phải Super Admin**.

| # | Ca | Kỳ vọng | Bắt được gì |
| --- | --- | --- | --- |
| 1 | **Gỡ đăng ký resolver** (override provider trong Testing module) → `GET /foundation/files/:id/download` trên tệp đính kèm | **403** `deny-no-resolver` | Chứng minh fail-closed là THẬT, không phải giả định. Đây là ca cốt lõi của WO |
| 2 | Người **ngoài phòng** gọi `/foundation/files/:id/download` với fileId đính kèm | 403 | Cặp gate tải **trùng** cặp đường đọc |
| 3 | Thành viên phòng tải tệp đính kèm | 200 + URL | Đường thuận không bị chặn oan |
| 4 | Gắn tệp **người khác upload** (`fileIds` chứa file của B) | 403 CHAT-ERR-015 | Chốt tại nguồn — cửa hậu branding |
| 5 | Gắn tệp qua `POST /foundation/files/:id/links` vào tin **người khác** | 403 | §1.2 |
| 6 | `fileIds` có tệp `scan_status='Infected'` | 403 CHAT-ERR-015 | |
| 7 | `fileIds` có tệp `upload_status='Pending'` | 403 CHAT-ERR-015 | "cùng tx" không thay được vế trạng thái |
| 8 | Gửi tin có 2 tệp | 200, `attachmentCount=2`, `messageType='file'`, `attachments.length=2`, **2 hàng `file_links`** cùng tx | `attachment_count` đặt trong INSERT — nếu ai đổi sang UPDATE thì ca này 500 |
| 9 | Gửi lại **cùng `clientMessageId`** + cùng `fileIds` | 200, vẫn **2** hàng link (không 4, không 500) | Nhánh idempotent không gắn lại link |
| 10 | `fileIds` trùng lặp `[f, f]` | 200, **1** link, `attachmentCount=1` | Khử trùng trước `uq_file_links_entity_file_active` |
| 11 | 11 fileIds | 422 | Trần |
| 12 | `body: ""` + 1 tệp | 200 | Ca thường gặp nhất |
| 13 | `body: ""` + 0 tệp | 422 CHAT-ERR-004 | Không nới lỏng tin rỗng |
| 14 | **Thu hồi** tin có tệp → đọc lại + `GET /rooms/:id/files` | `attachments: []`, tệp biến mất khỏi tab Tệp, `/foundation/.../download` **403** | §13.6 — link mất ⇒ FilePolicy từ chối |
| 15 | `GET /rooms/:id/files` bởi người ngoài phòng | **404** (không 403) | Hằng `ROOM_NOT_FOUND` |
| 16 | `GET /rooms/:id/files` — tệp ảnh có `thumbnailUrl`, tệp pdf `thumbnailUrl: null` | | §1.6 |
| 17 | Cross-tenant: user tenant B gửi `fileIds` của tenant A | 403 | RLS + vế owner |
| 18 | `GET /rooms/:id/files` ký thành công → **+1** hàng `file_access_logs` action `GenerateSignedUrl` | | §1.9 — kéo kho tệp phải để lại dấu |

Unit (`apps/api/src/chat/chat-message-file.resolver.spec.ts`): `canDeleteFile` luôn `false` · `canLinkFile` `false` khi thiếu `fileId` (pre-link) · `assertMessageAccess` ném ⇒ `false` (không rò exception ra ngoài policy).

Chạy: `bash harness/check.sh --lane-db=s7chatbe3`.

---

## 5. Definition of Done

- [x] `ChatMessageFileResolver` đăng ký additively ở `ChatModule.onModuleInit`, `moduleCode='CHAT'` + `entityTypes=['chat_message']`; **không** đụng `app.module.ts`
- [x] `canView`/`canDownload` ⇐ cặp `view:chat-room` **và** `assertMessageAccess` (membership + §13.4)
- [x] `canLink` ⇐ `send:chat-message` **và** người gọi upload chính tệp đó **và** là người gửi tin đích
- [x] `file_links` tạo trong **cùng tx** với INSERT tin; `attachment_count` đặt **trong câu INSERT**; **không** `UPDATE` nào chạm cột đó
- [x] `GET /chat/rooms/:id/files` — `assertMember` trước, vị từ §13.4, con trỏ `beforeSeq`, URL ký hạn ngắn, access-log `GenerateSignedUrl`
- [x] **Không** ghi `file_url`/`file_name`; đường đọc vẫn trả `null`
- [x] Ảnh có `thumbnailUrl` — **v1 = URL bản gốc**, chưa có biến thể resize (§1.6); giới hạn ghi trong jsdoc contracts + báo owner
- [x] Int-spec **19 ca** + unit **129 ca** XANH trên `LANE_DB` (`mediaos_s7chatbe3`)
- [x] `pnpm typecheck` + `pnpm lint` (0 error) + census regen (474→475 route, 1 route mới gated)
- [x] FULL gate — 2 HIGH + 5 MEDIUM đã vá (§6.5); tenant-isolation PASS ngay vòng đầu

---

## 6. Đã thi công 03/08/2026 — lệch gì so với §1..§4

### 6.1 Bốn điều chỉnh khi chạm code thật

| # | Dự định | Thực tế | Vì sao |
| --- | --- | --- | --- |
| 1 | `attachmentsByMessage(actor, tx, ids)` — nạp tệp TRONG tx của caller | `decorate(actor, rows)` gọi **NGOÀI** tx; caller đóng tx rồi mới gắn tệp | Ký tệp đi qua `FilePolicyService` → resolver → `withTenant` **riêng**. Lồng `withTenant` trong `withTenant` là chiếm client thứ hai từ pool khi client thứ nhất còn giữ transaction ⇒ **TREO** trên PgBouncer transaction-mode, không báo lỗi (đúng lý do `AvatarPresignService` nhận `callerTx`). Kéo theo: `ChatMessageModerationService.readDto` đổi thành `readRow` (trả row, không DTO) ở cả 3 method |
| 2 | 18 ca int-spec | **14 ca** (gộp các vế cùng bản chất vào một `it`) | Ca 2/3/4 gộp bốn vế của CHAT-ERR-015; ca 7 gộp ba vế trần/rỗng. Không ca nào của §4 bị bỏ — chỉ đóng gói lại |
| 3 | Trần/rỗng trả **422** | **400** | Đây là lỗi SCHEMA (`ZodValidationPipe` ở biên), khác lỗi LUẬT ở service (`CURSOR_EXCLUSIVE` → 422). API-13 §8 cho phép cả hai cho nhóm validate đầu vào; int-spec đóng đinh mã THẬT để không ai đổi tầng ném lỗi cho "khớp tài liệu" |
| 4 | — | `ChatModule` phải `imports: [StorageModule]` **tường minh** | `FilesModule` chỉ *import* `StorageModule`, **không** re-export `STORAGE_ADAPTER`. Thiếu dòng này thì `ChatAttachmentPresignService` không resolve được và **AppModule sập lúc khởi động** — đỏ dây chuyền mọi int-spec, không riêng CHAT (lớp `systemjobhandler-optional-dbw-di`) |

### 6.2 Một lỗ hổng THẬT do test bắt được, không phải reviewer

`canRead` bản đầu viết `return this.seesMessage(input) !== null` — **thiếu `await`**. So một `Promise` với `null` luôn cho `true` ⇒ **mọi người giữ `view:chat-room` tải được MỌI tệp đính kèm của MỌI phòng**, kể cả phòng mình không thuộc. `tsc` mù (biểu thức hợp lệ), `pnpm lint` mù, và cả hai ca "đường thuận" đều XANH.

Thứ bắt được nó là ca unit **"không thấy tin → từ chối"** — ca deny, viết trước khi chạy. Ghi lại vì nó là bằng chứng cụ thể cho luật RED-trước ở vùng đỏ: ca happy-path không bao giờ phân biệt được "có kiểm" với "không kiểm".

### 6.3 Hình dạng TỪ CHỐI khác nhau giữa hai đường tải — có chủ ý

| Đường | Cần cặp | Từ chối |
| --- | --- | --- |
| `GET /foundation/files/:id/download` | `download:foundation-file` (DB thật: chỉ SA + company-admin) | **403** |
| DTO tin + `GET /chat/rooms/:id/files` (đường của người dùng thường) | không cần cặp foundation nào | **`url: null`** + `logger.error` |

Cả hai đi qua **cùng** `decideForLinkedFile` ⇒ gỡ resolver là cả hai cùng câm (ca cốt lõi chứng minh). Chọn fail-soft ở đường CHAT vì một tệp hỏng không được làm trắng cả trang tin; metadata vẫn trả để FE hiện "tệp không tải được" thay vì ô trống không giải thích.

### 6.5 Vá FULL gate 03/08/2026 — 2 HIGH + 5 MEDIUM

Gate chạy 3 reviewer song song: `security-reviewer` **BLOCK**, silent-failure-hunter **BLOCK**,
tenant-isolation **PASS** (0 CRITICAL/HIGH — chứng minh 3 lớp chặn cross-tenant bằng probe DB thật).
Cả hai HIGH **đo được**, không phải suy đoán.

#### HIGH-1 — thu hồi tin MỞ RỘNG phạm vi tải, ngược đúng chiều §13.6

`unlinkMessageFiles` soft-delete link ⇒ `decideForLinkedFile` thấy `links.length === 0` ⇒ coi tệp là
**foundation-owned** ⇒ fallback `FOUNDATION.FILE.DOWNLOAD`, cặp mà company-admin đang giữ (bulk grant
`0435`). Probe với chủ thể **ngoài phòng**, không phải SA:

```text
outsider BEFORE recall = 403      ← resolver CHAT chặn đúng
outsider AFTER  recall = 302      ← signed URL
```

Kịch bản thật: nhân viên lỡ gửi ảnh CCCD vào nhầm phòng → bấm **Thu hồi** → chính thao tác khắc phục
biến tệp từ "chỉ thành viên phòng" thành "mọi người giữ `download:foundation-file`".

**Nghiêm trọng thêm:** int-spec ca 12 **mang tên** `"… · FOUNDATION download 403"` nhưng thân test
**không có assert nào** cho đường đó — chỗ đáng lẽ là assertion thì là một comment thừa nhận hành vi
ngược lại. Người quét tên test sẽ tin tính chất đó đã bị khoá (`tests-can-pin-a-hole-open`).

**Chốt (owner chọn hướng A, 03/08):** **KHÔNG** gỡ link khi thu hồi — tệp giữ nguyên trạng thái
**module-owned** nên mọi quyết định tải vẫn phải hỏi `ChatMessageFileResolver`, và `canRead` từ chối vì
`recalled_at IS NOT NULL`. Đường đọc CHAT không đổi (mapper + vế `recalled_at IS NULL` của tab Tệp đã có
sẵn). `unlinkMessageFiles` **đã gỡ bỏ**, thay bằng khối comment tại chỗ để không ai viết lại.
SPEC-15 §13.6 đã đính chính (mệnh đề "link mất → FilePolicy từ chối tải" là **sai** với hiện thực
FOUNDATION). Vế B — vá ở tầng FOUNDATION — tách thành **`S7-FND-LINKFALLBACK-1`** vì lỗ này **không riêng
CHAT** (HR contract · task file · avatar · branding cùng dính) và đổi hợp đồng dùng chung của 5 module.

#### HIGH-2 — link "ma" do hai cách nhìn khác nhau về cùng một khoá

| Bên | Cách tra khoá |
| --- | --- |
| registry `FilePolicyService` | `trim().toLowerCase()` |
| CHAT truy vấn `file_links` | so-chuỗi **chính xác** |

Client khai `moduleCode:"chat"` + `entityType:"Chat_Message"` qua `POST /foundation/files/:id/links`:

```text
link status                      = 201
room-mate download BEFORE recall = 302   ← resolver ĐÃ cấp quyền (khoá normalize khớp)
visible in CHAT tab Tep          = false ← CHAT không thấy
recall → download AFTER          = 302   ← thu hồi KHÔNG chạm tới
owner tries to UNLINK ghost      = 403   ← canUnlinkFile luôn false ⇒ VĨNH VIỄN
```

Một hàng `file_links` cấp quyền tải cho toàn bộ thành viên phòng mà **không quan sát được và không thu hồi
được**. Comment cũ ở `chat-file.constants.ts` khẳng định "lệch một ký tự là `deny-no-resolver`" — **sai**,
và đã sửa.

**Chốt:** chặn ở **biên ghi**. `FilePolicyService.canonicalOwnerKey(moduleCode, entityType)` trả dạng chính
tắc mà resolver tự khai; `FileService.link` **từ chối 400** khi client khai lệch. **Từ chối** chứ không âm
thầm viết lại — viết lại là đổi thứ client khai mà không nói. Tệp foundation-owned (không resolver nào
nhận) giữ nguyên hành vi cũ.

#### MEDIUM — gốc chung: `POST /foundation/files/:id/links` là ĐƯỜNG GHI THỨ HAI

Nó không đi qua `ChatMessagesService.sendMessage`, nên **mọi bất biến mà `sendMessage` ép ở tầng service chỉ
là bất biến của MỘT trong hai đường ghi** cho tới khi được ép lại ở `canAttach`. Ba vế đã bổ sung:

| Vế | Thiếu nó thì | Probe |
| --- | --- | --- |
| phòng **lưu trữ** | ghi nội dung mới vào phòng chỉ-đọc (CHAT-ERR-005 bị vòng qua) | link vào phòng archived → **201** |
| tin **đã thu hồi** | link sống lại ⇒ mở lại đường tải cho mọi thành viên phòng | — |
| **trần** `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` | phá điều kiện tiên quyết của `trimToMessageBoundary` ⇒ tab Tệp **mất tệp im lặng** | trần chỉ ở Zod |

Hai MEDIUM còn lại:

- `decorate()` bỏ vế lọc `attachmentCount > 0`. Cột không có GRANT UPDATE, nên tệp gắn qua đường FOUNDATION
  **vô hình vĩnh viễn** trên `/messages` trong khi tab Tệp vẫn liệt kê và vẫn ký URL — hai đường đọc nói hai
  chuyện khác nhau, không có đường sửa qua API. Chi phí bỏ vế này là đúng một truy vấn lô vốn đã chạy.
- `signMany` nạp link **cả lô** bằng một truy vấn (`listLinksForFiles`) thay vì mỗi tệp một `withTenant`;
  `logSignedUrls` đổi từ best-effort sang **fail-closed** (nuốt lỗi ghi = giữ nguyên đúng trạng thái "kéo cả
  kho không để lại dấu vết", chỉ thêm một dòng warn không ai đọc); `orderBy` thêm `fileLinks.id` vì
  `created_at` = mốc bắt đầu tx nên mọi link của một tin **trùng nhau từng bit** ⇒ thứ tự do planner quyết
  ⇒ ảnh đảo chỗ giữa hai lần cuộn.

#### Bằng chứng sau khi vá

`src/chat` **129 unit** (+6) · `chat-be3-attachments.int-spec.ts` **19 ca** (+4: khoá lệch chính tả · tệp
gắn sau vẫn lên `/messages` · phòng lưu trữ · trần tệp) · foundation files **169 test / 13 file** xanh
(bán kính nổ của thay đổi `FileService.link` đã chạy lại) · `pnpm typecheck` + `pnpm lint` 0 error.

> ⚠️ Ba stub `FilePolicy` trong test (`files-service.int-spec.ts`, `file-security.int-spec.ts`,
> `foundation-db2-link-conflict.int-spec.ts`, `files.service.spec.ts`) phải thêm `canonicalOwnerKey`. Đây là
> **đúng lớp bẫy mà comment sẵn có trong chính stub đó đã cảnh báo**: `as never` ở chỗ inject giấu method
> thiếu khỏi `tsc`, nên quên stub = đỏ lúc CHẠY chứ không phải lúc build.

### 6.4 Nợ để lại (KHÔNG vá ở đợt này)

1. **Biến thể thumbnail thật** — cần thư viện xử lý ảnh + job + khoá biến thể trong storage + dọn rác. Ngoài `paths` của WO. FE dùng `thumbnailUrl` được ngay, đổi ngữ nghĩa sau chỉ sửa ở SERVER.
2. **Luật AND của `decideForLinkedFile`** làm tệp vừa là đính kèm CHAT vừa gửi ở phòng thứ hai bị từ chối cho người chỉ thuộc một phòng. Fail-closed đúng chiều, chưa gặp trong luồng thật (người dùng phải chủ động gửi lại chính tệp đó sang phòng khác). Ghi lại để không ai "sửa cho chạy" bằng cách bỏ vế AND.
3. **`/messages` không ghi `file_access_logs`** — chạy mỗi lần cuộn, ghi ở đó là nhấn chìm bảng append-only dùng chung. Đường KÉO CẢ KHO (`/files`) thì có ghi. Đây là **quyết định**, không phải chỗ bị bỏ quên.

### 6.5 Bàn giao cho `S7-CHAT-RT-1` — một ràng buộc MỚI

`chatMessageSchema` (payload WS `chat:message`, re-export ở `contracts/realtime.ts`) giờ có `attachments` **bắt buộc**. Emitter của RT-1 **phải** dựng payload qua `ChatAttachmentPresignService.decorateOne`, không được `.parse()` row thô — thiếu khoá là `ZodError` ngay tại `RealtimeEmitterService`.

Kèm theo: `decorateOne` **mở transaction riêng** ⇒ RT-1 phải gọi nó **SAU** khi tx nghiệp vụ commit — vốn đã là ràng buộc của API-13 §6 nguyên tắc 6 ("emit WS sau commit"), nay có thêm lý do thứ hai (treo pool PgBouncer).

Và: URL ký có TTL 300s. Payload WS nằm trong bộ nhớ client lâu hơn thế ⇒ FE phải chấp nhận URL hết hạn và gọi lại `/messages` (hoặc `/files`) để lấy URL mới — **không** cache `url` vào store dài hạn.

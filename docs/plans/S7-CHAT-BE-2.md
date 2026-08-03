# Micro-plan — `S7-CHAT-BE-2` (🔴 red · crown · FULL gate)

> **WO:** Tin nhắn — đọc theo con trỏ · gửi idempotent · trả lời · thu hồi · ghim · đã-đọc chỉ-tiến + tổng chưa đọc (CHAT-API-009..014, 016).
> **Nguồn sự thật:** [SPEC-15 §13.1 · §13.2 · §13.4 · §13.6](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §5.1 · §6 nguyên tắc 4·5·7·8](<../API Design/API-13_CHAT_API_Design.md>) · [DB-12](<../DB/DB-12 CHAT Database Design.md>)
> **Nền:** mig `0538` + `0539`; `S7-CHAT-BE-1` đã land (`c77f48e0`) — `ChatAccessService` là điểm khẳng định membership DUY NHẤT.
> **Nhánh:** `wave/s7-chat`.

---

## 0. Đo thật trước khi thiết kế

| Thứ | Đo được 02/08/2026 | Nguồn |
| --- | --- | --- |
| **Quyền ghi `chat_messages`** | `SELECT, INSERT` cấp bảng. UPDATE **chỉ 4 cột**: `pinned_at`, `pinned_by` (`0050:64`) + `recalled_at`, `recalled_by` (`0538:355`). **KHÔNG** DELETE, **KHÔNG** UPDATE cấp bảng — `0539` verify (3) làm ĐỎ MIGRATION nếu ai cấp thêm | `0050:64` · `0538:355` · `0539` verify |
| **`attachment_count` KHÔNG có GRANT** | cố ý — phải đặt NGAY TRONG CÂU INSERT. Mọi `UPDATE … SET attachment_count` = 42501 ⇒ 500 | `0538:350-355` |
| **`room_seq` gán lúc INSERT** | không cột nào cho sửa về sau; đai thứ hai `uq_chat_messages_room_seq (company_id, room_id, room_seq)` | `0539` |
| **`0539` verify ép room_seq LIÊN TỤC TỪ 1** mỗi phòng | `min=1 AND max=count(*)`. ⇒ **cấp số mà rollback KHÔNG được để lỗ** — khác hẳn `room_code` (lỗ số chấp nhận được) | `0539` verify (1) |
| Idempotent gửi | `uq_chat_messages_client_id (company_id, room_id, sender_id, client_message_id) WHERE client_message_id IS NOT NULL` | `0538:338` |
| Tự tham chiếu trả lời | `chat_messages_reply_to_tenant_fk (company_id, reply_to_message_id) → chat_messages(company_id,id)` — composite, đã chặn chéo tenant ở DB | `0538:333` |
| **`file_links` KHÔNG có DELETE** | `GRANT SELECT, INSERT, UPDATE` ⇒ "gỡ link khi thu hồi" phải là **soft delete** (`deleted_at`), viết `delete()` là 42501 | `0433:182` |
| `message_type` CHECK | `('text','file','system')` | `0538` `chk_chat_messages_type` |
| Cặp quyền đã seed | `send`/`recall`/`pin` × `chat-message` + `view:chat-room` | `0538:408-419` |
| `ChatAccessService` | `assertMember(tx, companyId, roomId, actorUserId)` → `{room, membership}`; `requireRoomAdmin(access)` thuần-hàm | `chat-access.service.ts` |
| `visibleFromSeq` **chưa có** trong `ChatRoomAccess.membership` | BE-1 không cần; BE-2 cần cho vị từ §13.4 ⇒ phải bổ sung vào projection | `chat-access.service.ts` |

---

## 1. Lựa chọn thiết kế — chốt ở đây

### 1.1 Đường vào theo `messageId`: `assertMessageAccess`, CÙNG FILE, CÙNG vị từ

3 route nhận `messageId` chứ không phải `roomId` (`recall`, `pin`, `unpin`). Cách viết ngây thơ:

```ts
const msg = await repo.findMessageById(...)          // ❌
if (!msg) throw new NotFoundException(MESSAGE_NOT_FOUND)
await access.assertMember(tx, companyId, msg.roomId, actor.id)   // ném ROOM_NOT_FOUND
```

⇒ **ORACLE**: "tin không tồn tại" và "tin có tồn tại nhưng ở phòng tôi không thuộc" trả **hai thông điệp khác nhau** ⇒ bắn `messageId` ngẫu nhiên là dò được tin nào có thật trong toàn công ty. Đúng lớp lỗ mà CHAT-ERR-001 dựng 404 để chặn, chỉ đổi trục từ *phòng* sang *tin*.

**Chốt:** thêm `assertMessageAccess(tx, companyId, messageId, actorUserId)` **vào chính `chat-access.service.ts`**, dùng **CÙNG** predicate builder private với `assertMember` (một bản sao duy nhất của luật), làm **MỘT truy vấn** `chat_messages ⋈ chat_rooms ⋈ chat_room_members`, và ném **MỘT hằng** `CHAT_ERR.MESSAGE_NOT_FOUND` cho mọi lý do.

Đặt ở file khác = điểm khẳng định membership thứ hai. Ca test 14 của BE-1 (`chỉ ĐÚNG MỘT file định nghĩa assertMember`) phải được mở rộng để phủ cả hàm mới.

### 1.2 Cấp `room_seq` — khoá hàng phòng, TRONG tx nghiệp vụ

```sql
UPDATE chat_rooms
   SET last_message_seq = COALESCE(last_message_seq, 0) + 1,
       last_message_at  = now()
 WHERE company_id = $1 AND id = $2
RETURNING last_message_seq;
```

Khoá hàng phòng ⇒ **tuần tự hoá theo phòng**, hai người gửi cùng lúc không thể nhận cùng số. Đai thứ hai là `uq_chat_messages_room_seq` (`23505` fail-loud thay vì trùng số im lặng).

⚠️ **KHÁC `room_code` của BE-1 ở một điểm sống còn:** `room_code` cho phép **lỗ số** (cấp ngoài tx, rollback thì bỏ phí). `room_seq` **KHÔNG**: `0539` verify ép `min=1 AND max=count(*)` trong mỗi phòng, nên một lỗ là migration sau đó ĐỎ. ⇒ cấp số phải nằm **TRONG CÙNG** tx với INSERT tin, không được tách ra như `nextCode`.

### 1.3 Idempotent gửi — kiểm TRƯỚC khi cấp số, bắt `23505` ĐÚNG constraint

Thứ tự trong tx: `assertMember` → chặn phòng lưu trữ → **SELECT theo `clientMessageId`** → (thấy thì trả luôn bản cũ, `200`) → validate reply/mentions → **cấp `room_seq`** → INSERT → nâng `last_read_seq` người gửi → audit? (**không** — xem §1.7).

Đua thật sự: cả hai qua SELECT rồi cùng INSERT ⇒ một bên `23505` trên `uq_chat_messages_client_id` ⇒ **transaction abort** ⇒ bắt ở NGOÀI `withTenant` (trong tx thì mọi câu sau là `25P02`) rồi SELECT lại trong tx MỚI. Rollback cũng trả lại `last_message_seq` ⇒ **không lỗ số**.

Bắt `23505` phải soi **tên constraint**; nuốt 23505 của constraint khác là trả về tin sai trong im lặng (bài học `S5-SEQ-HARDEN-1`).

> `clientMessageId` **do client sinh MỘT LẦN khi bắt đầu soạn** (API-13 §6.5). Server **không** sinh hộ: khoá ngẫu nhiên tạo trong thân hàm gửi không chống trùng gì cả (memory `idempotency-key-must-be-content-derived`). ⇒ trường **BẮT BUỘC** trong DTO, không `.optional()`.

### 1.4 Con trỏ — `beforeSeq` XOR `afterSeq`, cấm offset

| Tham số | Truy vấn | Trả về |
| --- | --- | --- |
| `beforeSeq=n` | `room_seq < n` ORDER BY `room_seq` **DESC** LIMIT k | đảo lại → **tăng dần** |
| `afterSeq=n` | `room_seq > n` ORDER BY `room_seq` **ASC** LIMIT k | tăng dần |
| không có | mới nhất: ORDER BY `room_seq` DESC LIMIT k | đảo lại → tăng dần |

Cả hai cùng lúc → **CHAT-ERR-016** (422). `limit` mặc định 50, trần **100** (ép ở Zod, không ở service). Phản hồi **LUÔN tăng dần theo `room_seq`** — một hướng duy nhất để FE không phải tự đoán chiều; ghi rõ trong DTO.

Vị từ §13.4 phải có mặt **NGAY TỪ v1** dù `visible_from_seq` luôn NULL:
`(m.visible_from_seq IS NULL OR msg.room_seq >= m.visible_from_seq)` — thêm sau sẽ sót đường đọc.

### 1.5 Thu hồi (§13.6) — hằng số MỘT chỗ

`CHAT_RECALL_WINDOW_MINUTES = 15`, khai **một chỗ** trong `chat-message-rules.ts`. Người gửi trong cửa sổ **hoặc** admin phòng **nhóm** (`room_type='group'` — admin phòng dẫn xuất không có nghĩa vì thành viên là cache). Ngoài ra → **CHAT-ERR-006 (403)**.

Sau thu hồi: `recalled_at`/`recalled_by` (column-GRANT), DTO trả **`body: null`** + `recalledAt`. **Che ở SERVER** — không phải client. ⇒ contracts `body` phải `.nullable()`, thiếu là ZodError trắng trang dù HTTP 200 (memory `server-masking-needs-optional-fe-schema`).

Gỡ tệp: `UPDATE file_links SET deleted_at = now()` cho `(module_code='CHAT', entity_type='chat_message', entity_id=<id>)`. **KHÔNG `delete()`** — `file_links` không có GRANT DELETE. v1 chưa có đường gắn tệp (đó là BE-3) nên câu này chạy 0 hàng; viết sẵn để BE-3 không phải nhớ quay lại.

Thu hồi **lần hai** → idempotent, trả về chính bản ghi đã thu hồi (không lỗi): người dùng bấm hai lần không đáng nhận lỗi đỏ.

### 1.6 Ghim ≤ 20 · đánh dấu đã đọc chỉ-tiến

- Ghim: đếm `pinned_at IS NOT NULL AND recalled_at IS NULL` trong phòng; ≥20 → **CHAT-ERR-008 (409)**. Ghim/bỏ ghim = quyền `pin:chat-message` **+ admin phòng** (API-13 §5.1).
- Tin `system` và tin **đã thu hồi**: không ghim, không thu hồi được.
- `POST /read {seq}`: `UPDATE … SET last_read_seq = GREATEST(last_read_seq, $seq)`. Số nhỏ hơn → **bỏ qua IM LẶNG, HTTP 200**, không lỗi (CHAT-ERR-018). Số **vượt** `last_message_seq` của phòng → kẹp về `last_message_seq` (client không được tự đẩy con trỏ vượt thực tế).
- Tin do chính mình gửi tự nâng `last_read_seq` **trong cùng tx** với INSERT (§13.2).

### 1.7 Audit — CỐ Ý KHÔNG ghi cho gửi/đọc tin

SPEC-15 §18 + API-13 §6.8: **nội dung tin nhắn không vào audit**. Nhưng cũng không ghi *hành động* gửi/đọc: mỗi tin một dòng audit sẽ nhấn chìm sổ audit (`audit_logs` là bảng append-only dùng chung, đang phục vụ điều tra HR/LEAVE/AUTH) và biến nó thành bản sao thứ hai của chính `chat_messages`.

**Ghi audit đúng 2 hành động**: `chat.message.recalled` · `chat.message.pinned`/`unpinned` — hành động **quản trị** trên nội dung người khác. `object_type='chat_message'` (đã có trong union TS + catalog `0050`), `module_code='CHAT'`, **`object_id` = messageId, KHÔNG kèm `body`**.

### 1.8 KHÔNG emit WebSocket ở WO này

`RealtimeEmitterService` đã tồn tại, nhưng WS là `S7-CHAT-RT-1`. Emit ở đây sẽ (a) thiếu room join server-side nên không ai nhận, (b) dễ bị viết TRONG tx — đúng lỗi API-13 §6.6 cấm. Chừa nguyên.

---

## 2. Phạm vi — 8 route (API-13 §5.1)

| Mã | Route | Cặp quyền | Gate |
| --- | --- | --- | --- |
| 009 | `GET /chat/rooms/:id/messages` | `view:chat-room` | `assertMember` |
| 010 | `POST /chat/rooms/:id/messages` | `send:chat-message` | `assertMember` + chưa lưu trữ |
| 011 | `POST /chat/messages/:id/recall` | `recall:chat-message` | `assertMessageAccess` + luật §1.5 |
| 012a | `POST /chat/messages/:id/pin` | `pin:chat-message` | `assertMessageAccess` + admin phòng |
| 012b | `DELETE /chat/messages/:id/pin` | `pin:chat-message` | `assertMessageAccess` + admin phòng |
| 013 | `GET /chat/rooms/:id/pinned` | `view:chat-room` | `assertMember` |
| 014 | `POST /chat/rooms/:id/read` | `view:chat-room` | `assertMember` |
| 016 | `GET /chat/unread-count` | `view:chat-room` | tự-bound theo actor |

**Ngoài phạm vi:** 015 tìm kiếm (BE-4) · 017 tệp (BE-3) · `/chat/oversight/*` (BE-7) · WS (RT-1) · NOTI (BE-6) · sinh tin `system` khi đổi phòng (chưa WO nào nhận — ghi nợ).

### 2.1 ⚠️ Lệch mã HTTP với BE-1 — nêu để owner chốt, KHÔNG tự ý hợp nhất

`done_when` của WO này ghi **409** cho "gửi vào phòng đã lưu trữ" và "ghim quá 20". BE-1 đã ship **422** cho cùng điều kiện CHAT-ERR-005 ở đường sửa/thêm-bớt thành viên, và có int-spec ghim chặt.

Làm theo `done_when` (409) ⇒ **cùng một mã lỗi nghiệp vụ CHAT-ERR-005 trả hai mã HTTP khác nhau** tuỳ endpoint. Đổi BE-1 sang 409 thì ngoài phạm vi WO và phá test đã ship.

**Chốt cho WO này:** theo `done_when` — 409 cho gửi-vào-phòng-lưu-trữ và ghim-quá-20; giữ nguyên 422 của BE-1. Ghi vào đây để lần thống nhất sau là quyết định có chủ đích, không phải phát hiện lại.

---

## 3. Contracts — đổi gì ở `packages/contracts/src/chat.ts`

| Thay đổi | Vì sao |
| --- | --- |
| `chatMessageSchema.seq` → **`roomSeq`** | trả nợ `S7-CHAT-DB-2` (§3.1 plan BE-1). WO này là WO dựng endpoint tin nhắn ⇒ đúng chỗ để bỏ |
| `body: z.string()` → **`.nullable()`** | tin đã thu hồi trả `null`; thiếu là ZodError trắng trang |
| `chatMessageTypeSchema` += `"system"` | khớp `chk_chat_messages_type` (`0538`) |
| bỏ `fileUrl`/`fileName` khỏi DTO gửi, giữ `.nullable()` ở DTO đọc | hai cột **khai tử** (`done_when` BE-3); đường đọc trả null |
| thêm `recalledAt` · `replyToMessageId` · `attachmentCount` · `senderName` | DTO đọc |
| `sendMessageSchema`: **`clientMessageId` BẮT BUỘC** + `replyToMessageId?` + `mentions?` ≤20 | §1.3 |
| mới: `listMessagesQuerySchema` · `markReadSchema` · `unreadCountSchema` | 009 · 014 · 016 |

---

## 4. Test RED-trước

⚠️ Chủ thể **KHÔNG** là Super Admin (lý do đầy đủ ở đầu `chat-be1-access.int-spec.ts`).

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| 1 | `messageId` **không tồn tại** vs `messageId` **có thật ở phòng mình không thuộc** | **404 GIỐNG HỆT NHAU** (so byte, chuẩn hoá envelope) — cả 3 route `/messages/:id/*` |
| 2 | Đọc tin ở phòng mình không thuộc / tenant khác / đã rời | 404 |
| 3 | `beforeSeq` **và** `afterSeq` cùng lúc | CHAT-ERR-016 (422) |
| 4 | `limit=101` | 400 (Zod chặn ở biên) |
| 5 | Gửi lại cùng `clientMessageId` | **cùng messageId**, 200, **đúng 1 hàng**, `last_message_seq` **KHÔNG tăng lần 2** |
| 6 | 2 người gửi vào **cùng phòng** | `room_seq` khác nhau, **liên tục**, không lỗ (soi trực tiếp DB) |
| 7 | Gửi vào phòng **đã lưu trữ** | 409 |
| 8 | Thu hồi tin **người khác** (không phải admin) | 403 CHAT-ERR-006 |
| 9 | Thu hồi tin mình **quá 15 phút** (gieo `created_at` lùi) | 403 CHAT-ERR-006 |
| 10 | Admin phòng nhóm thu hồi tin người khác | 200; DTO `body: null` + `recalledAt`; **body gốc VẪN trong DB** |
| 11 | Thu hồi **lần hai** | 200 idempotent, đúng 1 dòng audit |
| 12 | Ghim tin thứ **21** | 409 CHAT-ERR-008 |
| 13 | Ghim bởi **thành viên thường** | 403 |
| 14 | Ghim tin **đã thu hồi** / tin `system` | 422 |
| 15 | Trả lời tin **khác phòng** / tin đã thu hồi | 422 CHAT-ERR-009 |
| 16 | Mention người **ngoài phòng** | gửi **thành công**, `mentions` đã loại người đó |
| 17 | `POST /read` số **nhỏ hơn** hiện tại | 200, `last_read_seq` **KHÔNG lùi** (2 thiết bị) |
| 18 | `POST /read` số **vượt** `last_message_seq` | kẹp về `last_message_seq` |
| 19 | Gửi tin → `last_read_seq` **của người gửi** tự nâng | unread của chính mình = 0 |
| 20 | `GET /unread-count` | bằng tổng phép trừ; **0 câu `COUNT(*)`** trên `chat_messages` (đếm truy vấn bằng Proxy) |
| 21 | **Không route nào** sửa `body` | grep 0 `@Patch`/`@Put` trên `/messages`; **và** DB: `mediaos_app` có **0** UPDATE cấp bảng trên `chat_messages`, column-GRANT đúng **4** cột |
| 22 | Đường đọc **không** lộ `seq` toàn cục | DTO không có khoá `seq`; có `roomSeq` |

Chạy: `bash scripts/lane-db-setup.sh chatbe2` → nạp env như §4.1 plan BE-1 → `bash harness/check.sh --lane-db=chatbe2`. Drop lane khi xong.

**Bằng chứng RED — ĐÃ CHẠY THẬT (vá tạm → đo → hoàn nguyên):**

| Vá tạm | Kết quả đo |
| --- | --- |
| `assertMessageAccess` viết theo kiểu 2 BƯỚC (tra tồn tại trước, ném thông điệp khác) | ĐỎ ca 1 |
| `clampReadCursor` trả thẳng `wanted` (bỏ chỉ-tiến + kẹp trần) | ĐỎ ca 17+18 |
| Bỏ bước tra `clientMessageId` trước khi cấp `room_seq` | ĐỎ ca 5 |
| Thêm bản sao `activeMembershipJoin` ở file thứ hai | ĐỎ ca 14 (BE-1, đã mở rộng) |

⚠️ **Bẫy fixture đã vấp và đã vá:** gieo phòng thẳng bằng SQL kèm `room_code` mà không nâng counter ⇒ vi phạm bất biến của `s7-chat-db1-invariants` ("current_value không thấp hơn số mã đã cấp") khi hai spec chạy chồng lấn trong CÙNG lane DB. Bất biến đó ĐÚNG — lối vá là **mở lối gieo có kiểm soát** (`syncRoomCounter`), không phải nới bất biến.

⚠️ **Không `| head` khi chạy vitest:** pipe đóng sớm giết tiến trình TRƯỚC `afterAll` ⇒ tenant rác ở lại lane DB và làm spec bất biến đỏ ở lần chạy sau, trông y hệt lỗi sản phẩm.

---

## 5. Definition of Done

- [x] `assertMessageAccess` nằm **cùng file** `chat-access.service.ts`, dùng chung predicate với `assertMember`; ca test 14 của BE-1 mở rộng phủ nó
- [x] 404 của cả 3 route `/messages/:id/*` **không phân biệt được**
- [x] `room_seq` cấp trong CÙNG tx, liên tục, không lỗ kể cả khi gửi trùng `clientMessageId`
- [x] Gửi idempotent theo `clientMessageId` (bắt 23505 ĐÚNG constraint, retry ngoài tx)
- [x] Con trỏ `beforeSeq` XOR `afterSeq`, `limit ≤ 100`, **0 chỗ dùng `offset`**
- [ ] ⚠️ Ô này TỪNG đánh dấu xong SAI: vị từ `visible_from_seq` chỉ có ở `listMessages`, **thiếu ở 5 đường đọc khác** — FULL gate bắt (xem §6)
- [x] Thu hồi: hằng số 15 phút **một chỗ**; `body: null` che ở SERVER; `file_links` gỡ bằng **soft delete**
- [x] Ghim ≤ 20, tin `system`/đã-thu-hồi không ghim/thu hồi được
- [x] `/read` chỉ tiến + kẹp trần; người gửi tự nâng con trỏ trong cùng tx
- [x] `/unread-count` bằng phép trừ, **không** `COUNT(*)`
- [x] Contracts: `roomSeq` thay `seq`, `body` nullable, `clientMessageId` bắt buộc
- [x] Audit đúng 2 hành động (recall/pin), **không** dòng nào chứa `body`
- [x] Regen route census (+8 route) — tất cả gated, 0 phán quyết mới
- [x] 22 ca RED-trước xanh trên `LANE_DB` + 3 bằng chứng RED
- [x] `harness/check.sh --lane-db=chatbe2`: **api 466/466 file chạy · 4 spec CHAT xanh · 6 package FE/contracts xanh** · secret-literals · lint · typecheck · migration-no-drop xanh
- [ ] ⚠️ Còn **1 đỏ KHÔNG thuộc CHAT**: `task-recon-grants.int-spec.ts` ném ở `afterAll` → `cleanupTenants` (`seed.ts:670`, FK `audit_logs_actor_user_id_fkey`). Chạy CÔ LẬP: 30/30 xanh. Đúng lớp đua đã ghi chú ngay trong helper (outbox worker còn sống ghi thêm `audit_logs` giữa lần quét và `DELETE users`). Helper CÓ vòng thử-lại cho `DELETE companies` nhưng KHÔNG có cho `DELETE users` — đó là chỗ vỡ. `test/helpers/**` NGOÀI `paths` của WO này ⇒ ghi nợ, không tự sửa
- [x] FULL gate (security-reviewer + silent-failure-hunter) — **ĐÃ chạy 2026-08-02** trên diff hợp nhất `4c5c2da6..54b4d8cd` (cả BE-1 lẫn BE-2). Kết quả + phần đã vá / còn nợ: §6
- [x] lane DB `mediaos_chatbe2` drop sau khi xong

---

## 6. FULL gate BE-1 + BE-2 (2026-08-02)

Chạy 2 lane độc lập trên diff hợp nhất `4c5c2da6..54b4d8cd` (17 file code + 3 int-spec).
Verdict: **security-reviewer PASS** (0 CRIT · 0 HIGH) · **silent-failure-hunter BLOCK** (1 HIGH).
Hai lane không mâu thuẫn dữ kiện — lane security không soi trục nguyên-tử/đồng-thời.

### 6.1 ĐÃ VÁ trong commit này

| Mức | Vấn đề | Cách vá |
| --- | --- | --- |
| HIGH | `last_read_seq` clamp ở JS + ghi GÁN ĐÈ ⇒ hai `/read` đồng thời kéo con trỏ **LÙI** (SPEC-15 §13.2 · plan §1.6 đều ghi rõ phải `GREATEST` trong SQL) | `advanceLastReadSeq` — `GREATEST(last_read_seq, LEAST($wanted,$ceiling))` ngay trong câu UPDATE, `RETURNING` số thật; xoá `clampReadCursor` (hàm thuần KHÔNG giữ nổi bất biến này) |
| MED | Trần ghim 20 là TOCTOU (`countPinned` → `setPinned` không khoá) | `lockRoom()` = `SELECT … FOR UPDATE` trước khi đếm (KHÔNG mượn `allocateRoomSeq` — nó tăng `last_message_seq`, sinh lỗ `room_seq`) |
| MED | Ghim **bất khả thi trong DM**: `direct` luôn role `member` + cấm đổi vai trò ⇒ `/pin` luôn 403 dù CHAT-SCREEN-004 vẽ tin ghim cho mọi loại phòng | `requirePinAuthority` = admin phòng **HOẶC** phòng `direct` |
| MED | `recall`/`pin`/`unpin` thiếu `assertNotArchived` ⇒ phòng "chỉ đọc" vẫn kiểm duyệt được | Thêm cả 3, ĐẶT TRƯỚC nhánh idempotent |
| MED | `memberUserIds` không có trần (mọi role đều có `create:chat-room`) ⇒ cạn tài nguyên bằng tài khoản hợp lệ | `.max(200)` ở contracts |
| MED | `resurrectDirect` un-delete phòng + kích hoạt lại thành viên **không audit** | `chat.room.direct_restored` (cột `action` là text tự do — KHÔNG cần migration) |

Test: ca 23 (đua `/read` 2 giao dịch chồng nhau) · ca 24 (ghim trong DM) · ca 25 (phòng lưu trữ chặn cả 3 route kiểm duyệt) · ca 26 (>200 thành viên → 400).
**Bằng chứng RED của ca 23:** bỏ `GREATEST`, con trỏ ra `2` thay vì `5` — test tuần tự KHÔNG phát hiện được lỗi này (code cũ đọc lại con trỏ trước khi ghi nên vẫn xanh).
`LANE_DB=mediaos_chatgate`: **59/59 xanh** (55 cũ + 4 mới) · typecheck 10/10 · lint 0 error.

### 6.2 CÒN NỢ — không vá ở đợt này (có lý do)

1. **`visible_from_seq` chỉ ở 1/6 đường đọc** (`listPinned`·`findMessageForDto`·`assertMessageAccess`·2 truy vấn unread thiếu) — CẢ HAI lane độc lập cùng chỉ ra. v1 cột luôn NULL nên chưa nổ; **thủng ngay khi `S7-CHAT-BE-5` ghi cột này**. ⇒ WO riêng, CHẶN trước BE-5: chạm 5 truy vấn + cần test khi cột có giá trị thật, nhét chung vào commit vá sẽ phình diff vùng crown.
2. **Cặp gate của `pin`/`unpin` không kèm `view:chat-room`** (route trả DTO có `body`) — hạ xuống LOW: `RequirePermission` chỉ mang MỘT cặp, ép 2 cặp phải sửa `PermissionGuard` + shape route-census (kéo cả vùng crown vào); và muốn rút body thì phải **biết trước `messageId` UUID**, mà đường lấy id chính là cặp `view:chat-room` kẻ đó không có. Xem lại nếu guard có ngày hỗ trợ nhiều cặp.
3. **Thiếu test deny theo CẶP QUYỀN** (mọi chủ thể test đều được cấp đủ 8 cặp; chỉ deny-path *membership* được phủ) — hạ cặp của một route ghi sẽ KHÔNG làm đỏ gì. Nên thêm `chat.permissions.spec.ts` đóng đinh route→cặp như `tasks.permissions.spec.ts`.
4. LOW còn mở: `findRoomById` (0 caller, comment "KHÔNG lọc membership" — mồi cho BE-3..7) · `BODY_INVALID`/`EDIT_UNSUPPORTED` 0 caller · `listMembers`/`listPinned`/`listRoomsForUser` không LIMIT (nổ khi BE-5 đồng bộ thành viên dẫn xuất cả phòng ban) · `MESSAGE_NOT_FOUND` ra 2 mã HTTP (404 và 422) · `sendMessage` dựng DTO ở tx THỨ HAI (bị bớt khỏi phòng giữa 2 tx → 404 dù tin đã ghi) · nhánh idempotent của `recall` chạy TRƯỚC `assertCanRecall` (200 không xứng đáng, nhưng `body` đã bị che `null` nên không rò gì).

### 6.3 Ghi nhớ vận hành

3 int-spec CHAT gate bằng `describe.skipIf(!LANE_DB)`. Không có `LANE_DB` thì `pnpm test` báo **55 skipped, exit 0** — xanh-giả 100%. CI có `LANE_DB=mediaos` (`api.yml:221`) nên chạy thật. Verify tay PHẢI qua `harness/check.sh --lane-db`.

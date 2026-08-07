# Kế hoạch thi công `S8-CHAT-UX-BE-1` — tuỳ chọn per-phòng: ghim · tắt thông báo · đánh dấu chưa đọc

> Vùng **VÀNG**. Gate = **LIGHT** (`typescript-reviewer` + `quality-gate`).
> Nguồn sự thật: `SPEC-15 §5.1b · §9a · §10 (CHAT-FUNC-015/016/017) · §12 (CHAT-ERR-021) · §13.2` ·
> `API-13 §5.1b` · `CHAT-DEC-015`. Nền DB: mig `0543` (S8-CHAT-UX-DB-1, đã land).
> Ngày lập: 06/08/2026.

---

## 0. ⛔ ĐÍNH CHÍNH MỘT VA CHẠM MÃ CỦA `API-13` — đo trước khi viết dòng code nào

`API-13 §5.1b` (do `S8-CHAT-UX-DOC-1` seed) cấp cho wave S8 dải `CHAT-API-018a…023`. Dải đó **đã bị
chiếm** từ wave S7:

| Mã | Chủ đang giữ (ĐÃ SHIP) | Chủ mới mà DOC-1 gán |
| --- | --- | --- |
| `CHAT-API-018a` | `GET /chat/oversight/rooms` — API-13 dòng 203 | `PUT /chat/rooms/{id}/pin` — dòng 164 |
| `CHAT-API-018b` | `GET /chat/oversight/rooms/{id}` — dòng 204 | `DELETE /chat/rooms/{id}/pin` — dòng 165 |
| `CHAT-API-019` | `GET /chat/oversight/audit` — dòng 206 | `PUT /chat/rooms/{id}/mute` — dòng 166 |

Bên S7 **không dời được**: bốn literal `'018a' | '018b' | '018c' | '019'` là giá trị của
`CHAT_OVERSIGHT_ENDPOINT` (`chat-oversight.audit.ts:25-28`) và chúng đi thẳng vào
`audit_logs.metadata.endpoint` — dòng audit đã ghi trên PROD không viết lại được.

⇒ **Bên S8 dời.** Dải trống (grep toàn repo `CHAT-API-02[4-9]` = 0 kết quả): ghim → **`CHAT-API-024a/024b`**,
tắt thông báo → **`CHAT-API-025`**. `CHAT-API-020` (đánh dấu chưa đọc) · `021a-c` (avatar) · `022a/b`
(cảm xúc) · `023` (typing — **đã ship** ở RT-1) **không va**, giữ nguyên. WO này sửa `API-13 §5.1b` + bảng
mã lỗi cho khớp; đó là toàn bộ phần docs của WO.

_(memory `wo-seed-hand-measurements-can-be-incomplete` — số trong WO/doc seed phải đo lại, không tin sẵn.)_

---

## 1. Điểm xuất phát (ĐO THẬT 06/08/2026)

| Thứ | Trạng thái đo được |
| --- | --- |
| `chat_room_members.pinned_at` · `marked_unread_at` | **CÓ** từ mig `0543` (A) + `GRANT UPDATE (pinned_at, marked_unread_at)` mục (C) |
| `chat_room_members.muted_until` | **CÓ CỘT + CÓ GRANT** từ `0538:258` — nhưng **0 đường ghi** trong toàn `apps/api/src` (grep `mutedUntil` chỉ ra 2 hit: schema + đường ĐỌC) |
| Đường **ĐỌC** `muted_until` | **ĐÃ ĐÚNG SẴN**: `ChatAudienceReader.stillReceiving()` (`chat-audience.reader.ts:39`) có vế `OR(isNull(mutedUntil), lte(mutedUntil, now()))`, dùng chung bởi `resolveMentionRecipients` + `resolveDirectRecipient` |
| `unreadCount` | tính bằng `unreadSeqExpr()` = phép trừ `last_message_seq − last_read_seq`, **không** tham chiếu `muted_until` ⇒ tắt thông báo **vốn đã** không đụng badge |
| Tập cột UPDATE-được của `chat_room_members` | 7 cột (pin bởi khối VERIFY `0543` mục (E)(1)): `last_read_at · last_read_seq · left_at · marked_unread_at · muted_until · pinned_at · role` |

> **Hệ quả quan trọng cho `done_when` #4:** lỗ của v1 là **NỬA đường ghi**, không phải nửa đường đọc.
> Phần "chứng minh đường phát noti thật sự bỏ qua phòng đã tắt" (memory `ui-promises-backend-never-reads`)
> vì thế là **viết test cho hành vi đã có**, không phải sửa `ChatAudienceReader`. Sửa nó là rủi ro thuần.

---

## 2. Bốn quyết định thi công

### 2.1 File MỚI `chat-room-prefs.service.ts`, KHÔNG nhồi vào `chat-rooms.service.ts`

`chat-rooms.service.ts` đang **497 dòng**; thêm 3 hành động + docblock sẽ vượt ngưỡng 400 của
CLAUDE.md §5. Ba hành động này cũng khác chất với phần còn lại của `ChatRoomsService`: chúng là **tuỳ
chọn CÁ NHÂN trên hàng membership của chính actor**, không phải thao tác trên phòng dùng chung — không
có `requireRoomAdmin`, không có `assertManualEdit`, không phát WS cho cả phòng.

### 2.2 Trần 10 ghim: khoá advisory theo NGƯỜI, không đếm-rồi-ghi ở JS

Đếm ở JS rồi UPDATE là đường đua kinh điển: hai request song song cùng đọc 9, cùng ghi ⇒ 11.
Một subquery `count(*) < 10` **trong chính câu UPDATE cũng không đủ**: hai transaction ghi **hai hàng
khác nhau** nên không đụng khoá hàng nào, dưới READ COMMITTED cả hai đều thấy ảnh chụp 9.

⇒ Dùng **`pg_advisory_xact_lock(classid, hashtext(companyId||':'||userId))`**, khuôn đã qua gate ở
`task-file.service.ts:53,270`. `xact`-level (không phải session) là **bắt buộc** trên PgBouncer
transaction-mode. `classid` mới `0x5801` — đặt tên hằng thay vì `hashtext('chuỗi tại chỗ')` để module
sau không va (không gian khoá advisory là TOÀN CỤC trong một database).

Khoá **chỉ ở nhánh GHIM**. Bỏ ghim làm giảm số đếm, không có trần nào để phá.

### 2.3 Đánh dấu chưa đọc = cột RIÊNG, và điểm XOÁ cờ nằm trong `advanceLastReadSeq`

`marked_unread_at` **KHÔNG** được hiện thực bằng cách lùi `last_read_seq` (SPEC-15 §13.2 · CHAT-ERR-018).
Cờ được xoá ở **một chỗ duy nhất**: cùng câu UPDATE của `advanceLastReadSeq` (CHAT-API-014) — đặt
`markedUnreadAt: null` **vô điều kiện**, kể cả nhánh con trỏ không tiến. Lý do: "mở phòng ⇒ về NULL"
(§5.1b) nói về hành vi MỞ, không về việc con trỏ có tiến hay không; người đánh dấu chưa đọc rồi mở lại
ngay (chưa có tin mới) vẫn phải thấy cờ tắt.

### 2.4 KHÔNG audit ba hành động này

`CHAT_AUDIT` cố ý chỉ có 3 hành động tin nhắn, và `chat-messages.service.ts` đã ghi rõ vì sao gửi/đọc tin
không audit: `audit_logs` là bảng append-only DÙNG CHUNG. Ghim/tắt thông báo/đánh dấu chưa đọc là **tuỳ
chọn hiển thị của một người trên chính hàng của họ** — không tác động lên dữ liệu của ai khác, đảo ngược
được bằng một cú bấm. Audit chúng là nhấn chìm bảng điều tra bằng nhiễu. (Cùng lý do `CHAT-API-023`
typing = 0 audit.)

---

## 3. Bề mặt thay đổi

| Tệp | Việc |
| --- | --- |
| `packages/contracts/src/chat.ts` | `chatRoomSchema` += `pinnedAt` · `mutedUntil` · `markedUnreadAt` (**cả ba `.nullable().optional()`** — memory `server-masking-needs-optional-fe-schema`); + `chatMuteRoomSchema` |
| `apps/api/src/chat/chat.errors.ts` | += `ROOM_PIN_LIMIT` (CHAT-ERR-021) · `MUTE_UNTIL_PAST` |
| `apps/api/src/chat/chat.mapper.ts` | `ChatRoomProjection` += 3 cột; `toChatRoomDto` map chúng |
| `apps/api/src/chat/chat-rooms.repository.ts` | += `lockUserPrefs` · `countPinnedRooms` · `setRoomPinned` · `setRoomMuted` · `setRoomMarkedUnread`; 3 cột vào `listRoomsForUser` |
| `apps/api/src/chat/chat-access.service.ts` | `ChatRoomAccess.membership` += `pinnedAt`/`mutedUntil`/`markedUnreadAt`, `room` giữ nguyên |
| `apps/api/src/chat/chat-room-prefs.service.ts` | **MỚI** — 3 hành động |
| `apps/api/src/chat/chat-rooms.controller.ts` | += 4 route (`PUT`/`DELETE /pin` · `PUT /mute` · `POST /unread`), mỗi route `@UseGuards(PermissionGuard)` + `@RequirePermission("view","chat-room")` |
| `apps/api/src/chat/chat-messages.repository.ts` | `advanceLastReadSeq` += `markedUnreadAt: null` |
| `apps/api/src/chat/chat.module.ts` | provider mới |
| `packages/web-core/src/lib/chat-api.ts` | 4 hàm mirror |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | **regen** (`ROUTE_CENSUS_WRITE=1`) — thêm route ⇒ `route-guard-coverage` ĐỎ nếu quên (memory `route-census-runtime-gate`) |
| `docs/API Design/API-13_CHAT_API_Design.md` | dời mã theo §0 |

**Không** migration · **không** cặp quyền mới (SPEC-15 §11 ghi rõ 7 tính năng S8 dùng lại đúng 10 cặp cũ)
· **không** đụng `SENSITIVE_CAPABILITY_ALLOWLIST`.

---

## 4. Thứ tự RED → GREEN

1. **RED-1 (chứng minh lỗ)** — `chat-room-prefs.service.spec.ts`: hôm nay không route nào ghi được
   `pinned_at`/`muted_until`/`marked_unread_at`. Chứng bằng **census route đã đóng băng** + grep đường ghi.
2. **RED-2 (deny-path)** — ghim/tắt/đánh dấu phòng KHÔNG thuộc ⇒ **404** (`CHAT_ERR.ROOM_NOT_FOUND`),
   không phải 403: 403 xác nhận phòng có thật (CHAT-ERR-001).
3. **RED-3 (trần)** — ghim thứ 11 ⇒ **409** `CHAT-ERR-021`; ghim lại phòng ĐÃ ghim ⇒ **200 idempotent**,
   KHÔNG tính thêm một suất.
4. **RED-4 (đua)** — 2 lệnh ghim song song ở phòng thứ 10 và 11 ⇒ đúng **một** thành công (int-spec, DB thật).
5. **RED-5 (noti)** — phòng đã tắt: `resolveMentionRecipients`/`resolveDirectRecipient` trả **rỗng**,
   `unreadCount` của chính phòng đó **vẫn tăng**. Hai vế trong **một** ca test, cạnh nhau.
6. **RED-6 (bất biến §13.2)** — sau `POST /unread`, `last_read_seq` **KHÔNG đổi**; sau `POST /read`,
   `marked_unread_at` về NULL.
7. GREEN theo bảng §3 → `pnpm --filter @mediaos/contracts build` + `web-core` build → typecheck → LIGHT gate.

---

## 5. Rủi ro đã biết

| # | Rủi ro | Chặn bằng |
| --- | --- | --- |
| 1 | Quên regen route census ⇒ CI đỏ ở WO sau | mục §3 + bước 7 |
| 2 | Thêm khoá **required** vào `chatRoomSchema` ⇒ mọi consumer `/chat/rooms` ăn ZodError | cả 3 khoá `.optional()` (bài học bàn giao `S7-SEC-ROLE2FA-UI-1`) |
| 3 | `stale contracts dist` ⇒ typecheck đỏ oan | build contracts + web-core trước typecheck |
| 4 | Ghi cột ngoài tập 7 cột GRANT ⇒ `42501` chỉ lộ trên DB thật | int-spec chạy trên `LANE_DB` |
| 5 | `mutedUntil` quá khứ ⇒ "tắt" mà không tắt gì | validate ở service: quá khứ ⇒ 422; `null` = bật lại (hợp lệ) |

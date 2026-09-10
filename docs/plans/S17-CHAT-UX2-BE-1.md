# S17-CHAT-UX2-BE-1 — micro-plan (DTO phòng v2)

> WO: `harness/backlog.mjs` › `S17-CHAT-UX2-BE-1` · zone 🟡 · gate **LIGHT + `silent-failure-hunter`**
> Nguồn sự thật: [SPEC-15 §15b](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §5.1d](<../API Design/API-13_CHAT_API_Design.md>) · CHAT-DEC-022/023/025
> Plan cấp wave: [S17-CHAT-UX2-WAVE.md](S17-CHAT-UX2-WAVE.md) §5 (BLOCKING 1 áp vào WO này)

## 0. Phạm vi — 4 việc, 0 migration, 0 cặp quyền, 0 sự kiện WS mới

| # | Việc | Nguồn |
| --- | --- | --- |
| A | `chatRoomSchema.lastMessage` — LATERAL tin cuối trong `listRoomsForUser`, che thu hồi + cắt excerpt Ở SERVER | CHAT-DEC-022 |
| B | `chatRoomSchema.peer` — chỉ phòng `direct`, avatar ký 1 lô/trang qua `resolveEmployeeAvatars`, strip `avatarUrl` khỏi WS | CHAT-DEC-023 |
| C | `chatRoomDetailSchema.createdByName` — thêm ở `getRoom` (CHAT-API-004) | CHAT-DEC-025 |
| D | `GET /chat/rooms/:id/files?kind=image\|file` — lọc Ở SQL, dùng CHUNG định nghĩa với `isImage` | §15b |

**Ngoài phạm vi (WO khác):** `CHAT-API-031` `/links` (BE-2) · mọi thứ FE (FE-1/3/4/5) · migration · bật module.

## 1. BLOCKING 1 (§13.4) — đường đọc MỚI phải qua `chat-visibility.ts`

LATERAL của (A) đọc `chat_messages` từ `chat-rooms.repository.ts` — file mà census **per-method** của
`chat-visibility.spec.ts` chưa quét (nó chỉ nằm trong khẳng định "không viết chuỗi thô
`visible_from_seq`", vốn cấm chuỗi thô nhưng KHÔNG đòi gọi helper ⇒ ratchet vẫn xanh dù đường đọc đã
thoát §13.4).

Vì vậy:

1. LATERAL gọi `visibleFromSeqColumn()` (dạng CỘT — câu list đã join sẵn `chat_room_members` của actor và
   KHÔNG có `visibleFromSeq` ở JS).
2. Thêm ca census **per-method cho `chat-rooms.repository.ts`** vào `chat-visibility.spec.ts`.
   ⚠️ Bộ lọc **không** dùng được `.from(chatMessages)` như 3 file kia — LATERAL đặt `chatMessages` trong
   một subquery, không phải `.from()` của câu ngoài. Lọc theo tham chiếu `chatMessages` trong thân method.
3. **CẤM** thêm tên vào `DOCUMENTED_EXCEPTIONS` (giữ đúng 2 phần tử).
4. testTask RED: gỡ lời gọi helper khỏi LATERAL ⇒ `chat-visibility.spec.ts` phải ĐỎ.

## 2. BLOCKING 2 (oversight) — không rò `lastMessage`/`peer` ra `/chat/oversight/**`

`chatOversightRoomSummarySchema` là schema ĐỘC LẬP có chủ ý. WO này **không đụng nó**, và thêm một unit
assert: schema đó KHÔNG có khoá `lastMessage`/`peer` — bắt được cả trường hợp một WO sau "dọn trùng lặp"
cho nó thừa hưởng `chatRoomSchema`.

## 3. Hợp đồng DTO (tất cả `.nullable().optional()` — 7 consumer đang chạy)

```text
lastMessage: { senderId, senderName: string|null, kind: 'text'|'file'|'system'|'recalled',
               excerpt: string|null, attachmentCount: number } | null
peer:        { userId, name: string|null, avatarUrl: string|null, isActive: boolean } | null  // chỉ `direct`
createdByName: string | null                                                                  // chỉ getRoom
```

Ràng buộc ngữ nghĩa `lastMessage` (mỗi vế một ca test):

- `kind` = `'text'` **THẮNG** khi tin có CẢ body LẪN đính kèm; `attachmentCount` **vẫn > 0** — hai trường
  không loại trừ nhau.
- `excerpt` ≤ **120**, cắt theo **grapheme** (không chẻ cụm tổ hợp/emoji), **strip** `\n` + ký tự điều
  khiển **TRƯỚC** khi cắt.
- `recalled` ⇒ `excerpt: null` (che ở server — SPEC-15 §13.6); `kind:'recalled'` thắng mọi vế khác.
- `senderName` **vẫn hiện** khi người gửi đã rời phòng / bị vô hiệu hoá (nhất quán roster CHAT-API-007a).
- Phòng chưa có tin ⇒ `lastMessage: null` (không phải object rỗng).

## 4. Thi công

### 4.1 contracts

- `chat.ts`: `chatRoomLastMessageSchema` · `chatRoomPeerSchema` → 2 khoá mới vào `chatRoomSchema`;
  `createdByName` vào `chatRoomDetailSchema`; `kind` vào `listChatRoomFilesQuerySchema`.
- `realtime.ts`: `wsChatRoomEventSchema.room` **`.extend({ peer: … .omit({avatarUrl:true}) })`** —
  `.omit()` KHÔNG với tới khoá LỒNG. Ca ÂM bắt buộc: parse room có `peer.avatarUrl` ⇒ khoá biến mất.
- Ratchet: parse payload CŨ (không có 3 khoá) vẫn qua.

### 4.2 repository (`chat-rooms.repository.ts`)

- `listRoomsForUser` += `leftJoinLateral` (drizzle 0.45.2 có API này) tin cuối `ORDER BY room_seq DESC
  LIMIT 1` — **1 câu SQL cho N phòng**, đi trên `idx_chat_messages_room_seq (company_id, room_id, room_seq DESC)`.
- `peer` = LATERAL thứ hai trên `chat_room_members × users × employee_profiles`, chỉ khi
  `room_type='direct'` và `user_id <> actor`. Join `employee_profiles` phải có `deleted_at IS NULL`
  (partial unique ⇒ thiếu vế này là NHÂN BẢN hàng — `partial-unique-index-makes-join-duplicate`).
- Row mang `employeeId` + `avatarRaw` **THÔ** (hậu tố `Raw`: cột đa-người-ghi, KHÔNG lên DTO).
- `findRoomCreatedByName` cho (C).

### 4.3 `isActive` của peer — định nghĩa

`users.status = 'active' AND users.deleted_at IS NULL` **AND** (không có hồ sơ nhân sự nào ⇒ theo user;
có hồ sơ ⇒ phải còn ít nhất một hồ sơ `active` chưa xoá mềm). Hai vế vì done_when đòi CẢ HAI ca:
**tài khoản khoá** (`users.status`) và **nhân sự nghỉ** (`employee_profiles.status`) — đăng nhập chỉ gate
`users.status`, KHÔNG gate trạng thái nhân sự (`chat-derived-rooms-sync.service.ts:209`).

### 4.4 mapper + `chat-preview.ts` (mới, hàm THUẦN)

- `buildLastMessagePreview(row)` — chỗ DUY NHẤT quyết `kind`, che thu hồi, strip + cắt grapheme.
- `toChatRoomDto(row, unread?, prefs?, avatarUrl?, extra?)` — tham số mới ở **CUỐI**, không chèn giữa:
  ba spec dựng service bằng THỨ TỰ THAM SỐ.

### 4.5 service

- `listRooms`: sau `listRoomsForUser`, ký avatar peer **MỘT LÔ** qua
  `AvatarPresignService.resolveEmployeeAvatars`, truyền `tx` của chính vòng (`withTenant` lồng nhau TREO
  trên PgBouncer transaction-mode). Spy đếm **1 lần** cho N DM.
- `getRoom`: += `createdByName`.
- `listRoomFiles`: chuyển `query.kind` xuống repo.

### 4.6 (D) một định nghĩa "là ảnh"

`chat-file.constants.ts` giữ `isImageMimeType` (JS) **và** thêm vị từ SQL ngay cạnh nó, cùng docblock:
`lower(mime_type) LIKE 'image/%'` ⟷ `mimeType.toLowerCase().startsWith('image/')`. `LIKE 'image/%'` trần
(không `lower`) **lệch** với JS ở mime viết hoa ⇒ `isImage: true` mà `kind=image` lọc mất — đúng lớp "hai
bản sao của một luật". `kind` ngoài `{image,file}` ⇒ **400 `VALIDATION-ERR-001`** (Zod pipe), KHÔNG 422.
`kind` vắng ⇒ trả TOÀN BỘ, giữ nguyên hành vi CHAT-API-017 hiện tại.

## 5. Test

| Tầng | Ca |
| --- | --- |
| contracts spec | 3 khoá mới KHÔNG required (parse payload cũ) · WS strip `peer.avatarUrl` (ca ÂM) · oversight summary không có `lastMessage`/`peer` |
| unit `chat-preview.spec.ts` | text-thắng-file · `attachmentCount` > 0 cùng lúc · recalled ⇒ null · strip `\n`+control TRƯỚC cắt · grapheme không chẻ (emoji ZWJ/cờ) · ≤120 · rỗng ⇒ null |
| unit `chat-visibility.spec.ts` | census per-method MỚI cho `chat-rooms.repository.ts` |
| unit `chat-file.constants.spec.ts` | vị từ SQL ⟷ JS đồng ý trên bảng mime (kể cả `IMAGE/PNG`) |
| int-spec `chat-s17-be1-*.int-spec.ts` | EXPLAIN: 1 câu, plan có Index Scan `idx_chat_messages_room_seq`, **KHÔNG** assert `idx_scan` (`pg-planner-index-assert-trap`) · masking 4 `kind` · excerpt 500 ⇒ ≤120 · peer chỉ direct · ký 1 lô (spy) · `isActive` khoá/nghỉ · non-member **404** · cross-tenant 0 hàng · `kind=image/file/lạ(400)` + ca ALLOW `toBe(200)` |

## 6. Bẫy đã ghim (memory)

`server-masking-needs-optional-fe-schema` · `ws-payload-narrower-than-rest-dto` · `pg-planner-index-assert-trap` ·
`partial-unique-index-makes-join-duplicate` · `clamp-must-be-sql-not-js` · `tests-can-pin-a-hole-open` ·
`deny-cases-vacuous-without-allow-case` · `allow-counter-case-not-403-lets-500-through` ·
`ui-promises-backend-never-reads` · `apifetch-drops-pagination-bare-array`

## 7. Đích hội tụ

`bash harness/check.sh --lane-db=s17be1` XANH; typecheck contracts/web-core/api xanh; ratchet
`chat-realtime-structure.spec.ts` (0 `@SubscribeMessage`) và ESLint one-socket-file vẫn xanh.

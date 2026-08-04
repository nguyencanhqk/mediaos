# S7-CHAT-FE-2 — Trang `/chat` full-screen (CHAT-SCREEN-001 · 003 · 004)

> Kế hoạch thi công. Nguồn sự thật nghiệp vụ: `docs/spec/SPEC-15 CHAT.md` §9 · §13 · §14 · §20.
> Nền đã có: `S7-CHAT-FE-1` (contracts · `chatApi` · socket dùng chung · `useChatStore` · `useChatRealtime`).
> Backend đã lên master: `S7-CHAT-BE-1..7` (mig 0538 · 0539 · 0540 · 0541).

---

## 0. ĐO TRƯỚC KHI LÀM — 4 sự thật đã kiểm chứng trên hệ thật

Bốn mục dưới đây đo bằng DB dev + đọc code BE **trước** khi viết dòng nào. Chúng đổi phạm vi giao hàng
của WO, nên đứng ở đầu tài liệu chứ không nằm trong phần "rủi ro".

### 0.1 🛑 CHẶN MỘT PHẦN — nhân viên thường **KHÔNG upload được tệp đính kèm**

`SPEC-15 §13.5` bước 1 là "client xin presign upload (FOUNDATION Files)". Đường đó là
`POST /foundation/files/upload` + `POST /foundation/files/:id/confirm`, cả hai gate
`@RequirePermission("upload", "foundation-file")` (`apps/api/src/foundation/files/files.controller.ts:57,70`).
CHAT **không có** route presign riêng (soát toàn bộ `apps/api/src/chat/*.controller.ts`: 0 route upload).

Đo trên DB dev (`role_permissions ⋈ permissions`):

| Vai | có `upload:foundation-file` |
| --- | --- |
| `SA` · `company-admin` · `QUẢN LÝ CẤP CAO` | ✅ |
| `employee` · `hr` · `manager` | ❌ |

Nguồn: mig `0435:376-380` cấp `foundation-%` **chỉ** cho role `…0001` (company-admin); không migration nào
khác chạm `foundation-file` (soát cả literal lẫn mẫu `LIKE 'foundation-%'`).

⇒ **CHAT-FUNC-007 chết với đa số người dùng.** Đây đúng lại lỗ đã gặp và đã đóng ở avatar
(memory `avatar-own-scope-presign-wrapper`: `MeAvatarController` gate `update:avatar` gọi thẳng
`FileService` — gate `*:foundation-file` nằm ở **controller**, `FileService` không gate).

**Quyết định:**

- FE-2 **vẫn dựng trọn** đường đính kèm (chọn tệp · tiến độ · lỗi · gửi kèm `fileIds` · render ảnh/tệp).
- Nút đính kèm **gate `useCan("upload","foundation-file")`** — không có quyền thì **không hiện nút**, không
  hiện nút chết rồi để server 403 (memory `ui-promises-backend-never-reads`).
- Mở WO backend **`S7-CHAT-BE-8`** (wrapper presign own-scope cho CHAT, sao khuôn `MeAvatarController`:
  `POST /chat/files/upload-url` + `POST /chat/files/:id/confirm`, gate `send:chat-message`). FE-2 chỉ phải
  đổi **2 lời gọi** trong `chat-upload.ts` khi WO đó land — không đụng component nào.
- Ghi vào `done_when` của FE-2: đính kèm nghiệm thu được bằng tài khoản `company-admin`; nhân viên thường
  chờ `S7-CHAT-BE-8`.

### 0.2 `modules.CHAT.is_active = false` — nhưng cổng module **không** chạy ở FE

Đo: `SELECT is_active FROM modules WHERE module_code='CHAT'` → `false` (mig `0538:851` còn ĐÓNG ĐINH điều
đó bằng verify block). Nhưng `buildSessionFromStore()` (`apps/app/src/layouts/protected/ProtectedRoute.tsx:44`)
trả **`modules: []` cứng**, và `evaluateRouteFromStore` bỏ `moduleCode` khi mảng rỗng ⇒ nhánh
`SHOW_DISABLED`/`SHOW_404` **không bao giờ chạy** cho bất kỳ route nào.

⇒ `/chat` **mở được ngay** dù module chưa bật. Đây là hiện trạng của cả app, KHÔNG phải lỗ do WO này mở.
Vẫn khai `moduleCode: "CHAT"` trong RouteMeta để khi FE nối `modules` thật thì cổng tự có hiệu lực.
Không tự ý bật module ở DB: WO cuối wave mới bật (mig 0538 verify sẽ đỏ nếu bật sớm).

### 0.3 `room_seq` liên tục từ 1 ⇒ "còn tin cũ hơn" là phép so, không cần cờ

`room_seq` liên tục từ 1 trong từng phòng (mig `0539`), và v1 `visible_from_seq` **luôn NULL** — thành viên
đọc TOÀN BỘ lịch sử (§13.4 làm rõ 03/08, mục 2: không writer nào của v1 set cột này).

⇒ `hasMoreOlder(room) = messages[0].roomSeq > 1`. Không cần cờ `hasMore` từ server, không cần đoán theo
"trang trả về ít hơn limit" (cách đó sai khi trang cuối vừa đúng `limit`).

### 0.4 Trần 200 tin/phòng của store **cắt mất** lịch sử vừa cuộn ngược

`MAX_MESSAGES_PER_ROOM = 200` + `insertMessage` cắt `next.slice(next.length - MAX)` ⇒ nạp trang cũ thứ 5
rồi có **một** tin mới tới là danh sách bị cắt về 200 tin cuối ⇒ **người dùng đang đọc lịch sử bị nhảy phắt
xuống đáy**. Và `insertMessage` còn `return list` sớm khi danh sách đã đầy và tin cũ hơn mọi tin đang giữ
(dòng 216) ⇒ trang cũ thứ 2 trở đi **rơi im lặng**.

⇒ FE-2 phải sửa store, không phải né bằng buffer cục bộ ở component (buffer thứ hai = `chat:message-recalled`
không với tới ⇒ tin đã thu hồi vẫn hiện nguyên nội dung ở phần cuộn ngược). Xem §3.

---

## 1. Phạm vi

**Trong:** CHAT-SCREEN-001 (trang 3 cột) · CHAT-SCREEN-003 (hộp thoại tạo nhóm / mở DM) ·
CHAT-SCREEN-004 (bảng thông tin phòng: thành viên · tin ghim · rời/lưu trữ) · gửi tin · gửi tệp/ảnh ·
trả lời · ghim/bỏ ghim · thu hồi · đã xem · 8 trạng thái UI §14 · i18n `chat` (vi) · light + dark.

**Ngoài (đúng WO khác, KHÔNG làm ở đây):**

| Việc | WO |
| --- | --- |
| Panel nổi toàn hệ thống · badge header · lối vào sidebar | `S7-CHAT-FE-3` |
| Màn tìm kiếm tin (`/chat/search`) · **tab "Tệp"** của bảng thông tin phòng | `S7-CHAT-FE-4` |
| Màn quản trị đọc-vượt + nhật ký | `S7-CHAT-FE-5` |
| Presign upload own-scope cho CHAT | `S7-CHAT-BE-8` (mở mới — §0.1) |

⚠️ Tab "Tệp" thuộc FE-4 vì `chatApi` **cố ý chưa mirror** `GET /chat/rooms/:id/files` (FE-1 có test đóng
đinh điều đó). Bảng thông tin phòng của FE-2 có **2 tab**: Thành viên · Tin ghim. Tab Tệp do FE-4 chèn.

---

## 2. Cây tệp

```text
apps/app/src/routes/chat/
  constants.ts              CHAT_PATH · CHAT_ROUTE_META · CHAT_ENGINE_PAIRS · hằng UI
  ChatPage.tsx              vỏ 3 cột + chọn phòng + trạng thái rỗng/không-quyền
  ChatPage.spec.tsx
apps/app/src/components/chat/
  RoomListPanel.tsx         cột 1 — tìm, lọc lưu trữ, hàng phòng, badge chưa đọc
  RoomListPanel.spec.tsx
  ConversationPanel.tsx     cột 2 — header + danh sách tin + ô soạn
  ConversationPanel.spec.tsx
  MessageList.tsx           cuộn ngược beforeSeq · giữ neo cuộn · đánh dấu đã đọc
  MessageList.spec.tsx
  MessageBubble.tsx         văn bản thuần · thu hồi · đính kèm · trích dẫn trả lời · menu hành động
  MessageBubble.spec.tsx
  MessageComposer.tsx       soạn · đính kèm · trả lời · gửi lại
  MessageComposer.spec.tsx
  RoomInfoPanel.tsx         cột 3 — 2 tab (thành viên · ghim) + rời/lưu trữ
  RoomInfoPanel.spec.tsx
  CreateRoomDialog.tsx      CHAT-SCREEN-003
  CreateRoomDialog.spec.tsx
  ConnectionBanner.tsx      dải "đang kết nối lại" / "chế độ bù"
  chat-format.ts(+spec)     tên hiển thị phòng · nhóm ngày · cỡ tệp · "đã xem bởi"
  chat-upload.ts(+spec)     4 pha upload → fileId (§0.1)
  use-chat-conversation.ts  hook: nạp trang đầu/cũ hơn · gửi · đánh dấu đọc
apps/app/src/i18n/locales/vi/chat.ts
```

Sửa file có sẵn (khối additive):
`apps/app/src/stores/chat.store.ts` (§3) · `apps/app/src/router.tsx` (đăng ký route) ·
`apps/app/src/i18n/index.ts` (đăng ký namespace).

---

## 3. Sửa store — 3 điểm, đều RED-proof trước khi vá

| # | Sửa | Vì sao (§0.4) |
| --- | --- | --- |
| S1 | `prependOlderMessages(roomId, older[])` — chèn ĐẦU, dedupe theo `id`, **không** cắt trần | trang cũ thứ 2 trở đi đang rơi im lặng vì `insertMessage` `return list` sớm khi đầy |
| S2 | `insertMessage` cắt về `max(MAX_MESSAGES_PER_ROOM, list.length)` chứ không phải trần cứng | một tin mới KHÔNG được vứt phần lịch sử người dùng vừa chủ động nạp |
| S3 | `trimRoomHistory(roomId)` — cắt về 200 tin cuối; gọi khi **rời khỏi** phòng đang xem | trả lại trần RAM sau khi cuộn ngược; giữ nguyên lý do tồn tại của `MAX_MESSAGES_PER_ROOM` |

Trần lịch sử cứng `MAX_HISTORY_PER_ROOM = 1000`: chạm trần thì **ngừng mời "tải thêm"** và nói rõ ở UI —
KHÔNG âm thầm cắt (cắt là thứ làm vỡ neo cuộn).

`applyMessageRecalled` / `applyReadEvent` không phải sửa: lịch sử nằm trong CÙNG `messagesByRoom` nên
sự kiện thu hồi tới được cả phần cuộn ngược. Đây chính là lý do không dùng buffer cục bộ.

---

## 4. Ba cột — hợp đồng từng phần

### 4.1 Cột 1 — danh sách phòng

- Nguồn: `useChatStore` (`roomOrder` + `roomsById`). KHÔNG gọi `listRooms` lần nữa: `useChatRealtime` ở
  `ProtectedShell` đã nạp + `syncRoomList` sẵn.
- Rổ **lưu trữ** là truy vấn RIÊNG (`listRooms({archived:true})` → `syncRoomList(rooms, true)`), vì
  `listRooms()` không tham số chỉ trả phòng CHƯA lưu trữ (store docblock dòng 341).
- Tên phòng: `direct` không có tên (`name` nullable) ⇒ dựng từ thành viên còn lại — cần `members`. Danh
  sách phòng KHÔNG kèm members ⇒ hiển thị `roomCode` làm nhãn dự phòng cho tới khi mở phòng, rồi cache
  tên đã dựng theo `roomId` trong state của trang. Ghi rõ giới hạn này chứ không bịa tên.
- Lọc client-side theo chuỗi tìm (tên/roomCode) — KHÔNG gọi `/chat/search` (đó là FE-4, và nó tìm **nội
  dung tin**, không phải tên phòng).
- Badge chưa đọc: `room.unreadCount` do SERVER tính. Client tuyệt đối không tự trừ.

### 4.2 Cột 2 — hội thoại

| Việc | Cách |
| --- | --- |
| Nạp trang đầu | `getMessages(roomId, {})` → `applyIncomingMessage` từng tin |
| Cuộn ngược | chạm đỉnh + `oldest.roomSeq > 1` → `getMessages(roomId,{beforeSeq: oldest.roomSeq})` → `prependOlderMessages` |
| Giữ neo cuộn | đo `scrollHeight` TRƯỚC khi prepend, sau khi render đặt `scrollTop += (scrollHeight mới − cũ)` |
| Tin mới tới | chỉ auto-cuộn xuống khi đang **ở gần đáy** (≤ 80px); ngược lại hiện nút "có tin mới" |
| Đánh dấu đã đọc | ở gần đáy + tab đang hiển thị → `markRead({seq: lastRoomSeq})`, chống dội bằng 400ms và chỉ gửi khi seq **tăng** |
| Gửi | `clientMessageId` sinh **một lần** lúc bắt đầu soạn (`createClientMessageId`), `applyOptimisticSend` → POST → `resolvePendingSend`; lỗi ⇒ `failed`, giữ nguyên nội dung, nút **Gửi lại** dùng **lại đúng** khoá cũ |
| Thu hồi | `recallMessage`; nút hiện khi (mình gửi **và** ≤15 phút) **hoặc** (`myRole==='admin'` **và** phòng `group`) — mirror `chat-message-rules.ts`, cổng thật ở server |
| Ghim | `pinMessage`/`unpinMessage` + invalidate `chatKeys.rooms.pinned(roomId)`; trần 20 do server ép, 409 → thông điệp riêng |
| Đã xem bởi | `members[].lastReadSeq >= message.roomSeq`, trừ chính mình — dẫn xuất, không bảng riêng (§13.2) |

**Render nội dung: VĂN BẢN THUẦN.** `body` vào thẳng text node của React (React tự escape). Không
`dangerouslySetInnerHTML`, không markdown, không HTML. Liên kết nhận diện ở **tầng hiển thị**: tách chuỗi
đã escape bằng regex URL rồi render `<a rel="noopener noreferrer nofollow" target="_blank">` — không bao
giờ dựng HTML từ chuỗi người dùng.

**Đính kèm** (`attachmentUrl` trả BA trạng thái — FE-1):

| Giá trị | Nghĩa | UI |
| --- | --- | --- |
| `string` | URL ký | ảnh hiện xem-trước; tệp khác hiện tên + cỡ + nút tải |
| `null` | server TỪ CHỐI ký | "Tệp không tải được" (xám, không phải nút chết) |
| `undefined` | tin đến từ WS, **chưa biết** | hiện tên + cỡ + trạng thái "đang lấy liên kết", và kích một lần `getMessages({afterSeq})` để nâng cấp bản REST |

### 4.3 Cột 3 — bảng thông tin phòng

- `getRoom(roomId)` → `members[]` + `myRole`; `listMembers` cho `lastReadSeq` tươi khi cần.
- Tab **Thành viên**: thêm/bớt/phong vai trò gate `manage:chat-member` **và** chỉ phòng `group`
  (phòng dẫn xuất `department`/`project` server chặn — CHAT-ERR-012 ⇒ FE không hiện nút).
- Tab **Tin ghim**: `getPinned(roomId)`, bấm để nhảy tới tin (nếu tin nằm ngoài phần đã nạp thì nạp
  `beforeSeq` tới khi thấy, trần 5 lần rồi báo "không tìm thấy trong lịch sử đã tải" — không lặp vô hạn).
- Nút **Rời** (`leaveRoom`, chỉ `group`) · **Lưu trữ** (`archiveRoom`, gate `archive:chat-room`).
- Đổi tên/mô tả gate `update:chat-room`, chỉ `group`.

---

## 5. Cổng quyền — bảng cặp (không hard-code role)

| Chỗ | Cặp | Ghi chú |
| --- | --- | --- |
| Route `/chat` | `view:chat-room` | RouteMeta `requiredAnyPermissions` |
| Nút "Tin nhắn mới" / tạo nhóm / mở DM | `create:chat-room` | |
| Ô soạn + nút gửi | `send:chat-message` | |
| Nút đính kèm | `send:chat-message` **và** `upload:foundation-file` | §0.1 |
| Thu hồi | `recall:chat-message` | + điều kiện §13.6 |
| Ghim | `pin:chat-message` | |
| Đổi tên/mô tả | `update:chat-room` | + `roomType==='group'` |
| Lưu trữ | `archive:chat-room` | |
| Thêm/bớt/phong thành viên | `manage:chat-member` | + `roomType==='group'` + `myRole==='admin'` |

Dùng `useCan` (9 cặp CHAT đều `is_sensitive=false` ⇒ có mặt trong `/auth/me.capabilities`).
`useCanExact` **không** cần ở đây — nó dành cho cặp nhạy cảm không nằm trong allowlist
(memory `sensitive-capability-allowlist-is-backend`). Cặp nhạy cảm duy nhất của CHAT là
`view:chat-oversight`, thuộc FE-5.

---

## 6. Tám trạng thái §14 — ánh xạ nghiệm thu

| # | Trạng thái | Nơi thể hiện | Test |
| --- | --- | --- | --- |
| 1 | loading | skeleton cột 1 + cột 2 | `ChatPage.spec` |
| 2 | error — **không mất nội dung đang soạn** | dải lỗi + "Thử lại"; ô soạn giữ nguyên chữ | `MessageComposer.spec` |
| 3 | empty | "Chưa có tin nhắn nào" + gợi ý | `ConversationPanel.spec` |
| 4 | đang gửi / gửi lỗi + gửi lại | bong bóng mờ / viền đỏ + nút, **cùng `clientMessageId`** | `MessageComposer.spec` |
| 5 | mất kết nối | `ConnectionBanner` theo `connectionStatus` (2 chữ khác nhau cho `disconnected` vs `polling-fallback`) | `ConnectionBanner` qua `ConversationPanel.spec` |
| 6 | tin đã thu hồi | "Tin nhắn đã được thu hồi" **chữ xám**, không phải khoảng trắng | `MessageBubble.spec` |
| 7 | phòng đã lưu trữ | khoá ô soạn + nhãn chỉ-đọc | `ConversationPanel.spec` |
| 8 | không có quyền | `PermissionGate`/`useCan`, KHÔNG hard-code | mọi spec có nhánh deny |

---

## 7. Rủi ro đã biết → chốt chặn

| Rủi ro | Chốt |
| --- | --- |
| `useCan` gọi SAI cặp mà test vẫn xanh (mock trả `true`) | mỗi spec deny khẳng định **đối số** truyền vào `useCan`, không chỉ khẳng định ẩn/hiện |
| Đổi phòng liên tục ⇒ đua giữa các lần `getMessages` | mỗi lần nạp mang `roomId`; kết quả về mà `roomId` đã đổi thì **bỏ** |
| `markRead` bắn liên tục khi cuộn | chống dội + chỉ gửi khi seq TĂNG (server đằng nào cũng bỏ qua số lùi, nhưng đừng nện API) |
| Ảnh vỡ layout khi URL hết hạn (TTL 300s) | `onError` → rơi về khối tên + cỡ tệp, không để ô trống |
| `subscribeToRoom` không được gỡ ⇒ interval rác | `useEffect` cleanup gọi `unsubscribeFromRoom` + `trimRoomHistory` |
| Prepend làm nhảy cuộn | đo `scrollHeight` trước/sau, bù `scrollTop`; có test khẳng định phép bù |
| Sửa store làm đỏ 1577 test app | RED-proof từng vá: hoàn nguyên phải cho đúng số ca đỏ dự kiến |

---

## 8. Definition of Done

- [ ] CHAT-SCREEN-001/003/004 chạy; cuộn ngược `beforeSeq` giữ vị trí cuộn; tin mới không giật layout.
- [ ] Đủ 8 trạng thái §14, mỗi trạng thái có ít nhất một ca test.
- [ ] Body render văn bản thuần; có test đóng đinh chuỗi `<img onerror=…>` hiện ra dưới dạng **chữ**.
- [ ] i18n namespace `chat` (vi) đầy đủ, 0 chuỗi cứng trong JSX; light + dark đạt tương phản.
- [ ] `pnpm typecheck` · `pnpm lint` · test apps/app + web-core · `vite build` xanh.
- [ ] LIGHT gate PASS (`typescript-reviewer` + `quality-gate`, + `react-reviewer` vì lane FE).
- [ ] Ghi rõ trong PR: đính kèm chỉ nghiệm thu được bằng tài khoản có `upload:foundation-file`
      (§0.1) và WO `S7-CHAT-BE-8` đã được seed vào backlog.

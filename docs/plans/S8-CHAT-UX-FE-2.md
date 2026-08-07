# S8-CHAT-UX-FE-2 — Mục Ghim · menu ngữ cảnh mỗi hội thoại · avatar trong danh sách · màn đặt avatar

> Zone **yellow** · gate **LIGHT** (`typescript-reviewer` + `quality-gate`).
> Phụ thuộc đã land: `S8-CHAT-UX-BE-1` (#360) · `S8-CHAT-UX-BE-2` (#363) · `S8-CHAT-UX-FE-1`.
> Nguồn sự thật: SPEC-15 §9 (CHAT-SCREEN-001/004) · §9a · §10 (CHAT-FUNC-015…018) · §11b (CHAT-DEC-016) · §12 (CHAT-ERR-021…023).

---

## 0. Cái WO này KHÔNG làm

- **Không** đụng backend. Bốn đường ghi (`pin`/`unpin`/`mute`/`unread`) và ba đường avatar đã có ở BE-1/BE-2;
  `chatApi` đã mirror bốn đường đầu từ BE-1. WO này chỉ thêm **client avatar phòng** vào `chat-api.ts`.
- **Không** làm thư mục tự đặt (§5.2 — wave sau).
- **Không** làm avatar NGƯỜI GỬI trong khung chat — đó là `FE-3` (CHAT-DEC-019, cần **roster phòng**).

---

## 1. Bốn việc, theo đúng `done_when`

### 1.1 Mục "Đã ghim" — nối vị từ THẬT

`buildRoomSections` từ FE-1 nhận `isPinned` nhưng mặc định `NEVER_PINNED` vì cột `pinned_at` chưa tồn tại.
BE-1 đã đưa `pinnedAt` vào `chatRoomSchema` ⇒ đổi mặc định sang vị từ thật `isRoomPinned`.
Luật "ghim THẮNG loại phòng" (mỗi phòng đúng MỘT node) đã có test trên dữ liệu — giữ nguyên, chỉ đổi nguồn vị từ.

### 1.2 Menu ngữ cảnh mỗi phòng

| Mục | Đường ghi | Ghi chú |
| --- | --- | --- |
| Ghim / Bỏ ghim | `PUT`/`DELETE /chat/rooms/:id/pin` | trần 10 ⇒ **409 CHAT-ERR-021**, thông điệp phải nêu số 10 |
| Tắt thông báo 1 giờ · 8 giờ · 1 tuần / Bật lại | `PUT /chat/rooms/:id/mute` | `null` = bật lại; server **chuẩn hoá mốc đã qua về `null`** |
| Đánh dấu chưa đọc | `POST /chat/rooms/:id/unread` | `unreadCount` **KHÔNG đổi** — hiện đậm theo `markedUnreadAt` |
| Lưu trữ phòng | `POST /chat/rooms/:id/archive` | chỉ khi có `archive:chat-room` và phòng chưa lưu trữ |

Ràng buộc thi công:

- **Mở bằng CẢ chuột phải LẪN nút `…`** — nút `…` là `<button>` thật ⇒ bàn phím tới được. Chuột phải là lối
  tắt, KHÔNG phải lối duy nhất.
- Hàng phòng hiện là **một `<button>` phủ cả dòng**. Nhét nút `…` vào trong nó là `<button>` lồng `<button>`
  (HTML không hợp lệ, hành vi bấm không xác định) ⇒ **phải tách** thành hàng flex: nút chọn phòng + nút `…`
  là hai anh em.
- Cập nhật **lạc quan có hoàn nguyên**: giữ giá trị TRƯỚC, ghi giá trị mới vào store, gọi API; lỗi ⇒ ghi lại
  giá trị trước **và** hiện thông điệp (memory `reviewers-pass-real-bugs` — im lặng là hỏng nặng hơn).
- Dựng payload trong `onClick` rồi `mutate(payload)`; **không đọc state trong `mutationFn`**
  (memory `react-query-v5-stale-mutationfn-closure`).
- Ghim/tắt thông báo/đánh dấu chưa đọc là **TUỲ CHỌN CÁ NHÂN** (SPEC-15 §11 cảnh báo, memory
  `personal-prefs-must-not-sit-behind-permission-gate`) ⇒ **KHÔNG** bọc `PermissionGate`/`useCan` quanh
  chúng. Chỉ "Lưu trữ phòng" mới hỏi cặp quản trị `archive:chat-room`.

### 1.3 Avatar trong danh sách

- `group` · `department` · `project`: dùng `room.avatarUrl` (server ký TƯƠI mỗi lần trả) nếu có; không có
  thì **chữ cái đầu + màu suy từ `room.id`** (hàm thuần, cùng id ⇒ cùng màu ở mọi phiên).
- `direct`: `avatarUrl` **luôn `null`** ở hợp đồng (CHECK `chk_chat_rooms_direct_no_avatar`) ⇒ dựng chữ cái
  đầu từ tên người đối thoại (`resolvedNames`).
  > ⚠️ **Nợ đã biết:** ảnh THẬT của người đối thoại chưa lấy được — `chatRoomMemberSchema` không có
  > `avatarUrl` và `GET /chat/rooms` không kèm `members`. Nguồn đúng là **roster phòng** của
  > CHAT-DEC-019, thứ `FE-3` mới dựng. Ở đây KHÔNG bịa đường ký thứ hai để lấp chỗ đó.
- **KHÔNG cache/persist `avatarUrl`** — URL ký TTL ngắn (docblock hợp đồng).

### 1.4 Màn đặt avatar ở `RoomInfoPanel` — ẩn nút theo ĐÚNG CHAT-DEC-016

SPEC-15 §9 CHAT-SCREEN-004: *"chỉ hiện đúng với chủ thể được phép theo CHAT-DEC-016, **không** hiện nút rồi
để server trả 403"*. Bảng §11b có **bốn** nhánh, mỗi nhánh một nguồn quyền khác nhau:

| Loại phòng | Server đòi (§11b) | FE chứng minh được bằng gì |
| --- | --- | --- |
| `direct` | **không ai** (422 CHAT-ERR-022) | không render, không có nhánh nào |
| `group` | `update:chat-room` + `members.role='admin'` | `useCan` + `myRole` từ `getRoom` — **khớp chính xác** |
| `department` | `update:chat-room` + `update:org_unit` **với đơn vị neo** | `useCan('update','org_unit')` — xem cảnh báo dưới |
| `project` | `update:chat-room` + vai trò quản lý dự án | `getProject(refId).myProjectRole ∈ {Owner, Manager}` — khớp `PROJECT_AVATAR_ROLES` |

> ⚠️ **Vế `department` là XẤP XỈ TRÊN, phải ghi ra chứ không giấu.** `data_scope` là per-(permission, role)
> và FE **không** có `orgUnitId` của phòng trong `ChatRoomDto`, cũng không có bản đồ "đơn vị mình làm trưởng".
> Xấp xỉ này ĐÚNG với mọi role canonical hôm nay: `update:org_unit` chỉ được grant cho `company-admin`
> (`0030:36`) và `hr-manager` (`0030:46`), cả hai ở `data_scope` mặc định `Company` (`permission.ts:72`) —
> tức nhánh "cho qua" của `assertOrgUnitWriteTx`. Chỉ một custom-role `update:org_unit@Department` mới đẻ
> ra ca lệch, và ở ca đó FE **bắt 403 và hiện đúng thông điệp CHAT-ERR-023**, không nuốt thành lỗi chung.
> Sửa triệt để = BE trả cờ `canSetAvatar` trên `GET /chat/rooms/:id` — **ngoài phạm vi WO này** (chạm
> đường quyền ⇒ đổi gate LIGHT→FULL), ghi lại thành việc kế tiếp.

Luồng đặt ảnh sao khuôn `employeeAvatarApi` (3 pha): `upload-url` → `PUT` bytes lên storage → `POST …/avatar`.
Server trả `{fileId}` (KHÔNG URL) ⇒ **phải refetch** phòng để lấy `avatarUrl` ký tươi, không tự suy URL.

---

## 2. Bản đồ file

| File | Việc |
| --- | --- |
| `packages/web-core/src/lib/chat-api.ts` | + `uploadRoomAvatar` · `removeRoomAvatar` (3 pha, dùng `putBytesToStorage` sẵn có) |
| `apps/app/src/components/chat/chat-room-prefs.ts` *(mới)* | thuần: `isRoomPinned` · `isRoomMuted` · `roomAvatarTone` · `MUTE_PRESETS` · `ROOM_PIN_LIMIT` |
| `apps/app/src/components/chat/room-list-sections.ts` | mặc định `isPinned` = vị từ THẬT |
| `apps/app/src/stores/chat.store.ts` | + `patchRoomPrefs` (lạc quan + hoàn nguyên) |
| `apps/app/src/components/chat/use-room-prefs.ts` *(mới)* | 1 bộ mutation dùng chung cho MỌI dòng (không phải N hook) |
| `apps/app/src/components/chat/RoomRowMenu.tsx` *(mới)* | nút `…` + `Popover` + danh sách mục |
| `apps/app/src/components/chat/RoomAvatar.tsx` *(mới)* | ảnh phòng / chữ cái đầu + màu theo id |
| `apps/app/src/components/chat/RoomAvatarEditor.tsx` *(mới)* | khối đặt/gỡ ảnh trong `RoomInfoPanel` |
| `apps/app/src/components/chat/RoomListPanel.tsx` | tách hàng flex · avatar · chuông-gạch · đậm khi đánh dấu chưa đọc · dải lỗi |
| `apps/app/src/components/chat/RoomInfoPanel.tsx` | gắn `RoomAvatarEditor` |
| `apps/app/src/i18n/locales/vi/chat.ts` | chuỗi mới (`rooms.menu.*`, `rooms.avatar*`, `info.avatar.*`) |

## 3. Test phải có

1. `chat-room-prefs.spec.ts` — `isRoomMuted` phải so với **now** (mốc đã qua ⇒ KHÔNG tắt); `roomAvatarTone` ổn định.
2. `room-list-sections.spec.ts` — `pinnedAt` thật ⇒ mục `pinned`, và phòng ghim **không** xuất hiện ở mục loại phòng.
3. `RoomListPanel.spec.tsx` — mở menu bằng nút `…`; ghim lạc quan; 409 ⇒ thông điệp có số **10** + **hoàn nguyên**;
   chuông-gạch trên dòng; **ĐẾM NODE** avatar/dòng (memory `duplicate-sibling-key-leaks-dom-node`).
4. `RoomAvatarEditor.spec.tsx` — bốn nhánh DEC-016: `direct` không render · `group` cần admin · `department` cần
   `update:org_unit` · `project` cần Owner/Manager (fail-closed khi không đọc được dự án).

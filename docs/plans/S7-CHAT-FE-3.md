# S7-CHAT-FE-3 — Panel chat nổi toàn hệ thống + badge tổng chưa đọc + lối vào sidebar

> Kế hoạch thi công. Nguồn sự thật nghiệp vụ: `docs/spec/SPEC-15 CHAT.md` §9 (CHAT-SCREEN-002 · 006) · §14.
> Nền đã có: `S7-CHAT-FE-1` (store · socket dùng chung · `useChatRealtime`) · `S7-CHAT-FE-2` (trang `/chat`,
> `ConversationPanel` · `useChatConversation` · `chat-format`).
> Backend đã lên master: `S7-CHAT-BE-1..7` (mig 0538 · 0539 · 0540 · 0541).

---

## 0. ĐO TRƯỚC KHI LÀM — 4 sự thật đã kiểm chứng

### 0.1 ✅ `access:chat` CÓ grant thật — badge + lối vào sẽ hiện với mọi vai

Đo trên DB dev (`role_permissions ⋈ roles ⋈ permissions`), không suy từ migration:

```
SA | company-admin | employee | hr | manager   →  access:chat = Company (đủ 5 vai)
```

Cặp `('access','chat')` là `is_sensitive=false` (mig `0538:406`) ⇒ CÓ MẶT trong `/auth/me.capabilities`
⇒ `useCan("access","chat")` chạy thật, **không** rơi xuống `*:*`. Đây là điều kiện cần: nếu cặp này
không ai có thì WO ship ra UI chết (đúng lỗ đã gặp ở đính kèm FE-2 §0.1).

### 0.2 🛑 Panel nổi **KHÔNG được** mở cùng phòng đang mở ở trang `/chat`

`useChatConversation` (FE-2) gọi `subscribeToRoom(roomId)` lúc mount và `unsubscribeFromRoom(roomId)` +
`trimRoomHistory(roomId)` lúc unmount. Store guard trùng lặp ở chiều VÀO (`if (subscribedRoomIds[roomId])
return`) nhưng **không đếm tham chiếu** ở chiều RA:

- hai instance cùng phòng ⇒ instance nào unmount trước **giết lưới bù tin của instance còn sống**
  (`clearInterval`), và phòng đó ngừng cập nhật lúc mất mạng — im lặng tuyệt đối;
- `trimRoomHistory` cắt về 200 tin ⇒ **vứt đúng phần lịch sử** instance kia vừa bấm "tải thêm".

Sửa đúng = đếm tham chiếu trong store, nhưng đó là đổi hợp đồng của FE-1 cho một tình huống mà nghiệp vụ
vốn không cần: trang `/chat` đã là khung nhìn đầy đủ, panel nổi chồng lên nó là thừa. ⇒ **`ChatDock` không
render khi đang ở `/chat`.** Trạng thái dock được GIỮ trong store, rời `/chat` là các cửa sổ hiện lại
nguyên vẹn. Quyết định này ghi vào docblock của `ChatDock` để người sau không "sửa" nó thành luôn-hiện.

> Hệ quả với `done_when` #1 ("mở được ở MỌI màn hình"): đọc theo chủ đích — mọi màn hình **có panel là
> khung nhìn chat duy nhất**. Ở `/chat` thì khung nhìn đó chính là trang.

### 0.3 Badge tổng = CỘNG DỒN `unreadCount` từng phòng — không có endpoint nào để gọi

`chatApi` không có `unreadCount()`; soát `apps/api/src/chat/*.controller.ts`: **không có** route
`GET /chat/unread-count` (khác NOTI — NOTI-API-003 có). Store FE-1 đã đóng đinh hướng này trong docblock
`applyIncomingMessage`: _"Badge tổng của FE-3 cộng dồn `unreadCount` từng phòng — KHÔNG gọi
`GET /chat/unread-count`"_.

⇒ Badge là hàm thuần trên `roomsById`. Realtime tự có: `chat:message` cộng, `chat:read` trừ
(`applyReadEvent`), cả hai đã chạy sẵn ở `useChatRealtime` — **WO này không thêm listener nào**.

### 0.4 ⚠️ Phòng **đã lưu trữ** phải LOẠI khỏi tổng, nếu không con số nhảy vì lý do phía client

`roomsById` chứa phòng đã lưu trữ **chỉ khi** người dùng từng bấm "Xem phòng đã lưu trữ" ở
`RoomListPanel` (rổ đó hỏi riêng bằng `listRooms({archived:true})` — `listRooms()` mặc định bị service ép
`archived: false`).

⇒ Cộng cả rổ lưu trữ nghĩa là badge **đổi số khi người dùng ghé thăm một tab**, không phải khi có tin
mới; và số dôi ra trỏ tới phòng mà lối vào mặc định (dropdown + danh sách) không hiển thị — người dùng
thấy "3" rồi tìm mãi không ra tin thứ 3. Tổng **chỉ đếm `isArchived !== true`**.

---

## 1. Phạm vi

**Trong:**

| Hạng mục | Mã spec |
| --- | --- |
| Panel chat nổi toàn hệ thống, tối đa 3 hội thoại, thu nhỏ/mở rộng | CHAT-SCREEN-002 |
| Badge tổng chưa đọc trên header + dropdown chọn phòng | CHAT-SCREEN-006 |
| Lối vào `/chat` trong sidebar MediaOS | — (đóng lời hứa `S5-LMS-UI-4`) |

**Ngoài:** tìm kiếm tin (FE-4) · màn quản trị đọc-vượt (FE-5) · gỡ chat khỏi LMS (`S7-CHAT-LMS-1`) ·
kéo-thả/đổi kích thước cửa sổ (không có trong spec, không thêm).

---

## 2. Kiến trúc — dùng lại, không dựng song song

```
ProtectedShell  ─┬─ useChatRealtime()      (FE-1, ĐÃ CÓ — 1 kết nối WS duy nhất)
                 ├─ GlobalTopbar ─ ChatBadge          ← MỚI (CHAT-SCREEN-006)
                 └─ ChatDock                          ← MỚI (CHAT-SCREEN-002)
                      └─ ChatDockWindow × ≤3
                           └─ ConversationPanel  (FE-2, DÙNG LẠI — thêm cờ `showHeader`)
                                └─ useChatConversation · MessageList · MessageComposer
```

**Không có kết nối WS thứ hai và không có store dữ liệu thứ hai.** `ChatDock` chỉ thêm một store **trạng
thái UI** (`chat-dock.store.ts`: cửa sổ nào đang mở/thu nhỏ) — không giữ phòng, không giữ tin. Nghiệm thu
bằng devtools: tab Network → WS đúng **một** kết nối `/ws` khi mở panel ở trang bất kỳ.

### 2.1 Vì sao `ChatDockWindow` dùng lại `ConversationPanel` nguyên khối

Panel nổi cần đúng những gì trang cần: nạp trang đầu, cuộn ngược, gửi/gửi lại, thu hồi, ghim, đánh dấu
đã đọc, banner mất kết nối. Viết bản thứ hai gọn hơn = bản thứ hai **thiếu** một trong số đó, và cái
thiếu chỉ lộ ra ở panel (ví dụ: không có đường "Gửi lại" ⇒ tin gõ trong panel lúc rớt mạng biến mất).

Khác biệt duy nhất là **thanh tiêu đề**: trang có nút ⓘ mở bảng thông tin; panel có thu nhỏ/đóng/mở rộng
toàn màn hình. ⇒ `ConversationPanel` nhận `showHeader?: boolean` (mặc định `true`); dock tự vẽ thanh tiêu
đề của nó. Đây là **một** cờ, không phải một chế độ — không có nhánh logic nào khác rẽ theo nó.

---

## 3. Thiết kế từng phần

### 3.1 `chat-dock.store.ts` — store trạng thái UI (mới)

```ts
MAX_DOCK_WINDOWS = 3

openRoomIds: readonly string[]            // trái→phải; MỚI NHẤT ở CUỐI (sát mép phải)
minimizedRoomIds: Record<string, true>
resolvedNames: Record<string, string>     // tên phòng `direct` đã dựng (dùng chung badge ↔ dock)

openRoom(roomId)      // đã mở → BỎ thu nhỏ (đưa ra trước mắt), KHÔNG đổi vị trí
                      // chưa mở → thêm vào cuối; quá trần → đẩy cái CŨ NHẤT (index 0) ra
closeRoom(roomId)     // gỡ khỏi cả 3 map
toggleMinimize(roomId)
setResolvedName(roomId, name)
resetChatDock()
```

**Đẩy cái CŨ NHẤT ra khi quá trần** (không phải từ chối mở cái thứ 4): người dùng vừa bấm vào một phòng
thì kỳ vọng nó mở ra. Từ chối im lặng là nút bấm không phản hồi.

⚠️ `closeRoom` phải gỡ **cả** `minimizedRoomIds` và `resolvedNames`. Bỏ sót là rò rỉ chậm: đóng/mở 200
phòng trong một phiên để lại 200 khoá chết, và một phòng mở lại sẽ hiện ra ở trạng thái **thu nhỏ** của
lần trước mà không ai hiểu vì sao.

`resolvedNames` sống ở đây (không ở `useChatStore`) vì nó là **nhãn suy diễn phía client**, không phải dữ
liệu server. Trang `/chat` có bản cache riêng theo cùng lý do (FE-2); gộp hai bản là việc của FE-4 nếu có
nhu cầu thật.

### 3.2 `chat-unread.ts` — hàm thuần (mới)

```ts
totalUnreadCount(roomsById): number       // Σ unreadCount của phòng isArchived !== true (§0.4)
formatUnreadBadge(n): string              // n > 99 → "99+"
```

Thuần ⇒ test bằng gọi hàm, không dựng DOM. Cùng lý do `chat-format.ts` tồn tại.

### 3.3 `ChatDock.tsx` (mới) — gắn ở `ProtectedShell`

- Cổng quyền: `useCan("access","chat")` → thiếu quyền trả `null` (không vẽ khung rỗng).
- **Không render ở `/chat`** — lý do §0.2, ghi trong docblock.
- **Không render dưới `md`**: 3 cửa sổ 320px không nằm vừa màn hình điện thoại; ở đó lối vào là trang
  `/chat` full-screen. `hidden md:flex`.
- Container `fixed bottom-0 right-0 z-30 … pointer-events-none`, mỗi cửa sổ `pointer-events-auto` ⇒
  **vùng trống quanh panel không nuốt click của trang nền** (`done_when` #3).
  `z-30` (bằng topbar) — DƯỚI AppSwitcher (`z-40/50`) và dialog (`z-50`), nên panel không che overlay.
- **Dọn phòng đã biến mất**: `useEffect` so `openRoomIds` với `roomsById`; phòng vắng mặt (bị bớt / tự
  rời) ⇒ `closeRoom`. Không có vế này thì cửa sổ "ma" đứng lại với `ConversationPanel` gọi
  `GET /chat/rooms/:id/messages` ăn 404.

### 3.4 `ChatDockWindow.tsx` (mới)

- Thanh tiêu đề (luôn hiện, cả khi thu nhỏ): avatar chữ · tên phòng · badge chưa đọc ·
  [Mở toàn màn hình → `/chat`] · [Thu nhỏ / Mở rộng] · [Đóng].
- Thân (chỉ khi KHÔNG thu nhỏ): `ConversationPanel showHeader={false}` trong khung `w-80 h-[26rem]`.
- Chi tiết phòng (`members[]` + `myRole`) lấy bằng `useQuery(chatKeys.rooms.detail(roomId))`,
  `enabled: !minimized` — **cùng queryKey với trang `/chat`** ⇒ react-query chia sẻ cache, không có
  request thứ hai. Detail về ⇒ `setResolvedName` cho phòng `direct`.
- Thu nhỏ ⇒ `ConversationPanel` **unmount** ⇒ `unsubscribeFromRoom` + `trimRoomHistory` chạy đúng như
  khi rời phòng. Badge trên thanh tiêu đề **vẫn chạy** vì nó đọc `roomsById[roomId].unreadCount`, thứ
  `useChatRealtime` ở shell giữ tươi độc lập với việc phòng có đang mở hay không.

### 3.5 `ChatBadge.tsx` (mới) — trong `GlobalTopbar`

- Cổng: `useCan("access","chat")` → `null` khi thiếu (mirror `NotificationBadge`).
- Số: `totalUnreadCount(roomsById)` — hàm thuần, KHÔNG `useQuery`, KHÔNG poll (§0.3).
- Dropdown: phòng CÓ tin chưa đọc trước (theo `roomOrder`), hết thì phòng gần đây; tối đa 8 dòng.
  Bấm một dòng ⇒ `openRoom(roomId)` (mở panel nổi) + đóng dropdown. Chân dropdown: "Mở trang tin nhắn"
  → `/chat`.
- Ở `/chat` thì bấm dòng phòng **điều hướng thay vì mở panel** — panel không render ở đó (§0.2), nên mở
  nó là nút bấm không có tác dụng nhìn thấy được.

### 3.6 Lối vào sidebar

Sidebar MediaOS là **per-module** (`ModuleSidebar` đọc `SIDEBAR_REGISTRY[moduleCode]`), mà `/chat` cố ý
KHÔNG bọc `ModuleWorkspaceLayout` (FE-2: trang đã 3 cột, thêm sidebar là cột thứ tư). ⇒ Khai
`SIDEBAR_REGISTRY.CHAT` sẽ là **code chết**: không layout nào render nó.

⇒ Lối vào đặt trong `ME_SIDEBAR` — **cùng tiền lệ `me.lms`** ("Đào tạo (LMS)" cũng là link rời khỏi
module ME), nhóm `Trao đổi`, gate `access:chat`. `filterSidebarItems` tự ẩn khi thiếu quyền.

Lối vào **toàn hệ thống** thật sự là `ChatBadge` trên header — nó có mặt ở MỌI route đã đăng nhập, còn
sidebar chỉ có trong workspace của một module.

---

## 4. Rủi ro & cách chặn

| # | Rủi ro | Chặn |
| --- | --- | --- |
| R1 | Hai instance cùng phòng phá `subscribeToRoom`/`trimRoomHistory` | Dock không render ở `/chat` (§0.2) + test khẳng định |
| R2 | Badge nhảy số khi ghé tab lưu trữ | Loại `isArchived === true` khỏi tổng (§0.4) + test |
| R3 | Panel che/chặn thao tác trang nền | `pointer-events-none` ở container, `auto` ở cửa sổ + test |
| R4 | Rò khoá `minimized`/`resolvedNames` sau khi đóng | `closeRoom` gỡ cả 3 map + test |
| R5 | Mở phòng thứ 4 im lặng không phản hồi | Đẩy cái cũ nhất ra, không từ chối + test |
| R6 | Cửa sổ "ma" nện 404 sau khi bị bớt khỏi phòng | Effect đối chiếu `roomsById` → `closeRoom` |
| R7 | Kết nối WS thứ hai | Dock KHÔNG gọi `getAppSocket`/`io` — nghiệm thu bằng devtools |

---

## 5. Test (LIGHT gate)

| Tệp | Khẳng định |
| --- | --- |
| `chat-dock.store.spec.ts` | trần 3 + đẩy cũ nhất · mở lại phòng đang thu nhỏ thì BỎ thu nhỏ · `closeRoom` dọn cả 3 map · `resetChatDock` |
| `chat-unread.spec.ts` | tổng bỏ qua phòng lưu trữ · bỏ qua `unreadCount` vắng · `>99` → `"99+"` |
| `ChatBadge.spec.tsx` | thiếu `access:chat` ⇒ không render gì · số khớp tổng · bấm dòng phòng ⇒ mở dock |
| `ChatDock.spec.tsx` | ở `/chat` ⇒ không render · phòng biến mất khỏi store ⇒ tự đóng · container `pointer-events-none` |

Coverage ≥80% cho file mới. Gate LIGHT (`typescript-reviewer` + `quality-gate`) theo `zone: yellow`.

---

## 6. Tệp đụng tới

**Mới** — `apps/app/src/components/chat/`: `chat-dock.store.ts` · `chat-unread.ts` · `ChatDock.tsx` ·
`ChatDockWindow.tsx` · `ChatBadge.tsx` (+ 4 spec).

**Sửa** — `ConversationPanel.tsx` (thêm `showHeader`) · `layouts/protected/ProtectedShell.tsx` (mount
`ChatDock`) · `layouts/topbar/GlobalTopbar.tsx` (mount `ChatBadge`) ·
`layouts/workspace/sidebar-registry.ts` (`ME_SIDEBAR` + mục "Trò chuyện") ·
`i18n/locales/vi/chat.ts` (khoá `dock.*` + `badge.*`) · `harness/backlog.mjs` (paths + status).

> `i18n/locales/vi/chat.ts` nằm NGOÀI `paths` ban đầu của WO ⇒ mở rộng `paths` trong `harness/backlog.mjs`
> trước khi sửa (memory `wo-paths-drive-gate-and-scheduler`: `paths` lái cả gate lẫn scope guard).

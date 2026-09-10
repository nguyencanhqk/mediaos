# S17-CHAT-UX2-FE-1 — Danh sách phòng v2

> **WO:** `S17-CHAT-UX2-FE-1` · zone 🟡 · gate **LIGHT** · phụ thuộc `S17-CHAT-UX2-BE-1` ✅ (PR #494, `cd4d15b1`)
> **Nguồn:** SPEC-15 §9a (luật chip CHAT-DEC-021) · §14 «Dòng phòng trong danh sách» · CHAT-DEC-022/023 ·
> UI-09 §13a · wireframe `docs/plans/S17-CHAT-UX2-WAVE-review.html` §05
> **Không** migration · **không** cặp quyền mới · **không** route mới · **không** bề mặt WS mới.

---

## 0. WO này KHÔNG làm gì

| Không làm | Vì sao | Thuộc về |
| --- | --- | --- |
| Drawer / responsive `/chat` | `ChatDock`/`ChatDockWindow` chỉ được **sửa đúng chỗ đọc tên**; đổi hình thái là việc khác | `FE-5` |
| Header hội thoại · bong bóng · đã-xem | cột GIỮA, không phải cột trái | `FE-2` |
| Bảng «Liên kết» (CHAT-API-031) | cột PHẢI | `FE-4` |
| Ảnh thật của peer trong `ChatDockWindow`/`ConversationPanel` | hai chỗ đó có `members[]` riêng; đổi luôn = mở rộng diff ra ngoài `paths` của WO | FE-2/FE-5 |

---

## 1. Hiện trạng đo được (10/09/2026)

| Đo | Giá trị |
| --- | --- |
| `RoomListPanel.spec.tsx` | **35 ca** — trần dưới của WO này (wave §5: «test cũ `chat-room-item` giữ nguyên số ca») |
| `resolvedNames` — điểm đọc/ghi | **2 kho**: `ChatPage` (`useState`) · `chat-dock.store` (3 map, `setResolvedName`) · 4 consumer (`RoomListPanel`, `ChatBadge`, `ChatDockWindow`, `ChatPage`) |
| `roomDisplayName` call-site | 5 (`ChatBadge` · `ChatDockWindow` ×2 · `ConversationPanel` · `ChatPage`) |
| DTO có sẵn từ BE-1 | `room.lastMessage` (`senderId`·`senderName`·`kind`·`excerpt`·`attachmentCount`) · `room.peer` (`userId`·`name`·`avatarUrl`·`isActive`) |
| `presenceByUser` | đã có ở `chat.store` (`chat:presence`), fan-out CHỈ tới peer của phòng `direct` |
| `date-fns` | `^4.4.0` đã là dependency của `apps/app` — không thêm gói |

---

## 2. Nhãn phòng — GỠ `resolvedNames`, KHÔNG thay bằng cache thứ hai

`resolvedNames` tồn tại vì **`GET /chat/rooms` không kèm `members`** nên tên DM chỉ dựng được **sau khi
mở phòng**. BE-1 đã trả `peer.name` ngay ở danh sách ⇒ toàn bộ lý do tồn tại của cache biến mất.

**Cách gỡ: mở rộng ĐÚNG `roomDisplayName`**, không thêm hàm thứ hai.

```ts
// chat-format.ts — thêm "peer" vào Pick, thêm ĐÚNG một vế
if (room.roomType !== "direct") return room.name ?? fallback(room.roomCode);
const fromMembers = members?.find((m) => m.userId !== myUserId)?.userName;
return fromMembers ?? room.peer?.name ?? room.name ?? fallback(room.roomCode);
```

⚠️ **`members` vẫn đứng TRƯỚC `peer`** — không đảo. `ConversationPanel` truyền `members` thật và 5 ca test
S7 đang neo hành vi đó; đảo thứ tự là đổi hành vi của một màn ngoài phạm vi WO để tiện cho màn trong
phạm vi. Hai nguồn cùng suy từ `chat_room_members` nên chúng **không được phép** lệch; nếu lệch thì đó là
lỗi BE, không phải chỗ để FE chọn bên.

**Điểm xoá:**

| File | Xoá | Thay bằng |
| --- | --- | --- |
| `routes/chat/ChatPage.tsx` | `useState resolvedNames` + `setResolvedNames` trong `useEffect(detail)` + prop | `roomDisplayName(room, detail?.members, …)` tại chỗ |
| `components/chat/chat-dock.store.ts` | khoá `resolvedNames` · `setResolvedName` · 3 điểm dọn (`openRoom` evict · `closeRoom` · initial) | — |
| `components/chat/ChatDockWindow.tsx` | `cachedName` · `setResolvedName` · `useEffect` ghi cache | `roomDisplayName(room, detail?.members, …)` |
| `components/chat/ChatBadge.tsx` | `resolvedNames[room.id] ??` | `roomDisplayName(room, undefined, …)` (nay đọc `peer`) |
| `components/chat/RoomListPanel.tsx` | prop `resolvedNames` | `roomDisplayName` tại chỗ |

`chat-dock.store.spec.ts` có **5 assert** trên `resolvedNames` (ca «closeRoom dọn CẢ ba map», «evict»,
«setResolvedName», «reset»). Chúng phải đổi thành **HAI** map, không được xoá cả ca — luật «bị đẩy ra và
tự đóng để lại cùng một kết cục» vẫn là bất biến, chỉ bớt một map.

---

## 3. Chip lọc — `room-list-filter.ts` (module THUẦN, mới)

Vì sao module riêng chứ không `useMemo` trong component: bất biến **«mỗi phòng đúng MỘT node ở MỌI chip»**
(SPEC-15 §9a, memory `duplicate-sibling-key-leaks-dom-node`) chỉ kiểm được trên **dữ liệu**. Trên DOM thì
hai node cùng `key` ở hai `<ul>` anh em **không cảnh báo gì** — đúng khuôn `room-list-sections.ts` của S8.

```ts
export const ROOM_FILTER_CHIPS = ["all", "unread", "direct", "group", "deptproject", "archived"] as const;
```

| Chip | Vị từ | Rổ dữ liệu |
| --- | --- | --- |
| `all` | — (mọi phòng chưa lưu trữ) | mặc định · **GIỮ 5 mục cố định** qua `buildRoomSections` |
| `unread` | `isRoomUnreadLooking(room)` | mặc định · **phẳng** |
| `direct` | `roomType === 'direct'` | mặc định · phẳng |
| `group` | `roomType === 'group'` | mặc định · phẳng |
| `deptproject` | `roomType === 'department' \|\| 'project'` | mặc định · phẳng |
| `archived` | — | **rổ riêng** (`listRooms({archived:true})`) · phẳng |

**Bốn luật ép ở đây, không ở component:**

1. **`unread` dùng LẠI `isRoomUnreadLooking`** (`chat-room-prefs.ts`) — cùng vị từ với độ ĐẬM của dòng.
   Viết lại `(room.unreadCount ?? 0) > 0` ở đây là dựng bản luật thứ hai: `markedUnreadAt` (đánh dấu chưa
   đọc thủ công, CHAT-FUNC-017) **cố ý không** đổi `unreadCount`, nên chip sẽ giấu đúng phòng người dùng
   vừa tự đánh dấu, trong khi dòng của nó vẫn in đậm.
2. **Chip khác `all` ⇒ DANH SÁCH PHẲNG**, giữ nguyên thứ tự đầu vào (`roomOrder` = theo hoạt động).
   Không chia mục con, **không** để ghim đẩy phòng lên đầu — «phẳng theo hoạt động» là nguyên văn §9a.
3. **Lọc theo rổ lưu trữ TRƯỚC, theo chip SAU**: `archived` là rổ, không phải vị từ trên rổ mặc định.
   Trộn hai thứ (ví dụ `unread` quét cả phòng đã lưu trữ) làm một phòng xuất hiện ở hai chip khác nhau
   với hai trạng thái khác nhau — người dùng không lần được vì sao.
4. **Chip KHÔNG lưu** (§9a): `useState`, không `localStorage`. Trạng thái THU/MỞ mục thì vẫn lưu như S8 —
   hai thứ khác nhau, đừng gộp khoá.

⚠️ Ô lọc theo tên/mã (`query`) áp **SAU** chip, trên rổ đã lọc — không đảo. Đảo lại thì gõ từ khoá trong
chip «Chưa đọc» sẽ trả cả phòng đã đọc.

---

## 4. Dòng phòng v2 (56px)

Theo wireframe §05. **Cấu trúc DOM giữ nguyên** (`<div>` flex, hai anh em: nút chọn phòng +
`RoomRowMenu`) — `data-testid="chat-room-item"` **không đổi**, nó là thứ 35 ca đang bấm.

```
[avatar 40 + chấm online]  [tên  (+ «Ngừng hoạt động»)]        [3 ngày]
                            [Người gửi: trích dẫn…]             [badge]
```

| Phần | Nguồn | Luật |
| --- | --- | --- |
| avatar | `room.peer.avatarUrl` (direct) · `room.avatarUrl` (còn lại) | KHÔNG cache, KHÔNG persist (URL ký TTL ngắn) |
| chấm online | `presenceByUser[room.peer.userId]` | CHỈ phòng `direct` — sự kiện `chat:presence` chỉ fan-out tới peer của DM |
| «Ngừng hoạt động» | `room.peer.isActive === false` | nhãn cạnh TÊN; **KHÔNG khoá gì cả** (CHAT-DEC-023) |
| thời gian | `room.lastMessageAt` | `formatDistanceToNowStrict(vi)` — tương đối, client-side (memory `fe-has-no-company-timezone`) |
| preview | `room.lastMessage` | bảng dưới |

**Bảng preview — 5 nhánh, khớp `kind` của server (`apps/api/src/chat/chat-preview.ts`):**

| `kind` | Hiện | Ghi chú |
| --- | --- | --- |
| `recalled` | «Tin nhắn đã được thu hồi» **chữ xám/nghiêng** | SPEC-15 §14 v2: **không phải khoảng trắng** |
| `system` | `excerpt`, chữ xám | tin do server sinh |
| `text` + `excerpt` | `excerpt` (+ 📎 nếu `attachmentCount > 0`) | **chữ THẮNG tệp** — `kind:'text'` vẫn có thể kèm tệp |
| `file` | «📎 {{count}} tệp» | `excerpt === null` |
| `text` + `excerpt === null` | **rỗng** | body rỗng, 0 tệp |
| `lastMessage === null` | **rỗng** | phòng chưa có tin — §14: không vẽ dòng trắng |

**Tiền tố người gửi** (wireframe: `<b>Bạn:</b>` · `<b>Đỗ Tiến Bắc:</b>` · không tiền tố ở DM của peer):

```
senderId === myUserId          ⇒ «Bạn: »
roomType !== 'direct'          ⇒ «{senderName}: »
còn lại (DM, tin của peer)     ⇒ không tiền tố
kind === 'system'              ⇒ không tiền tố (tin hệ thống không của ai)
```

---

## 5. Store — vá `lastMessage` từ `chat:message` (CHAT-DEC-022)

Không thêm sự kiện WS. `applyIncomingMessage` **đã** cập nhật `lastMessageAt`/`lastMessageSeq`/`unreadCount`
sau chốt `roomSeq > room.lastMessageSeq`; `lastMessage` đi **cùng chốt đó**, cùng object `updatedRoom`.

⚠️ **Chốt `roomSeq <= lastMessageSeq` phải bao luôn `lastMessage`** — nếu không, lưới bù `getMessages(roomId, {})`
(trang 50 tin **mới nhất** khi phòng chưa có tin nào trong RAM) hay cuộn ngược `beforeSeq` sẽ ghi một tin
**CŨ** làm preview. Đúng cái lỗi mà chốt hiện có được dựng ra để chặn cho `unreadCount`.

`applyMessageRecalled` cũng phải chạm: thu hồi ĐÚNG tin cuối ⇒ `lastMessage.kind = 'recalled'`,
`excerpt = null`. So bằng **`senderId` + `roomSeq`**? Không — `lastMessage` không mang `roomSeq`. So bằng
`message.roomSeq === room.lastMessageSeq` trên hàng tin trong `messagesByRoom`. Tin bị thu hồi không nằm
trong RAM ⇒ **không đụng** `lastMessage` (lần refetch REST sau sẽ đúng). Che thiếu ở đây **không** rò nội
dung: `applyMessageRecalled` đã xoá `body` khỏi tin trong danh sách; preview là bản sao đã cắt của một tin
người dùng **đang có trên máy mình**.

### 5b. `chat-preview.ts` phía FE — bản SONG SONG có ratchet

Preview vá cục bộ phải cho ra **cùng chuỗi** với bản server, nếu không dòng phòng nhảy chữ mỗi lần refetch.
`apps/app` không import được `apps/api` ⇒ **nhân bản có kiểm soát**, đúng khuôn `chat-link-extract.ts` (BE)
↔ `splitTextWithLinks` (FE) mà BE-2 đã dựng ratchet.

- `previewFromMessage(message, )` — 5 nhánh **cùng thứ tự** với `buildLastMessagePreview`.
- `CHAT_PREVIEW_MAX_GRAPHEMES = 120` + `Intl.Segmenter` + strip `\p{Cc}\p{Zl}\p{Zp}` (**KHÔNG** `\p{Cf}` —
  ZWJ giữ cụm emoji lại với nhau).
- **Ca ratchet:** spec đọc `apps/api/src/chat/chat-preview.ts` bằng `readFileSync` và assert literal hằng
  số + literal regex **trùng nguyên văn**. Trôi một bên ⇒ ĐỎ có tên file, không phải một dòng preview lệch
  120 ký tự mà không ai để ý.

---

## 6. testTask

| # | Ca | Tầng |
| --- | --- | --- |
| 1 | `filterRoomsByChip`: từng chip trả đúng tập; `unread` đi qua `isRoomUnreadLooking` (phòng `markedUnreadAt` + `unreadCount:0` **có** trong tập) | unit |
| 2 | **bất biến 1-node**: với MỌI chip, `id` trong kết quả không trùng lặp (kể cả phòng vừa ghim vừa chưa đọc) | unit |
| 3 | chip ≠ `all` ⇒ **giữ nguyên thứ tự đầu vào**, ghim KHÔNG được đẩy lên đầu | unit |
| 4 | `previewFromMessage`: 5 nhánh + `text` kèm tệp vẫn ra `kind:'text'` với `attachmentCount>0` | unit |
| 5 | **ratchet parity** BE↔FE: hằng 120 + regex control-char + thứ tự nhánh | unit |
| 6 | `roomDisplayName`: DM có `peer.name` ⇒ tên peer **không cần `members`**; có CẢ hai ⇒ `members` thắng | unit |
| 7 | store: `chat:message` mới ⇒ `room.lastMessage` đổi; tin **CŨ** (`roomSeq ≤ lastMessageSeq`) ⇒ **KHÔNG** đổi | unit |
| 8 | store: thu hồi ĐÚNG tin cuối ⇒ `kind:'recalled'`+`excerpt:null`; thu hồi tin GIỮA ⇒ `lastMessage` nguyên vẹn | unit |
| 9 | panel: chip «Chưa đọc» ⇒ danh sách phẳng, **0** tiêu đề mục; chip «Tất cả» ⇒ mục cố định trở lại | component |
| 10 | panel: chip «Lưu trữ» ⇒ gọi `listRooms({archived:true})` (thay ca `showArchived` cũ) | component |
| 11 | panel: **mỗi phòng ĐÚNG 1 node** ở chip phẳng (đếm NODE `chat-room-item`) | component |
| 12 | panel: DM hiện `peer.name` **ngay khung hình đầu** (store chưa có `members` nào) | component |
| 13 | panel: preview «Bạn: …» cho tin của mình · «Tên: …» cho phòng nhóm · **không tiền tố** cho DM của peer | component |
| 14 | panel: `kind:'recalled'` ⇒ chữ «đã được thu hồi», KHÔNG rỗng; `lastMessage:null` ⇒ dòng preview rỗng | component |
| 15 | panel: `peer.isActive === false` ⇒ nhãn «Ngừng hoạt động»; `presenceByUser[peer.userId]` ⇒ chấm online | component |
| 16 | panel: chip KHÔNG lưu — unmount/mount lại ⇒ về «Tất cả» (trạng thái THU mục thì VẪN nhớ) | component |
| 17 | `chat-dock.store`: `closeRoom`/evict dọn **HAI** map (ca cũ giữ, bớt `resolvedNames`) | unit |

**Trần dưới:** `RoomListPanel.spec.tsx` ≥ 35 ca sau khi sửa.

---

## 7. Đích hội tụ

- `pnpm --filter @mediaos/app test` xanh · `pnpm typecheck` xanh (app + contracts + web-core)
- `grep -rn "resolvedNames" apps/app/src` ⇒ **0 dòng**
- `bash harness/check.sh` xanh (LIGHT gate: `typescript-reviewer` + `react-reviewer`)
- `docs/TESTABLE-FEATURES.md` không đổi ở WO này (QA-1 mới ghi nghiệm thu wave)

---

## 8. Bằng chứng đo được (10/09/2026)

| Đo | Kết quả |
| --- | --- |
| `pnpm --filter @mediaos/app typecheck` | **xanh** |
| `pnpm --filter @mediaos/app test` (toàn app) | **264 file · 2545 ca PASS** |
| `RoomListPanel.spec.tsx` | **35 ca** (trần dưới GIỮ) — v2 nằm ở file riêng `RoomListPanel.v2.spec.tsx` **19 ca**, khuôn `MessageList.grouping.spec.tsx` |
| spec mới | `room-list-filter.spec.ts` 13 · `chat-preview.spec.ts` 12 · `chat-preview.parity.spec.ts` 6 · `chat-format.spec.ts` +7 · `chat.store.spec.ts` +6 |
| `grep -rn "resolvedNames" apps/app/src` | **0 dòng code** (chỉ còn comment lịch sử ở 6 file) |
| **RED đo tay — ratchet parity không xanh-RỖNG** | đột biến FE `CHAT_PREVIEW_MAX_GRAPHEMES 120 → 119` **VÀ** xoá nhánh `system` ⇒ `chat-preview.parity.spec.ts` **2/6 ĐỎ** (nêu đích danh trần + thứ tự nhánh). Khôi phục từ bản chép ở scratchpad ⇒ `diff` **byte-giống**, 18/18 xanh lại |

### Ba điều lệch với dự đoán ban đầu — ghi để không ai suy diễn nhầm

1. **`attachmentCount` phải đọc CỘT, không đọc `attachments.length`.** Bản server lấy
   `lastMessage.attachmentCount` (cột đếm lúc INSERT) qua LATERAL. Tin đã thu hồi giữ
   `attachmentCount: 2` nhưng `attachments: []` (lớp che §13.6) ⇒ đọc mảng ở FE làm dòng preview nhảy
   từ «2 tệp» về «0 tệp» rồi trở lại sau refetch. Đã sửa + có ca test riêng.
2. **Ratchet parity phải BỎ DÒNG COMMENT trước khi so.** Lượt đầu ca «không bản nào đọc
   `attachments.length`» **ĐỎ vì chính comment của tôi** giải thích luật bằng đúng literal đó (memory
   `vitest-exclude-selfcheck-reads-comments`). Thêm `codeOnly()` lọc theo dòng — tất định với hai file
   này vì chúng không có `//` nào nằm trong chuỗi/regex.
3. **`formatDistanceToNowStrict` KHÔNG nhận `now`.** Nó đọc thẳng `Date.now()`, nên một tham số `now`
   tiêm vào là chữ ký nói dối và ca test buộc phải dịch đồng hồ thật — thứ làm vỡ `socket.io-client` ở
   specs khác cùng module (memory `fake-timers-break-socketio-client-emit`). Dùng
   `formatDistanceStrict(d, now)`; hai hàm cho cùng chuỗi khi `now` là hiện tại. Có ca chứng minh `now`
   thực sự được dùng.

### Một lỗ do WO này mở ra và đã bịt trong cùng diff

**`POST /chat/rooms/direct` trả `peer: null`** (mapper mặc định — hai khoá v2 chỉ dựng ở `listRooms`),
nên DM VỪA TẠO mất tên cho tới lần nạp danh sách kế tiếp. Trước đây `resolvedNames` lấp chỗ đó bằng
chuỗi người dùng vừa gõ. Đã bịt bằng `invalidateQueries(chatKeys.rooms.list())` ở `onCreated` —
**không** bịt bằng một `peer` tự dựng: `peer` thiếu `userId`/`isActive` là DTO GIẢ, và mọi thứ đọc nó
(chấm online, nhãn «Ngừng hoạt động») sẽ nói sai về một người thật.

### Sửa `paths` của WO (đo thiếu lúc seed)

Thêm `apps/app/src/components/chat/chat-preview.ts` (bản FE của preview — file MỚI, không có trong seed)
và `apps/app/src/components/chat/ChatBadge.tsx` (đọc `resolvedNames` của dock store ⇒ **bắt buộc** phải
sửa cùng lượt, nếu không app không biên dịch được). Khuôn memory `wo-seed-hand-measurements-can-be-incomplete`.

---

## 9. Gate LIGHT (10/09/2026) — `typescript-reviewer` + `code-reviewer`

**Cả hai PASS · 0 CRITICAL · 0 HIGH.** 4 phát hiện, **vá HẾT trong cùng diff** (không ghi nợ):

| # | Sev | Phát hiện | Vá |
| --- | --- | --- | --- |
| 1 | LOW | `chat-preview.ts` FE so `recalledAt !== null`, BE so ĐỦ hai vế (`!== null && !== undefined`). Ratchet literal **không so được điều kiện guard** ⇒ lệch này vô hình | Khớp guard + **nới kiểu** `ChatPreviewSource.recalledAt` thêm `\| undefined` để vế thứ hai có NGHĨA (không phải code chết) + **thêm ca ratchet** neo cả hai vế |
| 2 | LOW | `RoomPreviewLine` ẩn dòng khi `body === "" && prefix === null` ⇒ tin rỗng-0-tệp **của mình** / trong **phòng nhóm** vẫn vẽ dòng cụt «Bạn: » | Xét `body` MỘT MÌNH; 2 ca test mới |
| 3 | MEDIUM | `RoomListPanel` phình ~370 dòng thân hàm / 670 dòng file (ngưỡng dự án: hàm <50, file 200–400) | Tách `RoomListHeader` + `RoomFilterChipBar` (đúng khuôn `RoomRow`/`RoomPreviewLine` đã có) |
| 4 | LOW | Hàng chip thiếu `role="group"` + nhãn ⇒ trình đọc màn hình nghe «Tất cả, nút, đang bật» mà không biết *tất cả CÁI GÌ* | `role="group"` + `rooms.chipsAria`; 1 ca test |

**Một điều gate KHÔNG nêu nhưng tôi sửa cùng lượt:** kẹp giấy trước chỉ vẽ ở nhánh `text`, lệch với ký
hiệu «📎 {{count}} tệp» của chính §4 plan này. Nay vẽ cho **cả** `text` lẫn `file` — nhưng **KHÔNG** cho
`recalled`/`system`: `attachmentCount` của tin đã thu hồi là số liệu LỊCH SỬ vẫn > 0 (§13.6 chỉ che
`attachments[]`), nên vẽ kẹp giấy ở đó là nói cho cả phòng biết tin vừa rút CÓ đính kèm. Có ca test.

**Sau vá:** typecheck xanh · lint xanh · `src/components/chat` + `src/routes/chat` + `src/stores`
**37 file / 565 ca PASS**.

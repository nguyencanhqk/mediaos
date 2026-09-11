# S17-CHAT-UX2-FE-5 — Drawer chat DEC-026 + `/chat` responsive

> WO: `S17-CHAT-UX2-FE-5` · zone 🟡 LIGHT · phụ thuộc FE-1, FE-2 (đã merge)
> Spec: SPEC-15 §9 CHAT-SCREEN-001/002 v2 · §22c CHAT-DEC-026
> Plan wave: `docs/plans/S17-CHAT-UX2-WAVE.md` (G12 · DEC-026)
> **v3 — sau 2 vòng `plan-reviewer`.** V1 BLOCK (8 chặn). V2 BLOCK (4 chặn, **2 do chính bản vá v2 đẻ
> ra** — bài học `plan-review-rounds-inject-new-holes`). §13 = đối chiếu vòng 1, §15 = đối chiếu vòng 2.
> Đổi lớn nhất ở v3: **BỎ hẳn hướng "Esc capture-phase"** — thay bằng đánh dấu DOM, không phụ thuộc thứ
> tự đăng ký listener và không cướp Esc của `Dialog`/`Sheet` con.

---

## 0. Trạng thái nhánh trước khi bắt đầu (đã đo 10/09/2026)

- `master` = `27f7486e`, nhánh `wo/s17-chat-ux2-fe-5`, working tree SẠCH.
- FE-1/FE-2/FE-3/FE-4 + BE-1/BE-2 đã merge hết (#494–#498). FE-5 là WO **cuối cùng có code** của wave;
  sau nó chỉ còn QA-1 (nghiệm thu).
- Vì FE-5 **xoá** `ChatDock`/`ChatDockWindow`, mọi thứ QA-1 sẽ đo (snapshot, coverage `components/chat`,
  axe, 3 breakpoint) phải khớp hình thái MỚI. Không để lại file chết cho QA-1 dọn.

---

## 1. Hiện trạng đã đếm (không đoán)

| File | Kích thước | Vai trò hôm nay | Sau FE-5 |
| --- | --- | --- | --- |
| `ChatDock.tsx` | 88 dòng | dải cố định đáy phải, `hidden md:flex`, ẩn trên `/chat`, lazy `ChatDockWindow` | **XOÁ** |
| `ChatDockWindow.tsx` | 159 dòng | 1 cửa sổ nổi: thanh tiêu đề (thu nhỏ/⤢/đóng) + `ConversationPanel showHeader={false}` | **XOÁ** |
| `ChatDock.spec.tsx` | 6 ca | khung dock | **XOÁ**, chuyển 5 / bỏ 1 — §1.2 |
| `chat-dock.store.ts` | 127 dòng | `openRoomIds` (trần 1) · `minimizedRoomIds` · `toggleMinimize` | GIỮ tên file + `openRoom`/`closeRoom`; **THÊM** `isOpen`; **GỠ** `minimized*` |
| `chat-dock.store.spec.ts` | 7 ca | 5/7 ca chạm `minimized*` (`:39 :52 :62 :73` + `:79`) | giữ 2, viết lại 2, xoá 3 — §3.1 |
| `use-dock-viewport.ts` | 37 dòng | `useHasDockViewport()` — consumer DUY NHẤT là `ChatBadge` | **THAY** bằng `use-chat-viewport.ts` |
| `ChatBadge.tsx` | 193 dòng | dropdown 8 phòng; ≥md ⇒ `openRoom`, <md ⇒ `navigate('/chat')`; trên `/chat` chỉ báo TĨNH | bấm ⇒ **mở drawer**; bỏ dropdown; giữ chỉ báo tĩnh trên `/chat*` |
| `RoomListPanel.tsx` | 30.5 KB | `<aside class="w-72 border-r">`; `onOpenSearch`/`onCreateRoom` **bắt buộc**; `query`(`:83`)/`chip`(`:89`) state NỘI BỘ | `variant`; 2 handler tuỳ chọn; `query`/`chip` controlled tuỳ chọn (§4.1) |
| `RoomInfoPanel.tsx` | 22.7 KB | `<aside class="w-80 border-l">`; render `RoomMembersSheet`(`:437`) + 2 `ConfirmDialog`(`:472,:484`) | cột `w-[340px]`; trong Sheet thì bỏ viền |
| `MessageSearchPanel.tsx` | 9.7 KB | `<aside class="w-96 border-r">` | thêm `className` |
| `ConversationHeader.tsx` | 129 dòng | không có ‹; `callSlot` chỉ render khi `showHeader` | thêm `onBack?` |
| `ConversationPanel.tsx` | 22.8 KB | Esc `:295` bubble/`document`, deps `[replyTo, isInfoOpen, …]`(`:320`); root `<section>` không có testid | `onBack?` · `escapeClosesInfo?` · dấu `data-escape-claim` · `data-testid="chat-conversation"` |
| `MessageComposer.tsx` | 18.4 KB | `draft` là `useState` cục bộ (`:96`) — unmount là MẤT | không đổi (xem §4.3) |
| `MentionPopover.tsx` | `<ul>` thuần | **KHÔNG** phát `data-floating-layer` — lớp nổi DUY NHẤT trong CHAT còn thiếu | phát dấu (§3.5) |
| `ChatPage.tsx` | 315 dòng | 3 cột CỨNG `h-[calc(100vh-4rem)]` | 3 mốc responsive |
| `packages/ui/.../sheet.tsx` | 190 dòng | Esc `:84-93` không xét `defaultPrevented`; `hasNestedModal`(`:76`) đã tìm `[data-floating-layer]` + dialog con TRONG panel; nền `:141` đóng khi bấm | `leading?` · `bodyClassName?` · `closeOnBackdrop?` · Esc nhường thêm 2 điều kiện |

### 1.1 Bốn thứ FE-2/FE-3 đã dọn đường sẵn — dùng, đừng dựng lại

1. `ConversationPanel.showHeader={false}` + `onSearchInRoom` **đã** tuỳ chọn, docblock ghi thẳng "drawer
   của FE-5".
2. `ConversationHeader` là component **thuần** — docblock nói rõ nó tách ra để FE-5 dùng lại.
3. `chatKeys.rooms.detail(roomId)` dùng CHUNG giữa dock và `/chat` ⇒ không sinh request thứ hai.
4. `room.peer.name` (BE-1) đã ở store từ `GET /chat/rooms` ⇒ nhãn DM dựng tại chỗ, KHÔNG cache.

### 1.2 `ChatDock.spec.tsx` — cái nào CHUYỂN, cái nào CHẾT

| Ca | Số phận |
| --- | --- |
| `:75` mở phòng thứ hai ⇒ đúng MỘT cửa sổ, là phòng vừa bấm | **CHUYỂN** → T6 |
| `:91` KHÔNG render trên `/chat` nhưng GIỮ state | **CHUYỂN** → T2 (+ siết `startsWith`) |
| `:102` thiếu `access:chat` ⇒ không render gì | **CHUYỂN** → T1 |
| `:119` phòng biến khỏi store ⇒ tự đóng | **CHUYỂN** → T8 (đổi kết cục: pop về danh sách) |
| `:134` chưa nạp xong danh sách ⇒ KHÔNG đóng | **CHUYỂN** → T8b |
| `:111` container `pointer-events-none` | **CHẾT** — không còn dải cố định đáy màn |

---

## 2. Bất biến PHẢI giữ — đo bằng test, không bằng lời

| # | Bất biến | Vì sao | Test |
| --- | --- | --- | --- |
| B1 | **KHÔNG render trên `/chat` VÀ `/chat/*`** | `useChatConversation` không đếm tham chiếu: 2 instance cùng phòng ⇒ cái unmount trước `clearInterval` lưới bù tin của cái còn sống + cắt lịch sử về 200 tin, im lặng tuyệt đối (memory `chat-conversation-hook-not-refcounted`) | T2 + T2b |
| B2 | **Đúng 1 hội thoại** tại 1 thời điểm | owner chốt 05/08, `MAX_DOCK_WINDOWS = 1` | T9 (store) **và** T6 (DOM, §3.7) |
| B3 | **Không socket thứ hai** | `/ws` chở cả `chat:*` lẫn `notification:*` (memory `chat-fe-single-socket-file`) | ESLint `no-restricted-imports`; không file mới nào import `socket.io-client` |
| B4 | `useChatRealtime` **đúng 1 lần** ở `ProtectedShell` | cùng lý do B3 | `ProtectedShell.spec:121`. ⚠️ spec đó mock `@tanstack/react-router` **không** `importOriginal` ⇒ `ChatDrawer` **chỉ được dùng `useNavigate` + `useRouterState`** |
| B5 | **key `conv-`/`info-`** phân biệt hai anh em | trùng key ⇒ node cũ không bị gỡ, ĐÃ RA PROD (memory `duplicate-sibling-key-leaks-dom-node`) | `ChatPage.spec:225` giữ NGUYÊN |
| B6 | Lazy chunk cho phần nặng | drawer ở app shell = bundle khởi động của MỌI người (memory `console-had-zero-code-splitting`) | §3.6 |
| B7 | Push/pop trong drawer **unsubscribe đúng** | rò `pollIntervalId` = interval 10s sống tới khi reload | T5 |
| B8 | **Cổng đọc của drawer = cổng đọc của `/chat`** | `/chat` gate `view:chat-room` (`ChatPage.tsx:33,142`); `access:chat` chỉ là cổng NAV (`constants.ts:18`). Drawer bày CÙNG bề mặt đọc ⇒ phải cùng cặp (`read-path-gate-pair-must-match-download-pair`) | T1 (§4.2) |
| B9 | Đổi mốc responsive **không** remount cột hội thoại | remount ⇒ `trimRoomHistory` cắt về 200 tin + mất nháp | T12d (§3.8) |
| B10 | **Esc / bấm nền không được nuốt việc của lớp trong cùng** | một lần Esc đóng hai lớp = mất nháp, đúng lớp lỗi WO này sinh ra để tránh | T7c · T7d · T12e · T14c |

---

## 3. Kiến trúc

```text
components/chat/
  ChatDrawer.tsx                (MỚI ~110) gate access:chat + pathname + isOpen + VỎ Sheet + lazy thân
  drawer/
    ChatDrawerBody.tsx          (MỚI ~160) gate view:chat-room; giữ query/chip; danh sách ↔ hội thoại
    ChatDrawerConversation.tsx  (MỚI ~90)  detail query (enabled: canViewRoom) + ConversationPanel
  chat-dock.store.ts            (SỬA) + isOpen/openDrawer/closeDrawer/toggleDrawer, − minimized*
  use-chat-viewport.ts          (MỚI ~60)  useChatLayoutMode(): "three" | "two" | "single"
  use-dock-viewport.ts          (XOÁ)
  ChatDock.tsx · ChatDockWindow.tsx · ChatDock.spec.tsx   (XOÁ)
```

### 3.1 `chat-dock.store.ts` — giữ tên file, đổi ruột

`done_when` nói thẳng «`chat-dock.store` giữ API `openRoom`/`closeRoom`». Đổi tên file là diff rác chạm
mọi import cho đúng một danh từ, trong khi WO này đã xoá 3 file.

```ts
isOpen: boolean
openRoomIds: readonly string[]  // ≤ MAX_DOCK_WINDOWS === 1, GIỮ NGUYÊN luật thay-chỗ
openDrawer() / closeDrawer() / toggleDrawer()
openRoom(id)   // + isOpen = true — KỂ CẢ nhánh "phòng đã mở sẵn" (`:78-82` hiện `return state`)
closeRoom(id)  // GIỮ isOpen = true → pop về DANH SÁCH
resetChatDock()
```

`closeDrawer()` **KHÔNG** xoá `openRoomIds` — đóng rồi mở lại phải về đúng chỗ đang đọc dở.
`minimizedRoomIds` + `toggleMinimize` **GỠ HẲN** (`write-only-column-means-delete-not-wire-up`).

| Ca spec | Số phận |
| --- | --- |
| `:24` THAY CHỖ (chứa `expect(MAX_DOCK_WINDOWS).toBe(1)`) | **GIỮ NGUYÊN** — chỗ DUY NHẤT đóng đinh trần |
| `:39` mở lại phòng đang thu nhỏ | **XOÁ** |
| `:52` `closeRoom` dọn CẢ HAI map | **VIẾT LẠI**: gỡ khỏi `openRoomIds` **và** `isOpen` GIỮ `true` |
| `:62` THAY CHỖ để lại KHÔNG state | **XOÁ** — sau khi gỡ `minimized*` là bản sao y hệt `:24` ⇒ xanh-RỖNG |
| `:73` `toggleMinimize` | **XOÁ** |
| `:79` `resetChatDock` | **VIẾT LẠI** (+ `isOpen === false`) |
| `:95` không có cache tên phòng | **GIỮ** |

### 3.2 `use-chat-viewport.ts`

```ts
export const CHAT_MD_QUERY = "(min-width: 768px)";
export const CHAT_XL_QUERY = "(min-width: 1280px)";
export type ChatLayoutMode = "single" | "two" | "three";
export function useChatLayoutMode(): ChatLayoutMode;
```

- **Hai `matchMedia` đọc trong CÙNG một state.** Hai `useState` độc lập sinh khung hình `xl=true, md=false`
  (bất khả thi vật lý).
- **Fail-soft `"three"` khi vắng `matchMedia`** — và đây KHÔNG chỉ là chi tiết phòng thủ: `src/test/setup.ts`
  **không** polyfill `matchMedia`, jsdom cũng không có ⇒ **16 ca `ChatPage.spec.tsx` hiện có sống sót bước
  10 chính nhờ nhánh này**. Vì thế phải có **ca ratchet T11d**: «vắng `matchMedia` ⇒ `"three"`». Ngày ai đó
  thêm polyfill `matchMedia` (`matches:false`) vào `setup.ts`, mọi ca `/chat` sẽ lặng lẽ chạy ở mốc `single`
  và không có gì đỏ để báo.

### 3.3 `packages/ui/sheet.tsx` — ba prop additive + hai điều kiện nhường Esc

```ts
leading?: React.ReactNode        // đứng TRƯỚC khối tiêu đề (nút ‹)
bodyClassName?: string           // đè `px-5 py-4 overflow-y-auto`
closeOnBackdrop?: boolean        // mặc định true — drawer chat truyền false (§4.3)
```

Esc bail thêm: `e.defaultPrevented === true` **hoặc** `document.querySelector('[data-escape-claim="open"]')`
(§3.5). Mặc định không đổi ⇒ 0 consumer hiện tại bị ảnh hưởng.

⚠️ `tailwind-merge@2.6.1` có `conflictingClassGroups.overflow` ⇒ `overflow-hidden` đè `overflow-y-auto`,
và `w-full max-w-none md:max-w-[400px]` đè `max-w-2xl` (`:147`). **Phải có ca riêng cho vế overflow**
(T14b): thiếu nó thì một lần nâng version là hỏng im lặng.

**Rủi ro hồi quy — đã rà, KHÔNG có.** Ba chỗ duy nhất bắt Esc bên trong cây `Sheet` ở app đều đã
`stopPropagation()` (`TaskInlineFields.tsx:482`, `SubtaskInlineControls.tsx:316`, `KanbanQuickCreate.tsx:83`)
⇒ sự kiện dừng ở React root, chưa từng tới `document`, nên `Sheet` chưa bao giờ thấy chúng. Cả ba vá đều
là **nới điều kiện bail một chiều**. Vẫn phải chạy `src/routes/tasks` + `src/routes/rooms` ở §12.

### 3.4 Vì sao drawer dùng `Sheet` chứ không tự vẽ

DEC-026 chỉ đích danh `Sheet`; `done_when` #4 đòi focus-trap + Esc. `Sheet` đã có focus-trap vòng Tab, trả
focus về phần tử kích hoạt, và hợp đồng nhường lớp con. Tự vẽ = viết lại ba thứ đó lần thứ hai.

### 3.5 Esc — cơ chế ĐÁNH DẤU DOM (v3 thay hẳn hướng capture của v2)

**Vấn đề đo được.** `sheet.tsx:84-93` nghe Esc trên `document`, không xét `defaultPrevented`; `Sheet`
**không phát** `data-floating-layer` (chỉ `popover.tsx:128` phát). Trong drawer có hai thứ cùng ăn Esc:

| Nguồn | Hôm nay | Hậu quả trong drawer |
| --- | --- | --- |
| `ConversationPanel.tsx:295-310` Esc huỷ `replyTo` rồi đóng info | `preventDefault()`, nghe bubble/`document` | một lần Esc: huỷ trả lời **và** đóng drawer ⇒ **mất nháp** |
| `use-mention-autocomplete.ts:284` Esc đóng gợi ý `@` | `preventDefault()` trong `onKeyDown` textarea; `MentionPopover` KHÔNG phát dấu | một lần Esc: đóng gợi ý **và** đóng drawer |

**Vì sao KHÔNG dùng `{ capture: true }` (hướng của v2 — ĐÃ BỎ).** Capture làm `ConversationPanel` chạy
trước MỌI listener bubble trên `document`, tức nó thắng cả `Dialog` (`dialog.tsx:56-63` đóng Esc **vô điều
kiện**, không xét gì) lẫn `Sheet` con. Cấu hình có thật: ở mốc `two`/`single`, `RoomInfoPanel` nằm TRONG
info-Sheet và nó render `RoomMembersSheet` (`:437`) + 2 `ConfirmDialog` (`:472`, `:484`). Mở «Thành viên ›»
rồi Esc ⇒ `ConversationPanel` (capture) đóng luôn info-Sheet. Capture biến một lỗi *ngẫu nhiên theo thứ tự
đăng ký* thành **tất định**. Bỏ.

**Ba vá của v3 — tất cả đều là truy vấn DOM, KHÔNG phụ thuộc thứ tự đăng ký:**

1. `MentionPopover` phát `data-floating-layer="open"` khi có gợi ý. Dùng LẠI hợp đồng đã có ⇒ cả `Sheet`
   lẫn `ConversationPanel` tự nhường. Đây là lớp nổi **duy nhất** trong CHAT còn thiếu dấu — `EmojiPicker`,
   `MessageActions`, `RoomRowMenu`, picker của `RoomInfoPanel` đều đã đi qua primitive `Popover`.
   _(Liếc khi code: `ReactionBar.tsx:104` là dải `absolute` không phải Popover — xác nhận nó không nghe Esc.)_
2. `ConversationPanel` render `data-escape-claim="open"` trên dải "đang trả lời" khi `replyTo !== null`;
   `Sheet` bail Esc khi thấy dấu đó **ở bất kỳ đâu trong tài liệu**. Truy vấn tài liệu (không phải trong
   panel) là chủ ý: ở mốc `two`, dải trả lời nằm ở cột hội thoại — NGOÀI panel của info-Sheet — mà info-Sheet
   vẫn phải nhường. Ngữ nghĩa: **lớp trong cùng ăn Esc trước; Esc lần hai mới tới lớp ngoài.**
3. `Sheet` bail Esc khi `e.defaultPrevented` — dây an toàn thứ hai, vô hại.

⚠️ Vá (1) cũng tắt focus-trap Tab của `Sheet` trong lúc gợi ý `@` mở (`sheet.tsx:112` dùng chung
`hasNestedModal`). Vô hại: Tab lúc đó đã bị `handleKeyDown` của composer nuốt để chọn gợi ý. Ghi ra vì
`done_when` #4 có đòi focus-trap.

**Double-toggle info Sheet KHÔNG do cơ chế trên xử — dùng prop tường minh.** Ở mốc `two`/`single`, Esc mà
để cả `Sheet.onClose` (`setInfoSheetOpen(false)`) lẫn `ConversationPanel` (`onToggleInfo` → `v => !v`) cùng
chạy thì React gộp batch: `false` rồi `!false = true` ⇒ **Sheet không bao giờ đóng bằng Esc**. Vì vậy:

```ts
escapeClosesInfo?: boolean   // mặc định true (mốc three · hành vi hôm nay)
```

`ChatPage` truyền `false` khi `mode !== "three"` — Sheet là chủ Esc ở đó. Một boolean tường minh, không có
nhánh nào phụ thuộc thứ tự.

### 3.6 Lazy: vỏ đi cùng shell, chỉ THÂN hoãn tải

Để cả thân (đã chứa `Sheet`) trong `lazy()` thì trên mạng chậm, bấm badge = **không thấy gì** vài trăm ms.
Vì vậy `ChatDrawer.tsx` (đi cùng shell) giữ gate + `isOpen` + `<Sheet>` + skeleton; `lazy()` chỉ chở
`ChatDrawerBody`. `Sheet` vốn đã ở bundle shell (`ProtectedShell.tsx:20` import `@mediaos/ui`) và không kéo
thêm gì ngoài `lucide-react/X` sẵn có.

### 3.7 Thân drawer render `openRoomIds.map(...)` — CHỦ ĐÍCH, không phải tiện tay

Nếu thân chỉ đọc phần tử cuối (`openRoomIds.at(-1)`) thì DOM luôn có đúng 1 node **bất kể trần là bao
nhiêu** ⇒ T6 thành tautology, không đột biến nào giết được nó (`tests-can-pin-a-hole-open`). Cho thân
`.map` toàn mảng thì DOM là ảnh chiếu TRUNG THỰC của store: trần là chính sách DUY NHẤT, đặt ở store, và
đột biến «nới `MAX_DOCK_WINDOWS` lên 2» làm **T6 đỏ thật** (2 node). Tiêu đề Sheet đọc phần tử cuối.

### 3.8 «Đổi mốc không remount» — đo bằng ĐỊNH DANH NODE, không bằng `subscribedRoomIds`

`use-chat-conversation.ts:68-111`: unmount gỡ khoá, mount thêm lại; React chạy passive-unmount TRƯỚC
passive-mount trong CÙNG commit ⇒ `subscribedRoomIds` **kết thúc y hệt dù có remount hay không**. Khẳng
định đúng là **định danh node DOM**: `expect(screen.getByTestId("chat-conversation")).toBe(nodeTrước)`
(vì vậy phải thêm `data-testid="chat-conversation"` lên `<section>` gốc của `ConversationPanel`), kèm
đếm số lần `subscribeToRoom` === 1.

---

## 4. Drawer — hành vi từng nút

| Thao tác | Kết quả |
| --- | --- |
| Bấm `ChatBadge` (mọi trang trừ `/chat*`) | `toggleDrawer()`. KHÔNG navigate ở bất kỳ bề rộng nào |
| Drawer mở, chưa chọn phòng | Sheet tiêu đề «Tin nhắn», thân = `RoomListPanel variant="drawer"` |
| Bấm một phòng | `openRoom(id)` ⇒ thân đổi sang hội thoại (push). Sheet: `leading` ‹ · tiêu đề tên phòng · `description` số thành viên · `actions` ⤢ |
| Bấm ‹ | `closeRoom(id)` ⇒ về danh sách **giữ nguyên câu lọc + chip** (§4.1), drawer VẪN mở |
| Bấm phòng khác | trần 1 ⇒ THAY CHỖ (B2) |
| Bấm ⤢ | `navigate('/chat')` **và** `closeDrawer()`. Lý do là **nhất quán UX**, không phải kỹ thuật: `ChatDrawer` đã `return null` trên `/chat*` nên `isOpen` bật ở đó không tạo instance nào. Bỏ `closeDrawer()` thì rời `/chat` sang trang khác là drawer tự bung ra |
| Sau ⤢, ra trang khác | drawer đóng, `openRoomIds` GIỮ phòng cũ ⇒ mở lại về đúng chỗ đang đọc dở (chủ ý) |
| Esc | `closeDrawer()` — **trừ** khi có lớp trong cùng đang giữ Esc (§3.5) |
| ✕ | `closeDrawer()` |
| Bấm nền | **KHÔNG đóng** — `closeOnBackdrop={false}` (§4.3) |
| < `md` | `className="w-full max-w-none md:max-w-[400px]"` |
| Phòng biến khỏi store | effect: `hasLoadedRooms && roomsById[id] === undefined` ⇒ `closeRoom(id)` ⇒ **pop về danh sách, drawer VẪN mở** |

### 4.1 `query` + `chip` — controlled TUỲ CHỌN, không phải hai state

Push sang hội thoại = `RoomListPanel` unmount ⇒ bấm ‹ là **mất câu lọc vừa gõ và chip vừa chọn** — hỏng
đúng thứ `done_when` #1 vừa yêu cầu. Vì vậy `RoomListPanel` nhận `query`/`onQueryChange`/`chip`/`onChipChange`
**tuỳ chọn**; `ChatDrawerBody` giữ state ở tầng của nó. Ba ràng buộc bắt buộc:

1. Đọc bằng `??` **chứ không `||`** — `query === ""` là giá trị hợp lệ, `||` sẽ nuốt nó về state nội bộ.
2. Khi được điều khiển thì **không** `setState` nội bộ (nếu không: hai nguồn, lệch nhau lúc parent từ chối).
3. `chip` lái `showArchived` → `archivedQuery` (`:92`, `:108-119`). Pop về danh sách với chip «Lưu trữ»
   phải KHÔNG sinh `syncRoomList(…, true)` lặp vô ích — khẳng định số lần gọi trong T4b.

Không chọn "giữ list mounted, ẩn bằng CSS": list vẫn chạy `useQuery` + subscribe store trong lúc người dùng
đang đọc tin, và ẩn-bằng-CSS còn để lại nội dung trong cây a11y.

### 4.2 Cổng quyền của drawer — cặp ALLOW/DENY

```text
ChatDrawer              → useCan(access, chat)      // cổng NAV, giống ChatBadge
ChatDrawerBody          → useCan(view, chat-room)   // cổng ĐỌC, giống ChatPage.tsx:142
ChatDrawerConversation  → detail query `enabled: canViewRoom && …`   // mirror ChatDockWindow.tsx:51
```

Thiếu `view:chat-room` ⇒ thân drawer hiện `EmptyState` §14 (dùng lại chuỗi `forbidden.*`), KHÔNG hiện danh
sách phòng.

**KHÔNG phải hồi quy** — ghi rõ để người sau khỏi đi "sửa" cổng badge: `use-chat-realtime.ts:55` đã tự gate
`useCan("view","chat-room")`, nên người chỉ có `access:chat` **hôm nay đã thấy dropdown RỖNG** (store không
bao giờ được nạp). Đổi sang `EmptyState` là nói thật thay vì để trống.

⚠️ Chống cổng chồng nhau (`overdetermined-gate-makes-deny-spec-vacuous`): ca DENY `view:chat-room` phải chạy
với `access:chat = true` **và** `isOpen = true`. Và **bắt buộc** dùng
`mockUseCan.mockImplementation((action, resourceType) => …)` trả theo TỪNG CẶP — khuôn `mockReturnValue(bool)`
của `ChatDock.spec.tsx:33` / `ChatBadge.spec.tsx:77` là mock **chăn**, không viết nổi ca này
(`sensitive-pair-widget-needs-usecanexact`). `ChatPage.spec.tsx:93` đã có khuôn đúng — chép từ đó.

### 4.3 Nháp: drawer thêm đường đóng vô tình mà dock cũ không có

`MessageComposer.tsx:96` giữ `draft` bằng `useState` cục bộ ⇒ unmount là mất. Dock cũ đóng bằng ✕ (cũng
mất nháp — **không phải hồi quy**), nhưng KHÔNG có nền phủ và KHÔNG nghe Esc. `sheet.tsx:141` cho **bấm nền
là đóng** — đường mất-nháp HOÀN TOÀN MỚI, và là loại click trượt tay. Vì vậy drawer chat truyền
`closeOnBackdrop={false}` (§3.3). Esc/✕ giữ nguyên (ngang dock cũ) và Esc còn được §3.5 che khi đang trả lời.

### 4.4 `variant="drawer"` của `RoomListPanel` nghĩa là gì (định nghĩa, không để mở)

| Thuộc tính | `page` (mặc định) | `drawer` |
| --- | --- | --- |
| Bề ngang | `w-72` → **`w-80`** (320, §5) | `w-full` |
| Viền phải | `border-r` | không |
| Ô lọc theo tên + chip | có | có |
| Nút mở CHAT-SCREEN-005 (tìm nội dung tin) | có | **ẩn** (`onOpenSearch` không truyền) |
| Nút «Tin nhắn mới» | có (theo `create:chat-room`) | **ẩn** (`onCreateRoom` không truyền) |
| Chia mục / chiều cao dòng / `RoomRowMenu` / preview | KHÔNG ĐỔI | KHÔNG ĐỔI |

⚠️ Handler tuỳ chọn ⇒ **nút phải BIẾN MẤT**, không được render nút vô hiệu hay nút không làm gì
(`ui-promises-backend-never-reads`). T4c đo.

---

## 5. `/chat` responsive — ba mốc

| Mốc | Danh sách | Hội thoại | Thông tin phòng |
| --- | --- | --- | --- |
| `three` (≥1280) | cột `w-80` (320) | `flex-1` | cột `w-[340px]`, mặc định MỞ |
| `two` (768–1279) | cột `w-80` | `flex-1` | **Sheet** (nút ⓘ), mặc định ĐÓNG |
| `single` (<768) | full width khi chưa chọn phòng | full width + ‹ khi đã chọn | **Sheet toàn màn** (`max-w-none`) |

### 5.1 Hai state cho "info đang mở", KHÔNG một

```ts
const [isInfoColumnOpen, setInfoColumnOpen] = useState(true);   // mốc three
const [isInfoSheetOpen,  setInfoSheetOpen]  = useState(false);  // mốc two/single
```

Một state chung mặc định `true` sẽ bung một Sheet che kín hội thoại ngay khi mở trang ở màn 1024px. Một
`useEffect` "đóng hộ" thì ghi đè ý định người dùng mỗi lần xoay máy.
`ConversationPanel` vẫn nhận `isInfoOpen` = state đang hiệu lực + `onToggleInfo` ở cả ba mốc (để
`aria-pressed` đúng), kèm `escapeClosesInfo={mode === "three"}` (§3.5).

### 5.2 `RoomInfoPanel` render ĐÚNG MỘT LẦN — nhưng đây KHÔNG phải "không remount"

Dựng `const infoPanel = <RoomInfoPanel key={…} … />` rồi đặt vào **một** trong hai khe cố định. Hai
`RoomInfoPanel` sống song song sẽ chạy hai `listRoomFiles` cho cùng phòng ⇒ hai hàng `file_access_logs`.

⚠️ Gán vào `const` **không** cứu được remount khi vượt mốc 1280: hai khe là hai vị trí khác nhau trong cây,
React sẽ unmount+mount ⇒ mất nháp đổi tên/mô tả đang gõ trong `RoomInfoPanel`. **Chấp nhận** (đổi bề rộng
cửa sổ giữa lúc đang sửa tên phòng là ca hiếm), chỉ không được hứa sai trong docblock.

### 5.3 Mốc `single`: danh sách · tìm kiếm · hội thoại LOẠI TRỪ nhau

`ChatPage.tsx:171-195` render `MessageSearchPanel` **thay** `RoomListPanel` nhưng **song song** với
`ConversationPanel`; `jumpToMessage` (`:119`) tự `setSelectedRoomId` ⇒ ở mốc `single` bấm một kết quả là có
ngay **hai vùng cùng `w-full`**. Luật (hàm thuần, test được):

```text
pane = isSearchOpen ? "search" : selectedRoomId === null ? "list" : "conversation"
```

Bấm một kết quả ⇒ `setSearchOpen(false)` (CHỈ ở mốc `single`) để đi thẳng tới hội thoại có ‹.

### 5.4 Chiều cao

`h-[calc(100vh-4rem)]` là số ma bám vào topbar `h-14` (56px ≠ 4rem = 64px — LỆCH 8px). Đổi sang
`h-full min-h-0`, để `ProtectedShell` (`flex h-dvh` + `flex min-h-0 flex-1`) cấp chiều cao. `100vh` còn cắt
cụt ô soạn tin trên iOS Safari — `dvh` ở shell đã xử lý đúng.

### 5.5 Cây JSX giữ nguyên vị trí qua 3 mốc (B9) — viết thế nào cho ĐÚNG

React giữ index cho children **tĩnh**, và `false`/`null` KHÔNG làm dịch chỗ. Vì vậy dùng các khe cố định:

```text
vị trí 0: {showList && <RoomListPanel …/>}          // single + đã chọn phòng ⇒ false, KHÔNG dịch chỗ
vị trí 1: {showSearch && <MessageSearchPanel …/>}
vị trí 2: <ConversationPanel …/>                    // LUÔN ở vị trí này, chỉ className đổi
vị trí 3: {mode === "three" && isInfoColumnOpen && infoPanel}
vị trí 4: {mode !== "three" && <Sheet open={isInfoSheetOpen}…>{infoPanel}</Sheet>}
```

TUYỆT ĐỐI KHÔNG: một ternary đổi type ở vị trí 2 (`mode==="three" ? <ConversationPanel/> : <ConversationPanel/>`
là hai vị trí khác nhau) · **không** thêm `mode` vào `key` của `ConversationPanel` · không bọc `ConversationPanel`
trong một wrapper chỉ tồn tại ở một mốc.

---

## 6. `ChatBadge` — bỏ dropdown

Dropdown là "một danh sách phòng thứ hai" mà chính docblock của nó cảnh báo; drawer nay LÀ danh sách đó,
đầy đủ hơn (chip lọc, tìm theo tên, preview, menu phòng).

- `pickDropdownRooms` / `DROPDOWN_ROOM_LIMIT` **chết theo** ⇒ gỡ khỏi `chat-unread.ts` + spec (grep 0
  trước khi xoá; `totalUnreadCount`/`formatUnreadBadge` GIỮ).
- Trên `/chat*`: **giữ chỉ báo TĨNH** (lệch L1). Ca `ChatBadge.spec.tsx:147` phải **siết thêm**
  `expect(useChatDockStore.getState().isOpen).toBe(false)` — thiếu vế đó thì người sau "sửa cho đúng
  `done_when`" và tái sinh B1 mà không có gì đỏ.

---

## 7. testTasks — RED trước ở những ca có thể xanh-RỖNG

| # | File | Ca | Vì sao không xanh-RỖNG |
| --- | --- | --- | --- |
| T1 | `ChatDrawer.spec.tsx` | `access:chat=false` ⇒ rỗng · `access=true, view:chat-room=false, isOpen=true` ⇒ **EmptyState §14, KHÔNG có danh sách** · cả hai true ⇒ danh sách hiện. **Bắt buộc `mockImplementation` theo CẶP** (§4.2) | ba ca = bộ ALLOW/DENY đủ; ca giữa chống cổng-chồng-nhau |
| T2 | idem | `/chat` ⇒ không render, `isOpen` GIỮ `true` | khẳng định ĐỦ CẶP |
| T2b | idem | `/chat/abc` ⇒ không render | `ChatDock.tsx:67` cố ý có `startsWith` |
| T3 | idem | `isOpen=false` ⇒ rỗng; `openDrawer()` ⇒ danh sách hiện | |
| T4 | idem | bấm phòng ⇒ hội thoại + ‹; bấm ‹ ⇒ về danh sách | |
| T4b | idem | gõ ô lọc → vào phòng → ‹ ⇒ **câu lọc CÒN NGUYÊN**; chip «Lưu trữ» không sinh `listRooms({archived:true})` lặp | §4.1 |
| T4c | idem | drawer **KHÔNG** có nút «Tin nhắn mới» và **KHÔNG** có nút mở tìm-nội-dung-tin; `/chat` VẪN có cả hai | cặp ĐỐI CHỨNG — thiếu vế sau thì xoá nhầm nút ở `/chat` cũng xanh |
| T5 | idem | mở phòng ⇒ `subscribedRoomIds[id]` có; bấm ‹ ⇒ **không còn** | đếm KHOÁ trong store, không đếm lời gọi mock |
| T6 | idem | mở A rồi B ⇒ đúng 1 node hội thoại **và** `data-room-id="b"` | có đột biến giết được nhờ §3.7 |
| T7 | idem | ⤢ ⇒ `navigate('/chat')` **và** `isOpen === false` | |
| T7b | idem | panel có `max-w-none` + `md:max-w-[400px]`. ⚠️ Đây là khẳng định **CHUỖI CLASS**, jsdom không có CSS — §10 KHÔNG được ghi nó thành "đã chứng minh toàn màn dưới md" | |
| T7c | idem | bấm «Trả lời» rồi Esc ⇒ huỷ trả lời, drawer **VẪN mở**; Esc lần hai ⇒ drawer đóng | cặp ALLOW/DENY của §3.5 vá (2) |
| T7d | idem | bấm **nền** ⇒ drawer KHÔNG đóng; bấm ✕ ⇒ đóng | §4.3 |
| T8 | idem | phòng biến khỏi store (sau `hasLoadedRooms`) ⇒ pop về danh sách **VÀ `isOpen` vẫn `true`** | thiếu vế hai thì "đóng sạch" cũng xanh |
| T8b | idem | TRƯỚC `hasLoadedRooms` ⇒ KHÔNG pop | |
| T9 | `chat-dock.store.spec.ts` | `:24` giữ nguyên; `openRoom` bật `isOpen`; `closeRoom` KHÔNG tắt `isOpen`; `closeDrawer` GIỮ `openRoomIds`; **T9c**: `openRoomIds=["a"], isOpen=false` ⇒ `openRoom("a")` ⇒ `isOpen===true` | T9c bắt nhánh `return state` ở `:78-82` |
| T10 | `ChatBadge.spec.tsx` | bấm ⇒ `isOpen===true`, `navigate` KHÔNG gọi; **màn hẹp VẪN mở drawer**; trên `/chat` ⇒ tĩnh **và** `isOpen===false` | ca hẹp là ĐỐI CHỨNG của hành vi cũ |
| T11 | `use-chat-viewport.spec.ts` | 3 tổ hợp ⇒ `three`/`two`/`single`; đổi mốc ⇒ cập nhật; **T11d**: vắng `matchMedia` ⇒ `"three"` (§3.2 ratchet) | mock trả `matches` **theo QUERY** — trả cứng thì 3 ca đọc cùng giá trị |
| T12 | `ChatPage.responsive.spec.tsx` | a) ≥1280: 3 vùng, KHÔNG Sheet · b) 768–1279: ⓘ mở Sheet, danh sách VẪN thấy · c) <768: chưa chọn ⇒ chỉ danh sách; chọn rồi ⇒ hội thoại + ‹, danh sách BIẾN, info Sheet có `max-w-none` | mỗi mốc khẳng định cả cái CÓ lẫn cái KHÔNG |
| T12d | idem | **B9**: `three → two` ⇒ **cùng một node DOM** (`toBe`) + `subscribeToRoom` gọi đúng 1 lần | §3.8 — `subscribedRoomIds` KHÔNG đo được điều này |
| T12e | idem | mốc `two`, info Sheet mở, Esc ⇒ đóng ĐÚNG MỘT lần (không mở lại) | §3.5 `escapeClosesInfo` |
| T12f | idem | mốc `single`, mở tìm kiếm rồi bấm một kết quả ⇒ đúng MỘT vùng | §5.3 |
| T13 | `ChatPage.spec.tsx` | `:225` «CHỈ CÒN MỘT khung hội thoại» giữ nguyên | chống hồi quy B5 |
| T14 | `sheet.spec.tsx` | `leading` render TRƯỚC tiêu đề · `bodyClassName` thay padding · **T14b** thay `overflow` · **T14c** Esc bị con `preventDefault` ⇒ KHÔNG đóng · **T14d** có `[data-escape-claim="open"]` ⇒ KHÔNG đóng · **T14e** `closeOnBackdrop={false}` ⇒ bấm nền không đóng | ca hồi quy cho mọi consumer khác của Sheet |
| T15 | `MessageComposer.mention.spec.tsx` | gợi ý `@` mở ⇒ có `[data-floating-layer="open"]`; **và HÀNH VI**: đang trả lời + gợi ý mở + Esc ⇒ đóng gợi ý, **KHÔNG** huỷ trả lời | ca tồn-tại-thuộc-tính một mình không chứng minh gì; `ConversationPanel.spec:277` dùng `<div>` giả nên không ghép được với popover thật |

**Sweep đột biến bắt buộc** (bằng chứng vào §10):

1. Bỏ `startsWith` ⇒ **T2b** ĐỎ. Bỏ cả cổng `/chat` ⇒ **T2** ĐỎ.
2. Nhánh pop của `closeRoom` thành no-op ⇒ **T5** ĐỎ.
3. Nới `MAX_DOCK_WINDOWS` lên 2 ⇒ **T9/`:24`** ĐỎ **và T6** ĐỎ (2 node — nhờ §3.7).
4. `useChatLayoutMode` trả cứng `"three"` ⇒ **T12b/T12c** ĐỎ.
5. Gỡ điều kiện `data-escape-claim` ở `Sheet` ⇒ **T7c** và **T14d** ĐỎ.
6. Gỡ `escapeClosesInfo` (luôn true) ⇒ **T12e** ĐỎ.
7. Gỡ dấu `data-floating-layer` ở `MentionPopover` ⇒ **T15** (vế hành vi) ĐỎ.
8. `closeOnBackdrop` luôn true ⇒ **T7d** ĐỎ.

---

## 8. Thứ tự thi công (expand-contract — mỗi bước `typecheck` XANH)

| # | Việc | Cổng sau bước |
| --- | --- | --- |
| **0** | `harness/backlog.mjs`: bổ sung `paths` (§11) **TRƯỚC** mọi thứ — nếu không `guard-scope` cảnh báo suốt 12 bước (`wo-paths-drive-gate-and-scheduler`) | |
| 1 | `packages/ui/sheet.tsx`: `leading` · `bodyClassName` · `closeOnBackdrop` · 2 điều kiện nhường Esc (+T14a–e) | `pnpm --filter @mediaos/ui exec vitest run` xanh |
| 2 | `use-chat-viewport.ts` + spec (T11, T11d) | |
| 3 | `chat-dock.store.ts`: **CHỈ THÊM** `isOpen`/`openDrawer`/`closeDrawer`/`toggleDrawer` + `openRoom` bật `isOpen`. **KHÔNG gỡ `minimized*`** (còn `ChatDockWindow.tsx:34,35,89,124,125`) + T9 | typecheck xanh · spec cũ xanh |
| 4 | Prop TUỲ CHỌN: `RoomListPanel` (`variant`, `query`/`chip` controlled, 2 handler optional) · `ConversationHeader.onBack` · `ConversationPanel` (`onBack`, `escapeClosesInfo`, dấu `data-escape-claim`, `data-testid`) · `MessageSearchPanel.className` · `RoomInfoPanel` bề ngang · `MentionPopover` dấu (+T15) | **CỔNG: mọi spec hiện có XANH mà KHÔNG sửa một dòng nào** |
| 5 | `ChatDrawer.tsx` + `drawer/*` + `ChatDrawer.spec.tsx` (T1–T8b) | |
| 6 | `ProtectedShell`: `<ChatDock/>` → `<ChatDrawer/>` | `vitest run src/layouts` xanh (B4) |
| 7 | `ChatBadge` + spec (T10); gỡ `pickDropdownRooms` khỏi `chat-unread.ts` + spec | |
| 8 | **XOÁ** `ChatDock.tsx` · `ChatDockWindow.tsx` · `ChatDock.spec.tsx` · `use-dock-viewport.ts` | grep §8.1 = 0 |
| 9 | **Giờ mới** gỡ `minimizedRoomIds`/`toggleMinimize` + dọn 3 ca spec (§3.1) | typecheck xanh |
| 10 | `ChatPage` responsive + `ChatPage.responsive.spec.tsx` (T12*) | **CỔNG: 16 ca `ChatPage.spec.tsx` XANH mà KHÔNG sửa một dòng nào** (chúng sống nhờ fail-soft `"three"` — §3.2) |
| 11 | i18n `vi/chat.ts`: thêm `drawer.*` + `conversation.back`; gỡ `dock.minimize/expand/minimizeShort/expandShort/close`. ⚠️ **GIỮ `dock.openFullScreen`** (⤢ của drawer vẫn dùng) hoặc chuyển sang `drawer.openFullPage` | grep 0 cho khoá gỡ |
| 12 | `docs/spec/SPEC-15 CHAT.md`: sửa **CẢ HAI** chỗ — §9 dòng 321 (SCREEN-002) và §22c dòng 213 — thêm «trừ chính `/chat*`» (L1) | |
| 13 | `harness/backlog.mjs`: `status` + ghi chú lệch | |

### 8.1 Lệnh grep nghiệm thu

```bash
grep -rnE "ChatDockWindow|use-dock-viewport|useHasDockViewport|DOCK_VIEWPORT_QUERY" apps packages
grep -rnE "\bChatDock\b" apps packages | grep -vE "ChatDockStore|ChatDockState|resetChatDock"
```

⇒ **0 dòng** cả hai. `useChatDockStore` · `ChatDockState` · `resetChatDock` · `MAX_DOCK_WINDOWS` là khớp
**HỢP LỆ** (§3.1 cố ý giữ). Lệnh thứ hai bắt được cả JSX xuống dòng (`<ChatDock\n/>`) mà pattern
`<ChatDock[ />]` của v2 trượt.

---

## 9. Lệch so với `done_when` / SPEC — ghi ra, không giấu

| # | Nói gì | Plan làm | Lý do |
| --- | --- | --- | --- |
| L1 | «badge mở drawer trên **mọi trang**» — `done_when` #4 **và** SPEC-15 §9 dòng 321 + §22c dòng 213 | mọi trang **trừ `/chat*`** | B1 — hai instance `useChatConversation` cùng phòng giết lưới bù tin. Vì lệch với **SPEC**, bước 12 sửa luôn SPEC ở CẢ HAI chỗ; không thì QA-1 nghiệm thu theo câu chữ cũ |
| L2 | «`useHasDockViewport` đổi nghĩa có test» (plan wave) | hook bị **thay** bằng `useChatLayoutMode` có test | consumer duy nhất đổi hành vi; giữ tên cũ = hook chết mang tên một thứ đã xoá |
| L3 | — | drawer không có «Tin nhắn mới» và không có lối vào tìm-nội-dung-tin | `done_when` chỉ đòi «tìm + chip» (§4.4) |
| L4 | — | `packages/ui/sheet.tsx` +3 prop +2 điều kiện Esc (ngoài `paths` gốc) | DEC-026 bắt dùng `Sheet` |
| **L5** | SPEC-15 §9 CHAT-SCREEN-009 (dòng 329) đặt **nút gọi** trong SCREEN-001/002 | drawer **không có nút gọi**, **không có bảng thông tin phòng** | Khiếm khuyết **KẾ THỪA** từ `ChatDockWindow` (cũng không có, vì `showHeader={false}` ⇒ `callSlot` không render) ⇒ **không phải hồi quy**. Đưa nút gọi vào `Sheet.actions` là mở bề mặt mới (`CallProvider` · cặp `join:chat-call` · khung gọi trong overlay) — ngoài `done_when`. **CÂU HỎI CHO OWNER, hỏi trước bước 5**; owner không chốt ⇒ giữ nguyên trạng và ghi vào ACCEPTANCE của QA-1 |
| L6 | `done_when` #4 «theme light/dark» | FE-5 chỉ ép **ràng buộc token màu** (§14) + `pnpm build`; snapshot light/dark là việc của QA-1 (`done_when` QA-1 ghi rõ «snapshot light+dark … ChatDrawer») | tránh làm hai lần cùng một phép đo |

---

## 10. Bằng chứng (đo 10/09/2026)

### 10.1 Sweep đột biến — 8/8 giết ĐÚNG ca có tên

| # | Đột biến | Ca ĐỎ | Kết quả |
| --- | --- | --- | --- |
| 1 | Bỏ vế `startsWith` ở `ChatDrawer` | T2b «trên `/chat/<id>` cũng KHÔNG render» | ✅ 1 đỏ |
| 2 | Nhánh pop của `closeRoom` → `return state` | T4 · T5 · T6 · T8 | ✅ 4 đỏ (gồm T5 rò lưới bù tin) |
| 3 | `MAX_DOCK_WINDOWS = 2` | `chat-dock.store.spec:24` **và** «hai lần `openRoom` liên tiếp ⇒ DOM đúng MỘT hội thoại» | ✅ 2 đỏ (2 file) |
| 4 | `useChatLayoutMode` trả cứng `"three"` | 9 ca của `ChatPage.responsive.spec` | ✅ 9 đỏ |
| 5 | Gỡ `hasEscapeClaim` ở `Sheet` | `sheet.spec` «có `[data-escape-claim=open]` ⇒ Esc KHÔNG đóng» **và** T7c của drawer | ✅ 2 đỏ (2 gói) |
| 6 | `escapeClosesInfo` luôn `true` | T12e «Esc đóng Sheet ĐÚNG MỘT lần» | ✅ 1 đỏ |
| 7 | Gỡ `data-floating-layer` ở `MentionPopover` | «popover MỞ ⇒ phát dấu; ĐÓNG ⇒ dấu biến mất» | ✅ 1 đỏ |
| 8 | `closeOnBackdrop` luôn `true` | `sheet.spec` «`closeOnBackdrop=false` ⇒ nền không đóng» **và** T7d | ✅ 2 đỏ (2 gói) |

⚠️ **Một ca đã phải VIẾT LẠI vì sweep.** Bản đầu của T6 đi qua giao diện (bấm phòng A → ‹ → phòng B),
nên nó KHÔNG chạm nhánh "thay chỗ" của store — `openRoomIds` đã rỗng lúc bấm B ⇒ đột biến #3 để nó XANH.
Thêm ca đi thẳng qua store (`openRoom("a")` rồi `openRoom("b")`, đường thật của `ChatBadge`/deep-link)
thì đột biến #3 mới giết được. Đây đúng là loại ca mà §3.7 sinh ra để bảo vệ.

### 10.2 Cổng đã chạy

| Cổng | Kết quả |
| --- | --- |
| Bước 4 «mọi spec hiện có XANH mà KHÔNG sửa một dòng» | ✅ 532/532 `src/components/chat` |
| Bước 10 «16 ca `ChatPage.spec.tsx` XANH không sửa dòng nào» | ✅ 16/16 |
| `@mediaos/ui` | ✅ 124/124 (18 file) |
| `src/components/chat` | ✅ 539/539 (39 file) |
| `src/routes/chat` | ✅ 27/27 |
| `src/layouts` (B4 — `useChatRealtime` 1 lần) | ✅ 46/46 |
| `src/routes/tasks` · `src/routes/rooms` (consumer `Sheet` khác) | ✅ 275/275 · 77/77 |
| `pnpm typecheck` | ✅ 10/10 |
| `pnpm lint` | ✅ 0 error (47 warning có sẵn ở `apps/api/test`) |
| `pnpm build` | ✅ 7/7 |
| grep §8.1 (cả hai lệnh) | ✅ 0 dòng CODE (chỉ còn docblock lịch sử «thay `ChatDock`…») |
| grep màu cứng ở file mới | ✅ 0 |
| B6 — chunk lazy tách thật | ✅ `dist/assets/ChatDrawerBody-*.js` là chunk RIÊNG |

### 10.3 Đã phát hiện trong lúc thi công

- **`apps/app` ăn `dist` của `@mediaos/ui`, không ăn `src`.** Ba tính năng mới của `Sheet` (`leading`,
  `closeOnBackdrop`, nhường Esc) im lặng không có tác dụng cho tới khi chạy
  `pnpm --filter @mediaos/ui build`; triệu chứng là 3 ca drawer đỏ với lý do trông như lỗi logic. Ai sửa
  `packages/ui` rồi chạy test `apps/app` phải build lại trước.
- **Chunk lazy làm ca ĐẦU TIÊN của file spec đỏ.** Lần `import()` đầu phải transform cả cây
  `RoomListPanel` → `ConversationPanel` → `MessageComposer`, lâu hơn 1000ms mặc định của `findBy*` ⇒ ca
  đầu đọc phải `Suspense fallback`, các ca sau xanh vì module đã ở registry — một bài test xanh/đỏ theo
  THỨ TỰ chạy. Vá bằng `beforeAll(() => import(...))`, KHÔNG nới timeout.
- **`Sheet` không forward prop lạ.** `data-mode` truyền vào bị nuốt im lặng; đổi sang khẳng định trên
  NỘI DUNG (`chat-room-list` / `chat-drawer-conversation`) — chặt hơn, vì một thuộc tính đánh dấu có thể
  đúng trong khi thân render nhầm thứ.

### 10.4 Chưa đo được bằng máy (kiểm tay khi review UI)

- `MentionPopover` (absolute, mở LÊN trên ô soạn) không bị `bodyClassName="overflow-hidden"` của drawer
  xén — jsdom không tính CSS.
- Bố cục thật ở 3 mốc: T7b/T12c chỉ khẳng định CHUỖI CLASS (`max-w-none`, `md:max-w-[400px]`), không
  chứng minh trình duyệt vẽ ra sao.

### 10.5 Cổng LIGHT — 2 phát hiện, đã vá cả hai

| # | Reviewer | Mức | Phát hiện | Vá |
| --- | --- | --- | --- | --- |
| R1 | `typescript-reviewer` | MEDIUM | `Sheet` bảng thông tin ở `/chat` (<1280) KHÔNG truyền `closeOnBackdrop` ⇒ rơi về mặc định `true`. `RoomInfoPanel` giữ nháp đổi TÊN/MÔ TẢ bằng state cục bộ (`:131-133`) mà `Sheet` unmount sạch children khi đóng ⇒ một cú click trượt tay ra nền xoá nháp. Bản vá `closeOnBackdrop` đã áp cho drawer nhưng **bỏ sót** `Sheet` thứ hai có CÙNG rủi ro trong cùng WO | `ChatPage.tsx` khe 4 + ca «bấm NỀN không đóng Sheet» ở `ChatPage.responsive.spec` |
| R2 | `code-reviewer` | **HIGH** | `hasEscapeClaim` quét `document` KHÔNG điều kiện. `Sheet` là primitive dùng chung ⇒ một trạng thái đang-dở của tính năng A (đang trả lời trong drawer chat) nuốt Esc của panel thuộc tính năng B (`TaskDetailDrawer`…). `sheet.spec` chỉ dựng MỘT `Sheet` mỗi ca nên không ca nào bắt được rò rỉ qua lại; 2 vòng plan-review cũng chỉ xét trong phạm vi một trang chat | `sheet.tsx` đổi sang **luật hai tầng** (§3.3b) + 2 ca mới |

**§3.3b — luật hai tầng của `hasEscapeClaim`** (thay truy vấn toàn tài liệu của v3):

1. Dấu nằm **trong panel của chính mình** ⇒ nhường (drawer chat chứa ô soạn đang trả lời).
2. Dấu nằm **ngoài mọi lớp modal** (`claim.closest('[role="dialog"][aria-modal="true"]') === null`) ⇒
   nhường — nó thuộc chính trang nền mà panel này đang phủ lên (`/chat` mốc 2 cột: dải "đang trả lời" ở
   cột hội thoại, Sheet là bảng thông tin phòng).
3. Dấu nằm trong một lớp modal **KHÁC** ⇒ **KHÔNG** nhường. Việc của lớp đó.

Sweep lại đột biến #5 sau khi thu hẹp: gỡ `hasEscapeClaim` ⇒ **3 ca đỏ** (2 ở `sheet.spec`, 1 ở
`ChatDrawer.spec`) — vẫn giết được, và nay còn bắt thêm ca xuyên-tính-năng.

Chạy lại sau vá: ui **126/126** · chat **539/539** · routes/chat **28/28** · typecheck/lint/build ✅.

### 10.6 Bàn giao QA-1

`apps/app/vitest.config.ts:18` — coverage `include` hiện CHỈ `src/components/chat/call/**`. `done_when`
của QA-1 đòi coverage `components/chat` ≥80%; không mở rộng sang `src/components/chat/**` thì ngưỡng đó
đo trên tập RỖNG và xanh vô nghĩa.

---

## 11. Chạm ngoài `paths` — bổ sung vào `harness/backlog.mjs` (bước 0)

```text
apps/app/src/components/chat/ConversationHeader.tsx
apps/app/src/components/chat/ConversationPanel.tsx
apps/app/src/components/chat/MessageComposer.tsx
apps/app/src/components/chat/RoomInfoPanel.tsx
apps/app/src/components/chat/MessageSearchPanel.tsx
apps/app/src/components/chat/composer/MentionPopover.tsx
apps/app/src/components/chat/chat-unread.ts
apps/app/src/components/chat/use-chat-viewport.ts
packages/ui/src/components/ui/sheet.tsx
packages/ui/src/components/ui/sheet.spec.tsx
docs/SPEC/SPEC-15 CHAT.md
```

---

## 12. Cách chạy test ở máy này

KHÔNG chạy full-suite `apps/app` (worker vitest chết `ERR_IPC_CHANNEL_CLOSED`, một lần kéo sập máy).

```bash
pnpm --filter @mediaos/ui  exec vitest run                                                       # bước 1 + T14
pnpm --filter @mediaos/app exec vitest run src/components/chat --poolOptions.threads.maxThreads=2
pnpm --filter @mediaos/app exec vitest run src/routes/chat     --poolOptions.threads.maxThreads=2
pnpm --filter @mediaos/app exec vitest run src/layouts         --poolOptions.threads.maxThreads=2  # B4
pnpm --filter @mediaos/app exec vitest run src/routes/tasks    --poolOptions.threads.maxThreads=2  # consumer Sheet
pnpm --filter @mediaos/app exec vitest run src/routes/rooms    --poolOptions.threads.maxThreads=2  # consumer Sheet
pnpm typecheck && pnpm lint && pnpm build
```

---

## 13. Đối chiếu vòng 1 → chỗ vá

| Phát hiện | Vá ở |
| --- | --- |
| 1. Thứ tự làm đỏ cây | §8 (expand-contract; gỡ `minimized*` xuống bước 9) |
| 2. Grep `ChatDock` không thể về 0 | §8.1 (2 lệnh) |
| 3. B8 mô tả sai cổng | B8 · §4.2 · T1 |
| 4. Mất `startsWith` | B1 · §4 · T2b · sweep #1 |
| 5. Sweep #3 không làm T6 đỏ | §3.7 (thân `.map` chủ đích) · sweep #3 |
| 6. Esc đóng drawer khi đang trả lời / gợi ý @ | §3.5 (đổi hẳn cơ chế ở v3) · T7c · T14d · T15 |
| 7. Esc double-toggle info Sheet | §3.5 `escapeClosesInfo` · §5.1 · T12e |
| 8. L1 lệch SPEC, không có đường sửa | L1 · bước 12 (CẢ HAI dòng) · §11 |
| §12 thiếu lệnh | §12 (thêm ui · layouts · tasks · rooms · build) |
| Chuyển mốc remount | B9 · §3.8 · §5.5 · T12d |
| §3.1 đếm thiếu spec | §3.1 bảng 7 ca |
| `openRoom` nhánh đã-mở | §3.1 · T9c |
| «dưới md toàn màn» không có ca | T7b (+ ghi giới hạn) |
| Drawer mất nút gọi | L5 (nâng thành câu hỏi owner) |
| ‹ mất câu lọc + chip | §4.1 · T4b |
| Lazy chứa cả Sheet | §3.6 |
| Mốc single 2 cột `w-full` | §5.3 · T12f |
| `MentionPopover` tiền đề overflow | §10 (kiểm tay) |
| i18n `dock.openFullScreen` | bước 11 |
| `ProtectedShell.spec` mock router | B4 |
| T14 không đo overflow | T14b · §3.3 |
| Bàn giao coverage QA-1 | §10 |

---

## 14. Ràng buộc trình bày

Chỉ dùng token theme (`bg-background`, `text-foreground`, `border-border`, `bg-muted`,
`text-muted-foreground`, `bg-destructive`…). **Không** màu cứng (`bg-white`, `#hex`, `text-black`) trong file
mới — trừ tiền lệ đã có (chấm online `bg-emerald-500`, nền overlay `bg-black/40` của Sheet). §10 có grep.

---

## 15. Đối chiếu vòng 2 → chỗ vá

| # | Phát hiện vòng 2 | Mức | Vá ở |
| --- | --- | --- | --- |
| 1 | Capture làm `ConversationPanel` thắng cả `Dialog` lẫn `Sheet` con (ca thật: members-Sheet trong info-Sheet ở mốc two/single) | BLOCK | **§3.5 viết lại — BỎ capture**, thay bằng dấu DOM `data-escape-claim` + `escapeClosesInfo` |
| 2 | Sweep #3 vẫn không làm T6 đỏ ⇒ T6 là tautology | BLOCK | §3.7 (thân drawer `.map` chủ đích) · sweep #3 |
| 3 | T12d xanh dù có remount (React chạy unmount trước mount cùng commit) | BLOCK | §3.8 — đo **định danh node** + đếm `subscribeToRoom` |
| 4 | T1 không viết được với mock `useCan` chăn | BLOCK | §4.2 + T1: bắt buộc `mockImplementation` theo CẶP |
| 5 | §12 thiếu `src/routes/tasks` + `src/routes/rooms` (consumer Sheet) | HIGH | §12 |
| 6 | Drawer thêm đường mất nháp MỚI: bấm nền | HIGH | §4.3 · `closeOnBackdrop` · T7d · sweep #8 |
| 7 | §5.2 "render 1 lần" ≠ "không remount" | MED | §5.2 (ghi rõ, chấp nhận) |
| 8 | Dấu mention cũng tắt focus-trap Tab của Sheet | MED | §3.5 (ghi ra) |
| 9 | §4.1 controlled/uncontrolled thiếu 3 ràng buộc | MED | §4.1 (1–3) · T4b |
| 10 | Handler tuỳ chọn ⇒ nút phải BIẾN MẤT | MED | §4.4 · T4c |
| 11 | «info Sheet toàn màn» ở single không có ca | MED | T12c |
| 12 | `variant` compact không được định nghĩa | MED | §4.4 (bảng) |
| 13 | Thiếu `pnpm build`; light/dark không có bước | MED | §12 · L6 · §14 |
| 14 | Cập nhật `paths` đứng cuối ⇒ `guard-scope` kêu 12 bước | MED | §8 bước **0** |
| 15 | T15 chỉ đo thuộc tính, không đo hành vi | MED | T15 (thêm vế hành vi) · sweep #7 |
| 16 | T7b là chuỗi class, không phải bố cục | LOW | T7b (ghi giới hạn) · §10 |
| 17 | `matchMedia` vắng ⇒ `"three"` là thứ giữ 16 ca cũ xanh | LOW | §3.2 · T11d · bước 10 (cổng) |
| 18 | Bước 10 không có cổng | LOW | §8 bước 10 |
| 19 | Grep `<ChatDock[ />]` trượt JSX xuống dòng | LOW | §8.1 (lệnh 2) |
| 20 | Cổng `view:chat-room` KHÔNG phải hồi quy — phải ghi lý do | LOW | §4.2 (đoạn cuối) |
| 21 | §5.5 chỉ nói "đừng viết ternary", chưa nói viết thế nào | LOW | §5.5 (5 khe cố định) |
| 22 | L5 chỉ ghi nhận, không có bước | LOW | L5 (câu hỏi owner trước bước 5) |

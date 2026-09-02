# Kế hoạch wave S17-CHAT-UX2 — nâng giao diện Chat lên chuẩn ứng dụng nhắn tin thương mại

> **Trạng thái: OWNER ĐÃ DUYỆT 02/09/2026** («ok tôi duyệt kế hoạch hãy seed các WO» — nguyên gói hồ sơ
> `S17-CHAT-UX2-WAVE-review.html`, 7/7 quyết định §3 chốt theo cột Đề xuất). Đã chép vào SPEC-15 §5.1d + §22c
> (CHAT-DEC-021..027) và seed 9 WO §5 vào `harness/backlog.mjs` cùng ngày. Bản chi tiết §9/§10/§15 là việc của
> `S17-CHAT-UX2-DOC-1`.
>
> ⚠️ Số wave là **S17**, không phải S16: `S16` đã bị đề xuất `S16-SOCIAL-WAVE.md` (phiên khác, cùng ngày) chiếm.
>
> Tham chiếu benchmark: 3 ảnh chụp **MISA AMIS Chat** owner cung cấp 02/09/2026 (drawer chat trên trang Công việc ·
> trang Chat full-screen với khung trống «Agentwork» · bảng «Thông tin nhóm»). Benchmark là **mốc so sánh bố cục +
> tiện dụng**, KHÔNG sao chép nhận diện thương hiệu, KHÔNG sao chép các tính năng AI/agent (Phase 5).
>
> Wave trước cùng chủ đề: [`S8-CHAT-UX-WAVE.md`](./S8-CHAT-UX-WAVE.md) (đóng 07/08/2026 — chia mục · ghim · avatar ·
> mute · typing/presence · reaction). Wave này **không làm lại** thứ S8 đã ship; nó lấp phần **bố cục, mật độ thông
> tin và thao tác** mà S8 chưa chạm.

---

## 1. Điểm xuất phát — ĐO THẬT trên master `fd29c167` (02/09/2026)

| Thứ đã có | Số đo |
| --- | --- |
| Mã FE chat | 71 file (`apps/app/src/components/chat/` 61 · `routes/chat/` 3 · `stores/chat.store.ts` · `hooks/use-chat-realtime.ts` · i18n `vi/chat.ts` 396 dòng); 14 file chính 4 138 dòng |
| Bố cục `/chat` | 3 cột **cứng**: `w-72` (288px) · flex · `w-80` (320px) — `RoomListPanel.tsx:203` · `RoomInfoPanel.tsx:189`. **0 breakpoint** trong `components/chat/*.tsx` + `routes/chat/*.tsx` ngoài `ChatDock.tsx:75` (`hidden md:flex`) ⇒ dưới 1024px ba cột chen nhau, dưới 768px không dùng được |
| Dòng phòng | avatar · tên · giờ `HH:mm` · dòng 2 = **LOẠI PHÒNG** («Nhóm» / «Phòng ban» — `RoomListPanel.tsx:403-407`). **Không có preview tin cuối**: `chatRoomSchema` (`packages/contracts/src/chat.ts:8-60`) chỉ có `lastMessageAt` · `lastMessageSeq`, không có nội dung/người gửi |
| Phòng `direct` trong danh sách | `GET /chat/rooms` không kèm `members` ⇒ nhãn = **«Tin nhắn riêng · CHAT-000123»** cho tới khi MỞ phòng (`ChatPage.tsx` cache `resolvedNames`, `chat-dock.store.ts` cache lần hai); avatar = chữ cái đầu của **mã phòng**. Nợ đã ghi tường minh ở `RoomAvatar.tsx:12-17` |
| Đang online | Sự kiện `chat:presence` chỉ fan-out tới peer DM (cố ý — S8 RT-1). Chấm online hiện **duy nhất** ở header hội thoại đang mở (`ConversationPanel.tsx:262-274`); danh sách phòng **không biết `peerUserId`** nên không vẽ được |
| Chia mục | 5 mục cố định theo `room_type` (CHAT-DEC-014), thu/mở nhớ `localStorage`; menu ngữ cảnh ghim · mute · chưa đọc · lưu trữ; ô lọc theo tên/mã |
| Ô soạn | textarea + đính kèm + gửi. `sendMessageSchema.mentions` (max 20, `chat.ts:255`) + BE lọc thành viên (CHAT-ERR-010) **đã có**, nhưng `MessageComposer.tsx` **0 dòng «mention»** ⇒ tính năng BE chết ở FE. Không emoji, không dán/kéo-thả ảnh, đính kèm trước gửi chỉ hiện tên + cỡ |
| Bong bóng tin | bố cục **tuyến tính kiểu Slack**: avatar trái · tên + giờ · mọi tin cùng lề (`MessageBubble.tsx`); tác vụ hover 3 nút (trả lời · ghim · thu hồi); `ReactionBar` 6 emoji; «Đã xem bởi A, B» bằng chữ |
| Bảng thông tin phòng | header chữ (tiêu đề · mã phòng · mô tả) → `RoomAvatarEditor` → 3 nút (Sửa · Lưu trữ · Rời) → Tabs Thành viên / Tệp / Tin ghim. Tab Tệp là **danh sách phẳng** dù DTO đã có `isImage` + `thumbnailUrl` (`chat.ts:117-131`). Không có «Liên kết». Không có «Tạo bởi» dù `chat_rooms.created_by` tồn tại (`communication.ts:178`) |
| Khung trống | `EmptyState` icon + 2 dòng chữ (`ChatPage.tsx:184-191`) |
| Panel nổi (CHAT-SCREEN-002) | cửa sổ 1 phòng ở góc dưới phải, thu nhỏ/đóng/bung; **không có danh sách phòng** trong panel — muốn đổi phòng phải vào `/chat` hoặc badge header |
| Realtime đã có | `chat:message` · `chat:read` · `chat:room` · `chat:typing` · `chat:presence` · `chat:reaction` · `chat:call` (`realtime.ts:37-51`) |
| Nền BE tái dùng được | `listRoomsForUser` đã sắp `last_message_at DESC NULLS LAST` (`chat-rooms.repository.ts:301`); index `idx_chat_messages_room_seq (company_id, room_id, room_seq DESC)` (`0539:56`) ⇒ lấy tin cuối mỗi phòng bằng LATERAL là index-only; `ChatMembersService.listMembers` ký avatar qua `AvatarPresignService.resolveEmployeeAvatars` (`chat-members.service.ts:74`) — **đường ký đã có**, dùng lại cho peer DM; `GET /chat/rooms/:id/files` (CHAT-API-017) đã trả `isImage`/`thumbnailUrl` |

**Kết luận đo:** phần lớn khoảng cách là **trình bày + thao tác** (FE), cộng **3 khoá DTO mới** và **1 route đọc mới**. **0 migration · 0 cặp quyền mới · 0 thay đổi WS ratchet** ⇒ wave rẻ hơn hẳn S8 (S8 có 1 mig đỏ + 2 WO FULL gate).

## 2. Bản đồ khoảng cách — MISA AMIS Chat ↔ MediaOS

| # | Bề mặt MISA | MediaOS hiện tại | Khoảng cách | Xếp |
| --- | --- | --- | --- | --- |
| G1 | Dòng hội thoại: avatar 40px · tên đậm khi chưa đọc · **«NGƯỜI GỬI: nội dung tin cuối»** · thời gian tương đối («2 ngày», «1 tuần») | loại phòng + `HH:mm` | Thiếu preview tin cuối (DTO + FE) + thời gian tương đối | **V2 — Track A** |
| G2 | DM hiện **tên + ảnh thật + chấm online + nhãn «Ngừng hoạt động»** ngay trong danh sách | mã phòng tới khi mở; chữ cái đầu của mã | Thiếu `peer` trong DTO phòng | **V2 — Track A** |
| G3 | Thanh đầu 1 hàng: ô tìm · lọc · tạo mới; **tab lọc** Hội thoại / Nhóm / Ưa thích / Khác | tiêu đề «Trò chuyện» + 2 icon; ô lọc; nút «Xem phòng đã lưu trữ» chiếm 1 hàng | Thiếu chip lọc nhanh (Tất cả · Chưa đọc · Riêng · Nhóm · Đã lưu trữ) | V2 — Track A |
| G4 | Khung trống có **hero** + composer | `EmptyState` | Hero + 2 hành động nhanh (Tin nhắn mới · Tìm kiếm). Phần «Agentwork»/AI **ngoài** | V2 — Track B |
| G5 | Header hội thoại: avatar · tên · trạng thái · cụm nút (tìm trong phòng · gọi · ⓘ) | tên · loại · gọi · ⓘ (không avatar, không tìm-trong-phòng) | Thiếu avatar + lối tìm-trong-phòng | V2 — Track B |
| G6 | Bong bóng **hai phía** (mình phải / người khác trái), giờ nhỏ, tác vụ nổi khi hover | tuyến tính Slack | Đổi bố cục tin (quyết định thẩm mỹ — DEC-024) | V2 — Track B |
| G7 | Composer: emoji · @mention · dán/kéo ảnh · xem trước · gửi | textarea + kẹp giấy | Thiếu 4 tiện ích; **mention BE đã có** | **V2 — Track B** |
| G8 | «Thông tin nhóm»: avatar to giữa · tên (bút) · «Được tạo bởi» · 3 hành động tròn · «N thành viên ›» · accordion Ảnh/Video (lưới) · Files · Links · «Rời khỏi nhóm» đỏ cuối | header chữ · 3 nút · 3 tab | Dựng lại bố cục dọc; thêm `createdByName` · lọc `kind=image` ở server · route liên kết | **V2 — Track C** |
| G9 | Nhãn «Dữ liệu được mã hoá» | không E2E | **KHÔNG bịa nhãn** — MediaOS không mã hoá đầu-cuối; ghi rõ để không ai thêm vào cho «giống» | ✖ |
| G10 | Nhắc hẹn · Huy hiệu | — | TASK có nhắc việc riêng (SPEC-06); huy hiệu = ME/SOCIAL | ✖ |
| G11 | Agentwork · @misaava · «AI Tóm tắt» | — | Phase 5 AI (SPEC-01 §7) | ✖ |
| G12 | **Drawer chat bên phải** trên mọi trang (danh sách + tab + hội thoại, mở từ icon header) | cửa sổ nổi 1 phòng góc dưới, không danh sách | Đổi hình thái panel phụ (DEC-026) | **V2 — Track D** |
| G13 | Responsive | 0 breakpoint | 3 → 2 → 1 cột | **V2 — Track D** |
| G14 | Phím tắt: tìm nhanh · điều hướng phòng · Esc | Enter gửi, Shift+Enter xuống dòng | Ctrl/⌘+K · ↑↓ trong danh sách · Esc đóng reply/info | V2 — Track B (nhỏ) |
| G15 | Trạng thái cá nhân («Trạng thái ▾»: bận/họp…) | presence on/off thuần server | Cần cột + màn ME + luật riêng tư ⇒ wave sau | ✖ (chừa) |
| G16 | Đã xem = dãy avatar nhỏ cuối tin | chữ «Đã xem bởi A, B» | Roster đã có `avatarUrl` ⇒ thuần FE | V2 — Track B |
| G17 | «LITE» · «AI Tóm tắt» · thư viện mẫu | — | Ngoài | ✖ |

## 3. Quyết định owner cần ký — CHAT-DEC-021..027 (đề xuất ở cột giữa)

> Đánh số **021** trở đi: `CHAT-DEC-020` đã thuộc S7-CALL (SPEC-15 §22b). Mã màn hình **không** cấp mới — wave này
> **sửa** CHAT-SCREEN-001 · 002 · 004 (ghi «v2» tại chỗ trong §9). Chức năng mới: `CHAT-FUNC-022..026`. API mới:
> `CHAT-API-031` (+ tham số `kind` cho CHAT-API-017). Mã lỗi: dùng lại `CHAT-ERR-016` (con trỏ sai). Migration: **0**.

| Mã | Câu hỏi | Đề xuất | Hệ quả nếu chọn khác |
| --- | --- | --- | --- |
| **CHAT-DEC-021** | Chip lọc nhanh có **đảo** CHAT-DEC-014 (mục cố định) không? | **Không đảo.** Thanh chip trên danh sách: `Tất cả` · `Chưa đọc` · `Riêng` · `Nhóm` · `Phòng ban · Dự án` · `Đã lưu trữ`. Chip **Tất cả** = giữ nguyên 5 mục DEC-014 (Đã ghim đứng đầu). Chip khác = danh sách **phẳng** theo hoạt động, chỉ phòng khớp. Chip không lưu (mỗi lần vào = Tất cả). «Ưa thích» của MISA ≡ **Đã ghim** — không thêm khái niệm thứ hai. Nút «Xem phòng đã lưu trữ» rời khỏi hàng riêng, thành chip | Bỏ mục cố định = làm lại FE-1 của S8 vừa ship; thêm «Ưa thích» tách khỏi ghim = hai cột per-user gần trùng nghĩa |
| **CHAT-DEC-022** | **Preview tin cuối** đặt ở đâu, che thế nào? | Thêm `lastMessage` vào `chatRoomSchema`, `.nullable().optional()`: `{ senderId, senderName, kind: 'text'\|'file'\|'system'\|'recalled', excerpt: string\|null (≤120 ký tự, **cắt ở server**), attachmentCount }`. **Che ở server** như §13.6: tin thu hồi ⇒ `kind:'recalled'`, `excerpt:null`; tin tệp không chữ ⇒ `kind:'file'` + đếm. Lấy bằng **1 LATERAL** trên `idx_chat_messages_room_seq` trong `listRoomsForUser` — KHÔNG N+1. Store FE cập nhật `lastMessage` từ chính `chat:message` (cùng DTO, đã che) và khi thu hồi. Không thêm sự kiện WS | Ghép ở client từ `messagesByRoom` = chỉ có preview cho phòng đã mở; ký hiệu «…» cho 19 phòng còn lại |
| **CHAT-DEC-023** | **Peer của phòng `direct`** trong danh sách | Thêm `peer` vào `chatRoomSchema`, `.nullable().optional()`, **chỉ khác null ở `direct`**: `{ userId, name, avatarUrl (ký tươi), isActive }`. Ký qua **`AvatarPresignService.resolveEmployeeAvatars` hiện có** — 1 lô/lần list, không mở đường ký mới. `isActive` = tài khoản/nhân sự còn hoạt động ⇒ nhãn «Ngừng hoạt động» + khoá ô soạn? **Không khoá** (vẫn đọc lịch sử; gửi thì server đã có luật riêng). Chấm online = `presenceByUser[peer.userId]` (kênh đã có). **Gỡ** hai cache `resolvedNames` (ChatPage · chat-dock.store) — tên DM luôn có từ DTO. ⚠️ `avatarUrl` là URL ký per-recipient ⇒ **strip khỏi payload WS `chat:room`** (memory `ws-payload-narrower-than-rest-dto`) — FE giữ giá trị đang có khi payload không kèm | Không có `peer` = DM tiếp tục hiện mã phòng; hoặc route lô riêng `GET /chat/rooms/peers` = thêm 1 vòng mạng ở màn đầu |
| **CHAT-DEC-024** | **Bố cục tin nhắn**: giữ tuyến tính hay bong bóng hai phía? | **Bong bóng hai phía**: tin của tôi lề phải, nền `primary` nhạt; người khác lề trái, nền `surface-2`, avatar chỉ ở tin đầu cụm bên trái (giữ luật gộp 5 phút + `data-testid` đếm avatar của S8). Giờ hiện ở tin cuối cụm + khi hover. Tác vụ hover thành **thanh nổi** (👍 nhanh · trả lời · ghim · thu hồi · ⋯). «Đã xem» = dãy avatar 16px (tối đa 3 + «+N») bên dưới tin cuối của tôi. **Bất biến render giữ nguyên**: `body` chỉ vào text node, `splitTextWithLinks`, không markdown. Tin `system` canh giữa như cũ | Giữ tuyến tính = ít việc hơn (~1 WO) nhưng khác mọi app chat người Việt đang dùng (Zalo/MISA/Messenger); người dùng hỏi «tin nào của tôi?» |
| **CHAT-DEC-025** | **Bảng thông tin phòng v2** | Bố cục dọc theo benchmark: avatar lớn + tên (bút nếu `update:chat-room` & `group`) + «Tạo bởi {createdByName} · {ngày}» → hàng 3 hành động tròn: **Thêm thành viên** (gate như cũ) · **Tắt/Bật thông báo** · **Ghim/Bỏ ghim** (hai cái sau là **tuỳ chọn cá nhân, KHÔNG sau cổng quyền** — memory `personal-prefs-must-not-sit-behind-permission-gate`) → mục **«Thành viên (N) ›»** mở danh sách trượt (Sheet) với promote/remove như cũ → accordion **Ảnh/Video** (lưới 3 cột, `GET …/files?kind=image` — lọc ở **server**, không lọc trang client) · **Tệp** (`kind=file`) · **Liên kết** (`CHAT-API-031`) · **Tin ghim** → cuối: **Lưu trữ** (gate) + **Rời nhóm** đỏ. Không nhãn «mã hoá» (G9), không nhắc hẹn/huy hiệu (G10). `createdByName` thêm vào DTO `getRoom` (`.nullable().optional()`) | Giữ tab = ít việc nhưng ảnh vẫn là dòng chữ; lọc `isImage` ở client trên 1 trang 30 tệp = lưới «có 2 ảnh» trong khi phòng có 200 |
| **CHAT-DEC-026** | **Panel phụ** (CHAT-SCREEN-002): cửa sổ nổi hay drawer? | **Drawer phải 400px** (Sheet của `packages/ui`) mở từ badge header trên mọi trang: trên = ô tìm + chip lọc; thân = **danh sách phòng thu gọn** ↔ **hội thoại** (push, nút ‹ quay lại); **vẫn đúng 1 hội thoại** mở tại một thời điểm (giữ tinh thần bản sửa 05/08); nút ⤢ mở `/chat`. `ConversationPanel` dùng lại `showHeader=false`. Dưới `md` drawer thành toàn màn. Thay `ChatDock` + `ChatDockWindow`; `chat-dock.store` giữ lại (thu nhỏ → đóng drawer) | Giữ cửa sổ nổi = người dùng phải rời trang đang làm để đổi phòng; drawer đúng thứ MISA làm và đúng ảnh 1 owner gửi |
| **CHAT-DEC-027** | **Composer v2** — phạm vi và thư viện | `@mention` autocomplete từ **roster** (`useRoomRoster`), gửi `mentions[]` (BE lọc sẵn) · **emoji picker tĩnh** ~120 emoji Unicode chèn vào text, **0 dependency** (không `emoji-mart`, 500KB) — đây là emoji trong chữ, **khác** bộ 6 reaction đóng của DEC-018 · **dán/kéo-thả ảnh** đi đúng `uploadChatAttachment` hiện có · **thumbnail xem trước** ảnh trước gửi · phím tắt Ctrl/⌘+K tìm, Esc huỷ reply/đóng info. Không rich-text/markdown (§3.4 giữ text thuần) | Thêm thư viện emoji = +0,5MB bundle cho app đã có nợ code-splitting (memory `console-had-zero-code-splitting`) |

**NGOÀI phạm vi v2 (ghi để không ai tự thêm):** mã hoá đầu-cuối · trạng thái cá nhân (bận/họp) · nhắc hẹn · huy hiệu · AI tóm tắt/agent · sửa tin đã gửi · thư mục tự đặt (vẫn §5.2) · gọi nhóm · sticker/GIF · chuyển tiếp tin (có thể wave sau, cần luật membership đích) · tìm kiếm theo tệp/liên kết toàn cục.

## 4. Story cấp wave (CH-21..CH-30)

| Story | Vai | Muốn | Track |
| --- | --- | --- | --- |
| CH-21 | Nhân viên | Nhìn danh sách là biết **ai vừa nói gì** ở phòng nào, bao lâu rồi — không cần mở từng phòng | A |
| CH-22 | Nhân viên | Phòng nhắn riêng hiện **tên + ảnh + đang online** ngay, kể cả khi chưa từng mở trong phiên | A |
| CH-23 | Nhân viên | Lọc nhanh «Chưa đọc» để dọn hộp thoại; «Riêng»/«Nhóm» khi tìm | A |
| CH-24 | Nhân viên | Tin của tôi và của người khác **phân biệt được bằng vị trí**, xem ai đã đọc bằng avatar | B |
| CH-25 | Nhân viên | Gõ `@` để nhắc đúng người trong phòng; dán ảnh chụp màn hình gửi luôn | B |
| CH-26 | Nhân viên | Mở phòng trống thấy chỉ dẫn + nút bắt đầu, không phải icon xám | B |
| CH-27 | Quản trị nhóm | Bảng nhóm: xem ảnh/tệp/liên kết đã chia sẻ theo **lưới/danh sách riêng**, thêm người, ghim, tắt thông báo trong 1 chạm | C |
| CH-28 | Mọi người | Đang ở trang Công việc, mở **drawer** chat, đổi phòng, trả lời, đóng — không rời trang | D |
| CH-29 | Mọi người | Dùng được `/chat` trên laptop 13" và điện thoại (1 cột) | D |
| CH-30 | QA | Preview tin cuối **không rò** tin thu hồi/ngoài membership; `peer` không rò cross-tenant; theme light/dark cả hai | QA |

## 5. Phân rã Work Order — 9 WO, 4 track song song sau DOC-1, **0 migration**

```text
DOC-1 ─┬─> BE-1 (DTO: lastMessage · peer · createdByName · files?kind) ──> FE-1 (danh sách v2) ──┐
       │                                                                                          │
       ├─> FE-2 (hội thoại v2: header · bong bóng · empty hero · đã-xem avatar) ──> FE-3 (composer) ┼─> FE-5 (drawer + responsive) ─> QA-1
       │                                                                                          │
       └─> BE-2 (CHAT-API-031 liên kết) ──> FE-4 (bảng thông tin phòng v2) ───────────────────────┘
```

| WO | Tầng | Zone / Gate | Phụ thuộc | Nội dung | done_when (rút gọn) |
| --- | --- | --- | --- | --- | --- |
| `S17-CHAT-UX2-DOC-1` | DOCS | 🟡 LIGHT | — | 🔄 **PR mở, chờ merge** — Hoà DEC-021..027 vào SPEC-15 (§9 sửa SCREEN-001/002/004 «v2» · §9a bổ sung chip · §10 FUNC-022..026 · §12 nới CHAT-ERR-016 · §14 trạng thái UI · §15b API-031 + `kind` ở API-017 — **SPEC-15 §5.1d giữ 0 dòng đổi**), API-13 §5/§5.1d/§7, DB-12 §6.8 «0 migration», UI-09 §13a, README §9 hàng CHAT | plan-reviewer PASS; grep 0 dòng còn nói DM «không có tên trong danh sách» hoặc «panel nổi 1 phòng» |
| `S17-CHAT-UX2-BE-1` | BE | 🟡 LIGHT (+ `silent-failure-hunter` vì che nội dung) | DOC-1 | `lastMessage` LATERAL trong `listRoomsForUser` + che thu hồi · `peer` cho `direct` qua `resolveEmployeeAvatars` · `createdByName` ở `getRoom` · `kind=image\|file` cho `GET …/files` · strip `peer.avatarUrl` khỏi `chat:room` | EXPLAIN list 200 phòng = 1 câu, index-only trên `idx_chat_messages_room_seq`; int-spec: thu hồi ⇒ `excerpt null` · non-member 404 · cross-tenant 0 hàng · payload WS không có `avatarUrl` |
| `S17-CHAT-UX2-BE-2` | BE | 🟡 LIGHT | DOC-1 | `GET /chat/rooms/:id/links` (CHAT-API-031): trích `https?://` từ `body` tin **chưa thu hồi** của phòng, keyset `room_seq DESC`, trần 50/trang, membership-gated như CHAT-API-017, con trỏ mang vân phòng (`CHAT-ERR-016`) | deny-path: non-member 404 · tin thu hồi không xuất hiện · con trỏ phòng khác 400 |
| `S17-CHAT-UX2-FE-1` | FE | 🟡 LIGHT | BE-1 | Danh sách v2: thanh đầu (tìm · lọc · tạo) · chip lọc DEC-021 · dòng phòng 56px với preview «Người gửi: …» + thời gian tương đối (`date-fns` `formatDistanceToNowStrict` vi) + peer avatar/online/«Ngừng hoạt động» · store patch `lastMessage` từ `chat:message` · **gỡ** `resolvedNames` 2 nơi | mỗi phòng đúng 1 node ở mọi chip (test `buildRoomSections` + lọc phẳng); DM hiện tên ngay khung hình đầu; test cũ `chat-room-item` giữ nguyên số ca |
| `S17-CHAT-UX2-FE-2` | FE | 🟡 LIGHT | DOC-1 | Hội thoại v2: header (avatar · tên · «đang online / N thành viên» · tìm-trong-phòng · gọi · ⓘ) · bong bóng DEC-024 · thanh tác vụ nổi + 👍 nhanh · đã-xem avatar · hero khung trống · dải ngày sticky | ratchet «body chỉ text node» (spec XSS hiện có) xanh; test gộp cụm đếm avatar giữ nguyên; a11y: tác vụ nổi có focus-within |
| `S17-CHAT-UX2-FE-3` | FE | 🟡 LIGHT | FE-2 | Composer DEC-027: @mention (roster) · emoji tĩnh · dán/kéo-thả ảnh · thumbnail xem trước · phím tắt | mention gửi đúng `mentions[]`, người ngoài roster không gợi ý; dán ảnh ⇒ `uploadChatAttachment` 1 lần; `clientMessageId` bất biến giữ (test S7 hiện có) |
| `S17-CHAT-UX2-FE-4` | FE | 🟡 LIGHT | BE-1, BE-2 | Bảng thông tin phòng v2 DEC-025 + Sheet thành viên + lưới ảnh (`kind=image`) + Tệp + Liên kết + Tin ghim | nút Tắt thông báo/Ghim **không** gate quyền; lưới ảnh chỉ ký khi accordion mở (giữ luật `file_access_logs` của S7-FE-4); 4 nhánh tư cách `RoomAvatarEditor` không đổi |
| `S17-CHAT-UX2-FE-5` | FE | 🟡 LIGHT | FE-1, FE-2 | Drawer DEC-026 thay `ChatDock` + responsive `/chat` (≥1280: 3 cột · ≥768: info thành Sheet · <768: 1 cột push) · `ChatBadge` mở drawer | ESLint single-socket-file xanh; `useHasDockViewport` đổi nghĩa có test; 1 hội thoại tại 1 thời điểm (test S7-FE-3 giữ) |
| `S17-CHAT-UX2-QA-1` | QA | 🟡 LIGHT | tất cả | Nghiệm thu: masking preview/links (thu hồi · file · system) · `peer` cross-tenant + non-member · WS payload hẹp hơn REST · snapshot light/dark 3 màn · axe 0 critical · coverage `components/chat` ≥80% · ratchet 0-`@SubscribeMessage` xanh (không đụng) | `bash harness/check.sh --all --lane-db=s17qa1` XANH; `docs/QA/evidence/S17-CHAT-UX2-QA-1-ACCEPTANCE.md` |

**Ràng buộc thi công bắt buộc cho BE-1/BE-2 (đã ghim ở `harness/backlog.mjs` BLOCKING 1/3, viết lại ngắn gọn máy-đọc — nguồn đầy đủ: [API-13 §5.1d](<../API Design/API-13_CHAT_API_Design.md>)):**

1. `S17-CHAT-UX2-BE-1` **PHẢI** khai `apps/api/src/chat/chat-visibility.spec.ts` trong `paths` — đường LATERAL lấy `lastMessage` phải gọi `visibleFromSeqColumn()`/`visibleFromSeqScalar()` và được thêm vào danh sách census của file đó.
2. `S17-CHAT-UX2-BE-2` **PHẢI** khai `apps/api/src/chat/chat-visibility.spec.ts` **và** `apps/api/test/foundation/**` **và** `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` trong `paths` — đường trích link (`CHAT-API-031`) cũng qua census §13.4, và route mới cần census permission.
3. Lệnh bắt buộc trước khi mở PR của BE-2: `ROUTE_CENSUS_WRITE=1` regen census, rồi **ký phán quyết** (`route-verdicts.ts`) — thiếu là `needVerdict` = fail-open.
4. **CẤM** cả hai WO thêm tên vào `DOCUMENTED_EXCEPTIONS` của `chat-visibility.spec.ts` (giữ đúng 2 phần tử: `countPinned`, `findByClientMessageId`).

**Chi phí ước:** 9 WO toàn vàng/LIGHT, không WO đỏ. Theo hồ sơ S8 (10 WO, 2 FULL) và số đo `red-zone-wo-cost-profile` (~$136/WO đỏ, vàng ≈ 1/3), ước **≈ $350–450 cả wave**, 9 phiên tuần tự hoặc 4 track song song qua `parallel-lanes`.

## 6. UI dự kiến (wireframe ở hồ sơ HTML §05)

- **`/chat` v2 (1280px+):** cột trái 320px — thanh «🔍 Tìm · ⚲ · ✎»; chip `Tất cả · Chưa đọc · Riêng · Nhóm · Phòng ban·Dự án · Đã lưu trữ`; mục Đã ghim / Riêng / Nhóm… mỗi dòng: avatar 40 (chấm online DM) · tên (đậm khi chưa đọc) · «Đỗ Tiến Bắc: Cái này triển khai…» · «2 ngày» · badge. Cột giữa — header avatar + tên + «Đang online» / «12 thành viên» + 🔍 📞 📹 ⓘ; bong bóng hai phía; thanh tác vụ nổi; composer: 📎 😊 @ + textarea + gửi; thumbnail chờ gửi. Cột phải 340px — bảng thông tin dọc DEC-025.
- **Drawer (mọi trang):** 400px bên phải, mở từ badge; ô tìm + chip; danh sách ↔ hội thoại (‹). ⤢ = mở `/chat`.
- **Mobile (<768):** 1 cột: danh sách → hội thoại (push, ‹ quay lại) → info là Sheet toàn màn.
- **Tokens:** giữ theme `packages/ui/src/styles/theme.css` (`--primary #1fa9e0`), light/dark; không thêm màu thương hiệu mới; bong bóng của tôi = `primary/12%` nền + `foreground` chữ (đo tương phản cả hai theme trong FE-2).

## 7. Rủi ro & bẫy đã biết (viết sẵn vào done_when)

| Bẫy (memory) | Áp vào WO |
| --- | --- |
| `server-masking-needs-optional-fe-schema` — 3 khoá DTO mới phải `.nullable().optional()`; 7 consumer `/chat/rooms` đang chạy | BE-1 |
| `ws-payload-narrower-than-rest-dto` — `peer.avatarUrl` là URL ký per-recipient, không được đi qua `chat:room` | BE-1, FE-1 (giữ giá trị cũ khi payload thiếu) |
| `duplicate-sibling-key-leaks-dom-node` — chip phẳng + mục cố định cùng dùng `RoomRow`; key duy nhất toàn danh sách | FE-1 |
| `ui-promises-backend-never-reads` — lưới «Ảnh/Video» phải lọc **server** (`kind`), không lọc trang client | BE-1, FE-4 |
| `read-path-gate-pair-must-match-download-pair` — ảnh trong lưới dùng đúng URL ký của CHAT-API-017, không dựng đường ký mới | FE-4 |
| `personal-prefs-must-not-sit-behind-permission-gate` — Tắt thông báo · Ghim trong bảng phòng | FE-4 |
| `chat-fe-single-socket-file` — drawer không mở socket thứ hai; `useChatRealtime` vẫn ở `ProtectedShell` | FE-5 |
| `react-query-v5-stale-mutationfn-closure` — chụp `before` tại điểm bấm cho mute/pin trong bảng phòng (dùng lại `useRoomPrefs`) | FE-4 |
| `ismounted-ref-stuck-false-under-strictmode` — composer v2 giữ nguyên cờ mounted khi tách sub-component | FE-3 |
| `fake-timers-break-socketio-client-emit` — test typing/mention không dịch đồng hồ | FE-3 |
| `console-had-zero-code-splitting` — emoji tĩnh + drawer lazy `import()`; không thêm dependency | FE-3, FE-5 |
| `vitest-unit-specs-must-be-colocated` · `coverage-audit-scan-both-globs` | mọi FE |
| N+1 ngầm: LATERAL phải nằm **trong** câu list, đo bằng EXPLAIN trong int-spec (memory `pg-planner-index-assert-trap` — assert trên plan, không trên `idx_scan`) | BE-1 |
| `fe-has-no-company-timezone` — thời gian tương đối tính ở client là chấp nhận được (tương đối, không phải ngày công ty) | FE-1 |

## 8. Definition of Done cấp wave

- SPEC-15 · API-13 · DB-12 · UI doc khớp code; §9 không còn dòng «DM hiện mã phòng».
- 3 khoá DTO mới + 1 route mới có int-spec deny-path (non-member · cross-tenant · thu hồi) trên `LANE_DB`.
- `chat-realtime-structure.spec.ts` (0 `@SubscribeMessage`) và ESLint single-socket-file **vẫn xanh** — wave không mở bề mặt WS nào.
- Coverage `apps/app/src/components/chat/**` ≥80%; snapshot 3 màn ở light + dark; axe 0 critical.
- `bash harness/check.sh --all` xanh; 9 WO đóng dấu; `TESTABLE-FEATURES.md` cập nhật.
- PROD: module CHAT vẫn `is_active=false`; wave này **không thêm nợ migration** — bật module là WO vận hành riêng (không thuộc wave).

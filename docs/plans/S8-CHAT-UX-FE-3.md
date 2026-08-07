# Kế hoạch thi công `S8-CHAT-UX-FE-3` — khung chat: avatar người gửi · gộp tin · cảm xúc · đang gõ · đang online

> Vùng **VÀNG**. Gate = **LIGHT** (`typescript-reviewer` + `react-reviewer` + `quality-gate`).
> Nguồn: `SPEC-15 §13.5` · `API-13 §5.1 · §7` · `CHAT-DEC-017` · `CHAT-DEC-018` · `CHAT-DEC-019` ·
> `docs/plans/S8-CHAT-UX-WAVE.md §2.1` mục 4/6/7. Ngày lập: 07/08/2026.

---

## 0. ĐÍNH CHÍNH PHẠM VI — WO này **KHÔNG** thuần FE

Seed của WO ghi `layer: "FE"` và `paths` chỉ liệt file `apps/app/**`. **Sai** — đo thật 07/08/2026:

| Bằng chứng | Kết luận |
| --- | --- |
| `docs/plans/S8-CHAT-UX-WAVE.md:49` — mục 4 khai tầng chạm là **"BE (1 route roster) + FE"** | Wave đã tính phần BE từ đầu |
| `API-13 §5.1:187` — "**CHAT-API-007a phải trả thêm `avatarUrl` cho từng thành viên** (CHAT-DEC-019)… Người đã rời phòng vẫn phải có trong danh sách (kèm `leftAt`)" | Hợp đồng API đã chốt, chưa ai thi công |
| `packages/contracts/src/chat.ts:370-381` — `chatRoomMemberSchema` KHÔNG có `avatarUrl`, KHÔNG có `leftAt` | Chưa build |
| `RoomAvatar.tsx:12-16` — nợ ghi tường minh: "Nguồn đúng là **roster phòng**… thứ `S8-CHAT-UX-FE-3` mới dựng" | FE-2 cố ý để lại cho WO này |
| `chat-presence.service.ts:150-155` — `getOnlineUserIds()` **CHƯA có endpoint nào gọi**; docblock: "Viết sẵn… để **WO kế tiếp gắn ảnh chụp lúc mở app vào `CHAT-API-007a`**" | RT-1 cố ý bàn giao cho WO này |

⇒ `paths` phải thêm: `packages/contracts/src/chat.ts` · `apps/api/src/chat/chat-members.service.ts` ·
`apps/api/src/chat/chat-rooms.repository.ts` · `apps/api/src/chat/chat.module.ts` ·
`apps/api/src/chat/**/*.spec.ts` · `packages/web-core/src/lib/chat-api.ts`.

Cũng sai: seed ghi `apps/app/src/locales/**` — đường thật là **`apps/app/src/i18n/locales/vi/chat.ts`**.

> Không thêm migration, không thêm route mới ⇒ **không** đụng route census, **không** đổi số migration.
> Gate vẫn LIGHT: không chạm permission/RLS/secret/audit/auth/migration. Đường ký URL có chạm — xem §2.3,
> nó **tái dùng** khuôn đã qua FULL gate hai lần, không mở khuôn mới.

---

## 1. Điểm xuất phát (ĐO THẬT 07/08/2026)

| Thứ | Trạng thái | Bằng chứng |
| --- | --- | --- |
| `chatMessageSchema.reactions` | CÓ, `.optional()`, `{emoji,count,mine}` | `contracts/chat.ts:218` |
| `PUT/DELETE /chat/messages/:id/reactions/:emoji` | CÓ ở client lẫn server | `chat-api.ts:196,208` |
| `POST /chat/rooms/:id/typing` (CHAT-API-023) | CÓ ở server, **chưa có ở `chatApi`** | `chat-rooms.controller.ts:153`; census `:1837` |
| `WS_EVENTS.CHAT_TYPING/CHAT_PRESENCE/CHAT_REACTION` | CÓ trong contracts, **0 listener ở FE** | grep `apps/app` → rỗng |
| Gộp tin liên tiếp | ĐÃ CÓ từ S7 — `GROUP_WINDOW_MS = 5'`, chặn `system` cả hai vế | `MessageList.tsx:24,215-222` |
| Tin `system` không avatar, không gộp | ĐÃ CÓ — nhánh return sớm | `MessageBubble.tsx:142-151` |
| Avatar người gửi | `<Avatar name={senderName}/>` — **chữ cái đầu, không ảnh** | `MessageBubble.tsx:161` |
| Roster ở FE | `chatApi.listMembers` **chưa được gọi ở đâu** | grep `apps/app` → chỉ `taskProjectApi.listMembers` |
| `AvatarPresignService.resolveEmployeeAvatars` | CÓ — ký LÔ, self-defending, fail-soft-có-log, nhận `callerTx` | `foundation/files/avatar-presign.service.ts:54` |
| Nối `users` ↔ ảnh | `employee_profiles.user_id` (unique `(company_id,user_id)`) + `.avatar_url` | `db/schema/employees.ts:44,62,99` |
| `emitChatPresence` fan-out tới đâu | **CHỈ peer của phòng `direct`** | `chat-presence.service.ts:180-188` |

### 1.1 Hai hệ quả rút ra từ bảng trên

**(a) Hai `done_when` đã XANH SẴN từ S7.** Gộp tin (`#1`) và tin hệ thống (`#2`) đã đúng hành vi. Việc của
WO này ở hai mục đó là **đóng đinh bằng test ĐẾM NODE** (seed yêu cầu tường minh) và **thay chữ cái đầu
bằng ảnh thật** — không viết lại thuật toán gộp.

**(b) Chấm online của phòng KHÔNG-direct là ẢNH CHỤP, không phải luồng sống.** `broadcast()` chỉ gửi tới
`listDirectPeerUserIds`. Đây là **thiết kế**, không phải thiếu sót: phát trạng thái online của mọi người
tới mọi phòng họ tham gia là đúng thứ `CHAT-DEC-017` gọi là "rò lịch làm việc". Hệ quả bắt buộc phải nói
thật trong code: ở phòng nhóm/phòng ban/dự án, chấm online **đúng tại thời điểm nạp roster** và được làm
mới khi refetch, **không** cập nhật theo thời gian thực. Phòng `direct` thì có luồng sống thật.

---

## 2. Phần BACKEND — làm giàu ĐÚNG MỘT route đã có

### 2.1 `chatRoomMemberSchema` += ba khoá, **cả ba `.optional()`**

```ts
avatarUrl: z.string().nullable().optional();  // URL ký TTL ngắn, KHÔNG persist
isOnline:  z.boolean().optional();            // ảnh chụp lúc gọi (xem §1.1b)
leftAt:    z.string().datetime().nullable().optional();  // CHAT-DEC-019
```

`.optional()` là bắt buộc, không phải phòng xa: schema này đã có consumer đang chạy (`chatRoomDetailDto`),
thêm khoá **required** làm mọi consumer ăn ZodError ngay khi FE lên trước BE
(memory `server-masking-needs-optional-fe-schema`, bài học `S7-SEC-ROLE2FA-UI-1`).

### 2.2 Hai đường đọc, **ngữ nghĩa KHÁC nhau** — cố ý

| Route | Tập thành viên | Vì sao |
| --- | --- | --- |
| `GET /chat/rooms/:id` (detail) | **ACTIVE** (giữ nguyên) | Đây là "ai đang ở trong phòng": nuôi số đếm ở header, danh sách quản trị, và bộ lọc `alreadyIn` của hộp thêm thành viên (`RoomInfoPanel.tsx:463`) |
| `GET /chat/rooms/:id/members` (CHAT-API-007a) | **ACTIVE + ĐÃ RỜI** (kèm `leftAt`) | Đây là **ROSTER** để vẽ tin: thiếu người đã rời thì tin cũ của họ mất cả avatar lẫn tên (CHAT-DEC-019) |

> ⚠️ **CẤM** hợp nhất hai đường bằng cách nhét người đã rời vào `detail.members`. Đo được 4 điểm gọi sẽ
> lệch, trong đó **một điểm hỏng thật**: `RoomInfoPanel.tsx:463` lọc `members.some(m => m.userId === …)`
> để chặn "đã ở trong phòng" — người ĐÃ RỜI lọt vào đó sẽ **không thêm lại được vào phòng**, không thông
> báo, không lý do. Đổi ngữ nghĩa của một DTO đang có người dùng là cách đắt nhất để tiết kiệm một request.

Cái giá của lựa chọn này: mở một phòng tốn **2** lần ký lô (detail ký avatar PHÒNG — đã có từ BE-2; roster
ký avatar NGƯỜI). `CHAT-DEC-019` cấm ký **theo từng tin** (50 tin = 50 lần ký); 2 lần ký **theo phòng**
là O(1), không phải O(số tin) — đúng tinh thần quyết định.

### 2.3 Ký avatar người gửi — **tái dùng** `AvatarPresignService`, không mở khuôn mới

- Repo trả thêm `employeeId` + `avatarRaw` (join `employee_profiles` theo `(company_id, user_id)`).
  Tên có hậu tố `Raw` **cố ý**: cột `avatar_url` là ĐA-NGƯỜI-GHI, không được vào DTO khi chưa xác minh.
- Service gọi `resolveEmployeeAvatars(companyId, subjects, tx)` — **một lô cho cả phòng**, truyền `tx` của
  caller (tránh nested-tx trên PgBouncer transaction-mode).
- Map trả về khoá theo `employeeId` ⇒ ánh xạ ngược về `userId` ngay tại service.
- Fail-soft có sẵn trong service (ký lỗi ⇒ vắng khỏi map ⇒ `avatarUrl: null` ⇒ chữ cái đầu). Không thêm
  lớp nuốt lỗi thứ hai.

**Cổng đọc:** roster đã gate `('view','chat-room')` + `assertMember` — người ngoài phòng nhận **404**
trước khi chạm bất kỳ dòng nào ở trên. Avatar là **directory-class** (đúng lớp mà `resolveEmployeeAvatars`
được xây cho: HR read + org-chart + task board), và phòng chat **đã** trả `userName` (họ tên đầy đủ) cho
mọi thành viên từ S7. Thêm ảnh đại diện vào đúng tập người đã lộ tên **không mở rộng tập chủ thể** —
không có cặp quyền mới, không có đường tải mới. Ghi ra đây để review không phải suy đoán chủ đích.

### 2.4 Ảnh chụp presence

`listMembers` gọi `ChatPresenceService.getOnlineUserIds(companyId, userIds)` **NGOÀI** `withTenant`
(Valkey, không phải DB) rồi đánh dấu `isOnline`. Valkey chưa cấu hình ⇒ trả `[]` ⇒ **mọi người `false`**,
không phải `undefined`: `false` là "không biết là đang online", đúng thứ UI cần vẽ (không có chấm).

⚠️ `ChatModule` phải với tới `ChatPresenceService` (đang ở `RealtimeModule`). `RealtimeModule` **đã**
`import { ChatModule }` (`chat-presence.service.ts` dùng `ChatRoomsRepository`) ⇒ chiều ngược là **vòng**,
Nest sập lúc bootstrap ⇒ 100+ int-spec đỏ dây chuyền (lớp `systemjobhandler-optional-dbw-di`).
**Chốt: KHÔNG import ngược.** Presence được tiêm qua token tuỳ chọn (`@Optional()`) do `RealtimeModule`
đăng ký toàn cục — cùng khuôn `RealtimeEmitterModule` đã tách ra để phá đúng vòng này. Thiếu provider ⇒
`isOnline` vắng ⇒ FE không vẽ chấm. Không có nhánh nào ném.

---

## 3. Phần FRONTEND

### 3.1 Roster (`useRoomRoster`)

`useQuery(chatKeys.rooms.members(roomId), () => chatApi.listMembers(roomId))`. Trả về:

- `avatarByUser: Map<userId, string|null>` — nguồn ảnh cho `MessageBubble`;
- `nameByUser: Map<userId, string>` — **fallback tên** cho tin của người đã rời;
- `onlineUserIds: Set<userId>`.

URL ký TTL ngắn ⇒ `staleTime` phải **nhỏ hơn** TTL, và **không** `persist`. Refetch khi cửa sổ lấy lại
tiêu điểm (cũng là lúc làm mới ảnh chụp presence).

### 3.2 `MessageBubble` — avatar thật + thanh cảm xúc

- `<Avatar src={avatarUrl} name={senderName}/>` — `src=null` ⇒ chữ cái đầu (hành vi cũ, không hồi quy).
- **Thanh cảm xúc** dưới bong bóng: chỉ hiện emoji có `count > 0`; nút `+` mở bộ **6 emoji cố định**
  (`chatReactionEmojiSchema.options` — lấy TỪ contracts, không chép tay danh sách thứ 4).
- Bấm emoji đang `mine` ⇒ bỏ thả. Cập nhật **lạc quan**, thất bại ⇒ **hoàn nguyên** + báo lỗi (không im).
- Tin đã thu hồi: **không** thanh cảm xúc, **không** nút thả (server trả `[]`, FE không được vẽ ngược).

### 3.3 Store — 3 nhánh mới, tất cả thuần

| Hàm | Luật |
| --- | --- |
| `applyReactionEvent(ev)` | Thay `count`, **GIỮ NGUYÊN `mine`** đang có. Payload WS `.omit({mine})` vì `mine` là per-user; đọc thiếu vế này là mỗi client vẽ một dấu tích sai (memory `ws-payload-narrower-than-rest-dto`) |
| `patchMessageReactions(id, list)` | Dùng cho lạc quan **và** hoàn nguyên — cùng một hàm, gọi lần hai với giá trị TRƯỚC là quay lại nguyên trạng (khuôn `patchRoomPrefs` của FE-2) |
| `applyTypingEvent(ev)` / `applyPresenceEvent(ev)` | `typingByRoom[roomId][userId] = expiresAt`. **Không** có sự kiện "ngừng gõ" (schema cố ý không có `isTyping`) ⇒ hết hạn là cơ chế tắt DUY NHẤT |

### 3.4 Đang gõ

- **Gửi:** `MessageComposer` gọi `chatApi.pingTyping(roomId)` **tiết lưu 3s** (leading-edge). Không gửi
  khi ô rỗng, không gửi khi phòng đã lưu trữ. Lỗi ping ⇒ **nuốt có chủ đích** (không toast): đây là tín
  hiệu mỹ thuật, một lần 5xx không được phép chen vào luồng gõ của người dùng.
- **Nhận:** chỉ báo tự tắt sau **5s** không nhận ping. Đồng hồ đặt ở **component** (một `setInterval`
  1s prune), KHÔNG đặt một `setTimeout` mỗi sự kiện — 20 người gõ = 20 timer chồng nhau.
- Tự lọc **chính mình**: server phát cho cả phòng kể cả người ping.

### 3.5 Chấm online

| Nơi | Vẽ? |
| --- | --- |
| Header hội thoại phòng `direct` | ✅ (luồng sống thật) |
| Danh sách thành viên (`RoomInfoPanel`) | ✅ (ảnh chụp — xem §1.1b) |
| Bong bóng tin / phòng nhóm-phòng ban-dự án | ❌ `done_when #5` cấm |

---

## 4. Thứ tự RED → GREEN

1. **RED test ĐẾM NODE avatar** — 3 tin liên tiếp cùng người trong 5' ⇒ **đúng 1** node avatar; sang phút
   thứ 6 ⇒ 2; xen một tin người khác ⇒ 3. Tin `system` ⇒ **0** avatar và không gộp tin quanh nó.
2. **RED cảm xúc** — bấm ⇒ `count` +1 lạc quan; API ném ⇒ **về đúng số cũ** + hiện lỗi; bấm lại emoji
   `mine` ⇒ gọi `unreact`. Tin thu hồi ⇒ 0 nút thả.
3. **RED WS reaction** — sự kiện `chat:reaction` (không có `mine`) ⇒ `count` đổi, `mine` **giữ nguyên**.
4. **RED typing** — 5 lần gõ trong 1s ⇒ **đúng 1** request; chỉ báo tắt sau 5s; sự kiện của CHÍNH MÌNH
   không hiện chỉ báo.
5. **RED roster** — tin của người đã rời phòng vẫn có tên + avatar; roster lỗi ⇒ rơi về chữ cái đầu,
   **không** trắng khung chat.
6. **RED BE** — `listMembers` trả người đã rời (kèm `leftAt`) còn `getRoom` thì **không**; avatar ký đúng
   **1 lô**; người ngoài phòng ⇒ 404 (không đổi).
7. GREEN → `pnpm build` (contracts + web-core dist — `stale-contracts-dist-typecheck-false-red`) →
   `bash harness/check.sh --lane-db` → LIGHT gate.

### 4.1 Kết quả thi công (07/08/2026)

`bash harness/check.sh --lane-db` → **XANH ✅** (`LANE_DB=mediaos_check`, **0** int-spec bị skip).

| Bộ test | Số ca | Ghi chú |
| --- | --- | --- |
| `MessageList.grouping.spec.tsx` | 9 | Đếm NODE avatar (`done_when #1`/`#2`) + avatar từ roster |
| `chat.store.fe3.spec.ts` | 14 | `mine` sống sót qua WS · TTL typing · presence |
| `ReactionBar.spec.tsx` | 8 | Bộ 6 emoji so THẲNG với `chatReactionEmojiSchema.options` |
| `MessageComposer.typing.spec.tsx` | 6 | Đếm REQUEST — 5 phím ⇒ 1 ping |
| `chat-roster.service.spec.ts` (API) | 10 | Thứ tự gate · ký 1 lô · `avatarRaw` không ra DTO |
| `chat-s8-fe3-roster.int-spec.ts` (DB thật) | 6 | Người đã rời trong roster · detail vẫn ACTIVE-only · không nhân bản · deny-path |

**Ba lần RED-proof đã chạy thật** (không suy đoán):

1. Bỏ `!isGrouped` khỏi `<Avatar>` ⇒ 2 ca đếm-node ĐỎ ⇒ bài test không phải tautology.
2. Thêm `chat-presence` vào allowlist lá ⇒ ca "thật sự là lá" ĐỎ (`chat-presence.service import ngược chat/**`).
3. Bỏ `isNull(employeeProfiles.deletedAt)` khỏi join roster ⇒ 2 ca int-spec ĐỎ, `uMate` xuất hiện **2 lần**
   — đúng lỗi nhân bản mà unique index PARTIAL cho phép xảy ra.

### 4.2 Ratchet đã SỬA (không nới)

`chat-realtime-structure.spec.ts` ca "chat/** chỉ đi qua realtime-emitter" trước đây là **allowlist theo
TÊN** (`realtime-emitter.(service|module)`), hẹp hơn ý định thật của nó ("chỉ đi qua MODULE LÁ"). Thêm
`chat-presence-reader` vào danh sách tên là chưa đủ — nên đã bổ sung một ca **thứ hai** đo lại *tính chất
lá* của từng mục trong allowlist (không import ngược `chat/**`, không import `realtime.gateway/module`).
Ratchet giờ ghim ĐỊNH NGHĨA, không ghim tên (memory `index-ratchet-must-pin-definition-not-name`).

### 4.3 Bàn giao cho `S8-CHAT-UX-QA-1`

- Ca cross-tenant cho roster (avatar/presence không rò giữa 2 công ty) — WO này chỉ phủ 1 tenant.
- Coverage ≥80% cho cụm chat mới.
- Kiểm `listRosterMembers` vẫn là hàm DUY NHẤT của repo không lọc `left_at IS NULL`.

---

## 5. Rủi ro đã biết

| Rủi ro | Chặn bằng |
| --- | --- |
| Vòng module `Chat → Realtime → Chat` sập bootstrap | §2.4 — tiêm `@Optional()`, KHÔNG import ngược |
| Đổi ngữ nghĩa `detail.members` làm hỏng "thêm lại người đã rời" | §2.2 — tách hai đường, có ghi lý do |
| `mine` bị payload WS ghi đè thành sai | §3.3 — hợp nhất giữ `mine`, có test |
| Ping typing mỗi phím ⇒ nện API | §3.4 — tiết lưu 3s, test đếm request |
| URL ký hết hạn ⇒ ảnh vỡ | `staleTime` < TTL + refetch-on-focus; `<Avatar>` rơi về chữ cái đầu |
| `contracts`/`web-core` dist cũ ⇒ typecheck đỏ oan | Bước 7 build TRƯỚC khi kết luận |

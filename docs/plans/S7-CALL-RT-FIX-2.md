# S7-CALL-RT-FIX-2 — gỡ thành viên giữa cuộc gọi: đóng chiều RÒ, thôi đóng dấu người vô tội

> **Vùng ĐỎ (crown-jewel).** Chạm `src/realtime/**` + luật từ chối signalling ⇒ FULL gate
> (`security-reviewer` + `silent-failure-hunter`), model Opus, người chốt merge.
>
> Nguồn: `harness/backlog.mjs` mục `S7-CALL-RT-FIX-2` · `docs/plans/S7-CALL-QA-1.md` §6.4 ·
> tripwire C5 `apps/api/test/integration/chat-s7-call-rt1-signalling.int-spec.ts:1033-1099`.
>
> **Phụ thuộc cứng:** `S7-CALL-QA-1` (tripwire C5) và **`S7-CALL-RT-FIX-1`** (cùng file gateway) phải
> land trước.
>
> ✅ **§3 ĐÃ CHỐT (owner, 11/08/2026): phương án B + vế 2 của A** — đóng participant ngay trong
> transaction gỡ thành viên (dùng lại đường `hangup`), CỘNG tra `chat_call_participants` khi
> `assertCallAccess` ném để thôi đóng dấu người vô tội. **Bỏ vế 1 của A** (join membership vào
> `listParticipants`) — nó là bản sao thứ hai của cùng một luật, đúng thứ docblock
> `chat-call-signal.service.ts:51` cấm. Chi tiết đánh đổi: §3.
>
> **LỊCH SỬ CỔNG REVIEW**
>
> **Vòng 1 (12/08) — `plan-reviewer`: BLOCK.** 3 CRITICAL + 7 HIGH + 7 MEDIUM. Ba cái nặng nhất, cả
> ba đều là lỗi THẬT của bản nháp chứ không phải khác biệt khẩu vị:
>
> | # | Bản nháp định làm | Vì sao SAI | Vá ở |
> | --- | --- | --- | --- |
> | **C1** | ghi cứng `outcome='left'` cho mọi hàng | người chưa nhấc máy (`joined_at IS NULL`) bị đóng dấu "đã vào rồi rời" — kết cục HẤP THỤ, bảng không có DELETE ⇒ **sai VĨNH VIỄN**. Và ca C5 chính là ca đó. | §3.1 B2 |
> | **C2** | §5 chỉ assert trên NẠN NHÂN | bản vá sai kiểu §2 (bỏ nạn nhân khỏi cả hai danh sách) làm cả 3 assert XANH trong khi **người ở lại** bị ghi hàng an ninh + ngắt | §5.1 · §5.2 |
> | **C3** | không nhắc `chat-realtime-after-commit.spec.ts` | ratchet gác đúng bất biến "emit SAU COMMIT" mà WO thêm lối phát mới vào — sẽ ĐỎ, và nếu chỉ sửa cho hết đỏ thì lối mới không có ai canh | §3.2 R-a |
>
> Ngoài ra: `wasCallParticipant` phải **tái dùng `findParticipant`** thay vì viết `SELECT` thứ ba
> (H2) · `severCallParticipation` phải **tách đôi** theo thời điểm, vế an ninh chạy TRONG tx (H3) ·
> phải tôn trọng giá trị trả về `boolean` của `setParticipantOutcome` (H4) · `callServer === null`
> phải `logger.error` (H5) · hàng audit phải nói rõ ĐÓNG THAM GIA CỦA AI (H6).
>
> **Lập luận bị bác:** *"vế `access ? false : …` là chỗ ép ranh giới lớp B"* — SAI, nó chỉ là bộ lọc
> chi phí (H1). Ranh giới do vị từ `user_id = actor` giữ, và chỗ ĐO nó là ca 1b (§5.2).
>
> **Vòng 2 (12/08) — BLOCK, nhưng chỉ còn 2 điểm, và cả hai do chính bản vá vòng 1 đẻ ra**
> (bài học `plan-review-rounds-inject-new-holes`). Reviewer xác minh C1/C2/C3/H1–H7 đều RESOLVED và
> mọi claim thêm ở vòng 2 đối chiếu code đều ĐÚNG. Hai điểm chặn — **đã vá trong commit này**:
>
> - **BLOCK-1** — §3.2 R-a tự mâu thuẫn: vừa stub `ChatCallRoomExitService`, vừa gọi
>   `evictFromCallRoom` từ TRONG nó, vừa đòi assert evict 1 lần ⇒ mutation `h` mất sạch detector.
>   → chốt call site của evict là **CALLER** (`chat-members`/`chat-rooms`), vẫn trong tx.
> - **BLOCK-2** — §5.3 ca 6 (ca ĐUA) không dựng được tất định: `hangup` đóng participant VÀ chuyển
>   `status` trong cùng tx, mà B1 lọc `status IN LIVE` ⇒ chạy tuần tự thì B1 trả 0 hàng và ca XANH
>   kể cả khi mutation `f` đang bật. → detector đổi thành **unit spec colocated** cho exit-service.
>
> Ngoài ra đã vá: hậu quả rollback của evict mô tả thiếu (mất cả `peer-left`, không chỉ mic/cam) ·
> `try/catch` không bắt được reject bất đồng bộ của adapter Valkey · call site THỨ BA
> (`chat-roster.service.spec.ts`) ⇒ dependency mới phải **append CUỐI** constructor · hàng M5 sửa
> thành "đã đo, là CHỜ chứ không phải deadlock hai chiều" · audit thêm `moduleCode`/`resultStatus` ·
> §5.4 thêm mutation `i` cho vế lọc `status IN LIVE`.
>
> **Reviewer chốt: KHÔNG cần vòng 3 đầy đủ** — hai điểm trên là sửa plan cỡ chục dòng. ✅ Đã sửa.
>
> ---
>
> ## ✅ ĐÃ THI CÔNG XONG — plan này giờ là HỒ SƠ, không phải việc cần làm
>
> Toàn bộ §3.1 · §3.2 · §5 đã hiện thực trên nhánh `s7-call-rtfix2-roomexit`. FULL gate đã chạy:
> HIGH-1 và cả 3 MEDIUM đều đã vá, 2 LOW cố ý để lại. **Số đo, phát hiện lúc thi công và các đột biến
> đã đo thật nằm ở `docs/QA/evidence/S7-CALL-RT-FIX-2.md`** — đọc file đó trước, plan này chỉ còn giá
> trị giải thích VÌ SAO từng lựa chọn được chốt.
>
> Ba thứ trong plan đã bị THỰC TẾ sửa lại, đừng đọc plan mà bỏ qua evidence:
>
> - **§3.1 B2 vị từ kết cục** — plan viết `joined_at IS NULL ⇒ missed`. **Chưa đủ.** `insertParticipants`
>   đặt `joined_at` cho NGƯỜI KHỞI TẠO ngay lúc MỜI ⇒ phải là vị từ **KÉP** `joined_at` + `accepted_at`
>   (HIGH-1 của FULL gate, đột biến `j`).
> - **§3.2 R-a / B4** — `evictFromCallRoom` chạy **HAI** lần (trong tx **và** sau commit), không phải một:
>   vế trong-tx một mình để hở **cửa sổ rejoin** (đột biến `k`).
> - **§3.1 A2 con số chi phí** — "10.800 truy vấn phụ/người/phút" trong plan là **SAI**; xem evidence
>   §2.3 cho cách tính đúng.
>
> ```bash
> eval "$(grep -E '^(APP|WORKER|SUPERUSER)_DB_PASSWORD=' .env | sed 's/^/export /')"
> export LANE_DB=mediaos_s7callrtfix2
> unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL
> ```

---

## 0. Đối xứng SAI — đo được 11/08/2026, không phải suy đoán

Gỡ một người khỏi phòng GIỮA cuộc gọi (`DELETE /chat/rooms/:id/members/:userId` → `left_at`):

| Chiều | Hiện tại | Đánh giá |
| --- | --- | --- |
| **NHẬN** (relay TỚI người bị gỡ) | vẫn relay SDP/ICE | ❌ chiều RÒ **MỞ** — họ tiếp tục thấy IP nội bộ + mốc thời gian của bên kia |
| **GỬI** (browser họ tự trickle ICE) | `user_security_events` + **NGẮT** | ❌ đóng dấu "dò cửa" một người **hoàn toàn vô tội** |

Chiều có hại thì mở, chiều vô hại thì bị trừng phạt. Và **trickle ICE là do WebRTC tự làm** — không
cần một thao tác người nào, nên hàng an ninh đó gần như CHẮC CHẮN sẽ được ghi.

### 0.1 Cơ chế — truy tới nguồn

**Chiều NHẬN mở, vì `activeUserIds` không biết gì về phòng:**

- `chat-calls.repository.ts:318-344` `listParticipants` chỉ đọc `chat_call_participants`
  `WHERE company_id AND call_id`. **Không** join `chat_room_members`, không đọc `left_at`.
- `chat-call-signal.service.ts:87-91` suy `activeUserIds` từ `outcome IN (NULL, 'accepted')`.
- ⇒ gỡ khỏi phòng **không chạm** `chat_call_participants` ⇒ người bị gỡ vẫn nằm trong
  `activeUserIds` của NGƯỜI CÒN LẠI ⇒ `assertPeer` (`gateway:696`) trả `true` ⇒ relay đi.
- Socket họ vẫn nối và vẫn ở trong `callUserRoomName` của chính họ ⇒ họ **nhận được**.

**Chiều GỬI bị trừng phạt, vì `resolveSignalAccess` mất sạch thông tin:**

- `chat-access.service.ts:370` `assertCallAccess` join `chat_room_members` ⇒ ném `NotFoundException`
  khi actor không CÒN là thành viên phòng.
- `chat-call-signal.service.ts:79-84` nuốt `NotFoundException` → trả **`null`**.
- `gateway:656` `!access` ⇒ `classifyMissingParticipant('call:ice-candidate') = 'probe'` ⇒
  `deny()` ⇒ ghi `user_security_events` + **NGẮT**.

Vế `actorIsParticipant` (`gateway:660-663`) — chính là thứ CA 9 dựng ra để **không** xếp người vừa
gác máy vào nhóm dò cửa — **không bao giờ được đọc tới**, vì `access` đã là `null` từ trước.

⇒ Đúng lớp lỗi CA 9 đã vá cho đường `hangup`; đường "gỡ thành viên" thì chưa ai vá.

### 0.2 ⚠️ ĐO THÊM 12/08 — chiều NHẬN có **hai** đường, không phải một

Đo lại toàn bộ đích phát của gateway trước khi viết code (grep `callRoomName` ·
`callUserRoomName` trong `call-signalling.gateway.ts`):

| Sự kiện | Đích phát | Có đi qua `assertPeer` không? |
| --- | --- | --- |
| `call:sdp-offer` · `call:sdp-answer` (`:716`) · `call:ice-candidate` (`:450`) | `callUserRoomName(to)` — room RIÊNG của người nhận | ✅ CÓ |
| **`call:media-state` (`:473`) · `call:screen-state` (`:496`)** | **`callRoomName(callId)` — room CHUNG của cuộc gọi** | ❌ **KHÔNG** |
| `call:peer-joined` (`:391`) · `call:peer-left` (`:412`, `:557`) | `callRoomName(callId)` | ❌ KHÔNG |

⇒ **Phương án B một mình KHÔNG đóng hết chiều NHẬN.** B làm người bị gỡ rơi khỏi `activeUserIds`,
nên `assertPeer` chặn được SDP/ICE. Nhưng `media-state`/`screen-state` là **broadcast vào room
chung**, và socket người bị gỡ **vẫn còn trong `callRoomName`** ⇒ họ tiếp tục biết bên kia bật/tắt
mic, cam, và **đang chia sẻ màn hình hay không**.

Rò ít hơn IP nội bộ, nhưng vẫn là "đã bị gỡ khỏi phòng mà vẫn theo dõi được cuộc gọi theo thời gian
thực". ⇒ Bản vá phải **kéo socket họ ra khỏi `callRoomName`**, đúng khuôn `socketsLeave` mà
`syncRoomMembership` (`realtime-emitter.service.ts:318`) đã dùng cho `/ws`.

> Ca C5 của QA-1 CHỈ đo `ice-candidate` ⇒ nếu chỉ làm B, C5 sẽ **xanh** trong khi lỗ vẫn còn.
> Đây đúng loại "xanh không đủ bằng chứng" — §5.2 vì thế thêm ca đối chứng `media-state`.

### 0.3 Hàng an ninh đó là VĨNH VIỄN

`user_security_events` là bảng **append-only** (app role không có UPDATE/DELETE — bất biến #2) và
**không có job dọn**. Một hàng ghi sai ở đây không sửa được, chỉ có thể ghi chú bên cạnh.

---

## 1. Hành vi ĐÚNG — chốt trước khi bàn cách làm

| Tình huống | Chiều NHẬN | Chiều GỬI |
| --- | --- | --- |
| Bị gỡ khỏi phòng giữa cuộc gọi | **KHÔNG** relay tới họ | **lớp C** — bỏ im lặng, không ghi, không ngắt |
| Vừa gác máy (`outcome='left'`) — CA 9, đã đúng | không relay | lớp C |
| **Chưa từng được mời** — ĐỐI CHỨNG, phải GIỮ | không relay | **lớp B** — ghi + ngắt |

🔴 **Ranh giới lớp B phải giữ nguyên.** Nới thành "ai cũng bỏ qua" là mở lại đúng bề mặt dò cửa mà
R2 dựng ra để chặn — và đó là bài học `reviewer-proposed-fix-can-open-holes` (nới AND→OR = leo thang).

---

## 2. Bẫy: vá vế NHẬN sai cách sẽ CHUYỂN nạn nhân, không xoá nạn nhân

Cách sửa hiển nhiên — "lọc người bị gỡ ra khỏi `activeUserIds` **và** `participantUserIds`" — là SAI:

```text
assertPeer (gateway:696-701):
  toUserId ∈ activeUserIds       → relay
  toUserId ∈ participantUserIds  → return false, IM LẶNG      (lớp C)
  ngược lại                      → deny() = ghi + ngắt NGƯỜI GỬI  (lớp B)
```

Bỏ nạn nhân khỏi **cả hai** danh sách ⇒ khung ICE mà **người còn lại** bắn tới họ rơi xuống nhánh
cuối ⇒ **người còn lại** bị ghi hàng an ninh + ngắt. Ta vừa đổi nạn nhân từ người-bị-gỡ sang
người-ở-lại, và vẫn là một người vô tội.

⇒ Người bị gỡ phải **rơi khỏi `activeUserIds` nhưng Ở LẠI `participantUserIds`** — đúng hình dạng mà
người vừa gác máy đang có.

---

## 3. ✅ QUYẾT ĐỊNH ĐÃ CHỐT — vá ở GỐC, ở LƯỚI, hay cả hai

> **Owner chốt 11/08/2026: B + vế 2 của A** (đúng khuyến nghị ở cuối mục này). Ba phương án dưới đây
> GIỮ NGUYÊN để người đọc sau thấy được cái giá của lựa chọn, không phải để chọn lại.

### Phương án A — chỉ vá ở lưới signalling (`resolveSignalAccess`)

1. `listParticipants` biết thêm "người này còn là thành viên phòng không" ⇒ `activeUserIds` loại
   người đã bị gỡ, `participantUserIds` giữ nguyên.
2. Khi `assertCallAccess` ném `NotFound`, tra `chat_call_participants` theo `(callId, actorUserId)`:
   có hàng ⇒ trả access "suy giảm" (`actorIsParticipant: true, actorIsActive: false`) ⇒ gateway rơi
   đúng vào nhánh lớp C sẵn có (`gateway:679`). Không có hàng ⇒ vẫn `null` ⇒ vẫn lớp B.

**Được:** đóng cả hai vế, không cần migration, không chạm đường REST.
**Mất:** phá bất biến *"`assertCallAccess` là điểm khẳng định DUY NHẤT"* (docblock
`chat-call-signal.service.ts:51`) — mở một truy vấn NGOÀI cổng membership. Phải chứng minh không đẻ
oracle: người ngoài không có hàng participant ⇒ không lộ thêm gì; nhưng đây đúng loại lập luận mà
`plan-reviewer` phải soi.

### Phương án B — vá ở GỐC (đóng participant khi gỡ thành viên)

Trong CÙNG transaction của `DELETE /chat/rooms/:id/members/:userId`: nếu người bị gỡ đang có hàng
participant sống ở một cuộc gọi sống của phòng đó ⇒ `setParticipantOutcome('left')` + phát
`peer-left`, tức **dùng lại y hệt đường `hangup`** mà CA 9 đã canh.

**Được:** không phá bất biến nào; chiều NHẬN đóng đúng gốc; hành vi trở nên **giống hệt** gác máy nên
không đẻ nhánh ngữ nghĩa thứ hai.
**Mất:** **không đóng được vế GỬI** — `assertCallAccess` vẫn ném (họ vẫn không còn là thành viên
phòng) ⇒ trickle ICE của họ vẫn bị đóng dấu lớp B. Và nó chạm bề mặt GHI vòng đời cuộc gọi từ
`chat-rooms`, tức mở rộng `paths` + cần audit log.

### Khuyến nghị: **B + vế 2 của A**

- **B** đóng chiều RÒ đúng gốc, bằng đúng đường đã có test.
- **Vế 2 của A** là thứ DUY NHẤT đóng được vế "đóng dấu người vô tội" — không có cách nào khác, vì
  ở thời điểm khung tới, thông tin "người này từng là participant" chỉ còn ở
  `chat_call_participants`.
- **Bỏ vế 1 của A** (join membership vào `listParticipants`) nếu B đã land: nó trở thành bản sao thứ
  hai của cùng một luật, và bản sao thứ hai chính là thứ docblock `:51` cấm.

⚠️ Nếu owner chọn **A đơn thuần**: phải nhận rằng khoảng thời gian giữa lúc gỡ và lúc người bị gỡ
gửi khung đầu tiên là vô hạn — họ ngồi im thì không ai đóng hàng participant của họ, và cuộc gọi
"còn 2 người" theo dữ liệu.

---

## 3.1 Hình dạng bản vá — chốt trước khi gõ (đã đọc code 12/08, không suy đoán)

### B1 — repo: tìm hàng participant CÒN SỐNG của một người trong các cuộc gọi SỐNG của một phòng

`chat-calls.repository.ts` — **method ĐỌC mới**, không phải method ghi:

```text
findOpenParticipantCallsInRoom(tx, companyId, roomId, userId) -> { callId, joinedAt }[]
  chat_call_participants  JOIN chat_calls ON (id + company_id)     ← vế company_id BẮT BUỘC,
  WHERE  cp.company_id = $co                                          thiếu = tích Descartes
    AND  c.room_id     = $room
    AND  c.status IN CHAT_CALL_LIVE_STATUSES        ('ringing','active')
    AND  cp.user_id    = $user
    AND  (cp.outcome IS NULL OR cp.outcome = 'accepted')   ← ĐÚNG tập `activeUserIds`, không định nghĩa lại
```

⚠️ Vị từ `outcome IS NULL OR = 'accepted'` phải là **cùng một hằng** với `setParticipantOutcome`
(`repository:202-209`) và `resolveSignalAccess` (`:87-89`) — ba chỗ viết tay ba lần là ba đường trôi.
Rút thành một helper dùng chung.

⚠️ **`joinedAt` PHẢI có trong `returning`** — nó là thứ quyết định kết cục ở B2, xem C1 ngay dưới.

### B2 — service mỏng dùng chung cho HAI cửa vào (gỡ + tự rời)

File mới `chat-call-room-exit.service.ts`, **một** method:

```text
closeCallParticipationOnRoomExit(tx, companyId, roomId, userId, now) -> { callId }[]
  1. B1
  2. mỗi hàng — kết cục theo TỪNG HÀNG, KHÔNG phải một hằng (xem C1):
        joined_at IS NOT NULL  ⇒ setParticipantOutcome(…, 'left',   { leftAt: now })
        joined_at IS NULL      ⇒ setParticipantOutcome(…, 'missed')      ← KHÔNG có leftAt
  3. `setParticipantOutcome` trả FALSE (khớp 0 hàng) ⇒ `continue`:
        KHÔNG audit, KHÔNG đưa vào danh sách phát.                       ← xem H4
  4. audit.record({ action: CALL_PARTICIPANT_CLOSED, objectType: 'chat_call', objectId: callId,
                    actorUserId: <người BẤM gỡ/rời>, actorType: 'User',
                    moduleCode: CHAT_MODULE_CODE, resultStatus: 'Success',   ← MỌI audit CHAT khác đều có
                    newValues: { userId: <người bị đóng>, roomId, outcome, reason } })   ← H6
  5. trả `callId[]` để caller phát `peer-left` SAU commit
```

#### 🔴 C1 — vì sao KHÔNG được ghi cứng `'left'` (BLOCK của vòng review 1)

`'left'` nghĩa là **"đã vào rồi rời"**. Người được mời mà chưa bấm nhận có `joined_at IS NULL` — họ
chưa từng ở trong cuộc gọi để mà rời. Codebase đã viết luật này thành hai docblock dài:

- `chat-calls.repository.ts:225-240` — `promoteJoinedTo` chỉ nâng `'left'` cho hàng **tự nó** có
  `joined_at`; hàng chưa bấm gì giữ kết cục nền (`'missed'`). Cùng chỗ: một hàng `'left'` mà
  `left_at IS NULL` *"tự nó là một sự KHÔNG NHẤT QUÁN"* — chiều ngược lại sai y hệt.
- `chat-calls.service.ts:298-303` — CA 11 (`uNoCallPair`) ĐỎ nếu ai gán `'left'` hàng loạt.

Và **ca C5 chính là ca xấu nhất**: `chat-s7-call-rt1-signalling.int-spec.ts:1037-1044` chỉ `invite` +
`call:join` (WS), **không** gọi REST `accept` ⇒ hàng nạn nhân là `joined_at IS NULL, outcome IS NULL`,
cuộc gọi còn `ringing`. Ghi cứng `'left'` ở đó là đóng dấu "đã nghe máy rồi cúp" lên một người **chưa
bao giờ nhấc máy**.

**Không sửa lại được:** `'left'` là kết cục HẤP THỤ (`setParticipantOutcome` WHERE =
`outcome IS NULL OR 'accepted'`), và bảng không có DELETE (`0546` khối C: `GRANT SELECT, INSERT` +
column-GRANT). Đúng lớp "hàng ghi sai VĨNH VIỄN" mà §0.3 dựng cả WO này để tránh — chỉ đổi bảng nạn
nhân từ `user_security_events` sang `chat_call_participants`.

#### Vì sao một file service riêng

`ChatMembersService`, `ChatRoomsService` và `ChatCallsRepository` **cùng nằm trong `ChatModule`**
(`chat.module.ts:199-210`), nên một file riêng **KHÔNG cấp bảo đảm kỹ thuật nào** — khối "CỐ Ý KHÔNG
export" (`:219-223`) chỉ giữ repo khỏi **module khác** (`/ws-call` ở `RealtimeModule`). Đây thuần tuý
là lựa chọn thiết kế: gom một phép ghi có tên tự mô tả phạm vi vào một chỗ, thay vì rải hai bản sao
qua hai service thành viên. Ai muốn biến nó thành bảo đảm thật thì phải thêm ratchet *"chat-members /
chat-rooms không import `ChatCallsRepository`"* — **ngoài phạm vi WO này**.

**KHÔNG kết thúc cuộc gọi** (`chat_calls.status` giữ nguyên): người còn lại tự gác. Xem §7 mục 4 cho
ca "không còn ai" (H7) — đó là lỗ CÓ SẴN TỪ TRƯỚC, được đóng đinh bằng test chứ không vá ở WO này.

### B3 — hai cửa vào gọi B2 TRONG CÙNG transaction

| Cửa | File | Chèn ngay sau |
| --- | --- | --- |
| `DELETE /chat/rooms/:id/members/:userId` | `chat-members.service.ts:215` | `repo.setMemberLeft(…)` |
| `POST /chat/rooms/:id/leave` | `chat-rooms.service.ts:406` | `repo.setMemberLeft(…)` |

Cùng tx = nếu tx rollback thì hàng participant cũng không đóng ⇒ không có trạng thái "đã đóng cuộc
gọi nhưng vẫn là thành viên phòng".

### B4 — emitter: HAI nghĩa vụ, HAI thời điểm khác nhau (sửa theo H3)

Vòng review 1 chỉ ra: bản nháp gộp cả hai vào "sau commit" mà không phản biện precedent nằm cách đó
30 dòng. `severUserSessions` (`realtime-emitter.service.ts:345-347`) viết rõ *"Gọi TRONG tx của caller
là CÓ CHỦ ĐÍCH… Đặt sau commit thì có cửa sổ mà phiên đã bị thu hồi ở DB nhưng socket vẫn đang nhận
tin."* ⇒ **tách đôi**, mỗi vế theo đúng bản chất của nó:

| Vế | Method | Gọi ở đâu | Vì sao |
| --- | --- | --- | --- |
| **AN NINH** — kéo socket khỏi `callRoomName` | `evictFromCallRoom(co, callId, userId)` | **TRONG tx, gọi từ CALLER** (`chat-members`/`chat-rooms`), ngay sau khi `closeCallParticipationOnRoomExit` trả `callId[]` | Fail-safe (hậu quả rollback: xem dưới). Đặt sau commit là để hở đúng cửa sổ `media-state`/`screen-state` mà §0.2 dựng ra để đóng. Cùng lập luận `severUserSessions`. |
| **THÔNG BÁO** — `call:peer-left` cho người còn lại | `emitCallPeerLeft(co, callId, userId)` | **SAU commit** | Ngược lại hoàn toàn: phát trước commit rồi rollback là **nói dối** — FE người còn lại phá `RTCPeerConnection` cho một người chưa hề rời. Đây là dữ liệu nghiệp vụ, không phải hàng rào. |

Chi tiết mỗi vế:

1. `emitCallPeerLeft` → `callServer.to(callRoomName(co, callId)).emit(PEER_LEFT,
   chatCallPeerSchema.parse({callId, userId}))` — phát cho **cả room, KHÔNG `.except()`**, y hệt
   `handleDisconnect` (`gateway:556`). Một khuôn, một ngữ nghĩa; FE lọc theo `callId` sẵn
   (`call-signalling.ts:109`).
2. `evictFromCallRoom` → `callServer.in(callUserRoomName(co, userId)).socketsLeave(callRoomName(co, callId))`.

**🔴 H5 — `callServer === null` KHÔNG được im lặng.** `this.callServer` chỉ được gán ở
`CallSignallingGateway.afterInit` (`gateway:187`); `REALTIME_ENABLED=false` hoặc gateway chưa init ⇒
`null`. Khuôn `?.` câm của `severUserSessions` (`:368`) **không** áp được ở đây vì vế 1 là vế AN NINH:
trạng thái hậu quả là *"DB nói đã rời, socket VẪN trong `callRoomName`"* = **RÒ**, không phải suy biến
chấp nhận được. ⇒ `logger.error` (không `debug`, không im lặng), theo đúng precedent `emitChatCall`
(`:272-278`) đã lập cho ca "server null, không có đường bù".

`try/catch` **RIÊNG cho từng vế** + `logger.error` — gộp một khối thì vế này ném sẽ nuốt vế kia. Cả
hai KHÔNG throw lên caller: vế 1 nằm trong tx nhưng ném ra sẽ **rollback cả thao tác gỡ thành viên**,
tức lấy một sự cố realtime đổi lấy một thao tác quản trị thất bại — sai chiều đánh đổi.

⚠️ **`try/catch` CHỈ phủ nhánh ném ĐỒNG BỘ.** `socketsLeave` với adapter Valkey publish trong một
promise nội bộ; reject ở đó KHÔNG rơi vào `catch` mà thành `unhandledRejection` (memory
`vitest-unhandled-rejection-after-teardown`). Đây là rủi ro **đã có sẵn** ở `severUserSessions` —
ghi ra để không ai đọc khối `try/catch` này thành "đã bọc kín".

⚠️ **Hậu quả rollback ĐẦY ĐỦ (không được mô tả nhẹ đi).** Rời `callRoomName` mất KHÔNG CHỈ chỉ báo
mic/cam: mất cả `call:peer-left` (`gateway:412`, `:557`). Nếu tx rollback, nạn nhân **vẫn là thành
viên hợp lệ** nhưng UI của họ sẽ **treo một peer ma khi bên kia gác máy**, và FE không có lệnh
`call:join` lần hai để tự sửa. Vẫn là chiều fail-safe (suy giảm UX ≪ rò dữ liệu), nhưng phải ghi
đúng để `S7-CALL-QA-2` biết mà đo.

### A2 — thôi đóng dấu người vô tội

`chat-call-signal.service.ts` — **method ĐỌC thứ hai**:

```text
wasCallParticipant(companyId, callId, actorUserId) -> boolean
  return this.db.withTenant(companyId, (tx) =>                       ← BẤT BIẾN #1, không bỏ được
    this.calls.findParticipant(tx, companyId, callId, actorUserId)   ← TÁI DÙNG, không viết SELECT mới
  ) !== null
```

🔴 **H2 — KHÔNG viết `SELECT 1` bằng tay.** `ChatCallsRepository.findParticipant`
(`chat-calls.repository.ts:282-315`) đã làm chính xác `company_id + call_id + user_id LIMIT 1`, và
`ChatCallSignalService` **đã inject repo đó** (`chat-call-signal.service.ts:59`). Viết bản sao thứ ba
là vi phạm đúng luật mà B1 vừa đặt ra ở trên ("ba chỗ viết tay ba lần là ba đường trôi").

`call-signalling.gateway.ts:656` đổi thành:

```text
if (!access || !access.actorIsParticipant) {
  const former = access ? false : await this.signal.wasCallParticipant(co, callId, actor);
  if (!former && classifyMissingParticipant(event) === 'probe')  deny()      ← lớp B, GIỮ NGUYÊN
  else                                                           logger.debug()  ← lớp C
  return null;
}
```

**Ba tính chất phải giữ, và vì sao chúng đúng:**

1. **Không đẻ oracle.** Truy vấn khoá cứng `user_id = actor` ⇒ actor chỉ biết được về **chính mình**.
   Người CHƯA TỪNG được mời không có hàng ⇒ luôn `false` ⇒ luôn lớp B. Khác biệt hành vi duy nhất mà
   actor quan sát được là "tôi từng được mời vào cuộc gọi này" — thứ họ **đã biết** từ lúc nhận
   `chat:call{ringing}`. Không thông tin mới nào rời hệ thống.
2. **Ranh giới lớp B do vị từ `user_id = actor` giữ — KHÔNG phải do ternary.** 🔴 Sửa theo H1: bản
   nháp viết *"vế `access ? false : …` là chỗ ép điều đó, bỏ nó đi là nới AND→OR"* — **SAI**.
   `actorIsParticipant` = `participantUserIds.includes(actor)`, mà `participantUserIds` đến từ
   `listParticipants(companyId, callId)` (`:86-99`) — **cùng bảng, cùng khoá** với
   `findParticipant`. ⇒ `access ≠ null && !actorIsParticipant` **kéo theo**
   `wasCallParticipant = false`. Ternary là **bộ lọc chi phí**, bỏ đi thì hành vi KHÔNG đổi.
   Hệ quả phải ghi ra: §5.4 **không** liệt "bỏ ternary" làm đột biến (nó sẽ không đỏ, và một mutation
   không đỏ được ghi vào danh sách sẽ dạy người sau tin nhầm). Chỗ đo ranh giới lớp B là **ca 1b**.

   Bảng liệt kê ĐẦY ĐỦ trạng thái tới được — đây mới là bằng chứng, không phải câu văn:

   | `access` | `actorIsParticipant` | `wasCallParticipant` | Lớp | Bản vá có đổi? |
   | --- | --- | --- | --- | --- |
   | `null` | — | `false` | **B** (ghi + ngắt) | không |
   | `null` | — | `true` | **C** (im lặng) | ✅ **CÓ — đây là toàn bộ mục đích của A2** |
   | `≠ null` | `false` | (không chạy) | **B** | không |
   | `≠ null` | `true` | — | rơi xuống `gateway:680` | không |

3. **Chi phí:** truy vấn thứ 3 CHỈ chạy ở nhánh `access === null`, **không phải mỗi khung**. Lời hứa
   "~2 truy vấn điểm mỗi khung" ở docblock `:48` vẫn đúng cho đường thành công; docblock phải nói rõ
   nhánh từ chối tốn 2 (assert + participant).
   ⚠️ Sửa theo M4 — **không** viết "không thành bộ khuếch đại" trống không. Số thật: nhánh từ chối đi
   từ 1 lên 2 truy vấn cho **mọi** khung của người không còn là thành viên; trần là `chargeFrame`
   (120/10 s, cứng 360) **theo SOCKET**, còn số socket bó bởi `CHAT_CALL_CONNECT_MAX_PER_MIN = 30`
   /người/phút. Trần trên thực tế = 30 socket × 360 khung = 10.800 truy vấn phụ/người/phút ở kịch bản
   xấu nhất. Chấp nhận được, nhưng phải là một CON SỐ chứ không phải một lời trấn an.

⚠️ Docblock `chat-call-signal.service.ts:45` đang viết *"export ĐÚNG một phép đọc … và không được
thêm"*. Bản vá này thêm phép đọc thứ hai ⇒ **phải sửa docblock trong cùng PR**, nói rõ: hai phép ĐỌC,
0 phép ghi, và phép thứ hai bị khoá vào hàng của CHÍNH actor. Để nguyên câu cũ là để lại một lời hứa
mà code vừa phá — đúng lớp `ui-promises-backend-never-reads` ở chiều ngược.

---

## 3.2 🔴 Ratchet ĐANG CÓ mà bản vá làm đỏ / làm hết đúng (vòng review 1 — C3 + M2)

Hai bài test hạ tầng đo đúng những thứ WO này chạm. Cả hai **đã xác minh bằng cách đọc file**, không
phải suy đoán — và cả hai đều phải nằm trong `paths`, nếu không nửa sau của WO không có ai canh.

### R-a · `apps/api/src/chat/chat-realtime-after-commit.spec.ts` — sẽ ĐỎ

- `makeRealtime()` (`:34-46`) liệt kê **đúng 5** lối phát; `totalCalls()` cộng `mock.calls` của cả 5.
- `build()` dựng `new ChatMembersService(db, repo, access, audit, realtime, avatar, presence)` bằng
  **thứ tự tham số**.

⇒ Thêm dependency vào constructor `ChatMembersService`/`ChatRoomsService` **và** gọi
`realtime.emitCallPeerLeft(...)` sẽ làm `not a function` → TypeError → ca `removeMember: COMMIT hỏng`
và `POSITIVE CONTROL` ĐỎ.

Nhưng nặng hơn TypeError: ratchet này **chính là** thứ gác bất biến *"emit SAU COMMIT"*, và WO đang
thêm một lối phát mới vào đúng hai method nó đo. Land mà không mở rộng nó = lối mới không có ai canh.

**🔴 BLOCK-1 của vòng 2 — bản nháp R-a TỰ MÂU THUẪN.** Nó vừa bảo stub `ChatCallRoomExitService`,
vừa bảo `evictFromCallRoom` gọi từ TRONG exit-service, vừa đòi assert `evictFromCallRoom` 1 lần. Ba
điều đó không đồng thời đúng: exit-service bị stub ⇒ call site nằm trong stub ⇒ evict **không bao giờ
được gọi** ⇒ assert xanh-rỗng hoặc đỏ vĩnh viễn, và mutation `h` (§5.4) mất sạch detector.

**Chốt lại — call site của `evictFromCallRoom` là CALLER, không phải exit-service:**

```text
// chat-members.service.ts / chat-rooms.service.ts, TRONG callback withTenant:
await this.repo.setMemberLeft(tx, …);
const closed = await this.callExit.closeCallParticipationOnRoomExit(tx, co, roomId, userId, now);
for (const { callId } of closed) this.realtime.evictFromCallRoom(co, callId, userId);  ← TRONG tx
… commit …
for (const { callId } of closed) this.realtime.emitCallPeerLeft(co, callId, userId);   ← SAU commit
```

Vẫn thoả H3 (evict vẫn nằm trong tx), **và** là cách DUY NHẤT ratchet đo được nó khi exit-service bị
stub.

**Bắt buộc làm, chính xác:**

1. `makeRealtime()` → thêm **`emitCallPeerLeft`** (thành 6 lối). `evictFromCallRoom` **KHÔNG** vào đó.
2. Spy cho evict đặt NGOÀI bộ đếm: `const realtime = { ...makeRealtime(), evictFromCallRoom: vi.fn() }`,
   và `totalCalls()` phải cộng **đúng 6 khoá của `makeRealtime()`**. ⚠️ `totalCalls` hiện là
   `Object.values(rt)` (`:45-46`) — trải phẳng cả object mở rộng vào đó là hỏng NGAY: evict lọt vào
   bộ đếm "0 lối khi commit hỏng" và ratchet sẽ khẳng định điều NGƯỢC LẠI với thiết kế.
3. Stub `ChatCallRoomExitService.closeCallParticipationOnRoomExit` trả `[{ callId: CALL }]` — nếu trả
   rỗng thì ca POSITIVE CONTROL không có gì để phát và xanh rỗng.
4. Ca cần thêm, **ở CẢ HAI `build()`** — `:93` (`ChatMembersService`) và `:276` (`ChatRoomsService`):
   - COMMIT hỏng ⇒ `totalCalls === 0` (**0/6 lối**) **NHƯNG** `evictFromCallRoom` **1 lần**. Chính
     bất đối xứng này là thứ đáng đóng đinh, và là detector của mutation `h`.
   - POSITIVE CONTROL: commit OK ⇒ `emitCallPeerLeft(COMPANY, CALL, TARGET)` đúng 1 lần.
   ⚠️ `describe` của `ChatRoomsService` hiện **chưa có ca `leaveRoom` nào** — phải thêm mới, không
   phải sửa ca có sẵn.

**⚠️ Ràng buộc "APPEND LAST" — có call site THỨ BA ngoài `paths` ban đầu.**
`chat-roster.service.spec.ts:94-102` cũng dựng `ChatMembersService` bằng **7 tham số vị trí**.
⇒ dependency mới (`ChatCallRoomExitService`) **PHẢI thêm vào CUỐI** danh sách tham số của constructor.
Chèn vào giữa làm file đó đỏ với thông báo khó hiểu, và nó nằm ngoài `paths` nên `guard-scope` sẽ kêu
trước khi ta hiểu vì sao. File đã được thêm vào `paths`.

### R-b · `apps/api/src/realtime/chat-realtime-structure.spec.ts` — vẫn XANH nhưng lời hứa HẾT ĐÚNG

- `:201-209` đếm `.emit(` **chỉ trong file gateway** ⇒ thêm emit ở `realtime-emitter.service.ts`
  không làm nó đỏ.
- Nhưng docblock `call-signalling.gateway.ts:123-124` hứa *"Đúng **một** call site `.emit(`… Ratchet
  `chat-realtime-structure.spec.ts` đếm cả hai điều này"*.

Sau B4 có **người phát thứ hai** vào namespace `/ws-call`. Ratchet xanh + lời hứa sai = đúng lớp
`ui-promises-backend-never-reads` mà chính plan này viện dẫn ở A2.

**Bắt buộc làm:** sửa docblock gateway (nói rõ: gateway có 1 call site; người phát thứ hai là
`RealtimeEmitterService.emitCallPeerLeft`, và nó cũng `.parse()`) **và** mở rộng ratchet để phủ call
site mới — assert nó `.parse()` trước khi `.emit(`. Chỉ sửa docblock mà không mở ratchet là đổi một
lời hứa không được canh lấy một lời hứa khác không được canh.

---

## 4. Bẫy kỹ thuật đã biết, phải né

| Bẫy | Nguồn | Áp vào đâu |
| --- | --- | --- |
| Join `chat_room_members` nhân bản hàng | memory `partial-unique-index-makes-join-duplicate` | ⚠️ **ĐÃ KIỂM — bẫy này KHÔNG áp ở đây:** vào lại phòng **tái dùng CHÍNH hàng cũ** (`chat-rooms.repository.ts:624` `.set({ leftAt: null, role })`), không chèn hàng thứ hai ⇒ 1 hàng/(room,user). Vẫn nên dùng `EXISTS` cho rẻ, nhưng **không được** viết plan như thể nhân bản là rủi ro đang có — sai sự thật sẽ dẫn người sau đi vá một thứ không tồn tại |
| Ghi vào bảng append-only không có đường lùi | bất biến #2 | mọi thay đổi ở `deny()` |
| Nới điều kiện từ chối = leo thang | memory `reviewer-proposed-fix-can-open-holes` | §1 bảng ranh giới |
| `drizzle` sql`` cột không kèm tên bảng ⇒ subquery tự tham chiếu LUÔN 0 | memory `drizzle-sql-template-renders-columns-unqualified` | JOIN ở B1 |
| Chi phí: docblock hứa "~2 truy vấn điểm mỗi khung" | `chat-call-signal.service.ts:47-53` | thêm truy vấn thứ 3 phải khai + cập nhật docblock |
| **M5 · Thứ tự khoá bảng khác nhau giữa hai đường ghi** | nêu vòng 1, **ĐO LẠI ở vòng 2** | ⚠️ **KHÔNG phải deadlock hai chiều** — đừng chép cảnh báo vòng 1. `removeMember` khoá `chat_room_members` → `chat_call_participants`; `hangup` khoá `chat_calls` → `chat_call_participants`. Hai đường chỉ giao nhau ở **MỘT** tài nguyên, và B1 dùng `SELECT` trần (KHÔNG `FOR UPDATE`) ⇒ là **CHỜ**, không phải ôm chéo. Không có ca test nào cho hàng này; ghi ra để người sau khỏi đi tìm một ca không tồn tại |
| **M6 · `state.joinedCallIds` của nạn nhân KHÔNG được dọn** | `gateway:551-562` | Sau `socketsLeave`, socket vẫn giữ `callId` trong state ⇒ lúc họ rớt, `handleDisconnect` phát **`peer-left` lần hai**. Vô hại (idempotent theo docblock `:532-538`) nhưng plan **không được** nói trạng thái sau vá "giống hệt khi socket rớt" — nó KHÁC ở đúng điểm này |
| **M7 · Bản vá KHÔNG có đường lùi dữ liệu** | bất biến #2 | Revert PR hoàn nguyên CODE, **không** hoàn nguyên các hàng `chat_call_participants` đã đóng (kết cục hấp thụ, bảng không có DELETE). ⇒ **C1 phải đúng ngay lần đầu**, không có vòng hai |
| **L3 · `socketsLeave` xuyên instance trên `/ws-call` chưa ai đo** | — | Precedent chỉ có ở `/ws` (`syncRoomMembership:306-328`). Ghi là **giả định**; ca §5.3 ca 2 đo nó trên một instance |

---

## 5. Test — C5 phải LẬT, và cần 3 ca ĐỐI CHỨNG

`apps/api/test/integration/chat-s7-call-rt1-signalling.int-spec.ts`.

### 5.1 C5 — lật tripwire *(done_when #4)*

| Assert | Trước (lỗ) | Sau (vá) |
| --- | --- | --- |
| `stillReceives` | `toBe(true)` | **`toBe(false)`** — chiều rò đóng |
| `punished` | `toBe(true)` | **`toBe(false)`** — không ghi hàng an ninh |
| `victim.disconnected` | `toBe(true)` | **`toBe(false)`** — không ngắt |

**Giữ nguyên docblock cơ chế** — nó là hồ sơ vì sao ca tồn tại (cùng nguyên tắc đã áp cho C2 ở
RT-FIX-1).

🔴 **C2 — thêm 2 assert vào CHÍNH ca C5, nếu không nó xanh-rỗng.** Cả 3 assert trên đều đo **nạn
nhân**. Một hiện thực SAI theo đúng kiểu §2 cảnh báo (lọc nạn nhân khỏi **cả** `activeUserIds` lẫn
`participantUserIds`) làm cả 3 assert XANH — trong khi `assertPeer` (`gateway:696-701`) rơi xuống
`deny()` và ghi hàng an ninh + ngắt **NGƯỜI Ở LẠI**. Nạn nhân bị CHUYỂN, không bị xoá, và không assert
nào nhìn thấy.

⇒ Ngay sau `peer.socket.emit("call:ice-candidate", { toUserId: uRemove })`, thêm:

| Assert mới | Kỳ vọng | Bắt được gì |
| --- | --- | --- |
| `securityEvents` của **`uRemovePeer`** không tăng | `toBe(0)` | vá kiểu "bỏ khỏi cả hai danh sách" |
| `peer.disconnected` | `toBe(false)` | …và người ở lại không bị ngắt |

### 5.2 Ca ĐỐI CHỨNG bắt buộc — không có thì C5 xanh rỗng *(done_when #3)*

🔴 **Ca 1 phải TÁCH ĐÔI (C2).** "Người chưa từng được mời" có **hai** trạng thái khác nhau, và **chỉ
một** đi qua code mới — gộp chúng là để hở đúng nhánh mà A2 sửa:

| # | Dựng thế nào | `access` | `wasCallParticipant` | Kỳ vọng |
| --- | --- | --- | --- | --- |
| **1a** | CÒN là thành viên phòng, chưa từng được mời vào cuộc gọi | `≠ null` | *(không chạy)* | lớp **B** |
| **1b** | **KHÔNG** phải thành viên phòng, chưa từng được mời | `null` | `false` | lớp **B** |

**Chỉ 1b ép được ranh giới lớp B ở nhánh A2 sửa.** Thiếu nó, đột biến *"`wasCallParticipant` luôn trả
`true`"* — tức mở toang lớp B thành lớp C cho MỌI người ngoài — vẫn xanh toàn bộ. Đây đúng bài học
`deny-cases-vacuous-without-allow-case`.

- **Ca 2 — người vừa gác máy** (CA 9) ⇒ **vẫn lớp C**. Hồi quy: bản vá không được đổi hành vi đã đúng.
- **Ca 3 — relay bình thường giữa 2 người còn trong phòng** ⇒ vẫn tới nơi. Không có ca này thì "chiều
  nhận đóng" xanh kể cả khi ta chặn relay của **mọi người**.
- 🔴 **Ca 4 — `call:media-state` sau khi bị gỡ ⇒ KHÔNG tới nạn nhân** (§0.2). Không có ca này thì vế
  `evictFromCallRoom` không có ai canh, và C5 (chỉ đo `ice-candidate`) xanh trong khi lỗ còn mở.

### 5.3 Ca cho phương án B — trạng thái DB + hai cửa vào

1. 🔴 **Kết cục theo TỪNG HÀNG (C1) — tách hai ca, đây là ca quan trọng nhất của §5:**
   - gỡ người **ĐÃ `accept`** (`joined_at` có) ⇒ `outcome='left'` **và** `left_at` được đặt;
   - gỡ người **đang đổ chuông** (`joined_at IS NULL`) ⇒ `outcome='missed'` **và `left_at` VẪN NULL**.

   Ca thứ hai là ca mà C5 thật sự dựng (`:1037-1044` không gọi `accept`). Thiếu nó, bản vá ghi
   `'left'` cho người chưa nhấc máy và **không ai phát hiện** — dữ liệu sai VĨNH VIỄN (M7).
2. Người còn lại nhận `call:peer-left` cho đúng `callId`.
3. Gỡ một người **không** ở trong cuộc gọi nào ⇒ không đụng `chat_call_participants` (không ghi thừa),
   và **0 hàng audit** `CALL_PARTICIPANT_CLOSED`.
4. 🔴 **Cửa vào thứ HAI: `POST /chat/rooms/:id/leave`** (§7 mục 2) — cùng bộ assert như ca 1. Cùng một
   lỗ, hai cửa; ca test chỉ chạy `DELETE` là chỉ vá được một nửa.
5. 🔴 **M3 — chứng minh CÙNG TRANSACTION, không phải "ghi trước khi trả lời".** "Đọc DB ngay sau khi
   route trả 200" **không** chứng minh được gì về tính nguyên tử. Bằng chứng duy nhất là ca
   **rollback**: ép tx hỏng sau `setMemberLeft`, assert hàng `chat_call_participants` **KHÔNG đổi** —
   đúng khuôn `makeDb(commitFails)` đã có ở `chat-realtime-after-commit.spec.ts:48-57`.
6. 🔴 **H4 — detector phải là UNIT SPEC TẤT ĐỊNH, không phải ca đua (BLOCK-2 của vòng 2).**

   Bản nháp đòi một ca int "nạn nhân `hangup` trước khi tx gỡ chạy tới `setParticipantOutcome`".
   **Đo lại: trạng thái đó không tới được bằng kịch bản tuần tự.** `hangup`/`reject`/`cancel`/
   `expireStaleRinging` đều đóng hàng participant **VÀ** chuyển `chat_calls.status` sang trạng thái
   kết thúc trong CÙNG tx (`chat-calls.service.ts:249-261`, `:274-282`, `:305-327`;
   `chat-calls.repository.ts:365-405`). Mà B1 lọc `c.status IN CHAT_CALL_LIVE_STATUSES` ⇒ chạy tuần
   tự "hangup rồi gỡ" thì **B1 trả 0 hàng**, `setParticipantOutcome` không hề được gọi ⇒ ca XANH
   **kể cả khi mutation `f` đang bật**. Ca chỉ đo vế lọc trạng thái của B1, không đo `if (!ok) continue`.

   Trạng thái thật ("hàng còn mở lúc SELECT, đã đóng lúc UPDATE, cuộc gọi VẪN sống") chỉ tới được
   bằng giao thoa hai transaction commit đúng khe giữa hai câu lệnh — không có seam nào để ghim, và
   một ca bắn song song sẽ là ca XÁC SUẤT (memory `parallel-int-specs-share-one-outbox`).

   ⇒ **Detector = unit spec colocated `apps/api/src/chat/chat-call-room-exit.service.spec.ts`**
   (memory `vitest-unit-specs-must-be-colocated`): stub `findOpenParticipantCallsInRoom` →
   `[{ callId, joinedAt: null }]`, stub `setParticipantOutcome` → **`false`** ⇒ assert
   `audit.record` **0 lần** và mảng trả về **RỖNG** (không có `callId` nào để phát `peer-left`).
   Ca đua ở int-spec: **tuỳ chọn**, và tuyệt đối **không được là detector duy nhất**.

### 5.4 Mutation check — danh sách ĐÓNG, mỗi đột biến phải làm ĐỎ đúng một ca

Không đỏ = ca rỗng. Liệt kê tường minh để người sau đo lại được:

| # | Vô hiệu hoá | Ca phải ĐỎ |
| --- | --- | --- |
| a | bỏ hẳn B (không đóng participant) | C5 · `stillReceives` |
| b | bỏ `evictFromCallRoom` | §5.2 ca 4 (`media-state`) |
| c | `wasCallParticipant` luôn trả `true` | §5.2 ca **1b** |
| d | bỏ nạn nhân khỏi `participantUserIds` (vá kiểu §2) | C5 · assert "người ở lại không bị phạt" |
| e | ghi cứng `outcome='left'` cho mọi hàng | §5.3 ca 1 vế `joined_at IS NULL` |
| f | bỏ vế `if (!ok) continue` | §5.3 ca 6 (đua) |
| g | chuyển `emitCallPeerLeft` vào TRONG tx | R-a: ca "COMMIT hỏng → 0/6 lối" |
| h | chuyển `evictFromCallRoom` ra SAU commit | R-a: assert bất đối xứng "0/6 lối NHƯNG evict 1 lần" |
| i | bỏ vế `c.status IN CHAT_CALL_LIVE_STATUSES` khỏi B1 | ca mới: **gỡ người sau khi cuộc gọi ĐÃ kết thúc ⇒ 0 hàng audit**. Vế lọc này là thứ DUY NHẤT chặn việc đóng lại hàng của một cuộc gọi đã xong, và trước vòng 2 **không mutation nào chạm tới nó** |
| **j** | bỏ vế `accepted_at` khỏi vị từ KÉP (chỉ xét `joined_at !== null`) | unit spec + `FIX2/§5.4-j`. **Đây là lỗi ĐÃ XẢY RA**, `security-reviewer` bắt ở FULL gate 13/08: `insertParticipants` đặt `joined_at` cho NGƯỜI KHỞI TẠO ngay lúc MỜI ⇒ mọi cuộc gọi `ringing` đã có sẵn một hàng `joined_at` khác NULL ⇒ người khởi tạo tự rời phòng bị đóng dấu `'left'` VĨNH VIỄN |
| **k** | chuyển lần `evictFromCallRoom` **SAU commit** đi (giữ mỗi vế trong-tx) | R-a: ca "POSITIVE CONTROL — evict ĐÚNG **2** lần". Đo thật 13/08: đúng 1 ca đỏ, phần còn lại xanh. Vế sau-commit đóng **cửa sổ rejoin** (join ở tx khác đọc READ COMMITTED chưa thấy `left_at` mới ⇒ `socketsJoin` đưa nạn nhân trở lại room). ⚠️ Chỉ `toHaveBeenCalled()` thì đột biến này **không** đỏ — phải là CẶP SỐ 1 (commit hỏng) / 2 (commit OK) |
| **l** | bỏ neo tên method ở `takesCallerTx` (quay lại khớp `(` bất kỳ) | `chat-be1-access.int-spec.ts` ca "carve-out neo vào `(` của CHÍNH method". Không neo ⇒ `foo(roomId: string, run: (tx: TenantTx) => …)` — controller GỌI ĐƯỢC — được miễn `assertMember` oan, và khuôn đó **đã có trong repo** |

⚠️ **KHÔNG** liệt "bỏ ternary `access ? false : …`" vào danh sách — theo H1 nó **không** làm đỏ ca nào
(nó là bộ lọc chi phí, không phải hàng rào). Ghi một đột biến không đỏ được vào danh sách là dạy người
đọc sau tin nhầm rằng chỗ đó có ai canh.

---

## 6. Thứ tự thi công

1. ✅ **CHỜ**: `S7-CALL-QA-1` (PR #374) và `S7-CALL-RT-FIX-1` (PR #375) — **cả hai ĐÃ land** trên
   master (xác minh 12/08: `e2e2b9c`/`a56e0c3`).
2. ✅ **Owner chốt §3** (11/08): B + vế 2 của A.
3. ✅ `plan-reviewer` vòng 1 — **BLOCK**, 3 CRITICAL + 7 HIGH. Đã vá vào §0.2 · §3.1 · §3.2 · §4 · §5 ·
   §7. → vòng 2 phải **PASS** trước khi code.
4. ✅ Mở rộng `paths` (14 mục) + `done_when` (7 mục). **KHÔNG** `migrations/**` — xem L2 dưới.
5. RED: viết §5.1 (kể cả 2 assert C2 mới) + §5.2 + §5.3 ⇒ ca đối chứng xanh, C5 (đã lật) đỏ.
6. Vá B1→B2→B3→B4→A2 → GREEN → **mở rộng 2 ratchet §3.2** → mutation check theo bảng §5.4.
7. `test:cov:call` + `bash harness/check.sh --lane-db=s7callrtfix2`.
8. FULL gate (`security-reviewer` + `silent-failure-hunter`) → evidence → PR → **người chốt merge**.

> **M7 — không có đường lùi dữ liệu.** Revert PR hoàn nguyên CODE; các hàng `chat_call_participants`
> đã đóng thì **KHÔNG** (kết cục hấp thụ, bảng không có DELETE). ⇒ C1 phải đúng ngay lần đầu.
>
> **L2 — vì sao chắc chắn không cần migration:** `'chat_call'` đã vào CHECK `object_type` của
> `audit_logs` từ `apps/api/migrations/0546_s7calldb1_chat_calls.sql` (khối E), có VERIFY đi kèm; cột
> `action` là text tự do (xem docblock `CHAT_AUDIT.ROOM_DIRECT_RESTORED`). Đã **đo lại** trên
> `mediaos_s7callrtfix2` bằng `pg_get_constraintdef`, không suy từ comment (memory
> `audit-check-union-parse-anchor-trap`).
>
> **L4 —** `CHAT_AUDIT.CALL_PARTICIPANT_CLOSED` và caller DUY NHẤT của nó phải cùng ở dưới
> `src/chat/`: census `chat-error-code-census.spec.ts` chỉ `readdirSync(src/chat)`. File
> `chat-call-room-exit.service.ts` thoả — **đừng dời sang `src/realtime/`**.

---

## 7. Ngoài phạm vi

1. **C6** — khoá tài khoản không chặn phiên `/ws-call` MỚI (≤900 s): owner đã phán quyết 11/08 là
   hành vi ĐƯỢC BIẾT, không mở WO (QA-1 §6.5).
2. ✅ **ĐÃ KIỂM — `POST /chat/rooms/:id/leave` (rời TỰ NGUYỆN) có CÙNG lỗ.**
   `chat-rooms.controller.ts:136` và `:251` cùng đi qua `chat-rooms.repository.ts:640-644`
   (`.set({ leftAt: new Date() })`) ⇒ **cả hai đường** đều để lại hàng `chat_call_participants` sống.
   Bản vá phải phủ **cả hai**, và ca test §5 phải có ít nhất một ca chạy đường `leave`. Đây **không**
   là WO thứ ba — cùng một lỗ, hai cửa vào.
3. **Xoá/archive phòng giữa cuộc gọi** — chưa đo. Ghi ra để không ai đọc plan này thành "mọi đường
   rời phòng đã kín".
4. 🔴 **H7 — cuộc gọi MA khoá phòng vĩnh viễn. LỖ CÓ SẴN TỪ TRƯỚC, cố ý KHÔNG vá ở WO này.**

   `expireStaleRinging` chỉ quét `status='ringing'` (`chat-calls.repository.ts:368-374`). Một cuộc gọi
   `active` mà **không còn participant nào hoạt động** sẽ không bao giờ thành `ended`, và partial
   unique `chat_calls_one_live_per_room_uq` khoá phòng đó: mọi `invite` sau là 409 CHAT-ERR-028, không
   job nào gỡ.

   **Đã đo: lỗ này KHÔNG do bản vá đẻ ra.** Ngay hôm nay, gỡ cả hai người đang gọi khỏi phòng làm họ
   không `hangup` nổi nữa (`assertCallAccess` ném 404 vì họ hết là thành viên) ⇒ cuộc gọi cũng kẹt
   `active` vĩnh viễn. Bản vá đổi *hình dạng* trạng thái kẹt (0 participant hoạt động thay vì 2
   participant không thao tác được) chứ **không** mở rộng tập ca tới được.

   **Vì sao KHÔNG vá ở đây:** đóng cuộc gọi đòi ghi `chat_calls.status` từ đường THÀNH VIÊN — tức kéo
   bề mặt ghi vòng đời cuộc gọi (`transition`, `ended_at`, phát `chat:call{ended}`) vào một WO an
   ninh. Đó là đúng loại phình phạm vi mà FULL gate nên chặn, và nó cần chữ ký owner cho hàng rào R4
   (`DECISIONS-07`), không phải một quyết định lẻ trong lúc vá.

   **Bắt buộc làm thay thế:** ①  một ca test **đóng đinh hành vi hiện tại** (gỡ người hoạt động cuối
   cùng ⇒ `chat_calls.status` VẪN `active`, `invite` kế tiếp ⇒ 409) — để hành vi không trôi trong im
   lặng; ②  mở **KI** riêng và trỏ tới đây. Không được để trống.

   Phạm vi thật của H7: **chỉ phòng `group`.** `leaveRoom` gác bằng `assertLeavable`
   (`chat-rooms.service.ts:399`) và `removeMember` bằng `assertManualMembership`
   (`chat-members.service.ts:281`) ⇒ phòng `direct` **không có đường rời nào**. Ghi ra để không ai đi
   vá một nhánh không tồn tại.

---

## 8. Câu hỏi mở — chuyển cho `S7-CALL-QA-2` (test FE), KHÔNG chặn WO này

Ba câu vòng review 1 nêu đều nằm ở tầng FE, ngoài `paths` của WO:

1. FE người khởi tạo ở cuộc gọi `ringing` thấy gì sau khi nạn nhân bị đóng — `peer-left` có kết thúc
   UI không, hay treo tới hết 45 s? (`call-signalling.ts:109` chỉ lọc theo `callId`.)
2. Nạn nhân là **người khởi tạo** đang `active`: người còn lại `hangup` được về mặt quyền, nhưng FE họ
   có nút đó ở trạng thái nào?
3. Nạn nhân nhận `peer-left` mang **userId của chính mình** (B4 phát cho cả room) — FE xử lý ra sao?

⇒ Ghi vào plan `S7-CALL-QA-2` (đã có trong backlog, phủ `use-chat-call` · `CallExperience` ·
`CallProvider`). WO này chốt hợp đồng SERVER; hành vi UI là việc của QA-2.

# S7-CALL-RT-1 — Gateway `/ws-call`: allowlist ĐÓNG 8 sự kiện, relay SDP/ICE không đọc-không lưu

> 🔴 **VÙNG ĐỎ / crown-jewel.** WO này **NỚI MỘT BẤT BIẾN ĐANG CÓ HIỆU LỰC** (`CHAT-DEC-005` — client không
> ghi qua WS). Đây là WO duy nhất của cả repo mở một cửa client→server trên WebSocket.
> Nguồn chuẩn: [`DECISIONS-07`](../DECISIONS/DECISIONS-07_Chat_Call_Signalling.md) §3.1 R1–R3 · §4 (ĐÃ KÝ 08/08/2026) ·
> [SPEC-15 §3.5 · §5.1c · §12 (CHAT-ERR-030)](<../SPEC/SPEC-15 CHAT.md>) ·
> `packages/contracts/src/chat-call.ts` (đã land ở DB-1) · `S7-CALL-BE-1` (PR #370, đã land).

---

## 0. Ranh giới của WO này

| Trong phạm vi | NGOÀI phạm vi (WO khác) |
| --- | --- |
| **A.** Gateway `/ws-call`: handshake · allowlist ĐÓNG 8 sự kiện · relay SDP/ICE/media-state | Máy trạng thái WebRTC, `RTCPeerConnection`, UI → **`S7-CALL-FE-1`** |
| **B.** Sự kiện **vòng đời** cuộc gọi trên `/ws` (chuông đến · các mốc kết thúc) — emit SAU commit | Vòng đời REST + audit (đã xong ở **BE-1**) |
| Ratchet: `/ws` VẪN 0 `@SubscribeMessage` · census ĐÚNG 8 handler | Bộ test đầy đủ của wave → **`S7-CALL-QA-1`** |
| `CHAT-ERR-030` + `user_security_events` cho sự kiện ngoài allowlist | E2E hai trình duyệt → **`S7-CALL-QA-1`** |

### 0.1 ⚠️ MỞ RỘNG PHẠM VI CÓ CHỦ ĐÍCH — vế **B** và lý do nó không phải scope creep

`done_when` của WO chỉ nói về gateway. Nhưng **`S7-CALL-BE-1` §0 đã ghi tường minh**: *"Thông báo tới người
được gọi (chuông đến) → **S7-CALL-RT-1**"*, và `chat-calls.service.ts` **cố ý** không import
`RealtimeEmitterService` (BE-1 §2 D9: cắm sẵn emitter là cắm sẵn payload chưa qua DTO/masking).

Hệ quả nếu bỏ vế B: `S7-CALL-FE-1` (`depends_on: RT-1`) có `done_when` *"mời → **chuông** → nhận"* nhưng
**không WO nào ở tầng BE phát tín hiệu chuông** — FE-1 là lane FE, `paths` của nó chỉ có `apps/app/**` +
`packages/web-core/**`. Lỗ đó không thuộc về ai. ⇒ RT-1 nhận, và `paths` của WO được mở rộng tương ứng
(§3). Đây đúng khuôn mở rộng của BE-1 (`assertCallAccess` phải vào `chat-access.service.ts`).

**Người được gọi KHÔNG nối `/ws-call` khi chưa biết có cuộc gọi** — nên chuông **bắt buộc** đi `/ws`
(kênh mọi người đã nối sẵn). Đây là quan hệ nhân quả, không phải lựa chọn kiến trúc: `/ws-call` là kênh
của người **đã** trong cuộc gọi.

### 0.2 BƯỚC 0 — cập nhật `harness/backlog.mjs` TRƯỚC khi viết code

WO đang có **5 `paths`** trong khi §3 liệt kê ~19 tệp, và **6 `done_when` không có gạch nào cho vế B**.
`paths` lái `guard-scope` + chọn gate (memory `wo-paths-drive-gate-and-scheduler`), `done_when` là điều
kiện đóng WO ⇒ để nguyên là cho phép đóng WO "done" khi chuông chưa hề được nghiệm thu. Mở rộng `paths`
đủ + thêm **2 gạch** `done_when`:

- *"Chuông đến: `POST …/calls` ⇒ người được gọi nhận `chat:call{ringing}` trên `/ws`; 6 đường vòng đời +
  job `missed` đều emit SAU commit, có ratchet đếm đúng số đường"*
- *"`/ws-call` nằm trong đường thu hồi phiên: khoá tài khoản ⇒ socket `/ws-call` bị đóng (V1)"*

---

## 1. Những gì DB-1 / BE-1 đã làm — KHÔNG làm lại

| Đã có | Hệ quả cho RT-1 |
| --- | --- |
| `CHAT_CALL_INBOUND_EVENTS` (8 tên) + 6 schema Zod + 2 hằng trần độ dài — `packages/contracts/src/chat-call.ts` | **KHÔNG khai lại danh sách sự kiện.** Census lấy đúng mảng đó làm nguồn; gateway lặp theo nó |
| `ChatAccessService.assertCallAccess` — MỘT truy vấn `chat_calls ⋈ chat_rooms ⋈ chat_room_members`, 404 hằng | Vế "là thành viên phòng + cuộc gọi tồn tại trong tenant" của MỖI sự kiện **dùng lại hàm này**, không viết truy vấn thứ hai (bất biến #3 của file đó, có grep test) |
| `ChatCallsRepository.listParticipants` | Vế "actor/peer ∈ cuộc gọi". BE-1 chặn ≤ **20** người được mời ⇒ danh sách luôn nhỏ |
| `ChatCallCooldownService` + sổ `CHAT_CALL_COOLDOWN_SCOPE` | Trần tần suất cho nhánh ghi `user_security_events` — **một hiện thực, bucket mới** (không dựng bộ đếm thứ hai) |
| `SecurityEventWriter.record(tx, …)` — append-only, mask-at-write, fail-closed theo `SECURITY_EVENT_TYPES` | Đường ghi CHAT-ERR-030. Cần **thêm 1 mã** vào union + map severity (exhaustive `Record` ⇒ quên là typecheck ĐỎ) |
| `ValkeyIoAdapter.createIOServer` — `cors` + `allowRequest` ở tầng **engine.io** | `/ws-call` **thừa hưởng** cưỡng chế origin tự động (memory `engineio-cors-never-rejects` đã đóng ở RT-0). KHÔNG cần cấu hình CORS riêng, và KHÔNG được tự dựng server thứ hai |
| `chat-error-code-census.spec.ts` — `CHAT-ERR-030` đang nằm trong `PENDING_CODES` mang tên WO này | Gỡ đúng 1 dòng khi land; sổ nợ trở lại RỖNG |

---

## 2. Quyết định thiết kế (những chỗ spec không nói, chốt ở đây)

### D1 — Gateway MỚI, và `realtime.gateway.ts` **không bị sửa một dòng nào**

`chat-realtime-structure.spec.ts` hiện khẳng định **0 `@SubscribeMessage` trong TOÀN BỘ `apps/api/src`**.
WO này làm khẳng định đó sai theo đúng thiết kế ⇒ ratchet phải được **NỚI THEO TRỤC HẸP NHẤT**, và
SPEC-15 §3.5 R1 đã ra lệnh trước: *"wave CALL nới phạm vi quét thì **vế `/ws` vẫn phải còn khẳng định
riêng giữ mức 0**"*. Ba khẳng định thay cho một:

1. `realtime.gateway.ts` (`/ws`) — **0** `@SubscribeMessage`. Đứng riêng, không đi qua allowlist file.
2. Toàn bộ `apps/api/src` **trừ** `realtime/call-signalling.gateway.ts` — **0**. Danh sách miễn trừ là
   MỘT phần tử, hằng, và ca test khẳng định `EXEMPT.length === 1` (thêm file thứ hai vào đó phải là một
   quyết định nhìn thấy được, không phải một dòng lọt trong diff).
3. `call-signalling.gateway.ts` — **ĐÚNG 8**, và **tập tên bằng đúng** `CHAT_CALL_INBOUND_EVENTS`.

⚠️ **KHÔNG refactor `extractToken` thành helper dùng chung.** Ca test hiện có quét `.handshake.*` **trong
`realtime.gateway.ts`** và có positive control `accesses.length > 0`; rút hàm đó ra file khác làm positive
control rỗng ⇒ ratchet chết im lặng. Gateway mới có bản đọc riêng (5 dòng, chỉ RÚT chuỗi — việc verify vẫn
là `TokenService` dùng chung), và ca test `.handshake.*` được mở rộng để gác **cả hai** file bằng cùng
một luật. Bản sao bị gác bởi cùng một tripwire không phải bản sao sẽ trôi.

### D2 — Handshake `/ws-call` fail-**CLOSED** (khác `/ws` fail-soft)

| | `/ws` | `/ws-call` |
| --- | --- | --- |
| JWT sai/thiếu | từ chối handshake | từ chối handshake |
| thiếu cặp quyền | **fail-SOFT** — vẫn nối để nhận NOTI | **NGẮT** — `next(new Error("forbidden"))` |

`/ws` phục vụ hai đường (NOTI + CHAT) nên trượt cổng CHAT vẫn còn việc để làm. `/ws-call` có **đúng một**
mục đích: thiếu `('call','chat-room')` thì mọi sự kiện sau đó đều sẽ bị từ chối — giữ kết nối chỉ để từ
chối từng khung là dựng sẵn một bề mặt dò cửa. Cặp kiểm ở mức **type-level** (không `resourceId`), CÙNG
mức với `@RequirePermission('call','chat-room')` ở REST.

⚠️ Cổng quyền chỉ chạy **một lần** lúc nối (Socket.IO không tái xác thực) — đúng lỗ mà
`severUserSessions` vá cho `/ws`. `/ws-call` **không** cần móc riêng: `severUserSessions` nhắm
`userRoomName`, mà room đó thuộc namespace `/ws`; socket `/ws-call` của cùng người sẽ **không** bị cắt.
⇒ Vế bù là **kiểm lại từ DB ở MỖI sự kiện** (D3): thu hồi quyền/membership có hiệu lực ở khung kế tiếp,
không phải ở lần reconnect. Ghi ra đây vì đó là lý do D3 không được phép "tối ưu bằng cache".

### D3 — MỖI sự kiện kiểm LẠI từ DB: **hai truy vấn, không cache, không tin room**

```text
assertCallAccess(tx, companyId, callId, actorUserId)   → cuộc gọi tồn tại + trong tenant + actor là THÀNH VIÊN PHÒNG
listParticipants(tx, companyId, callId)               → actor ∈ cuộc gọi · peer ∈ cuộc gọi (≤21 hàng)
```

Cả hai là hàm **đã có**. KHÔNG viết truy vấn gộp mới: một truy vấn mới mang vế membership là **bản sao thứ
hai của luật quyền** — chính điều `chat-access.service.ts` cấm bằng bất biến #3 + grep test.

Giá phải trả nói thẳng: trickle ICE ~20 candidate ⇒ ~40 truy vấn điểm (index) cho một lần bắt tay. Với
45 người dùng đó là chi phí chấp nhận được, và đây là **đánh đổi có chủ đích** giữa "một bản sao của luật"
và vi-tối-ưu. Nếu sau này đo được nghẽn: gộp bằng cách cho `ChatAccessService` một hàm trả **cả** access
lẫn participants — KHÔNG bằng cache theo socket (cache là bỏ đúng thứ D2 nói là vế bù duy nhất).

**Tuyệt đối không suy quyền từ việc socket đang ở trong room** (memory
`ws-permission-gate-needs-its-own-room`). Room ở đây chỉ là **đích fan-out**, không phải chứng chỉ.

### D4 — Allowlist ĐÓNG cưỡng chế bằng `onAny`, không bằng "không có handler"

Không có handler cho `call:evil` thì Socket.IO **im lặng bỏ qua** — không ngắt, không ghi gì, và người dò
cửa được thử vô hạn lần miễn phí. R2 đòi ngược lại. ⇒ `socket.onAny((event) => …)` với `Set` dựng từ
`CHAT_CALL_INBOUND_EVENTS`: event ∉ set → **CHAT-ERR-030**.

### D5 — Ba lớp từ chối, ba cách xử lý KHÁC nhau (đây là quyết định quan trọng nhất của WO)

| Lớp | Điều kiện | Xử lý |
| --- | --- | --- |
| **A — dò cửa giao thức** | event ∉ allowlist · payload sai Zod · `sdp`/`candidate` vượt trần | ghi `user_security_events` + **NGẮT**. KHÔNG mô tả lỗi (phản hồi càng cụ thể càng tiện cho việc dò) |
| **B — dò cửa dữ liệu** | `assertCallAccess` ném 404 (cuộc gọi không tồn tại · **cross-tenant** · actor không thuộc phòng) **hoặc** actor ∉ participants | ghi `user_security_events` + **NGẮT** |
| **C — đua vòng đời** | actor ∈ participants nhưng cuộc gọi **không còn sống** (`ended`/`rejected`/…) · peer đã rời | **bỏ im lặng**, log `debug`, KHÔNG ghi DB, KHÔNG ngắt |

Vì sao **C phải tách khỏi B**: ICE candidate tới sau khi bên kia vừa gác máy là chuyện **bình thường**,
xảy ra ở mọi cuộc gọi. Gộp nó vào B nghĩa là mỗi cuộc gọi kết thúc bình thường đẻ vài hàng
`user_security_events` (bảng **append-only, không có job dọn**) và ngắt kết nối của một người dùng hợp lệ
— vừa là đường bơm, vừa là lỗi UX. Đây đúng lớp `attribution-patch-creates-timing-oracle` /
`deny-cases-vacuous-without-allow-case` chỉ đổi trục.

### D6 — Trần cho chính đường ghi security-event (chống bơm append-only)

B + A vẫn ghi vào bảng append-only theo yêu cầu của R2. Hai hàng rào để nó không thành đường bơm:

1. **≤ 1 hàng / kết nối** — cờ trên `socket.data`; vi phạm ⇒ ngắt ngay sau đó, nên hàng thứ hai chỉ có
   thể tới từ một kết nối MỚI.
2. **Trần theo NGƯỜI** qua `ChatCallCooldownService`, scope mới `SIGNALLING_VIOLATION`
   (`CHAT_CALL_VIOLATION_MAX_PER_MIN = 5`). Vượt trần ⇒ **vẫn ngắt** nhưng **không ghi** — chỉ `warn`.
   Đây đúng lập luận BE-1 §5c mục 4: đừng đổi một bảng có trần lấy một bảng không có trần.

Khoá theo **người** (không theo (người, cuộc gọi)): chia theo cuộc gọi thì cứ mời một cuộc gọi mới là
được cấp lại hạn mức.

### D7 — Rooms RIÊNG của namespace, và chúng chỉ là ĐÍCH

`rooms.ts` (+2 hàm, tiền tố `co:{companyId}:` giữ nguyên quy ước ADR-0013):

| Room | Ai ở trong | Dùng làm gì |
| --- | --- | --- |
| `co:{co}:calluser:{userId}` | join lúc handshake, sau cổng quyền | đích của relay SDP/ICE tới **một** người (đa thiết bị) |
| `co:{co}:call:{callId}` | join sau khi `call:join` kiểm DB **thành công** | đích của `media-state` · `screen-state` · `peer-joined/left` |

⚠️ Namespace khác nhau ⇒ room `/ws-call` và room `/ws` **không** đụng nhau dù trùng tên. Vẫn đặt tiền tố
khác (`calluser`/`call`) để một lần đọc log không phải suy ra namespace.

### D8 — Payload relay: `fromUserId` do **SERVER** gán

Client gửi `{callId, toUserId, sdp}`; server phát `{callId, fromUserId, sdp}` với `fromUserId` lấy từ
`socket.data.user` — **không bao giờ** từ payload. Schema outbound khai **RIÊNG** trong `chat-call.ts`
(không `.omit()`/`.extend()` từ schema inbound: hợp đồng đi theo schema gốc sẽ tự động chảy field mới
sang kênh relay mà không ai duyệt — bài học `wsChatAttachmentSchema`).

`sdp`/`candidate` đi qua `.parse()` **nguyên văn**: đó là toàn bộ nội dung của R3 — có trần độ dài, có
kiểm kiểu, **không parse cấu trúc, không đọc, không ghi**.

### D9 — `call:ping` không sinh gì; trả `call:pong` cho chính socket

Mục đích của nó (§4 DECISIONS-07: "phát hiện rớt") nằm ở phía FE. Server chỉ xác nhận "cậu vẫn ở trong
cuộc gọi này" — vẫn qua đủ D3, vì một ping từ người ngoài cuộc gọi cũng là dò cửa.

### D10 — Vòng đời trên `/ws`: **một** khoá sự kiện `chat:call` + `action`

Mirror `chat:room` (một event, union action) thay vì 6 khoá rời — 6 khoá là 6 chỗ để quên một chỗ.

- Payload: `{ callId, roomId, kind, status, initiatorUserId, startedAt, action }`. **KHÔNG** kèm
  `participants[]` (mang `outcome`/`joinedAt` của **người khác** — per-user, đúng lớp
  `ws-payload-narrower-than-rest-dto`), **KHÔNG** kèm `acceptedAt`/`endedAt` (FE không dùng, và mỗi khoá
  thừa là một khoá phải bảo vệ).
- Đích: `chatUserRoomName` của **từng participant** — KHÔNG `chatRoomName` (người trong phòng không được
  mời không cần biết), KHÔNG `userRoomName` (đi vòng cổng quyền `view:chat-room`, xem `rooms.ts`).
- Gọi **SAU commit** ở `ChatCallsService` (5 đường) + job hết hạn (`missed`). Ratchet
  `chat-realtime-after-commit.spec.ts` được mở rộng để gác đúng 5 đường đó.

⚠️ Job `missed` chạy **ngoài request**: nó phải tự đọc participants để biết bắn cho ai. Không có actor
nào ⇒ không có `chatUserRoomName` mặc định — đây là chỗ dễ quên nhất của vế B.

### D11 — `REALTIME_ENABLED=false` ⇒ `/ws-call` từ chối mọi kết nối

Cùng khuôn `/ws`. Hệ quả nói thẳng cho FE-1: cờ tắt ⇒ **không gọi được** (không có fallback REST cho
SDP/ICE — bản chất là kênh độ trễ thấp). FE phải hiện lỗi rõ ràng chứ không treo khung "đang kết nối".

---

## 2b. Vòng vá sau plan-review đối kháng #1 — **GHI ĐÈ §2 khi mâu thuẫn**

> Verdict vòng 1: **BLOCK** (5 CRITICAL · 7 HIGH). Phần lớn phát hiện được xác minh thẳng trên
> `node_modules` đang cài, không phải suy đoán — chép lại chứng cứ ở đây để lần sửa sau không phải đo lại.

### V1 (CRITICAL-1) — `/ws-call` phải nằm TRONG đường thu hồi phiên

`severUserSessions` nhắm `userRoomName` thuộc namespace `/ws` ⇒ socket `/ws-call` của người vừa bị **khoá
tài khoản / xoá / thu hồi phiên** sống sót và tiếp tục relay. Tệ hơn ở chiều NHẬN: sau `call:join` socket
nằm trong room cuộc gọi và **nhận** `media-state`/`peer-*` mà không phát khung nào ⇒ D3 không chạy lần nào.
Đây là **thụt lùi một tính chất an ninh đang có**, không phải lỗ mới chấp nhận được.

Ba lớp, mỗi lớp đóng một trục khác nhau — thiếu lớp nào cũng còn cửa:

| Lớp | Đóng trục | Cơ chế |
| --- | --- | --- |
| a | khoá/xoá tài khoản · thu hồi phiên | `RealtimeEmitterService.setCallServer(nsp)` (trường **RIÊNG**, xem V10) + `severUserSessions` ngắt **cả hai** namespace |
| b | token hết hạn | ghim `claims.exp` vào `socket.data` lúc handshake; **mỗi khung** kiểm `Date.now() < exp*1000` — 0 I/O |
| c | **thu hồi cặp quyền** `('call','chat-room')` | kiểm lại `permissions.can()` ở `call:join` **và** khi ảnh chụp quá **60 s** (mốc trên `socket.data`) |

⚠️ (c) là một **cache có chủ đích** — và nó KHÔNG mâu thuẫn D3: D3 cấm cache **tư cách tham gia cuộc gọi**
(đọc DB mỗi khung, giữ nguyên). Cửa sổ thu hồi cặp quyền vì thế là **≤60 s**, không phải vô hạn.
**Đánh đổi (b):** `/ws-call` rớt khi access-token hết hạn (~15 phút). `RTCPeerConnection` đã nối vẫn sống
(signalling chỉ cần cho ICE-restart), nhưng **FE-1 BẮT BUỘC nối lại `/ws-call` bằng token mới** — nếu
không, bản vá này tự đẻ một lỗi UX.

### V2 (CRITICAL-2 + HIGH-9) — hai file mới sống trong `src/chat/`, KHÔNG export repository

- `chat-error-code-census.spec.ts` ca *"hằng mã lỗi chết"* chỉ quét `src/chat/*.ts` ⇒ caller của
  `CHAT_ERR.CALL_SIGNAL_REJECTED` nằm ở `src/realtime/**` sẽ bị đo là **hằng chết** ⇒ census ĐỎ.
- `chat.module.ts:188-194` ghi tường minh: 4 provider CALL **CỐ Ý KHÔNG export** — `ChatCallsRepository`
  mang `insertCall`/`transition`/`closeOpenParticipants`, tức **toàn bộ bề mặt GHI vòng đời**. Export nó
  cho gateway là phá đúng hàng rào **R4** mà chữ ký owner đổi lấy.

⇒ Hai file MỚI, cả hai trong `src/chat/`:

| Tệp | Nội dung | Vì sao ở `chat/` |
| --- | --- | --- |
| `chat-call-signal-deny.ts` | hàm **THUẦN** phân loại A/B/C · `CHAT-ERR-030` · dựng payload security-event ĐÓNG | census `CHAT_ERR` thấy caller |
| `chat-call-signal.service.ts` | CHỈ ĐỌC: `resolveSignalAccess()` = `assertCallAccess` + `listParticipants` → `{call, participants}` | bề mặt hẹp export cho `/ws-call`; repo GHI vẫn không rời module |

`ChatModule.exports` += **`ChatCallSignalService`** (KHÔNG phải repository).

### V3 (CRITICAL-4) — payload security-event **ĐÓNG**, tuyệt đối không echo khung

`AuditMaskerService` mask theo **TÊN KHOÁ** (`password`/`token`/`secret`/…) — `sdp`/`candidate` **không**
nằm trong đó. Nhét khung vi phạm vào `payload` = **LƯU SDP vào bảng append-only** = R3 mất hiệu lực bằng
cửa sau, và theo DECISIONS-07 R3 thì `CHAT-DEC-020` hết hiệu lực theo.

⇒ Payload chốt cứng đúng 4 khoá, tất cả do SERVER sinh:
`{ ns: 'ws-call', event: <tên đã lọc ∈ allowlist ∪ 'unknown'>, reason: 'not_allowlisted'|'schema'|'too_long'|'not_participant', code: 'CHAT-ERR-030' }`.
**Không** `.slice()` của `sdp`/`candidate` — một tiền tố 200 ký tự của SDP vẫn là SDP.
`event` phải được **lọc qua allowlist** trước khi ghi: tên sự kiện do client đặt tự do, ghi thẳng là để
client bơm chuỗi tuỳ ý vào bảng append-only (`'unknown'` cho mọi tên ngoài danh sách).

### V4 (CRITICAL-5) — cờ "≤1 hàng/kết nối" phải **compare-and-set ĐỒNG BỘ**

`socket.io@4.8.3/dist/socket.js:452-465` — `onevent()` gọi **mọi** listener của `onAny` **đồng bộ** rồi mới
`dispatch`. Client nhồi 50 khung vi phạm trong một lượt đọc ⇒ 50 lần `onAny` chạy hết **trước khi**
`await writer.record()` đầu tiên resolve ⇒ 50 hàng append-only từ MỘT kết nối, `disconnect()` tới quá muộn.

⇒ Dòng ĐẦU TIÊN của `onAny`: `if (data.violated) return; data.violated = true;` — trước mọi `await`.
Ca test phải `emit` N khung **không await giữa các lần** (await giữa các lần là ca test tự làm mình xanh).

### V5 (HIGH-6) — 7/8 handler trả `undefined`; ack là một đường emit KHÔNG masking

`@nestjs/platform-socket.io/adapters/io-adapter.js:41-54`: `mapPayload` lấy `ack` **từ đối số cuối của
khung do CLIENT gửi**, và giá trị trả về của handler được `ack(response)`. ⇒ client tự gắn ack là moi được
giá trị trả về, **không qua `.parse()` nào**. Một `return access` (mang `visibleFromSeq`/`mutedUntil` của
actor) hay `return participants` (mang `outcome`/`joinedAt` của **người khác**) là rò thẳng — đúng thứ D10
cẩn thận loại khỏi `chat:call`.

⇒ Chốt: **7 handler `return undefined`**; riêng `call:ping` trả `{ event: 'call:pong', data: <schema>.parse(…) }`.
Ca test: client gắn ack cho cả 8 sự kiện ⇒ ack không bao giờ nhận dữ liệu (trừ pong, và pong có ĐÚNG bộ khoá).

### V6 (HIGH-7) — filter ngoại lệ WS **CÂM** của riêng gateway

`@nestjs/websockets/exceptions/base-ws-exception-filter.js` — `includeCause` mặc định **true** ⇒ lỗi lọt
ra ngoài handler làm client nhận `exception` kèm **tên sự kiện + chính payload nó gửi**, và socket **vẫn
sống**. Người dò cửa phân biệt được "handler ném" với "bỏ im lặng lớp C" ⇒ đúng oracle mà D5 dựng để đóng.

⇒ `@UseFilters(CallSignallingExceptionFilter)`: log `error` phía server, **emit 0 khung**, ngắt socket.
Filter tự nó không được ném. Ca: stub tầng đọc ném ⇒ client nhận **0** khung `exception`, socket bị ngắt.

### V7 (HIGH-8) — trần khung **theo socket**, kiểm TRƯỚC mọi truy vấn

Lớp C (bỏ im lặng, không ghi, không ngắt) là bộ khuếch đại: mỗi khung vẫn tốn 2 truy vấn, và
`io-adapter.js:42` dùng `mergeMap` **concurrency vô hạn** ⇒ 10k khung = 10k truy vấn đồng thời trên pool
PgBouncer dùng chung TOÀN API.

⇒ Token-bucket **in-memory trên `socket.data`** (không Valkey — quyết định per-socket, không cần chia sẻ),
kiểm **trước** `resolveSignalAccess`: `CALL_SIGNAL_FRAMES_PER_WINDOW = 120` / `WINDOW = 10s` → vượt thì bỏ
khung im lặng; vượt **3×** → ngắt.
**Đánh đổi:** đặt chặt là bóp chết chính trickle ICE (mạng xấu đẻ nhiều candidate hơn) ⇒ cuộc gọi không
nối được và hỏng **IM LẶNG**. Bắt buộc ca ALLOW: phiên trickle **40 candidate liên tiếp không bị bỏ khung
nào**.

### V8 (HIGH-10) — ratchet phải cấm cả listener gắn TAY

Census `@SubscribeMessage` **mù** với `socket.on('call:evil', …)` / `nsp.on('connection', s => s.on(…))`.
Trước RT-1 việc đó là bất thường; **sau RT-1 (`onAny`) nó là chuyện bình thường** ⇒ có đường vòng qua cả
ba khẳng định của D1. ⇒ Khẳng định **thứ tư**: trong `apps/api/src` (trừ file miễn trừ) **0** lần bind
inbound trên socket/namespace (`.on(`/`.onAny(`/`.prependAny(`/`.use(` trên đối tượng socket); trong
`call-signalling.gateway.ts` **đúng 1** `onAny(` và **0** `client.on(`. Kèm positive control.

### V9 (HIGH-11) — join room trong **middleware handshake**, KHÔNG trong `handleConnection`

`@nestjs/websockets/web-sockets-controller.js:58-68` — `connection.next(args)` (gọi `handleConnection`,
**không await**) rồi **dòng ngay sau** đã `subscribeMessages`. ⇒ có cửa sổ socket đã connected + đã bind
handler nhưng **chưa** ở room đích ⇒ `call:sdp-offer` của bên kia relay vào room rỗng và **mất im lặng**;
WebRTC không retry offer ⇒ cuộc gọi không bao giờ nối, không lỗi nào hiện ra, ca ALLOW chỉ **flaky** chứ
không đỏ ổn định.

⇒ `await socket.join(callUserRoomName(...))` **trong middleware, sau cổng quyền, TRƯỚC `next()`** (lúc đó
`connect` chưa gửi về client — cùng lập luận `realtime.gateway.ts:81-83`). Ca đua: B vừa connect, A gửi
offer ngay ⇒ B nhận.

### V10 (HIGH-12 + landmine) — 6 đường emit ở service + 1 ở job; và **CẤM** `setServer` từ gateway mới

- `expireStaleTx` trả `Promise<number>` ⇒ phải đổi trả về **danh sách cuộc gọi vừa hết hạn**; nó được gọi
  ở **HAI** chỗ: job **và** `invite` (dọn-trước-khi-mời, `chat-calls.service.ts:154`). Bỏ vế `invite` ⇒
  máy người được gọi **vẫn đổ chuông cho một cuộc gọi đã chết**. ⇒ đếm đúng **6** đường ở service
  (invite→`ringing` · invite-expiry→`missed` · accept · reject · cancel · hangup) + **1** ở job; ratchet
  `chat-realtime-after-commit.spec.ts` ghim đúng con số đó.
- ⚠️ **LANDMINE:** gateway mới **TUYỆT ĐỐI KHÔNG** gọi `emitter.setServer(...)`. `RealtimeEmitterService`
  giữ đúng MỘT `server`; ghi đè bằng namespace `/ws-call` làm **toàn bộ** `notification:new` + cụm CHAT
  bắn vào namespace rỗng — hỏng IM LẶNG toàn hệ. Dùng setter RIÊNG `setCallServer()` (V1a). Ca: dựng cả
  hai gateway ⇒ `emitChatMessage` vẫn tới socket `/ws`.

### V11 — lớp B/C phân theo **LOẠI SỰ KIỆN**, không chỉ theo điều kiện

Người được mời **thứ 21 trở đi** bị `CHAT_CALL_MAX_INVITEES = 20` cắt: họ là thành viên phòng hợp lệ,
không có hàng participant, và FE của họ có thể thử `call:join` ⇒ xếp lớp B là **ngắt + ghi hàng an ninh
cho một người không dò cửa**.

| Sự kiện | actor ∉ participants |
| --- | --- |
| `sdp-offer` · `sdp-answer` · `ice-candidate` (**relay**) | **lớp B** — đẩy tín hiệu vào cuộc gọi của người khác là dò cửa |
| `join` · `leave` · `ping` · `media-state` · `screen-state` | **lớp C** — bỏ im lặng (không dữ liệu nào chảy đi đâu; đua vòng đời/trần 20 người là ca THẬT) |

`toUserId` ∉ participants ⇒ **lớp B** (đang cố relay ra ngoài cuộc gọi).
Hợp đồng cho FE-1 ghi kèm: **chỉ nối `/ws-call` sau khi nhận `chat:call{ringing}`** hoặc sau khi `POST`
lời mời trả 201 — tức chắc chắn đã có hàng participant.

### V12 — bổ sung ca test (từ MEDIUM của vòng review)

| # | Ca | Vì sao |
| --- | --- | --- |
| 13 | **Handshake thiếu cặp `('call','chat-room')`** ⇒ `connect_error`, 0 sự kiện + ca ALLOW đối xứng | D2 là cổng quyền DUY NHẤT của namespace mà §4 vòng 1 **không đo** |
| 14 | `REALTIME_ENABLED=false` ⇒ `/ws-call` từ chối mọi kết nối | fail-closed, rẻ |
| 15 | Client nối **`/ws`** rồi `emit('call:sdp-offer')` ⇒ 0 tác dụng, 0 relay, 0 security event | R1 chiều ngược — grep tĩnh KHÔNG chứng minh được |
| 16 | `toUserId` là thành viên phòng nhưng **∉ cuộc gọi** ⇒ không relay + lớp B | §4 vòng 1 chỉ có ca cho actor |
| 17 | Ca 7 khẳng định **BỘ KHOÁ chính xác** (`Object.keys().sort()`) của mọi payload relay | relay là đường emit **không** đi qua `RealtimeEmitterService` — cổng `.parse()` duy nhất hiện có |
| 18 | Ratchet: **0** lần `.emit(` trong gateway ngoài MỘT helper `relay()` map `event → schema` rồi `.parse()` | như trên, ép masking thành cấu trúc chứ không kỷ luật |
| 19 | Khoá tài khoản khi đang có socket `/ws-call` sống ⇒ socket bị đóng | V1a |
| 20 | Đếm hàng ở ca 6 **bó theo `company_id` của ca** (và `call_id` khi có) | int-spec chạy song song cùng lane ⇒ đếm toàn bảng là flake (`parallel-int-specs-share-one-outbox`) |

Ca 1 (census runtime) **phải chạy ở glob `src`** không cần env/DB: đọc metadata trên `prototype`,
**không instantiate** gateway (`loadEnv()` nằm ở field initializer ⇒ chỉ chạy khi `new`).

### V13 — sự thật phải ghi ra, không vá

- **Trần khung thật là `maxHttpBufferSize` = 1 MB** (engine.io mặc định), không phải 64 KB. Zod chặn
  `sdp > 65 536`, nhưng một khung 900 KB rác **vẫn được đọc vào bộ nhớ** trước khi Zod chạy. Đặt lại
  `maxHttpBufferSize` nằm ở `valkey-io.adapter.ts` — WO này **không** đụng; ghi ra để WO sau biết.
- **Chuông thừa hưởng cổng `view:chat-room`**: `chat:call` bắn tới `chatUserRoomName`, room chỉ chứa socket
  đã qua cổng `view:chat-room` lúc nối `/ws`. Ai có `call:chat-room` mà thiếu `view:chat-room` sẽ **không
  bao giờ đổ chuông**. Hai cặp luôn seed cùng nhau nên không xảy ra trong thực tế — nhưng đó là một ràng
  buộc, không phải sự trùng hợp may mắn.
- **`handleDisconnect` của gateway mới phải IDEMPOTENT và không ra quyết định an ninh nào**: client thô
  gửi được khung tên `disconnect` (`socket.js:689-702` không lọc tên dành riêng) ⇒ hook chạy khi socket
  **vẫn sống**. `onAny` vẫn bắt (ngoài allowlist ⇒ ngắt) nên hệ quả bị bó.
- **`onAny` là lựa chọn ĐÚNG, `socket.use()` thì KHÔNG**: `next(err)` → `_onerror` → `emitReserved('error')`;
  Socket không có listener `'error'` ⇒ EventEmitter ném ⇒ **sập tiến trình**. Ghi vào D4 để bản refactor
  sau không "chuẩn hoá" thành lỗ.
- **Đã xác minh (giữ nguyên kết luận §1/§5):** chỉ **một** `createIOServer` chạy cho cả hai namespace
  (`socket-server-provider.js:11-22` + `io-adapter.js:22-27`) ⇒ `/ws-call` thừa hưởng `cors`/`allowRequest`
  và adapter Valkey; mỗi namespace có `ServerAndEventStreamsHost` riêng ⇒ **không** lẫn `handleConnection`.

---

## 3. Bản đồ tệp

### A — gateway

| Tệp | Vai trò |
| --- | --- |
| `apps/api/src/realtime/call-signalling.gateway.ts` | **MỚI** — 8 `@SubscribeMessage` + **1** `onAny` + handshake (join room TRONG middleware, V9) + helper `relay()` duy nhất được `.emit(` (V12 #18) |
| `apps/api/src/realtime/call-signalling.filter.ts` | **MỚI** — filter ngoại lệ WS **CÂM** (V6): 0 khung ra client, ngắt socket |
| `apps/api/src/chat/chat-call-signal-deny.ts` | **MỚI** — hàm THUẦN phân loại A/B/C + payload security-event ĐÓNG + trần khung. **Ở `chat/`** vì census `CHAT_ERR` chỉ quét thư mục đó (V2) |
| `apps/api/src/chat/chat-call-signal.service.ts` | **MỚI** — CHỈ ĐỌC `resolveSignalAccess()`; bề mặt hẹp thay cho việc export repository GHI (V2) |
| `apps/api/src/realtime/rooms.ts` | +`callUserRoomName` · `callRoomName` |
| `apps/api/src/realtime/realtime.module.ts` | +provider gateway (`ChatCallSignalService` · `SecurityEventWriter` · `ChatCallCooldownService` · `PermissionService` · `DatabaseService` · `TokenService`) |
| `packages/contracts/src/chat-call.ts` | +`WS_CALL_NAMESPACE` · +schema **outbound** relay (khai RIÊNG) · +`CHAT_CALL_OUTBOUND_EVENTS` |
| `packages/contracts/src/auth.ts` | +`CALL_SIGNALLING_VIOLATION` vào `SECURITY_EVENT_TYPES` + severity `medium` |
| `apps/api/src/chat/chat.module.ts` | `exports` += **`ChatCallSignalService`** — ⚠️ **KHÔNG** export `ChatCallsRepository` (chat.module.ts:188-194 cấm; nó là bề mặt GHI vòng đời = hàng rào R4) |
| `apps/api/src/chat/chat-call-cooldown.service.ts` | +scope `SIGNALLING_VIOLATION` · `SIGNALLING_CONNECT` |
| `apps/api/src/chat/chat.errors.ts` | +`CALL_SIGNAL_REJECTED` (CHAT-ERR-030) |

### B — vòng đời trên `/ws`

| Tệp | Vai trò |
| --- | --- |
| `packages/contracts/src/realtime.ts` | +`WS_EVENTS.CHAT_CALL` + `wsChatCallEventSchema` |
| `apps/api/src/realtime/realtime-emitter.service.ts` | +`emitChatCall(companyId, participantUserIds, payload)` · +`setCallServer()` (V10) · `severUserSessions` cắt **cả hai** namespace (V1a) |
| `apps/api/src/chat/chat-calls.service.ts` | **6** đường emit sau commit (V10) — `expireStaleTx` đổi kiểu trả về |
| `apps/api/src/chat/chat-call-ringing-timeout.job-handler.ts` | emit `missed` (đường thứ 7) |
| `docs/API Design/API-13_CHAT_API_Design.md` | §7 bảng sự kiện WS += `chat:call` + namespace `/ws-call` |

### Test

| Tệp | Vai trò |
| --- | --- |
| `apps/api/src/realtime/chat-realtime-structure.spec.ts` | **SỬA** — 4 khẳng định (D1 + V8) + census runtime ĐÚNG 8 + ratchet `.emit(` (V12 #18) |
| `apps/api/src/chat/chat-call-signal-deny.spec.ts` | **MỚI** — bảng A/B/C + trần khung, chạy ở glob `src` (LUÔN chạy, không cần DB) |
| `apps/api/src/chat/chat-realtime-after-commit.spec.ts` | **SỬA** — +5 đường call |
| `apps/api/src/chat/chat-error-code-census.spec.ts` | gỡ `CHAT-ERR-030` khỏi `PENDING_CODES` ⇒ sổ nợ RỖNG |
| `apps/api/test/integration/chat-s7-call-rt1-signalling.int-spec.ts` | **MỚI** — WS thật + DB thật (khuôn `chat-rt1-realtime.int-spec.ts`) |

**KHÔNG** đụng: `realtime.gateway.ts` · `valkey-io.adapter.ts` · `setup-websocket-adapter.ts` · bất kỳ
migration nào (**0 migration ở WO này** — không bảng mới, `user_security_events.event_type` là `text` tự
do, CHECK chỉ có ở `severity`). **0 route REST mới** ⇒ **không** regen route census.

---

## 4. Deny-path RED **TRƯỚC** (viết trước khi có gateway)

Ca 1–3 phải ĐỎ trên cây chưa có `call-signalling.gateway.ts`. **Ca 13–20 ở §2b V12 là phần bắt buộc của
danh sách này** — đọc cả hai, không chỉ mục dưới.

1. **Census 8.** Metadata **RUNTIME** của gateway (`Reflect` trên prototype, không grep chuỗi) trả đúng 8
   tên, và **tập bằng đúng** `CHAT_CALL_INBOUND_EVENTS`. Thêm handler thứ 9 ⇒ ĐỎ; đổi tên ⇒ ĐỎ.
   *(Grep chuỗi là tripwire, metadata là bằng chứng — memory `route-census-runtime-gate`.)*
2. **`/ws` giữ mức 0.** Ca riêng chỉ đọc `realtime.gateway.ts`; ca thứ hai quét cả `src` với allowlist
   1 phần tử.
3. **Người NGOÀI cuộc gọi emit `call:sdp-offer`** (thành viên phòng, có cặp `('call','chat-room')`, nhưng
   **không** có hàng participant) → **không** ai nhận relay · **1** hàng `user_security_events` · socket bị
   ngắt. ⚠️ Actor phải có ĐỦ quyền, nếu không cổng handshake chặn trước và ca test đo nhầm hàng rào
   (đúng lỗi BE-1 đã phải viết lại — plan BE-1 §5b).
4. **Cross-tenant.** `callId` của công ty B + socket của công ty A → không relay, không lộ tồn tại (cùng
   đường xử lý với "không tồn tại"), và **0 hàng** đổi ở B.
5. **Sự kiện ngoài allowlist** (`call:evil`) → ngắt + 1 hàng security event mang `CHAT-ERR-030`.
   Biến thể: payload sai Zod · `sdp` **vượt 65 536** ký tự · `candidate` vượt 4 096 → cùng đường.
6. **0 hàng DB từ một phiên signalling HỢP LỆ.** Đếm `chat_calls` · `chat_call_participants` ·
   `audit_logs` · `user_security_events` trước/sau một phiên đủ 8 sự kiện (join → offer → answer → 3×ice
   → media-state → screen-state → ping → leave): **mọi số đếm bằng nhau**. Đây là bằng chứng R3.
7. **Ca ALLOW đi kèm** (memory `deny-cases-vacuous-without-allow-case`): hai người **trong** cuộc gọi
   trao đổi offer/answer/ice → bên kia nhận **đúng** payload, `fromUserId` = người gửi thật. Thiếu ca này
   thì một gateway ném vô điều kiện vẫn làm ca 3–5 xanh.
8. **`fromUserId` không giả mạo được.** Client gửi kèm `fromUserId` bịa → payload nhận được vẫn mang id
   THẬT của người gửi (Zod strip + server gán).
9. **Đua vòng đời (lớp C)** — `hangup` rồi bắn thêm 1 ICE candidate: **0** hàng security event mới, socket
   **vẫn sống**. Ca này là cái duy nhất chứng minh B/C thật sự tách.
10. **Trần vi phạm.** 7 kết nối liên tiếp cùng vi phạm ⇒ ≤ 5 hàng security event (D6), lần 6/7 vẫn ngắt.
11. **Chuông đến (vế B).** `POST /chat/rooms/:id/calls` ⇒ người được gọi nhận `chat:call{action:'ringing'}`
    trên `/ws`; người **không** thuộc phòng: 0 sự kiện. `reject`/`cancel`/`hangup` ⇒ đúng 1 sự kiện, đúng
    `action`. Payload **không** chứa `participants`.
12. **Emit sau commit** — 5 đường call vào `chat-realtime-after-commit.spec.ts` (mock `withTenant` chạy
    hết thân rồi mới ném ⇒ emit đặt trong tx làm ca ĐỎ).

---

## 5. Bẫy đã biết — kiểm trước khi mở PR

| Bẫy | Biểu hiện | Cách chặn |
| --- | --- | --- |
| `engineio-cors-never-rejects` | tưởng phải cấu hình CORS cho namespace mới | `allowRequest` ở **engine** đã phủ mọi namespace — KHÔNG đụng adapter |
| `ws-permission-gate-needs-its-own-room` | suy quyền từ "socket đang ở trong room" | D3 — mọi sự kiện đọc lại DB |
| `valkey-shared-across-all-envs-no-channel-prefix` | 4 môi trường chung Valkey | Kênh adapter đã có tiền tố từ RT-0; namespace mới đi chung kênh đó — không tự dựng client Valkey nào |
| `ws-payload-narrower-than-rest-dto` | bê `chatCallSchema` (REST) lên WS | Schema outbound khai RIÊNG, không `.extend()`/`.omit()` từ REST |
| `vitest-unhandled-rejection-after-teardown` | handler `async` mà Socket.IO **không await** | MỌI handler tự bọc `try/catch`; không để promise thoát ra ngoài |
| `parallel-int-specs-share-one-outbox` · `per-user-rate-limit-throttles-own-int-spec` | int-spec tự chạm trần D6 | Trần đặt qua hằng module-scope, và int-spec dùng **socket/người mới** cho mỗi ca vi phạm |
| `turbo-cache-false-green` | `pnpm test` trả log cũ | `bash harness/check.sh --lane-db=call2` |
| `integration-test-lane-db-gate` | int-spec SKIP mà tưởng xanh | `--lane-db`, đếm dòng skip |
| `gitleaks-join-not-enough-amend-required` | fixture SDP giả trông như secret | SDP giả **ghép chuỗi**/`padEnd`, không literal high-entropy |

---

## 5b. Kết quả — lỗi mà bộ test bắt được (ghi lại vì nó "xanh khi thử tay")

### B1 — người vừa GÁC MÁY bị xếp vào nhóm dò cửa, bị ngắt kết nối + ghi hàng an ninh

Bản đầu dùng **một** vị từ `actorIsActive` (participant có `outcome ∈ {NULL,'accepted'}`) cho cả hai câu
hỏi khác nhau: *"có phải người của cuộc gọi này không"* và *"có đang trong cuộc gọi không"*.

Sau `hangup`, `setParticipantOutcome` ghi `outcome='left'` cho chính actor ⇒ họ rơi khỏi `activeUserIds`
⇒ một ICE candidate còn trên đường bay (chuyện xảy ra ở **mọi** cuộc gọi, vì trickle ICE bất đồng bộ với
việc gác máy) bị xếp **lớp B**: ngắt kết nối một người dùng hợp lệ + ghi một hàng `user_security_events`
sai. Vá: tách `actorIsParticipant` (có hàng, BẤT KỂ kết cục) khỏi `actorIsActive`.

Đáng ghi vì **thử tay không bao giờ thấy**: người thử bấm "kết thúc" rồi đóng khung, không ai bắn thêm
ICE sau đó. Ca duy nhất bắt được là ca *cố tình* gửi một khung sau `hangup` — và nó phải khẳng định
**socket vẫn sống**, không chỉ "không có lỗi".

Bản vá này lại mở một rủi ro ngược (nới quá tay ⇒ "cuộc gọi chết thì bỏ qua hết" ⇒ oracle *"cuộc gọi này
còn sống không"* cho người ngoài), nên ca test có **vế đối chứng**: người CHƯA TỪNG được mời vẫn phải bị
ngắt + ghi, trên chính cuộc gọi đã kết thúc đó.

### Bằng chứng các ratchet THẬT SỰ cắn (đo bằng vi phạm, không bằng niềm tin)

| Ratchet | Vi phạm được tiêm | Kết quả |
| --- | --- | --- |
| Census 8 handler | thêm `@SubscribeMessage("call:evil")` thứ 9 | ĐỎ: *"expected […] to have a length of 8 but got 9"* |
| emit SAU commit | dời `emitLifecycle` vào trong `withTenant` | ĐỎ đúng ca `hangup: COMMIT hỏng → KHÔNG emit` |
| Toàn bộ spec RT-1 | chạy trên cây CHƯA có gateway | ĐỎ (RED-trước-GREEN, không phải test viết sau để hợp thức hoá) |

---

## 6. Nghiệm thu

- `bash harness/check.sh --lane-db=call2` XANH (không phải "XANH KHÔNG ĐỦ BẰNG CHỨNG").
- 12 nhóm ca §4 xanh, có bằng chứng RED trước cho ca 1–3.
- `chat-error-code-census` xanh với sổ nợ **RỖNG**.
- FULL gate PASS — **bắt buộc** `security-reviewer` + `silent-failure-hunter` (WO nới bất biến).

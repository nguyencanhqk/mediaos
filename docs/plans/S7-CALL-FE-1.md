# S7-CALL-FE-1 — UI cuộc gọi 1-1 (CHAT-SCREEN-006)

> Vùng **vàng** · LIGHT gate (`typescript-reviewer` + `quality-gate`).
> Nguồn: `DECISIONS-07` (ĐÃ KÝ 08/08/2026) · SPEC-15 §5.1c/§15a · `docs/plans/S7-CALL-BE-1.md` ·
> `docs/plans/S7-CALL-RT-1.md`. Port có sửa từ `apps/lms/components/chat/*`.

---

## §0 — Quyết định phạm vi (chốt TRƯỚC khi code)

### §0.1 CHỈ phòng 1-1 — nút gọi ẨN ở phòng >2 thành viên active

Owner chốt 10/08/2026. Đây là quyết định mà `S7-CALL-BE-1` **cố ý giao lại cho FE**, không phải một
chỗ trống bị bỏ quên:

- BE seed hàng `chat_call_participants` cho **mọi thành viên active** của phòng khi có lời mời
  (`chatCallSchema` không có `calleeUserId` — contract đã đóng băng ở DB-1).
- SPEC-15 §12 chốt **đúng 30 mã lỗi CHAT-ERR**, và **không có mã nào** cho "cuộc gọi đã đủ người" ⇒
  server **không** chặn người thứ ba nhận máy. Ràng buộc 1-1 vì thế là **topology media**, do FE giữ.
- Không giữ ở FE thì bấm gọi trong phòng phòng-ban 40 người sẽ **rung chuông 40 máy**, và người thứ
  ba nhận máy sẽ vào một phiên mesh mà hook này (một `RTCPeerConnection`) không dựng nổi.

⇒ `CallButtons` chỉ render khi `room.roomType === "direct"` **và** roster có đúng 2 thành viên chưa
rời. Hai điều kiện, không phải một: `roomType` là ý định lúc tạo phòng, số thành viên là sự thật hôm
nay — một phòng `direct` bị thêm người vẫn phải tắt nút.

⚠️ Đây là hàng rào **UX**, KHÔNG phải cổng an ninh. Người tự gọi REST vẫn mời được cả phòng; cổng
thật là `@RequirePermission("call","chat-room")` + `assertMember` ở BE. Ghi ra để không ai đọc nhầm
dòng này thành "đã chặn ở server".

### §0.2 Mở rộng `paths` của WO

Bản seed có 4 mục trong khi WO chạm 12 tệp. `paths` lái `guard-scope` + chọn gate (memory
`wo-paths-drive-gate-and-scheduler`) ⇒ thiếu nghĩa là nửa diff đi qua mà không ai thấy. Thêm:

| Tệp thêm | Vì sao |
| --- | --- |
| `packages/web-core/src/lib/realtime-socket.ts` | `getCallSocket()` phải sống ở ĐÂY — xem §4 |
| `packages/web-core/src/index.ts` | xuất `chatCallApi` + `getCallSocket` |
| `apps/app/src/layouts/protected/ProtectedShell.tsx` | `<CallProvider>` mount một lần, mọi route |
| `apps/app/src/components/chat/ConversationPanel.tsx` | chỗ đặt nút gọi |
| `apps/app/src/routes/chat/constants.ts` | cặp quyền `call:chat-room` |

---

## §1 — Bản đồ dây: ba kênh, KHÔNG được lẫn

| Việc | Kênh | Ghi chú |
| --- | --- | --- |
| mời · nhận · từ chối · huỷ · gác | **REST** `POST /chat/rooms/:id/calls` · `/chat/calls/:id/{accept,reject,cancel,hangup}` | hàng rào **R4** — FE **KHÔNG BAO GIỜ** emit vòng đời qua WS |
| chuông đến + mốc vòng đời | **`/ws`** sự kiện `chat:call` (một khoá + `action`) | listener gắn trong `CallProvider`, dùng `getAppSocket()` |
| SDP · ICE · mic/cam · chia sẻ màn hình | **`/ws-call`** 8 sự kiện inbound | `getCallSocket()`, chỉ mở khi ĐANG có cuộc gọi |
| ICE servers | **REST** `GET /chat/calls/ice-config` | thoái lui STUN công cộng khi lỗi/429 |

Khác LMS ở đúng chỗ này: bản LMS emit `inviteCall`/`acceptCall`… qua WS. Phần đó **bỏ hẳn** khi port
(DECISIONS-07 R4) — không phải "chuyển sang gọi REST rồi vẫn emit cho chắc".

## §2 — Ai gửi offer: **bên NHẬN được `call:peer-joined`**

`/ws-call` không phát snapshot "ai đang trong phòng" — `call:join` chỉ broadcast `call:peer-joined`
cho những người **đã ở trong** room. Luật rút ra, đối xứng và **không có glare**:

> Nhận `call:peer-joined{userId}` ⇒ **mình** dựng `RTCPeerConnection`, `createOffer`, gửi
> `call:sdp-offer{toUserId}`. Nhận `call:sdp-offer{fromUserId}` ⇒ dựng PC, `createAnswer`.

Đúng một bên offer trong mọi thứ tự vào phòng: ai vào trước thì thấy `peer-joined` của người vào sau.
Bản LMS phải phân nhánh "caller offer sau khi accept" vs "joiner offer theo snapshot" vì nó có mesh
nhiều bên; ở 1-1 luật trên phủ cả hai và ngắn hơn một nửa.

**Thứ tự bắt buộc:** `call:join` chỉ được emit **SAU** khi đã có media cục bộ (hoặc đã quyết định
recv-only). Join trước là mở cửa cho `peer-joined` tới lúc `localStreamRef` còn `null` ⇒ PC dựng ra
không có track nào và cuộc gọi câm một chiều, **không có lỗi nào hiện ra**.

## §3 — SDP/ICE là **CHUỖI MỜ** trên dây

`chatCallSdpSchema.sdp` / `chatCallIceCandidateSchema.candidate` là `z.string()` (hàng rào R3 — server
không parse, không lưu). WebRTC lại làm việc với object ⇒ FE **tự** `JSON.stringify` lúc gửi và
`JSON.parse` lúc nhận, có `try/catch`: một chuỗi hỏng không được phép ném ra khỏi listener socket và
giết cả kết nối. Trần: 64KB (SDP) / 4KB (candidate) — vượt là server ngắt, nên FE **bỏ qua và ghi
log**, không gửi.

## §4 — `getCallSocket()` sống trong `realtime-socket.ts`, KHÔNG phải file mới

ESLint `no-restricted-imports` chặn `socket.io-client` ở toàn bộ `apps/app/src/**` +
`packages/web-core/src/**`, `ignores` đúng **một** tệp. Mở file thứ hai buộc phải nới `ignores`, tức
nới đúng cái hàng rào đang giữ "một kết nối `/ws` duy nhất". `/ws-call` là namespace **khác** nên nó
không đụng lý do gốc của luật, nhưng chỗ khai vẫn phải là tệp đã được miễn.

Khác `getAppSocket()` ở hai điểm, cả hai có lý do:

1. **Không tự kết nối lúc import** — `/ws-call` chỉ mở khi có cuộc gọi thật. Một socket mở suốt phiên
   cho một tính năng dùng vài phút/ngày là giữ hờ một kênh mà client được GHI lên.
2. **`disconnect()` được phép** (khác `/ws`): `/ws-call` không dùng chung với module nào khác.

## §5 — Mất mạng / hỏng giữa cuộc gọi

Ba lớp, theo đúng thứ tự leo thang (port từ LMS, giữ nguyên hằng số 10 s vì nó đã chạy thật):

1. `connectionState`/`iceConnectionState` = `failed` ⇒ `restartIce()` ngay.
2. Vẫn `failed` sau 10 s ⇒ tự gọi REST `hangup` + dọn sạch.
3. Mọi đường dọn (`hangup`, `chat:call{ended|rejected|cancelled|missed}`, unmount, socket `/ws-call`
   rớt) đều đi qua **một** hàm `fullCleanup()`: `pc.close()` · stop **mọi** track local (kể cả track
   chia sẻ màn hình) · `setLocalStream(null)`.

`done_when #3` nói "KHÔNG treo camera đang bật" ⇒ đèn camera là **bằng chứng nghiệm thu**: track chưa
`stop()` thì đèn vẫn sáng dù UI đã đóng, và đó là lỗi người dùng thấy được còn test không thấy.

## §6 — Chia sẻ màn hình

`getDisplayMedia()` → `sender.replaceTrack(screenTrack)` (KHÔNG renegotiate — `replaceTrack` không
đổi SDP nên không cần vòng offer/answer thứ hai). Người dùng bấm "Stop sharing" của trình duyệt ⇒
`track.onended` → trả lại camera track. Mỗi lần đổi: emit `call:screen-state{sharing}`.

## §7 — Cổng quyền · i18n · a11y

- `useCan("call","chat-room")` — thiếu quyền ⇒ **không render** nút (không phải render rồi `disabled`).
- Mọi hook gọi **vô điều kiện** trong `CallProvider` (memory: `useCan` đọc capabilities nạp sau
  `/auth/me`; đặt `if (!can) return` trên hook là "Rendered fewer hooks than expected" ⇒ trắng shell).
- i18n vi đầy đủ ở `chat.call.*`; nút chỉ-icon phải có `aria-label`; trạng thái cuộc gọi có `role="status"`.
- Overlay chuông đến: `role="dialog"` + `aria-modal`, nút Nhận là điểm focus đầu.

## §8 — Test (LIGHT gate, colocated `*.spec.tsx` cạnh nguồn)

| Ca | Đóng đinh điều gì |
| --- | --- |
| `CallButtons` — phòng direct 2 người + có quyền ⇒ hiện; **thiếu quyền ⇒ 0 nút** | §7 cổng quyền |
| `CallButtons` — phòng direct **3 thành viên chưa rời** ⇒ 0 nút; phòng `group` ⇒ 0 nút | §0.1 — ca ALLOW đi kèm để ca DENY không xanh rỗng (memory `deny-cases-vacuous-without-allow-case`) |
| `use-call-signalling` — payload sai hợp đồng (sdp không parse được) ⇒ **bỏ qua, không ném** | §3 |
| `chat-call-api` — mọi đường vòng đời gọi ĐÚNG route REST | R4 — landmine: ai đổi sang emit WS thì đỏ |

E2E hai trình duyệt (`done_when #1`) thuộc `S7-CALL-QA-1`; WO này giao **bằng chứng chạy tay**.

## §9 — Giới hạn đã biết (bàn giao cho QA-1 / WO sau)

1. **Không có lời giải thích khi cuộc gọi bị từ chối / đánh nhỡ.** Mọi lối kết thúc dọn ngay và khung
   biến mất, nên người gọi chỉ thấy nó tắt. Vá đúng cách là một pha `ended` giữ khung thêm vài giây
   với câu lý do — thuộc WO sau. Ở đây **cố ý KHÔNG** giữ một biến `endReason` không ai đọc: state
   ghi-mà-không-đọc tạo ảo giác việc đã xong và người sửa sau sẽ tin là chỉ cần nối dây.
2. **`call:ping`/`call:pong` chưa dùng.** Chúng nằm trong allowlist 8 sự kiện của gateway nhưng FE
   chưa giữ nhịp: rớt kết nối đã được ICE `failed` + `peer-left` phủ. Thêm nhịp ping là việc của WO
   sau nếu đo được ca rớt mà hai đường kia không bắt.
3. **Chưa có thông báo hệ thống (Notification API)** khi tab ở nền — bản LMS có. Cần quyết định về
   quyền thông báo trình duyệt ở mức sản phẩm trước, không phải quyết định của một WO FE.

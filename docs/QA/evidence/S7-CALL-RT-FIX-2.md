# Bằng chứng nghiệm thu — S7-CALL-RT-FIX-2

> ## Trạng thái — 13/08, sẵn sàng cho người chốt
>
> **FULL gate:** `silent-failure-hunter` **PASS** (1 MEDIUM + 1 LOW, đã vá cả hai) ·
> `security-reviewer` **BLOCK** với 1 HIGH + 3 MEDIUM + 2 LOW — **HIGH và cả 3 MEDIUM đã vá**, 2 LOW
> cố ý để lại (§6).
>
> | Điểm | Vá ở | Nội dung |
> | --- | --- | --- |
> | **HIGH-1** | `020efd6d` | Vị từ **KÉP** `joined_at` + `accepted_at`. `insertParticipants` đặt `joined_at` cho **người khởi tạo ngay lúc MỜI**, nên A mời rồi tự `leave` lúc call còn `ringing` bị ghi `'left'` — SAI VĨNH VIỄN. Detector `j` |
> | silent-failure MEDIUM | `020efd6d` | Nhánh `if (!ok) continue` nâng `debug` → **`warn`** — nó là detector DUY NHẤT của "gỡ mà không đóng được participation" |
> | silent-failure LOW | `020efd6d` | Log lớp-C ở gateway thêm `callId` |
> | **MEDIUM-1** cửa sổ rejoin | `aa74001f` | §2.2 — evict thêm một lần SAU commit ở cả hai cửa. Detector `k` |
> | **MEDIUM-2** carve-out neo sai | `aa74001f` | §4.3 — `takesCallerTx` neo vào `(` của CHÍNH method + ca giá dùng cùng vị từ với lưới chính. Detector `l` |
> | **MEDIUM-3** số chi phí sai | `aa74001f` | §2.3 — cả số cũ lẫn số reviewer đề xuất đều sai cùng một chỗ |
>
> ⚠️ **Bài học của phiên trước, giữ lại vì nó đắt:** đã chạy mutation-test bằng `git checkout -- <file>`
> trên một file có **sửa CHƯA COMMIT** ⇒ mất trắng 2 bản vá. Mutation-test **luôn commit trước**.
>
> **Chạy test cần 3 biến** (mật khẩu không còn literal trong repo):
>
> ```bash
> eval "$(grep -E '^(APP|WORKER|SUPERUSER)_DB_PASSWORD=' .env | sed 's/^/export /')"
> export LANE_DB=mediaos_s7callrtfix2
> unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL   # URL tường minh THẮNG LANE_DB
> ```
>
> ---

> Gỡ thành viên giữa cuộc gọi: đóng chiều RÒ, thôi đóng dấu người vô tội.
> Vùng **ĐỎ (crown-jewel)** — chạm `src/realtime/**` + luật từ chối signalling ⇒ FULL gate, người chốt merge.
> Plan: `docs/plans/S7-CALL-RT-FIX-2.md` · Lane DB: `mediaos_s7callrtfix2` · Nhánh: `s7-call-rtfix2-roomexit`

---

## 1. Lỗ được vá — đối xứng SAI, đo được 11/08/2026

Gỡ một người khỏi phòng (`DELETE /chat/rooms/:id/members/:userId`) chỉ đặt `chat_room_members.left_at`.
Bảng `chat_call_participants` **không bị chạm** ⇒ hai chiều hỏng ngược nhau:

| Chiều | Trước bản vá | Đánh giá |
| --- | --- | --- |
| **NHẬN** (relay TỚI người bị gỡ) | vẫn relay SDP/ICE + `media-state`/`screen-state` | ❌ chiều RÒ **MỞ** — họ tiếp tục thấy IP nội bộ, mốc thời gian, và trạng thái mic/cam/chia-sẻ-màn-hình của bên kia |
| **GỬI** (browser họ tự trickle ICE) | `user_security_events` + **NGẮT** | ❌ đóng dấu "dò cửa" một người **hoàn toàn vô tội**, vào bảng **append-only KHÔNG có job dọn** |

Chiều có hại thì mở, chiều vô hại thì bị trừng phạt. Trickle ICE là do WebRTC **tự làm** — không cần một
thao tác người nào, nên hàng an ninh sai đó gần như CHẮC CHẮN được ghi.

---

## 2. Bản vá — 5 mảnh

| # | Ở đâu | Làm gì |
| --- | --- | --- |
| **B1** | `chat-calls.repository.ts` | `findOpenParticipantCallsInRoom` — cuộc gọi CÒN SỐNG của một phòng mà user còn hàng participant chưa ngã ngũ. `company_id` ở **cả hai vế** JOIN. Rút vị từ dùng chung `activeParticipantOutcomeSql()` / `isActiveCallOutcome()` (trước đó viết tay ở 2 chỗ, sắp thành 3) |
| **B2** | `chat-call-room-exit.service.ts` (MỚI) | Đóng participant **trong CÙNG tx** với `setMemberLeft`. Kết cục theo **TỪNG HÀNG**. `setParticipantOutcome` trả `false` ⇒ `continue` (không audit, không phát). Audit `chat.call.participant_closed` |
| **B3** | `chat-members.service.ts` · `chat-rooms.service.ts` | **HAI cửa vào**: `removeMember` (bị gỡ) và `leaveRoom` (rời tự nguyện) — cùng đi qua `setMemberLeft`, vá một cửa là vá một nửa |
| **B4** | `realtime-emitter.service.ts` | `evictFromCallRoom` (**TRONG tx** — vế an ninh) + `emitCallPeerLeft` (**SAU commit** — vế thông báo). Bất đối xứng CÓ CHỦ ĐÍCH |
| **A2** | `chat-call-signal.service.ts` · `call-signalling.gateway.ts` | `wasCallParticipant` (tái dùng `findParticipant`) ⇒ người từng là participant rơi vào **lớp C** (im lặng) thay vì lớp B (ghi + ngắt) |

### 2.1 🔴 Kết cục theo TỪNG HÀNG — chỗ dễ ghi SAI VĨNH VIỄN nhất

`'left'` nghĩa là "đã VÀO rồi rời". Người được mời mà chưa bấm nhận có `joined_at IS NULL` — họ chưa từng
ở trong cuộc gọi để mà rời.

```
joined_at IS NOT NULL  ⇒ outcome='left',   left_at = now
joined_at IS NULL      ⇒ outcome='missed', left_at KHÔNG đặt
```

**Không sửa lại được:** bốn kết cục là HẤP THỤ (`WHERE` của `setParticipantOutcome` chỉ cho ghi tiếp khi
`outcome IS NULL OR 'accepted'`) và bảng **không có DELETE** (mig `0546` khối C chỉ `GRANT SELECT, INSERT`).
Revert PR hoàn nguyên CODE, **không** hoàn nguyên các hàng đã đóng ⇒ phải đúng ngay lần đầu.

### 2.2 Vì sao `evictFromCallRoom` phải nằm TRONG transaction

`call:media-state`/`call:screen-state` broadcast thẳng vào `callRoomName` và **KHÔNG** đi qua `assertPeer`.
Đóng `chat_call_participants` một mình chỉ chặn được SDP/ICE (ba sự kiện đi qua `callUserRoomName` của người
NHẬN); socket nạn nhân vẫn ở trong room chung ⇒ vẫn theo dõi được mic/cam/chia-sẻ-màn-hình theo thời gian thực.
Đặt evict sau commit là để hở đúng cửa sổ đó. Cùng lập luận `severUserSessions`.

Hậu quả rollback (ghi đủ cho `S7-CALL-QA-2` biết mà đo): rời `callRoomName` mất **cả** `call:peer-left`,
nên nếu tx rollback thì nạn nhân vẫn là thành viên hợp lệ nhưng UI của họ **treo một peer ma** khi bên kia
gác máy. Fail-safe (suy giảm UX ≪ rò dữ liệu), nhưng không phải vô hại.

#### 🔴 …và vì sao nó phải chạy LẦN THỨ HAI sau commit (MEDIUM-1 của FULL gate)

Vế trong-tx một mình **chưa đóng hết**. Trong khe giữa lúc nó chạy và lúc COMMIT, gateway xử một
`call:join` ở transaction KHÁC đọc ở READ COMMITTED nên **chưa thấy** `left_at`/`outcome` mới ⇒ join được
chấp nhận và `socketsJoin` đưa socket nạn nhân **TRỞ LẠI** `callRoomName`. Sau commit không ai evict lần
hai ⇒ kênh `media-state`/`screen-state` **mở lại** và ở nguyên đó tới khi socket rớt — đúng chiều rò mà
WO này dựng ra để đóng, chỉ trễ vài mili-giây.

Bản vá: gọi `evictFromCallRoom` **thêm một lần sau commit** ở cả hai cửa, đặt **TRƯỚC** `emitCallPeerLeft`
để một socket vừa lọt vào không kịp nhận thêm khung nào. Room-ops idempotent nên lần thừa vô hại.

⚠️ **KHÔNG bằng 0, và không được viết là đã kín:** một `call:join` đọc DB TRƯỚC commit nhưng chạy
`socketsJoin` SAU lần evict thứ hai thì vẫn lọt. Cửa sổ hẹp hơn hẳn (chỉ còn phần giao của hai thao tác
realtime, thay vì cả đoạn transaction), nhưng đóng HẲN phải khoá hàng participant ở đường join — ngoài
phạm vi WO này.

Ratchet đóng đinh **CẶP SỐ**, không phải sự tồn tại: `evictFromCallRoom` **1 lần** khi commit hỏng ·
**2 lần** khi commit OK. Một mình `toHaveBeenCalled()` thì dời vế nào đi cũng xanh (đột biến `k`).

### 2.3 `wasCallParticipant` KHÔNG mở oracle

Vị từ khoá cứng `user_id = actor` ⇒ actor chỉ biết được về CHÍNH MÌNH. Người **chưa từng được mời** không có
hàng ⇒ luôn `false` ⇒ **vẫn lớp B**. Khác biệt duy nhất actor quan sát được là "tôi từng được mời vào cuộc
gọi này" — điều họ **đã biết** từ lúc nhận `chat:call{ringing}`.

#### Chi phí — MEDIUM-3, và cả hai con số trước đó đều sai

Đường THÀNH CÔNG giữ nguyên 2 truy vấn/khung. Nhánh TỪ CHỐI thì **không được đọc thành "1 → 2 mỗi
khung"**: thứ đổi nhiều nhất là **SỐ KHUNG chạm DB**, không phải số truy vấn trên mỗi khung.

- **Trước bản vá:** nạn nhân rơi vào lớp B ngay khung ĐẦU — `deny()` đặt `state.violated = true` rồi
  NGẮT, và mọi khung sau ngắn mạch ở `handleFrame` (`if (state.violated) return null`) với **0** truy
  vấn ⇒ **1 truy vấn cho cả đời một socket**, tức ~**30 truy vấn/người/phút**
  (`CHAT_CALL_CONNECT_MAX_PER_MIN = 30`).
- **Sau bản vá:** họ là lớp C — không `violated`, không bị ngắt ⇒ socket **SỐNG**, mỗi khung tới được DB
  tốn 2 truy vấn.

⚠️ Trần đúng là `CALL_SIGNAL_FRAMES_PER_WINDOW` = **120 khung/socket/10 s, KHÔNG phải 360**: khung
121–360 nhận verdict `"drop"` và `handleFrame` `return null` ngay ở **bước (1)** — trước bước (5) đọc DB;
360 (`× CALL_SIGNAL_HARD_MULTIPLIER`) chỉ là ngưỡng NGẮT, không phải trần truy vấn.

⇒ 120 × 6 cửa sổ × 2 = **1.440 truy vấn/socket/phút**, DUY TRÌ ĐƯỢC (không tự tắt như trước), và socket
còn cộng dồn ở 30 socket mới/người/phút — chặn trên là TTL của access-token, vì sau bản vá
`scheduleTokenExpiry` mới là thứ đóng một socket lớp C.

> Con số cũ (**10.800**) và con số `security-reviewer` đề xuất (**21.600**) **sai cùng một chỗ**: cả hai
> lấy 360 làm số khung chạm DB. Ghi lại đây vì "reviewer nói thế" không phải là bằng chứng — số đúng
> phải đọc ra từ thứ tự các bước trong `handleFrame`.

---

## 3. Số đo

### 3.1 int-spec `chat-s7-call-rt1-signalling.int-spec.ts` — **40/40 XANH** (lane `mediaos_s7callrtfix2`)

Tripwire **C5** của `S7-CALL-QA-1` đã **LẬT** trong CÙNG PR (không để lại tripwire chết). Docblock cơ chế
giữ nguyên — nó là hồ sơ vì sao ca tồn tại.

| Assert | Trước (lỗ) | Sau (vá) |
| --- | --- | --- |
| `stillReceives` | `true` | **`false`** — chiều rò đóng |
| `punished` | `true` | **`false`** — không ghi hàng an ninh |
| `victim.disconnected` | `true` | **`false`** — không ngắt |

**+2 assert C2 (chống bản vá SAI kiểu §2):** ba assert trên đều đo NẠN NHÂN; một hiện thực "lọc người bị gỡ
khỏi CẢ `activeUserIds` LẪN `participantUserIds`" làm cả ba XANH trong khi `assertPeer` ghi hàng an ninh +
ngắt **NGƯỜI Ở LẠI**. Hai assert mới đo đúng người ở lại (`securityEvents` không tăng · không bị ngắt).

**7 ca mới** (`FIX2/§5.4-j` thêm ở vòng gỡ BLOCK):

| Ca | Đo gì |
| --- | --- |
| `FIX2/1b` | người **NGOÀI phòng, chưa từng được mời** ⇒ VẪN lớp B (ghi + ngắt). *Ca 1a đã có sẵn = CA 3.* |
| `FIX2/4` | `call:media-state`/`screen-state` KHÔNG tới nạn nhân sau khi bị gỡ (+ đối chứng dương TRƯỚC khi gỡ) |
| `FIX2 peer-left` | người còn lại nhận `call:peer-left` đúng `{callId, userId}` |
| `FIX2/§5.3-1` | kết cục theo TỪNG HÀNG trên DB thật: `left`+`left_at` vs `missed`+`left_at IS NULL` |
| `FIX2/§5.3-3` | gỡ người KHÔNG ở trong cuộc gọi ⇒ 0 audit, KHÔNG chèn hàng participant mới |
| `FIX2/§5.3-4` | cửa **`POST /rooms/:id/leave`** đóng y hệt; audit ghi đúng `actor_user_id` |
| `FIX2/§5.4-i` | gỡ người SAU KHI cuộc gọi kết thúc ⇒ 0 audit, kết cục cũ không bị ghi đè |
| 🔴 `FIX2/§5.4-j` | **NGƯỜI KHỞI TẠO** rời phòng lúc call còn `ringing` ⇒ `missed`, `left_at` NULL — dù `joined_at` KHÁC NULL. Detector tầng INT của HIGH-1; trước đó vế `accepted_at` chỉ có detector ở tầng UNIT (repo bị stub) nên **tiền đề khiến lỗ tồn tại** — `insertParticipants` đặt `joined_at` ngay lúc mời — chưa từng được đo trên DB thật. Ca có 3 assert TIỀN ĐỀ, thiếu chúng thì đổi hành vi `insertParticipants` là ca xanh-rỗng |
| `FIX2/H7` | **đóng đinh hành vi hiện tại** (KI-063): gỡ thành viên KHÔNG kết thúc cuộc gọi ⇒ phòng khoá 409 |

### 3.2 unit spec `chat-call-room-exit.service.spec.ts` (MỚI) — **7/7 XANH**

Detector TẤT ĐỊNH cho nhánh `if (!ok) continue`. Ca đua ở int-spec **không dựng được tuần tự**:
`hangup`/`reject`/`cancel`/`expireStaleRinging` đều đóng participant VÀ chuyển `chat_calls.status` trong
CÙNG tx, mà B1 lọc `status IN LIVE` ⇒ chạy tuần tự thì B1 trả 0 hàng và ca XANH **kể cả khi nhánh bị gỡ**.

### 3.3 Ratchet đã mở rộng

| Ratchet | Trước | Sau |
| --- | --- | --- |
| `chat-realtime-after-commit.spec.ts` | 5 lối phát, `Object.values(rt)` | **6 lối** (`emitCallPeerLeft`), bộ đếm lấy tập khoá **từ chính `makeRealtime()`** nên khoá mở rộng (`evictFromCallRoom`) không lọt vào; +4 ca (2 cho `removeMember`, 2 cho `leaveRoom` — `describe` đó trước nay **chưa có ca `leaveRoom` nào**); + meta-test đếm đúng 6 |
| `chat-realtime-structure.spec.ts` | đếm `.emit(` **chỉ trong gateway** | + ca phủ **người phát THỨ HAI** vào `/ws-call` (`emitCallPeerLeft`) phải `.parse()` tại call site; docblock gateway sửa cho hết hứa sai |
| `chat-be1-access.int-spec.ts` | — | xem §5 |

### 3.4 Mutation check §5.4 — **12/12 đột biến đều bị bắt**

| # | Vô hiệu hoá | Ca ĐỎ (đo thật) |
| --- | --- | --- |
| a | bỏ hẳn B (không đóng participant) | `C5` (+3 ca khác) |
| b | bỏ `evictFromCallRoom` | `FIX2/4` |
| c | `wasCallParticipant` luôn `true` | `FIX2/1b` (+ `CA 4` cross-tenant) |
| d | bỏ nạn nhân khỏi `participantUserIds` | `C5` (+ `CA 9`) |
| e | ghi cứng `outcome='left'` | unit spec (3 ca) |
| f | bỏ vế `if (!ok) continue` | unit spec (2 ca) |
| g | `emitCallPeerLeft` vào TRONG tx | after-commit (3 ca) |
| h | `evictFromCallRoom` ra SAU commit | after-commit — ca bất đối xứng "0/6 lối NHƯNG evict 1 lần" |
| i | bỏ vế `c.status IN CHAT_CALL_LIVE_STATUSES` | `FIX2/§5.4-i` |
| **j** | bỏ vế `accepted_at` khỏi vị từ KÉP | unit spec + `FIX2/§5.4-j` — đo thật: **1 đỏ / 39 xanh** |
| **k** | chuyển `evictFromCallRoom` SAU commit đi | R-a "POSITIVE CONTROL — evict ĐÚNG 2 lần" — đo thật: **1 đỏ / 24 xanh** |
| **l** | bỏ neo tên method ở `takesCallerTx` | `chat-be1-access` "carve-out neo vào `(` của CHÍNH method" — đo thật: **1 đỏ / 20 xanh** |

> ⚠️ **Đột biến `i` ban đầu KHÔNG bị bắt — ca test có lỗ, đã sửa.** Bản đầu dựng "cuộc gọi đã kết thúc"
> bằng `cancel`, nhưng `cancel` đóng mọi hàng `outcome IS NULL` ⇒ vế lọc **outcome** của B1 một mình đã trả
> 0 hàng, và ca XANH kể cả khi vế `status` bị gỡ. Trạng thái đúng (**hàng CÒN MỞ trên cuộc gọi ĐÃ KẾT THÚC**)
> tới được qua `accept` ⇒ `outcome='accepted'`, mà `closeOpenParticipants` chỉ quét `outcome IS NULL` ⇒ sau
> khi bên kia `hangup`, hàng của người đã nhận máy VẪN là `'accepted'` trong khi cuộc gọi đã `ended`. Ca
> hiện có hai assert **tiền đề** khẳng định đúng trạng thái đó trước khi đo.

### 3.5 `bash harness/check.sh --lane-db=s7callrtfix2` — chạy lại 13/08 sau vòng gỡ BLOCK

```text
✅ secret-literals · ✅ lint · ✅ typecheck · ✅ migration-no-drop · ✅ tooling-tests
❌ test (LANE_DB=mediaos_s7callrtfix2) [chunked]
   ✅ @mediaos/api 523/523 file (1 lần chạy lại vì crash hạ tầng — KI-014)
   ✅ app 226/226 · auth 4/4 · console 27/27 · contracts 32/32 · ui 16/16 · web-core 43/43
   ❌ fbpost 19/19 file · 1 ĐỎ
```

**Điểm đỏ duy nhất KHÔNG thuộc WO này và không phải hồi quy** —
`apps/fbpost/src/lib/library/unc-guard.spec.ts › "TỨC THÌ từ chối UNC gạch xuôi tới máy lạ"`.

Ba bằng chứng, không phải suy đoán:

1. Assert là một **ngân sách đồng hồ**: `expect(Date.now() - t0).toBeLessThan(200)` — loại ca flake dưới
   một full-suite bão hoà (lần chạy này còn kèm một lượt chạy lại vì crash hạ tầng).
2. **Chạy CÔ LẬP 2/2 lần đều XANH** (7/7 ca) — phán quyết flake bằng lần chạy cô lập, đúng khuôn
   `parallel-int-specs-share-one-outbox`.
3. `git diff --stat` của cả 3 commit phiên này trên `apps/fbpost` là **RỖNG** — WO chạm
   `src/chat/**` · `src/realtime/**` · `test/integration/**` · `docs/**`, không có đường ảnh hưởng nào.

⇒ Vế `@mediaos/api` — nơi WO này sống — **523/523 XANH**. Điểm đỏ fbpost là nợ kỹ thuật riêng của app
đó (một assert thời gian không có ngân sách dự phòng); ghi lại đây để người chốt không phải tự điều tra,
**không** sửa trong PR này vì nó nằm ngoài `paths`.

**KHÔNG migration.** Đã đo lại trên lane DB bằng `pg_get_constraintdef` (không suy từ comment):
`'chat_call'` đã có trong CHECK `object_type` của `audit_logs` từ mig `0546` khối E, và cột `action` là text
tự do ⇒ `chat.call.participant_closed` không cần migration nào.

---

## 4. Phát hiện lúc thi công — không có trong plan

### 4.1 Lưới membership bắt method mới, và **không nới được bằng rổ miễn trừ**

`chat-be1-access.int-spec.ts` ca 14 ép: *"MỌI method PUBLIC của service nhận `roomId` đều gọi
`assertMember`"*. `closeCallParticipationOnRoomExit` là method public nhận `roomId` và **cố ý không gate** —
nó chạy TRONG tx của caller, sau khi caller đã qua cổng.

Rổ `MEMBERSHIP_EXEMPT_SERVICES` **không dùng được**: nó là DANH SÁCH ĐÓNG đúng một file và có ca riêng gọi
việc thêm file thứ hai là *"mở cửa sau"*. Thêm tên vào đó là đúng thứ lưới sinh ra để chặn.

**Vá bằng một tính chất CẤU TRÚC hẹp hơn:** method nhận `tx: TenantTx` **làm tham số đầu** không thể là điểm
vào — controller không bao giờ cầm `tx`, chỉ code đã ở trong `db.withTenant` mới gọi được. Carve-out theo
**CHỮ KÝ**, không theo TÊN FILE, nên nó miễn đúng những method mà kiểu tham số **chứng minh** là không tới
được từ ngoài — hẹp hơn rổ miễn-cả-file hẳn một bậc.

**Và nó có GIÁ, ép bằng ca mới:** service chứa method như thế **không được export khỏi `ChatModule`** —
export là đưa nó cho module chưa qua cổng nào, lúc đó lập luận "chỉ caller đã gate mới gọi được" hết đúng.
Đã mutation-check: thêm `ChatCallRoomExitService` vào `exports:` ⇒ ca mới **ĐỎ**.

### 4.2 🔴 Ca bù đó suýt PASS OAN — bộ tách comment của spec nuốt 84% file module

`stripComments` của `chat-be1-access.int-spec.ts` gỡ khối `/* */` **TRƯỚC** rồi mới gỡ dòng `//`. `chat.module.ts`
có **3 dòng `//` chứa chuỗi `/*`** (`` path `/chat/oversight/*` ``, `` `/chat/files/*` ``) — mỗi dòng như thế
mở một khối giả và nuốt tới `*/` thật kế tiếp.

**Đo được: 16.193 ký tự còn 2.639** — mất sạch cả `providers:` lẫn `exports:`. Ca bù khi đó
`indexOf("exports: [")` ra `-1` ⇒ `leaked` LUÔN rỗng ⇒ **PASS OAN**, đúng thứ nó sinh ra để chặn.
(Phát hiện vì mutation check của chính ca đó không ĐỎ — nếu tin vào "20/20 passed" thì bản vá đã land kèm
một cái lưới bằng giấy.)

Đã vá: gỡ dòng `//` **TRƯỚC** để `/*` trong đó biến mất trước khi khối được ghép cặp, + assert
`indexOf("exports: [") > -1` để cách tách hỏng lần sau là ĐỎ chứ không phải xanh rỗng.

> Đây là lỗi có sẵn của spec, không do bản vá đẻ ra — nhưng nó nằm đúng trên đường bản vá đi qua.

### 4.3 🔴 Và carve-out ở §4.1 **không cài đúng hợp đồng của chính nó** (MEDIUM-2 của FULL gate)

Docblock hứa "nhận `tx: TenantTx` làm **tham số ĐẦU**". Regex thì là
`/\(\s*(?:\r?\n\s*)?tx\s*:\s*TenantTx\b/` — khớp **BẤT KỲ dấu `(`** trong chữ ký. Hệ quả: một method
hoàn toàn **tới được từ ngoài**

```ts
async foo(roomId: string, run: (tx: TenantTx) => Promise<void>) { … }
```

được **miễn `assertMember` OAN** — controller cầm `roomId` và gọi thẳng được, `tx` chỉ nằm trong callback.
Và khuôn `body: (tx: TenantTx, …) => …` **đã có trong repo** (`chat-calls.service.ts`), nên đây là lỗ
THẬT chứ không phải rủi ro giả định. Nói cách khác: bản vá cho §4.1 tự nới cái lưới nó vừa dựng.

Đã vá: dựng regex **từ tên method** (`d[2]`) để neo vào `(` mở của chính nó, + ca detector tất định
(chữ ký callback ⇒ `false`, chữ ký tham-số-đầu ⇒ `true`). Đột biến `l` đo được: **1 đỏ / 20 xanh**.

Kèm theo, cùng lớp lỗi: ca "giá" (không được export khỏi `ChatModule`) lọc bằng `roomId` trong khi lưới
chính lọc bằng `takesRoom || takesMessage` ⇒ một cộng tác viên nhận `messageId` **thoát cả hai lưới**
(lưới chính miễn nó, ca giá không thấy nó). Hai vị từ giờ trùng nhau — **miễn ở đâu thì trả giá ở đó**.

---

## 5. Ngoài phạm vi — cố ý, có đóng đinh

**KI-063 (MỚI) — cuộc gọi MA khoá phòng vĩnh viễn.** Bản vá đóng phần THAM GIA nhưng **KHÔNG** kết thúc
cuộc gọi: ghi `chat_calls.status` từ đường THÀNH VIÊN là kéo bề mặt ghi vòng đời ra khỏi `ChatCallsService`,
đúng **hàng rào R4** của `DECISIONS-07` — cần chữ ký owner, không phải một dòng thêm trong lúc vá.

**Đã đo: lỗ KHÔNG do bản vá đẻ ra.** Hôm nay gỡ cả hai người đang gọi cũng làm họ hết `hangup` nổi (404 vì
hết là thành viên) ⇒ cuộc gọi kẹt `active` y hệt. Bản vá đổi *hình dạng* trạng thái kẹt, không mở rộng tập
ca tới được. Ca `FIX2/H7` đóng đinh hành vi hiện tại để nó không trôi trong im lặng.

**Chuyển sang `S7-CALL-QA-2`** (3 câu hỏi tầng FE, ngoài `paths` của WO này): FE người khởi tạo thấy gì khi
nạn nhân bị đóng ở trạng thái `ringing`; nạn nhân là người khởi tạo đang `active` thì FE người còn lại có nút
`hangup` ở trạng thái nào; nạn nhân nhận `peer-left` mang `userId` của **chính mình** (B4 phát cho cả room)
thì FE xử lý ra sao.

**Còn hở, đã ghi ra để không ai đọc nhầm thành "đã kín":** `try/catch` của hai method emitter **chỉ phủ
nhánh ném ĐỒNG BỘ** — `socketsLeave`/`emit` với adapter Valkey publish trong một promise nội bộ, reject ở đó
thành `unhandledRejection`. Rủi ro này **đã có sẵn** ở `severUserSessions`, không do WO này đẻ ra.
Và **xoá/archive phòng giữa cuộc gọi** chưa đo — không nằm trong hai cửa đã vá.

---

## 6. Hai LOW của `security-reviewer` — CỐ Ý không vá ở WO này

Không chặn merge, nhưng ghi ra để không ai đọc bộ ratchet này rộng hơn thực tế:

1. **Ratchet mã-nguồn thuần nằm sau `describe.skipIf(!hasLaneDb)`.** Ca 14 của
   `chat-be1-access.int-spec.ts` (và ca carve-out mới thêm ở §4.3) chỉ đọc file nguồn, **không cần
   Postgres** — nhưng chúng nằm trong một `describe` bị gate theo lane DB. Trên máy không có Postgres thì
   **cả cái MIỄN lẫn cái GIÁ cùng im lặng**. Đây là vấn đề CÓ SẴN của ca 14; tách chúng ra một `describe`
   không-gate là việc của một WO dọn ratchet, không phải của một WO an ninh. CI **có** chạy int-spec nên
   thực tế vẫn được canh.
2. **Ca R-b chỉ đọc `realtime-emitter.service.ts`.** Người phát THỨ BA vào `/ws-call` đặt ở một file khác
   trong `src/realtime/` sẽ **không ai canh**. Vá đúng là quét cả thư mục — cùng lý do như trên, để lại.

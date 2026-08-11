# S7-CALL-QA-1 — Nghiệm thu wave CALL

> **Vùng ĐỎ.** WO này không thêm tính năng: nó đo xem 4 WO đã land (`DOC-1`/`DB-1`/`BE-1`/`RT-1`) và
> `FE-1` có thật sự được canh hay không, rồi lấp phần chưa được canh.
>
> Nguồn: `harness/backlog.mjs` mục `S7-CALL-QA-1` · `DECISIONS-07` (R1–R4) · SPEC-15 §5.1c/§11/§12 ·
> `docs/plans/S7-CALL-{BE,RT,FE}-1.md`.
>
> **Bản v2 (11/08/2026)** — sau vòng `plan-reviewer` (verdict BLOCK) và 2 vòng chốt của owner. Các
> quyết định đã khoá: phạm vi = **A–D (chỉ API)**, nhóm E (FE) tách sang `S7-CALL-QA-2`; `done_when`
> #4 đi đường **F-b** trên **DB cô lập**; lỗ fail-OPEN §1e tách sang **`S7-CALL-RT-FIX-1`**, QA-1 chỉ
> đặt tripwire.

---

## 0. Đo TRƯỚC khi lập kế hoạch

Plan này dựng trên **số đo**, không trên tiêu đề WO — bài học `wo-plans-built-on-code-comments`. Mọi
con số chạy trên DB cô lập `mediaos_s7callqa1` (214 migration, `chat_calls` +
`chat_call_participants` xác nhận có mặt), 6 test-file CALL, **92/92 pass**.

```bash
bash scripts/lane-db-setup.sh s7callqa1 --reset
source scripts/lib/db-secrets.sh && db_secrets_load       # BẮT BUỘC, xem §0.1
export LANE_DB=mediaos_s7callqa1
pnpm --filter @mediaos/api exec vitest run \
  src/chat/chat-call-signal-deny.spec.ts src/chat/chat-call-ice.service.spec.ts \
  src/chat/chat-calls.invite-cooldown.spec.ts src/realtime/call-signalling.gateway.spec.ts \
  test/integration/chat-s7-call-be1-lifecycle.int-spec.ts \
  test/integration/chat-s7-call-rt1-signalling.int-spec.ts \
  --coverage --coverage.include='src/chat/chat-call*.ts' \
  --coverage.include='src/chat/chat-calls*.ts' --coverage.include='src/realtime/call-signalling*.ts' \
  --coverage.reporter=text --no-file-parallelism --coverage.clean=true
```

### 0.1 Bẫy gặp ngay ở bước đo

`export LANE_DB=…` rồi chạy vitest thẳng ⇒ **Startup Error: THIẾU APP_DB_PASSWORD**. Mật khẩu DB
không còn literal trong repo (S6-SEC-ROTATE-1). Phải `source scripts/lib/db-secrets.sh &&
db_secrets_load` trước, hoặc đi qua `bash harness/check.sh --lane-db` (tự nạp). Memory
`lane-db-run-needs-explicit-urls`.

### 0.2 Coverage hiện tại — vùng CALL phía API

| File | Stmts | Branch | Funcs | Nhận xét |
| --- | --- | --- | --- | --- |
| **`chat/` (9 tệp)** | **98.66** | **94.85** | **100** | ✅ BE-1 canh rất kín |
| **`realtime/` (3 tệp)** | **80.49** | **70.11** | **96.15** | ⚠️ **KHÔNG đạt** `done_when` #3 |
| `call-signalling-violation.writer.ts` | 100 | 100 | 100 | |
| `call-signalling.gateway.ts` | 82.34 | **68.67** | 100 | |
| `call-signalling.filter.ts` | **21.73** | — | **50** | thân `catch()` CHƯA TỪNG CHẠY |
| **Toàn cụm CALL/API** | **92.3** | **87.7** | **98.85** | |

**Phán quyết `done_when` #3:** ngưỡng là "≥80% vùng CALL, **gateway signalling cao hơn**". Toàn cụm
92.3 đạt; nhưng chính gateway lại là chỗ **thấp nhất** (branch 68.67) và filter gần như trắng. Vế
"cao hơn" **chưa đạt** ⇒ phần việc chính của WO.

`% Funcs` 98.85 nhìn rất đẹp và **đó là cái bẫy**: mọi hàm đều được gọi ít nhất một lần, nhưng nhánh
TỪ CHỐI bên trong chúng thì không. Đúng `deny-cases-vacuous-without-allow-case` — đếm NHÁNH, đừng
đếm hàm.

### 0.3 Coverage phía FE — KHÔNG ĐO ĐƯỢC (⇒ `S7-CALL-QA-2`)

`pnpm --filter @mediaos/app exec vitest --coverage` ⇒ `ERR_MODULE_NOT_FOUND: @vitest/coverage-v8`
(gói chỉ khai ở `apps/api/package.json:62`). Bề mặt FE **không có một spec nào** — grep
`use-chat-call|CallExperience|CallProvider|call-ringtone` trong `*.spec.ts{,x}` = **0 hit**:
`use-chat-call.ts` 676 · `CallExperience.tsx` 307 · `CallProvider.tsx` 143 · `call-ringtone.ts` 115
= **1.241 dòng**. Đã có spec: `call-signalling.ts` (201), `CallButtons.tsx` (73), `chat-call-api.ts` (53).

### 0.4 `done_when` #2 (cô lập tenant) — ĐÃ ĐẠT SẴN, không làm trùng

- REST: `be1-lifecycle` **ca 3** (`callId` tenant khác ⇒ 404 `CHAT-ERR-026`, 0 byte đổi ở tenant kia)
  \+ **ca 3b** (`callId` không tồn tại trả phản hồi **giống hệt**) ⇒ không lộ tồn tại.
- WS: `rt1-signalling` **CA 4** (`callId` công ty A + socket công ty B ⇒ 0 relay, 0 hàng đổi ở A).

Việc còn lại của nhóm này chỉ là **chạy nó như CI** (`done_when` #1) và chứng minh 0 skip.

### 0.5 Thay đổi NGOÀI test — khai trước để FULL gate không bất ngờ

WO này **không còn** thuần "chỉ thêm test". Nó sẽ chạm:

| Tệp | Vì sao | Hệ quả gate |
| --- | --- | --- |
| `harness/backlog.mjs` | `paths` thiếu nơi spec unit phải sống (§3.4) | — |
| `apps/api/vitest.config.ts` + `package.json` | ngưỡng coverage per-file + script `test:cov:call` (§3.3) | — |
| `apps/api/src/**/*.spec.ts` (unit colocated) | `vitest.config.ts:45-50` chỉ nhận `src/**/*.spec.ts` | thêm `.spec.ts` **không** trip ratchet: `chat-realtime-structure.spec.ts:20,48` loại `.spec.ts` khỏi mọi lần quét |

**KHÔNG** chạm `src/realtime/call-signalling.gateway.ts` — bản vá thuộc `S7-CALL-RT-FIX-1`.

---

## 1. Bản đồ lỗ — từng dòng, phía API

Trích từ `coverage-final.json` (v8), không phải đọc mắt.

### 1a. `call-signalling.filter.ts` — hở **25-46** (toàn bộ thân `catch()`)

Filter tồn tại vì `BaseWsExceptionFilter` mặc định `includeCause: true` sẽ echo lại **tên sự kiện +
chính payload client vừa gửi** và **giữ socket sống**. Hai lỗ cùng lúc: (1) oracle phân biệt "handler
ném" với "bỏ im lặng" — phá đúng tính không-phân-biệt-được mà lớp A/B/C dựng ra; (2) khung echo có
thể mang chính `sdp`/`candidate`, tức **vi phạm R3**.

**Cả hai tính chất đó chưa từng được đo.** Gỡ `@UseFilters` hôm nay không làm đỏ bài nào.

### 1b. Thang từ chối handshake — **1/6 nấc được canh**

| Dòng | Nhánh | |
| --- | --- | --- |
| 200-203 | không có token ⇒ từ chối | ❌ |
| 212-215 | token **không có `exp`** ⇒ fail-CLOSED | ❌ |
| 218-223 | token sai / hết hạn ⇒ từ chối | ❌ |
| 232-235 | vượt trần bắt tay/phút ⇒ `too_many_connections` | ❌ |
| 178-184 | handshake **ném** ⇒ fail-CLOSED `unauthorized` | ❌ |
| 244 | thiếu cặp `('call','chat-room')` ⇒ `forbidden` | ✅ CA 13 |
| 792-793 | rút token qua header `Authorization: Bearer` | ❌ |

### 1c. Vòng đời phiên — bản vá HIGH của FULL gate RT-1 có **0 test**

| Dòng | Nhánh | |
| --- | --- | --- |
| 299-301 | timer `exp` chạy ⇒ **ngắt socket** | ❌ — chính bản vá security-reviewer 10/08 |
| 294-298 | `ttlMs <= 0` ⇒ (định) ngắt ngay | ❌ — **và nó KHÔNG ngắt**, xem §1e |
| 585-589 | token hết hạn, kiểm lại ở `accept()` | ❌ |
| 592-604 | ảnh chụp quyền quá TTL ⇒ hỏi lại; thu hồi ⇒ ngắt | ❌ |

### 1d. Trần khung + đường hỏng

567-572 trần **CỨNG** ⇒ ngắt · 573-580 trần **MỀM** ⇒ drop im lặng, socket sống · 554-561 khung tới
mà socket không có `state` · 638-644 lớp C nhánh "chưa từng được mời" · 709-717 `relay()` ném ·
761-767 ghi security-event hỏng vẫn ngắt · 774-779 `disconnect()` ném trong `finally`. **Tất cả ❌.**

### 1e. 🔴 PHÁT HIỆN MỚI — nhánh 294-298 là **fail-OPEN thật**, không phải fail-closed

Docblock hứa "fail-CLOSED nếu đồng hồ lệch". Thực tế **ngược lại**. Chuỗi đã kiểm chứng trên nguồn:

| Bằng chứng | Nội dung |
| --- | --- |
| `socket.io@4.8.3/dist/socket.js:592-594` | `disconnect(close)` → `if (!this.connected) return this;` |
| `socket.js:90` / `:408` | `connected = false` lúc khởi tạo; chỉ thành `true` trong `_onconnect()` |
| `socket.io/dist/namespace.js:221` → `:241` | middleware `run()` chạy TRƯỚC; `_doConnect` → `_onconnect` chỉ trong callback SAU đó |
| `call-signalling.gateway.ts:260` | `scheduleTokenExpiry` được gọi **trong** middleware, trước `next()` |

⇒ `client.disconnect(true)` ở dòng 296 là **no-op**. `scheduleTokenExpiry` `return`, `handshake()`
chạy tiếp qua `onAny` (263) + `join(callUserRoomName)` (265) và **`return undefined`** (266) ⇒
`next(undefined)` ⇒ **kết nối ĐƯỢC CHẤP NHẬN, với token đã hết hạn và `state.expiryTimer = null`**.

**Hệ quả:** socket ngồi im trong room của chính người đó và **NHẬN mọi `sdp-offer`/`sdp-answer`/
`ice-candidate`** bắn tới họ, **vô thời hạn** — không timer nào cắt. Đường cắt còn lại duy nhất là
`severUserSessions` (khoá/xoá tài khoản). Đây đúng là lỗ mà bản vá HIGH của RT-1 dựng ra để bịt;
bản vá đúng cho đường thường (timer) nhưng **hở ở rìa** "token hết hạn ngay tại lúc bắt tay".

**Khả năng chạm:** `jwt.verify` (208) đã chặn token hết hạn, nên phải trúng cửa sổ giữa verify và
dòng 293 — cửa sổ đó chứa **2 round-trip I/O** (`cooldown.allow` → Valkey, `permissions.can` →
Valkey/DB), hàng chục ms, và người cầm token sắp hết hạn chỉ cần nối lại lặp cho tới khi trúng. Lệch
đồng hồ làm rộng thêm.

**Chiều GỬI vẫn kín** — `accept()` 585-589 kiểm lại `exp` và ở đó `disconnect()` chạy thật (socket đã
`connected`). Lỗ chỉ ở **chiều NHẬN**.

**Xử lý (owner chốt 11/08):** vá thuộc **`S7-CALL-RT-FIX-1`** (chạm `src/realtime/**` ⇒ crown-jewel,
FULL gate riêng). QA-1 chỉ đặt **tripwire tự gỡ** — xem C2 ở §2.

---

## 2. Việc phải làm — A–D, có gán int/unit

Cột **Tầng** là bắt buộc: 6 ca dưới đây **không dựng được** ở int-spec, và ca nào ghi "int" mà không
nói cách tiêm lỗi thì người thi công sẽ tự hạ assert.

### Nhóm A — filter câm (21.73 → 100)

| Ca | Tầng | Cách dựng | Assert |
| --- | --- | --- | --- |
| **A1** | int | `vi.spyOn(app.get(ChatCallSignalService),'resolveSignalAccess').mockRejectedValueOnce(...)` + `mockRestore()` trong `finally`. **KHÔNG** `overrideProvider` — int-spec dựng MỘT app cho cả file (`:246-253`), override là toàn-file ⇒ giết 17 ca hiện có | client nhận **0 khung** + socket ngắt |
| **A2** | unit | fake socket có `disconnect` ném | log lỗi thứ hai, không nuốt, không ném ra ngoài |

⚠️ A1 phải bắt bằng `socket.onAny((name,p)=>events.push(...))`, **không** dùng `wrap()` của int-spec
(`:177-208` chỉ `on()` ~9 tên cố định). Tính chất cần chứng minh chính là "**không có** khung nào" —
danh sách đóng làm ca xanh oan với mọi tên khung tương lai (`error`, `call:error`).

### Nhóm B — thang từ chối handshake (6 nấc)

| Ca | Tầng | Ghi chú |
| --- | --- | --- |
| **B1** không token | int | |
| **B2** token thiếu `exp` | int | `jwt.sign(payload, secret)` **không** `expiresIn` |
| **B3** token rác/hết hạn | int | |
| **B4** vượt trần bắt tay | **unit** | int cần **31 lần bắt tay** (`CHAT_CALL_CONNECT_MAX_PER_MIN=30`) — chậm; và `realtime.module.ts:59` đăng ký **`ChatCallCooldownService` thứ hai**, `app.get()` là mơ hồ ⇒ dễ đốt nhầm instance = ca xanh rỗng. Unit: `cooldown.allow → false` ⇒ `next(Error('too_many_connections'))` |
| **B5** `permissions.can` ném | **unit** | `permission.service.ts:272-284` bọc try/catch trả `{allow:false}` — **không bao giờ ném** ⇒ int không chạm nổi 178-184 |
| **B6** token qua header `Bearer` | int | đường rút thứ hai (792-793) |

🔴 **B1/B2/B3/B5 đều trả CÙNG chuỗi `"unauthorized"`** (gateway `:202`/`:214`/`:222`/`:183`) và
`expectConnectRefused` (`:211-224`) chỉ đọc `err.message`. Một token B2 dựng sai (sai secret, thiếu
`email` — `token.service.ts:115` bắt buộc `typeof decoded.email === "string"`) vẫn cho
`"unauthorized"` ⇒ **ca xanh mà dòng 212-215 chưa từng chạy**. Hai hàng rào bắt buộc:

1. **Cặp tối thiểu** — đối chứng ALLOW phải cùng hàm ký, cùng user, **khác đúng một bit**. Ví dụ B2:
   `jwt.sign(payload, secret)` ⇒ refused; **cùng payload + `expiresIn: 900`** ⇒ **nối được**.
   (CA 13b **không** dùng lại được: khác fixture.)
2. **Delta coverage theo dòng** là bằng chứng nghiệm thu của nhóm B: 200-203 · 212-215 · 218-223 ·
   232-235 · 178-184 phải đi từ `0` → `>0` trong `coverage-final.json`. Đầu ra quan sát được không
   phân biệt nổi các nấc, nên số dòng là thứ duy nhất chứng minh.

Secret lấy từ `loadEnv().JWT_SECRET` (`vitest.config.ts:22`), **không** gõ literal — gitleaks.

### Nhóm C — vòng đời phiên

| Ca | Tầng | Cách dựng |
| --- | --- | --- |
| **C1** token TTL ngắn ⇒ tới hạn, socket **bị ngắt** dù im lặng | int | ký token `expiresIn: 3s`, chờ ~3.5 s (dưới `testTimeout: 20000`). Giữ bản vá HIGH của RT-1 |
| **C2** `ttlMs <= 0` ⇒ handshake phải **BỊ TỪ CHỐI** | unit | **characterization test**, xem dưới — hiện production **chấp nhận** (§1e) |
| **C3** hết hạn phát hiện ở `accept()` (585-589) | int | **KHÔNG** dùng token TTL ngắn: timer `299-302` đặt đúng tại `exp` và sau connect thì `disconnect(true)` chạy THẬT ⇒ timer luôn thắng, socket không còn để gửi khung ⇒ ca bất khả/flaky. Dùng **cùng cơ chế C4**: `vi.useFakeTimers({toFake:['Date']})` + `setSystemTime(exp+1s)`. Fake **chỉ `Date`** ⇒ `setTimeout` thật KHÔNG fire, chỉ `accept()` bước (2) thấy quá hạn |
| **C4** **thu hồi cặp quyền giữa cuộc gọi** ⇒ ngắt | int | 3 bước + **oracle thứ hai** bắt buộc, xem dưới |

**C2 — characterization test, KHÔNG dùng `it.fails`.** `it.fails` xanh khi thân bài ném vì **bất kỳ
lý do gì** (typo, import sai, fake socket refactor đẻ `TypeError`) ⇒ nếu ca hỏng vì lý do khác thì nó
**xanh mãi mãi kể cả sau khi bản vá land** — tripwire không bao giờ nổ, đúng thứ ta muốn tránh. Thay
bằng khẳng định trạng thái quan sát được:

```text
it("TRIPWIRE S7-CALL-RT-FIX-1 — ttlMs<=0 hiện KHÔNG bị từ chối (LỖ MỞ; ca này PHẢI đỏ khi bản vá land)")
  → tokens.verifyAccessToken trả exp quá khứ
  → chạy middleware của afterInit với fake socket (connected=false, disconnect() no-op như socket.io)
  → expect(nextArg).toBeUndefined()          // handshake ĐƯỢC CHẤP NHẬN — hành vi HIỆN TẠI
  → expect(state.expiryTimer).toBeNull()     // và không có gì cắt phiên
```

Cùng tính tự-gỡ (`nextArg` thành `Error` khi vá land ⇒ đỏ), nhưng **không thể xanh vì lý do sai**.
**Cấm** assert "`disconnect()` được gọi" — đó chính là assert sai đã che lỗ này. Đăng ký một mã KI và
trỏ ngược từ plan `S7-CALL-RT-FIX-1` ("lật ca này thành hành vi đúng"), nếu không người vá sẽ chỉ xoá nó.

⚠️ **Quy ước fake socket dùng chung:** `connected` mặc định **`true`** cho D1–D4 (đường sau connect,
`disconnect()` chạy thật) và **`false`** riêng cho C2 (đường middleware). Thiếu quy ước này thì D2/D4
trở thành đúng loại xanh-giả mà C2 đang cảnh báo.

**C4 — ba bước, thiếu bước nào là đo cache chứ không đo thu hồi:**

1. DELETE hàng `role_permissions` qua pool `direct`.
2. **Gọi invalidation tường minh** `app.get(CACHED_REPO).invalidateUser(companyId,userId)`
   (`permission.module.ts:118-121`) — `permission.cache.ts:12 CACHE_TTL_SEC = 300` nghĩa là không gọi
   thì `can()` vẫn trả kết quả cũ tới 5 phút.
3. **Dịch đồng hồ, đừng ngủ**: `PERMISSION_SNAPSHOT_TTL_MS = 60_000` (`gateway:71`) là **hằng cứng,
   không env** — chờ thật thì vượt `testTimeout: 20000`. Dùng `vi.useFakeTimers({toFake:['Date']})` +
   `vi.setSystemTime(Date.now()+61_000)`; **chỉ** fake `Date`, giữ `setTimeout` thật cho socket.io.

🔴 **C4 cần ORACLE THỨ HAI — "socket bị ngắt" một mình là xanh-vì-nhầm-nấc.** `accept()` chạy bước (2)
*trước* bước (3): sau khi dịch `+61_000`, nếu access-token của actor còn dưới 61 s thì **585-589** ngắt
và ca vẫn xanh mà **592-604 chưa từng chạy**. Bắt buộc thêm **một trong hai**: (i) spy `can()` được gọi
**lần thứ hai** với cặp `('call','chat-room')`; hoặc (ii) delta dòng **598-601** từ `0` → `>0`. Và ghi
điều kiện tiên quyết: **token của actor phải còn > 61 s** khi dịch đồng hồ.

Ca ALLOW đối chứng ("trong TTL thì KHÔNG hỏi lại DB") đếm bằng
`vi.spyOn(PermissionService.prototype,'can')` **lọc theo đối số** `{action:'call',
resourceType:'chat-room', userId}` — đếm tổng là rác vì mọi request REST trong ca cũng gọi `can()`.

### Nhóm D — trần khung + đường hỏng

| Ca | Tầng | Ghi chú |
| --- | --- | --- |
| **D1** trần CỨNG ⇒ ngắt / MỀM ⇒ drop, socket sống | **unit** | int cần **361 khung/10 s** (`120 × 3`), 120 khung đầu mỗi khung 2 truy vấn ⇒ ~240 query đồng thời trên lane DB. Unit: gieo thẳng `state.budget` rồi bắn 1 khung — tất định. 🔴 **Hạt giống đúng là `count: 120` (⇒ drop) và `count: 360` (⇒ disconnect)**, KHÔNG phải 119/359: `chargeFrame` (`chat-call-signal-deny.ts:151`) tính `next.count = fresh.count + 1` rồi mới so sánh, nên gieo 119 cho verdict **`"ok"`** |
| **D2** socket không `state` | **unit** | `state` luôn được middleware đặt trước `next()` ⇒ int không dựng nổi. Gọi thẳng `onPing(fakeSocket, {})` |
| **D3** `relay()` ném | **unit** | gán `gw['server']` giả cho `emit()` ném. ⚠️ `relay()` chỉ đi qua `this.server` khi **`from === null`** — tức đường `sdp`/`ice` hoặc `handleDisconnect`. Bắn `call:join` sẽ **không** chạm (nhánh đó dùng `client`) |
| **D4** ghi security-event hỏng vẫn ngắt + `disconnect` ném vẫn không sập | **unit** | `violations.record` là singleton dùng chung ⇒ không mock được ở int. Vào `punish()` qua đường công khai: `onPing(client, {})` (payload sai schema) ⇒ `deny` → `punish` |
| **D5** lớp C của `join/leave/ping/media/screen` | int | |
| **D6** socket join **2** `callId` rồi `disconnect()` cứng ⇒ **cả hai** phòng nhận `peer-left` | int | Bất biến `joinedCallIds` là `Set` hiện chỉ sống trong docblock (`:92-96`); đổi `Set` → biến đơn hôm nay không làm đỏ bài nào. Hỏng IM LẶNG = người ma treo trong cuộc gọi trước |

⚠️ **B6** dùng `extraHeaders` + `transports:['websocket']` (engine.io-client đổ `extraHeaders` vào
options của `ws` ở Node). Chưa kiểm lại dòng code trong `node_modules`; **không rủi ro xanh-oan** vì B6
kỳ vọng **nối được** — dựng sai thì đỏ ngay.

### Nhóm C5 — lỗ chưa ai canh, phát hiện ở vòng review

**C5** (int, rẻ): **gỡ thành viên khỏi phòng GIỮA cuộc gọi**. `chat-call-signal.service.ts:87-91` suy
`activeUserIds`/`participantUserIds` **chỉ từ `chat_call_participants.outcome`** — không từ membership
phòng hiện tại, không từ cặp quyền. Hai chiều đều đáng đo:

- **Chiều nhận:** người bị gỡ vẫn nằm trong `activeUserIds` ⇒ `assertPeer` (`:664`) vẫn cho bên kia
  relay SDP/ICE tới họ, và họ vẫn ở trong `callUserRoomName` ⇒ **tiếp tục nhận** tới khi token hết hạn.
- **Chiều gửi:** FE của họ vẫn trickle ICE (WebRTC tự làm, không cần thao tác người) ⇒
  `resolveSignalAccess` trả `null` ⇒ `classifyMissingParticipant('call:ice-candidate') = 'probe'` ⇒
  **ghi `user_security_events` + ngắt một người dùng vô tội**. Cùng lớp lỗi mà CA 9 đã vá cho đường
  `hangup`, nhưng đường "gỡ thành viên" thì chưa.

⚠️ Cần đường gỡ thành viên. Nếu `DELETE /chat/rooms/:id/members/:userId` không tồn tại thì gỡ bằng SQL
(`chat_room_members.left_at`) qua pool `direct` — ghi trước để người thi công **không tự chế endpoint**.

C5 **đo trước, kết luận sau**: nếu hành vi đo được là chấp nhận được thì chốt nó vào §5 thành hành vi
ĐƯỢC BIẾT; nếu không, leo owner mở WO vá. **Không** tự sửa trong QA-1.

### Nhóm C6 — lỗ thứ hai chưa ai canh (vòng review 2)

**C6** (int, rẻ — tái dùng đường `severUserSessions` của CA 19): **tài khoản bị KHOÁ vẫn mở được phiên
`/ws-call` MỚI** bằng access-token còn hạn (tối đa 900 s).

`handshake()` (`gateway:198-244`) chỉ kiểm chữ ký + `exp` + cặp quyền — **không đọc trạng thái user,
không đọc `user_sessions`**. `severUserSessions` (CA 19) chỉ cắt socket **đang sống tại thời điểm
khoá**: người bị khoá lúc offline, hoặc nối lại sau đó, đi lọt. Khoá thường **không gỡ role** (memory
`lock-no-revoke`) ⇒ `permissions.can` vẫn ALLOW. Hệ quả riêng của kênh này: 15 phút vẫn nhận được
SDP/ICE — tức IP nội bộ + mốc thời gian cuộc gọi của người khác.

Dựng: khoá user qua `AuthUsersService.lock`, rồi nối `/ws-call` bằng token ký **TRƯỚC** khi khoá.
Cùng cách xử lý như C5: **đo trước, kết luận sau** — chấp nhận được thì chốt vào §5, không thì leo owner.

### Nhóm E (FE) — NGOÀI PHẠM VI, tách `S7-CALL-QA-2`

E0 cài `@vitest/coverage-v8` cho `apps/app` · E1 `use-chat-call.ts` (luật "ai gửi offer" chống glare ·
trần 64KB/4KB trước khi gửi · mất mạng ⇒ dọn peer, **không treo camera**) · E2 `CallProvider` /
`CallExperience` / `call-ringtone`.

⚠️ Tách WO **không** làm lỗ nhỏ đi: tới khi QA-2 chạy, 1.241 dòng FE vẫn là điểm mù **không đo được**,
và `done_when` #3 của FE-1 (mất mạng ⇒ không treo camera) vẫn **không có gì canh**.

---

## 3. Thứ tự, cưỡng chế, phạm vi

### 3.1 Thứ tự

A → B → C → D → C5. Ca int thêm vào `chat-s7-call-rt1-signalling.int-spec.ts`; ca unit vào spec
colocated mới (`src/realtime/call-signalling.filter.spec.ts`, mở rộng
`src/realtime/call-signalling.gateway.spec.ts` — harness fake deps đã có ở `:20-39`).

Sau **mỗi nhóm** chạy lại coverage. **Không nhận nhóm nào chưa nhích số** — nhóm B bắt buộc chứng
minh bằng **delta theo dòng** (§2 nhóm B).

### 3.2 Nguồn flake phải né

1. **Trần bắt tay 30/phút/người** (`chat-call-signal-deny.ts:128`): `uCaller` hiện đã dùng ~8 lần
   trong <60 s. Thêm ~10 ca nữa dùng lại cùng user là chạm trần ⇒ **đỏ ngẫu nhiên ở ca KHÁC** (đúng
   `per-user-rate-limit-throttles-own-int-spec`). ⇒ **mỗi nhóm ca mới dùng user RIÊNG.**
2. Ca dựa trên timer: C1 chờ thật 3.5 s (chấp nhận được); C3/C4 **dịch đồng hồ**, không ngủ.
3. Không thêm ca đua nào ngoài ca đã có (ca 12 của BE-1).

**Vệ sinh dịch-đồng-hồ** — C3/C4 fake `Date` trong một tiến trình đang chạy Nest + socket.io + PG:

- `vi.useRealTimers()` trong `finally` — **bắt buộc**;
- **không gọi REST nào** khi đồng hồ đang lệch: token ký ra sẽ mang `exp` tương lai, còn `now()` của PG
  thì không lệch;
- đặt C3/C4 ở **CUỐI file**: socket của các ca trước vẫn nằm trong `openClients`, một khung gửi trên
  chúng trong cửa sổ lệch sẽ bị ngắt ở bước (2) của `accept()` và làm **đỏ ca khác**.

### 3.3 Cưỡng chế ngưỡng — `harness/check.sh` KHÔNG chạy coverage

`grep coverage harness/check.sh` = **0 hit**. Ngưỡng per-file sống ở `apps/api/vitest.config.ts:99-209`,
và tiền lệ (`:153-163`) nói rõ threshold chỉ cắn khi file **xuất hiện trong report** ⇒ phải có script
riêng. Khuôn có sẵn: `package.json:13 test:cov:sensitive`.

⇒ Thêm `"test:cov:call"` (đúng các file CALL, `--coverage.include` 3 file `call-signalling*` +
`chat-call*`) và 2 khối threshold per-file: `call-signalling.gateway.ts` **branches ≥80** ·
`call-signalling.filter.ts` **100**. Cụm CALL/API giữ **≥90**. Không có ratchet thì con số hôm nay
trôi mất tuần sau.

**Hai điều kiện để threshold không cắn nhầm** (đã đo 11/08, không phải suy đoán):

1. **Không được có job nào chạy `--coverage` mà thiếu `--coverage.include`.** Đó là kịch bản duy nhất
   kéo `call-signalling.gateway.ts` vào report ở một lần chạy **không có `LANE_DB`** (int-spec skip)
   ⇒ branch tụt dưới 80 ⇒ **đỏ oan**. **Đã kiểm:** `grep -rn coverage .github/workflows/` = **0 hit**,
   `test:cov*` cũng không được gọi ở CI ⇒ hiện an toàn. Ai thêm job coverage sau này phải đọc mục này.
2. Copy nguyên văn comment "inert unless in report / enforced only by `test:cov:call`" vào 2 khối
   threshold mới, đúng như `vitest.config.ts:153-163` đã làm — không có comment đó thì người sau gỡ nhầm.

🔴 **Nói thẳng giới hạn:** vì CI **không** chạy coverage ở bất kỳ job nào, `test:cov:call` là **ratchet
chạy TAY**, không phải cổng CI. Nó chặn được người cố ý đo, không chặn được PR của người không đo. Muốn
thành cổng thật thì phải thêm job CI — việc đó **ngoài phạm vi** WO này, ghi ra để không ai đọc §3.3
rồi tin rằng ngưỡng được cưỡng chế tự động.

### 3.4 `paths` của WO phải mở đúng chỗ (memory `wo-paths-drive-gate-and-scheduler`)

`harness/backlog.mjs:10464` hiện là `["apps/api/test/**", "apps/app/src/**", "docs/plans/…"]` — thiếu
nơi spec unit BẮT BUỘC phải sống. Thêm **HẸP** (không mở cả `apps/api/src/**`, để `guard-scope` còn
kêu khi đụng code sản xuất):
`apps/api/src/realtime/call-signalling*.spec.ts` · `apps/api/src/chat/chat-call*.spec.ts` ·
`apps/api/vitest.config.ts` · `apps/api/package.json` · `docs/QA/evidence/**`.
Bỏ `apps/app/src/**` (đã chuyển sang QA-2).

### 3.5 Bẫy phải tránh

Không hạ assert nào của **48 ca sẵn có** để lấy màu xanh (`tests-can-pin-a-hole-open`). Mọi dòng `−`
trong test phải giải trình từng dòng, như S8-CHAT-UX-QA-1 §4 đã làm.

---

## 4. `done_when` #4 — đường F-b, trên **DB CÔ LẬP** (owner chốt 11/08)

### 4.1 🔴 KHÔNG chạy trên `mediaos`

`.env` trỏ `DATABASE_URL=…/mediaos` và `apps/api/test/db-target.ts:49` denylist đúng tên đó
(`PROTECTED_DB_NAMES = ["mediaos","mediaos_dev"]`). `pnpm dev` mặc định ⇒ tạo
`chat_rooms`/`chat_calls`/`chat_call_participants`/`audit_logs` **thật** trên cụm PROD (45 nhân viên,
đang sống) và **đổ chuông tới người thật**.

⇒ Chạy api+app cục bộ với `DATABASE_URL`/`DATABASE_DIRECT_URL` trỏ **`mediaos_s7callqa1`**, seed 2 tài
khoản test thuộc company test + 1 phòng `direct`, xoá sạch sau khi đo.

Về `modules.is_active = false`: **không cần bật** — cờ này KHÔNG chặn request nào (memory
`module-is-active-is-not-a-gate`); bật nó chỉ thêm rủi ro cho UI mà không đổi gì ở đường API.

### 4.2 Bảng ghi bằng chứng — mỗi dòng một ảnh

| # | Bước | Điều phải THẤY |
| --- | --- | --- |
| 1 | A bấm nút gọi | A: khung "đang gọi"; B: **chuông + khung đến** |
| 2 | B bấm nhận | Hai bên `active`; **thấy hình + nghe được tiếng** nhau |
| 3 | A tắt mic, B tắt cam | Chỉ báo đổi ĐÚNG phía, bên kia thấy ngay |
| 4 | A chia sẻ màn hình | B thấy màn hình A |
| 5 | A gác máy | Hai bên về `ended`, **camera TẮT hẳn** (đèn webcam tắt) |
| 6 | Ngắt mạng B giữa cuộc gọi | A thấy trạng thái rõ ràng, peer connection được dọn, **không treo camera** |

Bước 6 đáng giá nhất: nó chính là `done_when` #3 của FE-1 và tới nay **chưa có gì canh** (nhóm E đã
tách sang QA-2).

Bằng chứng lưu ở **`docs/QA/evidence/S7-CALL-QA-1-*`** (quy ước đang dùng — 12 tệp sẵn có, vd
`S8-CHAT-UX-QA-1-ACCEPTANCE.md`). Không dùng `docs/evidence/` (không tồn tại).

---

## 5. Chưa phủ — ghi để không ai đọc nhầm là đã kín

1. **`is_active = false`**: module CHAT vẫn tắt trên PROD. Nghiệm thu này nói về đường API +
   component, KHÔNG nói người dùng cuối đã gọi được.
2. **Ràng buộc 1-1 nằm ở FE** (owner chốt 10/08) — hàng rào UX, không phải cổng an ninh. §12 không có
   mã lỗi cho "cuộc gọi đã đủ người" ⇒ không ca server nào canh được vế này.
3. **TURN thật chưa được đo**: `ice-config` có ca gate + ca thoái-lui-STUN, nhưng chưa cuộc gọi nào đi
   qua TURN Cloudflare thật.
4. **1.241 dòng FE là điểm mù không đo được** cho tới khi `S7-CALL-QA-2` chạy (§0.3).
5. **Fail-OPEN §1e còn trên master** cho tới khi `S7-CALL-RT-FIX-1` land. QA-1 chỉ đặt tripwire C2.
6. **Cửa sổ thu hồi quyền thực tế = 60 s ảnh chụp + tối đa 300 s cache Valkey** với những đường không
   phát `permission.changed` (`permission-admin.service.ts:47` nói thẳng điều này) — docblock
   `gateway:57-71` đang hứa "60 s". Lệch này là hành vi, không phải bug của WO này; ghi ra để không ai
   đọc docblock rồi tin nhầm.
   ⚠️ Và con số đó chỉ đúng cho **chiều GỬI**. **Chiều NHẬN không có bất kỳ lần kiểm lại nào** — trần
   duy nhất là hạn access-token (≤900 s). Đọc mục này như thể áp cho cả hai chiều chính là kiểu hiểu
   nhầm mà docblock `gateway:57-71` đã mắc một lần.
7. **Hai hành vi C5/C6 chỉ được ĐO, chưa được phán quyết** ở WO này (owner chốt: đo trước, kết luận
   sau). Tới khi có kết luận, cả hai vẫn là lỗ mở trên master, không phải "đã canh".

---

## 6. Kết quả đo (điền khi thi công xong)

_Chờ A–D + C5 + F-b._

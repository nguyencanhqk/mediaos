# S7-CALL-RT-FIX-1 — vá fail-OPEN `/ws-call`: `disconnect()` trong middleware handshake là no-op

> **Vùng ĐỎ (crown-jewel).** Chạm `src/realtime/**` + đường xác thực ⇒ FULL gate
> (`security-reviewer` + `silent-failure-hunter`), model Opus, người chốt merge.
>
> Nguồn: `harness/backlog.mjs` mục `S7-CALL-RT-FIX-1` · `docs/plans/S7-CALL-QA-1.md` §1e/§5.5 ·
> tripwire `apps/api/src/realtime/call-signalling.gateway.spec.ts:378-412`.
>
> **Phụ thuộc cứng:** `S7-CALL-QA-1` phải land TRƯỚC — tripwire C2 và toàn bộ harness unit
> (`makeSocket`/`runHandshake`/`stateOf`) sống trong commit của QA-1.

---

## 0. Lỗ — đã kiểm chứng lại trên nguồn, không chép từ plan QA-1

Đọc thẳng `node_modules/.pnpm/socket.io@4.8.3/node_modules/socket.io/dist/`, 4 mắt xích:

| # | Vị trí | Sự thật |
| --- | --- | --- |
| 1 | `socket.js:592-594` | `disconnect(close) { if (!this.connected) return this; … }` |
| 2 | `socket.js:90` · `:406-408` | `connected = false` lúc khởi tạo; chỉ `true` trong `_onconnect()` |
| 3 | `namespace.js:221` → `:241`/`:267` | `run(socket, …)` (middleware) chạy **TRƯỚC** `_doConnect` → `_onconnect` |
| 4 | `call-signalling.gateway.ts:260` | `scheduleTokenExpiry` được gọi **TRONG** middleware, trước `next()` |

⇒ `gateway:296 client.disconnect(true)` là **no-op**. Sau khi nó "không làm gì",
`scheduleTokenExpiry` `return`, `handshake()` chạy tiếp `onAny` (263) → `join` (265) →
`return undefined` (266) ⇒ `next(undefined)` = **CHẤP NHẬN kết nối**.

**Trạng thái socket được nhận:** token đã hết hạn, `expiryTimer = null`, đã ở trong
`callUserRoomName(companyId, userId)` của chính mình.

**Hệ quả — chiều NHẬN mở vô thời hạn.** `accept()` (chiều GỬI) vẫn kín: nó kiểm lại `tokenExpSec`
mỗi khung (`gateway:541` bước 2). Nhưng `accept()` **chỉ chạy khi socket GỬI**. Một socket im lặng
tuyệt đối vẫn nhận mọi `sdp-offer`/`sdp-answer`/`ice-candidate` bắn tới người đó — cho mọi cuộc gọi
tương lai, không có đường cắt nào (đúng thứ mà docblock `scheduleTokenExpiry:272-280` dựng ra để
chặn, và bản vá đó tự thủng ở nhánh `ttlMs<=0`). SDP mang **IP nội bộ/công khai** của bên kia +
mốc thời gian từng cuộc gọi.

**Docblock hiện đang NÓI DỐI:** `gateway:295` viết "fail-CLOSED nếu đồng hồ lệch". Thực tế là
fail-OPEN. Đây là lớp lỗi `silent-failure` điển hình — không log, không lỗi, không test nào đỏ.

### 0.1 Cửa sổ chạm — có thật, không phải lý thuyết

`jwt.verify` (`:208`) đã chặn token hết hạn, nên `ttlMs <= 0` ở dòng 293 chỉ xảy ra khi **token hết
hạn GIỮA hai điểm đó**. Giữa chúng có **2 round-trip I/O**:

- `:232` `cooldown.allow(…)` → Valkey
- `:239` `permissions.can(…)` → Valkey/DB

Hai điểm kiểm dùng **CÙNG một ngưỡng** — `jwt.verify` so `Math.floor(now/1000) >= exp`, cổng so
`exp*1000 - now <= 0`, và với `exp` nguyên hai vế **tương đương**. ⇒ cửa sổ đua **đúng bằng thời
gian trôi giữa hai điểm**: hai round-trip I/O trên, chưa kể GC pause. Người cầm token sắp hết hạn
nối lại theo vòng lặp (FE `/ws-call` **được thiết kế để nối lại** — xem docblock `:289-290`) là
trúng cửa sổ này một cách bình thường, không cần kỹ thuật gì.

> ⚠️ **Bản đầu của plan này ghi SAI hai chỗ, sửa sau vòng FULL gate 11/08 — giữ lại để không ai
> khôi phục:** (1) *"`jwt.verify` so `exp` ở độ phân giải GIÂY nên token `exp = now+1s` qua được rồi
> còn ≤1000 ms"* — sai, hai ngưỡng tương đương nên không có 1000 ms nới thêm nào; (2) *"đồng hồ máy
> chủ nhảy **lùi**"* là đường thứ hai — **sai chiều**: `ttlMs = exp*1000 - now`, nhảy lùi làm `ttlMs`
> **TĂNG**, tức đi ra xa nhánh này. Chỉ đồng hồ nhảy **TIẾN** vượt `exp` **giữa** `verify` và cổng
> mới vào được — và đó chính là cùng một cửa sổ ở trên, chỉ khác nguyên nhân (bước nhảy thay vì thời
> gian trôi). Cửa sổ vẫn THẬT; chỉ lý do ghi là sai.

### 0.2 Vì sao KHÔNG có `client.conn.close()` trong bản vá

`done_when` #1 cho hai lựa chọn: `next(Error)` hoặc `client.conn.close()`. Chọn **`next(Error)`**:

1. `conn.close()` cắt **transport**, còn `next(err)` đi qua `_cleanup()` + gửi `CONNECT_ERROR`
   (`namespace.js:230-240`) — client biết mình **bị từ chối**, không phải "mạng lỗi", và không nối
   lại mù.
2. `next(Error)` đặt nhánh này **cùng hình dạng** với 5 nấc từ chối còn lại của `handshake()` — một
   đường ra duy nhất, không có đường thứ hai để ai đó quên.
3. `conn.close()` chạm `client.conn` (API tầng engine.io) từ trong gateway = đúng loại phụ thuộc
   ngầm vào nội bộ thư viện đã đẻ ra chính lỗ này.

---

## 1. Bản vá — 1 file sản xuất, ~12 dòng

### 1.1 `scheduleTokenExpiry` đổi chữ ký: `void` → `Error | undefined`

```ts
/** @returns `Error` = TỪ CHỐI handshake, `undefined` = đã đặt hẹn giờ, cho qua. */
private scheduleTokenExpiry(client: Socket, state: CallSocketState): Error | undefined {
  const ttlMs = state.tokenExpSec * 1000 - Date.now();
  if (ttlMs <= 0) {
    // ⚠️ TUYỆT ĐỐI KHÔNG `client.disconnect()` ở đây: hàm này chạy TRONG middleware handshake,
    // socket chưa `connected` ⇒ `socket.io@4.8.3/dist/socket.js:592-594` trả về ngay = NO-OP,
    // và `handshake()` sẽ chạy tiếp tới `return undefined` = CHẤP NHẬN. Đó chính là lỗ RT-FIX-1.
    // Đường ra DUY NHẤT ở giai đoạn này là trả Error cho `next()`.
    this.logger.warn("/ws-call: token hết hạn trong lúc bắt tay → từ chối (fail-closed)");
    return new Error("unauthorized");
  }
  const timer = setTimeout(…);   // KHÔNG ĐỔI
  timer.unref?.();
  state.expiryTimer = timer;
  return undefined;
}
```

### 1.2 `handshake()` — dời `client.data` xuống SAU cổng cuối

Thứ tự hiện tại (255→260) gán `client.data.state`/`.user` **rồi mới** gọi `scheduleTokenExpiry`.
Giữ nguyên thứ tự đó rồi `return` lỗi sẽ để lại một socket bị-từ-chối **có `state`** — lệch với bất
biến mà 3 ca nhóm B đang ghim (`expect(socket.data.state).toBeUndefined()`). Nên:

```ts
const state: CallSocketState = { …không đổi… };
const expiryError = this.scheduleTokenExpiry(client, state);
if (expiryError) return expiryError;          // ← cổng CUỐI, sau cả 2 round-trip I/O

(client.data as { state?: CallSocketState }).state = state;
(client.data as { user?: CallSocketUser }).user = user;
client.onAny(…);
await client.join(callUserRoomName(user.companyId, user.id));
return undefined;
```

**Vị trí cổng là một phần của bản vá, không phải chi tiết sắp xếp:** nó phải nằm **SAU**
`cooldown.allow` và `permissions.can`. Dời lên trước (ví dụ "kiểm exp sớm cho gọn") sẽ đóng lại
đúng cửa sổ đua §0.1 — tức vá xong mà lỗ vẫn còn. Ghi thành comment tại chỗ.

### 1.3 Sửa docblock đang nói dối

`:295` "fail-CLOSED nếu đồng hồ lệch" → nói đúng cơ chế + vì sao không dùng `disconnect()`.

### 1.4 Thông điệp lỗi: `"unauthorized"`, KHÔNG phải chuỗi mới

Ba nấc token hiện đã trả cùng `"unauthorized"` và ca `B` (`gateway.spec.ts:303-318`) ghim tính
**không-phân-biệt-được** đó có chủ đích. Nấc thứ 4 này cũng là "token của anh không dùng được" ⇒
cùng chuỗi. Một chuỗi riêng (`"token_expired"`) là oracle miễn phí: nó nói cho người dò cửa biết
token **đúng chữ ký** và **chỉ vừa hết hạn**.

⇒ **Thêm nấc này vào chính ca B** (danh sách 3 → 4) để tính chất được ghim, không chỉ được nói.

---

## 2. Test — RED trước, và ca C2 phải LẬT (không được xoá)

Tất cả ở `apps/api/src/realtime/call-signalling.gateway.spec.ts` (unit). **Không cần chạm
int-spec** — lý do ở §2.4.

### 2.1 C2 — LẬT tripwire thành hành vi đúng *(done_when #2)*

Ca `TRIPWIRE S7-CALL-RT-FIX-1` (`:378-412`) hiện khẳng định hành vi SAI. Đổi tên + đảo assert,
**giữ nguyên docblock 4 mắt xích** (đó là hồ sơ vì sao ca này tồn tại) và **giữ `connected: false`**:

| Assert | Trước (lỗ) | Sau (vá) |
| --- | --- | --- |
| `nextArg` | `toBeUndefined()` | `toBeInstanceOf(Error)` + `.message === "unauthorized"` |
| `socket.data.state` | (state có, `expiryTimer` null) | `toBeUndefined()` |
| `socket.join` | `toHaveBeenCalledWith(room)` | `not.toHaveBeenCalled()` |
| `socket.severed` | `toBe(false)` | **`toBe(false)` — GIỮ NGUYÊN** |

Dòng cuối là dòng đắt nhất và dễ bị xoá nhất: nó chứng minh bản vá **không dựa vào `disconnect()`**.
Nếu ai đó sau này "sửa lại cho gọn" bằng `client.disconnect(true)` + `return new Error(…)`, ca vẫn
xanh — nên phải nói rõ trong comment rằng `severed === false` là **yêu cầu**, không phải tác dụng phụ.

### 2.2 C2b — cửa sổ ĐUA: `exp` rơi giữa `verify` và cổng cuối *(done_when #3)*

Đây là ca chứng minh **vị trí** cổng, thứ mà C2 không nói được (C2 hết hạn từ trước cả `verify`).

```ts
const t0 = Date.now();
const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0);
// Token CÒN HẠN lúc verify (exp = t0 + 1s) ⇒ jwt.verify cho qua thật.
deps.tokens.verifyAccessToken.mockReturnValue(claims(Math.floor(t0 / 1000) + 1));
// …rồi 2 round-trip I/O nuốt mất 2 s. Đây là §0.1 dựng lại một cách TẤT ĐỊNH.
deps.permissions.can.mockImplementation(async () => {
  nowSpy.mockReturnValue(t0 + 2_000);
  return { allow: true };
});

const err = await runHandshake(gw, makeSocket({ token: "t", connected: false }));

expect((err as Error).message).toBe("unauthorized");
expect(deps.permissions.can, "cổng phải nằm SAU I/O — không có lời gọi này thì ca rỗng").toHaveBeenCalled();
expect(socket.data.state).toBeUndefined();
```

**Vì sao `vi.spyOn(Date,"now")` chứ không `vi.useFakeTimers()`:** memory
`fake-timers-break-socketio-client-emit` — nhưng lý do ở đây khác và phải nói đúng: ca này KHÔNG có
`socket.io-client` (socket giả), nên bẫy đó không áp. Cái áp là `runHandshake` dùng `setTimeout`
2000 ms làm chốt chống-treo; `useFakeTimers` sẽ đóng băng chính chốt đó. `Date.now` giả không đụng
tới hàng đợi timer ⇒ chốt vẫn thật.

**Bẫy phải tránh:** `newFrameBudget(Date.now())` (`:251`) cũng đọc `Date.now` đã giả — vô hại (chỉ
là mốc bắt đầu cửa sổ), nhưng ghi ra để lần sau không ai truy ngược nhầm.

⚠️ `vi.restoreAllMocks()` ở `afterEach` gỡ spy. Mọi `mock.calls` phải đọc **TRƯỚC** restore —
memory `mockrestore-wipes-mock-calls`.

### 2.3 C2c — ĐỐI CHỨNG ALLOW *(done_when #4)*

Cặp-tối-thiểu của C2b: **đúng một bit khác** — `permissions.can` KHÔNG đẩy đồng hồ.

```ts
expect(err).toBeUndefined();
expect(stateOf(socket).expiryTimer).not.toBeNull();
expect(socket.join).toHaveBeenCalledWith(callUserRoomName(CO, USER));
```

Không có ca này thì C2b xanh kể cả khi bản vá từ chối **mọi** handshake — đúng lớp lỗi
`deny-cases-vacuous-without-allow-case`. (Ca `C` `:366-376` đã gần giống, nhưng nó không chạy dưới
`Date.now` giả ⇒ không phải đối chứng của C2b.)

### 2.4 Vì sao KHÔNG thêm ca int-spec

`paths` của WO có `chat-s7-call-rt1-signalling.int-spec.ts`, nhưng lỗ này **không dựng được ở int**:
để `ttlMs <= 0` ở int phải hoặc (a) ký token đã hết hạn — `jwt.verify` chặn từ dòng 208, không tới
được 293; hoặc (b) dịch đồng hồ — mà `socket.io-client` sẽ tự chết `"ping timeout"` trước khi khung
rời máy (bài học §6.3(1) của QA-1). ⇒ int-spec **không đổi**. Ghi ra đây để reviewer không đọc
"thiếu int-spec" thành thiếu sót.

### 2.5 Chứng minh RED trước GREEN

Ba mốc phải ghi vào `docs/QA/evidence/S7-CALL-RT-FIX-1.md`:

1. **Trước vá:** C2b + C2c mới, chạy trên gateway CHƯA sửa ⇒ **C2b ĐỎ** (nhận `undefined` thay vì
   `Error`), C2c XANH. C2 cũ (tripwire) XANH.
2. **Sau vá:** C2 (đã lật) · C2b · C2c XANH; ca `B` 4 nấc XANH; toàn bộ 22+ ca file XANH.
3. **Mutation check:** đổi `ttlMs <= 0` → `ttlMs < -3_600_000` ⇒ C2 + C2b phải ĐỎ. Không đỏ = ca rỗng.

---

## 3. Coverage — ratchet đã cắn, phải chạy lại

QA-1 đặt ngưỡng per-file trong `apps/api/vitest.config.ts` (gateway branch ≥ mốc đã đạt). Bản vá
thêm một nhánh `return` ⇒ **phải** chạy lại:

```bash
bash scripts/lane-db-setup.sh s7callrtfix1 --reset
source scripts/lib/db-secrets.sh && db_secrets_load
export LANE_DB=mediaos_s7callrtfix1
pnpm --filter @mediaos/api test:cov:call
```

Ngưỡng KHÔNG được hạ. Nếu branch tụt dưới mốc QA-1 ⇒ thiếu ca, không phải ngưỡng sai.

---

## 4. Ratchet & bất biến phải không bị phá

| Ràng buộc | Nguồn | Bản vá có chạm? |
| --- | --- | --- |
| Gateway có ĐÚNG MỘT bind và phải là `onAny(` | `chat-realtime-structure.spec.ts:20,48` | ❌ không thêm `client.on(` / `socket.use(` |
| `afterInit` đăng ký ĐÚNG MỘT middleware | `gateway.spec.ts:94-103` | ❌ |
| Thông điệp từ chối không phân biệt được | `gateway.spec.ts:303-318` | ✅ **mở rộng** 3→4 nấc |
| `emitter.setServer` không bao giờ bị gọi | `gateway.spec.ts:81-92` | ❌ |
| Bị từ chối ⇒ không `state`, không `join` | 3 ca nhóm B | ✅ nhánh mới tuân thủ |
| Route census / OpenAPI | — | ❌ không thêm route |
| Migration | — | ❌ không có |

---

## 5. Ngoài phạm vi — ghi để không ai đọc nhầm là đã kín

1. **`S7-CALL-RT-FIX-2`** (gỡ thành viên giữa cuộc gọi) — WO riêng, tripwire C5 vẫn ở int-spec.
2. **C6 — khoá tài khoản không chặn phiên `/ws-call` MỚI** (≤900 s). Hành vi ĐƯỢC BIẾT, owner đã
   phán quyết 11/08 là không mở WO (QA-1 §6.5). Bản vá này **không** đụng tới nó: nó nói về token
   **hết hạn**, không nói về token **còn hạn của người bị khoá**.
3. **Chiều NHẬN vẫn không tái kiểm quyền** sau khi đã nối (QA-1 §5.6): trần duy nhất là hạn token
   (≤900 s). RT-FIX-1 làm cho trần đó **có hiệu lực thật** ở nhánh biên — nó không rút ngắn trần.

---

## 6. Sổ Known-Issue

Lỗ này **sống trên master** từ lúc QA-1 merge tới lúc RT-FIX-1 merge ⇒ phải có số hiệu, theo đúng
luật đã áp cho KI-057/KI-059/KI-060 ("không có số hiệu thì vô hình với bug-scrub trước RC").

⇒ Thêm **KI-061** vào `docs/RELEASE/RELEASE-02_Known_Issues_MVP.md`, **mở và đóng trong cùng mục**
(khuôn KI-059): mô tả gốc + 4 mắt xích + bản vá + số đo RED/GREEN.

⚠️ `RELEASE-02` là **tệp xung đột đa-PR duy nhất** (memory `release02-is-the-single-multipr-conflict-file`)
⇒ sửa **cuối cùng**, ngay trước khi mở PR; kiểm `gh pr list` xem PR nào khác đang chạm nó.
⚠️ `paths` của WO trong `harness/backlog.mjs` **chưa có** tệp này + tệp evidence ⇒ phải mở rộng
`paths` trong cùng PR, nếu không `guard-scope` kêu (memory `wo-paths-drive-gate-and-scheduler`).

---

## 7. Thứ tự thi công

1. Mở rộng `paths` trong `harness/backlog.mjs` (+`docs/QA/evidence/**`, +`docs/RELEASE/RELEASE-02_*`).
2. Viết C2b + C2c → chạy → **C2b phải ĐỎ** (ghi bằng chứng).
3. Vá `scheduleTokenExpiry` + `handshake` + docblock.
4. Lật C2; mở rộng ca `B` lên 4 nấc.
5. Mutation check (§2.5.3).
6. `pnpm --filter @mediaos/api test:cov:call` trên lane cô lập.
7. `bash harness/check.sh --lane-db=s7callrtfix1`.
8. FULL gate: `security-reviewer` + `silent-failure-hunter`.
9. Evidence + KI-061 → PR → **người chốt merge** (vùng đỏ, KHÔNG auto-merge).

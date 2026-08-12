# S7-CALL-RT-FIX-1 — bằng chứng RED → GREEN

Vá fail-OPEN `/ws-call`: `disconnect()` trong middleware handshake là **no-op** ⇒ token hết hạn
ngay lúc bắt tay vẫn ĐƯỢC NHẬN và nhận relay SDP/ICE vô thời hạn. Kế hoạch:
`docs/plans/S7-CALL-RT-FIX-1.md`. Sổ KI: **KI-061**.

Đo 11/08/2026 trên DB cô lập `mediaos_s7callrtfix1` (chain `0000→latest` áp sạch).

---

## 1. Lỗ — kiểm chứng lại trên nguồn, không chép từ plan QA-1

Đọc thẳng `node_modules/.pnpm/socket.io@4.8.3/node_modules/socket.io/dist/`:

| # | Vị trí | Sự thật |
| --- | --- | --- |
| 1 | `socket.js:592-594` | `disconnect(close) { if (!this.connected) return this; … }` |
| 2 | `socket.js:90` · `:406-408` | `connected = false` lúc khởi tạo; chỉ `true` trong `_onconnect()` |
| 3 | `namespace.js:221` → `:241`/`:267` | `run(socket, …)` (middleware) chạy **TRƯỚC** `_doConnect` → `_onconnect` |
| 4 | `call-signalling.gateway.ts` | `scheduleTokenExpiry` được gọi **TRONG** middleware, trước `next()` |

⇒ `client.disconnect(true)` ở nhánh `ttlMs <= 0` không cắt gì; `handshake()` chạy tiếp `onAny` →
`join` → `return undefined` ⇒ **CHẤP NHẬN** socket có token đã hết hạn, `expiryTimer = null`, đã ở
trong `callUserRoomName` của chính mình.

Chiều **GỬI** vẫn kín (`accept()` kiểm lại `tokenExpSec` mỗi khung). Chiều **NHẬN** thì mở vô thời
hạn — mà `accept()` chỉ chạy khi socket GỬI. SDP mang IP nội bộ/công khai của bên kia + mốc thời
gian từng cuộc gọi.

Docblock cũ ghi *"fail-CLOSED nếu đồng hồ lệch"* và làm **đúng ngược lại** — lớp lỗi
`silent-failure`: không log, không lỗi, không test nào đỏ.

## 2. Cửa sổ chạm — có thật

`jwt.verify` đã chặn token hết hạn, nên `ttlMs <= 0` chỉ xảy ra khi token hết hạn **giữa** `verify`
và cổng. Giữa hai điểm đó có **2 round-trip I/O**: `cooldown.allow` → Valkey, `permissions.can` →
Valkey/DB. Hai điểm kiểm dùng **CÙNG ngưỡng** (`Math.floor(now/1000) >= exp` ⟺ `now >= exp*1000` với
`exp` nguyên) ⇒ cửa sổ đua **đúng bằng thời gian trôi giữa chúng**, chưa kể GC pause. FE `/ws-call`
**được thiết kế để nối lại** ⇒ người cầm token sắp hết hạn trúng cửa sổ này một cách bình thường.
Đồng hồ máy chủ nhảy **TIẾN** vượt `exp` đúng trong khoảng đó là cùng cửa sổ, khác nguyên nhân.

> ⚠️ **Hai khẳng định SAI ở bản đầu, sửa sau vòng FULL gate 11/08** (`security-reviewer`) — ghi lại
> để không ai khôi phục: (1) *"độ phân giải GIÂY ⇒ còn ≤1000 ms"* — sai, hai ngưỡng tương đương nên
> không có 1000 ms nới thêm; (2) *"đồng hồ nhảy **lùi**"* — **sai chiều**: `ttlMs = exp*1000 - now`,
> nhảy lùi làm `ttlMs` TĂNG, đi ra xa nhánh này. Cửa sổ vẫn THẬT và bản vá không đổi — chỉ lý do ghi
> là sai.

---

## 3. RED — trước khi vá

`pnpm --filter @mediaos/api exec vitest run src/realtime/call-signalling.gateway.spec.ts -t "C2"`
trên gateway **CHƯA sửa**:

```
× C2b — `exp` rơi GIỮA `verify` và cổng cuối (cửa sổ đua 2 round-trip I/O) ⇒ TỪ CHỐI
  → token hết hạn giữa chừng ⇒ phải TỪ CHỐI, không được nhận:
    expected undefined to be an instance of Error
✓ C2c — ĐỐI CHỨNG: cùng cửa sổ đó, chỉ khác `can()` KHÔNG đẩy đồng hồ ⇒ nối được

Tests  1 failed | 1 passed | 22 skipped (24)
```

Đỏ **đúng lý do** — `next()` nhận `undefined` = handshake được chấp nhận. Đối chứng C2c xanh ⇒ ca
không đỏ vì dàn dựng hỏng.

## 4. Bản vá

`apps/api/src/realtime/call-signalling.gateway.ts` — 1 file sản xuất:

1. `scheduleTokenExpiry` đổi chữ ký `void` → **`Error | undefined`**; nhánh `ttlMs <= 0` trả
   `new Error("unauthorized")` thay cho `client.disconnect(true)`.
2. `handshake()` gọi nó làm **cổng CUỐI** rồi `return expiryError` — và chỉ gán
   `client.data.state`/`.user` **SAU** cổng ⇒ bị từ chối thì không dựng phiên, không `join`, cùng
   bất biến với 3 nấc từ chối token còn lại.
3. Docblock viết lại: 4 mắt xích + vì sao **không** dùng `disconnect()` / `conn.close()`.

**Vị trí cổng là một phần của bản vá.** Nó phải nằm SAU cả hai round-trip I/O; dời lên ngay sau
`verify` "cho gọn" = đóng lại đúng cửa sổ đua §2 ⇒ vá xong mà lỗ vẫn còn. Ghim bởi ca C2b (assert
`expect(deps.permissions.can).toHaveBeenCalled()`).

**Thông điệp `"unauthorized"`, không phải chuỗi mới.** Một chuỗi riêng (`"token_expired"`) là oracle
miễn phí: nó nói cho người dò cửa biết token **đúng chữ ký** và **chỉ vừa hết hạn**. Nấc thứ 4 này
đã được thêm vào ca `B` (3 → 4 nấc) để tính chất được **ghim**, không chỉ được nói.

## 5. GREEN — sau khi vá

```
✓ src/realtime/call-signalling.gateway.spec.ts (24 tests)
✓ src/realtime/call-signalling.filter.spec.ts   (6 tests)
✓ src/realtime/chat-realtime-structure.spec.ts  (11 tests)   ← ratchet cấu trúc
Tests  41 passed (41)
```

## 6. Mutation check — ca có CẮN thật

Đổi `ttlMs <= 0` → `ttlMs < -3_600_000` (nới cổng ra 1 giờ):

```
× C2  — `ttlMs<=0` lúc bắt tay ⇒ TỪ CHỐI `unauthorized`…
       → expected undefined to be an instance of Error
× C2b — `exp` rơi GIỮA `verify` và cổng cuối…
       → expected undefined to be an instance of Error
✓ C2c — ĐỐI CHỨNG (không bị ảnh hưởng — đúng kỳ vọng)
```

Cả hai ca đỏ ⇒ không rỗng. C2c vẫn xanh ⇒ mutation không phá dàn dựng chung. Đã trả lại `<= 0`.

## 7. Coverage — ratchet không bị hạ

`pnpm --filter @mediaos/api test:cov:call`, `LANE_DB=mediaos_s7callrtfix1`. **133/133 pass · 7 tệp**
(QA-1 để lại 131; +2 là C2b/C2c).

| File | % Stmts | % Branch | % Funcs | % Lines |
| --- | --- | --- | --- | --- |
| `call-signalling.gateway.ts` | 100 | 92.74 → **92.85** | 100 | **100** |
| `call-signalling.filter.ts` | 100 | 100 | 100 | 100 |
| `realtime/` (3 tệp) | 100 | 93.47 → **93.57** | 100 | 100 |
| **Toàn cụm CALL/API** | 99.13 → **99.14** | 94.31 → **94.35** | 100 | **99.14** |

Ngưỡng per-file của QA-1 (`vitest.config.ts`) **không hạ một điểm nào** — bản vá thêm nhánh mà
branch vẫn nhích lên vì nhánh mới có cả ca ALLOW lẫn ca DENY.

## 8. Ca đã thêm / đổi — 3

| Ca | Loại | Nội dung |
| --- | --- | --- |
| **C2** | LẬT | Tripwire của QA-1 → hành vi đúng. `nextArg` `undefined` → `Error("unauthorized")`; `state` → `undefined`; `join` → `not.toHaveBeenCalled()`. **`severed === false` GIỮ NGUYÊN** |
| **C2b** | MỚI | Cửa sổ đua: `exp` rơi giữa `verify` và cổng ⇒ TỪ CHỐI. Đo **vị trí** cổng, không đo sự tồn tại |
| **C2c** | MỚI | Đối chứng ALLOW của C2b — khác đúng một bit (`can()` không đẩy đồng hồ) |
| `B` | MỞ RỘNG | 3 → 4 nấc cùng trả `"unauthorized"` |

**`severed === false` ở C2 là YÊU CẦU, không phải tác dụng phụ.** Nó là thứ duy nhất chặn một bản
"sửa cho gọn" quay lại dùng `client.disconnect(true)` — cách đó vẫn no-op ở giai đoạn middleware, và
mọi assert còn lại của ca vẫn xanh.

**`vi.spyOn(Date,"now")` chứ không `vi.useFakeTimers()`:** `runHandshake` dùng `setTimeout` 2000 ms
làm chốt chống-treo; đóng băng hàng đợi timer là đóng băng luôn chốt đó. (Bẫy
`fake-timers-break-socketio-client-emit` **không** áp ở đây — ca này không có `socket.io-client`.)

## 9. Vì sao KHÔNG có ca int-spec

Lỗ này **không dựng được ở int**: (a) ký token đã hết hạn thì `jwt.verify` chặn từ đầu, không tới
được cổng; (b) dịch đồng hồ thì `socket.io-client` tự chết `"ping timeout"` trước khi khung rời máy
(bài học QA-1 §6.3(1)). ⇒ `chat-s7-call-rt1-signalling.int-spec.ts` **không đổi**. Ghi ra để reviewer
không đọc "thiếu int-spec" thành thiếu sót.

## 10. Ngoài phạm vi — vẫn còn mở

1. **`S7-CALL-RT-FIX-2`** — gỡ thành viên giữa cuộc gọi: vẫn relay TỚI họ + ghi
   `user_security_events` + NGẮT họ vì trickle ICE. Tripwire C5 vẫn ở int-spec.
2. **C6** — khoá tài khoản không chặn phiên `/ws-call` MỚI (≤900 s). Owner đã phán quyết 11/08 là
   hành vi ĐƯỢC BIẾT (QA-1 §6.5). Bản vá này nói về token **hết hạn**, không nói về token **còn hạn
   của người bị khoá**.
3. **Chiều NHẬN vẫn không tái kiểm quyền** sau khi đã nối: trần duy nhất là hạn token (≤900 s).
   RT-FIX-1 làm cho trần đó **có hiệu lực thật** ở nhánh biên — nó không rút ngắn trần.

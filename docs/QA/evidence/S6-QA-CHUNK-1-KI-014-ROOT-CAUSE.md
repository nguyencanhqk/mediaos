# KI-014 — TRUY GỐC crash chạy test local + số đo ma trận cấu hình

> WO `S6-QA-CHUNK-1` · zone yellow · gate LIGHT
> Đo ngày **2026-07-27** trên `master` `6c028899`.
> Máy: **Windows 11 Pro 10.0.26200 · x64 · 32 nhân · 68,5 GB RAM (38,4 GB trống) · Node v24.15.0 · pnpm 11.5.1**
> Bộ test: vitest **3.2.6** · tinypool **1.1.1** · turbo **2.9.16**

Tài liệu này là **bằng chứng bắt buộc** cho `done_when[0]`: _"kết luận 'không sửa được gốc' phải có
bằng chứng, không phải phỏng đoán"_.

---

## 0. Kết luận trước (chi tiết bên dưới)

| Câu hỏi                                              | Trả lời                                                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Có phải "máy bất ổn ngẫu nhiên" như mô tả cũ không?  | **KHÔNG.** `pnpm test` đỏ **5/5 lần** — tái hiện 100%, không phải flake                       |
| Có phải do một spec bẩn không?                       | **KHÔNG.** Package nạn nhân đổi ngẫu nhiên giữa các lần chạy (console · api · app · web-core) |
| Có phải do turbo chạy nhiều package song song không? | **KHÔNG.** `turbo --concurrency=1` vẫn đỏ 3/3                                                 |
| Có phải lệch Node local (24) vs CI (22) không?       | **KHÔNG.** Node 22.23.1 vẫn crash (2/3 api · 3/3 app)                                         |
| Gốc thật là gì?                                      | **Bug ngược dòng `tinypool@1.1.1`** — `ProcessWorker.send()` không kiểm tra kênh IPC đã đóng  |
| Vá được trong phạm vi WO không?                      | **KHÔNG** — xem §5. Nên chuyển sang runner chia chunk (`done_when[1]`)                        |

---

## 1. Triệu chứng & cách tái hiện

```text
⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
Error: Channel closed
 ❯ target.send node:internal/child_process:777:16
 ❯ ProcessWorker.send tinypool@1.1.1/dist/index.js:140:41
 ❯ MessagePort.<anonymous> tinypool@1.1.1/dist/index.js:149:62
 ❯ [nodejs.internal.kHybridDispatch] node:internal/event_target:843:20
Serialized Error: { code: 'ERR_IPC_CHANNEL_CLOSED' }
```

**Số lần test ĐỎ trong mọi lần crash: 0.** Suite chết giữa chừng, thường trước khi kịp in dòng
tổng kết.

### 1.1 Tier `pnpm test` (đúng cái `check.sh` gọi) — 5/5 ĐỎ

| Lần | exit | thời lượng | chữ ký | **package chết**    |
| --- | ---- | ---------- | ------ | ------------------- |
| r1  | 1    | 27s        | IPC    | `@mediaos/console`  |
| r2  | 1    | 53s        | IPC    | `@mediaos/api`      |
| r3  | 1    | 23s        | IPC    | `@mediaos/app`      |
| r4  | 1    | 27s        | IPC    | `@mediaos/api`      |
| r5  | 1    | 9s         | IPC    | `@mediaos/web-core` |

> **Đính chính mô tả cũ của KI-014.** Sổ known-issue ghi đây là bất ổn ngẫu nhiên của máy
> ("liên quan nghi RAM/XMP"). Số đo bác bỏ: tái hiện **100%**, và **package nạn nhân đổi mỗi lần** —
> kể cả `@mediaos/console` (23 file) và `@mediaos/web-core` (39 file) là suite rất nhỏ. Vậy không
> phải "file thủ phạm", cũng không phải "suite quá lớn".

---

## 2. Ma trận cấu hình (mỗi ô 3 lần chạy)

### 2.1 Tầng gọi

| Cấu hình                                                 | Kết quả                                                  | Ghi chú                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm test` (turbo, song song mặc định)                  | **0 pass / 5 fail**                                      | §1.1                                                                                    |
| `turbo run test --concurrency=1` (nối tiếp từng package) | **0 pass / 3 fail**                                      | Loại bỏ giả thuyết "áp lực tổng hợp giữa các package" — nạn nhân luôn là `@mediaos/app` |
| `npx vitest run` từng package riêng lẻ, không turbo      | app **ĐỎ** · console/web-core/contracts/auth/ui **xanh** | Crash không cần turbo                                                                   |

### 2.2 Trần worker (`poolOptions.forks.maxForks`) — mặc định là `availableParallelism()-1` = **31**

**`@mediaos/app`** (199 file, jsdom):

| maxForks      | pass/fail | thời lượng TB |
| ------------- | --------- | ------------- |
| 31 (mặc định) | **1 / 2** | 16s           |
| 16            | **3 / 0** | 23s           |
| 8             | **3 / 0** | 35s           |
| 4             | **3 / 0** | 61s           |

**`@mediaos/api`** (448 file, NestJS+SWC):

| maxForks      | pass/fail | thời lượng TB |
| ------------- | --------- | ------------- |
| 31 (mặc định) | **0 / 3** | 10s           |
| 16            | **1 / 2** | 27s           |
| 8             | **2 / 1** | 47s           |
| 4             | **1 / 2** | 47s           |

> Hạ trần worker **giúp nhưng KHÔNG khỏi hẳn** — `api` không có trần nào xanh ổn định. Chú ý mọi
> lần đỏ của `api` đều chết **rất sớm** (10–19s) trong khi lần xanh chạy 57–109s: đây là đua lúc
> tạo/huỷ worker, không phải cạn tài nguyên tích luỹ.

### 2.3 Đổi pool / tắt isolate (`@mediaos/api`)

| Cấu hình         | pass/fail | Ghi chú                                                                           |
| ---------------- | --------- | --------------------------------------------------------------------------------- |
| `--pool=threads` | **1 / 2** | exit **139 (SIGSEGV)** và exit 127 — **TỆ HƠN** forks                             |
| `--no-isolate`   | **0 / 3** | Sinh **test đỏ THẬT** (suite phụ thuộc cô lập module) + vẫn IPC ⇒ không dùng được |

### 2.4 A/B runtime — Node 24.15.0 (máy này) vs Node 22.23.1 (**đúng bản CI dùng**)

CI khai `node-version: 22` ở cả 4 workflow. Tải Node **v22.23.1** win-x64 chạy cùng vitest 3.2.6:

| Gói            | Node 22.23.1              | Node 24.15.0          |
| -------------- | ------------------------- | --------------------- |
| `@mediaos/api` | **1 pass / 2 fail** (IPC) | 0 pass / 3 fail (IPC) |
| `@mediaos/app` | **0 pass / 3 fail** (IPC) | 1 pass / 2 fail (IPC) |

> **Kết luận quan trọng:** crash **KHÔNG** phải do lệch Node 24 vs 22. Vậy CI xanh **không** nhờ
> Node 22 — mà nhờ runner CI chỉ có 2–4 nhân ⇒ vitest chỉ sinh 1–3 worker ⇒ gần như không bao giờ
> trúng đua. Máy 32 nhân này sinh 31 worker/package nên trúng liên tục.

---

## 3. Vì sao luật "chạy lại chunk crash" là AN TOÀN

Quét **toàn bộ** log của mọi cấu hình ở trên:

| Số log có chữ ký crash IPC/SEGV | Số log trong đó có **test đỏ thật** |
| ------------------------------- | ----------------------------------- |
| **27**                          | **0**                               |

Không một lần nào crash hạ tầng đi kèm test đỏ. Vì vậy runner được phép chạy lại **chỉ khi**
`exit != 0` **VÀ** `số test đỏ == 0` **VÀ** (có chữ ký crash **HOẶC** không ghi nổi báo cáo JSON).
Có bất kỳ test đỏ nào ⇒ **cấm chạy lại**, báo đỏ ngay.

> Có một chế độ chết thứ hai cần bắt: tiến trình **biến mất không kịp in gì** (log cụt, toàn ✓,
> không có dòng tổng kết) — quan sát ở `N22-api-default-r1`. Đây là họ ACCESS_VIOLATION
> (`0xC0000005` = exit `3221225477`) mà `RELEASE-06` §4.4 đã ghi. Runner coi "không có báo cáo JSON"
> là crash, nên bắt được cả chế độ này.

---

## 4. Gốc rễ (đọc mã ngược dòng)

`tinypool@1.1.1/dist/index.js`:

```js
setChannel(channel) {
  this.channel = channel;
  this.channel.onMessage?.((message) => { this.send(message); });   // :136
}
send(message) {
  if (!this.isTerminating) this.process.send(message);              // :140  ◀ CHỈ chặn isTerminating
}
postMessage(message, transferListItem) {
  if (this.port) this.port.on("message", (m) => this.send({ ... })); // :149  ◀ khung trong stack
  ...
}
```

`send()` chỉ hỏi cờ **`isTerminating`** (do chính pool đặt khi nó CHỦ ĐỘNG huỷ worker). Nó **không**
hỏi kênh IPC còn sống hay không. Khi một worker fork thoát **ngoài dự kiến** — pool chưa đặt
`isTerminating` — mà MessagePort của birpc vẫn còn message trong hàng đợi, thì `this.process.send()`
được gọi trên tiến trình đã đóng kênh ⇒ ném `ERR_IPC_CHANNEL_CLOSED`. Lỗi này nổ ở **tiến trình
chính** của vitest, ngoài mọi try/catch của test ⇒ vitest tính là _Unhandled Rejection_ ⇒ cả run ĐỎ
dù **không test nào sai**.

Đây là lý do triệu chứng trông "ngẫu nhiên": nó là **đua thời điểm**, tỉ lệ trúng tăng theo số vòng
tạo/huỷ worker trong một tiến trình (nhiều file × nhiều worker × `isolate: true` mặc định).

---

## 5. Vì sao KHÔNG vá được tận gốc trong phạm vi WO này

| Đường vá                                 | Vì sao không dùng                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nâng `tinypool`                          | **1.1.1 là bản CUỐI của nhánh 1.x** (`npm view tinypool versions`). Bản sau là **2.0.0/2.1.0** — major khác API, mà `vitest@3.2.6` ghim `"tinypool": "^1.1.1"` ⇒ override sang 2.x làm vỡ vitest |
| Nâng `vitest` 3.2.6 → 4.x                | Di trú **toàn workspace 7 package**, đổi API reporter/config, đụng mọi spec. Ngoài phạm vi `paths` của WO (WO này **không** mở `apps/*/src/**`), và là thay đổi toolchain lớn ngay trước RC      |
| Đổi `pool` sang `threads`                | Đo được **TỆ HƠN** — SIGSEGV (§2.3)                                                                                                                                                              |
| `--no-isolate`                           | Sinh test đỏ thật (§2.3)                                                                                                                                                                         |
| Hạ `maxForks`                            | Giúp `app` (3/3 xanh ở 16) nhưng **không cứu `api`** ở bất kỳ trần nào (§2.2)                                                                                                                    |
| `dangerouslyIgnoreUnhandledErrors: true` | **TỪ CHỐI** — nuốt luôn unhandled rejection THẬT của code sản phẩm. Đây đúng là "vá triệu chứng" mà `done_when[0]` cấm                                                                           |
| Ép Node 22 cho khớp CI                   | Không có tác dụng (§2.4)                                                                                                                                                                         |

⇒ Kích hoạt nhánh dự phòng đã được `done_when[1]` cho phép: **runner chia chunk**.

---

## 6. Cách vá đã chọn — `harness/chunk-test.mjs`

Giảm **xác suất trúng đua** bằng ba lớp, và không lớp nào được phép làm co phạm vi test:

1. **Chia chunk** — mỗi tiến trình vitest chỉ nhận ≤ `--chunk-size` file (mặc định **40**) ⇒ ít vòng
   tạo/huỷ worker hơn hẳn.
2. **Hạ trần worker** — `--max-forks` mặc định **8** (thay vì 31).
3. **Chạy lại chunk chết vì HẠ TẦNG** — tối đa `--retries` (mặc định 2), theo luật phân loại ở §3.
   Test đỏ thật **không bao giờ** được chạy lại.

**Chống giảm phạm vi lén (`done_when[2]`):**

- Danh sách file lấy từ chính `vitest list --filesOnly` của từng package (không hard-code thư mục).
- Cuối mỗi package, đối chiếu tập file **đã chạy thật** (đọc từ reporter JSON) với tập mong đợi —
  **thiếu file ⇒ ĐỎ**, in ra tên file thiếu.
- File trông như spec nhưng vitest không thu thập được **CÔNG BỐ** tường minh (không biến mất khỏi
  mọi reporter). Với `@mediaos/api` in ra đúng **6 file** `exclude` ở `apps/api/vitest.config.ts:57-67`.
- Runner vẫn cho dòng tổng kết của vitest chảy ra stdout ⇒ `harness/lane-db-guard.mjs` đọc được như cũ.
- Runner tự chạy `turbo run build --filter=./packages/*` thay cho `dependsOn: ["^build"]` của turbo
  (gọi vitest thẳng sẽ bỏ bước này ⇒ dist cũ gây đỏ-giả).

`check.sh` chỉ dùng runner **trên Windows**; nền tảng khác + CI ubuntu **giữ nguyên** `pnpm test`
một lần (`CHUNK_RUNNER=1|0` để ép tay).

---

## 7. Số đo sau khi vá

### 7.1 Phủ file — đối chiếu với `vitest list`

| Package              | File chạy / mong đợi |
| -------------------- | -------------------- |
| `@mediaos/api`       | **448 / 448**        |
| `@mediaos/app`       | **199 / 199**        |
| `@mediaos/auth`      | 4 / 4                |
| `@mediaos/console`   | 23 / 23              |
| `@mediaos/contracts` | 32 / 32              |
| `@mediaos/ui`        | 16 / 16              |
| `@mediaos/web-core`  | 39 / 39              |
| **Tổng**             | **761 / 761**        |

6 file `@mediaos/api` không được thu thập (công bố trong output, đúng danh sách `exclude` của config):
`test/workflow-lifecycle.e2e-spec.ts` · `finance-cost-controller-deny` ·
`finance-cost-allocation-controller-deny` · `finance-revenue-controller-deny` · `webhooks-deny` ·
`ui-config-deny`.

> Lưu ý drift: `RELEASE-06` §2 ghi 444 file api / 777 file toàn workspace (đo 2026-07-26). Nay là
> **448 / 761**. Số này giờ **sinh từ `vitest list`** mỗi lần chạy nên không thể trôi âm thầm nữa.

### 7.2 Cổng đóng WO — `bash harness/check.sh --all` **có** `LANE_DB`

```text
LANE_DB=mediaos_qachunk  bash harness/check.sh --all        → exit 0, 4m32s
  ✅ lint
  ✅ typecheck
  ✅ test (LANE_DB=mediaos_qachunk) [chunked]
  ✅ build
═════════════ XANH ✅ ════════════════
```

Đây là **lần đầu `check.sh` xanh thật trên máy Windows này** kể từ khi KI-014 được ghi nhận.

### 7.3 Độ ổn định — 3 lần chạy đầy đủ liên tiếp (có `LANE_DB`)

| Lần  | exit  | thời lượng | số lần chạy lại (cộng dồn mọi chunk) |
| ---- | ----- | ---------- | ------------------------------------ |
| rep1 | **0** | 222s       | 1                                    |
| rep2 | **0** | 217s       | 0                                    |
| rep3 | **0** | 247s       | **3**                                |

> **Đọc thẳng con số rep3:** crash hạ tầng vẫn xảy ra thường xuyên — runner **không** khử được nó,
> chỉ hấp thụ. Ngân sách hiện tại là `--retries=2` **cho mỗi chunk** (không phải cho cả run), nên
> rep3 dùng 3 lượt ở các chunk khác nhau mà không chunk nào cạn ngân sách. Nếu về sau thấy
> `❌ … vẫn crash hạ tầng sau 2 lần chạy lại`, cách xử lý đúng là **hạ `--chunk-size`** (ít vòng
> tạo/huỷ worker hơn mỗi tiến trình) chứ không phải nâng `--retries` vô hạn.

### 7.4 Chứng minh runner KHÔNG che test đỏ thật

Gieo một spec đỏ cố ý (`apps/auth/src/__ki014-tmp-redproof.spec.ts`, đã xoá sau khi đo):

```text
❌ @mediaos/auth: 5/5 file chạy · 1 ĐỎ THẬT
═════════ ĐỎ ❌ ═════════            exit 1, 0 lần chạy lại
```

Đúng như thiết kế: đỏ thật ⇒ **không** chạy lại, thoát 1 ngay.

**Rủi ro còn lại (ghi rõ, không giấu):** nếu một chunk có test đỏ RỒI mới crash trước khi kịp ghi báo
cáo JSON, `numFailedTests` đọc ra 0. Đã bịt bằng bộ dò đỏ theo **văn bản** (`× đường/dẫn`) chạy song
song với JSON, và một test đỏ **tất định** sẽ đỏ lại ở lần chạy lại rồi báo đỏ. Nhưng một test đỏ
**chập chờn** vẫn có thể bị lượt chạy lại hấp thụ — đây là hệ quả cố hữu của mọi cơ chế retry, giới
hạn ở 2 lượt/chunk. Cổng cuối cùng vẫn là CI (chạy một-lần, không retry).

### 7.5 `lane-db-guard` vẫn hoạt động sau khi đổi runner (`done_when[3]`)

| Tình huống                                           | FILES skip           | Phán quyết                                                                    |
| ---------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| Chạy runner **có** `LANE_DB`                         | 1 (15 test)          | `ok` — skip còn lại là cố ý (pgbouncer · gate `sessions` của migration-smoke) |
| Chạy runner **thiếu** `LANE_DB`, tier thường         | **184** (3.030 test) | `warn` + banner LOUD                                                          |
| Chạy runner **thiếu** `LANE_DB`, tier `--all`/strict | **184**              | **`red` ⇒ exit 1**                                                            |

`node harness/lane-db-guard.test.mjs` → **14/14 pass**.

---

## 8. Việc còn lại (KHÔNG thuộc WO này)

| Việc                                                                                       | Vì sao tách                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Nâng vitest 3 → 4 để lấy bản tinypool đã vá                                                | Di trú toàn workspace; nên làm **sau MVP**, không phải ngay trước RC               |
| Rác `Not implemented: navigation` + promise `apiFetch` rơi tự do trong spec `@mediaos/app` | Vệ sinh test THẬT (S3) nhưng chạm `apps/app/src/**` — **ngoài `paths`** của WO này |

# S18-QA-SUPERTESTLISTEN-1 — supertest song song trên app chưa `listen`: vá 12 file + dựng ratchet

> **Trạng thái:** ĐÃ THI CÔNG (nhánh `fix/s18-qa-supertestlisten-1`).
> **Gate:** 🟡 LIGHT — thuần hạ tầng test, **0 file sản phẩm**.
> **Zone:** không chạm permission/RLS/secret/audit/auth/migration.

---

## 1. Khuyết tật — cơ chế chính xác

`request(app.getHttpServer())` với một `INestApplication` mới `init()` (chưa `listen`) khiến supertest
**tự mở một server tạm** rồi **tự `close()` khi request ĐẦU TIÊN trả về**.

- Một request tại một thời điểm ⇒ không ai thấy gì.
- `Promise.all([r1, r2])` ⇒ request thứ hai rơi vào server vừa đóng ⇒ **`ECONNRESET`**.

Cửa sổ này phụ thuộc lịch chạy của event-loop và độ trễ DB ⇒ **cục bộ gần như luôn xanh, nổ ở CI**, và
nổ trong CI của một PR **KHÔNG liên quan** (lần gần nhất: PR permission đỏ vì spec RECRUIT). Mỗi lần nổ
tốn đúng một vòng điều tra "hồi quy hay flake" đúng lúc sắp merge. Memory:
`supertest-closes-shared-server-on-first-response`.

**Vá đúng:** `await app.listen(0)` NGAY SAU `await app.init()` — server thật sống suốt suite, `afterAll`
đóng bằng `app.close()`.

⛔ **KHÔNG được** "vá" bằng cách đổi `Promise.all` thành vòng `await` tuần tự: supertest quyết định
listen lúc `.then()` đầu tiên, nên một mảng dựng sẵn rồi await lần lượt còn **tệ hơn** (`ECONNREFUSED`
từ request #2), và nó xoá chính bất biến mà ca đua đang đo (đúng-một-thắng, row-lock serialize thật).

---

## 2. Census — lọc TRƯỚC khi vá (done_when #1)

Census bằng **AST + lan truyền vết**, không grep. Lý do: **không file nào** gọi
`request(app.getHttpServer())` thẳng trong `Promise.all` — tất cả đi qua helper cục bộ
(`authPost → srv() → request(...)`, `assign() → post() → http()`), có nơi qua mảng trung gian
(`Promise.all(calls)`). Grep cú pháp sẽ nói "không có supertest nào trong Promise.all" ở **cả 12 file
thật** (họ `refactor-to-helper-blinds-syntax-census`).

Công cụ: [`apps/api/test/foundation/supertest-listen-census.ts`](../../apps/api/test/foundation/supertest-listen-census.ts).

### 2.1 Số đo (đọc 06/09/2026, `apps/api/test/integration/*.int-spec.ts`)

| Chỉ số | Số |
| --- | --- |
| int-spec toàn thư mục | 303 |
| có `app.init()` | 172 |
| có `Promise.all` | 27 |
| có `Promise.all` **chạm supertest** | 26 |
| **vi phạm** (init + supertest-trong-`Promise.all` + KHÔNG `listen`) | **12** |

### 2.2 Danh sách vá — file + dòng `Promise.all` chạm supertest

| # | File (`apps/api/test/integration/`) | `Promise.all` chạm supertest | biến app | `close()` |
| --- | --- | --- | --- | --- |
| 1 | `asset-be1-fsm.int-spec.ts` | 473 · 487 · 500 | `app` | ✅ |
| 2 | `chat-be1-access.int-spec.ts` | 329 · 348 | `app` | ✅ |
| 3 | `chat-be1-rooms.int-spec.ts` | 361 | `app` | ✅ |
| 4 | `chat-be2-messages.int-spec.ts` | 265 | `app` | ✅ |
| 5 | `chat-noti-e2e.int-spec.ts` | 444 | `app` | ✅ |
| 6 | `chat-s7-call-be1-lifecycle.int-spec.ts` | 650 | `app` | ✅ |
| 7 | `chat-s8-be1-room-prefs.int-spec.ts` | 286 | `app` | ✅ |
| 8 | `me-training.int-spec.ts` | 225 · 230 | `app` | ✅ |
| 9 | `recruit-be1-convert.int-spec.ts` | 333 | `app` | ✅ |
| 10 | `recruit-be1-interview-offer.int-spec.ts` | 234 · 262 | `app` | ✅ |
| 11 | **`task-cover.int-spec.ts`** | 455 | **`nest`** | ✅ |
| 12 | `task-subtask-tree.int-spec.ts` | 437 · 462 | `app` | ✅ |

Không file nào thiếu `close()` ⇒ **0 file phải thêm `afterAll`**.

### 2.3 Hai đính chính so với mô tả WO

**(a) `task-cover.int-spec.ts` là file mà census tay bỏ sót.** WO seed nói "12 int-spec"; con số đó đến
từ `grep 'app.init()'`, mà file này đặt tên biến là **`nest`** (`await nest.init()`) ⇒ trượt hẳn. Dòng
455 là `Promise.all([api(nest).post(…), api(nest).post(…)])` — hai lời gọi đặt bìa ĐỒNG THỜI, đúng diện.
Census AST bắt theo _hình dạng lời gọi_ `x.init()` nên không phụ thuộc tên biến.
⇒ Danh sách vá vẫn là **12 file**, nhưng **không phải 12 file của WO**: bỏ 1 (mục b), thêm 1
(`task-cover`). Memory: `wo-seed-hand-measurements-can-be-incomplete`.

**(b) `chat-be3-attachments.int-spec.ts` bị LOẠI khỏi phạm vi.** `Promise.all` duy nhất của nó (dòng 409)
là `insertFile(direct(), …)` ×3 — **gieo DB thuần**, không có request nào. WO nói rõ "spec không thuộc
diện thì KHÔNG động vào" ⇒ **không sửa**. Cổng cũng KHÔNG gắn cờ nó (đã đo).

### 2.4 Một dương-tính-giả đã sửa TRONG lúc dựng cổng

Bản đầu của census lan vết theo **mọi định danh** trong đối số `Promise.all`. Nó gắn cờ nhầm
`task-subtask-tree` dòng 576/604 — `Promise.all([c1.id, c2.id, c3.id].map((id) => queryTask(id)))`, một
lô **đọc DB thuần** — chỉ vì `c1/c2/c3` được tạo bằng `await createTask(...)` (đường HTTP).

⇒ Vết tách làm hai tập và **bỏ giá trị đã `await`**:

- `fns` — hàm/arrow cục bộ **trả về** một request (`authPost`, `http`, `assign`…).
- `vals` — biến **giữ request chưa `await`** (`const calls = [authGet(…), authPost(…)]`).

`const c1 = await createTask(…)` là một **hàng task**, không phải request đang bay ⇒ không đua được với
ai trên cùng server ⇒ không tính. Sau khi siết: 12 vi phạm, 0 dương-tính-giả (`chat-be2` còn đúng dòng
265, `task-subtask-tree` còn đúng 437/462).

---

## 3. Bản vá

4 dòng/file, cùng một hình dạng, kèm comment trỏ về cổng:

```ts
await app.init();
// S18-QA-SUPERTESTLISTEN-1 — BẮT BUỘC vì suite này có `Promise.all` request song song: khi app
// chỉ `init()`, supertest mở server tạm rồi TỰ ĐÓNG lúc request ĐẦU về ⇒ request thứ hai ăn
// `ECONNRESET` (xanh cục bộ, đỏ ở CI). Cổng: `test/foundation/supertest-listen-ratchet.unit-spec.ts`.
await app.listen(0);
```

`task-cover` dùng `nest` thay `app` (giữ nguyên tên biến của file).

**KHÔNG** reformat gì thêm: `task-cover.int-spec.ts` có lệch thụt lề sẵn từ trước; chạy prettier lên nó
đẻ ra 98 dòng nhiễu không liên quan ⇒ đã revert, chỉ giữ đúng 4 dòng thêm vào.

---

## 4. Ratchet chống tái phát

[`apps/api/test/foundation/supertest-listen-ratchet.unit-spec.ts`](../../apps/api/test/foundation/supertest-listen-ratchet.unit-spec.ts)
(14 ca, không cần DB — chạy ở mọi lượt `pnpm test` và ở CI):

| Ca | Đo gì |
| --- | --- |
| census KHÔNG rỗng | >200 file · >100 file có app `init()` · >10 `Promise.all` · >10 chạm-supertest · >10 file đã listen — **chống xanh-rỗng**: đổi thư mục/đuôi file/tên `Promise.all` làm cổng mù thì ca này ĐỎ trước |
| **ca chính** | `offenders() === []`, thông báo lỗi liệt kê file + **tên app chưa listen** + dòng + cách vá đúng |
| listen ⇒ close | app đã `listen(0)` mà chính nó không `close()` ⇒ ĐỎ (rò cổng sang spec sau) |
| **tripwire xuyên-file** | `sharedRequestHelpers() === []` — xem §7.3 |
| DƯƠNG (tổng hợp) | vết lan qua chuỗi helper `http → post → assign` |
| DƯƠNG (tổng hợp) | vết đi qua biến trung gian `Promise.all(calls)` |
| DƯƠNG (tổng hợp) | mảng bồi bằng `calls.push(http().get(…))` |
| DƯƠNG (tổng hợp) | biến gán lại sau khai báo rỗng (`let calls; calls = […]`) |
| DƯƠNG (tổng hợp) | `server.listen(9999)` của server KHÁC **không** được tính cho `app` |
| ÂM (tổng hợp) | `Promise.all` chỉ gieo DB **dù file có helper supertest** ⇒ không tính (chính là ca `chat-be3-attachments`) |
| ÂM (tổng hợp) | giá trị đã `await` không còn là request đang bay (2 dương-tính-giả §2.4) |
| ÂM (tổng hợp) | đã có `listen(0)` ⇒ không còn vi phạm |
| nhiều app/file | `app` listen, `app2` chưa ⇒ chỉ `app2` bị nêu tên (ca thật: `chat-rt1-realtime`) |
| ÂM (tổng hợp) | `app?.close()` optional-chaining vẫn tính là có close |

Mười ca cuối chạy trên **nguồn tổng hợp** chứ không trên cây thật: nếu bộ nhận dạng hỏng, ca chính sẽ
xanh-rỗng trong im lặng, còn các ca này ĐỎ ngay.

---

## 5. Bằng chứng

| Việc | Kết quả |
| --- | --- |
| Ratchet TRƯỚC khi vá (RED) | 12 vi phạm, liệt kê đúng file + dòng |
| Ratchet SAU khi vá | **14/14 pass** |
| 12 int-spec đã vá, lane DB `mediaos_s18listen` | **221/221 pass** (12 file, 16.4s) |
| Số test-file | 303 → 303 (không giảm; +2 file `test/foundation/`) |

⚠️ **Lượt chạy xanh KHÔNG phải bằng chứng đã vá** — cục bộ vốn gần như luôn xanh. Bằng chứng là ratchet
+ đọc code; lượt chạy chỉ chứng minh bản vá **không phá** 221 ca đang có.

---

## 6. Lệch `paths` của WO (nói ra để review đo đúng)

WO seed liệt kê `apps/api/test/integration/**`. Hai file mới đặt ở **`apps/api/test/foundation/`** — đó
là nơi ở của cả họ census/ratchet có sẵn (`param-uuid-*`, `body-validation-*`, `identity-projection-*`,
`coverage-thresholds-ratchet`), và chúng **không cần DB** nên không thuộc họ `int-spec`.
`vitest.config.ts` đã include `test/**/*.unit-spec.ts` từ trước ⇒ **0 dòng config phải đổi**.
`paths` của WO trong `harness/backlog.mjs` đã cập nhật theo.

---

## 7. LIGHT gate — 3 HIGH, đã vá cả ba

Reviewer chạy chính census/ratchet với input đối kháng (không chỉ đọc code) và tái hiện được cả ba lỗ
**của cái cổng** (bản vá 12 file: PASS, không finding). Đáng lưu: ba lỗ này đều thuộc đúng cái họ mà WO
tồn tại để chặn — một cổng trông-như-sống mà tự tắt trong im lặng.

### 7.1 `.listen()` bắt theo TÊN METHOD ⇒ dán nhãn an toàn cho app chưa listen

Bản đầu coi mọi `.listen(` trong file là "app đã listen". Một `server.listen(9999)` của mock/WS server
không liên quan là đủ để tắt cổng cho cả file. **Vá:** phán quyết theo **receiver** — `receiversOf(sf,
"init" | "listen" | "close")`, và `appsWithoutListen` = app nào `init()` mà **chính nó** chưa `listen()`.
Hệ quả tốt kèm theo: file nhiều app (`chat-rt1-realtime`: `app` + `app2`) giờ được đo từng app một.

### 7.2 Vết taint chỉ đọc `initializer` ⇒ trượt `.push()` và gán lại

`const calls = []; calls.push(http().get("/a")); … await Promise.all(calls)` và `let calls; calls = […]`
đều là **đúng hình dạng đua** nhưng census cũ trả `touchesSupertest: false`. Chưa file nào trong repo
viết kiểu đó (đã grep), nhưng đó là âm-tính-giả không có gì chặn. **Vá:** taint thêm từ
`BinaryExpression` (`x = …`) và `x.push(…)`/`x.unshift(…)`.

### 7.3 Mù xuyên-file — KHÔNG vá, dựng tripwire (nói thẳng giới hạn)

Census phân tích **từng file**, không giải import. Hôm nay mọi builder request là helper cục bộ nên vết
lan được; ngày ai đó gom `http()/authGet()` về `test/helpers/*.ts` dùng chung — đúng quy ước DRY của repo
này — **mọi file đã chuyển sẽ hoá vô hình**, và các ca chống-xanh-rỗng (đếm theo TOÀN corpus) vẫn xanh.

Vá đúng = taint xuyên file, đắt và ngoài phạm vi WO 🟡. Thay vì im lặng chịu rủi ro, cổng **phát hiện
đúng ngày rủi ro thành hiện thực**: `sharedRequestHelpers()` liệt kê helper dùng chung chạm
`getHttpServer`; danh sách phải RỖNG. Ngày nó khác rỗng, ca ĐỎ và bắt người sửa nâng census **trước**
khi chuyển tiếp int-spec sang helper đó. Đây là giới hạn đã biết, được ghi ra, không phải cổng kín.

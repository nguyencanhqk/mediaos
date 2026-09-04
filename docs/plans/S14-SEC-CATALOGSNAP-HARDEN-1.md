# S14-SEC-CATALOGSNAP-HARDEN-1 — đóng hai nhánh SUY BIẾN của `PermissionCatalogSnapshot`

> Zone 🔴 red · gate FULL · depends_on `S14-SEC-DASHGATE-WILDCARD-1` (đã merge `092fc6e7` / PR #476).
> Nguồn: vòng review 04/09 của WO kia — verdict PASS kèm **2 MEDIUM**, defer tường minh sang đây.
> ADR nền: `docs/DECISIONS/DECISIONS-12_Sensitive_Pair_Is_Property_Of_Target_Pair.md`.
>
> **v2** — plan-review vòng 1 verdict **BLOCK**, 6 mục chặn. v2 vá đủ: §3.2 (bản vá M2 đúng, hai cách
> gợi ý ban đầu đều sai) · §4.4 (luật stub thi hành được) · §4.5 (nhãn RED vs đối chứng) · §4.6 (biên
> cho nhánh rỗng — MỚI) · §4.7 (nội dung dòng log — MỚI) · §5 (đo đúng bề mặt).
>
> **v3** — plan-review vòng 2 verdict **BLOCK**, 3 mục, **tất cả nằm trong §4.6 mà v2 vừa thêm**:
> (B1) sàn giết ca RED §4.5 #3 ⇒ ca đó phải tiêm `degradedRetryMs: 0`, và câu §4.2 «lượt kế tiếp thử
> lại» đã bị sàn thay thế nhưng chưa sửa ⇒ ADR sẽ chép bản sai · (B2) sàn là một **chốt** mà 0 ca đo
> lúc nó **nhả** ⇒ tách #7 thành #7a/#7b/#7c, nếu không M2 tái sinh dưới tên khác · (B3) D9 phải khoá
> vào `rows.length`, KHÔNG BAO GIỜ `next.size` — giả định chịu lực của cả luật hàng-canh ⇒ thêm ca #8.
> Vòng 2 **xác nhận** khối §3.2 đúng như viết và claim vế (b) đúng cho cả 5 ca (0 dòng `expect` phải đổi).
>
> **Baseline** (đo 03/09, DB dev, `harness/backlog.mjs`): `permissions` = **390 hàng / 139 sensitive**
> ⇒ nhánh rỗng **không đang bật**. WO này đóng một cửa, không chữa một đám cháy.
>
> **Hoàn tác**: không migration, không feature-flag, không đổi seed ⇒ rollback = `git revert` commit.

---

## 1. Vì sao WO này tồn tại

`permission-catalog-snapshot.ts` được WO trước sinh ra để giữ đúng MỘT thuộc tính:

> cờ `is_sensitive` phải đọc theo **CẶP ĐÍCH**, và khi không đọc được thì suy biến về phía **SIẾT**,
> có để lại **VẾT**.

Cả hai MEDIUM đều phá đúng thuộc tính đó, và cả hai đều nằm trong chính file mới ấy. Hôm nay **không
với tới được từ code sản phẩm** (chứng minh ở §2) ⇒ đây là _hardening_, không phải lỗ đang mở.

---

## 2. Vì sao MEDIUM chứ không HIGH — đo bởi reviewer, KHÔNG đo lại từ đầu

| Nhánh                       | Vì sao code sản phẩm không tới được                                                                                                                                                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** `rows.length === 0`  | `permission.repository.ts:266-278` `SELECT id, action, resource_type, is_sensitive FROM permissions` KHÔNG thể trả PARTIAL; bảng là catalog **GLOBAL không RLS** (`db/schema/permissions.ts:39-48`, `db.service.ts:105-112`) ⇒ 0 hàng chỉ khi bảng THẬT SỰ rỗng (DB chưa seed / bị xoá). |
| **M2** `load()` ném ĐỒNG BỘ | `load` sản phẩm là method `async` (`permission.repository.ts:266`, passthrough `permission.cache.ts:160-162`) ⇒ không ném đồng bộ được.                                                                                                                                                  |

Cả hai chỉ tới được qua **callback TIÊM** (tức là qua test, hoặc qua một call-site tương lai).
Đó là lý do WO này sửa **hợp đồng của lớp**, không phải chữa một sự cố đang cháy.

---

## 3. M2 — ô `inFlight` kẹt vĩnh viễn (làm TRƯỚC: rẻ, không đổi hợp đồng)

### 3.1 Cơ chế

`permission-catalog-snapshot.ts:131,150-157`:

```ts
const flight = (async () => {
  try   { const rows = await this.withTimeout(this.load()); ... }
  catch { this.emitError(...); return this.sensitivePairs; }
  finally { if (epochAtStart === this.epoch) this.inFlight = null; }   // ← chạy ĐỒNG BỘ nếu load ném sync
})();

this.inFlight = flight;   // ← gán SAU khi thân có thể đã settle
```

Thân `async` chạy **đồng bộ** tới `await` đầu tiên. `this.load()` được gọi **trước** `await`, nên nếu nó
ném đồng bộ thì: `catch` → `emitError` → `finally` (`this.inFlight = null`, lúc này vẫn đang là `null`)
→ hàm trả về — **tất cả trước** dòng `this.inFlight = flight`. Ô kết thúc bằng một promise **ĐÃ settle**
mà `finally` không còn cơ hội xoá.

Hệ quả: `refresh()` mãi mãi trả early ở `:128`, `ensureSnapshot` mãi mãi nhận `null` ⇒ **mọi cặp =
sensitive VĨNH VIỄN**, không thử nạp lại, không thêm một dòng log nào nữa. Fail-CLOSED (không rò) nhưng
là **DoS quyền tới khi restart tiến trình** — đúng thứ ADR D2 tuyên bố tránh («blip DB không khoá 300s»).
`reset()` là đường thoát duy nhất và nó là seam TEST (D7), không phải đường vận hành.

**Kíp nổ có HAI nguồn, không chỉ một** — bản vá phải bọc cả hai:

1. `this.load()` ném đồng bộ (callback tiêm).
2. `this.withTimeout(...)` ném đồng bộ: `:186` gọi `work.catch(...)` ⇒ nếu `load()` trả về **non-promise**
   (mock `vi.fn()` không implementation, hoặc repo cast thiếu method — đúng hình dạng
   `permission.cache.spec.ts:40-45` `as unknown as IPermissionRepository`) thì `TypeError` bật ra **ngay
   trong** `withTimeout`, ngoài tầm `catch` của thân async.

⇒ khối `try` của bản vá phải ôm **cả biểu thức** `this.withTimeout(this.load())`, không phải mỗi `this.load()`.

### 3.2 Bản vá — tách «khởi động load» khỏi «thân chờ»

Cách hiển nhiên (`Promise.resolve().then(async …)`) **SAI ở đây**: nó hoãn luôn cả lời gọi `load()` sang
microtask ⇒ ca D6 `:103` (`expect(load).toHaveBeenCalledTimes(1)` chạy ĐỒNG BỘ ngay sau khi phát 4 lượt)
sẽ thấy **0** và đỏ. Sửa ca đó để hợp với bản vá là **hạ sàn một ca đang đo thật** — cấm.

Bản vá đúng giữ nguyên tính **háo hức** của `load()`, chỉ đảm bảo thân **không thể settle đồng bộ**:

Khối thay thế **ĐẦY ĐỦ** cho `refresh()` (không để `/* nguyên vẹn */` ở vùng đỏ — bẫy
`plan-pseudocode-body-reverts-fixes`; phần MỚI so với bản hiện tại được đánh dấu `// ★`):

Khai báo đi kèm (thiếu bốn dòng này thì khối dưới không biên dịch — cùng chuẩn «không
`/* nguyên vẹn */` ở vùng đỏ»):

```ts
// trong `PermissionCatalogSnapshotDeps`
  /** ADR D9 §4.6 — tiêm để test không phải chờ 5s thật. */
  degradedRetryMs?: number;

// trong class
  /** ★ §4.6 — mốc `now()` mà trước đó KHÔNG thử nạp lại. 0 = không có sàn. */
  private retryNotBeforeMs = 0;
  private readonly degradedRetryMs: number;

// trong constructor
  this.degradedRetryMs = deps.degradedRetryMs ?? PERMISSION_CATALOG_EMPTY_RETRY_MS;

// trong reset() — cạnh ba dòng hiện có (:106-109)
  this.retryNotBeforeMs = 0;   // ★ reset() phải gỡ CẢ sàn, nếu không seam D7 mất tác dụng
```

```ts
private refresh(): Promise<Set<string> | null> {
  if (this.inFlight !== null) return this.inFlight;
  // ★ §4.6 — sàn thử-lại của nhánh SUY BIẾN-RỖNG. Xem §4.6 vì sao chỉ nhánh rỗng cần nó.
  //
  // ⚠️ Sàn KHÔNG cần gỡ ở nhánh `catch`, và đó là chủ ý — CHỨNG MINH: sàn được kiểm ở ĐẦU
  // `refresh()`, nên khi sàn còn hiệu lực thì KHÔNG lượt nạp nào chạy ⇒ `catch` không thể chạy
  // trong cửa sổ sàn; và một sàn ĐÃ quá hạn là trơ (`now() < past` = false). Thêm
  // `retryNotBeforeMs = 0` vào `catch` là một dòng không ai giải thích được — đừng «vá cho chắc».
  if (this.now() < this.retryNotBeforeMs) return Promise.resolve(this.sensitivePairs);

  const epochAtStart = this.epoch;

  // ★ Khởi động HÁO HỨC, ngay trong lượt ĐỒNG BỘ này — ca D6 `:103` đếm `load` đồng bộ, và giữ
  // ★ nguyên tính háo hức là cách duy nhất để ca đó còn đo được thật. `try` ôm CẢ biểu thức:
  // ★ `withTimeout` cũng ném đồng bộ được (§3.1 nguồn 2).
  let started: Promise<PermissionCatalogEntry[]>;
  try {
    started = this.withTimeout(this.load());
  } catch (syncError: unknown) {
    started = Promise.reject(syncError);
  }

  const flight = (async (): Promise<Set<string> | null> => {
    try {
      // ★ `await` LUÔN nhường ít nhất một microtask, kể cả trên promise ĐÃ settle ⇒ thân này
      // ★ KHÔNG THỂ settle đồng bộ ⇒ `finally` chắc chắn chạy SAU `this.inFlight = flight`.
      const rows = await started;

      // `reset()` xen vào giữa lượt nạp ⇒ kết quả này đã LẠC HẬU: không ghi đè ảnh mà lượt sau
      // (chạy trên catalog mới hơn) có thể đã đặt.
      // ★ Kiểm epoch nằm TRƯỚC kiểm rỗng: một lượt đã lạc hậu không được phát tín hiệu suy biến
      // ★ cho một thế hệ ảnh chụp mà không ai còn dùng.
      if (epochAtStart !== this.epoch) return this.sensitivePairs;

      // ★ ADR D9 — catalog GLOBAL do migration seed; 0 hàng là phát biểu HẠ TẦNG («chưa seed / bị
      // ★ xoá»), không phải phát biểu nghiệp vụ («không có cặp nhạy cảm nào»). Coi nó hợp lệ là để
      // ★ một sự cố hạ tầng tự tuyên bố rằng không có gì cần bảo vệ — và đóng dấu tuyên bố đó 300s.
      //
      // ⚠️⚠️ VỊ NGỮ LÀ `rows.length`, TUYỆT ĐỐI KHÔNG `next.size`. Đổi sang `next.size === 0` trông
      // như dọn dẹp vô hại (thậm chí «chặt hơn») nhưng làm NỔ toàn bộ luật hàng-canh ở §4.4: hàng
      // canh có `isSensitive:false` ⇒ `next` RỖNG mà `rows.length === 1` ⇒ không suy biến. Đó là
      // giả định chịu lực của cả 7 stub. Có ca ghim: §4.5 #8.
      //
      // Hệ quả ĐƯỢC CHỌN, không phải bỏ sót: catalog có 390 hàng nhưng 0 hàng `isSensitive` (một
      // migration hỏng xoá sạch cờ) là fail-OPEN mà D9 KHÔNG bắt — vì không phân biệt được với một
      // hệ hợp lệ không có cặp nhạy cảm nào.
      if (rows.length === 0) {
        this.retryNotBeforeMs = this.now() + this.degradedRetryMs; // ★ §4.6
        this.emitError(
          new Error("permission catalog loaded 0 rows — degenerate (ADR DECISIONS-12 D9)"),
          this.sensitivePairs === null ? "no-snapshot" : "stale-kept",
          "empty-catalog",
        );
        return this.sensitivePairs; // ảnh CŨ nếu có, `null` nếu chưa từng nạp ⇒ mọi cặp = SIẾT
      }

      const next = new Set<string>();
      for (const row of rows) {
        if (row.isSensitive) next.add(pairKey(row.action, row.resourceType));
      }
      this.sensitivePairs = next;
      this.loadedAtMs = this.now();
      this.retryNotBeforeMs = 0; // ★ nạp lành ⇒ gỡ sàn
      return next;
    } catch (error: unknown) {
      // ADR §5.3 D2. CỐ Ý không đóng dấu `loadedAtMs`: một blip DB không được khoá trạng thái suy
      // biến suốt TTL — lần gọi kế tiếp phải thử nạp lại.
      this.emitError(
        error,
        this.sensitivePairs === null ? "no-snapshot" : "stale-kept",
        "load-failed", // ★
      );
      return this.sensitivePairs;
    } finally {
      // CHỈ nhả ô của CHÍNH mình: sau `reset()`, ô này có thể đang giữ lượt nạp MỚI hơn.
      if (epochAtStart === this.epoch) this.inFlight = null;
    }
  })();

  this.inFlight = flight;
  return flight;
}
```

`reset()` phải gỡ luôn sàn: thêm `this.retryNotBeforeMs = 0;` cạnh ba dòng hiện có (`:106-109`).

Bất biến khoá bản vá: **`await` trên một promise đã settle vẫn nhường một microtask** ⇒ `finally` không
bao giờ chạy được trước `this.inFlight = flight`, bất kể `load` hỏng kiểu gì.

Không đổi hợp đồng, không đổi kiểu trả về, không đụng `epoch`/single-flight/timeout, không đổi thời điểm
`load()` được gọi.

### 3.3 Ca RED (viết TRƯỚC, phải đỏ trên code hiện tại)

`load` ném ĐỒNG BỘ lần 1, thành công lần 2 ⇒ lượt gọi **kế tiếp** vẫn phải nạp lại:

```ts
expect(await snap.isPairSensitive("read", "notification")).toBe(true); // suy biến siết
expect(await snap.isPairSensitive("read", "notification")).toBe(false); // ĐỎ trước vá: vẫn true
expect(load).toHaveBeenCalledTimes(2); // ĐỎ trước vá: 1
```

⚠️ Ca này phải dùng `mockImplementationOnce(() => { throw ... })` (ném ĐỒNG BỘ), **không**
`mockRejectedValueOnce` (trả promise reject = đường đã có ca ở `:146`, xanh sẵn ⇒ ca rỗng).

---

## 4. M1 — catalog nạp THÀNH CÔNG mà RỖNG ⇒ fail-OPEN im lặng 300s

### 4.1 Cơ chế

`permission-catalog-snapshot.ts:137-143`: `rows = []` ⇒ `next = new Set()` (non-null) ⇒ **ghi ảnh** +
**đóng dấu `loadedAtMs`** ⇒ `isPairSensitive` trả `false` cho **MỌI** cặp suốt TTL 300s, và **KHÔNG**
gọi `emitError` (chỉ nhánh `catch` mới gọi, `:148`).

`dashboard-widget-gate.ts:58-63` **CỐ Ý** không truyền `isSensitive` ⇒ `pairIsSensitive` là tín hiệu
sensitive **DUY NHẤT** của đường đó ⇒ lỗ `*:*` mở cặp sensitive mà WO trước vừa vá **dựng lại nguyên
vẹn**, trong im lặng.

**Đối xứng ngược**: cùng một sự cố hạ tầng mà biểu hiện bằng THROW thì siết (mọi cặp `true`) + có log;
biểu hiện bằng 0 hàng thì nới (mọi cặp `false`) + im lặng + **được cache 300s**. Đây đúng hình dạng
`empty-success-is-the-fail-open-shape` trong sổ bẫy.

### 4.2 Quyết định hợp đồng (ghi vào ADR TRƯỚC khi code) — **D9**

> **`rows.length === 0` là trạng thái SUY BIẾN, KHÔNG phải ảnh chụp hợp lệ.**

Lý lẽ: `permissions` là catalog **GLOBAL** do migration seed. «0 hàng» không phải một phát biểu nghiệp vụ
(«hệ này không có cặp nhạy cảm nào») mà là một phát biểu **hạ tầng** («DB chưa seed / vừa bị xoá»).
Coi nó hợp lệ là để một sự cố hạ tầng **tự tuyên bố** rằng không có gì cần bảo vệ — và đóng dấu tuyên bố
đó 300s.

**Hành vi mới** (đối xứng ĐÚNG với nhánh `catch`):

- KHÔNG ghi `sensitivePairs`, KHÔNG đóng dấu `loadedAtMs` → lượt kế tiếp **sau sàn §4.6** thử lại.
  Giữ tinh thần D2 («một blip không được khoá trạng thái suy biến suốt TTL»: sàn 5s ≪ TTL 300s) nhưng
  KHÔNG phải nguyên văn D2 — §4.6 giải thích vì sao nhánh rỗng cần biên còn nhánh `catch` thì không.
  ⚠️ Câu này phải chép vào ADR D9 **đúng bản đã sửa**, không phải bản «lượt kế tiếp thử lại» trần.
- Gọi `emitError` → **có VẾT** (luật quan sát).
- Trả ảnh chụp **CŨ** nếu có, `null` nếu chưa từng nạp được → `isPairSensitive` = `true` = **SIẾT**.

**D3 bị THU HẸP, không bị lật** — phát biểu mới:

> ảnh chụp đã nạp **và KHÔNG RỖNG** mà cặp VẮNG ⇒ `false`.

D3 nói về **cặp vắng trong ảnh KHÔNG rỗng**; nó chưa bao giờ phát biểu gì về **ảnh RỖNG**. Ca ghim hiện
tại `permission-catalog-snapshot.spec.ts:54-62` gộp hai chuyện đó làm một và neo `empty ⇒ false` với lý do
**TIỆN TEST** («làm hàng loạt spec đỏ vì lý do sai») — đó là mẫu `tests-can-pin-a-hole-open`. **Phải sửa
chính ca đó**, không lách quanh nó.

### 4.3 Quan sát — hai chiều, KHÔNG nhét vào một chuỗi

`onError(error, phase)` hiện có `phase: "stale-kept" | "no-snapshot"` = **KẾT QUẢ suy biến**, và
`permission.service.ts:326-330` suy `degradedTo` từ nó. Nếu nhét cause vào cùng trường
(`phase: "empty-catalog"`) thì `degradedTo` **nói dối** ở ca «rỗng nhưng CÓ ảnh cũ» (kết quả là
stale-kept, không phải siết) — đúng bẫy `cache-breaks-two-source-flag-invariants` (SUY RA, đừng hard-code).

⇒ Thêm **tham số thứ BA**, tách bạch hai chiều:

```ts
export type CatalogDegradePhase = "stale-kept" | "no-snapshot"; // KẾT QUẢ (giữ nguyên)
export type CatalogDegradeCause = "load-failed" | "empty-catalog"; // NGUYÊN NHÂN (mới)
onError?: (error: unknown, phase: CatalogDegradePhase, cause: CatalogDegradeCause) => void;
```

Non-breaking: handler 2-tham-số hiện tại (`permission.service.ts:322`) vẫn gán được (structural typing).
`phase` tiếp tục suy từ `this.sensitivePairs === null` ở CẢ HAI nhánh ⇒ một nguồn sự thật cho kết quả.
`permission.service.ts` log thêm `cause`; `degradedTo` giữ nguyên công thức (đã đúng theo `phase`).

### 4.4 ĐO blast radius TRƯỚC khi đổi — đã đo, kết quả bên dưới

Census `getAllPermissions` toàn `apps/api` (grep KHÔNG pipe qua `head` — bẫy
`census-grep-must-not-be-piped-to-head`): **7 stub trả `[]`**, 3 stub trả catalog thật, 1 stub ném có
điều kiện, 1 sản phẩm.

| #   | File                                                              | Dòng | Trả                                 |
| --- | ----------------------------------------------------------------- | ---- | ----------------------------------- |
| 1   | `apps/api/src/permission/permission.service.spec.ts`              | 137  | `Promise<[]>`                       |
| 2   | `apps/api/src/permission/permission.service.reveal.spec.ts`       | 80   | `Promise<[]>`                       |
| 3   | `apps/api/src/permission/permission.scopes.spec.ts`               | 49   | `[]`                                |
| 4   | `apps/api/src/permission/data-scope.service.spec.ts`              | 51   | `[]`                                |
| 5   | `apps/api/src/permission/data-scope.service.coverage.spec.ts`     | 57   | `[]`                                |
| 6   | `apps/api/test/foundation/dashboard-scope-roundtrip.unit-spec.ts` | 48   | `[]`                                |
| 7   | `apps/api/test/foundation/permission-scope-batch.unit-spec.ts`    | 56   | `[]`                                |
| —   | `permission.coverage.spec.ts:69`                                  |      | catalog thật, ném khi `failCatalog` |
| —   | `permission.decide.pair-sensitive.spec.ts:420/528/553`            |      | catalog thật                        |
| —   | `dashboard/dashboard-widget-gate.spec.ts:63`                      |      | `MINI_CATALOG`                      |

**Census này là DECLARATION site. Đã kiểm thêm CONSTRUCTION site**: mock cast kiểu
`permission.cache.spec.ts:40-45` (`as unknown as IPermissionRepository`, **không có** `getAllPermissions`)
vô hình với grep trên tên method. File đó hôm nay **không dựng `PermissionService`** ⇒ không nạp ảnh chụp
⇒ vô hại. (Ngoài lề: chính hình dạng đó là kíp nổ M2 — `undefined()` ném đồng bộ, §3.1 nguồn 2.)

**Đã đo tay — 5 ca sẽ ĐỎ nếu để nguyên `[]`:**

- `apps/api/test/foundation/permission-scope-batch.unit-spec.ts:89-105` — `[3] view:note` chỉ khớp `*:*`
  ⇒ hôm nay `"Company"`, sau D9 `null`.
- `apps/api/test/foundation/permission-scope-batch.unit-spec.ts:176-182` — kỳ vọng `["Company", null]`,
  sau D9 `[null, null]`.
- `apps/api/src/permission/data-scope.service.spec.ts:112-118` — kỳ vọng `"Company"` từ `*:*`, sau D9 `null`.
- `apps/api/src/permission/permission.service.spec.ts:651-656` (`allow3`, `approve:step` qua `*:*`) và
  `:716-721` (`allow9`, `read:project` qua `*:*`) — kỳ vọng `allow`, sau D9 `deny-sensitive`.

#### Luật xử lý — 3 vế, thi hành được

Luật cũ («gắn cờ `isSensitive` **theo catalog thật**») **KHÔNG thi hành được** và ở một ca còn **tự mâu
thuẫn**, nên bị thay:

- Phần lớn cặp trong 7 stub (`approve:step`, `read:project`, `view:note`, `view:secret`,
  `delete-project:project`) **không tồn tại** trong catalog thật ⇒ «cờ theo catalog thật» là _undefined_
  ⇒ người cài sẽ tự chế.
- Ca `permission-scope-batch.unit-spec.ts:172-182` dùng `update:candidate`, mà cặp đó **là**
  `is_sensitive = true` thật (`apps/api/migrations/0560_s12recruitdb1_seed_role_perms_audit.sql:86`), với
  grant **chỉ `*:*`** và kỳ vọng `["Company", null]`. Seed «theo catalog thật» ⇒ `[null, null]` ⇒ ca mất
  khả năng phân biệt — nó sinh ra để chứng minh _hai request cùng cặp không đè nhau_, không phải để đo
  sensitivity ⇒ hoá **xanh-RỖNG** (bẫy `deny-cases-vacuous-without-allow-case`).

**Luật mới:**

| Vế      | Nội dung                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a)** | Catalog stub phải **KHÔNG RỖNG**. Tối thiểu: một hàng canh (`isSensitive: false`) mà **không spec nào truy vấn**. `[]` giờ mang nghĩa «hạ tầng hỏng» — một stub trả `[]` là một stub nói dối. ⚠️ Hàng canh phải là **MỘT hằng dùng chung, export từ MỘT chỗ**, 7 file import — bảy file tự chế bảy hàng canh là bảy cơ hội để một hàng vô tình **trùng cặp** mà spec đó đang truy vấn, và khi trùng thì kết quả đổi **âm thầm**, không ai đọc ra từ diff. |
| **(b)** | Chỉ đưa một cặp **VÀO** catalog khi kết quả của ca **PHỤ THUỘC cờ của cặp đó**. Cặp để **VẮNG** vẫn `false` theo **D3** — đó là ngữ nghĩa D3 đang chạy thật, **KHÔNG** phải hạ sàn.                                                                                                                                                                                                                                                                       |
| **(c)** | **CẤM sửa/nới bất kỳ dòng `expect` sẵn có** trong 7 file. Ca nào buộc phải đổi ⇒ **DỪNG, ghi vào plan, xin chốt** — không sửa trong lúc code (`tests-can-pin-a-hole-open`, `reviewer-proposed-fix-can-open-holes`).                                                                                                                                                                                                                                       |

Vế (b) làm **cả 5 ca đỏ ở trên tự khỏi**: mọi cặp chúng truy vấn đều VẮNG khỏi catalog canh ⇒ `false` ⇒
kết quả **y hệt hôm nay**, không dòng `expect` nào phải đổi. Kiểu `Promise<[]>` ở #1/#2 nới thành
`Promise<PermissionCatalogEntry[]>`.

⚠️ **Đánh đổi phải ghi rõ:** để `update:candidate` VẮNG nghĩa là ca `:172-182` **không** canh gác việc
wildcard mở cặp sensitive đó. Chấp nhận được vì đúng thuộc tính ấy đã có canh gác riêng, trên catalog
THẬT, ở `permission.decide.pair-sensitive.spec.ts` và
`apps/api/test/integration/dash-wildcard-sensitive-gate.int-spec.ts` — nơi nó thuộc về.

### 4.5 Ca kiểm — dán nhãn ĐÚNG (RED vs đối chứng)

Nhãn sai làm bước «ghi lại số đỏ» ở §5 tự lừa. Phân loại:

| #      | Ca                                                                                                                                                                                                                                                                                                                                             | Nhãn                        | Hôm nay                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      | `load` trả `[]`, CHƯA từng nạp ⇒ `isPairSensitive(bất kỳ)` = **`true`**; `onError` với `phase="no-snapshot"`, `cause="empty-catalog"`                                                                                                                                                                                                          | 🔴 **RED**                  | `false`, `onError` KHÔNG được gọi                                                                                                                |
| 2a     | `load` `[]` khi ĐÃ có ảnh cũ ⇒ giữ **CŨ** cho cặp sensitive (`view:candidate` → `true`)                                                                                                                                                                                                                                                        | 🔴 **RED**                  | `false` (ảnh rỗng đè ảnh cũ)                                                                                                                     |
| 2b     | cùng ca, cặp non-sensitive (`read:notification` → `false`)                                                                                                                                                                                                                                                                                     | ⚪ **đối chứng**            | đã `false` — giữ để bản vá «mọi thứ true» không lọt                                                                                              |
| 2c     | cùng ca, `phase="stale-kept"` + `cause="empty-catalog"`                                                                                                                                                                                                                                                                                        | 🔴 **RED**                  | `onError` KHÔNG được gọi                                                                                                                         |
| 3      | **Không đóng dấu TTL**: `[]` lần 1, catalog thật lần 2, đồng hồ KHÔNG nhúc nhích ⇒ lượt 2 nạp lại và thấy catalog mới (`load` 2 lần) — mirror `:146-162` của nhánh `catch`. ⚠️ **BẮT BUỘC tiêm `degradedRetryMs: 0`**, nếu không sàn §4.6 chặn lượt 2 và ca này **đỏ vĩnh viễn** — ca đo _«không đóng dấu TTL»_, tách bạch với _«có sàn»_ (#7) | 🔴 **RED**                  | `load` 1 lần (ảnh rỗng đã đóng dấu, TTL còn hiệu lực)                                                                                            |
| 4      | catalog **KHÔNG rỗng**, cặp VẮNG ⇒ `false` (D3 nguyên vẹn)                                                                                                                                                                                                                                                                                     | ⚪ **đối chứng**            | xanh trước và sau — **bắt buộc giữ**, không có nó thì bản vá «mọi cặp true» cũng xanh                                                            |
| 5      | Ca ghim `:54-62` tách đôi: vế «cặp vắng trong catalog KHÔNG rỗng ⇒ false» **giữ**; vế `const empty = … load: async () => []` **đổi kỳ vọng sang `true`** + comment nêu D9                                                                                                                                                                      | 🔴 **RED** (chính ca ghim)  | `false`                                                                                                                                          |
| 6      | §3.3 — `load` ném ĐỒNG BỘ ⇒ lượt kế tiếp vẫn nạp lại                                                                                                                                                                                                                                                                                           | 🔴 **RED**                  | kẹt vĩnh viễn                                                                                                                                    |
| **7a** | §4.6 **trong sàn** — hình dạng **no-snapshot** (catalog rỗng từ đầu ⇒ `sensitivePairs` luôn `null` ⇒ nhánh TTL `ensureSnapshot:113` KHÔNG BAO GIỜ chạm tới ⇒ `load = 1` **chỉ có thể** do sàn). N lượt tuần tự ⇒ `load` đúng **1** lần **và** `onError` đúng **1** lần (đóng luôn «bão log»)                                                   | 🔴 **RED**                  | `load` **N** lần, `onError` **0** lần                                                                                                            |
| **7b** | §4.6 **HẾT sàn — BẮT BUỘC**: đẩy đồng hồ **quá `degradedRetryMs`**, `load` lượt 2 trả catalog THẬT ⇒ `load` **2** lần **và** cờ mới đúng (`view:candidate`→`true`, `read:notification`→`false`)                                                                                                                                                | 🔴 **RED**                  | `load` N lần, không có khái niệm sàn                                                                                                             |
| **7c** | `reset()` giữa cửa sổ sàn ⇒ lượt kế nạp lại **ngay** (ghim dòng `retryNotBeforeMs = 0` trong `reset()`)                                                                                                                                                                                                                                        | 🔴 **RED**                  | không có sàn để gỡ                                                                                                                               |
| **8**  | **rows.length, KHÔNG next.size**: catalog **CÓ hàng** nhưng **0 hàng `isSensitive`** ⇒ **KHÔNG** suy biến — `onError` **không** được gọi, mọi cặp `false`, ảnh chụp **được đóng dấu TTL** (`load` 1 lần qua N lượt trong TTL)                                                                                                                  | ⚪ **đối chứng** (chịu lực) | xanh trước và sau — nhưng **bắt buộc**: nó là ca duy nhất chặn đường trôi `rows.length` → `next.size`, mà đường đó làm **cả 7 stub nổ cùng lúc** |

**Vì sao #7b và #7c là BẮT BUỘC, không phải «có thì tốt»:** sàn là một **chốt**, và WO này tồn tại vì
một chốt không nhả (M2). Chỉ có #7a thì ba đột biến sau đều **xanh** — `retryNotBeforeMs = Number.MAX_SAFE_INTEGER`;
dùng `this.ttlMs` thay `degradedRetryMs`; đặt dòng gỡ `retryNotBeforeMs = 0` nhầm chỗ (sau một `return`
khác) — và kết quả là **M2 tái sinh dưới tên khác**: mọi cặp `true` vĩnh viễn, fail-CLOSED, không thêm log.

### 4.6 Biên của nhánh rỗng — **sàn thử-lại**, nếu không D9 đẻ ra bão query

«Không đóng dấu TTL» đúng cho nhánh `catch` (D2) vì đó là DB **đang chết**: fail nhanh, ồn ào, ai cũng
biết, và trạng thái **tự hết** khi DB sống lại. Nhánh rỗng thì **khác hẳn**:

- DB **khoẻ** ⇒ `SELECT … FROM permissions` (`permission.repository.ts:266-272`) thành công và **nhanh**.
- Trạng thái **không tự lành** nếu chưa ai chạy seed.
- ⇒ mỗi `can()` = **1 query + 1 `logger.error`**, **mãi mãi**, trên đúng hot-path mà **mọi** kiểm quyền
  đi qua. Single-flight chỉ gộp lượt **song song**; `can()` tuần tự trong một request không được gộp.

Và các spec «1 round-trip» **không phát hiện được**:
`apps/api/test/foundation/dashboard-scope-roundtrip.unit-spec.ts:104,117,140,146` chỉ đếm
`getCompanyRoleGrantsWithScope`, **không** đếm `getAllPermissions`.

**Chốt:** thêm sàn thử-lại **ngắn**, chỉ cho nhánh rỗng:

```ts
/** ADR D9 — sàn thử-lại của nhánh SUY BIẾN-RỖNG. Ngắn hơn TTL nhiều bậc: vẫn giữ tinh thần D2
 *  («blip không khoá 300s») nhưng chặn bão query/log trên hot-path khi DB khoẻ mà catalog rỗng. */
export const PERMISSION_CATALOG_EMPTY_RETRY_MS = 5_000;
```

**Vì sao 5s** (neo con số, đừng để nó là số tuỳ ý): ≪ TTL 300s nên không tái lập «khoá suy biến 300s» mà
D2 cấm; ≫ thời gian một request nên mọi `can()` trong cùng một request chia nhau **một** lần thử; và đủ để
một vòng poll dashboard không đẻ ra hai query.

- `degradedRetryMs = deps.degradedRetryMs ?? PERMISSION_CATALOG_EMPTY_RETRY_MS` (tiêm được để test
  không phải chờ 5s thật).
- Áp **chỉ** ở nhánh rỗng. Nhánh `catch` giữ nguyên D2 — bất đối xứng **có chủ đích**, lý do ở trên,
  ghi vào ADR D9. Và **không gỡ sàn trong `catch`** — chứng minh nằm trong comment ở khối §3.2.
- **Đồng hồ lùi** (NTP) kéo dài cửa sổ sàn đúng bằng bước lùi. Cùng hạng rủi ro với TTL đã có ⇒ không
  thêm code, một dòng trong D9 là đủ.

**Hình dạng ca — chỉ định, đừng để người cài chọn:**

| Ca                                 | Hình dạng                                 | Vì sao                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #7a, #7b                           | **no-snapshot** (catalog rỗng **từ đầu**) | `sensitivePairs` luôn `null` ⇒ nhánh TTL `ensureSnapshot:113` **không bao giờ chạm tới** ⇒ `load = 1` **chỉ có thể** do sàn. Ca ghim đúng thứ cần ghim, và **không cần** mẹo `ttlMs` |
| biến thể **stale-kept** (tuỳ chọn) | có ảnh cũ rồi mới rỗng                    | **BẮT BUỘC** mẹo `ttlMs: 1` + `degradedRetryMs: 10_000` + đẩy đồng hồ **quá TTL** giữa các lượt; thiếu mẹo thì ca xanh **nhờ TTL** và không đo gì                                    |

⚠️ **Thứ tự thi công**: ca #7 truyền `degradedRetryMs` trong khi trường đó chưa tồn tại ⇒ `pnpm typecheck`
sẽ ĐỎ giữa bước 2 và bước 4. Vitest transpile-only (esbuild) nên spec **vẫn chạy** và vẫn RED đúng ý.
Chọn một: khai `degradedRetryMs?: number` ở **bước 2a** trước khi viết ca (khuyến nghị), hoặc **không
chạy typecheck** giữa bước 2 và 4.

### 4.7 Dòng log của nhánh mới phải NÓI ĐÚNG SỰ THẬT

`permission.service.ts:326-330` hard-code message `"permission catalog snapshot load failed"` và làm
`error instanceof Error ? error.message : String(error)`. Nhánh rỗng là một lượt nạp **THÀNH CÔNG** ⇒ để
nguyên là ghi một dòng **sai sự thật**, mà dòng đó là **quan sát DUY NHẤT** của nhánh mới ⇒ D9 chỉ «có
vết» trên giấy.

**Chốt:**

- Snapshot dựng `Error` thật (không truyền `undefined`) — xem khối §3.2:
  `new Error("permission catalog loaded 0 rows — degenerate (ADR DECISIONS-12 D9)")`.
- `permission.service.ts` phân nhánh **message** theo `cause`:

```ts
onError: (error, phase, cause) => {
  this.logger.error(
    cause === "empty-catalog"
      ? "permission catalog snapshot is EMPTY (0 rows) — degenerate"
      : "permission catalog snapshot load failed",
    {
      error: error instanceof Error ? error.message : String(error),
      phase,
      cause,
      // SUY RA từ `phase` (nguồn duy nhất của KẾT QUẢ) — không hard-code theo `cause`.
      degradedTo: phase === "no-snapshot" ? "pairIsSensitive=true (siết)" : "ảnh chụp CŨ",
    },
  );
},
```

- Thêm **1 ca ghim nội dung dòng log** (không chỉ `cause`), mirror
  `permission.decide.pair-sensitive.spec.ts:544-546`.

⚠️ **Chuỗi nhánh THROW phải giữ NGUYÊN TỪNG KÝ TỰ**: `permission.decide.pair-sensitive.spec.ts:544` tìm
dòng log bằng `String(c[0]).includes("catalog snapshot load failed")`. Vế `else` ở khối trên giữ đúng
chuỗi đó. **Đừng «đồng bộ hoá» hai message** cho đẹp — làm vậy là spec ấy đỏ và trông y như một hồi quy
của chính bản vá này.

### 4.8 Forensics lệch trong cửa sổ suy biến — ghi vào ADR

Ở cửa sổ suy biến, mọi từ chối mang `reason: "deny-sensitive"` + `auditRequired: true`
(`permission.decide.ts:136`), và chuỗi này **đi ra ngoài** qua `file_access_logs.denied_reason` (ADR §5.2).
Nhật ký sẽ nói «cặp này nhạy cảm» trong khi sự thật là «không đọc được catalog». Không sửa ở WO này
(đổi `reason` là đổi hợp đồng đã ghi ở ADR §5.2) — **ghi một dòng vào D9** để người đọc log sau này
không truy sai hướng.

---

## 5. Thứ tự thi công

1. `git checkout -b fix/s14-sec-catalogsnap-harden-1`
2. **2a** — khai trước **chỉ** hai thứ mà ca RED cần để typecheck xanh: trường
   `degradedRetryMs?: number` trong `PermissionCatalogSnapshotDeps`, hằng
   `PERMISSION_CATALOG_EMPTY_RETRY_MS`, và tham số thứ ba `cause` trong kiểu `onError`. **Chưa** đổi
   một dòng hành vi nào — mọi ca 🔴 vẫn phải đỏ sau bước này.
3. **RED** — thêm ca §4.5 #1, #2a/2c, #3, #6, #7a/#7b/#7c và **giữ/thêm** đối chứng #2b, #4, #8 vào
   `permission-catalog-snapshot.spec.ts`; sửa ca ghim #5. Chạy: phải ĐỎ **đúng** những ca gắn nhãn 🔴 và
   XANH mọi ca cũ. **Ghi lại số đỏ** — đối chiếu với bảng §4.5, lệch một ca là dấu hiệu nhãn sai.
4. **GREEN M2** — áp khối §3.2 (tách «khởi động load HÁO HỨC» khỏi «thân chờ»).
   ⚠️ **KHÔNG** dùng `Promise.resolve().then(async …)` và **KHÔNG** thử «gán `inFlight` trước khi khởi
   động thân» — §3.2 giải thích vì sao cả hai đều sai. Ca §4.5 #6 xanh.
   **Cổng:** ca `:78-83` và `:85-108` phải còn xanh **không sửa một chữ**. Phải sửa chúng ⇒ bản vá sai.
5. **GREEN M1** — nhánh rỗng + `cause` + sàn thử-lại (§4.2, §4.3, §4.6). Ca #1, #2a/2c, #3, #7 xanh.
6. `permission.service.ts:322-331` — message phân nhánh theo `cause`, thêm trường `cause`, `degradedTo`
   giữ công thức theo `phase` (§4.7). Thêm ca ghim nội dung dòng log.
7. Seed catalog canh cho **cả 7 stub** theo luật 3 vế §4.4 (không chờ tới lúc đỏ mới sửa: `[]` giờ là
   một stub nói dối, bất kể ca có đỏ hay không).
8. **ĐO ĐÚNG BỀ MẶT** — chạy **toàn** `apps/api` (`pnpm --filter @mediaos/api test`), KHÔNG phải riêng
   `src/permission` + `src/dashboard`: 2 trong 7 stub nằm ở `apps/api/test/foundation/**` và sẽ vô hình
   với phạm vi hẹp. Đối chiếu với 5 ca đã đo tay ở §4.4 — kỳ vọng **0 ca đỏ** nhờ vế (b); ca nào vẫn đỏ
   ⇒ **DỪNG**, áp vế (c), không sửa `expect`.
9. ADR `DECISIONS-12` §5.3: thêm **D9** (gồm sàn §4.6 + bất đối xứng với D2 + forensics §4.8), **thu hẹp
   câu chữ D3** («ảnh chụp đã nạp **và KHÔNG RỖNG**…»), ghi tham số `cause`.
10. `bash harness/check.sh --all --lane-db` xanh không banner.
    ⚠️ **KHÔNG** dùng `--all` trần: `--all` chỉ **escalate ĐỎ khi int-spec bị SKIP**, nó không tự chạy
    chúng (`harness/check.sh:23,181`); chỉ `--lane-db` mới gọi `scripts/lane-db-setup.sh` (`:114,135`).
11. **FULL gate** (CLAUDE.md §6, crown-jewel — `can()` hot-path): `security-reviewer` +
    `silent-failure-hunter` + `typescript-reviewer` + `santa-method`.
    `database-reviewer` **bỏ có lý do**: WO không có migration, không đổi schema, không đổi query.
12. PR — KHÔNG push thẳng master.

---

## 6. Ngoài phạm vi — ghi tường minh

- **KHÔNG** đụng `getCapabilities()` / `use-can.ts` — đó là `S14-SEC-CAPWILDCARD-1`.
- Hai điểm LOW cùng vòng review (`permission.decide.ts:138-171` mất cờ `requiresReauth` ở trạng thái mới;
  `permission.service.ts:456-469` `perAction` keyed bằng `spec.action`) — **KHÔNG gộp**. Cả hai đổi hành vi
  ở đường khác (`file_access_logs.denied_reason` đi RA NGOÀI; `hr-read.service.ts:122-128` là call-site
  thật) ⇒ trộn vào đây làm diff FULL-gate to ra vì lý do không liên quan.
- KHÔNG đổi TTL, timeout, `epoch`, single-flight, seed, migration.
- **`permission.service.ts:519-520`** (`listGrantableScopes`) đã có nhánh `catalog.length === 0 → []`
  **không log**. Sau khi D9 tuyên bố «rỗng = hạ tầng hỏng», nhánh đó thành «im lặng bảo bạn không được cấp
  gì», và ADR §2 nói ba bản cài đặt luật sensitive là MỘT HỌ ⇒ để lệch là để một thành viên trong họ trôi.
  **Vẫn để NGOÀI phạm vi**, có lý do: nó là **gợi ý UI** cho bộ chọn scope PAT, không phải cổng quyền
  (`create` vẫn ép lại `scope ⊆ grant`), và vá nó kéo `auth`/PAT vào một diff FULL-gate đang nói về
  `can()`. **Hành động thay thế:** mở WO nối tiếp `S14-SEC-GRANTSCOPE-EMPTYLOG-1` (một dòng log), ghi ở
  §8 dưới đây.
- Nhánh `catch` (D2) **không** được áp sàn thử-lại — bất đối xứng có chủ đích, lý do §4.6.

---

## 7. Rủi ro

| Rủi ro                                                                         | Giảm thiểu                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed catalog cho 7 stub làm đỏ dây chuyền ở spec khác                          | Chạy từng file, không sửa hàng loạt mù; nếu một stub cần đổi quá sâu thì DỪNG và ghi lại, không hạ sàn `isPairSensitive`                                                                                                                                                                                                                                                                                                           |
| Bản vá M2 làm `load()` không còn được gọi ĐỒNG BỘ ⇒ ca D6 `:103` đỏ            | Đã tránh bằng thiết kế: §3.2 giữ `load()` háo hức, chỉ hoãn phần **chờ**. Ca `:78-83` và `:85-108` phải còn xanh **không sửa một chữ** — nếu phải sửa chúng thì bản vá đã sai, quay lại §3.2                                                                                                                                                                                                                                       |
| Catalog rỗng THẬT trên môi trường mới (DB chưa seed) giờ khoá mọi cặp = `true` | Đúng chủ đích: siết + có log; sàn §4.6 chỉ 5s nên seed xong là tự phục hồi trong ≤5s. **Không đẻ ra kiểu hỏng «từ chối người dùng hợp lệ»**: cửa sổ rỗng thực tế duy nhất = «schema đã migrate, migration seed chưa chạy» — lúc đó **grant cũng rỗng** ⇒ quyết định không đổi. Không migration nào TRUNCATE `permissions`; `apps/api/test/helpers/seed.ts:732-735` chỉ xoá `object_permissions`/`role_permissions`. Ghi vào ADR D9 |
| Sàn §4.6 kéo dài cửa sổ suy biến (5s không thấy catalog vừa được seed)         | 5s ≪ TTL 300s, và `reset()` (seam D7 mà int-spec đã dùng sau khi seed cặp mới — `dash-wildcard-sensitive-gate.int-spec.ts:177`) gỡ luôn sàn. Không có đường sản phẩm nào cần độ trễ dưới 5s                                                                                                                                                                                                                                        |

---

## 8. Việc nối tiếp — KHÔNG làm trong WO này

| WO                              | Nội dung                                                                                                                                                        | Vì sao tách                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S14-SEC-GRANTSCOPE-EMPTYLOG-1` | `permission.service.ts:519-520` — nhánh `catalog.length === 0 → []` im lặng, thành viên thứ ba của «họ luật sensitive» (ADR §2) chưa đồng bộ với D9             | Là gợi ý UI cho bộ chọn scope PAT, **không** phải cổng quyền (`create` vẫn ép `scope ⊆ grant`); vá nó kéo `auth`/PAT vào một diff FULL-gate đang nói về `can()` |
| (đã có trong `notes` của WO)    | 2 điểm LOW cùng vòng review 04/09: `permission.decide.ts:138-171` mất cờ `requiresReauth`; `permission.service.ts:456-469` `perAction` keyed bằng `spec.action` | Đổi hành vi ở đường khác (`file_access_logs.denied_reason` đi RA NGOÀI; `hr-read.service.ts:122-128` là call-site thật)                                         |

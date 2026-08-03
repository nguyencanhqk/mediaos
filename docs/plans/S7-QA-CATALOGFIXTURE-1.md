# S7-QA-CATALOGFIXTURE-1 — Fixture test không được đổi `permissions.is_sensitive` của cặp chính tắc

> Zone **đỏ** · module FOUNDATION · layer QA · WO trong `harness/backlog.mjs`.
> Sinh ra từ FULL gate `S7-CHAT-BE-GATE-3` (commit `03f9a924`), sau khi tiền đề của WO
> `S7-AUTH-CAPSWEEP-1` bị chứng minh là SAI và WO đó bị gỡ (đính chính `4f52948c`).

---

## 1. Vấn đề — cơ chế, không phải một lỗi lẻ

`permissions` là catalog **TOÀN CỤC**: không có `company_id`, nên `cleanupTenants()` (xoá theo
`company_id`) **không bao giờ** chạm tới nó. Helper test `seedPermissionCatalog()` lại dùng:

```sql
ON CONFLICT (action, resource_type) DO UPDATE SET is_sensitive = EXCLUDED.is_sensitive
```

⇒ một fixture khai lệch **một** cờ là **ghi đè vĩnh viễn** lên lane DB. Không có ai dọn, và không có
tín hiệu nào.

Bán kính sát thương là **cả suite**, không phải một file: CI đặt `LANE_DB: mediaos`
(`.github/workflows/api.yml`) nên mọi spec dùng **chung một DB**.

Hệ quả không phải lý thuyết. `is_sensitive` là **cổng** của `getCapabilities()`
(`permission.service.ts`): cặp sensitive bị lọc khỏi `/auth/me` trừ khi nằm trong
`SENSITIVE_CAPABILITY_ALLOWLIST`. Lật một cặp sản phẩm sang `true` = **đổi hành vi phân quyền của mọi
spec dùng chung DB**.

**Ca thật.** `WRITER_PAIRS` của `chat-be5-derived-rooms.int-spec.ts` khai `['update','project',…,true]`
trong khi catalog chính tắc là `false` (mig `0005:224`; `0485` bước (b) chỉ nâng 8 cặp khác) ⇒ 3 ca
`TASKCAP-P1/P2/P3` của `auth-me-capabilities.int.spec.ts` — **spec khác, module khác** — đi ĐỎ.

### 1.1 Bài học phương pháp (phần đắt nhất)

Hỏng nằm trong **DB**, không nằm trong **code**. Nên phép thử "`git stash` rồi chạy lại trên **cùng**
lane" — trông rất thuyết phục — **không phân biệt được loại lỗi này**: stash bao nhiêu lần thì hàng
catalog vẫn `t`. Một phiên đã dùng đúng phép thử đó và kết luận nhầm thành "lỗ phân quyền có sẵn trên
nhánh", suýt seed một WO sai tiền đề.

> **Muốn quy trách nhiệm cho code thì phải đổi DB SẠCH, không phải đổi code.**

---

## 2. Đo hiện trạng trước khi sửa (2026-08-03)

| Phép đo | Cách làm | Kết quả |
| --- | --- | --- |
| Catalog chính tắc | lane DB dựng mới `mediaos_s7qacatref`, chain-migrate `0000→latest`, chưa chạy test nào | **387 cặp · 129 sensitive** |
| Số điểm gọi `seedPermissionCatalog` | `git grep` toàn `apps/api` | **170 điểm gọi / 119 file spec** |
| Trong đó giải được literal tĩnh | quét AST-thô | 71 (99 điểm còn lại nằm trong vòng lặp qua mảng cặp ⇒ **grep tĩnh KHÔNG kết luận được**) |
| Caller đang lật cờ cặp chính tắc | **đo thực nghiệm**: tạm ghi log MỌI lời gọi, chạy đủ 119 file trên lane sạch, đối chiếu với catalog chính tắc | **0** |
| Cặp do test tự chế (ngoài catalog) | cùng lượt đo | 14 (`*:*`, `view:doc`, `px-res-*`, …) — hợp lệ |
| Cặp bị hai spec đòi hai giá trị khác nhau | cùng lượt đo | **0** |

Xác nhận độ phủ: **119/119** file caller đều quan sát được lời gọi trong lượt đo ⇒ không file nào
lọt vì skip/lỗi sớm.

**Kết luận đo:** cây hiện tại **sạch** — offender duy nhất đã được vá ở `4f52948c`. Việc của WO này
là **dựng cơ chế** để lần sau không xảy ra được, chứ không phải đi dọn.

> Vì sao không dùng grep tĩnh làm bằng chứng: 99/170 điểm gọi truyền biến (`sensitive ?? false`,
> `SENSITIVE.has(action)`, `pair[2]`…). Grep sẽ trả lời "không thấy gì" một cách rất tự tin và sai.

---

## 3. RED-proof (chạy trên `mediaos_s7qacatred`, code **không sửa một dòng**)

| Bước | Hành động | Kết quả |
| --- | --- | --- |
| 1 | lane DB sạch → chạy `auth-me-capabilities.int.spec.ts` | **48/48 XANH** |
| 2 | spec "attacker" gọi `seedPermissionCatalog(direct,'update','project',true)` | XANH; hàng catalog `f → t` |
| 3 | chạy LẠI `auth-me-capabilities.int.spec.ts` | **3 ĐỎ** — đúng `TASKCAP-P1/P2/P3` |

Đây là RED-proof thật: **không có thay đổi code nào giữa bước 1 và bước 3**, chỉ có DB đổi.

---

## 4. Bản vá

### 4.1 Tuyến 1 — `seedPermissionCatalog` thành INSERT-ONLY với `is_sensitive`

`apps/api/test/helpers/seed.ts`. `DO UPDATE` → **`DO NOTHING`** (cặp đã có thì **không phát sinh câu
ghi nào**), rồi đối chiếu và **NÉM** nếu caller đòi giá trị khác:

- cặp **chưa có** → INSERT với giá trị của caller (fixture tự chế cặp riêng: thoải mái);
- cặp **đã có, đúng giá trị** → trả `id`, idempotent;
- cặp **đã có, khác giá trị** → **ném ngay tại spec gây ra**, thông báo nêu tên cặp · giá trị trong
  catalog · giá trị fixture đòi · và 3 lối thoát đúng.

Nguyên tử ⇒ an toàn với vitest chạy song song nhiều worker trên cùng lane DB. `direct.query` chạy
autocommit ⇒ `DO NOTHING` không trả hàng nghĩa là hàng **đã commit**, không có cửa sổ rollback.

### 4.2 Tuyến 2 — `apps/api/test/global-catalog-fence.ts` (globalSetup mới)

Tuyến 1 chỉ canh được đường **đi qua nó**. Các đường khác vẫn lọt: spec `UPDATE permissions` thẳng,
một helper seed mới chép nhầm khuôn cũ, code sản phẩm tự ghi catalog. Tuyến 2 **chụp catalog đầu
suite, đối chiếu cuối suite**, ĐỎ nếu cờ của cặp nào đổi (cặp **mới** xuất hiện là hợp lệ).

Cố ý **không** pin danh sách cặp trong repo: pin thì mỗi migration thêm quyền lại phải sửa fixture
(churn + sẽ bị sửa-cho-xanh theo phản xạ — đúng bẫy `canonical-seed-pin-regression`). So-sánh
trước/sau đo đúng thứ cần đo và tự động đúng với mọi migration về sau.

> ⚠️ **Bẫy đã đo và đã vá trong chính bản vá này:** vitest 3.2.6 **in** lỗi teardown ra màn hình dưới
> nhãn "Startup Error" nhưng **vẫn thoát 0**. Đai 2 bản đầu là *in-đỏ-mà-CI-xanh*. Phải gán
> `process.exitCode = 1` tường minh. Đo cả hai chiều: không có dòng đó → `exit 0`; có → `exit 1`.
> (Đã thử thêm listener `'exit'` để ép lại — không cần, vitest không ghi đè sau teardown.)

**Giới hạn, nói thẳng:** đây là phép so trước/sau **trong một lượt chạy**. Nó bắt đúng lượt **gây ra**
thay đổi. Lane DB đã bẩn từ lượt **trước** thì `before` đã mang giá trị bẩn ⇒ lượt sau im lặng (đã
đo). CI luôn dựng DB mới nên ở CI luôn bắt được; máy local dùng lại lane thì phải `--reset`.

### 4.3 Chốt hồi quy — `test/integration/seed-permission-catalog-guard.int-spec.ts`

5 ca, chạy trên Postgres thật (mock sẽ đo bản chép tay của chính bản vá):

| Ca | Nội dung |
| --- | --- |
| G1 | đòi đổi cờ cặp đã có ⇒ **ném**, và **hàng trong DB không đổi** (vế thứ hai là vế quan trọng: bản vá "ném **sau khi** đã ghi đè" vẫn làm bẩn lane y hệt bản cũ) |
| G2 | thông báo lỗi nêu đủ tên cặp + cả hai giá trị (sửa được ngay từ log, không cần mở DB) |
| G3 | gọi đúng giá trị ⇒ đi qua, idempotent, cùng một `id` |
| G4 | cặp **riêng của test** vẫn tạo được với `is_sensitive=true` — lối thoát còn mở |
| G5 | luật áp cho **mọi** cặp, không riêng cặp sản phẩm: đổi cờ cặp tự chế cũng ném |

G1 **cố ý không pin** `update:project = false` — nó đọc giá trị thật rồi đòi giá trị ngược lại. Pin ở
đây là dựng chỗ-thứ-hai-phải-sửa mỗi khi migration đổi cờ. Việc pin giá trị chính tắc thuộc
`auth-seed-canonical-roles.int-spec.ts`.

**Spec tự dọn cặp probe của nó** (`afterAll`), và **chỉ dọn khi chính nó tạo ra** (`probePreExisted`).
Hai lý do, cả hai đều là lỗi đã mắc rồi sửa trong chính phiên này:

1. Cặp thường trực trong catalog toàn cục sẽ **góp thêm nguồn cho flake đã biết**
   `super-admin-bootstrap-flaky-count` — spec đó assert `count(grant của SA) == count(catalog)`, nên
   một cặp xuất hiện **sau** khi SA được provision là ĐỎ ở spec khác. Đúng cái họ lỗi WO này đang vá.
2. Bản đầu xoá **vô điều kiện** và tự bắn vào chân: trên lane còn sót cặp probe từ lượt trước,
   `afterAll` xoá một hàng **có trong ảnh chụp đầu suite** ⇒ đai 2 báo "cặp BIẾN MẤT" ⇒ cả lượt đỏ
   (đã tái hiện và đã đo). **Dọn rác phải biết đâu là rác của mình.**

---

## 5. Nghiệm thu

| Phép đo | Kết quả |
| --- | --- |
| Spec chốt guard (5 ca) | **5/5 XANH** |
| Attacker (fixture lật cờ) chạy lại | **ĐỎ ngay tại attacker**, hàng catalog vẫn `f` |
| `auth-me-capabilities.int.spec.ts` **sau khi** attacker chạy | **48/48 XANH** ← `done_when` #2 |
| Attacker ghi **thẳng SQL** (tuyến 1 mù) | đai 2 ĐỎ cuối suite, `exit 1`, nêu đúng `update:project : false → true` |
| Catalog sạch | `exit 0` — không đỏ giả |
| 119 file caller trên lane sạch | xem §6 |
| typecheck · lint | xem §6 |

---

## 6. Số đo lượt chạy cuối

`bash harness/check.sh --lane-db=s7qacatfull` (2026-08-03, sau khi mọi sửa đã chốt):

| Step | Kết quả |
| --- | --- |
| secret-literals · lint · typecheck · migration-no-drop · tooling-tests | ✅ |
| `@mediaos/app` 200 · `auth` 4 · `console` 23 · `contracts` 32 · `ui` 16 · `web-core` 39 | ✅ toàn bộ |
| `@mediaos/api` | 492/492 file chạy · **1 ca đỏ** — xem dưới |
| **Đai 2 có nổ trong cả lượt không** | **0 lần** (`grep "ĐÃ LÀM ĐỔI catalog"` = 0) ⇒ không có spec nào trong TOÀN suite làm đổi cờ catalog, và cũng không có đỏ giả |

⚠️ **Đọc "0 lần nổ" cho đúng sức nặng của nó.** Lượt đo chạy qua `chunk-test.mjs` = **13 lượt
`vitest run` riêng biệt**, mỗi lượt một cặp before/after ĐỘC LẬP, và lượt đó có **3 lần chạy lại vì
crash hạ tầng** (tinypool, KI-014). Một chunk chết giữa chừng thì teardown của nó không kịp chạy ⇒
"0 lần nổ" nghĩa là *"không chunk nào hoàn tất mà thấy catalog đổi"*, KHÔNG mạnh bằng *"toàn suite
không đụng catalog"*. Bằng chứng độc lập và mạnh hơn cho vế sau: sau khi chạy hết 119 file caller,
`count(*) FROM permissions` = **387**, đúng bằng DB vừa migrate sạch.

Riêng 119 file caller `seedPermissionCatalog` chạy trên lane sạch: **119/119 XANH**.
`chunk-test.mjs --packages=@mediaos/api` chạy độc lập trước đó: **492/492 XANH**.

### Ca đỏ duy nhất — `outbox-fifo.int-spec.ts`, KHÔNG thuộc WO này

`S7-INT-OUTBOX-FIFO-1 … consumer nhận event theo đúng thứ tự available_at` — `expected 11 to be 12`.
Bốn căn cứ nói nó không liên quan, không phải một căn cứ:

1. Spec đó **không gọi `seedPermissionCatalog`** (grep = 0) ⇒ tuyến 1 không với tới nó.
2. Đai 2 **không nổ lần nào** trong chính lượt chạy đó ⇒ không phải tuyến 2.
3. **Thông điệp assert do chính tác giả spec viết đã gọi tên nguyên nhân**: *"probe bị worker của
   spec khác claim mất — KHÔNG phải lỗi thứ tự; chạy lại cô lập file này"*.
4. **Flaky khi chạy cô lập**: 5 lượt → 1 đỏ / 4 xanh.

Đây thuộc họ `KI-059` (memory `outbox-returning-order-not-fifo`: *"xanh khi chạy một mình, đỏ dưới
tải"*). **Có một thứ mới đáng bàn giao:** handoff phiên trước ghi *"lô int-spec thứ hai đỏ 1 lần
trong 4 lượt, KHÔNG bắt được tên ca"* — **đây chính là ca đó, giờ đã có tên**. Việc thu hẹp cửa sổ
tranh probe là của WO khác, không gộp vào đây.

---

## 6b. FULL gate (zone đỏ) — 3 reviewer độc lập, 2026-08-03

`security-reviewer` **PASS** (0 CRITICAL / 0 HIGH) · `qa-test-engineer` **BLOCK** · `completion-evaluator`
**BLOCK** (82/100). Gate làm đúng việc của nó: **bắt được một lỗi thật mà cả 5 ca test của tôi đều
không thấy**, và bác một khẳng định "đã đo" của tôi. Xử lý:

| # | Phát hiện | Xử |
| --- | --- | --- |
| 1 | **[HIGH, tái hiện được]** Cặp probe `view:qacatfix-probe-sensitive` **commit thật** rồi bị `DELETE` ở `afterAll`. `SuperAdminBootstrapService` grant **toàn bộ catalog**, và `role_permissions.permission_id` là `ON DELETE CASCADE` ⇒ nếu boot rơi vào lúc probe tồn tại, `DELETE` **âm thầm xoá luôn grant đó** ⇒ `super-admin-bootstrap.int-spec.ts` đỏ `expected 386 to be 387`. Reviewer ép cửa sổ và **tái hiện được**. Comment của tôi khẳng định "cặp này không được grant cho role nào" — **SAI**. | **VÁ.** G4/G5 giờ chạy trong transaction **ROLLBACK** (`withRolledBackTx`, pool `max:1`) ⇒ probe **không bao giờ commit** ⇒ session khác không thấy được, hết cascade, hết đua `count(*)` với `task-permissions-seed` / `s7-chat-db1-invariants`, hết rác khi worker crash, và bỏ luôn cờ `probePreExisted`. Thêm **G6** đo bằng connection KHÁC rằng probe không rò ra. Đo sau vá: `count(probe)=0`, catalog **387** — đúng bằng DB vừa migrate sạch. |
| 2 | **[MEDIUM ×2]** `global-catalog-fence.ts` nhánh `catch` **fail-OPEN**: `console.warn` + `return undefined` ⇒ một lỗi kết nối nhất thời dưới tải là **tắt cả đai 2** cho lượt đó, exit 0. Đúng khuôn "in-cảnh-báo-mà-CI-xanh" mà chính file này chống ở chỗ khác. | **VÁ.** Fail-CLOSED: ném, trừ khi `TEST_DB_FENCE_ALLOW_UNREACHABLE=1` (dùng LẠI cổng đã có của db-fence, không đẻ biến bypass mới). Đo cả hai chiều trên DB có con dấu nhưng **không có bảng `permissions`**: mặc định → **exit 1**; có biến → **exit 0** + cảnh báo, test vẫn chạy. |
| 3 | **[BLOCK]** Comment `process.exitCode = 1` khẳng định "đo được: không có dòng này thì vitest thoát 0". **Khẳng định SAI.** | **ĐÍNH CHÍNH.** Đo A/B lại trên trạng thái thực sự vi phạm: **có dòng → exit 1 · GỠ dòng → exit 1**. Số đo cũ vô hiệu vì lượt "exit 0" ấy chạy trên lane **đã bẩn sẵn** nên `before == after` ⇒ đai không hề nổ. Gốc: `vitest/dist/chunks/cac.0BJqEUeA.js:1421` — `if (process.exitCode == null) process.exitCode = 1`. Dòng được **giữ làm phòng thủ** cho vế `== null`, và comment nay nói đúng vai trò đó. |
| 4 | **[MEDIUM]** Đai 2 không có test tự động ⇒ sẽ mục sau vài lần refactor. | **VÁ.** Tách hàm thuần `diffCatalogFlags()` + `test/global-catalog-fence.unit-spec.ts` (7 ca, không cần DB), gồm ca **cặp MỚI phải IM LẶNG** (nếu siết nhầm thì lời khuyên "tự chế cặp riêng" thành cái bẫy). RED-proof: đổi `!==` thành `nowSensitive && !wasSensitive` ⇒ **2 ca chết** đúng chỗ. |
| 5 | **[LOW]** G3/G4 **không** chết khi lật ngược bản vá; G1 chết ở dòng `rejects`, không phải ở assert thứ hai. | **SỬA CHỮ.** Docstring nay ghi rõ chỉ **G1·G2·G5** bắt bug này; G3/G4 chống hồi quy *khác* (bản vá siết quá tay). Comment G1 nói đúng vai trò assert thứ hai: bắt biến thể "ném SAU KHI đã ghi". |
| 6 | **[LOW]** Thông điệp nhánh 0-hàng quy tội một chiều ("có tiến trình đang XOÁ") — `DO NOTHING` không hứa "0 hàng ⇒ đã commit". | **SỬA CHỮ.** Nêu cả hai nguyên nhân. |
| 7 | **[BLOCK]** Plan hứa "việc thu hẹp cửa sổ tranh probe là của WO khác" nhưng **WO đó không tồn tại** (KI-059 đã đóng). Bàn giao chỉ nằm trong văn xuôi ⇒ sẽ mất. | **SEED WO** `S7-QA-OUTBOXPROBE-1` trong `harness/backlog.mjs`, phạm vi hẹp đúng phần tranh chấp probe, kèm `done_when` cấm nới assert thứ tự. |

**Chưa làm, ghi để không ai đọc thành đã xong:** đai 2 cố ý cho qua **cặp MỚI**, mà migration seed bằng
`ON CONFLICT DO NOTHING` ⇒ trên một lane DB không được chain-migrate lại, một fixture tạo trước tên cặp
chính tắc sẽ thắng vĩnh viễn. Đường vào hẹp (`lane-db-setup.sh` luôn migrate, CI luôn DB mới) nhưng có
thật. Ngoài ra suite hiện để lại **6 cặp thường trực** do các spec KHÁC tự chế (`*:*`, `view:doc`,
`manage:dashboard`, 3× `px-res-*`) — nằm ngoài `done_when` của WO này.

---

## 7. Không làm trong WO này (nói rõ để không ai đọc thành đã xong)

- **Không** pin toàn bộ 387 cặp catalog vào repo — xem §4.2 phần lý do.
- **Không** đụng `SENSITIVE_CAPABILITY_ALLOWLIST` hay bất kỳ đường phân quyền chạy thật nào. Bản vá
  này nằm **hoàn toàn trong tầng test**; không có thay đổi nào ảnh hưởng runtime của `apps/api`.
- **Không** canh các cột khác của `permissions` (chỉ `is_sensitive` — cột duy nhất có đường ảnh hưởng
  chéo-spec đã chứng minh được). Đai 2 sẽ phải mở rộng nếu sau này có cột toàn cục khác lái hành vi.

# S18-QA-PIPELINEREPLAY-1 — `task-pipeline-backfill-0500` replay 0500 lên TOÀN BỘ project của lane

> WO **vàng** (QA, LIGHT gate). Cùng động cơ với `S18-QA-ASSETFLAKE-1` (`#480`): mỗi ca đỏ-không-thật
> là thuế đánh vào MỌI WO sau. **Khác cơ chế**: ở ASSETFLAKE là phép ĐẾM thiếu vế sở hữu; ở đây là
> một câu GHI có bán kính toàn cục.
>
> Giao thức đo §4 dùng lại nguyên xi của `docs/plans/S18-QA-ASSETFLAKE-1.md` §4.

---

## 1. Bối cảnh — vì sao WO này tồn tại

Quan sát gốc, đo được trong `S18-QA-ASSETFLAKE-1` (07/09/2026, lượt xác minh 1/5 **sau** khi vá):

```text
error: insert or update on table "project_states"
       violates foreign key constraint "project_states_project_id_fkey"
  tại task-pipeline-backfill-0500.int-spec.ts:150   (câu replay 0500)
```

Không xuất hiện ở 5 lượt trước đó ⇒ **tỉ lệ chưa biết**. Một lần quan sát không đủ để gọi tên: §4 đo lại
có kiểm soát.

---

## 2. Ca đang làm gì (đọc code, không suy đoán)

`apps/api/test/integration/task-pipeline-backfill-0500.int-spec.ts` dựng dữ liệu "hình dạng
production" rồi **replay toàn bộ SQL của migration 0500** trong một transaction trên connection riêng,
`ROLLBACK` ở cuối:

```ts
async function run0500(client: PoolClient): Promise<void> {
  const sql = readFileSync(MIGRATION_0500_SQL, "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) { ... await client.query(trimmed); }
}
```

Docblock của chính file này (dòng 5-8) tự khai:

> "hermetic, **không đụng dữ liệu spec khác chạy song song** (0500 idempotent by-design nên re-run là
> hành vi hợp lệ)"

**Câu đó SAI, và nó là lý do lỗi này sống lâu mà không ai soi.** `ROLLBACK` bảo đảm không để lại *dấu
vết*; nó không bảo đảm không *đụng tới*. Bán kính GHI trong lúc transaction còn sống là toàn cục.

---

## 3. Cơ chế — hai vế, cả hai đọc được từ code

### 3.1 Vế A — 0500 ghi TOÀN CỤC, không lọc tenant

`apps/api/migrations/0500_s5_pipeline1_backfill_states_and_state_id.sql` có **hai** điểm chèn
`project_states`, cả hai duyệt `projects` không kèm bất kỳ vế `company_id` nào:

| Điểm | Dòng | Tập đích |
| --- | --- | --- |
| seed bộ mặc định | `:38-51` | `FROM projects p WHERE p.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM project_states ps WHERE ps.project_id = p.id AND ps.deleted_at IS NULL)` |
| bậc thang thiếu nhóm | `:95-122` | cùng khuôn, `NOT EXISTS` theo nhóm |

Đúng như một migration phải thế — nó chạy một lần trên toàn DB. Vấn đề là **replay nó trong một lane
DB dùng chung với 16 chunk spec khác** thì "toàn DB" nghĩa là "cả project của người khác".

### 3.2 Vế B — `cleanupTenants` CHẾ RA đúng tiền đề của vế A

`apps/api/test/helpers/seed.ts` — **không có `BEGIN`/`COMMIT` trong toàn hàm**; mỗi câu là một
statement autocommit riêng trên pool:

```text
:654  DELETE FROM tasks           WHERE company_id = ANY(...)
:657  DELETE FROM project_states  WHERE company_id = ANY(...)
:666  DELETE FROM projects        WHERE company_id = ANY(...)
```

Giữa `:657` và `:666` có một cửa sổ **đã commit, nhìn thấy được từ transaction khác**, trong đó project
của tenant đó tồn tại với **đúng 0 hàng** `project_states`.

Đó **chính xác** là tập đích của vế A. Nên quan hệ giữa hai vế không phải "đua ngẫu nhiên" mà là:
**`cleanupTenants` sản xuất ra tiền đề khiến 0500 nhắm vào một project sắp bị xoá.** Cửa sổ rộng bằng
9 câu DELETE, không phải bằng một lệnh.

### 3.3 Vì sao ra 23503 chứ không phải "0 hàng"

READ COMMITTED: câu `INSERT ... SELECT` lấy snapshot lúc statement bắt đầu ⇒ vẫn thấy project còn
sống. Kiểm tra khoá ngoại thì chạy theo trạng thái **hiện tại**. `:666` commit xen vào giữa hai thời
điểm đó ⇒ hàng vừa chèn trỏ vào một project không còn ⇒ `project_states_project_id_fkey` (23503).

Đúng họ với memory `fresh-lane-db-exposes-teardown-ri-race`.

### 3.4 Chiều ngược lại — có, nhưng tự lành

0500 cũng có thể chèn `project_states` cho project của tenant khác **sau** `:657` của tenant đó ⇒ `:666`
của họ vỡ FK. Thực tế không thành ca đỏ: `:666` phải chờ khoá tới khi transaction replay kết thúc, mà
nó kết thúc bằng `ROLLBACK` ⇒ hàng biến mất, DELETE đi tiếp. Cái giá là **chờ khoá**, không phải đỏ.
Ghi ở đây để không ai đi vá một chiều không tồn tại.

### 3.5 Vì sao tỉ lệ đi theo ĐỘ BẨN của lane

`S18-QA-ASSETFLAKE-1` §9.1 đã đo: 0/5 lượt dính khi lane vừa dựng, 2/6 sau khi lane tích rác (681
company · 80 project · 999 role tenant sót lại từ chunk crash — chunk chết thì `cleanupTenants` không
chạy). Vế A duyệt **mọi** project ⇒ bán kính ghi phình theo rác. ⇒ **§4 phải đo trên CẢ HAI trạng
thái lane**; đo một trạng thái là ra tỉ lệ sai.

---

## 4. Giao thức đo (done_when #1)

- lane riêng dựng sạch: `bash scripts/lane-db-setup.sh s18pipereplay --reset`
- nạp **chỉ mật khẩu** qua `scripts/lib/db-secrets.sh` → `db_secrets_load` (helper cố tình KHÔNG
  export `DATABASE_*_URL` — vector KI-028). **KHÔNG `source .env`** (đầu độc `NODE_ENV` của test run).
- `node harness/chunk-test.mjs --packages=@mediaos/api` với `LANE_DB=mediaos_s18pipereplay`,
  `TURBO_FORCE=1` — KHÔNG chạy riêng file, hiện tượng chỉ có ở lane chung.
- **n = 5** lượt mỗi trạng thái lane. Ghi mã thoát + thời lượng + **tên ca đỏ**.

> ⚠ **Mã thoát KHÔNG đủ để kết luận** (memory `mutation-red-can-be-ipc-flake`). Lượt đo đầu của WO
> này trả `rc=1` ×5 trong 15 giây với **0 ca đỏ**: `vitest` chưa từng chạy — `vitest.config.ts:57`
> fail-closed vì `LANE_DB` được set mà thiếu `APP_DB_PASSWORD`. Nếu chỉ đọc `rc` thì bảng dưới đã ghi
> "5/5 đỏ". Cột `FAIL:` (tên ca) là thứ chặn kết luận sai đó — giữ nó trong mọi lượt đo sau.

### 4.1 Kết quả — lane VỪA DỰNG (09/09/2026, `mediaos_s18pipereplay --reset`)

| Lượt | rc | thời lượng | FK vỡ | ca đỏ |
| ---- | -- | ---------- | ----- | ----- |
| 1 | 0 | 470s | 0 | — |
| 2 | 0 | 359s | 0 | — |
| 3 | 0 | 374s | 0 | — |
| 4 | 0 | 415s | 0 | — |
| 5 | 0 | 378s | 0 | — |

**Tỉ lệ đỏ trên lane vừa dựng: 0/5.** Khớp với §9.1 của ASSETFLAKE (0/5 khi lane sạch) ⇒ **một mình
con số này KHÔNG bác bỏ được lỗi**, nó chỉ xác nhận điều kiện kích hoạt nằm ở chỗ khác. Đây chính là
lý do WO yêu cầu đo hai trạng thái.

**Độ bẩn tích được sau 5 lượt sạch** (đo trên lane): `companies=191`, **`projects=0`**,
`project_states=0`. Đáng chú ý: teardown dọn sạch project nhưng **để sót company**. Nghĩa là rác
project — thứ DUY NHẤT làm phình tập đích của 0500 — chỉ sinh khi một chunk **crash** giữa chừng
(`cleanupTenants` không chạy), không sinh ra từ việc dùng lại lane bình thường.

### 4.2 Kết quả — lane ĐÃ TÍCH RÁC

Rác **tổng hợp**, vì lý do vừa nêu: chờ crash tự nhiên thì không điều khiển được về lượng. Gieo 80
project (`RAC-s18pipereplay-*`) trên các company sót, **cố ý không tạo `project_states`** ⇒ cả 80 rơi
đúng vào tập đích `NOT EXISTS` của 0500 `:38-51`. Xác nhận sau khi gieo: `projects=80`,
`projects_thieu_state=80`. Mô phỏng số đo ~80 project của ASSETFLAKE §9.1.

| Lượt | rc | thời lượng | FK vỡ | ca đỏ |
| ---- | -- | ---------- | ----- | ----- |
| 1 | 0 | 380s | 0 | — |
| 2 | 0 | 494s | 0 | — |
| 3 | 0 | 449s | 0 | — |
| 4 | 0 | 426s | 0 | — |
| 5 | 0 | 497s | 0 | — |

**Tỉ lệ đỏ trên lane đã tích rác: 0/5. Cộng §4.1 ⇒ 0/10.**

**Kết luận âm tính, và mô hình khuếch đại của §4.2 SAI — nói thẳng để không ai đọc quá lên.** 80 project
rác chỉ thêm ~480 hàng vào câu `INSERT` (vài mili-giây) — không nới cửa sổ đua được đáng kể. Điều kiện
kích hoạt **không** phải "có project nằm ì trong lane" mà là **một spec chạy song song đang TẠO rồi
XOÁ project** ngay trong lúc replay, tức phải trúng lịch chunk (ranh giới chunk lại trôi mỗi lần
thêm/bớt một spec — ASSETFLAKE §4.1). Rác nằm ì không mua được điều đó.

⇒ Chạy thêm n lượt suite nữa cũng có thể 0/n mà **không chứng minh được gì**: quan sát gốc là thật,
nó chỉ hiếm. Vì vậy chuyển sang §4.3 thay vì đốt thêm lượt.

### 4.3 Phép thử CÓ CHỦ ĐÍCH — tái hiện TẤT ĐỊNH (thay cho việc đo thêm)

Thay vì chờ lịch chunk xếp đúng, dựng thẳng cửa sổ §3.2:

1. Gieo 83.100 project mồ côi (thiếu `project_states`) ⇒ câu `INSERT` của 0500 chạy **61.408 ms**
   (đo thật). Cửa sổ giữa snapshot và kiểm-tra-FK rộng ra hàng chục giây.
2. **B** = `BEGIN; <toàn bộ 0500>; ROLLBACK;` trên connection superuser (đúng như spec bản cũ).
3. **A** = mô phỏng `cleanupTenants`: `DELETE project_states` rồi `DELETE projects` (autocommit
   riêng, đúng thứ tự `:657 → :666`), bắn vào giữa lúc B đang chạy.

**Kết quả — B chết:**

```text
ERROR: insert or update on table "project_states"
       violates foreign key constraint "project_states_project_id_fkey"
```

Đúng lỗi của quan sát gốc §1. ⇒ **§3.2/§3.3 từ giả thuyết thành chứng minh**, không phụ thuộc may rủi.

### 4.4 A/B trên CHÍNH spec, dưới áp lực teardown song song

Deleter nền chỉ đụng company có project `PROBE-%` ⇒ không bao giờ chạm tenant fixture.

| Nhánh | spec | kết quả |
| --- | --- | --- |
| **A — trước vá** | `directPool()` (superuser) | `1 failed \| 1 passed` — `project_states_project_id_fkey` |
| **B — sau vá** | `appPool()` + RLS scope | `2 passed` |

---

## 5. Hình dạng vá (done_when #2) — CHƯA CHỐT, chờ §4

Ràng buộc đã ký trong WO: **KHÔNG retry · KHÔNG nới assert · KHÔNG miễn trừ ở cổng.** Và done_when #3:
phải giữ được thứ ca đang đo (0500 backfill/heal/idempotent), chứng minh bằng đột biến — làm 0500 sai
thì ca vẫn phải ĐỎ.

Ứng viên, ghi lại để §4 chọn chứ không chọn trước:

- **(V1) Giới hạn bán kính replay theo tenant của spec.** Đúng gốc, nhưng phải sửa văn bản SQL của
  0500 lúc replay ⇒ ca không còn đo "0500 như đã viết". Rủi ro: vá mà làm hỏng chính giá trị của ca.
- **(V2) Cô lập bằng khoá tư vấn** — `pg_advisory_xact_lock` chung cho `run0500` và `cleanupTenants`.
  Giữ nguyên SQL 0500, đóng cả họ lỗi (cả cửa sổ §3.4). Giá: nối tiếp hoá teardown toàn lane, phải đo
  ảnh hưởng thời lượng.
- **(V3) Sửa vế B** — bọc `cleanupTenants` trong một transaction ⇒ cửa sổ §3.2 biến mất hoàn toàn.
  Đúng nhất về nguyên tắc, nhưng chạm helper mà **mọi** int-spec dùng ⇒ bán kính hồi quy lớn nhất.
  Ngoài ra **ngoài `paths` của WO** (`seed.ts` ở `test/helpers/`, không phải `test/integration/**`).

### 5.1 (V6) — ỨNG VIÊN DẪN ĐẦU: cho replay chạy DƯỚI RLS thay vì sửa SQL

Thay vì thu hẹp câu lệnh, thu hẹp **thứ mà connection nhìn thấy**. Chạy `run0500` trên client của
`appPool()` (vai `mediaos_app`, chịu RLS + FORCE) với `set_config('app.current_company_id', A, true)`
trong chính transaction đó, thay cho client `direct` (superuser, thấy toàn DB).

Ba dữ kiện làm cho hướng này khả thi — đo được, không suy đoán:

| Điều kiện | Đo |
| --- | --- |
| 0500 không có DDL (app role không cấp được) | `grep -E '^(ALTER\|CREATE\|DROP\|GRANT...)'` ⇒ **0 khớp**; thuần DML, 5 statement |
| app role đủ quyền | `mediaos_app`: `projects` SELECT/INSERT/UPDATE · `project_states` SELECT/INSERT/UPDATE · `tasks` +DELETE |
| spec chỉ có MỘT tenant để thu hẹp về | `A = seedCompany(direct, "p1mig")` (`:108-109`) — đúng một `seedCompany` trong cả file |

Vì sao hơn V1: **không sửa một ký tự nào của SQL 0500** ⇒ giữ nguyên tính chất "ca đo 0500 như đã
viết", thứ mà V1 đánh mất. Vì sao hơn V2/V3: không chạm hạ tầng dùng chung, nằm gọn trong `paths`.

Cái nó đánh đổi, nói thẳng: sau bản vá, ca **không còn** chứng minh 0500 đúng xuyên tenant. Nhưng nó
**chưa bao giờ** chứng minh điều đó — mọi assert đều chỉ đọc hàng của fixture. Cái mất là bán kính
GHI ngoài ý muốn, không phải bán kính ĐO.

Điểm phải kiểm khi thi công (chưa xác minh): khối `DO` cuối 0500 đếm bất biến rồi `RAISE EXCEPTION`.
Dưới RLS nó đếm trong phạm vi tenant A — đúng ý spec, nhưng phải xác nhận nó không `RAISE` vì đếm
được 0 hàng ở nơi trước đây đếm toàn cục.

### 5.2 CHỐT: V6

Chọn **V6**. Diff gọn trong `paths`, không sửa SQL 0500, và §4.4 chứng minh nó đóng đúng lỗ:

```ts
const client = await app.connect();          // trước: direct.connect() — superuser
await client.query("BEGIN");
await client.query("SELECT set_config('app.current_company_id', $1, true)", [A.companyId]);
await run0500(client);
```

Ca thứ hai (`0499 CHECK ... 23514`) **giữ nguyên `direct`** — nó chỉ chèn hai hàng cho `pReg` với
`company_id` tường minh, không có bán kính toàn cục nên không nằm trong bề mặt lỗ. Đổi nó chỉ làm
phình diff.

---

## 5.3 Đối chứng đột biến (done_when #3) — bản vá có rút ruột ca test không

Làm 0500 SAI, chạy trên bản ĐÃ VÁ. Ca phải ĐỎ.

| Đột biến | Kết quả | Bằng chứng (lý do đỏ, KHÔNG phải mã thoát) |
| --- | --- | --- |
| **M1** rename `'Cần làm'` → `'SAI'` | **ĐỎ ✅** | `AssertionError: expected 'SAI' to be 'Cần làm'` |
| **M2** seed: cột `'Done'` đổi nhóm `completed`→`started` | **ĐỎ ✅** | `AssertionError: expected [...] to deeply equal [...]` |
| **M3** seed: `'Todo'` mất `is_default` | **XANH ❌ sống sót** | — (xem dưới) |

**M3 sống sót — và nó KHÔNG phải hồi quy do bản vá.** Đo baseline trên bản CŨ (chưa vá): cũng
**XANH** ⇒ lỗ hổng **có sẵn**, ca chưa bao giờ neo `is_default` của bộ seed. Ghi nợ ở §6.4.

> 🪤 **Bẫy đo đạc suýt làm sai kết luận, ghi ra để người sau không dính.** Lượt đo baseline ĐẦU TIÊN
> cho M3 ra **ĐỎ** trên bản cũ ⇒ suýt kết luận "bản vá làm mất một ca (hồi quy thật)". Đọc kỹ lý do
> đỏ thì là `Test timed out in 60000ms` — **không assertion nào fail**. Nguyên nhân: 83k project rác
> của §4.3 vẫn còn trong lane, bản cũ chạy superuser nên 0500 quét toàn bộ (61s > timeout 60s). Tức
> **phép đo bị đầu độc bởi chính rác của phép đo trước**. Dọn rác rồi đo lại mới ra XANH.
> ⇒ Cùng bài học với `mutation-red-can-be-ipc-flake`: **ĐỎ chưa đủ, phải đọc ca nào đỏ và vì sao.**
> Cụ thể ở WO này: một phép thử làm chậm hệ thống sẽ tự sinh ra "đỏ vì timeout" trông hệt như
> "đỏ vì bắt được đột biến".

---

## 6. Nợ ghi nhận (KHÔNG vá ở WO này)

1. ~~Docblock `:5-8` khai sai "hermetic"~~ — **đã sửa trong chính WO này**; docblock mới ghi thẳng cơ
   chế + trỏ về §4.3. Giữ mục này để nói bài học chung: **một dòng comment tự khẳng định tính cô lập
   đã che lỗi này khỏi mọi lượt review.** Nó không sai vì viết ẩu — nó sai vì lẫn "không để lại dấu
   vết" (`ROLLBACK` bảo đảm) với "không đụng tới" (`ROLLBACK` KHÔNG bảo đảm).
2. **`cleanupTenants` không transactional** (`seed.ts:449`, ~100 câu DELETE autocommit) là bề mặt
   RỘNG HƠN WO này. V6 chỉ rút `task-pipeline-backfill-0500` ra khỏi đường đạn; **cửa sổ §3.2 vẫn
   nguyên** cho bất kỳ spec nào khác replay một câu GHI có bán kính toàn cục. Vá đúng gốc = bọc
   `cleanupTenants` trong một transaction, nhưng đó là helper **mọi** int-spec dùng ⇒ WO riêng, đo
   ảnh hưởng thời lượng trước. Ngoài `paths` của WO này.
3. **Không có cổng nào chặn "spec replay migration bằng connection superuser".** WO này sửa đúng một
   file. Census đã chạy (09/09/2026) — 9 spec đọc file migration, nhưng chỉ **3** thực sự THỰC THI
   (tách `statement-breakpoint` rồi `client.query`):

   | Spec | thực thi | trạng thái |
   | --- | --- | --- |
   | `task-pipeline-backfill-0500.int-spec.ts` | ✔ | **đã vá ở WO này** |
   | `goal-db2-templates.int-spec.ts` | ✔ | **chưa soát** — ứng viên cùng bệnh |
   | `lms-audit-object-types.int-spec.ts` | ✔ | **chưa soát** — ứng viên cùng bệnh |

   6 spec còn lại chỉ ĐỌC văn bản migration để assert (không chạy) ⇒ không có bán kính ghi.
   *Việc còn lại cho WO sau:* với 2 spec trên, kiểm DML của migration chúng replay có vế `company_id`
   không. Có vế ⇒ vô hại; không có ⇒ cùng lỗ, áp V6 y hệt.
   *Không làm ở đây* vì mỗi cái cần đo riêng, và WO này đã đủ bề mặt.
4. **Ca chưa neo `is_default` của bộ seed 0500** (đột biến M3 §5.3 sống sót ở CẢ bản cũ lẫn bản vá).
   Lỗ hổng có sẵn, không do WO này gây ra, nhưng giờ đã **đo được** nên phải ghi. Vá rẻ: thêm assert
   `is_default` cho cột `Todo` của `pZero` (project 0-state — nơi bộ seed thực sự áp).
   *Không làm ở đây* vì nó mở rộng phạm vi ca test, còn WO này là WO chống nhiễu; và ghép vào sẽ làm
   §5.3 mất tính đối chứng (đang dùng chính M3 làm bằng chứng "không phải hồi quy").

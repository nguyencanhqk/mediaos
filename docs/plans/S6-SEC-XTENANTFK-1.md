# S6-SEC-XTENANTFK-1 — KI-046: bịt LỚP lỗ "FK một-cột nối hai bảng tenant"

> Zone **đỏ** (crown-jewel: RLS · migration diện rộng). Gate **FULL**.
> Phụ thuộc: `S6-QA-TENANTWRITE-1` (đã ship — mig `0533`, PR #305).
> Migration band: **0535** (nối tiếp head THẬT `0534_s6secmv1_dashboard_mv_tenant_barrier`, journal idx 201).

---

## 0. Gốc lỗi — nói lại cho gọn

Kiểm tra khoá ngoại của Postgres **chạy với quyền hệ thống và KHÔNG áp RLS**. Đó là hành vi thiết kế
của PG, không phải bug của ta. Hệ quả: một bảng con có FK **MỘT CỘT** `child.x → parent(id)` cho phép
app role đứng trong ngữ cảnh tenant A ghi hàng `company_id = A` nhưng `x` trỏ tới hàng của **B** —
FK thấy hàng đó TỒN TẠI nên cho qua, còn RLS `WITH CHECK` chỉ soi `company_id` (= A, hợp lệ).

Cách bịt duy nhất ở tầng DB: **composite FK** `(company_id, x) → parent(company_id, id)`, cần một
`UNIQUE (company_id, id)` trên bảng đích để PG chấp nhận làm đích tham chiếu. Tiền lệ trong repo:
`tasks_parent_same_company_fk` (mig `0503`) và `team_members_company_team_fk` / `_company_user_fk`
(mig `0533`).

---

## 1. SỐ ĐO THẬT (đo lại 2026-07-31 — không lấy lại số cũ)

Đo trên **PROD `mediaos`** (202/202 migration, head `0534`) và **dev-online `mediaos_dev`**
(197 migration — lệch, xem memory `dev-online-db-migration-drift`). Truy thẳng `pg_constraint`.

### 1.1 Catalog

| Chỉ số | PROD `mediaos` |
| --- | ---: |
| FK giữa **hai** bảng đều có `company_id` | **463** |
| — trong đó **composite** (đã bịt) | 3 |
| — **một-cột**, `src_col <> company_id` | 460 |
| — một-cột **ĐÃ được composite che** | 3 |
| **⇒ một-cột CÒN HỞ** | **457** |
| Bảng NGUỒN riêng biệt | 130 |
| Bảng ĐÍCH riêng biệt | 69 |

**⚠️ ĐÍNH CHÍNH số của RELEASE-02/backlog: 457, KHÔNG phải 458/459.** Số cũ tính
`460 − 2 composite` = 458. Sai ở chỗ: `tasks_parent_same_company_fk` che
`tasks_parent_task_id_fkey`, nên **3** FK một-cột đang được che chứ không phải 2.
Dòng số đúng: trước `0503` = 460 hở → sau `0503` = 459 → sau `0533` = **457**.

### 1.2 Phân LOẠI theo tính chất bảng ĐÍCH — đây là điểm mà bản mô tả WO CHƯA có

| Lớp | Định nghĩa | Số cặp | Vá được bằng composite FK? |
| --- | --- | ---: | --- |
| **T** (tenant thuần) | `parent.company_id` là **NOT NULL** ⇒ mọi hàng đích đều thuộc đúng 1 tenant | **446** | ✅ có |
| **G** (catalog toàn cục) | `parent.company_id` **NULLABLE**, và hàng `company_id IS NULL` = hàng hệ thống dùng chung | **11** | ❌ **KHÔNG** — sẽ phá tham chiếu hợp lệ |
| **P** (bịt một nửa) | *cắt ngang lớp T*: `child.company_id` **NULLABLE** ⇒ MATCH SIMPLE bỏ qua hàng `company_id IS NULL` | **24** | ⚠️ vá được nhưng **chỉ kín một phần** |

**Lớp P là lớp thứ ba, không phải chú thích.** 24 cặp này nằm TRONG 446 cặp lớp T và sẽ có composite
FK thật (`covered = true` là đúng), nhưng những hàng `company_id IS NULL` của chúng vẫn trỏ tự do
sang tenant khác. 10 bảng nguồn: `login_logs` · `system_job_runs` · `notification_events` ·
`notification_templates` · `dashboard_widgets` · `seed_batches` · `seed_items` · `sequence_counters` ·
`public_holidays` · `data_retention_policies`. `login_logs` là bảng an ninh ⇒ **không được để câu
"lớp T hở = 0" bị đọc thành "kín 100%"**. Chốt: `PARTIAL_ENFORCEMENT_PAIRS = 24` + ratchet ca (j).

**Lớp thứ tư — "NOT NULL hôm nay, chia sẻ ngày mai".** Sau `0535`, việc 63 bảng đích giữ
`company_id NOT NULL` trở thành **tiền đề sống** của 446 constraint. Ngày ai nới một bảng thành
nullable để thêm hàng catalog toàn cục (đúng kịch bản `roles`/`public_holidays` đã từng xảy ra),
ratchet (a)/(b) vẫn xanh vì cặp vẫn `covered`, nhưng runtime sẽ 23503 khi trỏ tới hàng toàn cục mới.
Chốt: ratchet ca (i).

**Đã kiểm và LOẠI** (không có lớp ẩn nào khác trên `pg_constraint`): 0 constraint `DEFERRABLE` ·
0 `ON DELETE SET DEFAULT` · 0 `ON UPDATE` khác `NO ACTION` · 100% `MATCH SIMPLE` · 0 bảng phân mảnh
(`relkind = 'p'`) hay kế thừa · mọi FK tham chiếu đúng cột `id`. Census vẫn nhận `relkind IN ('r','p')`
và ratchet vẫn assert `tgtColumn = 'id'` — vì "hôm nay bằng 0" không phải là chốt.

11 cặp lớp G (bảng đích đang có hàng toàn cục): `roles` (13/17 hàng NULL) ← `user_roles.role_id`,
`positions.default_role_id`, `dashboard_widget_cache.role_id`, `dashboard_widget_configs.role_id` ·
`dashboard_widgets` (17/17 NULL) ← `dashboard_widget_cache.widget_id`, `dashboard_widget_configs.widget_id` ·
`notification_events` (59/59 NULL) ← `notification_templates.event_id`, `notifications.event_id` ·
`notification_templates` (45/45 NULL) ← `notifications.template_id` ·
`public_holidays` ← `leave_request_days.public_holiday_id` · `seed_batches` ← `seed_items.seed_batch_id`.

### 1.3 Hàng ĐANG lệch tenant (done_when #1 — "hàng lệch có thật thì phải quyết")

| DB | Cặp có hàng lệch | Tổng hàng lệch | Trong đó là **tham chiếu catalog toàn cục hợp lệ** | **Lệch tenant THẬT (lớp T)** |
| --- | ---: | ---: | ---: | ---: |
| PROD `mediaos` | 4 | 144 | 144 | **0** |
| dev-online `mediaos_dev` | 4 | 132 | 132 | **0** |

**⇒ QUYẾT ĐỊNH: không có hàng nào phải xoá hay sửa.** Toàn bộ 144/132 hàng "lệch" là hàng nghiệp vụ
trỏ tới **hàng catalog toàn cục** (`company_id IS NULL`) — đúng thiết kế, không phải rò tenant. Vì
lớp T có **0** hàng lệch trên cả hai DB, migration **KHÔNG cần và KHÔNG được** xoá dữ liệu
(⛔ khuôn `DELETE` bước (0) của `0533` **không** được nhân bản — trái BẤT BIẾN #2).

### 1.4 Chi phí thật (bản mô tả WO lo "mỗi cặp một index" — số đo nói khác)

Composite FK **không** tạo index ở bảng nguồn; chỉ cần `UNIQUE (company_id, id)` ở bảng **ĐÍCH**.
63 bảng đích lớp T, **3 đã có** (`users`, `tasks`, `teams` — do `0503`/`0533`) ⇒ **60 unique
constraint mới**, không phải 446.

Chi phí QUÉT tính theo bảng **NGUỒN** (`ADD CONSTRAINT FOREIGN KEY` chạy RI_Initial_Check trên bảng
con, không phải bảng cha): **129 bảng nguồn · tổng 64 588 hàng**, lớn nhất `system_job_runs` 51 905 ·
`audit_logs` 10 506 · phần còn lại đều < 500. Đo thật khi áp trên lane đã migrate: **1,2 s** cho cả
506 lệnh DDL (gồm cả thời gian khởi động `tsx`).

Chi phí CHẠY, nói cho đủ: từ nay mỗi INSERT/UPDATE ở 129 bảng nguồn chạy **2 lượt kiểm RI** thay vì
1, và mỗi DELETE hàng cha chạy 2 hành động RI. Đó là giá của việc GIỮ FK cũ — và giữ là **đúng**:
với 24 cặp lớp P, FK cũ là ràng buộc DUY NHẤT còn hiệu lực cho hàng `company_id IS NULL`.

Chi phí KHOÁ mới là rủi ro thật, không phải chi phí quét: 60 `ACCESS EXCLUSIVE` (bảng đích) + ~129
`SHARE ROW EXCLUSIVE` (bảng nguồn) **giữ đồng thời tới lúc commit** vì cả file chạy trong một
transaction. Chốt: `SET LOCAL lock_timeout = '5s'` ở đầu file — một truy vấn dài đang chạy sẽ làm
migration DỪNG NHANH thay vì xếp hàng chặn cả DB. Runbook `snapshot→migrate→activate` vẫn để bản cũ
phục vụ lúc migrate ⇒ **áp vào cửa sổ ít tải**, và nếu lock_timeout nổ thì chạy lại (idempotent).

### 1.5 `ON DELETE` — vì sao lớp lỗ này có hại thật

126 CASCADE · 283 SET NULL · 41 NO ACTION · 7 RESTRICT. Cả ba nhóm đều là tác hại chéo tenant do
**hệ thống tự thực hiện**: CASCADE **xoá** hàng của tenant khác · SET NULL **sửa** hàng của tenant
khác · NO ACTION/RESTRICT **chặn** tenant khác xoá hàng của chính họ.

---

## 2. Phạm vi WO này

### 2.1 LÀM

1. **Vá TOÀN BỘ 446 cặp lớp T** bằng composite FK (mig `0535`).
2. **Ký waiver 11 cặp lớp G** trong sổ phán quyết máy-đọc (không vá — vá là hỏng).
3. **Chốt chống mọc thêm**: census chạy được + baseline có chữ ký + int-spec ĐỎ khi lớp hở lớn lên.
4. **Mở rộng lưới** `tenant-isolation.int-spec.ts`: ca **W4** data-driven theo catalog FK, thay cho
   hai ca (b)/(c) viết tay chỉ phủ `team_members`.
5. Đóng KI-046 ở `RELEASE-02` kèm số trước/sau.

### 2.2 KHÔNG làm (nói rõ để không ai đọc quá)

- **Không** đụng tầng service/controller. Lỗ này bịt ở DB là đủ và đúng tầng; sửa 130 bảng ở app
  layer là việc khác, và app layer không phải nơi ép bất biến (CLAUDE.md §2.1).
- **Không** DROP FK một-cột cũ. Không phải vì "expand-contract vô cớ" mà vì nó **còn tác dụng thật**:
  với 24 cặp lớp P, composite FK bỏ qua hàng `company_id IS NULL`, nên FK cũ là ràng buộc DUY NHẤT
  còn hiệu lực cho những hàng đó.
- **Không** xoá/sửa dữ liệu (§1.3: 0 hàng lệch lớp T).
- **Không** cập nhật `apps/api/src/db/schema/**`. 446 constraint chỉ tồn tại trong DB, không có trong
  schema TS — **cùng cách** `0503`/`0533` đã làm. An toàn vì `drizzle-kit generate` diff schema TS với
  `migrations/meta/0000_snapshot.json`, và constraint kiểu này vắng mặt ở **cả hai** ⇒ không sinh
  `DROP`. Đã kiểm: snapshot hiện có 0 dòng nhắc `company_id_id_uq`/`company_team_fk`/`parent_same_company`.
  ⚠️ Bẫy còn lại (ghi để người sau biết): ai chạy `drizzle-kit introspect` để dựng lại snapshot **từ DB
  thật** sẽ kéo 446 constraint vào snapshot, và lần `generate` sau đó — khi schema TS vẫn không có
  chúng — sẽ sinh `DROP` hàng loạt. Đừng introspect; nếu buộc phải, đối chiếu với ratchet trước khi áp.

### 2.3 Vì sao vá HẾT 446 chứ không chọn một tập con "bề mặt thật"

done_when #2 đề nghị ưu tiên theo endpoint nhận id từ client. Đã thử phân loại theo module
(in-scope MVP vs media/finance đã park) và **bộ phân loại tự nó sai**: `tasks`/`task_labels`/
`task_comments` khai trong `workflow.ts`, `projects`/`project_members` khai trong `media.ts` —
tức đúng những bảng MVP đang sống lại bị dán nhãn "đã park". Đó chính là lớp lỗi
`identity-projection-census-misses-alias` / `wo-plans-built-on-code-comments`.

Một quy tắc **đồng nhất** (mọi cặp lớp T) không có rủi ro phân loại, và số đo §1.4 cho thấy chi phí
là 60 index chứ không phải 446. Ràng buộc "con phải cùng company_id với cha" đúng cho **mọi** cặp
tenant→tenant — không có ngoại lệ nghiệp vụ nào trong lớp T. Vá một tập con sẽ để lại đúng câu hỏi
"cặp nào bị bỏ" cho phiên sau, trong khi tập con lại là thứ dễ chọn sai nhất.

Ưu tiên vẫn được TÔN TRỌNG, ở chỗ nó có ích: thứ tự trong file migration + bằng chứng test (§4) đi
theo bề mặt client trước.

#### VẾ PHẢN BIỆN — phải để owner ký, không được trình bày như lựa chọn duy nhất

plan-reviewer (2026-07-31) cãi phía ngược lại, và các luận điểm sau **đúng sự thật**, ghi lại nguyên vẹn:

1. **KI-046 tự khai là KHÔNG chặn go-live** (`RELEASE-07` §RC: `S3`, chặn go-live `❌`), và RC đã cắt
   (`v1.0.0-rc.1`, `S6-REL-1` đã ship). Đây là thay đổi schema **lớn nhất lịch sử dự án** (506 lệnh
   DDL, chạm 129 bảng nguồn) làm SAU khi RC cắt, cho một hạng mục không chặn phát hành, ở **N=1** nơi
   tenant thứ hai **không tồn tại** ⇒ khả năng khai thác thực tế hôm nay = **0**.
2. **Lập luận §2.3 cãi nhầm mệnh đề.** "Bộ phân loại theo tên file schema tự nó sai" chỉ chứng minh
   *đừng chọn tập con bằng phỏng đoán tên file* — KHÔNG chứng minh *phải làm cả 446*. Vẫn tồn tại tập
   con **đo được**, không dính bẫy đó: (i) nhóm `CASCADE`+`SET NULL` — nhóm duy nhất có tác hại "hệ
   thống tự xoá/sửa hàng của tenant khác" mà chính §1.5 dùng để biện minh; (ii) nhóm mà **cả hai bảng
   nằm trong `RLS_TABLES`** — nhóm duy nhất W4 chứng minh được.
3. **Đánh đổi thật là: rủi ro CHỌN SAI ↔ rủi ro ĐỔI KHÔNG KIỂM.** Plan đổi cái thứ nhất lấy cái thứ
   hai và chỉ tính giá cái thứ nhất. Đo được: W4 chỉ chạm 449/446+3 cặp, trong đó **267 có bằng chứng
   thật**; phần dư — gồm bảng của module **đã park** (media/finance/payroll) mà không ai chạy — đổi
   ngữ nghĩa `DELETE` mà **không có một ca test nào chạm tới**.
4. **Tính review được.** Không người nào review được danh sách 446 dòng; FULL gate sẽ PASS bằng niềm
   tin — đúng memory `reviewers-pass-real-bugs`.
5. **Phương án rẻ hơn đạt gần hết giá trị:** ship NGAY census + sổ phán quyết + ratchet (thứ thực sự
   chặn lớp lỗ **mọc thêm**, và là điều `done_when` #3 đòi), cộng bản vá cho nhóm CASCADE/SET NULL +
   nhóm có bề mặt client; phần dư ký waiver **có số hiệu + hạn**, vá ở release đầu sau RC. Việc này
   KHÔNG để lại câu hỏi "cặp nào bị bỏ" như §2.3 lo — ratchet + sổ phán quyết trả lời bằng máy, từng cặp.

**QUYẾT ĐỊNH CỦA OWNER (2026-07-31): VÁ HẾT 446.** Bốn phương án đã được trình kèm số đo; owner chọn
phương án đầy đủ. Ba chốt R4 (`lock_timeout`) · R5 (W4 khớp `err.constraint`) · R10 (đường lùi loại
trừ 3 constraint có trước) là **điều kiện tiên quyết** của lựa chọn này — cả ba đã thi công và đã
chạy thử xong TRƯỚC khi hỏi.

Số liệu đã đưa ra để owner cân: vá hết **446** ⇒ hở lớp T = 0 · chỉ CASCADE+SET NULL **398** ⇒ còn hở
48 · chỉ bảng có dữ liệu **166** ⇒ còn hở 280 · hoãn migration ⇒ còn hở 446. Điểm quyết định: phương
án "an toàn hơn" gần nhất (398) chỉ bớt **48/446 cặp** — tức gần như không giảm bán kính thay đổi,
mà lại đánh đổi bằng một sổ waiver có hạn và KI-046 vẫn mở.

---

## 3. Thiết kế migration `0535`

Tên: `0535_s6secxtenantfk1_composite_tenant_fk.sql`. Journal: idx 202, when 1717587324000.

### 3.1 Bước (0) — TIỀN KIỂM, không phải dọn dẹp

```text
DO $$ … đếm hàng lệch cho TỪNG cặp trong danh sách literal …
       nếu tổng > 0 → RAISE EXCEPTION kèm DANH SÁCH cặp + số hàng
```

- **RAISE EXCEPTION, KHÔNG DELETE.** BẤT BIẾN #2. Migration idempotent nên sau khi người ký quyết
  định xử lý, chạy lại là xong.
- Trên PROD/dev đo được **0** ⇒ nhánh này không kích hoạt. Nó tồn tại để một DB lạ (lane đã chạy
  RED test, snapshot cũ) **dừng ồn ào** thay vì mất dữ liệu im lặng.
- ⚠️ **Đính chính mô tả**: tiền kiểm lặp trên **danh sách 446 cặp literal** trong chính file, KHÔNG
  tự khám phá từ `pg_constraint`. Hệ quả phải nói ra: cặp bị bỏ sót khỏi danh sách thì tiền kiểm cũng
  **mù** với nó. Lưới bắt sót là `xtenant-fk-ratchet.int-spec.ts` (a), chạy SAU migration.
- Thêm **assert cứng `count(xtfk_pairs) = 446`**: `CREATE TEMP TABLE … ON COMMIT DROP` chỉ sống trong
  một transaction. Qua drizzle migrator thì đúng, nhưng ai áp bằng `psql -f` **không** `-1` sẽ mất
  temp table sau câu đầu ⇒ ba khối `DO` lặp trên 0 dòng và migration "thành công" với **0 constraint**.
  `RAISE NOTICE` không phải cổng — assert mới là. (plan-reviewer 2026-07-31 #9)

### 3.2 Bước (1) — 60 `UNIQUE (company_id, id)` trên bảng đích lớp T

`ADD CONSTRAINT <tbl>_company_id_id_uq UNIQUE (company_id, id)`, mỗi cái bọc `IF NOT EXISTS` qua
`pg_constraint`. `id` đã là PK ⇒ `(company_id, id)` unique một cách tầm thường; constraint chỉ để PG
chấp nhận làm đích tham chiếu.

### 3.3 Bước (2) — 446 composite FK

`ADD CONSTRAINT <src>_<col>_company_fk FOREIGN KEY (company_id, <col>) REFERENCES <tgt> (company_id, id) ON DELETE <giữ nguyên của FK cũ>`

- **`ON DELETE` sao chép ĐÚNG `confdeltype` của FK một-cột cũ** — hành vi xoá trong-tenant KHÔNG đổi.
- Danh sách 446 cặp nằm **literal** trong file (một `VALUES` 4 cột: `src, col, tgt, on_delete`);
  phần logic guard/`ALTER` viết MỘT lần và lặp trên danh sách đó bằng `EXECUTE format(%I)`.
  ⚠️ **Nói cho đúng**: có `EXECUTE format()` động. Thứ reviewer đọc được-đúng-sẽ-chạy là **danh sách
  446 dòng**, không phải "0 SQL động". Ba khối `DO` không tự khám phá thêm cặp nào từ catalog.
- Guard idempotent kiểm theo **CỘT** (`conkey` = `{company_id, col}`), không theo TÊN — chạy lại an
  toàn kể cả khi ai đó đã thêm/đổi tên constraint tương đương.
- Đặt tên `<src>_<col>_company_fk`; 2 tên vượt 63 byte (`attendance_adjustment_requests.current_approver_*`)
  dùng hậu tố ngắn `_cfk` thay vì để Postgres **âm thầm cắt cụt**.

#### ⛔ BẪY CHẶN-ĐƯỜNG: `ON DELETE SET NULL` trên FK 2 CỘT sẽ NULL luôn `company_id`

279/446 cặp lớp T là `SET NULL`. Viết thẳng `ON DELETE SET NULL` cho composite FK là **SAI**:
Postgres set NULL cho **TOÀN BỘ** cột của FK, tức cả `company_id`. Đã chứng minh trên PG 17.10
(DB nháp `xtfk_probe`, 2026-07-31):

```text
CONTEXT: SQL statement "UPDATE ONLY "public"."child2" SET "company_id" = NULL, "parent_id" = NULL …"
ERROR:   null value in column "company_id" … violates not-null constraint
```

Nghĩa là: xoá một hàng cha sẽ **phá thuộc tính tenant của hàng con** — hoặc nổ lỗi (cột NOT NULL),
hoặc tệ hơn, với 24 bảng có `company_id` NULLABLE thì nó **âm thầm biến hàng nghiệp vụ thành hàng
"toàn cục" vô chủ**, nằm ngoài mọi policy RLS. Đó là lỗ to hơn lỗ đang vá.

**⇒ Bắt buộc dùng dạng có DANH SÁCH CỘT (PG 15+, ta chạy 17.10):**
`ON DELETE SET NULL (<col>)` — chỉ null đúng cột FK, giữ nguyên `company_id`. Đã chứng minh:
sau `DELETE` cha, hàng con còn `company_id` cũ và `parent_id = NULL`.
Và composite FK chặn được ghi chéo tenant như mong đợi:
`ERROR: insert or update on table "child" violates foreign key constraint "child_parent_company_fk"`.

Đối chiếu 446 cặp: 279 `SET NULL (<col>)` · 119 `CASCADE` · 41 `NO ACTION` · 7 `RESTRICT`.
Không cặp nào là `SET DEFAULT`, không cặp nào `DEFERRABLE`, tất cả `MATCH SIMPLE`, không có bảng
phân mảnh/kế thừa (đã đo trên `pg_constraint`/`pg_class`). Không cặp `SET NULL` nào có cột FK
`NOT NULL` (nếu có thì FK CŨ đã sai từ trước — đo được 0).

### 3.4 Hành vi MỚI phải nói ra

1. **`ON UPDATE NO ACTION`** (mặc định): từ nay `UPDATE <parent> SET company_id = …` bị chặn khi còn
   hàng con. Siết ĐÚNG hướng (re-home một bản ghi sang tenant khác không có nghĩa nghiệp vụ ở N=1),
   nhưng là thay đổi thật — ghi vào `docs/DB` + RELEASE-02.
2. **MATCH SIMPLE**: nếu `company_id` **hoặc** cột FK của hàng nguồn là NULL thì composite FK
   **không** kiểm. 24 cặp có `src.company_id` nullable (`login_logs`, `system_job_runs`,
   `notification_events/templates`, `dashboard_widgets`, `seed_batches/items`, `sequence_counters`,
   `public_holidays`, `data_retention_policies`). Với chúng, hàng `company_id IS NULL` = hàng hệ
   thống, đã có bất biến riêng ghim (`auth-me-bootstrap.int-spec`: `company_id IS NULL ⟹ user_id IS NULL`).
   **Ghi rõ trong header migration** — không im lặng để người sau tưởng đã kín 100%.
3. Không đụng policy/RLS/grant/trigger nào. Thuần additive.

---

## 4. Chốt chống mọc thêm + lưới test

### 4.1 `apps/api/test/foundation/fk-tenant-census.ts` (mới)

Truy vấn `pg_constraint`/`pg_attribute` trả về catalog cặp FK + phân lớp T/G + trạng thái đã-che.
**0 regex trên mã nguồn** — cùng bất biến với `route-census.ts`. Artifact máy-đọc ghi ra
`docs/_review/S6-SEC-XTENANTFK-1-fk-census.json` khi `FK_CENSUS_WRITE=1`.

### 4.2 `apps/api/test/foundation/fk-tenant-verdicts.ts` (mới)

Sổ phán quyết **có chữ ký** cho mọi cặp KHÔNG được bịt: 11 cặp lớp G, mỗi cặp một dòng lý do
(`catalog toàn cục — composite FK sẽ phá tham chiếu hợp lệ`). Baseline = "lớp T hở phải bằng **0**".

### 4.3 `apps/api/test/integration/xtenant-fk-ratchet.int-spec.ts` (mới)

- PIN: census không được co về rỗng (`FK_SINGLE_COL_PAIRS_FLOOR`) — chống false-green do bộ lọc sai.
- (a) **Không cặp lớp T nào còn hở.** Cặp mới ⇒ ĐỎ kèm tên cặp + câu SQL vá sẵn.
- (b) Mọi cặp hở phải nằm trong sổ phán quyết ⇒ thêm bảng catalog toàn cục mới cũng phải KÝ.
- (c) **0 hàng lệch tenant** (đo lại mỗi lần chạy, không tin số cũ).
- (d) Sổ phán quyết không được chứa cặp đã hết tồn tại (chống waiver mồ côi).
- (e) Không được ký waiver cho cặp lớp T (chống lạm dụng waiver thay cho vá).

**Bốn assert về CHẤT LƯỢNG bản vá — "có composite FK" chưa đủ** (plan-reviewer 2026-07-31 #2/#3):

- (f) composite `SET NULL` phải kèm **danh sách cột** (`confdelsetcols` khác rỗng). Thiếu ⇒ constraint
  đó null luôn `company_id`, hỏng hơn lỗ đang vá — mà census vẫn đếm là "đã bịt".
- (g) composite FK phải trỏ đúng **`(company_id, id)`** của bảng cha (`confkey`), không phải cặp cột khác.
- (h) FK một-cột phải tham chiếu **`id`** — giả định mà cả `suggestedFix()` lẫn `0535` đang dựa lên.
- (i) bảng đích lớp T phải **GIỮ `company_id NOT NULL`** — tiền đề sống của toàn bộ bản vá.
- (j) PIN lớp P = 24 — bảng con `company_id` NULLABLE mới không được lặng lẽ nhập nhóm bịt-một-nửa.

**NƠI CHẠY (đính chính R6 của bản plan đầu):** `hasDb = Boolean(DATABASE_DIRECT_URL && DATABASE_URL)`
— **không** gate theo `LANE_DB`. Cả `.github/workflows/api.yml:83-84` lẫn `ci.yml:47-48` set hai biến
này ở cấp job ⇒ spec này **chạy thật trên CI**, là chốt cơ học chứ không phải nghi thức.

### 4.4 Mở rộng `tenant-isolation.int-spec.ts` — ca **W4** (done_when #4)

Thêm ca **W4** data-driven trên catalog FK, dùng lại đúng máy móc `jsonb_populate_record` của W0:
với mỗi cặp mà **cả hai** bảng có trong `RLS_TABLES` (đã có `seedRow`), lấy hàng của A, ghi đè cột FK
= id hàng của **B**, INSERT trong ngữ cảnh A ⇒ **phải bị từ chối**. Giữ nguyên hai ca `team_members`
viết tay làm mỏ neo hồi quy (memory `tests-can-pin-a-hole-open`: lưới data-driven tính sai bộ lọc sẽ
xanh với 0 ca — cần ít nhất một ca cứng không phụ thuộc bộ lọc).

**⚠️ "Bị từ chối" KHÔNG đủ để tính là bằng chứng** (plan-reviewer #4). Hàng copy từ A dễ vỡ
`23505` (unique tự nhiên) hoặc `42501` (app role không có INSERT grant) **trước khi** FK kịp nổ; cả
hai đều "rejected" nên một PIN đếm "số cặp thử" sẽ xanh mà composite FK chưa từng chạy. Vì vậy W4:

1. assert `leaked = []` (không cặp nào ghi được) — vế bắt buộc;
2. đếm riêng cặp bị chặn bởi `23503` **VÀ** `err.constraint` khớp đúng tên composite FK của cặp đó;
3. `console.log` liệt kê tường minh các cặp "rejected bởi cơ chế khác ⇒ CHƯA chứng minh";
4. PIN `W4_FK_BLOCKED_FLOOR` trên con số (2).

Đo thật trên lane đã áp `0535` (2026-07-31): **449 cặp thử · 267 CHỨNG MINH bằng composite FK · 182
bị chặn bởi cơ chế khác**. Sàn để **260**.

---

## 5. Rủi ro & cách chặn

| # | Rủi ro | Chặn |
| --- | --- | --- |
| R1 | Nhân bản `DELETE` của `0533` ra 446 cặp ⇒ hard-delete dữ liệu thật, trái BẤT BIẾN #2 | Bước (0) là **RAISE EXCEPTION**, không DELETE. Grep migration: 0 câu `DELETE`/`TRUNCATE` |
| R2 | Vá nhầm cặp lớp G ⇒ gãy tham chiếu catalog toàn cục (gán role hệ thống, widget, noti event) | Phân lớp bằng `attnotnull` của `parent.company_id` (catalog, không phải phỏng đoán) + waiver ký tay + ratchet (d) |
| R3 | Migration abort giữa deploy vì một DB lạ có hàng lệch | Idempotent + thông điệp liệt kê ĐÚNG cặp/số hàng; runbook: chạy census trước khi deploy |
| R4 | 60 `ACCESS EXCLUSIVE` + ~129 `SHARE ROW EXCLUSIVE` giữ đồng thời tới commit ⇒ đóng băng ghi | `SET LOCAL lock_timeout = '5s'` (dừng nhanh thay vì xếp hàng chặn cả DB) + áp vào cửa sổ ít tải. Quét thật = 64 588 hàng ở **bảng NGUỒN**; đo trên lane: 1,2 s |
| R5 | Lưới W4 xanh vì bị chặn bởi unique/grant chứ không phải FK | Đếm riêng `23503` + khớp `err.constraint`; liệt kê tường minh cặp "chưa chứng minh"; PIN 260 (đo 267/449) + giữ 2 ca cứng `team_members` |
| R6 | ~~Ratchet không chạy ở CI~~ **SAI — đã đính chính** | `hasDb` không gate theo `LANE_DB`; CI set `DATABASE_URL`/`DIRECT_URL` ở cấp job (`api.yml:83-84`, `ci.yml:47-48`) ⇒ ratchet là chốt CƠ HỌC ở CI |
| R7 | Số trong RELEASE-02 (458) lệch số thật (457) | §1.1 đính chính kèm dẫn xuất từng bước; sửa `RELEASE-02` + backlog + header `0535`. **KHÔNG viết lại header `0533`** — hot-file = append, không rewrite (CLAUDE.md §9.3) |
| R9 | Migration "thành công" mà thêm 0 constraint (temp table biến mất ngoài transaction) | Assert cứng `count(xtfk_pairs) = 446` ở bước (0) |
| R10 | Rollback quét theo `LIKE '%_company_fk'` gỡ nhầm `tasks_parent_same_company_fk` của `0503` | **Đã xảy ra thật khi chạy thử 2026-07-31.** Lệnh lùi trong header `0535` loại trừ tường minh 3 constraint có TRƯỚC 0535 |
| R11 | `drizzle-kit introspect` kéo 446 constraint vào snapshot ⇒ `generate` sau đó sinh `DROP` hàng loạt | Ghi cảnh báo ở §2.2; hôm nay an toàn vì snapshot `0000` không chứa constraint kiểu này (đã kiểm) |
| R8 | `ON DELETE SET NULL` composite NULL luôn `company_id` ⇒ hàng nghiệp vụ thành "toàn cục" vô chủ, NGOÀI RLS | Dùng `SET NULL (<col>)` (PG 15+), đã chứng minh cả hai chiều trên PG 17.10 (§3.3). Test hồi quy: xoá cha ⇒ con còn nguyên `company_id` |

---

## 6. Định nghĩa hoàn thành

- [ ] `0535` áp được trên lane sạch **và** trên bản sao PROD; census sau khi áp: **hở lớp T = 0**.
- [ ] `xtenant-fk-ratchet.int-spec.ts` chứng minh ĐỎ được (gỡ 1 constraint ⇒ đỏ đúng tên cặp).
- [ ] W4 chạy ≥ N cặp thật (ghi số vào PR), 2 ca `team_members` vẫn xanh.
- [ ] `pnpm typecheck` + `pnpm lint` + `bash harness/check.sh --lane-db` xanh.
- [ ] FULL gate: `security-reviewer` + `rls-tenant-isolation-tester` + `database-reviewer` PASS.
- [ ] `RELEASE-02` KI-046 đóng kèm bảng trước/sau; `docs/DB/DB-01` ghi quy ước composite FK cho bảng
      tenant mới; `erd-current.md` §Phụ lục A cập nhật; backlog `status: done`.
- [ ] **KI-055 MỞ** cho lỗ tồn dư lớp G: 11 cặp vẫn trỏ được tới hàng catalog **của tenant KHÁC**
      (`user_roles.role_id → roles của B` — bảng phân quyền, crown-jewel). Nợ không có số hiệu là nợ
      vô hình với bug-scrub trước RC. Hướng vá: trigger/CHECK "cha cùng tenant HOẶC là hàng toàn cục".
- [ ] **Đường lùi viết sẵn** trong header `0535` (đã có) — và đã CHẠY THỬ, nhờ đó bắt được R10.
- [ ] `SET LOCAL lock_timeout` có mặt; assert `count(xtfk_pairs) = 446` có mặt.
- [ ] `harness/backlog.mjs` `paths` bổ sung `docs/_review/**` · `docs/erd-current.md` ·
      `harness/backlog.mjs` (memory `wo-paths-drive-gate-and-scheduler`: khai thiếu path = lọt gate).

---

## 7. KẾT QUẢ THI CÔNG (2026-07-31)

### 7.1 Số đo trước/sau

| | trước `0535` | sau `0535` |
| --- | ---: | ---: |
| FK một-cột tenant→tenant | 460 | 460 |
| — lớp T đã che | 3 | **449** |
| — **lớp T CÒN HỞ** | **446** | **0** |
| — lớp G (waiver) | 11 | 11 |
| Hàng lệch tenant lớp T (`mediaos` · `mediaos_dev`) | 0 · 0 | 0 · 0 |

Đối chứng A/B do `rls-tenant-isolation-tester` dựng (clone lane rồi chạy lệnh lùi): `user_roles(company_id=A, user_id=<B>)`
**trước = `INSERT 0 1` (RÒ THẬT)** → **sau = 23503**. Đây là RED→GREEN đo được, không phải suy luận.
Hồi quy xoá đo A/B trên 4 ca (CASCADE · 2× SET NULL · DELETE companies): **không đổi**, `company_id`
giữ nguyên ở cả hai ca `SET NULL`.

### 7.2 ⚠️ HỆ QUẢ KHÔNG LƯỜNG TRƯỚC: 0535 làm ĐỎ 11 int-spec đang xanh

`bash harness/check.sh --lane-db` sau khi áp `0535` cho **12 test đỏ**. Điều tra từng cái:

- **1 đỏ SẴN CÓ, không liên quan** — `hr-employee-write` "no code counter → 422" vẫn đỏ khi đã GỠ
  hết constraint của 0535 ⇒ không phải do WO này.
- **7 test GIEO hàng chéo tenant CÓ CHỦ ĐÍCH** (`employees-scope-int2` · `att-noti-e2e` ·
  `leave-noti-e2e` · `me-personal-hub` · `me-security-activity` · `task-noti-e2e` ·
  `dashboard-cache-invalidate`). Chúng gieo dữ liệu HỎNG SẴN rồi chứng minh **đường ĐỌC vẫn không
  rò** — tuyến phòng thủ thứ hai. `0535` làm việc gieo đó bất khả thi, tức **làm mất bằng chứng của
  một tuyến phòng thủ khác**. Vá bằng `seedCrossTenantViolation()` (`test/helpers/seed.ts`):
  `session_replication_role = replica` cho ĐÚNG connection gieo, chỉ superuser đặt được.
  Giữ cả hai tuyến, không đánh đổi.
- **3 fixture VÔ TÌNH tạo hàng chéo tenant** — `task-actions` (`mkTask({companyId: B})` nhưng
  `creator_user_id` = admin của A) · `task-project-role` (cùng hình dạng) · `user-roles-soft-delete`
  (`grantRole(..., B.companyId, adminA)` — người cấp quyền thuộc tenant A). **Đây là bug thật của
  fixture mà constraint vừa phát hiện**, không phải test hỏng vì WO. Vá cho ĐÚNG nghiệp vụ
  (dùng actor của chính tenant đó), KHÔNG nới ràng buộc.

Bài học ghi lại: một bất biến mới ở tầng DB **xoá mất bề mặt gieo lỗi của lưới test cũ**. Cần lối
gieo có kiểm soát, nếu không sẽ có người "sửa" bằng cách gỡ ca test.

### 7.3 Ratchet (c) từng ĐỎ-GIẢ — đã chuyển sang opt-in

Assert "0 hàng lệch tenant" đọc TOÀN BỘ DB tại một thời điểm, trong khi các spec chạy **song song**
đang cố ý gieo hàng lệch (§7.2). Chạy chung ⇒ đỏ rồi tự xanh lại. Đã đổi thành **opt-in**
`FK_DRIFT_ASSERT=1`; khả năng không mất vì đường deploy đã có tiền kiểm của chính `0535` (đã chứng
minh có răng: gieo 1 hàng lệch ⇒ migration `RAISE EXCEPTION` nêu đúng cặp rồi dừng).

### 7.4 FULL gate

`security-reviewer` **PASS** (0 CRITICAL · 0 HIGH) · `rls-tenant-isolation-tester` **PASS**.
Đã vá 4 phát hiện MEDIUM của gate:

1. `SET LOCAL lock_timeout` rò sang mọi migration áp SAU 0535 trong cùng transaction → thêm bước (3)
   `SET LOCAL lock_timeout = DEFAULT`.
2. Census mù với bảng RLS **không có** cột `company_id` (`companies`, `role_permissions`) → thêm
   `collectRlsTablesWithoutCompanyId()` + ratchet ca (k) bắt ký nhận.
3. `seedCrossTenantViolation` nuốt lỗi reset rồi `release()` ⇒ connection còn ở chế độ `replica` quay
   lại pool = **tắt FK cho mọi spec sau** → `release(true)` huỷ connection khi reset thất bại.
4. Backlog ghi "459 khoá ngoại" (số cũ sai) và `status: todo` → sửa thành 457 + `done`.

# S15-PAYROLL-DB-1 — plan-reviewer đối kháng, VÒNG 1 (11/09/2026)

> ## ✅ TRẠNG THÁI CUỐI: **PASS — 10/10 điều kiện tự-mở-cổng đã vá (11/09/2026). CHO PHÉP CODE.**
>
> Vá theo **ĐIỀU KIỆN TỰ-MỞ-CỔNG** reviewer khai ⇒ **KHÔNG mở vòng 2** (khuôn `S15-PAYROLL-DOC-1`;
> memory `red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`).
>
> **Phạm vi review:** `docs/plans/S15-PAYROLL-DB-1.md` đối chiếu chéo `docs/DB/DB-13` §12–§15 ·
> `docs/SPEC/SPEC-11` §8.2/§11.1/§11.3/§12.1/§15.1/§18.1 · `docs/plans/S15-PAYROLL-DOC-1-review.md` ·
> **code thật**: `master-data-seed-runner.service.ts` · `master-data-seed-bootstrap.service.ts` ·
> `permission.service.ts` · `xtenant-fk-ratchet` / `rls-guards` / `retention.service.spec` ·
> `s13-payroll-db1-invariants.int-spec.ts` · `test/helpers/seed.ts` · mig `0564`.

---

## 1. Sáu BLOCKER

| # | Tóm tắt | Vì sao chặn |
| --- | --- | --- |
| **B1** | §3.1 đúng một nửa: kết luận «seed company-scoped không được ở migration» **ĐÚNG**, nhưng cơ chế thay thế plan mô tả (**«ném, chặn boot»**) **không tồn tại trong code** — `runOne()` bọc try/catch toàn phần ⇒ batch `Failed` + log, boot vẫn tiếp | Plan **hạ cấp cổng CỨNG (migrate đỏ ⇒ deploy dừng) xuống một dòng log** rồi tuyên bố đã thay bằng cổng cứng khác. Cộng **4 đường** công ty không được seed ⇒ catalog rỗng ⇒ `net=0`/`net=gross` mà mọi bất biến SQL vẫn xanh |
| **B2** | Assert của seeder **đếm hàng** mà tenant cũng ghi được (`count(engine)=4`, `count(pit_deductible)=3`) — không lọc `is_system` | Công ty thêm khoản BH tự nguyện `pit_deductible=true` (hợp lệ) ⇒ seeder `Failed` mỗi lượt boot ⇒ áp lực nới assert ⇒ **mất chốt «đoàn phí giảm thuế»** — chốt DUY NHẤT theo DB-13 §13.4. Và `count=4` thoả bởi **bất kỳ** 4 hàng engine |
| **B3** | Quy tắc `allowances[].name → component_code` **không được chốt ở bất kỳ tài liệu nào**; plan ngầm chọn `component_code := name` | `name` chữ Việt có dấu ⇒ không khớp catalog ⇒ sau CONTRACT **phụ cấp biến mất khỏi `gross` không lỗi**; map về `PHU_CAP` ⇒ `23505` giữa migration; sinh catalog **bất khả thi** vì §3.1 vừa đẩy catalog sang runtime |
| **B4** | Hai danh sách VERIFY khai «ĐÓNG» **không chứng minh được gì tại nơi chúng chạy**: (a) §4.2 #9 so hai vế tính sống ⇒ **tautology** trên DB sạch; (b) §8 F3 nói «chạy trên hàm backfill» — **không tồn tại hàm nào** | (a) cổng chỉ tồn tại trên lane có dữ liệu v1; (b) để im = mời implementer chép SQL sang test ⇒ test **ghim bản sao của chính nó** ⇒ chốt fail-loud vô tác dụng |
| **B5** | §3.2 vá `paths` **vẫn thiếu** `apps/api/src/foundation/**` (cho `retention.service.ts`) | Đúng lỗi mà §3.2 tuyên bố đang vá. `paths` lái `guard-scope` + bộ chọn reviewer |
| **B6** | Mẫu mặc định seed **RỖNG** — §6 seed `payroll_templates` nhưng **không** seed `payroll_template_components` | Mẫu 0 thành phần không tái tạo gì: BE-2 «xem trước» và BE-3 «tính theo mẫu» ra **bảng 0 cột mà không lỗi** — lại `empty-success-is-the-fail-open-shape` |

**HIGH (9) · MED (3) · LOW (1)** — không chặn cổng, đã đưa vào plan/`done_when`.

---

## 2. ĐIỀU KIỆN TỰ-MỞ-CỔNG — 10 mục, trạng thái

| # | Vá gì | Trạng thái — vá ở đâu |
| --- | --- | --- |
| 1 | **B1**: bỏ «chặn boot»; ghi đúng ngữ nghĩa runner; handoff 422 cho BE-2/BE-3; liệt kê 4 đường không-seed | ✅ plan **§3.1.a** (bảng 4 đường + bằng chứng dòng code) · `backlog.mjs` BE-2 **và** BE-3 `done_when` 🔻 |
| 2 | **B1**: nhóm E chạy `runner.reconcileCompany()`; E4 assert `outcome.ok === false` | ✅ plan **§8.1** bảng 6 ca; ghi thẳng «KHÔNG dùng `.rejects`» |
| 3 | **B2**: 3 assert đếm → **SET-EQUALITY theo mã**, lọc `is_system AND deleted_at IS NULL`; ca dương `DOAN_PHI` | ✅ plan **§3.1.b** (4 mục) + **§6 mục 4a–4c** + §8.1 E1/E2 |
| 4 | **B2**: ca ghim **số PAY-DEC-014** | ✅ plan **§8.1 E5** (11.000.000 · 4.400.000 · 8/1.5/1 · 17.5/3/1 · KPCĐ 2 · đoàn phí 1 · 7 bậc, cuối `upTo=null`) |
| 5 | **B3**: chốt `name → component_code` + round-trip + nợ BE-1; đính chính DB-13 §12.2 | ✅ plan **§4.1.a** (`PC_nnn` + `note`) · **DB-13 §12.2.a** (mục MỚI) · `backlog.mjs` BE-1 `done_when` 🔻 |
| 6 | **B4a**: migration so **literal đã đo**; DoD dán số trước/sau vào PR | ✅ plan **§4.2 #9** (`v_expected constant`) + **§10** gạch đầu dòng 1 |
| 7 | **B4b**: chọn cơ chế F3 | ✅ plan **§8.2** — chọn **lối (iii)** (lane gieo dữ liệu hỏng, dán `RAISE` vào PR); (i)/(ii) ghi rõ vì sao loại |
| 8 | **B5**: `paths` += `foundation/**` | ✅ `backlog.mjs` DB-1 `paths` = `foundation/**` + `permission/**` + `payroll/**` (có comment lý do) |
| 9 | **B6**: chốt mẫu mặc định | ✅ chọn **(a)** — plan **§6 mục 3** seed `payroll_template_components` cho MỖI thành phần `is_system`; assert **SET-EQUALITY hai tập seeded** (§6 mục 4e · §8.1 E6), không magic number |
| 10 | **H1+H2+H3**: literal 10 `object_type` · §7 thêm `schema/audit.ts` · §5.1 literal 13 `resource_type` | ✅ plan **§5.4** (10 tên + cảnh báo bất đối xứng namespace + «track C có chủ đích») · **§7** hàng `db/schema/audit.ts` · **§5.1** (13 resource, cấm `LIKE 'payroll%'`) |

**Chốt cổng:** ✅ 10/10 ⇒ **được phép viết code**.

### HIGH đã vá kèm

`H4` guard += `salary_profiles` (plan §4 bước 1) · `H5` thứ tự `cleanupTenants` đích danh (plan **§7.1**, khối
10 dòng) · `H6` luật bump `seedVersion` (plan §6 blockquote) · `H7` ca đối chứng RLS đổi sang «đổi `FORCE`/policy»
(plan §10) + sửa câu «im lặng bỏ qua» là quá lời (plan §7) · `H8` đối chứng dương worker đích danh 3 bảng
(plan §4.2 #3) · `H9` `company_id NOT NULL` (plan §4.2 #7) · MED `jsonb_typeof` guard (plan §4 bước 1 · DB-13
§12.2) · MED R6 superuser (plan §9) · MED «track C có chủ đích» (plan §5.4).

---

## 3. Reviewer xác nhận ĐÚNG — **đừng sửa khi vá**

1. **Thứ tự bước (5)/(6) AN TOÀN.** Migration chạy qua `DATABASE_DIRECT_URL` = role `mediaos`
   **SUPERUSER/BYPASSRLS** ⇒ backfill **không** bị chính policy vừa bật chặn, dù `FORCE RLS` đã bật trước hàng
   đầu tiên. Thứ tự per-bảng và thứ tự 7 bảng (`payroll_template_components` **cuối**) đúng; mọi đích composite
   FK đều có `UNIQUE (company_id, id)` trước khi bị trỏ tới.
2. **Ranh giới DB-1/DB-2 SẠCH** — plan không chạm `payroll_periods` / `payrollPeriodStatusEnum`, và **không có
   cửa sổ hỏng** do `payroll_templates` ở DB-1 còn FK `payroll_periods.template_id` ở DB-2.
3. **`s13-payroll-db1-invariants.int-spec.ts` KHÔNG bị 17 cặp mới làm đỏ** — D1 (`:529`) và D5 (`:587`) lọc
   `resource_type IN (5 giá trị v1)`, 8 resource mới nằm ngoài. **Đừng sửa file đó**; nếu nó đỏ ⇒ dấu hiệu
   **đặt sai `resource_type`**, không phải spec lỗi thời.
4. **§3.3 đúng và cần thiết** — `PAYROLL_TABLES` là hằng 7 phần tử nên `it.each` cũ không chạm
   `payroll_template_components`; spec MỚI với `DELETE_ALLOWED` + 3 chiều assert là lối đúng.
5. **Ba ratchet toàn cục không đỏ** (với `H9`): `FK_SINGLE_COL_PAIRS_FLOOR` là `>=`, lớp P là `<=`,
   `retention.service.spec.ts` duyệt `PROTECTED_TABLES` **không ghim số** ⇒ **không cần hạ/nâng pin nào**.
   Thấy cần hạ pin = dấu hiệu làm sai, không phải cần nới.
6. **Số học §5 khớp** (đếm độc lập): 17 cặp · `1+14+16 = 31` ⇒ `32+31 = 63` · `17+17 = 34` cặp / `13+17 = 30`
   sensitive · 10 `object_type` ⇒ 14 · 7 bảng · 5+3 cột ALTER.
7. **Giữ nguyên các chốt tốt**: `value_type='engine'` CHECK hai chiều · `code_shape_check` escape `\_` ·
   `EXCLUDE` khoá theo `full_name` NOT NULL + ghim `23P01` · `component_values_json` DEFAULT `'{}'` **không**
   CHECK `<> '{}'` · `insurance_salary` để NULL · giữ cột `allowances` (expand).

---

## 4. FULL gate SAU khi code xong (11/09/2026) — chạy TUẦN TỰ

### 4.1 `security-reviewer` — VERDICT **BLOCK → đã vá 3/3 HIGH + 2 MED + 1 LOW**

| # | Phát hiện | Vì sao nguy hiểm | Đã vá ở đâu |
| --- | --- | --- | --- |
| **H1** | **20 công thức seed dùng REF TRẦN** (`BASE_SALARY`, `INSURANCE_BASE`, `SI_EMPLOYEE_PCT`…) thay vì `SYS_*`/`TL_*` | Theo grammar §13.6 D, REF trần = **mã thành phần** ⇒ `code_shape_check` (chỉ cấm tiền tố `SYS_`/`TL_`/`GT_`) **cho phép** tenant tạo `code='BASE_SALARY'` và **CHE đầu vào engine cho cả công ty** (`fixed_amount=0` ⇒ mọi khoản BH = 0), trong khi CHECK/RLS/mọi bất biến SQL vẫn xanh. Tức CHECK vẫn chạy nhưng **bảo vệ nhầm không gian tên**. Cộng: `PIT_PROGRESSIVE` không có trong `FUNC`; công thức BH **bỏ TRẦN** ⇒ người lương cao bị trừ vượt trần và 3 cột `*_cap` thành trang trí | `payroll-master-data.seeder.ts` viết lại 16 hàng theo `SYS_*`/`TL_*` + `BH_TRAN_*()` + `TNCN_LUY_TIEN()`; xuất `PAYROLL_FORMULA_VOCABULARY`; **ca E11 census MỌI REF** + E12 đối chứng dương. **3 thành phần `THUONG`/`PHAT`/`TAM_UNG` CỐ Ý KHÔNG SEED** (SYS_* không có biến cho đầu vào theo dòng) — ca **E13** ghim chủ đích, nợ ghi vào `done_when` BE-2; DB-13 §13.4 đính chính |
| **H2** | **Hàng `is_system` UPDATE được**: `UPDATE … SET kind='deduction', value_type='fixed', fixed_amount=0 WHERE code='TONG_KHAU_TRU'` lọt qua **cả ba** CHECK (`value_pair` nhánh `fixed` · `engine_kind` false=false · `system_not_deletable` `deleted_at IS NULL`) | Nút engine bị hạ cấp ⇒ engine cộng ra 0 ⇒ **`net = gross` cho cả công ty**, mọi bất biến SQL vẫn xanh. Rẻ hơn nữa: `SET is_active=false` — không CHECK nào chạm cột đó. CHECK xoá-mềm chỉ đóng **một** nhánh của mô hình đe doạ mà chính nó khai | mig `0570`: trigger hẹp `salary_component_system_freeze` (khuôn `bonus_penalty_freeze_guard` của 0564) đóng băng `code·kind·value_type·formula·fixed_amount·pit_deductible·is_system·is_active·company_id·id`, cho sửa `name`/`sort_order`; verify (7.9b) ép trigger tồn tại; ca **C5b–C5d** (ba vector) + **C5e/C5f** (hai đối chứng dương: sửa nhãn vẫn được · hàng thường sửa thoải mái) |
| **H3** | **`payroll_template_components` vừa CÓ `GRANT DELETE` vừa ĐỨNG NGOÀI `PROTECTED_TABLES`** | Đường khai thác đo được: `entityType` của retention-policy là **chuỗi tự do** (contract chỉ ép regex) · `_deleteEligible` lọc theo **`created_at`, KHÔNG theo `deleted_at`** ⇒ hard-delete hàng cấu hình **ĐANG SỐNG** · app role CÓ DELETE ⇒ lệnh chạy thật ⇒ mẫu còn nhưng danh sách thành phần RỖNG, và mẫu do tenant tạo **mất vĩnh viễn**. Lập luận cũ của tôi («tiêu chí là *thiếu* GRANT DELETE») là **phân loại, không phải an toàn** | `retention.service.ts` += bảng thứ 7 kèm lý do đầy đủ; `retention.service.spec.ts` `APPEND_ONLY_TABLES` += **7**; DB-13 §13.6 và `erd-current.md` đính chính (**18** bảng, không phải 17) |
| **M1** | 6 bảng vào `PROTECTED_TABLES` mà **không** vào pin của `.spec.ts` ⇒ ratchet không răng | DB-13 §15.3 bước A đòi «`PROTECTED_TABLES` **+ spec của nó**» | vá cùng H3 |
| **M2** | **A3 tiêu đề nói «7 bảng» mà chỉ lặp 3** — ba bảng bỏ sót đúng là **ba bảng PII**; **E2/E3 xanh RỖNG trên CI** (0 hàng) | Tiêu đề nói dối về độ phủ; hai ca trang trí trên DB sạch | A3 lặp đủ `V2_TABLES` + **đối chứng dương** «fixture gieo đủ hàng cho B» ; E2/E3 đổi tên thành `[CÓ ĐIỀU KIỆN — chỉ ràng buộc trên lane CÓ dữ liệu v1]` + khối comment nói rõ bằng chứng thật nằm ở §10.0 của plan |
| **L1** | Thông điệp fail-loud nhúng **tên + số tiền phụ cấp** vào log migration/CI | Dữ liệu lương hạng masking-ở-server rò qua log vận hành | `0570` (6a)/(6b) rút còn `profile=<id> idx=<ord>` |

**Reviewer xác nhận AN TOÀN (đã soi, đừng sửa):** backfill chạy dưới BYPASSRLS vẫn không ghi được hàng sai tenant
(composite FK ném `23503`, không im lặng) · `ctx.track()` payload sạch PII, `seed_items` sạch · hai chỗ escape `\_`
(SQL và template literal TS) render **CÙNG một luật** · 17 cặp vào hai allowlist **không** mở thêm bề mặt enforcement
và **không spec nào ghim SỐ LƯỢNG** hai danh sách đó · `kind='aggregate' AND NOT is_system` là **bất khả thi** ở
đường INSERT.

### 4.2 `silent-failure-hunter` — **KHÔNG có phát hiện chặn merge**

Đã soi và kết luận AN TOÀN: guard (1b) dùng `COALESCE(v_n,0)` nên bẫy `SELECT…INTO` NULL không thành ·
verify backfill (6d) có hai toán hạng **chắc chắn non-NULL** (guard (1d) đã ép `allowances` là mảng) nên `0=0`
là khớp THẬT chứ không phải che lỗi · census `object_permissions` của `0571` có `v_ids` **chắc chắn non-NULL**
(check 4.1 chạy trước đã ép 34 hàng) · khối UNION-ADD `object_type` **fail-closed** khi không parse được ·
census GRANT **không** xanh-rỗng vì `B4` là đối chứng dương sẽ đỏ trước nếu `relacl` NULL · thứ tự 7 `DELETE`
của `cleanupTenants` **đúng con→cha** · trigger không có nhánh ẩn nào trả `NEW` im lặng.

**Hai nợ LOW hướng-tương-lai** (không chặn, đã ghi vào `done_when` của `S15-PAYROLL-BE-2`):
(a) route tạo thành phần phải từ chối **14 mã hệ thống đã seed**, ngoài luật cấm tiền tố — hôm nay chưa có
route nào ghi `salary_components` nên chưa khai thác được, và hàng trùng mã làm seeder **ném** (fail-loud);
(b) `assertSeedIntegrity` check (5) so **hai tập lấy từ DB** nên không phát hiện được mã catalog bị **khai tử**
ở `seedVersion` sau — khi bump có gỡ mã, phải viết bước vá dữ liệu + assert đối chiếu hằng TS.

---

## 5. LOW (plan-review)

- SPEC-11 §11.3 ghi chú 2 trỏ `SENSITIVE_SCREEN_GATE_PAIRS` ở `:246`; số đúng hiện tại là **`:250`**
  (plan đúng, spec cũ — không sửa ở WO này).

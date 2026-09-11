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

## 4. LOW

- SPEC-11 §11.3 ghi chú 2 trỏ `SENSITIVE_SCREEN_GATE_PAIRS` ở `:246`; số đúng hiện tại là **`:250`**
  (plan đúng, spec cũ — không sửa ở WO này).

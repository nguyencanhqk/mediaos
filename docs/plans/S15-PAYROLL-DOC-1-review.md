# S15-PAYROLL-DOC-1 — plan-reviewer đối kháng, VÒNG 1 (11/09/2026)

> ## ✅ TRẠNG THÁI CUỐI: **PASS — 14/14 mục đã vá (11/09/2026). CỔNG `S15-PAYROLL-DB-1` ĐÃ MỞ.**
>
> Vá theo **ĐIỀU KIỆN TỰ-MỞ-CỔNG** reviewer khai ở §2 ⇒ **KHÔNG mở vòng 2** (đúng đề nghị của reviewer:
> `red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`). Bảng §2 dưới đây có cột **Trạng thái**
> ghi nơi vá của từng mục; §4 là bộ lệnh grep nghiệm thu chạy lại được.
>
> **Hai thay đổi LAN RỘNG kéo theo, WO sau phải biết:**
>
> 1. `audit_logs.object_type` cấp **10** giá trị mới (không phải 8) ⇒ tổng **14** — thêm `payroll_employee`
>    và `payroll_report`. SPEC-11 §18.1 B giờ là **bảng route → `object_type` + `object_id`** đủ 18 đường.
> 2. §21.1 nhóm D thêm ca **25** («Rò tiền qua route GHI v2») ⇒ nhóm E đánh số lại **26–30**.
>
> **Ba quyết định thiết kế MỚI (không có trong bản BLOCK, sinh ra khi vá — đọc trước khi code):**
> `salary_components.value_type` có giá trị thứ tư **`engine`** · `salary_components.pit_deductible` (BOOLEAN)
> · **LUẬT PHỦ** cho `Published → Paid` khi kỳ có nhiều đợt chi trả (SPEC-11 §13.1).

---

> **VERDICT BAN ĐẦU: BLOCK — 14 BLOCKER.** Reviewer đã khai **ĐIỀU KIỆN TỰ-MỞ-CỔNG**: vá đủ 14 mục ở §2 ⇒
> **coi như PASS, KHÔNG cần vòng 2**. Đây là khuôn mà `S13-PAYROLL-DOC-1` đã dùng thành công (SPEC-11 §24).
>
> **Phạm vi review:** `docs/spec/SPEC-11 PAYROLL.md` phần v2 · `docs/DB/DB-13 PAYROLL Database Design.md` §12–§15.
> Đối chiếu chéo: SPEC-01 §17.15–17.16 · permission-matrix §9g.2 · DECISIONS-14 · harness/backlog.mjs.
>
> ⚠️ **Chi phí:** phiên đã **$416.62** khi review kết thúc. Wave cho tối đa 2 vòng —
> reviewer **đề nghị KHÔNG mở vòng 2** (memory `red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`).

---

## 1. Mười bốn BLOCKER

| # | Tóm tắt | Vì sao chặn |
| --- | --- | --- |
| **B1** | Quyền sở hữu §12.3 (4 bước `Paid → Published`) mâu thuẫn ở **3 nguồn**: SPEC-11 §23.2(a) giao DB-1, DB-13 §15.3 bước C giao DB-2, `backlog.mjs:15869` giao `template_id` cho DB-1 | Bước (2) nới `status_check` và bước (3) `UPDATE status='Published'` là **một chuỗi nguyên tử**. Tách hai WO ⇒ `UPDATE` vi phạm CHECK 7-giá-trị ⇒ **`23514` giữa lane migration đỏ** |
| **B2** | **8 chuỗi** còn ghi «7 trạng thái / 7 giá trị / `Approved → Paid`» không đánh 🔁 — SPEC-11 dòng 1394·338·428·476·1226·653 · DB-13 dòng 240/247/256–258·31 | Chuỗi #1 nằm trong **bảng test scenario** ⇒ WO QA viết ca ghim `payrollPeriodStatusEnum` **= 7**, tức đóng đinh đúng lỗ «Zod 7 vs CHECK 8 ⇒ 500 đường ĐỌC». §24.1 tick «6 chỗ đã đánh 🔁» là **tick SAI** với #5 (§17) |
| **B3** | Bản đồ `audit_logs.object_type` (12 giá trị, khai **ĐÓNG**) **không phủ 6/18** đường audit-đọc: 078·079·081·082 (báo cáo) · 036·037 (chiếu nhân viên) | §12.1 nói thẳng «ghi `object_type` ngoài bản đồ = **CHECK violation 500**». Thiếu `payroll_report` (và `payroll_employee`) |
| **B4** | `salary_profile_items` là bảng mới **0 route ghi**; §15.1 giữ nguyên `POST /salary-profiles` (020) payload v1 `allowances[]`, không đánh 🔁. Unique của bảng cũng **không có mã lỗi** | WO BE-1 buộc phải hoặc đổi ngầm hợp đồng 020/022, hoặc tự cấp route 086 (phá con số 50 «ĐÓNG»). `23505` không map ⇒ 500 |
| **B5** | Kỳ có **≥2 đợt chi trả đi vào ngõ cụt vĩnh viễn**: đợt #2 hoàn tất ⇒ `assertPeriodTransition('Paid','Paid')` ⇒ 409 ERR-001 mãi mãi. **ERR-028 là mã CHẾT**. Và **§21.1 ca 15 ghim lỗ này thành hành vi đúng** | Người trong đợt #2 **không bao giờ được đánh dấu đã chi**. Mô hình cho phép nhiều đợt (ERR-027 `payee-already-in-batch`) nhưng FSM chỉ chịu được một |
| **B6** | Ngân sách **25.000 node chia chung cho 30 vòng** gross-up ⇒ hồ sơ NET **bất khả thi về toán học** (25.000 ≈ đúng **một** lượt: 120×200) | Mọi hồ sơ `salary_type='NET'` vượt trần từ **vòng thứ 2** ⇒ 422 ERR-020 ⇒ **PAY-DEC-015 (owner đã ký) không chạy được**, ca §21.1 số 1 không thể xanh |
| **B7** | 4 nút `aggregate` định nghĩa theo `kind` **không biểu diễn được 3 quyết định đã ký**: (1) **đoàn phí bị trừ khỏi thu nhập tính thuế** (sai cấu trúc, không phải sai «số»); (2) `tax_exempt` bị trừ nhưng **không bao giờ được trả**; (3) `pit_payer='COMPANY'` không diễn đạt được | Fixture đối soát tay §21.1 ca 1 **sẽ được dựng theo chính spec này** ⇒ ca test ghim lỗi. Sai cấu trúc ⇒ **không** được che bởi §3.11 «owner chịu trách nhiệm số» |
| **B8** | Mã hệ thống **tạo lại được sau xoá mềm** ⇒ 4 nút `aggregate` bị che. §8.2 C1 khai «CHECK + UNIQUE» là **SAI** — 4 mã đó không mang tiền tố `SYS_`/`TL_`/`GT_` nên chỉ được `..._code_uq WHERE deleted_at IS NULL` bảo vệ | «Hàng hệ thống không xoá» chỉ ép ở service. Một lượt xoá mềm ⇒ người dùng tạo `TONG_KHAU_TRU` công thức bất kỳ ⇒ che nút engine |
| **B9** | Khai 4 nút `aggregate` bằng `value_type='fixed', fixed_amount=0` là **bẫy fail-open im lặng**, không phải thoả hiệp | Mọi `switch(value_type)` viết đúng-theo-DB trả **0** ⇒ `net=0` hoặc `net=gross` **trong khi mọi bất biến SQL vẫn xanh**. Đúng hình dạng `empty-success-is-the-fail-open-shape` |
| **B10** | `PAYROLL-API-071` (tệp UNC: **số TK đầy đủ + net từng người**) gác bằng **ĐÚNG MỘT cặp GHI** | Phá luật của chính module (§11.1, bài học RECRUIT H5): «export đòi CẢ HAI cặp». 3 đường xuất khác đều tuân. Role chỉ có `manage:payment-batch` tải được **payload nhạy cảm nhất toàn hệ thống** |
| **B11** | §12.1 ghi chú 3 trình bày như danh sách ĐÓNG nhưng **thiếu ≥3 ràng buộc**, và **gọi nhầm tên**: `payee-already-in-batch` thực ra do **`payroll_payment_lines_payslip_uq`** bắt, không phải `batch_user_uq` | ⇒ đường **chống trả lương hai lần** hiện trả **500** thay vì 409 |
| **B12** | **Mất luật «route GHI không chở số tiền»** ở v2: 6 cặp view/manage mới chở tiền, **0 luật, 0 ca test** | Role chỉ giữ `manage:*` đọc được tiền **qua cửa sau** (060·062·067·069·039·074·075) và **không cổng nào chạm tới**. v1 có luật này + nhóm test riêng |
| **B13** | DB-13 §15.3 **bước C không có verify RLS/FORCE/GRANT/composite-FK** cho 4 bảng chở dòng tiền; **`rls-registry` biến mất khỏi toàn bộ kế hoạch v2** | 11 bảng mới có thể nằm ngoài `rls-guards.int-spec` ⇒ cổng cô lập tenant **mù với 11 bảng lương mới** (bất biến #1) |
| **B14** | `backlog.mjs` (hợp đồng **máy-đọc** của WO đỏ) mâu thuẫn tài liệu ở **5 chỗ**: (a) `template_id` sai WO · (b) giới hạn công thức **2000/32/500** vs spec **500/20/200** · (c) **timeout 50ms** vs ngân sách node tất định · (d) 054 gác sai cặp + sai `is_sensitive` · (e) route `attendance-summary` vs `timesheet` | (b) ⇒ công thức 501–2000 ký tự qua Zod rồi **`23514` = 500** ở DB. (c) ⇒ ca đỏ ngẫu nhiên theo tải CI ở vùng đỏ. (e) ⇒ `route-http-coverage` literal path lệch |

**HIGH (10) · MED (6) · LOW (3)** — không chặn cổng, đưa vào `done_when` của DB-1/BE-2/BE-4/QA-1.
Đáng chú ý: **H1** `IF` không short-circuit + chia-0 ném lỗi ⇒ idiom `IF(d=0,0,X/d)` **vẫn nổ**; **H2** route 082 (export báo cáo) thiếu sàn scope Company trong khi 081 có; **H5** danh sách «KHÔNG audit» thiếu 7 route; **H7** DB-13 bước D nói «seed 17 cặp track C» (track C chỉ có 8, bước B đã seed đủ).

---

## 2. ĐIỀU KIỆN TỰ-MỞ-CỔNG — vá đủ 14 mục ⇒ PASS, KHÔNG cần vòng 2

| # | Vá gì | Kiểm bằng | Trạng thái — vá ở đâu (11/09/2026) |
| --- | --- | --- | --- |
| 1 | SPEC-11 §23.2(a): bỏ «backfill `Paid → Published` + 4 bước», «3 ALTER» → «**2 ALTER** (§12.1+§12.4)»; §23.2(b) thêm «§12.3 đủ 4 bước»; `backlog.mjs` DB-1 bỏ `template_id`, DB-2 nhận | `grep "3 ALTER"` = 0 hit | ✅ SPEC-11 §5.1b · §8.2 (bảng A thêm **cột WO**) · §23.2 hàng 4 + nợ (a)/(b) · DB-13 §15.3 bước A/C · `backlog.mjs` DB-1 title/`done_when` ⛔-clause + DB-2 title/`done_when` 4 bước · API-18 · README · erd-current · RELEASE-14 · IMPL-02 |
| 2 | Sửa **8 chuỗi** của B2 + bỏ tick sai ở §24.1 | `grep "7 trạng thái\|7 giá trị.*17.15\|Approved → Paid"` chỉ còn ở §1 bảng đối chiếu · §22 PAY-DEC-005 · §5.1 (đều gắn nhãn «v1») | ✅ SPEC-11 §8 · §9.1 (PAY-SCREEN-001) · §10 (FUNC-010) · §12 (ERR-004) · §17 (bảng event) · §21 (hàng Validate) · DB-13 §2 · §6.3 tiêu đề + cột `status` + khối CHECK; §24.1 đổi `[~]` → `[x]` liệt kê đủ 8 |
| 3 | Thêm bảng **route → `object_type` + `object_id`** cho đủ 18 đường §18.1 B; UNION-ADD `payroll_report` (+`payroll_employee`); đồng bộ 3 chỗ con số | mỗi mã trong §18.1 B có đúng một `object_type` thuộc danh sách UNION-ADD | ✅ SPEC-11 §18.1 B = **bảng 18 hàng** (kèm luật `object_id` NULL cho đường đọc DANH SÁCH và cho `reportCode` — cột `uuid`); §12.1 ghi chú 4 **8 → 10 giá trị (⇒14)**; đồng bộ §23.2(a) · DB-13 §15.3 bước B |
| 4 | Cấp bề mặt API cho `salary_profile_items`: đánh 🔁 §15.1 hàng 020/022 (payload `items[]`) **hoặc** cấp 2 route + đính chính 50→52; cấp `kind` cho `23505` | `salary_profile_items` xuất hiện ≥1 lần trong §15.1 | ✅ Chọn lối 🔁 (**giữ 50 route**): §15 hàng 020/022 đánh 🔁 payload `items[]`; §15.1 có blockquote 🔴 giải thích vì sao KHÔNG cấp 086/087; `kind = profile-item-duplicate` thêm vào **ERR-014** (không đẻ mã mới) |
| 5 | Chốt mô hình đợt chi trả — **(A)** mọi đợt `Completed` mới sang `Paid`, ERR-028 sống lại · **(B)** 1 đợt/kỳ + UNIQUE + gỡ `payee-already-in-batch`; sửa §13.1·§12.1·§21.1 ca 15·DB-13 §14.2/§14.3 | ERR-028 có ≥1 đường phát; ca 15 không còn assert «đợt thứ hai 409» nếu chọn (A) | ✅ **Chọn (A)** + chốt **LUẬT PHỦ** (SPEC-11 §13.1, có pseudo-code 4 bước dưới row-lock). **ERR-028 đổi nghĩa** sang `batch-empty` — đường phát duy nhất, thật sự tới được. §12.1 ERR-027/028 · §15.1 hàng 072 · §17.1 event 027 (dedupe `{periodId}`, chỉ phát khi kỳ CHUYỂN `Paid`) · §21.1 ca 15 viết lại 7 nhánh kèm **ca ÂM** · DB-13 §14.2/§14.3/§15.4 |
| 6 | Chốt MỘT con số ngân sách node cho gross-up ở §13.6 C + §13.8 + §19.1 (vd 25.000/**lượt**, trần tổng 775.000/dòng) | ba mục nói cùng con số; `120×200×30 ≤ trần` | ✅ **HAI trần, ba mục nói cùng số**: `BUDGET_PER_PASS = 25.000` · `BUDGET_PER_LINE = 775.000` (= 25.000 × 31 = 30 vòng + lượt cuối). Tự-kiểm `120×200×30 = 720.000 ≤ 775.000` ghi ngay trong bảng §13.6 C. Thêm **ca đối chứng** §21.1 ca 9: hồ sơ NET thực tế phải XANH |
| 7 | Sửa 3 định nghĩa §13.6 E/§13.7: đoàn phí **ra khỏi** `TONG_BH_NV`; `TONG_THU_NHAP = Σ {earning, tax_exempt}`; `TONG_KHAU_TRU` gồm `tax` **chỉ khi** `pit_payer='EMPLOYEE'` | ba công thức §13.6 E khớp §13.7 C/D/E từng chữ | ✅ §13.6 E bảng 4 nút sửa + blockquote 🔴 nêu 3 lỗi; §13.7 C/D/E khối `text` **lặp lại nguyên văn** ba vế. Đoàn phí tách bằng **cột dữ liệu mới `salary_components.pit_deductible`** (DB-13 §13.4), **không** hard-code mã `DOAN_PHI`. §21.1 ca 2 tách thành 4 nhánh (a)–(d) |
| 8 | DB-13 §13.4 thêm `chk salary_components_system_not_deletable  is_system = false OR deleted_at IS NULL` + ca §21.1 số 8 nhánh xoá-mềm | CHECK có mặt trong khối SQL §13.4 | ✅ DB-13 §13.4 khối SQL + blockquote giải thích (partial unique `WHERE deleted_at IS NULL` là lỗ); SPEC-11 §8.2 C1 sửa câu «CHECK + UNIQUE» thành **ba chốt**; §21.1 ca 8 có nhánh (c) ghi thẳng qua repository |
| 9 | Thêm `value_type = 'engine'` (4 giá trị) cho 4 nút `aggregate`; sửa `value_pair_check`; đồng bộ §15.1 + contracts | `grep "fixed_amount = 0"` trong §13.4 = 0 hit | ✅ DB-13 §13.4 cột + `value_type_check` 4 giá trị + nhánh `engine` trong `value_pair_check` + **CHECK hai chiều** `salary_components_engine_kind_check`; §15.1 enum v2 = 4 giá trị; SPEC-11 §13.6 E câu mở đầu; bảng seed §13.4 ghi `engine` cho cả 4 |
| 10 | §15.1 hàng 071 + §11.3 hàng 14: 071 assert **3 cặp**; §21.1 thêm ca deny thiếu-một-cặp | hàng 071 có `('export','payroll')` **và** `('view-payslip','payslip')` | ✅ §15.1 hàng 071 = **3 cặp** kèm lý do từng cặp; §11.3 hàng `manage:payment-batch` ghi ⚠️ «KHÔNG đủ để xuất tệp UNC»; §21.1 ca 20 thêm **3 ca**: thiếu `export:payroll` ⇒ 403 · thiếu `view-payslip` ⇒ 403 · đủ ba ⇒ **200** |
| 11 | Viết lại §12.1 ghi chú 3 thành bảng `constraint → SQLSTATE → mã + kind`; **sửa tên** `batch_user_uq` → `payslip_uq` | bảng ≥6 hàng, có `salary_components_code_shape_check` và `payroll_payment_lines_payslip_uq` | ✅ §12.1 bảng **13 hàng** (mọi TÊN đã đối chiếu tồn tại trong DB-13 §12–§14); `payslip_uq` đứng đầu kèm lý do tại sao `batch_user_uq` không bắt được; DB-13 §14.3 thêm cảnh báo map-theo-tên; §21.1 ca 30 (b) census theo TÊN ràng buộc |
| 12 | §11.3 ghi chú 8 «route GHI không chở tiền» + liệt kê đúng bằng; §21.1 D thêm ca «Rò tiền qua route GHI (v2)»; DB-13 §15.3 bước B verify `manage:X ⇒ view:X` cho advance/batch/budget/salary-component | §21.1 D có 25 ca | ✅ §11.3 **ghi chú 8** = bảng **7 route GHI** + khoá cấm; §21.1 **ca 25** (nhóm D giờ kết ở 25, nhóm E 26–30); DB-13 §15.3 bước B verify 4 tài nguyên |
| 13 | DB-13 §15.3 bước C: chép nguyên khối RLS+FORCE+policy+GRANT+`0 DELETE`+composite-FK+VERIFY của bước A; thêm «đăng ký `rls-registry` + fixture 11 bảng» vào «cùng commit» của A và C | bước C chứa `relrowsecurity AND relforcerowsecurity`; `grep rls-registry` trong §15.3 ≥ 1 | ✅ DB-13 §15.3 bước C viết đủ khối (kèm `aclexplode`, `mediaos_worker` không `SELECT`, `cleanupTenants` thứ tự con→cha); `rls-registry` có ở **bước A (7 bảng) và bước C (4 bảng)**; §15.4 thêm hàng rủi ro 🔴 «11 bảng đứng ngoài `rls-registry`» kèm ca đối chứng; SPEC-11 §23.2 nợ (a)/(b) cùng câu |
| 14 | `backlog.mjs` sửa 5 mục (a)–(e) của B14; SPEC-11 §13.6 B thêm «**Zod KHÔNG cap `length(formula)`**» | `grep "2 000 ký tự\|50 ms/dòng\|attendance-summary\|không sensitive vì không có tiền"` = 0 hit | ✅ (a) `template_id` → DB-2 · (b) `2 000/32/500` → **500/20/200/120** · (c) timeout 50 ms → **ngân sách node tất định** · (d) 054 gác `('manage','payroll-template')` **sensitive** · (e) `attendance-summary` → **`timesheet`** (cả `done_when` BE-1 lẫn màn 008 của FE-1). SPEC-11 §13.6 B thêm blockquote 🔴 Zod-không-cap + ca ghim 501 ký tự ⇒ 422 018 |

**Chốt cổng:** ✅ 14/14 xong (11/09/2026) ⇒ **`S15-PAYROLL-DB-1` ĐƯỢC MỞ**.

---

## 3. Reviewer xác nhận ĐÚNG (đừng sửa khi vá)

Đếm lại **độc lập** từng danh sách: 11 bảng · 11 màn · 50 route · 16 mã lỗi · 17 cặp · 31⇒63 grant · 4 event ·
2 widget · 11 route Idempotency · 18 đường audit — **KHỚP**. Chỉ 3 con số lệch (B1 «3 ALTER» · H7 · H8).

Vệ tinh đã đồng bộ thật (kiểm 11/09): SPEC-01 §17.15 = 8 trạng thái ✓ · §17.16 = `{Published, Paid, Locked}` ✓ ·
permission-matrix §9g.2 = 17 cặp + 63 grant ✓ · DECISIONS-14 tồn tại ✓.

Mười hai điểm được khen giữ nguyên — đáng chú ý: §3.9 bảng ranh giới TS↔SQL + câu chặn «clamp ở JS được rồi» ·
§13.2 + ca 13 (phiếu ở `Published`, lớp `empty-success-is-the-fail-open-shape`) · §12.3 bốn bước + **ca ÂM
«migrate thứ tự đảo phải ĐỎ»** · §13.3 chọn `full_name` NOT NULL làm khoá `EXCLUDE` · §14.4 `COALESCE` sentinel ·
§14.3 `payslip_uq` toàn công ty + trigger đóng băng kèm `deleted_at` · §13.7 C + ca 2 (phần DN không vào
`TONG_KHAU_TRU`) · §3.12 phân hạng PII · 4 đính chính con số của hồ sơ wave.

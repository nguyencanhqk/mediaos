# S15-PAYROLL-QA-1 — nghiệm thu QA PAYROLL v2 (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S15-PAYROLL-QA-1`. Nguồn luật: [`SPEC-11 PAYROLL`](../../spec/SPEC-11%20PAYROLL.md)
> §21.1 (30 kịch bản bắt buộc của v2) · §11.3 (17 cặp mới) · §12.1 (mã 018–033 + bản đồ ràng buộc) · §13.1 (FSM 8
> trạng thái) · §13.6–§13.8 (máy công thức) · API-18 route 036–085. Plan + khảo sát khoảng trống:
> [`docs/plans/S15-PAYROLL-QA-1.md`](../../plans/S15-PAYROLL-QA-1.md).
> Nhánh `test/s15-payroll-qa-1` cắt từ master `9dba4e18`. Lane DB `mediaos_s15qa1` (+ `…b/c/d` cho lane song song),
> dựng mới, chain `0000 → 0575`. Ngày đo: **2026-09-17**.

Bảng dưới **không nhân bản** nội dung test: nó ánh xạ _kịch bản_ → _ca đang canh kịch bản đó_. Ca **in đậm** là
**MỚI** của WO này; không in đậm là ca đã có từ `S15-PAYROLL-DB-1…BE-5B` (khảo sát trước khi viết, không viết lại).

---

## 1. Truy vết SPEC-11 §21.1 → ca test

| #   | Kịch bản                                                       | Ca đang canh                                                                                                                                                                                                                |
| --- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Bảng tay khớp từng đồng — GROSS đủ khoản · NET                 | NV-G (bậc cao, trần BH, 2 NPT) + NV-N (gross-up 12 vòng) — `s15-payroll-be3-calculate` + `BE-3-DOI-SOAT` · **NV-L bậc THẤP + điều chỉnh tay — `s15-payroll-qa1-arith` A1 + `S15-PAYROLL-QA-1-doi-soat.py`**                 |
| 2   | Bốn nút tổng hợp (a)–(d), ca RIÊNG                             | `formula.graph.spec` (a)–(d) · `formula.line.spec` (a)–(d) · NV-C (`be3-calculate`)                                                                                                                                         |
| 3   | Số lẻ thật                                                     | NV-G/NV-N · **NV-L (21.345.678,95 · 234.567,85 · 111.111,15 · −12.345,67)**                                                                                                                                                 |
| 4   | Tỉ lệ versioned · xoá bản hiệu lực ⇒ 422 022, kỳ không đổi     | `be3-calculate` · `be3-binding-gates` G5 · **`qa1-arith` C1 (giữa tháng vs ngày cuối kỳ · hai kỳ hai phía mốc) · C2 (422 022 + kỳ giữ `CollectingData`)**                                                                   |
| 5   | Fuzz parser — luôn 4xx có mã, không 500/treo/tràn stack        | `formula.fuzz.spec` (1.812 chuỗi có seed) · **`qa1-formula` B1 (264 chuỗi qua HTTP 048: NUL · `__proto__` · `process.exit()` · 10.000 cấp · 500 chữ số · emoji) · B2 (nhầm kiểu JSON ⇒ 400) · B3 (8 chuỗi qua 045)**        |
| 6   | Vòng trực tiếp · gián tiếp · qua nút tổng hợp ⇒ 422 019        | `formula.graph.spec` · `s15-payroll-be2-components` B3                                                                                                                                                                      |
| 7   | Vòng sinh ra do GHI SONG SONG                                  | `be3-binding-gates` G8 (vế lúc TÍNH) · **`qa1-race` ca 5 (047 × 047 song song ⇒ đúng 200 + 422 019; đột biến gỡ khoá catalog ⇒ ĐỎ)**                                                                                        |
| 8   | Shadowing ba nhánh (reserved · exists · xoá mềm hàng hệ thống) | `s15-payroll-be2-components` · `s15-payroll-db1-invariants` C4                                                                                                                                                              |
| 9   | Hai trần ngân sách node + đối chứng dương                      | `formula.evaluator.spec` (biên đúng + mẫu 120×200 × 31 lượt) · `formula.line.spec`                                                                                                                                          |
| 10  | Gross-up dao động ⇒ 422 021, 0 dòng                            | `be3-binding-gates` G12                                                                                                                                                                                                     |
| 11  | Sửa công thức sau khi tính KHÔNG đổi số                        | `be3-calculate` C4 (ghi DB) · **`qa1-formula` A1 (qua CHÍNH route 047: đọc lại byte-y-hệt + fingerprint giữ; tính lại ⇒ đổi cả hai)**                                                                                       |
| 12  | FSM 8×8 — mọi ô ✗ ⇒ 409                                        | `payroll-fsm.spec` · `s13-payroll-qa1-fsm-race` A · **`qa1-fsm` bảng TAY 72 ô (không suy từ `nextStatus()`) · `payroll-fsm.spec` (h) 126 ô sai-action · (i) 80 ô `nextStatus`** — lệch §3.3                                 |
| 13  | Phiếu ở ĐÚNG `Published` — `/me/payslips*` + PDF               | `payroll-be2-lifecycle` (~1102–1124) · `s15-payroll-be5b-pdf` 084                                                                                                                                                           |
| 14  | Di trú `Paid → Published`                                      | ⚠️ **chỉ có khối VERIFY fail-loud trong chính mig `0572`** (đếm trước = sau · hậu kiểm 0 hàng `Paid`) + E1/E2 `s15-payroll-db2-invariants` (CHECK cặp vết). KHÔNG có int-spec tái lập di trú — §3.6                         |
| 15  | Luật PHỦ nhiều đợt · 028 · 027 · race hai đợt cuối             | `s15-payroll-be4-batches(-complete)` · **`qa1-race` ca 1 (hoàn tất CÙNG một đợt song song ×3 ⇒ 1×200 + 1×409 027, kỳ `Paid` một lần, đúng 1 outbox 027)**                                                                   |
| 16  | `PAYSLIP_PUBLISHED` phát ở publish                             | `payroll-be2-noti-audit` · `s15-payroll-be4-batches` (0 event ở đợt chưa phủ)                                                                                                                                               |
| 17  | Ma trận allow/deny 50 route × role, cả hai tầng                | census 2 tầng · **`qa1-roles` (role HỆ THỐNG × 50 = 355 ca) · `qa1-pair-matrix` (thiếu-đúng-một-cặp × 17 cặp) · census (2) so thêm cờ `isSensitive`**                                                                       |
| 18  | Mọi DENY có ALLOW song sinh, ALLOW assert mã chính xác         | **mọi file mới — ALLOW `=== route.ok` (200/201/202)**                                                                                                                                                                       |
| 19  | IDOR cross-employee · cross-tenant 11 bảng                     | `be4-advances` (065 lọc chủ · 061 403) · `be5b-pdf` (084 404 010) · RLS harness `tenant-isolation` (đủ 11 bảng) · **`qa1-idor-leak` G5 (GHI chéo tenant 039/041/052/064/075 + loại trừ danh sách 036/073) · G7**            |
| 20  | Mask số TK · ba DENY của 071                                   | `payroll-be1-employee-settings` B1 · `be4-batches` (066/068/070) · `be4-batches-complete` (071 ba cặp) · **`qa1-pair-matrix` C (cặp phụ giữ ở scope Department ⇒ 403 cho 071/083/085; đột biến gỡ vế 083 ⇒ ĐỎ)**            |
| 21  | `taxCode` vắng/có theo cặp phụ                                 | `payroll-be1-employees` C                                                                                                                                                                                                   |
| 22  | Sàn Company 078/079/081/073 (+ widget)                         | `s15-payroll-be5-report-gates` · `s13-payroll-qa1-scope-floor` — widget 002/003 thuộc `S15-PAYROLL-DASH-1`                                                                                                                  |
| 23  | Allowlist capability                                           | `sensitive-screen-gate-allowlist.spec` (allowlist ⊇ danh sách cổng màn) · **`qa1-roles` C (`/auth/me` của officer/admin/employee trả ĐÚNG tập cặp v2 đang giữ — gỡ một cặp khỏi allowlist ⇒ ĐỎ; hr-manager + wildcard: 0)** |
| 24  | Đối chứng «duyệt mù»                                           | **`qa1-idor-leak` #24 — rủi ro còn lại được GHIM (gỡ `view` lúc runtime ⇒ 059/061 403 nhưng 063 vẫn 201)**                                                                                                                  |
| 25  | Rò tiền qua route GHI                                          | **`qa1-money-leak` (7 route GHI không khoá tiền · 7 route ĐỌC 403 · 7 ALLOW có khoá tiền · 072 `unpaidPayees` là số người)**                                                                                                |
| 26  | NPT chồng lấp ⇒ 409 032 từ EXCLUDE                             | `payroll-be1-dependents` · `s15-payroll-db1-invariants`                                                                                                                                                                     |
| 27  | Expand-contract `allowances` → items                           | `payroll-be1-legacy-items` · `s15-payroll-db1b-invariants`                                                                                                                                                                  |
| 28  | Import 076 toàn tệp hoặc không gì                              | `s15-payroll-be4-budgets-import`                                                                                                                                                                                            |
| 29  | Tạm ứng khấu trừ đúng một lần                                  | `s15-payroll-be4-advances` · `s15-payroll-be3-calculate`                                                                                                                                                                    |
| 30  | Coverage ≥ 85 % · census theo MÃ · census theo TÊN ràng buộc   | §4 · `payroll-error-code-census` (33 mã) · **census tên ràng buộc — §3.5**                                                                                                                                                  |

Ngoài §21.1, `done_when` của WO còn: **wildcard không kế thừa từng cặp mới** (`qa1-roles` B — `*:*` và HỢP bốn hình
dạng trên 8 tài nguyên × 4 action ⇒ 403 cả 50 route) · **đột biến (k) NOTI-027** (§3.4) · **T4/T6 FE** (§4) ·
**tách `be4-batches`** (945 dòng ⇒ 649 + 501, 23 ca giữ nguyên tiêu đề).

---

## 2. Ca mới theo file

| File                                                                    | Ca         | Nội dung                                                                      |
| ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `test/integration/s15-payroll-qa1-roles.int-spec.ts`                    | 355        | 6 role hệ thống + `*:*` × 50 route · `/auth/me`                               |
| `test/integration/s15-payroll-qa1-pair-matrix.int-spec.ts`              | 73         | ALLOW 50 route · thiếu-một-cặp × 17 · cặp phụ scope hẹp · 082 theo người      |
| `test/integration/s15-payroll-qa1-fsm.int-spec.ts`                      | 78         | bảng tay 72 ô · không có route tắt vào `Paid` · four-eyes đổi vai · reset vết |
| `test/integration/s15-payroll-qa1-idor-leak.int-spec.ts`                | 11         | GHI chéo tenant · loại trừ danh sách · Own fail-closed · #24                  |
| `test/integration/s15-payroll-qa1-money-leak.int-spec.ts`               | 10         | §21.1 #25                                                                     |
| `test/integration/s15-payroll-qa1-race.int-spec.ts`                     | 5          | 072×072 · 063×064 · 011×012 · 085×085 · 047×047                               |
| `test/integration/s15-payroll-qa1-arith.int-spec.ts`                    | 4          | NV-L · biên NPT · tỉ lệ versioned · 422 022                                   |
| `test/integration/s15-payroll-qa1-formula.int-spec.ts`                  | 5          | 047 sau Calculated · fuzz HTTP · nhầm kiểu · 045 · XLSX 017                   |
| `test/integration/s15-payroll-qa1-constraints.int-spec.ts`              | 12         | ràng buộc DB bắn THẬT → `mapPayrollPgError` (§3.5)                            |
| unit `test/foundation/payroll-constraint-map-census.unit-spec.ts` (mới) | 61         | census tên ràng buộc + `trigger:tag` theo bảng đóng §12.1                     |
| unit `payroll-fsm.spec` · `formula.evaluator.spec`                      | 2 · 22     | sai-action · `nextStatus` · mốc bậc thuế ±0,01 · đúng trần BH                 |
| unit `payroll-payslips.repository.spec` (mới)                           | 9          | P2                                                                            |
| unit `payroll-export.service.spec` · `payroll.errors.spec`              | +4 · 1 sửa | P1 (đọc lại XLSX thật bằng exceljs) · P3 (ca cũ ghim `null` ⇒ đòi 400)        |
| unit `payroll-noti-bridge.registrar.spec` (mới)                         | 12         | khoá dedupe 020–027                                                           |
| FE `payroll-qa1-disbursement-gates.spec.tsx`                            | 16         | T4 (4) · T6 (12)                                                              |

**Tổng mới: 553 ca int + 110 ca unit + 16 ca FE.**

---

## 3. Lỗi sản phẩm · lệch có chủ đích · rủi ro còn lại

### 3.1 P1 — 017 xuất bảng lương không chống formula-injection (ĐÃ VÁ)

`payroll-export.service.ts` ghi `employeeCode` · `displayName` · `adjustment_reason` (chữ tự do) thô, trong khi
071/082 đã qua `xlsxSafe`. exceljs lưu chuỗi thành ô văn bản nên tệp vừa tải chưa tự chạy công thức, nhưng người
dùng sửa ô (F2 + Enter), lưu lại dạng CSV hoặc cổng ngân hàng chuyển đổi tệp là công thức sống. Vá: ba ô qua
`xlsxSafe`; hàm dời sang `payroll-xlsx.util.ts` (phá vòng import `payroll-export.service` ↔
`payroll-payment-export.service`). RED trước: 3/3 ca đỏ (`expected [ '=', … ] to deeply equal [ '\'=', … ]`).

### 3.2 P2 — bộ lọc Own của phiếu lương rơi mất khi owner rỗng (ĐÃ VÁ, phòng thủ chiều sâu)

`PayrollPayslipsRepository.selectPayslips` dùng truthy-guard trên `ownerUserId` ⇒ `""`/`undefined` làm 031/032/084
đọc phiếu TOÀN CÔNG TY kể cả kỳ chưa phát hành. `resolveActor` hiện chặn trước (user không id ⇒ 0 grant ⇒ 403) nên
không khai thác được qua HTTP; vá vì một caller ngoài HTTP (job/bridge) sẽ mở lại lỗ — đúng lớp BE-4B đã vá cho 065.
Vá: `PayslipListOpts.ownerUserId: string | null` BẮT BUỘC (caller khai ý định lúc biên dịch); khác `null` mà không
phải chuỗi khác rỗng ⇒ NÉM trước khi chạm DB. Cùng lượt: `findTx` với `payslipId` rỗng ⇒ NÉM (truthy-guard `byId`
từng biến thành «phiếu bất kỳ, limit 1»). RED trước: 3/3 ca đỏ (`promise resolved "[]" instead of rejecting`).

_(P3 — xem §3.5.)_

### 3.3 Lệch có chủ đích — `publish` trả 007 ở mọi trạng thái khi chưa sinh phiếu

§21.1 #12 viết «mọi ô ✗ ⇒ 409 001». `PayrollPayslipsService.publish` đặt cổng 007 `no-payslip` TRƯỚC FSM (comment
trong code: «chưa sinh phiếu là nguyên nhân riêng, không được nuốt thành 001»). Kỳ ở trạng thái trước `Approved` không
bao giờ có phiếu ⇒ người dùng luôn thấy 007 (vẫn 409, thông điệp hữu ích hơn). Kỳ đã phát hành (có phiếu) publish lại
⇒ 409 001 như spec. `qa1-fsm` ghim thứ tự thật; KHÔNG đổi code. Đề nghị owner xác nhận để sửa chữ §21.1 #12.

### 3.4 Đính chính backlog — NOTI-027 dedupe theo `periodId`, không theo `batchId`

Khoá `PAYROLL_PAYMENT_BATCH_COMPLETED:{periodId}` là CỐ Ý (SPEC-11 ~dòng 1409: khoá theo đợt ⇒ nhiều thông báo «đã
chi» cho một kỳ). Đột biến (k) đúng nghĩa là «đổi khoá sang `batchId` phải ĐỎ»: ghim ở `be4-budgets-import:643` (DB)
và nay ở unit `payroll-noti-bridge.registrar.spec` (hai `batchId` cùng kỳ ⇒ CÙNG khoá; hai kỳ ⇒ khác khoá).

### 3.5 Census tên ràng buộc (§21.1 #30 b) — và lỗi sản phẩm thứ BA

`test/foundation/payroll-constraint-map-census.unit-spec.ts` (61 ca) đọc THẲNG bảng đóng SPEC-11 §12.1 (neo đếm:
**17** tên ràng buộc · **3** trigger · **15** cặp `trigger:tag`, trong đó 4 tag CỐ Ý không map — 500 có chủ đích) và
đòi: (1) mọi tên/trigger có trong `mapPayrollPgError`; (2) mọi tên/`trigger:tag` có ca kích hoạt THẬT trong bề mặt
int-spec PAYROLL (bỏ comment trước khi quét — `salary_components_code_shape_check` trước đây chỉ được NHẮC trong
comment). `s15-payroll-qa1-constraints.int-spec.ts` (12 ca) bắn ràng buộc thật bằng SQL rồi đưa CHÍNH lỗi pg vào
`mapPayrollPgError`, mỗi ca có đối chứng dương. Ba phát hiện:

- **P3 — `payroll_period_lines_adjustment_check` rơi 500 (ĐÃ VÁ).** Mapper trả `null` (comment ngay trên nói «xếp về
  400») ⇒ 009 `adjustLine` ném lỗi pg thô ⇒ 500 vô danh ở vùng đỏ. Ca unit cũ ghim `null` — ghim cái lỗ. Vá:
  `payrollBadRequest(c)` như ba CHECK «Zod đã mirror» khác; ca unit đổi sang đòi 400.
- **SPEC tự mâu thuẫn — `value_pair_check`/`engine_kind_check` (ĐÍNH CHÍNH SPEC, không đổi code).** Bảng đóng ghi 400
  `VALIDATION-ERR-001`; khối «Ba CHECK ở DB map…» (cùng §12.1) + contracts ghi 422 018 `component-value-pair`. Code
  theo khối sau — và phải vậy: 047 là PATCH từng phần, cặp `valueType` kiểm ở SERVICE trên hàng sau merge và trả 422
  018, lưới DB phải cho CÙNG phản hồi. Hàng bảng đóng đã sửa.
- **Tag thiếu trong bảng:** trigger `payroll_advance_freeze_guard` có tag `not-found` (mig `0572`, plan DB-2 §3.5.a)
  mà bảng đóng không liệt kê — rơi 500 có chủ đích như `line_guard:not-found`. Đề nghị bổ sung hàng ở lượt sửa SPEC
  sau (kèm nâng neo census 15 → 16).

### 3.6 Rủi ro còn lại được ghim (không phải lỗi)

- **#24 «duyệt mù»:** role giữ `approve:payroll-advance` bị gỡ `view:payroll-advance` lúc runtime vẫn duyệt được
  (063 201) trong khi 059/061 403 — verify migration 0571 chỉ đúng lúc migrate (§11.3 ghi chú 7).
- **006 `payslip-duplicate` không chạm được qua HTTP:** `generate-payslips` lặp/song song kiểm «đã sinh» dưới cùng
  row-lock với lượt ghi ⇒ không bao giờ tới `payslips_period_user_uq`. Nhánh map có ca unit (`payroll.errors.spec`).
- **#14 di trú `Paid → Published` không có ca tái lập:** cần DB dừng ở `0571` có sẵn kỳ v1 `Paid` rồi áp `0572` (và ca
  âm «đảo thứ tự siết CHECK trước backfill»). Chain migrate của CI chạy trên DB rỗng nên khối VERIFY của `0572` ở đó
  xanh-rỗng. Chấp nhận vì v1 chưa từng lên PROD (`0572:8`) và mọi DB dev đã áp `0572`; nếu PROD có hàng v1 trước
  deploy thì khối VERIFY fail-loud dừng migrate. Đề nghị owner: đếm `payroll_periods WHERE status IN ('Paid','Locked')`
  trên PROD trước deploy wave S15.
- **12 hàng `permissions` wildcard toàn cục** do `qa1-roles` B để lại (is_sensitive=false) — cố ý không xoá
  (`global-catalog-fence` coi cặp biến mất là vi phạm).

### 3.7 T5 FE — không test được ⇒ WO nợ `S15-PAYROLL-FE-6`

`apps/app` chưa gọi `payrollApi.updatePaymentBatch` (069) ở đâu cả: bảng dòng chi của đợt là chỉ-đọc. Không có UI
thì không có cổng để test. Seed WO `S15-PAYROLL-FE-6` (UI đánh dấu đã chi · gỡ dòng chưa chi · thêm người + spec T5).

---

## 4. Số đo

**Coverage `src/payroll/**`** (39 file int + `src/payroll`unit, LANE_DB`mediaos_s15qa1`, 10 shard blob + merge vì
tinypool sập IPC khi chạy một lượt): **98,00 % statements · 90,13 % branches · 98,92 % functions** (13.683/13.961);
`src/payroll/formula/**` **99,82 % statements · 99,59 % branches · 100 % functions\*\*. Không ngưỡng per-file nào vi
phạm. File thấp nhất: `payroll-import.parser.ts` 84,4 %. 1.792 ca xanh, 0 đỏ.

**FE:** `apps/app/src/routes/payroll` 20 file · 278 ca xanh.

**Đột biến có kiểm soát (chứng minh lưới có răng — mỗi đột biến chạy rồi hoàn nguyên, `git diff` rỗng):**

| Đột biến                                      | Kết quả                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| decorator 078 gõ cứng `isSensitive: false`    | census 2 tầng (2) ĐỎ: `decorator isSensitive=false ≠ bảng true`    |
| gỡ `resolveActor(user, "periodExport")` ở 083 | `qa1-pair-matrix` C-083 ĐỎ (3 ca C khác vẫn xanh — cô lập đúng vế) |
| gỡ `payrollCatalogLockTx` ở 047               | `qa1-race` ca 5 ĐỎ: `[200, 200]` — catalog mang vòng               |
| P1/P2 trước vá                                | 3 + 3 ca đỏ (RED-first)                                            |

**Log 5xx:** 0 dòng `-> 5xx` ngoài ca `MEDIUM-2` của `be4-batches-complete` (500 CÓ CHỦ ĐÍCH, ca tự assert).

**Cổng — `bash harness/check.sh --lane-db=s15qa1` (lane `--reset` sạch, commit `5d0eb9e2`): XANH ✅, KHÔNG banner
LANE-DB GUARD.** secret-literals · lint · typecheck · migration-no-drop · tooling-tests · test chunked: api **735/735**
file (8 lượt chạy lại vì sập IPC hạ tầng, 0 ca đỏ) · app 290/290 · auth 4/4 · console 22/22 · contracts 41/41 · ui
24/24 · web-core 45/45. Lượt `check.sh` ĐẦU TIÊN (commit `585c1020`) ĐỎ 2 ca do chính WO — cả hai đã vá ở `5d0eb9e2`:
(1) census `supertest-listen-ratchet` bắt helper `payroll-qa1-routes.ts` vì docblock nhắc tên hàm lấy HTTP server
(census quét chữ, kể cả comment); (2) D1 `s15-payroll-db1-invariants` đỏ vì `qa1-roles` ghi hàng catalog wildcard mang
resource PAYROLL (§4 plan — gỡ, giữ `*:*`).

**Tái lập:** `bash scripts/lane-db-setup.sh s15qa1` → `LANE_DB=mediaos_s15qa1 pnpm --filter @mediaos/api test:cov:payroll`
(máy dev Windows: chạy theo shard `--shard=i/10 --reporter=blob` rồi `vitest --merge-reports --coverage`).

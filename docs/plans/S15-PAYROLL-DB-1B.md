# S15-PAYROLL-DB-1B — Vá công thức seed `LUONG_CO_BAN` (trừ HAI LẦN nghỉ không lương) + index RI + nợ B2 `bonus_penalties`

> 🔴 Vùng đỏ — migration + trigger chở tiền. **Opus** code + review. **FULL gate** (database-reviewer → security-reviewer, TUẦN TỰ).
> Plan-review đối kháng **một vòng** trước khi code (memory `red-zone-wo-cost-profile` · `plan-review-rounds-inject-new-holes`).
> Nhánh `feat/s15-payroll-db-1b` cắt từ `origin/master` **SAU KHI #508 (DB-2, mig 0572–0573) MERGE** — migration nối head ⇒ `0574`.

## 0. Quyết định owner (14/09/2026, phiên này)

| # | Câu hỏi | Chốt |
| --- | --- | --- |
| O-1 | #508 merge thế nào | `--admin` squash khi CI xanh (như #506/#507) |
| O-2 | WO tiếp theo | **DB-1B** (đường găng BE-3 → BE-4 → BE-5) |
| O-3 | Nợ B2 `bonus_penalties` (0564) — «gắn BE-3 hoặc DB-1B» (memory `s15-payroll-db2-wave-state`, plan DB-2 §3.5.a B2 + LOW-1) | **GỘP vào DB-1B** — WO này vốn là lane migration, BE-3 không có |

## 1. Ranh giới

**TRONG phạm vi**

1. Hằng seeder `LUONG_CO_BAN` tái tạo đúng v1 (tử số `present + unpaid`, kẹp trần 1) + bump `seedVersion` `v2 → v3`.
2. Migration `0574` vá hàng `is_system` đã seed (DISABLE/ENABLE `salary_component_system_freeze` trong CÙNG khối, WHERE chuỗi cũ CHÍNH XÁC, verify fail-loud).
3. `assertSeedIntegrity` (7) — nội dung MỌI hàng hệ thống == hằng TS; (5) nâng lên `compileGraph(requireEngineNodes)`.
4. Index `(company_id, component_id)` trên `payroll_template_components` + ratchet ghim `pg_get_indexdef`.
5. Nhánh **(F) B2** cho `enforce_bonus_penalty_freeze`: nhả/gắn consume CHỈ khi kỳ ∈ {`CollectingData`, `Calculated`}; trigger thành `BEFORE INSERT OR UPDATE`; message chuẩn `<trigger>:<tag>:`; lookup `public.` (trả LOW-1 của DB-2).
6. Vá fixture: 7 spec ghi `allowances` không kèm `salary_profile_items` (E2 đỏ) + 2 spec gắn consume vào kỳ `Draft` (sẽ đỏ vì (F)).
7. Ca đối chứng v1 ↔ engine BẰNG SỐ ĐO trên Postgres (không suy luận thứ tự làm tròn).

**NGOÀI phạm vi** (đừng làm): máy tính lương v2 (BE-3) · map lỗi theo TAG ở `payroll.errors.ts` (giữ luật tiền tố — §4.3) · insert-shape cho `bonus_penalties` (§3.6) · CONTRACT cột `allowances` · sửa `NGHI_KHONG_LUONG` (GIỮ — trừ khi §5.2 đo ra lệch làm tròn, khi đó DỪNG hỏi owner).

## 2. Số đo đã có (14/09, đọc code thật)

| Điểm | Bằng chứng |
| --- | --- |
| Công thức seed sai | `payroll-master-data.seeder.ts:157` `SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_PRESENT_DAYS / SYS_WORK_DAYS`; `:188` `NGHI_KHONG_LUONG` trừ thêm `… * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS` |
| v1 đúng | `payroll-calc.repository.ts:250-251` `round(base * least((present + unpaid) / nullif(work,0), 1), 2)`; `:262-263` `round(penalty + unpaid * (base / nullif(work,0)), 2)` |
| Công thức đúng ĐÃ có trong fixture engine | `formula.graph.spec.ts:45` `MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100` ⇒ `:188` ra `20000000.00` cho 18/2/22 |
| Ngữ pháp có `MIN` | `formula.vocabulary.ts:44,64` (`MIN` ≥2 tham số) |
| Làm tròn engine | `formula.decimal.ts:17,21` precision 50, `ROUND_HALF_UP`, scale trung gian **10** sau MỖI `*` `/` (`formula.evaluator.ts:101,103`); thành phần `toMoney` scale 2 (`formula.graph.ts:evaluatePass`) ⇒ **khác** v1 (PG `numeric` chia trước, nhân sau, ~20 chữ số) ⇒ §5.2 ĐO |
| Trigger đóng băng | `0570:416-445` `salary_component_system_freeze` BEFORE UPDATE, chặn `formula` với MỌI role |
| Seeder không cập nhật hàng đã có | `ON CONFLICT DO NOTHING`; runner chạy MỖI boot (memory `master-data-seeder-runs-every-boot`) ⇒ chỉ migration vá được hàng cũ |
| Fingerprint chưa bị ghi | `payroll_period_lines.template_fingerprint` (`schema/payroll.ts:309`) chỉ ghi lúc TÍNH v2 = BE-3 chưa có ⇒ đổi công thức không làm cũ dữ liệu đã lưu — migration vẫn ASSERT = 0 (§4.1 bước 0) |
| Migrator vượt RLS | khuôn `0572:33` assert `rolsuper OR rolbypassrls`; `set_config('lock_timeout','5s',true)` `0572:139`; migrator chạy MỌI migration đang chờ trong MỘT transaction (`0572:22`) |
| Chưa có tiền lệ `DISABLE TRIGGER` | `grep -ln "DISABLE TRIGGER" apps/api/migrations/*.sql` = rỗng |
| Index thiếu | `0570:616-620` chỉ có `tpl_component_uq (company_id, template_id, component_id)` + `company_tpl_idx (company_id, template_id)`; FK `component_id_company_fk` (`0570:609`) không index vế trái |
| Luồng nhả/gắn consume v1 | `payroll-calc.service.ts`: `lockForUpdateTx` kỳ (dòng ~79) → `releaseConsumedTx` (117) → … → `bindConsumedTx` (182) → `applyTransitionTx` SAU CÙNG ⇒ lúc nhả/gắn kỳ đang `CollectingData` hoặc `Calculated` (calculate tại chỗ — `payroll-fsm.ts IN_PLACE_ACTIONS`); ghi DUY NHẤT vào `bonus_penalties.payroll_period_id` ở `src/` là 2 câu này |
| Map lỗi trigger | `payroll.errors.ts:497` khớp tiền tố `bonus_penalty_freeze_guard:` ⇒ 409 **013** `bonus-frozen-race` |
| Khuôn (F) | `0572:733-760` T3 `payroll_advance_freeze_guard` (FOR SHARE · `public.` · lọc `company_id` · `not-found`) |

## 3. Điểm KHÁC WO / tài liệu — đọc trước khi review

### 3.1 Fixture E2: **6** spec (khớp WO — đã đo từng chỗ chèn)
`grep -rn "INSERT INTO salary_profiles" apps/api/test` (14/09): `payroll-be2-lifecycle:345` · `payroll-be2-noti-audit:216` · `payroll-be2-permission:296` · `s13-payroll-qa1-arithmetic:194` (+ `setBase` UPDATE `:120`) · `s13-payroll-qa1-fsm-race:251` · `s13-payroll-qa1-idor-tenant:255,353`. **Loại:** `s13-payroll-qa1-scope-floor:489` chèn `'[]'::jsonb` (E2 lọc `jsonb_array_length > 0`) · `payroll-be1-scope:540` đi qua API ⇒ đã ghi items. ⚠️ `idor-tenant:353` chèn hồ sơ `deleted_at` NOT NULL — E2 lọc `sp.deleted_at IS NULL` ⇒ không cần mirror, nhưng gọi helper cũng vô hại (đo lúc thi công).
**Vá:** helper MỚI `test/helpers/payroll-fixtures.ts` → `mirrorAllowanceItems(direct, profileIds)`: xoá items của hồ sơ rồi chèn lại theo ĐÚNG câu (6c) của `0570:685-697` (`PC_` + `lpad(ord,3,'0')` · `amount` · `note = name` · `created_at/by` của hồ sơ). Gọi sau MỌI INSERT/UPDATE `allowances` thô. KHÔNG nới E2 (nó là bằng chứng backfill trên lane có dữ liệu v1).

### 3.2 Hai spec gắn consume vào kỳ `Draft` — sẽ ĐỎ vì (F)
- `bonus-penalty-transition.int-spec.ts` `beforeAll` tạo `periodId`/`period2Id` ở `'Draft'`; `seedBonus({payrollPeriodId})` INSERT hàng đã consume; ca ALLOW nhả (`:147`) · (A) consume (`:~205`) · (C) re-bind (`:225`) · 2 ca CHECK (`consume_approved` · `consumed_pair`) chèn kèm `periodId`.
  **Vá:** hai kỳ fixture → `'CollectingData'` (không CHECK cặp vết nào đòi gì ở trạng thái này). Ca (C) vẫn đỏ đúng chỗ vì (C) đứng TRƯỚC (F).
  ⚠️ Hai ca CHECK: BEFORE INSERT trigger bắn TRƯỚC CHECK — với kỳ `Draft` chúng sẽ ăn `period-frozen` thay vì tên CHECK (memory `db-invariant-kills-adversarial-fixtures`). Kỳ `CollectingData` ⇒ trigger cho qua ⇒ CHECK nổ đúng tên.
- `payroll-be1-errors.int-spec.ts:347,388` tạo kỳ qua `POST /payroll-periods` (⇒ `Draft`) rồi `UPDATE … SET payroll_period_id` thô. **Vá:** `UPDATE payroll_periods SET status='CollectingData'` qua `direct` ngay trước câu bind (0572 đã assert không có trigger lạ trên `payroll_periods`).

### 3.3 `payroll-master-data.seeder.ts` = **812 dòng**, ĐÃ vượt trần 800
Thêm (7) + nâng (5) đẩy lên ~880. **Tách** `assertSeedIntegrity` + `assertSameCodeSet` sang file MỚI `apps/api/src/payroll/payroll-master-data.integrity.ts` (hàm thuần nhận `tx`, `companyId`, hằng) — seeder gọi. Thêm path vào WO (memory `file-size-cap-800-has-no-gate`).

### 3.4 Công thức MỚI — chọn theo SỐ ĐO §5.2, ứng viên số 1
`MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100`
- Tương đương `base × MIN((p+u)/w, 1) × ratio/100` khi `base ≥ 0` (`salary_profiles` CHECK base > 0).
- Tử số nhân TRƯỚC (chính xác tuyệt đối), MỘT phép chia làm tròn scale 10 ⇒ sai số ≤ 5e-11 — tốt hơn `base * MIN((p+u)/w, 1)` (chia trước rồi nhân base ~1e8 ⇒ khuếch đại sai số lên ~5e-3, đủ lật làm tròn 2 chữ số).
- **KHÔNG** định nghĩa lại `SYS_PRESENT_DAYS` ở BE-3 (done_when).
- `SYS_PAY_RATIO` không có ở v1 ⇒ đối chứng chạy với `100`.

### 3.5 Nợ B2 `bonus_penalties` — thiết kế (F)
Cùng hình dạng lỗ plan DB-2 §3.5.a B2: không vế trạng-thái-kỳ ⇒ (i) nhả khoản đã trừ ở kỳ `Locked`/`Paid` rồi gắn kỳ sau = **trừ lương hai lần**; (ii) gắn vào kỳ ≥ `Reviewing` = `consumed` mà không bao giờ vào dòng lương. Service v1 không tạo được hai ca này (khoá kỳ FOR UPDATE + tiền-kiểm trạng thái), nên (F) là **lưới cuối DB** cho mô hình đe doạ «bug/script/repository gọi thẳng» — đúng lý do tồn tại của A–E.

### 3.6 KHÔNG thêm insert-shape («INSERT chỉ `Pending` sạch») cho `bonus_penalties` — có chủ đích
T3 của `payroll_advances` có (M3 DB-2), nhưng ở đây nó giết fixture đối kháng: `seedBonus` (`bonus-penalty-transition:57` — «INSERT là cách DUY NHẤT dựng hàng đã-duyệt/đã-consume») + 4 ca CHECK chèn thẳng `Approved`/`Rejected`/`draft` để ghim TÊN CHECK; BEFORE INSERT bắn trước CHECK ⇒ cả họ ca đổi sang lỗi trigger. Route `POST /bonus-penalties` chỉ chèn `Pending` (Zod + service); ở DB chỉ có `decided_pair` CHECK ép hình dạng quyết định (có `decided_by`/`decided_at`) — **KHÔNG có CHECK four-eyes** (security-review DB-1B MEDIUM: bản trước viết `bonus_penalties_four_eyes` là SAI, đã đo lại `pg_constraint`) ⇒ INSERT thô hàng `Approved` tự duyệt (`decided_by = created_by`) đi qua DB — lỗ có từ 0564, nợ ghi BE-3. INSERT CHỈ nhận vế B2: **có `payroll_period_id` ⇒ kỳ phải ∈ {CollectingData, Calculated}**. Ghi rủi ro §9 R3.

### 3.7 Census đã đo (14/09) — không cần hỏi reviewer
- **Ghi `bonus_penalties` ngoài `src/` + `test/`:** `grep -rln bonus_penalties` (loại `node_modules` · `dist` · `migrations` · `test` · `src`) ⇒ chỉ `apps/api/releases/*/db/schema/payroll.js` (bản build cũ) + `.claude/hooks/guard-immutability.mjs`. **Không** seed/script/demo nào gắn consume ⇒ (F)/INSERT không phá dữ liệu vận hành.
- **Postgres 17.10** (`docker exec mediaos-postgres psql -V`) — `OLD` trong trigger INSERT là NULL (không «unassigned»); vẫn theo khuôn 0572 không đọc `OLD` ở DECLARE.
- **Fixture chèn thẳng hàng `is_system = true` vào `salary_components`** (có thể vỡ (7) nếu công ty đó chạy seeder): `payroll-be1-legacy-items.int-spec.ts:109` (`is_system = $7` — ĐO lúc chạy) · `s15-payroll-be2-seed.int-spec.ts:119` (`ZZ_THUA` — chính là ca ÂM của (6), (7) chỉ so mã CÓ trong hằng nên không đổi kết quả) · `s15-payroll-db1-invariants.int-spec.ts:453-595` (ca ÂM CHECK, không chạy seeder). Luật (7): chỉ so hàng có `code` thuộc `SYSTEM_COMPONENTS`; mã lạ là việc của (6).

### 3.8 🔁 VÁ plan-review vòng 1 (14/09) — ĐÈ lên mọi chỗ mâu thuẫn ở §4–§9

**Verdict reviewer: BLOCK kèm điều kiện tự-mở-cổng → vá đủ 5/5 dưới đây ⇒ PASS, KHÔNG mở vòng 2** (memory `plan-review-rounds-inject-new-holes`). Bảng chân trị (F), tập {CollectingData, Calculated}, FK kỳ NO ACTION, hook `guard-immutability` — reviewer đã kiểm, không lỗ khác.

| # | Lỗ reviewer chỉ ra | Thiết kế CHỐT |
| --- | --- | --- |
| **B-1** | B3 xanh-RỖNG: `mkPeriod` INSERT kỳ ở thẳng trạng thái đích; INSERT khoản đã consume vào kỳ đóng băng nay bị NHÁNH INSERT chặn với CÙNG tag `period-frozen` ⇒ bước dựng nằm trong promise `rejects` là B3 xanh vì INSERT; đột biến gỡ vế nhả không làm B3 đỏ | **B3 (nhả)** dựng theo đường thật: kỳ `CollectingData` (`mkPeriod`) → gắn khoản (UPDATE NULL→P, hợp lệ) → `direct` UPDATE `payroll_periods` sang trạng thái đích + cột vết theo cùng logic CASE của `mkPeriod` (bảng kỳ không trigger — `0572:77-81`) → **SELECT xác nhận** `payroll_period_id = P` + `status` đích. MỌI bước dựng NGOÀI `expect`; chỉ câu DENY nằm trong `expect`. **B4 (gắn)**: khoản `Approved` chưa gắn + kỳ đích dựng trực tiếp. CẤM `DISABLE TRIGGER`/`session_replication_role` trên `bonus_penalties` trong fixture. §8 bước 4(a) tách **3 đột biến độc lập**: (a1) gỡ vế nhả ⇒ CHỈ B3 đỏ · (a2) gỡ vế gắn-UPDATE ⇒ CHỈ B4 đỏ · (a3) gỡ nhánh INSERT ⇒ CHỈ B5-DENY đỏ |
| **M-1** | `mirrorAllowanceItems` autocommit riêng ⇒ cửa sổ hồ sơ có `allowances` mà 0 item; E2 quét toàn lane chạy song song ⇒ vẫn flake | Helper nhận `PoolClient` ĐANG trong tx: câu ghi `allowances` (INSERT/UPDATE) + xoá/chèn lại item nằm trong CÙNG `BEGIN…COMMIT` (hoặc một câu CTE `WITH sp AS (INSERT … RETURNING …) INSERT INTO salary_profile_items …`). Không nhận `Pool` |
| **M-2** | (5) tự dựng `GraphComponent` = bản sao logic của 053 (`payroll-templates.service.ts:255-293`: lọc active + `templateGraphComponent`) ⇒ lệch là ném oan MỖI boot (runner bọc try/catch ⇒ batch Failed lặp) | Chuyển `templateGraphComponent` + `TemplateGraphSource` sang module LÁ MỚI `apps/api/src/payroll/payroll-template-graph.ts` (chỉ import `./formula/formula.graph` + type contracts — KHÔNG import seeder; vòng import thật đến từ `payroll-catalog.support.ts:15`). `payroll-catalog.support.ts` re-export (giữ API cũ). Integrity (5) lấy hàng bằng CÙNG hình dạng `payroll-templates.repository.ts` `componentsTx` (~174-205, không lọc `is_visible`) rồi `compileGraph(rows.map(templateGraphComponent), { requireEngineNodes: true })`; thành phần `componentActive=false`/`componentDeletedAt` xử lý GIỐNG đường preview/TÍNH (đo `payroll-templates.service.ts:350-360` lúc thi công) — không chặt hơn 053. Thêm **F4b ALLOW**: sửa `MAU_MAC_DINH` qua API 053 (override hợp lệ trên thành phần `formula` + gỡ một thành phần không-engine) ⇒ reconcile `ok=true`. `paths` + `payroll-template-graph.ts` · `payroll-catalog.support.ts` |
| **M-3** | (F) cho GẮN vào kỳ ĐÃ XOÁ MỀM (lookup khuôn `0572:748-751` không lọc `deleted_at`) ⇒ consume không bao giờ vào lương — máy tính chỉ chạm kỳ sống (`payroll-periods.repository.ts:28-30,81-92`) | Nhánh GẮN (UPDATE NULL→x) và nhánh INSERT thêm `AND pp.deleted_at IS NULL` ⇒ không thấy ⇒ tag `not-found`. Nhánh NHẢ **KHÔNG** lọc `deleted_at` (còn cứu khoản ra được). Ca mới **B9** DENY gắn vào kỳ `CollectingData` đã xoá mềm ⇒ `not-found` · **B9b** ALLOW nhả khỏi kỳ `CollectingData` đã xoá mềm (dựng: gắn khi kỳ sống → `direct` xoá mềm kỳ → nhả). R7 §9 |
| **M-4** | Oracle §5.2 có thể tính kiểu `integer` (cột `VALUES` toàn số nguyên ⇒ chia nguyên) ⇒ đỏ oan | F2 ép `::numeric` TƯỜNG MINH từng cột (như phép đo §5.2.a: `b::numeric(18,2)`, `'p'::numeric`…) hoặc `jsonb_to_recordset(...) AS t(... numeric)` như v1 `payroll-calc.repository.ts:218-220`. Vế chính xác BigInt (xu = base×100, ngày×10): `halfUp(num,den) = (2n·num + den) / (2n·den)` · hoà ⇔ `2n·(num % den) === den` · base `P > W ? B : B·P/W` · khấu trừ `B·U/W`. Reviewer chứng minh độc lập: ngoài ca hoà giá trị cách biên ≥ 1/(k·w) ≫ 5e-11 ⇒ C1 BẮT BUỘC khớp 100%; F2 đỏ ⇒ nghi kiểu oracle TRƯỚC |

**NIT đã nhận:**

- §4.1(1): `ALTER TABLE … DISABLE/ENABLE TRIGGER` lấy **SHARE ROW EXCLUSIVE** (không phải ACCESS EXCLUSIVE) — người ghi vẫn xếp hàng, thay đổi `pg_trigger` chưa commit không phiên nào thấy; kết luận giữ nguyên.
- §4.1(3): dùng **`CREATE OR REPLACE TRIGGER bonus_penalty_freeze_guard BEFORE INSERT OR UPDATE ON bonus_penalties …`** (PG ≥ 14; lane PG 17.10) THAY `DROP TRIGGER` + `CREATE TRIGGER` — tránh ACCESS EXCLUSIVE trên `bonus_penalties` khi app đang chạy; giữ tên (ca C8 `s13-payroll-db1-invariants` ghim tên). Người vận hành đo `SELECT version()` PROD trước deploy (R1).
- §4.1(0): preflight hàng thứ ba viết `formula IS NULL OR formula NOT IN (<cũ>, <mới>)`.
- §6.1 F3: **KHÔNG DDL** — INSERT sẵn hàng `is_system` `LUONG_CO_BAN` mang chuỗi cũ (thoả CHECK value_pair) vào công ty MỚI TRƯỚC lượt reconcile đầu (trigger freeze chỉ BEFORE UPDATE) ⇒ `ON CONFLICT DO NOTHING` giữ nó ⇒ (7) nổ. Bằng chứng §8 bước 2 dựng dữ liệu cũ cùng cách.
- §4.1(3) nhánh INSERT: message dùng `NEW.id` (khuôn `0572:753,757` in `OLD.id` — NULL ở INSERT).
- §3.7 `payroll-be1-legacy-items:100-112`: `TONG_THU_NHAP is_system=true` trùng hằng; `TNCN`/`NGHI_KHONG_LUONG` `is_system=false` ⇒ (6) vốn lệch ở công ty đó (không chạy seeder); (7) không thêm lỗi — **ĐÓNG mục**.
- Vế `NEW.period_month = pp.period_month`: **KHÔNG thêm** ở WO này (v1 luôn thoả — `payroll-calc.repository.ts:137`; muốn thêm phải đo tháng fixture `payroll-be1-errors:345,386`) — nợ QA-1.

**§9 bổ sung:**

- **R7 — (F) không đóng hết «consume không vào lương»:** gắn vào kỳ `CollectingData`/`Calculated` SỐNG mà không tính lại, gắn lệch `period_month`, hay duyệt + gắn trong một lệnh vẫn qua trigger một-hàng. Service (khoá kỳ + chọn tập theo tháng + bind đúng tập đã SUM) là chốt duy nhất. (F) đóng: nhả khỏi kỳ đóng băng · gắn vào kỳ ≥ `Reviewing` · gắn vào kỳ đã xoá mềm.
- **R8 — cùng mức bảo vệ T3 của DB-2:** script chủ đích UPDATE thẳng `payroll_periods.status` về `CollectingData` rồi nhả/gắn là lách được (bảng kỳ không trigger). Không vá ở đây.

## 4. Migration `0574_s15payrolldb1b_seed_formula_bp_period_guard.sql`

Journal: `idx 241` · `when 1717587363000` · `tag 0574_s15payrolldb1b_seed_formula_bp_period_guard` (ĐO lại head lúc chạy — nếu master có migration mới hơn thì nối tiếp). Sau migrate: **đo lại schema**, không đọc log (memory `migration-not-in-journal-is-silently-skipped`).

### 4.1 Thứ tự BẮT BUỘC (mỗi bước một khối `DO`, cách nhau `--> statement-breakpoint`)

**(0) PREFLIGHT fail-loud** — trước mọi ghi:
- `current_user` phải `rolsuper OR rolbypassrls` (khuôn `0572:33`) — thiếu thì UPDATE chỉ thấy hàng của một tenant.
- `PERFORM set_config('lock_timeout','5s',true)`.
- Trigger `salary_component_system_freeze` tồn tại trên `salary_components`, `tgenabled = 'O'`.
- Trigger `bonus_penalty_freeze_guard` tồn tại, function `enforce_bonus_penalty_freeze` tồn tại.
- `count(*) FROM payroll_period_lines WHERE template_fingerprint IS NOT NULL` **= 0** — khác 0 nghĩa là đã có dòng TÍNH theo công thức cũ ⇒ đổi công thức là đổi nghĩa lịch sử ⇒ DỪNG, owner chốt.
- Hàng `is_system AND code='LUONG_CO_BAN'` có `formula NOT IN (<cũ>, <mới>)` **= 0** — hàng thứ ba chỉ có được khi ai đó đã vượt trigger ⇒ DỪNG (fail-closed), KHÔNG tự đè.
- `RAISE NOTICE` (dán PR): số hàng mang chuỗi cũ · chuỗi mới · số `payroll_template_components.formula_override = <cũ>` (dữ liệu NGƯỜI DÙNG — KHÔNG sửa, chỉ báo).

**(1) VÁ công thức — MỘT khối `DO`** (ALTER + UPDATE + ALTER nguyên tử, khoá ACCESS EXCLUSIVE giữ tới COMMIT ⇒ phiên khác KHÔNG BAO GIỜ thấy trigger ở trạng thái tắt):
```sql
DO $$
DECLARE v_before int; v_n int;
BEGIN
  SELECT count(*) INTO v_before FROM public.salary_components
   WHERE is_system AND code = 'LUONG_CO_BAN' AND formula = '<cũ CHÍNH XÁC>';
  ALTER TABLE public.salary_components DISABLE TRIGGER salary_component_system_freeze;
  UPDATE public.salary_components SET formula = '<mới>', updated_at = now()
   WHERE is_system AND code = 'LUONG_CO_BAN' AND formula = '<cũ CHÍNH XÁC>';
  GET DIAGNOSTICS v_n = ROW_COUNT;          -- KHÔNG dùng FOUND (memory execute-does-not-set-found)
  ALTER TABLE public.salary_components ENABLE TRIGGER salary_component_system_freeze;
  IF v_n <> v_before THEN RAISE EXCEPTION '[0574] va cong thuc cap nhat % hang, do truoc duoc %', v_n, v_before; END IF;
  RAISE NOTICE '[0574] LUONG_CO_BAN: da va % hang', v_n;
END $$;
```
- `updated_by` để nguyên (NULL/seed) — không có actor người; vết thay đổi = migration + ghi chú DB-13.
- Không đụng `deleted_at IS NULL` ở WHERE: `salary_components_system_not_deletable` cấm hàng hệ thống xoá mềm.

**(2) Index RI:**
`CREATE INDEX IF NOT EXISTS payroll_template_components_company_component_idx ON public.payroll_template_components (company_id, component_id);` — bảng nhỏ, không CONCURRENTLY (không chạy được trong tx).

**(3) Trigger `bonus_penalties` — `CREATE OR REPLACE FUNCTION enforce_bonus_penalty_freeze()`**
- `DECLARE v_frozen boolean; v_period_status text;` — KHÔNG khởi tạo từ `OLD` ở DECLARE (INSERT không có OLD; khuôn `0572:657-668`).
- `IF TG_OP = 'INSERT'`: nếu `NEW.payroll_period_id IS NOT NULL` ⇒ khối kiểm kỳ (dưới) cho `NEW`; `RETURN NEW`.
- UPDATE: (A)(B)(C)(D)(E) **giữ nguyên logic** `0564:436-520`, chỉ đổi message sang `bonus_penalty_freeze_guard:<tag>: …` — (A)(B)(D) `frozen` · (C) `rebind` · (E) `status-terminal`.
- **(F)** sau (E): `OLD.payroll_period_id IS NOT NULL AND NEW.payroll_period_id IS NULL` ⇒ kiểm kỳ CŨ; `OLD.payroll_period_id IS NULL AND NEW.payroll_period_id IS NOT NULL` ⇒ kiểm kỳ MỚI. (x → y đã bị (C) chặn trước.)
- Khối kiểm kỳ (clone `0572:735-758`): `SELECT pp.status INTO v_period_status FROM public.payroll_periods pp WHERE pp.id = <kỳ> AND pp.company_id = <NEW|OLD>.company_id FOR SHARE;` · `IF NOT FOUND` ⇒ `:not-found:` · `IF v_period_status NOT IN ('CollectingData','Calculated')` ⇒ `:period-frozen:`. Tất cả `USING ERRCODE = 'check_violation'`.
- `DROP TRIGGER IF EXISTS bonus_penalty_freeze_guard ON bonus_penalties;` → `CREATE TRIGGER bonus_penalty_freeze_guard BEFORE INSERT OR UPDATE ON bonus_penalties FOR EACH ROW EXECUTE FUNCTION enforce_bonus_penalty_freeze();`
- **Danh sách tag ĐÓNG:** `frozen` · `rebind` · `status-terminal` · `period-frozen` · `not-found`.
- **Khoá:** calc v1 giữ kỳ `FOR UPDATE` trước khi ghi `bonus_penalties` ⇒ FOR SHARE của trigger trên CÙNG hàng CÙNG tx không tự xung đột; không tx nào khác vừa giữ hàng `bonus_penalties` vừa chờ kỳ ⇒ không vòng khoá. BE-3 (máy v2) PHẢI giữ thứ tự «khoá kỳ → ghi bonus» (ghi vào done_when BE-3).
- **Chi phí:** 1 lookup PK/hàng bonus bị nhả/gắn; số khoản mỗi kỳ ≪ 500 NV × vài khoản ⇒ không đáng kể với NFR §19.

**(4) VERIFY fail-loud:**
- `0` hàng `is_system AND code='LUONG_CO_BAN' AND formula = <cũ>`; mọi hàng như vậy `formula = <mới>`.
- `salary_component_system_freeze.tgenabled = 'O'` (ENABLE thật sự đã chạy).
- `bonus_penalty_freeze_guard` bắn cho CẢ INSERT lẫn UPDATE (`tgtype` bit 4 INSERT + bit 16 UPDATE, BEFORE, ROW), `tgenabled='O'`.
- `prosrc` của `enforce_bonus_penalty_freeze` chứa `period-frozen` và `public.payroll_periods`.
- `pg_get_indexdef` của index mới = chuỗi kỳ vọng (ĐO trên lane rồi dán — không gõ tay).

### 4.2 Idempotent
Chạy lại toàn file: (1) cập nhật 0 hàng (`v_before = 0 = v_n`) · (2) `IF NOT EXISTS` · (3) `OR REPLACE` + `DROP IF EXISTS` · (4) vẫn xanh. ĐO bằng replay thật (§8).

### 4.3 Map lỗi — KHÔNG sửa `payroll.errors.ts`
Mọi tag mới giữ tiền tố `bonus_penalty_freeze_guard:` ⇒ `payroll.errors.ts:497` vẫn map 409 **013** `bonus-frozen-race`. Đúng ngữ nghĩa: service tiền-kiểm dưới FOR UPDATE, trigger chỉ là chốt RACE. Thêm 1 ca unit ở `payroll.errors.spec.ts` ghim message dạng tag `bonus_penalty_freeze_guard:period-frozen: …` ⇒ 013. SPEC-11 §12.1 thêm hàng (§7).

## 5. Code

### 5.1 Seeder + integrity
- `payroll-master-data.seeder.ts:157` → công thức mới (§3.4, chốt theo §5.2). `seedVersion` `"v2"` → `"v3"` + comment «v3 (S15-PAYROLL-DB-1B): LUONG_CO_BAN tử số present+unpaid, kẹp trần».
- File mới `payroll-master-data.integrity.ts` (tách từ seeder, §3.3):
  - (1)–(4)(6) chuyển nguyên.
  - **(5) nâng:** mẫu mặc định do seeder tạo (nếu còn sống) ⇒ dựng `GraphComponent[]` từ link của mẫu JOIN catalog (áp `formula_override` như `payroll-catalog.support.ts` ~dòng 100-127 đang làm) ⇒ `compileGraph(components, { requireEngineNodes: true })` import THẲNG `./formula/formula.graph` (KHÔNG qua `payroll-catalog.support` — vòng import). Ném kèm mã lỗi + mã thành phần.
  - **(7) mới:** với MỌI hàng `is_system` sống có `code` thuộc `SYSTEM_COMPONENTS`, so `formula` · `kind` · `value_type` · `pit_deductible` (4 trường interface hằng khai — `seeder.ts` interface `code/kind/valueType/formula/pitDeductible`) + `fixed_amount`/`is_active` so với ĐÚNG giá trị `seedComponents()` chèn (đọc lúc thi công, chuẩn hoá chuỗi numeric). Báo lệch ĐÍCH DANH (mã + trường + hai giá trị). (6) chỉ so TẬP MÃ nên mù với lệch nội dung.
  - **Đã đo (14/09): (7) KHÔNG báo oan công ty đã seed.** `git log -p --follow` seeder = 2 commit: `fddea800` (DB-1) tạo hằng · `afd4f32e` (BE-2) **chỉ THÊM** `THUONG/PHAT/TAM_UNG`, không sửa trường nào của hàng cũ; migration `057x` không INSERT `salary_components`. ⇒ lệch nội dung DUY NHẤT trên mọi môi trường là `LUONG_CO_BAN` — đúng thứ (1) vá TRƯỚC khi app boot.
- ⚠️ (7) KHÔNG so với thứ người dùng sửa được (`name`, `sort_order`) — memory `master-data-seeder-runs-every-boot` (d).

### 5.2 Ca đối chứng v1 ↔ engine — ĐO, không suy luận
Int-spec (§6 F2): MỘT câu SQL `VALUES` lưới ca ⇒ Postgres tính biểu thức v1 NGUYÊN VĂN (`round(b * least((p+u)/nullif(w,0),1),2)` và `round(u * (b / nullif(w,0)), 2)`) ⇒ so từng đồng với `evaluatePass` trên đồ thị `LUONG_CO_BAN` + `NGHI_KHONG_LUONG` dựng từ HẰNG seeder (`SYS_PAY_RATIO = 100`).
Lưới (tất định, ~500 ca, một round-trip): `base ∈ {22000000, 15000000.50, 9876543.21, 1000000.03, 123456789.99, 7333333.33}` × `w ∈ {20, 21, 22, 23, 26, 31}` × `(p,u)` gồm `18/2` · `23/0` (kẹp) · `20/3` (kẹp) · `0/0` · `0/w` · nửa ngày `17.5/0.5` · `10.5/1.5` · `w/0`.
Ca neo tay: **18/2/22 · 22tr ⇒ base 20.000.000,00, khấu trừ 2.000.000,00** · **23/0/22 ⇒ 22.000.000,00** (kẹp).
#### 5.2.a ✅ ĐÃ ĐO SỚM (14/09, `scratchpad/parity-db1b.ts`) — KẾT LUẬN chọn công thức

Lưới **51.584 ca** (8 base có xu · 8 `w` ∈ {20,21,22,23,24,26,27,31} · `p` 0→w+1 bước 0,5 · 8 `u` ∈ {0…7,5} · hai biến thể scale ngày 0/1), Postgres chạy biểu thức v1 NGUYÊN VĂN, engine chạy `evaluate` + `toMoney`, và **thêm vế thứ ba: số học CHÍNH XÁC bằng BigInt** (xu × ngày, HALF_UP):

| Ứng viên | ≠ v1 (PG) | ≠ chính xác |
| --- | --- | --- |
| **C1** `MIN(SYS_BASE_SALARY * (SYS_PRESENT_DAYS + SYS_UNPAID_LEAVE_DAYS) / SYS_WORK_DAYS, SYS_BASE_SALARY) * SYS_PAY_RATIO / 100` | 504 | **0** |
| C2 `SYS_BASE_SALARY * MIN((p+u)/w, 1) * …` (chia trước) | 2.496 | >0 (vd 22tr·2/21: engine .09, đúng .10) |
| C3 (gộp `ratio` vào tử) | 504 | 0 |
| OLD (seed hiện tại) | 40.554 | — |
| **`NGHI_KHONG_LUONG` seed giữ nguyên** | 210 | **0** |
| `NGHI_KHONG_LUONG` chia trước `u * (b / w)` | 114 | 96 |

**v1 ≠ chính xác: 504 ca base + 210 ca khấu trừ — 100% là ca HOÀ NỬA XU** (`v1BaseNonTie = 0`, `v1DedNonTie = 0`). Ví dụ `9.876.543,21 × 17,5 / 21 = 8.230.452,675` đúng biên: PG chia `17,5/21` trước, cắt còn ~20 chữ số (0,8333…33 < 5/6) ⇒ làm tròn XUỐNG `.67`; engine nhân tử trước ⇒ `.68` đúng HALF_UP. Neo tay: C1 18/2/22 = **20.000.000,00** · 23/0/22 = **22.000.000,00** (kẹp) · 20/3/22 = 22.000.000,00 · khấu trừ 18/2/22 = **2.000.000,00**.

⇒ **CHỐT C1** (C3 tương đương nhưng dài hơn) · **`NGHI_KHONG_LUONG` KHÔNG sửa** (không mở rộng migration) · v2 lệch v1 **đúng 0,01 ở ca hoà nửa xu, theo hướng ĐÚNG** — không «sửa engine cho giống lỗi» (R5). Người vận hành/QA-1 đối soát v2 bằng số học chính xác, không bằng v1.

### 5.3 Drizzle schema
`schema/payroll.ts` `payrollTemplateComponents`: `index("payroll_template_components_company_component_idx").on(t.companyId, t.componentId)`.

### 5.4 Pin cũ phải sửa
- `formula.parser.spec.ts:39` — «công thức seed thật» đổi sang chuỗi mới; REF theo thứ tự xuất hiện: `SYS_BASE_SALARY · SYS_PRESENT_DAYS · SYS_UNPAID_LEAVE_DAYS · SYS_WORK_DAYS · SYS_PAY_RATIO`.
- `grep -rn -F "SYS_PRESENT_DAYS / SYS_WORK_DAYS"` lúc chạy phải chỉ còn trong `docs/plans/S15-PAYROLL-BE-2-review.md` (lịch sử) + migration `0574` (chuỗi cũ trong WHERE).

## 6. Test — RED TRƯỚC

### 6.1 File mới `test/integration/s15-payroll-db1b-invariants.int-spec.ts` (`describe.skipIf(!hasDb)`)
Mỗi ca công ty RIÊNG; ca âm của seeder assert `outcome.ok === false` (runner NUỐT throw — khuôn `s15-payroll-be2-seed`).

| Ca | Nội dung | RED trước bản vá vì |
| --- | --- | --- |
| F1 | công ty mới ⇒ `LUONG_CO_BAN.formula` == hằng mới; reconcile `ok` | hằng cũ |
| F2 | lưới §5.2.a thu gọn (~2–5k ca, một round-trip SQL): (i) engine (HẰNG seeder) == số học CHÍNH XÁC BigInt **100%** cả base lẫn khấu trừ; (ii) v1 (PG) == chính xác MỌI ca KHÔNG hoà, và ở ca hoà v1 lệch chính xác đúng 0,01; (iii) neo 18/2/22 = 20.000.000,00 · 23/0/22 = 22.000.000,00; (iv) neo chống xanh-RỖNG: số ca hoà trong lưới > 0 | base 18.000.000 |
| F3 | (7) ĐỎ: trong MỘT tx `DISABLE`→ đặt `formula` về chuỗi cũ →`ENABLE` → COMMIT; reconcile ⇒ `ok=false`, message chứa `LUONG_CO_BAN` + `formula` | (7) chưa có |
| F3b | ĐỐI CHỨNG DƯƠNG F3: đổi `name` hàng hệ thống (người dùng được phép) ⇒ reconcile `ok=true` | chống (7) so cả cột sửa-được |
| F4 | (5) ĐỎ: `formula_override` của một link trong `MAU_MAC_DINH` REF mã không tồn tại ⇒ `ok=false` | (5) chỉ đếm 4 nút |
| F5 | `pg_get_indexdef` index mới == chuỗi đo; vector THAY THẾ: đột biến drop-rồi-tạo-cùng-tên trên `(company_id, template_id)` phải ĐỎ (đo tay 1 lần, ghi §11) | index chưa có |
| F6 | journal có `0574` + file tồn tại | — |
| B1 | ALLOW nhả consume khi kỳ `CollectingData` · `Calculated` (it.each) | ALLOW trước DENY (memory `deny-cases-vacuous-without-allow-case`) |
| B2 | ALLOW gắn (UPDATE NULL→x) khi kỳ `CollectingData` · `Calculated` | — |
| B3 | DENY nhả khi kỳ ∈ `Draft · Reviewing · Approved · Published · Paid · Locked` ⇒ tag `period-frozen` (it.each 6) | chưa có (F) |
| B4 | DENY gắn vào 6 trạng thái trên ⇒ `period-frozen` | chưa có (F) |
| B5 | INSERT hàng đã consume: kỳ `CollectingData` ALLOW · kỳ `Locked` DENY `period-frozen` | trigger chỉ UPDATE |
| B6 | gắn vào kỳ của CÔNG TY KHÁC (direct superuser) ⇒ `not-found` (trigger bắn TRƯỚC composite FK) | — |
| B7 | tag A–E: một ca mỗi tag `frozen` · `rebind` · `status-terminal` — assert `message.startsWith('bonus_penalty_freeze_guard:<tag>:')` | message cũ không tag |
| B8 | end-to-end API: tính kỳ (`CollectingData`→`Calculated`) rồi tính lại tại chỗ (`Calculated`) ⇒ 201 hai lần, khoản vẫn consume đúng kỳ | chốt (F) không khoá chết đường tính lại |

Kỳ fixture dùng khuôn `mkPeriod` của `s15-payroll-db2-invariants.int-spec.ts:76-120` (đủ vết theo trạng thái — thoả mọi CHECK cặp). Mỗi ca DENY dựng hàng vi phạm ĐÚNG MỘT điều kiện (memory `pg-reports-arbitrary-check-when-multiple-violated`).

### 6.2 Unit
- `payroll.errors.spec.ts`: message tag `bonus_penalty_freeze_guard:period-frozen:` ⇒ 409 013.
- `formula.parser.spec.ts` §5.4.
- (tuỳ chọn, rẻ) `payroll-master-data.integrity` không có unit — phủ bằng F1/F3/F3b/F4 trên DB thật.

### 6.3 Spec cũ phải sửa (§3.1 · §3.2) + chạy lại
`bonus-penalty-transition` · `payroll-be1-errors` · 7 spec `allowances` · `s15-payroll-db1-invariants` (E2 lane-wide) · `s15-payroll-db1-seed` (E11/E12 census REF vẫn xanh với `MIN`) · `s15-payroll-be2-seed` · `s13-payroll-db1-invariants` C8 · `payroll-be2-lifecycle` (tính qua API).

## 7. Tài liệu (cùng commit)
- **DB-13 §13.4**: hàng «Nền» ghi công thức `LUONG_CO_BAN` mới; khối 🔴 nợ B1 → ✅ «trả ở `S15-PAYROLL-DB-1B` (mig 0574)»; assert (5)(7) mô tả mới.
- **DB-13 §5.5** (`bonus_penalties`): nhánh (F) + INSERT + danh sách tag ĐÓNG.
- **SPEC-11 §12.1**: hàng `🔁 trigger bonus_penalty_freeze_guard — tag frozen · rebind · status-terminal · period-frozen · not-found | 23514 | 409 | 013 bonus-frozen-race (luật tiền tố; chốt RACE)`.
- **SPEC-11 §13.4**: 1 dòng — công thức seed `LUONG_CO_BAN` là hiện thực của «tử số present + unpaid, kẹp trần 1» trong máy công thức v2.
- `harness/backlog.mjs`: WO này — `paths` + `apps/api/src/payroll/payroll-master-data.integrity.ts` · `apps/api/src/db/schema/payroll.ts` · `apps/api/src/payroll/payroll.errors.spec.ts`; `done_when` + mục B2; `S15-PAYROLL-BE-3` notes + «giữ thứ tự khoá kỳ → ghi `bonus_penalties` (trigger (F) FOR SHARE)».

## 8. Bằng chứng phải chạy (dán §11)
1. `bash scripts/lane-db-setup.sh db1b --reset` → `export LANE_DB=mediaos_db1b` → đo schema sau migrate (4 mục VERIFY §4.1 (4) bằng SELECT).
2. **Lane CÓ dữ liệu cũ:** 2 công ty seed qua runner; đặt `LUONG_CO_BAN` về chuỗi cũ (tx DISABLE/UPDATE/ENABLE); `psql -v ON_ERROR_STOP=1 -f 0574…sql` ⇒ NOTICE «đã vá 2 hàng»; SELECT xác nhận; chạy LẠI file ⇒ «đã vá 0 hàng», exit 0 (idempotent).
3. **Lượt ĐỎ:** một hàng `LUONG_CO_BAN` công thức thứ ba ⇒ replay ⇒ RAISE preflight, tx rollback, trigger vẫn `O`.
4. Đột biến chứng minh ca không xanh-RỖNG (sao file ra scratchpad TRƯỚC, không `git checkout` giữa chừng — memory `git-checkout-in-mutation-loop-wipes-uncommitted-fix`): (a) bỏ vế `period-frozen` ⇒ B3/B4/B5 đỏ; (b) (7) bỏ so `formula` ⇒ F3 đỏ; (c) trả hằng seeder về cũ ⇒ F1/F2 đỏ.
5. `bash scripts/check-migration-no-drop.sh` xanh · `pnpm --filter @mediaos/api typecheck` + `lint` · `bash harness/check.sh --lane-db=db1b` xanh KHÔNG banner «XANH KHÔNG ĐỦ BẰNG CHỨNG».

## 9. Rủi ro tồn đọng
- **R1 — người vận hành ĐO trước deploy** (agent không chạm DB PROD): `SELECT count(*) FROM salary_components WHERE is_system AND code='LUONG_CO_BAN' AND formula='<cũ>'` + `SELECT count(*) FROM payroll_period_lines WHERE template_fingerprint IS NOT NULL` (phải 0).
- **R2 — rollback BE qua mốc 0574:** build cũ seed công ty MỚI bằng chuỗi cũ và không có (7). Không tệ hơn hiện trạng (DB-2 đã CẤM rollback qua 0572); roll-forward ⇒ (7) báo đích danh ⇒ vá tay bằng khối (1).
- **R3 — không insert-shape** (§3.6): INSERT thô hàng `Approved` chưa consume vẫn được. **SỬA (security-review MEDIUM):** bản trước ghi «không tạo tiền» là SAI — máy tính (`lockPickedBonusPenaltiesTx`) nhặt hàng `Approved` của tháng rồi gắn vào kỳ `CollectingData`/`Calculated` (được (F) cho qua), và DB KHÔNG có CHECK four-eyes ⇒ script/bug INSERT hàng tự duyệt (`decided_by = created_by`) lọt vào lương. API không đi được (repository ghi theo danh sách cột, service chặn 012). Nợ BE-3: `CHECK (status <> 'Approved' OR decided_by IS DISTINCT FROM created_by)` — đo lại fixture INSERT `Approved` trước khi thêm.
- **R4 — override người dùng mang chuỗi cũ** (NOTICE ở (0)): không sửa dữ liệu người dùng; BE-3 hiển thị/QA-1 soát.
- **R5 — ĐÃ ĐO (§5.2.a): v2 lệch v1 đúng 0,01 ở ca hoà nửa xu** (~1% lưới), v1 là bên làm tròn sai. User-visible nhỏ: phiếu v2 của cùng người/cùng số công có thể hơn/kém v1 1 xu. Ghi SPEC-11 §13.4 + báo owner; QA-1/BE-3 đối soát bằng số học chính xác.
- **R6 — BE-3 đảo thứ tự khoá** (ghi `bonus_penalties` trước khi khoá kỳ) ⇒ nguy cơ 40P01 với FOR SHARE mới — ghi done_when BE-3.

## 10. Definition of Done
Migration `0574` + journal · hằng seeder v3 · integrity (5)(7) tách file · index + drizzle · trigger (F) + INSERT + tag · fixture §3.1/§3.2 · int-spec §6.1 xanh trên lane mới + lane có dữ liệu · §8 bằng chứng dán §11 · FULL gate database + security PASS · docs §7 · backlog cập nhật · PR KHÔNG auto-merge (vùng đỏ).

## 11. Bằng chứng đã chạy

**Lane `mediaos_db1b` (PG 17.10), 14/09/2026.**

### 11.1 RED trước bản vá (head `0573`, seeder v2)

`s15-payroll-db1b-invariants`: **23 đỏ / 30** — F1 · F2 · F3 · F4 · F5 · F6 · B3 ×6 · B4 ×6 · B5-DENY · B6 · B7 · B9 · B-neo. Xanh đúng vai ALLOW: B1 ×2 · B2 ×2 · B5-ALLOW · B9b · F3b · F4b.

### 11.2 Migration trên lane CÓ dữ liệu cũ (§8 bước 2–3, `psql -1` = một transaction như migrator)

- Dựng 2 công ty mang chuỗi cũ bằng INSERT (freeze chỉ BEFORE UPDATE) ⇒ trước: **2** hàng.
- Lượt 1: `NOTICE [0574] preflight: LUONG_CO_BAN chuoi cu=2 · chuoi moi=0 · formula_override mang chuoi cu=0` · `NOTICE [0574] LUONG_CO_BAN: da va 2 hang` · exit 0.
- Sau: 2 hàng mang chuỗi MỚI · `salary_component_system_freeze` `O`/19 · `bonus_penalty_freeze_guard` `O`/**23** · `pg_get_indexdef` = `CREATE INDEX payroll_template_components_company_component_idx ON public.payroll_template_components USING btree (company_id, component_id)`.
- Lượt 2 (idempotent): `chuoi cu=0 · chuoi moi=2` · `da va 0 hang` · index `already exists, skipping` · exit 0.
- Lượt ĐỎ: 1 hàng công thức thứ ba ⇒ `ERROR: [0574] DUNG: 1 hang he thong LUONG_CO_BAN mang cong thuc THU BA — da co nguoi vuot trigger, KHONG tu de` · exit 3 · trigger freeze vẫn `O`. Fixture bằng chứng đã dọn.
- `bash scripts/lane-db-setup.sh db1b` ⇒ migrator ghi sổ **242** migration (0574 áp lại, idempotent).

### 11.3 GREEN

- `s15-payroll-db1b-invariants` · `bonus-penalty-transition` · `s15-payroll-be2-seed` · `s15-payroll-db1-seed` · `s15-payroll-db1-invariants` · `s13-payroll-db1-invariants` · `payroll-be1-legacy-items` · `s15-payroll-be2-templates` · `s15-payroll-be2-components` · `src/payroll/**` · census formula: **20 file / 457 ca xanh**.
- Spec boot app (`--no-file-parallelism`): `payroll-be2-lifecycle` (C1 + B8) · `payroll-be2-noti-audit` · `payroll-be2-permission` · `s13-payroll-qa1-arithmetic` · `s13-payroll-qa1-fsm-race` · `s13-payroll-qa1-idor-tenant` · `payroll-be1-errors`: **7 file / 219 ca xanh**.
- E2/E3 quét toàn lane chạy lại SAU nhóm trên (đã ghi `allowances` khác rỗng qua helper): xanh.
- `pnpm --filter @mediaos/api typecheck` exit 0 · `lint` 0 lỗi · `check-migration-no-drop` OK (242 migration, 0 lệnh phá huỷ chưa đăng ký).

### 11.4 Đột biến (§8 bước 4 — script sao file ra scratchpad, khôi phục bằng `cp` + replay 0574; KHÔNG `git checkout`)

| Đột biến | Đỏ | Xanh (phần còn lại của nhóm) |
| --- | --- | --- |
| **a1** gỡ vế NHẢ của (F) | B3 ×6 — **chỉ** B3 | 17 |
| **a2** gỡ vế GẮN (UPDATE) của (F) | B4 ×6 · B6 · B9 (hai ca sau cũng đi qua vế gắn — đỏ là ĐÚNG, không phải rò) | 15 |
| **a3** gỡ nhánh INSERT | B5-DENY — **chỉ** B5-DENY | 22 |
| index cùng TÊN trên `(company_id, template_id)` | F5 | — |
| **(b)** (7) bỏ so `formula` | F3 (F3b vẫn xanh) | F3b |
| **(c)** hằng seeder `LUONG_CO_BAN` về chuỗi cũ | F1 · F2 | — |

Sau lượt: TS khôi phục khớp byte (`cmp`); DB replay 0574 xanh verify (`tgtype 23/O`, indexdef đúng, `prosrc` có (F)).

### 11.5 Điểm lệch plan khi thi công

- **B8** đặt vào C1 của `payroll-be2-lifecycle` (spec đó đã boot app + gieo khoản `Approved`) thay vì file mới — cùng khẳng định, không boot app lần hai.
- **F4b** dựng trạng thái kiểu 053 bằng SQL (override hợp lệ trên `LUONG_CO_BAN` + gỡ `KPCD`) thay vì gọi API 053. Rủi ro M-2 (bản sao logic) đóng bằng cấu trúc: (5) gọi CHÍNH `PayrollTemplatesRepository.componentsTx` (không dùng `this`) + `templateGraphComponent` từ module lá.
- **F2** lưới 7.296 ca (6 base × 6 `w` × `p` 0→w+1 bước 0,5 × 4 `u`) + neo tay. Ở ca HOÀ, v1 được phép lệch ĐÚNG ±1 xu chứ không bắt buộc lệch — v1 vẫn đúng khi phép chia chia hết (vd `11/22`).
- **Fixture `'[]'`** cũng đi qua `writeSalaryProfileWithItems` (đồng dạng, mirror no-op) — không chừa đường ghi thô cho lần sửa sau.
- **Seeder** còn 683 dòng sau khi tách integrity (vượt trần 800 đã hết).

### 11.6 `check.sh --lane-db=db1b` (TRƯỚC khi vá §11.7)

`secret-literals` · `lint` · `typecheck` · `migration-no-drop` · `tooling-tests` · `test (LANE_DB=mediaos_db1b) [chunked]` — **XANH ✅ exit 0**, KHÔNG banner «XANH KHÔNG ĐỦ BẰNG CHỨNG». api 694/694 file chạy (7 lần chạy lại do crash hạ tầng) · app 275 · auth 4 · console 22 · contracts 39 · ui 24 · web-core 45.

### 11.7 database-reviewer = PASS — 4 mục đã vá (14/09/2026)

| Mục | Vá | Bằng chứng |
| --- | --- | --- |
| **M-1** nhánh INSERT lọc `pp.deleted_at IS NULL` không có ca canh | ca **B9c** (INSERT khoản đã consume vào kỳ CollectingData đã xoá mềm ⇒ `not-found`) · verify (4) đếm chuỗi lọc trong `prosrc` **đúng 2** lần | đột biến **a4** (gỡ lọc RIÊNG nhánh INSERT, function-only) ⇒ **chỉ B9c** đỏ, 23 ca nhóm B xanh · **a4-verify** (cả file 0574 mang a4, `psql -1`) ⇒ `ERROR: [0574] verify: loc pp.deleted_at IS NULL phai xuat hien DUNG 2 lan …` exit 3, rollback, `prosrc` vẫn đếm 2 |
| **L-1** F3/F4 assert lỏng | F3 `toContain("LUONG_CO_BAN.formula")` · F4 `toContain("mẫu mặc định KHÔNG biên dịch được")` | đột biến **(d)** (5) bỏ `compileGraph` ⇒ **chỉ F4** đỏ, F4b xanh; TS khôi phục khớp byte |
| **L-2** khối (1) không bọc điều kiện | `IF v_before > 0 … ELSE v_n := 0`, so bằng `IS DISTINCT FROM` — DB mới/chạy lại KHÔNG tắt trigger, KHÔNG lấy khoá | nhánh IF: tx dựng 2 hàng chuỗi cũ → replay ⇒ `chuoi cu=2` · `da va 2 hang` · verify (4) xanh · ROLLBACK · nhánh ELSE: replay COMMIT trên lane (0 hàng cũ) ⇒ `da va 0 hang`, exit 0 |
| **L-3** helper xoá mọi item của hồ sơ | DELETE thêm `AND component_code LIKE 'PC\_%'` · docstring nêu đúng lý do nhận `Pool` (tự giữ tx) | nhóm spec dùng helper chạy lại xanh (dưới) |

**GREEN sau vá** (lane `mediaos_db1b`, 0574 bản vá đã replay):

- Spec boot app (`--no-file-parallelism`): `payroll-be2-lifecycle` 20 · `payroll-be2-permission` 54 · `payroll-be2-noti-audit` 7 · `s13-payroll-qa1-idor-tenant` 36 — lượt đó thoát 1 ngay sau file thứ 4, KHÔNG có ca `×` nào (nghi worker crash; log đã lọc nên không giữ được nguyên nhân) ⇒ chạy lại 3 file còn lại: `s13-payroll-qa1-fsm-race` 80 · `payroll-be1-errors` 13 · `s13-payroll-qa1-arithmetic` 9 = **102/102**, exit 0. Tổng **7 file / 219 ca xanh**.
- `s15-payroll-db1b-invariants` (32 — thêm B9c) · `s15-payroll-db1-invariants` (62 — E2/E3 quét toàn lane SAU nhóm boot app) · `bonus-penalty-transition` 22 · `s13-payroll-db1-invariants` 44 · `s15-payroll-db1-seed` 14 · `s15-payroll-be2-seed` 8: **6 file / 182 ca xanh**.
- `pnpm --filter @mediaos/api typecheck` exit 0 · eslint file chạm exit 0 · prettier: `payroll-be2-lifecycle` (HEAD sạch) đã format lại.

### 11.8 security-reviewer = PASS (14/09/2026)

CRITICAL 0 · HIGH 0 · MEDIUM 1 · LOW 4 — không mục nào bắt buộc vá trước commit. Reviewer đối chiếu catalog thật của lane `mediaos_db1b` (chỉ SELECT).

| Mục | Xử lý |
| --- | --- |
| **MEDIUM** §3.6/R3 dẫn CHECK `bonus_penalties_four_eyes` KHÔNG tồn tại (đo lại `pg_constraint`: chỉ `decided_pair`) ⇒ INSERT thô `Approved` tự duyệt lọt vào lương qua `lockPickedBonusPenaltiesTx`; lỗ có từ 0564, API không đi được | sửa §3.6 + R3 · nợ CHECK tự duyệt ghi `done_when` BE-3 |
| **LOW** `releaseConsumedTx`/`bindConsumedTx` trong `calculate` không qua `mapPayrollPgError` ⇒ (F)/(C) bắn do race = 500 thay vì 409 013 (không rò: client nhận «Lỗi hệ thống») | `done_when` BE-3 |
| **LOW** migration sửa công thức tiền mọi tenant không có hàng `audit_logs` | RELEASE dán BẮT BUỘC 2 dòng NOTICE + số đo R1 (test plan PR) |
| **LOW** assert (7) chỉ log (runner nuốt) — build cũ seed sau mốc 0574 (R2) giữ chuỗi cũ | `done_when` BE-3: cổng cứng lúc TÍNH |
| **LOW** (F) lách được bằng script UPDATE `payroll_periods.status` về `CollectingData` (bảng kỳ không có trigger) · `bonus_penalties.company_id` không đóng băng (app role bị RLS WITH CHECK + FK composite chặn, chỉ superuser đổi được) | ghi nhận |

Đã kiểm, không lỗ: x→NULL→y hai câu · đổi kỳ kèm status ((E) + `consume_approved`) · nhả không lọc `deleted_at` (kỳ sống chưa từng trả lương) · `company_id` OLD/NEW khớp FK · INVOKER + RLS thiếu GUC ⇒ `not-found` · `public.` + `proconfig` rỗng, app/worker không CREATE trên `public` · thứ tự khoá (chỉ `releaseConsumedTx`/`bindConsumedTx` ghi `payroll_period_id`, sau `FOR UPDATE` kỳ) · không cửa sổ trigger tắt · map lỗi không đưa uuid tới client · `componentsTx` lọc tenant · fixture không tắt trigger, không literal giống secret.

# DB-13: PAYROLL DATABASE DESIGN — TIỀN LƯƠNG (kèm BẢN ĐỒ RECONCILE 6 bảng di sản G12)

> **Nguồn nghiệp vụ:** [SPEC-11 PAYROLL](<../SPEC/SPEC-11 PAYROLL.md>) · Quy ước chung: [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) §3.2/§7.13 · HR nền: [DB-03](<DB-03_HR Database Design.md>) · ATT nền: [DB-04](<DB-04_ATT Database Design.md>) (`attendance_periods`/`attendance_records`) · LEAVE nền: [DB-05](<DB-05 LEAVE Database Design.md>) (`leave_types.paid`) · Foundation: [DB-08](<DB-08 Audit Files Settings Seeds Database Design.md>) (`audit_logs`)
>
> **Liên quan:** [API-18 PAYROLL API Design](<../API Design/API-18_PAYROLL_API_Design.md>) · [DB-09 §8.19 index](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed PAYROLL](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9g](<../permission-matrix-spec.md>) · [Đối chiếu code↔thiết kế](<../erd-current.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số (PAY-DEC-001):** PAYROLL lấy đúng **DB-13** mà IMPLEMENTATION-10 §13.2 giữ chỗ (OFFICE-DEC-001 đã tôn trọng khi ASSET/ROOM nhảy DB-15/16; RECRUIT lấy DB-14). API lấy **API-18** (API-13 vốn dự định cho PAYROLL đã bị CHAT chiếm).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-13 |
| Tên tài liệu | PAYROLL Database Design — Tiền lương |
| Module | PAYROLL (SPEC-11) |
| Phiên bản | v1.0 — **Approved** cùng SPEC-11 (owner duyệt gói wave S13-PAYROLL 31/08/2026) |
| Ngày tạo / cập nhật | 31/08/2026 / 31/08/2026 |
| Head migration lúc viết | idx 230 / `0563_s12recruitdash1_widget_recruit_funnel` ⇒ migration PAYROLL dự kiến **`0564+`** |
| Giai đoạn | Phase 2 «HR nâng cao» · wave S13-PAYROLL — hậu go-live |

> ⚠️ Số migration dưới đây là **dự kiến**. WO DB phải đọc `apps/api/migrations/meta/_journal.json` **tại thời điểm chạy** và lấy `idx = max + 1` (**KHÔNG suy từ tên file** — bẫy `migration-not-in-journal-is-silently-skipped`); lane migration là lane **nối tiếp** duy nhất của wave.
>
> ⚠️ **Band di sản `0091`–`0180` BẤT KHẢ XÂM PHẠM.** Mọi thay đổi trên 6 bảng G12 làm bằng migration MỚI (`0564+`), không sửa file cũ.

---

## 2. Mục đích tài liệu

Đặc tả tầng dữ liệu cho module PAYROLL: hồ sơ lương versioned, thưởng/phạt theo kỳ, kỳ lương 7 trạng thái, bảng lương nháp, phiếu lương append-only + dòng chi tiết, xác nhận phiếu.

**Khác mọi module gần đây, PAYROLL không phải nền trắng.** Sáu bảng đã tồn tại thật từ đợt G12 hướng cũ. File này vì vậy có **hai phần**:

- **§5 — BẢN ĐỒ RECONCILE**: từng bảng di sản, cột/CHECK/index/trigger nào **GIỮ · ĐỔI · GỠ · THÊM**, và tại sao.
- **§6 — Đặc tả bảng đích**: hình dạng cuối cùng sau reconcile.

Quy tắc nghiệp vụ (mã lỗi, ma trận FSM, masking) sống ở SPEC-11 — file này chỉ nói về dữ liệu.

---

## 3. Phạm vi thiết kế

### 3.1 Bảng MỚI

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| `payroll_period_lines` | **Bảng lương NHÁP** — 1 dòng / (kỳ, nhân sự), mutable trước `Approved` | Bắt buộc kỹ thuật để `payslips` giữ được khuôn append-only mà bảng lương vẫn tính lại được (SPEC-11 §3.4, §22a) |

### 3.2 Bảng RECONCILE (đã tồn tại — ALTER bằng migration mới)

| Bảng | Migration gốc | Tóm tắt reconcile |
| --- | --- | --- |
| `salary_profiles` | `0091` | GỠ 4 cột (`salary_type`·`pay_cycle`·`currency`·`status`) + 3 CHECK; đổi unique «1 active» → **versioned theo `effective_date`**; THÊM `*_by` + composite tenant FK |
| `payroll_periods` | `0094`, `0130` | GỠ `kpi_locked`; đổi `status` 3 → **7 giá trị PascalCase**; **DROP trigger** `payroll_period_status_guard`; THÊM vết `calculated_*`/`submitted_*`/`locked_*`/`reopen_reason`/`pay_date` + **CHECK four-eyes** + composite tenant FK |
| `payslips` | `0095`, `0099` | GỠ `entry_kind`·`replaces_payslip_id`·`kpi_amount`·`currency` + 2 CHECK + `payslips_replaces_uq`; partial unique → **UNIQUE thẳng**; THÊM `deduction_amount`·`paid/unpaid_leave_days`·`input_snapshot_json` + composite tenant FK. **Giữ nguyên khuôn append-only** |
| `payslip_items` | `0096` | GỠ `'kpi'` khỏi CHECK `item_type`; THÊM `sort_order` + composite tenant FK. Giữ append-only |
| `bonus_penalties` | `0098`, `0548` | GỠ `source`·`reference_type`·`task_id`·`kpi_result_id`·`currency` + 2 CHECK; đổi `status` → **PascalCase 3 giá trị**; RENAME `approved_by/at` → `decided_by/at`; `reason` → **NOT NULL**; **DROP trigger** `bonus_penalty_guard`; THÊM `decision_note` + composite tenant FK |
| `payslip_acknowledgements` | `0131` | Thu về **sổ chỉ-INSERT**: GỠ `status`·`reason`·`resolved_*`·`resolution_note`·`updated_at` + CHECK + **DROP trigger** `payslip_ack_status_guard`; **REVOKE UPDATE**; THÊM composite tenant FK |

### 3.3 Bảng dùng lại (không tạo mới, không ALTER)

`companies` (`payroll_config_json` — cutoffDay/payDay) · `users` (nhân sự hưởng lương + `*_by`) · `employee_profiles` (danh tính hiển thị — chỉ JOIN đọc qua điểm chiếu duy nhất) · `attendance_periods` (điều kiện `locked`) · `attendance_records` (số công, phút trễ) · `leave_requests` + `leave_types.paid` (phép có/không lương) · `roles`/`permissions`/`role_permissions` · `modules` (hàng PAYROLL **đã pre-seed inactive** từ `0435`, `sort_order` 8) · `audit_logs` · `notification_events`/`notification_templates`/`notifications`.

**KHÔNG seed `sequence_counters`** — PAYROLL không có mã tự sinh ở v1.

---

## 4. Nguyên tắc thiết kế

1. **RLS + FORCE theo `company_id`** trên cả 7 bảng. Sáu bảng di sản **đã có** policy `tenant_isolation` dạng `current_setting('app.current_company_id', true)` (đo `0091`/`0094`/`0095`/`0096`/`0098`/`0131`) — migration mới **verify lại fail-loud**, không giả định; bảng mới `payroll_period_lines` tạo policy **literal-GUC** mẫu `0549`/`0559` trước mọi INSERT (bất biến #1); đăng ký `rls-registry`.
2. **Composite tenant FK** `(company_id, x_id) REFERENCES t (company_id, id)` cho **mọi** FK chéo bảng nghiệp vụ. **BỔ SUNG composite BÊN CẠNH, GIỮ NGUYÊN FK đơn cột** (đúng khuôn `0535` — thêm, không thay).
   - ⚠️ **ĐÍNH CHÍNH sau phép đo 01/09/2026:** câu "band G12 đang là FK đơn cột" **SAI** — `0535` đã phủ composite cho **cả 6 bảng di sản**, và `attendance_periods` **đã có** `UNIQUE (company_id, id)` (`0535:585`). Vì vậy `0564` **không** "đổi toàn bộ FK đơn cột → composite" (diff rỗng, rủi ro cao) mà chỉ: (a) THÊM composite cho cột `*_by` MỚI · (b) SỬA `ON DELETE` của composite lệch khuôn (`salary_profiles.user_id` CASCADE→NO ACTION · `payslip_items.payslip_id` CASCADE→NO ACTION · `bonus_penalties.decided_by` RESTRICT→SET NULL · `bonus_penalties.payroll_period_id` và `payroll_periods.attendance_period_id` SET NULL→NO ACTION) · (c) THÊM `bonus_penalties_company_id_id_uq` (bảng DUY NHẤT còn thiếu). Danh sách ĐÓNG 32 composite FK nằm ở khối verify của `0564`.
   - ⚠️ **Vì sao không DROP FK đơn cột:** `apps/api/test/foundation/fk-tenant-verdicts.ts` giữ `FK_SINGLE_COL_PAIRS_FLOOR` là **SÀN** — số cặp FK đơn cột chỉ được phép giảm khi **bảng/cột thật sự biến mất**, và mỗi lần hạ phải kèm **đo hai lane** giải thích từng cặp. DROP hàng loạt FK đơn cột để "thay bằng composite" làm census tụt ⇒ ratchet đỏ ⇒ WO sẽ bị cám dỗ hạ sàn cho qua.
   - **Sàn CÓ hạ ở wave này, đúng bằng số FK biến mất theo cột bị GỠ.** ⚠️ **ĐÍNH CHÍNH sau phép đo của `S13-PAYROLL-DB-1` (01/09/2026): là 4 cặp, KHÔNG phải 2** — bản viết ngày 31/08 chỉ kể `bonus_penalties`. Đủ bốn: `bonus_penalties.task_id → tasks` · `bonus_penalties.kpi_result_id → kpi_results` (§5.5) · **`payslip_acknowledgements.resolved_by → users`** (§5.6) · **`payslips.replaces_payslip_id → payslips`** (§5.3). Đo hai trạng thái cùng ngày: `mediaos` head `0563` = **416**, `mediaos_payrolldb1` head `0566` = **412** ⇒ `FK_SINGLE_COL_PAIRS_FLOOR` **415 → 411**. (`bonus_penalties.approved_by → decided_by` chỉ ĐỔI TÊN nên census vẫn thấy đủ cặp — không tính.) WO DB **đo lại số thật** rồi hạ sàn đúng bằng con số đó — không hạ "cho vừa".
   - `company_id` của cả 7 bảng: `REFERENCES companies (id) ON DELETE CASCADE` — teardown `DELETE FROM companies` dọn được (di sản đã đúng).
   - **FK về `users` — danh sách ĐÓNG** (verify đúng-bằng ở §7A): `salary_profiles` (`user_id` + `created_by`/`updated_by`/`deleted_by` **mới**) · `payroll_periods` (`created_by`/`updated_by`/`calculated_by`/`submitted_by`/`approved_by`/`published_by`/`locked_by`/**`payslips_generated_by`** — ⚠️ đính chính 01/09: bản 31/08 SÓT cột này, dù §6.3 bắt buộc nó) · `payroll_period_lines` (`user_id` + `created_by`/`updated_by`/`deleted_by`) · `bonus_penalties` (`user_id`/`created_by`/`updated_by`/`decided_by`/`deleted_by`). Bảng chỉ-INSERT `payslips` (`user_id`/`created_by`) và `payslip_acknowledgements` (`user_id`) dùng **`NO ACTION`** — RI action chạy ở tầng owner, `SET NULL` sẽ ghi đè cột không có grant UPDATE (đính chính `0549` của ASSET, bất biến #2). Bảng mutable dùng `SET NULL (col)` **liệt kê cột** (khuôn `0535:682`), riêng `user_id` NOT NULL dùng `NO ACTION`.
   - **Composite FK nội bộ: `ON DELETE NO ACTION`, TUYỆT ĐỐI KHÔNG `RESTRICT`** — cascade từ `companies` xoá các bảng anh em theo thứ tự bất định (bài học `cleanupTenants`, DB-15 §4.2). ⚠️ `bonus_penalties.task_id`/`kpi_result_id` di sản đang là `RESTRICT` — cả hai cột **bị GỠ** ở wave này nên vấn đề tự tiêu.
3. **Append-only**: `payslips` · `payslip_items` giữ nguyên `GRANT SELECT, INSERT` di sản; `payslip_acknowledgements` **REVOKE UPDATE** để về cùng khuôn. Không bảng PAYROLL nào có DELETE cho app role. `mediaos_worker` đang giữ `SELECT` di sản trên 6 bảng — **PAYROLL v1 không có system job nào đọc bảng lương** (đo 31/08/2026: 0 route, 0 handler, 0 `@SystemJobHandler`). ⇒ **THU HỒI `SELECT` của worker trên `salary_profiles` · `payroll_period_lines` · `payslips` · `payslip_items` NGAY Ở WO DB (bước A)**, không đẩy sang BE-2 — quyền đọc trên bảng lương không nên trôi qua nhiều WO. Giữ `SELECT` worker trên `payroll_periods` và `bonus_penalties` (không chứa số lương per-người ở mức chi tiết phiếu; nếu Phase sau có job thì đã có sẵn).
4. **FSM ép ở service, DB chỉ CHECK tập giá trị** + UNIQUE/CHECK-cặp làm chốt cuối (`check-cannot-enforce-fsm-transitions`). **Ba trigger di sản bị DROP** (§5) — chúng đang ép FSM cũ 3 trạng thái, giữ lại là chặn oan FSM mới; trigger đóng băng bảng cũng là bẫy `frozen-table-triggers-break-db-init`.
5. **Tiền là `numeric(18,2)`, tính/làm tròn/clamp Ở SQL** — cấm số thực JS (`clamp-must-be-sql-not-js`). VND duy nhất ⇒ **GỠ mọi cột `currency`** (hằng ở service, không cột ghi-rồi-bỏ).
6. **Hai tầng dữ liệu tách bạch**: `payroll_period_lines` (nháp, mutable, tính lại được) → `payslips` + `payslip_items` (phát hành, bất biến). Không có đường nào sửa phiếu đã sinh.
7. **Hợp đồng Zod mirror CHECK hai chiều, đúng bằng** (`packages/contracts/src/payroll.ts` — **file đã tồn tại với DTO hướng cũ, phải VIẾT LẠI**): không chặt hơn, không lỏng hơn; export prefix `payroll*`. Đổi một bên mà quên bên kia là lớp lỗi `equal-caps-at-zod-and-service-make-dead-error-code` / 500 ở DB.
8. UUID PK `gen_random_uuid()`, timestamptz UTC, soft delete `deleted_at` ở `salary_profiles`/`payroll_periods`/`bonus_penalties`/`payroll_period_lines` — theo DB-01 §16.2.
9. **ĐO TRƯỚC KHI ALTER.** WO DB chạy `SELECT count(*)` trên cả 6 bảng + đọc `pg_catalog` (`pg_constraint`, `pg_index`, `pg_trigger`, `aclexplode`) và bảng `permissions ⋈ role_permissions` **trên DB thật** trước khi viết lệnh — **GRANT/grant trong migration cũ ≠ hiện trạng** (`grant-in-old-migration-is-not-current-state`). Dự kiến 0 hàng ở cả 6 bảng; **nếu ĐO ra ≠ 0 thì DỪNG và báo người** (mọi lệnh GỠ cột dưới đây giả định 0 hàng).

---

## 5. BẢN ĐỒ RECONCILE — 6 bảng di sản G12 (PAY-DEC-002)

> Ký hiệu: **GIỮ** = không đụng · **ĐỔI** = ALTER · **GỠ** = DROP (0 route tiêu thụ, không nối dây) · **THÊM** = cột/ràng buộc mới.
>
> ⚠️ **`DROP COLUMN` của Postgres gỡ theo MỌI CHECK chạm cột đó, trong im lặng** (`drop-column-silently-drops-check`). Mỗi mục GỠ dưới đây **liệt kê tường minh** CHECK/index nào chết theo, và CHECK nào phải **DỰNG LẠI**.

### 5.1 `salary_profiles` (mig `0091`)

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| `id` · `company_id` · `user_id` · `effective_date` · `base_salary` · `allowances` · `note` · `created_at` · `updated_at` · `deleted_at` | **GIỮ** | khớp thiết kế |
| RLS ENABLE + FORCE + policy `tenant_isolation` | **GIỮ** (verify fail-loud) | bất biến #1 đã đúng |
| GRANT app `SELECT, INSERT, UPDATE` (no DELETE) · worker `SELECT` | **GIỮ** (worker: xem §4.3) | soft delete |
| `salary_type` + CHECK `salary_profile_type_check` | **GỠ** | v1 chỉ lương tháng (PAY-DEC-004); 3 giá trị không ai ghi = cột ghi-rồi-bỏ |
| `pay_cycle` + CHECK `salary_profile_pay_cycle_check` | **GỠ** | kỳ tháng duy nhất (PAY-DEC-005) |
| `currency` | **GỠ** | VND duy nhất (PAY-DEC-004) |
| `status` + CHECK `salary_profile_status_check` | **GỠ** | versioned theo `effective_date` thay cờ active — hai cơ chế song song là nguồn mâu thuẫn |
| `CHECK salary_profile_base_positive_check` (`base_salary > 0`) | **GIỮ** | không chạm cột bị gỡ |
| UNIQUE partial `salary_profiles_company_user_active_uq` `(company_id,user_id) WHERE deleted_at IS NULL AND status='active'` | **GỠ** (phụ thuộc `status`) → **THÊM** `salary_profiles_company_user_effective_uq` `(company_id, user_id, effective_date) WHERE deleted_at IS NULL` | versioned: một phiên bản / ngày hiệu lực; chốt cuối cho PAYROLL-ERR-014 |
| index `salary_profiles_company_id_idx` · `salary_profiles_user_id_idx` | **GIỮ** | |
| — | **THÊM** `created_by` · `updated_by` · `deleted_by` (FK `users`, `SET NULL (col)`) | hiện **không có** vết người thao tác trên bảng crown-jewel |
| FK `user_id → users.id CASCADE` (đơn cột) | **ĐỔI** → composite `(company_id, user_id) → users (company_id, id)` `NO ACTION` | band G12 trước khuôn `0535` |
| — | **THÊM** `salary_profiles_company_id_id_uq UNIQUE (company_id, id)` | đích của composite FK từ `payslips`/`payroll_period_lines` |

### 5.2 `payroll_periods` (mig `0094` + `0130`)

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| `id` · `company_id` · `period_month` + CHECK `payroll_periods_month_check` · `attendance_period_id` · `created_by` · `approved_by`/`approved_at` · `published_by`/`published_at` · `created_at`/`updated_at`/`deleted_at` | **GIỮ** | khớp thiết kế |
| UNIQUE `payroll_periods_company_month_uq` `(company_id, period_month) WHERE deleted_at IS NULL` | **GIỮ** | chốt cuối PAYROLL-ERR-008 |
| RLS + FORCE + policy · GRANT `SELECT,INSERT,UPDATE` | **GIỮ** (verify) | |
| `kpi_locked` | **GỠ** | KPI ngoài phạm vi sản phẩm (de-media-fy, CLAUDE.md §1) |
| CHECK `payroll_periods_status_check` `IN ('draft','approved','published')` | **ĐỔI** → `IN ('Draft','CollectingData','Calculated','Reviewing','Approved','Paid','Locked')`, default `'Draft'` | SPEC-01 §17.15 |
| CHECK `payroll_periods_approved_pair_check` | **ĐỔI** → `status NOT IN ('Approved','Paid','Locked') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)` | giá trị mới |
| CHECK `payroll_periods_published_pair_check` | **ĐỔI** → `status NOT IN ('Paid','Locked') OR (published_by IS NOT NULL AND published_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)` | giá trị mới |
| **TRIGGER `payroll_period_status_guard`** + `FUNCTION enforce_payroll_period_status()` (`0130`) | **GỠ (DROP)** | ép FSM cũ `draft→approved→published`; giữ lại là **chặn oan mọi chuyển tiếp mới** (`CollectingData`, `Calculated`, `Reviewing`, `Paid`, `Locked`) và cấm xoá mềm kỳ non-draft. FSM 7 trạng thái ép ở service (§4.4) |
| — | **THÊM** `pay_date DATE` (ghi cứng lúc tạo kỳ từ `payroll_config_json.payDay`) · `note TEXT` | P2-PAY-03-001 |
| — | **THÊM** `calculated_by`/`calculated_at` · `submitted_by`/`submitted_at` · `locked_by`/`locked_at` · `reopen_reason TEXT` · `updated_by` (FK `users`, `SET NULL (col)`) | vết đầy đủ vòng đời 7 trạng thái |
| — | **THÊM CHECK `payroll_periods_four_eyes_check`** `approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by` | chốt cuối four-eyes (PAY-DEC-007); service là tầng chính, DB là lưới an toàn |
| — | **THÊM CHECK `payroll_periods_locked_pair_check`** `status <> 'Locked' OR (locked_by IS NOT NULL AND locked_at IS NOT NULL)` | |
| — | **THÊM CHECK `payroll_periods_calculated_needs_attendance_check`** `status IN ('Draft','CollectingData') OR attendance_period_id IS NOT NULL` | không tồn tại kỳ đã tính mà không có nguồn công |
| FK `attendance_period_id → attendance_periods.id SET NULL` (đơn cột) · `*_by → users.id SET NULL` (đơn cột) | **ĐỔI** → composite `(company_id, attendance_period_id) → attendance_periods (company_id, id)` `NO ACTION`; `*_by` composite `SET NULL (col)` | ⚠️ `attendance_periods` **cần `UNIQUE (company_id, id)`** — ĐO trước, THÊM nếu thiếu (ALTER bảng của ATT, additive, không đổi dữ liệu) |
| — | **THÊM** `payroll_periods_company_id_id_uq UNIQUE (company_id, id)` | đích của composite FK |

### 5.3 `payslips` (mig `0095` + `0099`)

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| **Khuôn append-only**: GRANT app `SELECT, INSERT` **duy nhất**, không `updated_at`/`deleted_at` | **GIỮ NGUYÊN** | PAY-DEC-002 nói rõ; bất biến #2 |
| RLS + FORCE + policy | **GIỮ** (verify) | |
| `id` · `company_id` · `payroll_period_id` · `user_id` · `salary_profile_id` · `base_salary` · `total_allowances` · `gross` · `net` · `work_days` · `present_days` · `late_minutes` · `bonus_amount` · `penalty_amount` · `created_by` · `created_at` | **GIỮ** | `bonus_amount`/`penalty_amount` ĐỔI sang `NOT NULL DEFAULT 0` (hết vai trò "slot nullable") |
| `kpi_amount` | **GỠ** | KPI ngoài phạm vi |
| `currency` | **GỠ** | VND duy nhất |
| `entry_kind` + CHECK `payslips_entry_kind_check` · `replaces_payslip_id` + CHECK `payslips_chain_check` + UNIQUE `payslips_replaces_uq` | **GỠ (cả 4)** | v1 **không có** đường tạo `adjustment`/`void` (SPEC-11 §3.4, §22g) — sai sót sau phát hành xử lý bằng thưởng/phạt kỳ SAU. Giữ lại = 2 giá trị enum + 1 cột không ai ghi |
| UNIQUE partial `payslips_period_user_original_uq` `(company_id,payroll_period_id,user_id) WHERE entry_kind='original'` | **ĐỔI** → **UNIQUE thẳng** `payslips_period_user_uq (company_id, payroll_period_id, user_id)` | predicate mất theo `entry_kind`; unique thẳng mạnh hơn và là chốt cuối PAYROLL-ERR-006 |
| CHECK `payslips_amounts_check` (`base_salary>=0 AND total_allowances>=0 AND gross>=0`) | **ĐỔI** → thêm `AND deduction_amount >= 0 AND net >= 0` | `net` clamp về 0 ở SQL ⇒ CHECK khẳng định điều đó |
| index `payslips_company_period_user_idx` · `payslips_company_user_idx` | **GIỮ** | |
| — | **THÊM** `deduction_amount numeric(18,2) NOT NULL DEFAULT 0` · `paid_leave_days numeric(8,2) NOT NULL DEFAULT 0` · `unpaid_leave_days numeric(8,2) NOT NULL DEFAULT 0` · `input_snapshot_json jsonb NOT NULL` (**KHÔNG có DEFAULT** — xem §6.5) | đầu vào đóng băng + khấu trừ (PAY-DEC-004) |
| FK `payroll_period_id`/`user_id`/`salary_profile_id`/`created_by` (đơn cột) | **ĐỔI** → composite, **`NO ACTION` toàn bộ** (bảng chỉ-INSERT — `SET NULL` ghi đè cột không có grant UPDATE) | |
| — | **THÊM** `payslips_company_id_id_uq UNIQUE (company_id, id)` | đích composite FK từ `payslip_items` + `payslip_acknowledgements` |

### 5.4 `payslip_items` (mig `0096`)

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| Khuôn append-only (GRANT `SELECT, INSERT`) · RLS + FORCE + policy · `id`/`company_id`/`payslip_id`/`label`/`amount`/`meta`/`created_at` · index `payslip_items_company_payslip_idx` | **GIỮ** | |
| CHECK `payslip_items_type_check` `IN ('earning','deduction','allowance','attendance','kpi','bonus','penalty')` | **ĐỔI** → bỏ `'kpi'`, **thêm `'adjustment'`** ⇒ `IN ('earning','deduction','allowance','attendance','bonus','penalty','adjustment')` | KPI ngoài phạm vi; `adjustment` là đích của `payroll_period_lines.adjustment_amount` (SPEC-11 §13.4) |
| — | **THÊM** `sort_order INTEGER NOT NULL DEFAULT 0` | breakdown hiển thị đúng thứ tự, không phụ thuộc `created_at` (`now()` per-statement làm ties là thật) |
| FK `payslip_id → payslips.id CASCADE` (đơn cột) | **ĐỔI** → composite `(company_id, payslip_id) → payslips (company_id, id)` **`NO ACTION`** | CASCADE trên bảng chỉ-INSERT là đường xoá ẩn; `payslips` không bao giờ bị xoá |

### 5.5 `bonus_penalties` (mig `0098`, đã sửa ở `0548`)

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| `id` · `company_id` · `user_id` · `kind` + CHECK `bonus_penalties_kind_check` · `amount` + CHECK `bonus_penalties_amount_check` (`> 0`) · `period_month` + CHECK `bonus_penalties_month_check` · `payroll_period_id`/`consumed_at` + CHECK `bonus_penalties_consumed_pair_check` · `created_by`/`created_at`/`updated_at`/`deleted_at` · RLS + FORCE + policy · GRANT `SELECT,INSERT,UPDATE` · 4 index | **GIỮ** | khớp thiết kế |
| `reason TEXT` (nullable) | **ĐỔI** → **NOT NULL** | lý do bắt buộc (PL-02); 0 hàng nên backfill không cần |
| CHECK `bonus_penalties_status_check` `IN ('draft','approved','rejected')` | **ĐỔI** → `IN ('Pending','Approved','Rejected')`, default `'Pending'` | SPEC-01 §17.17 |
| `approved_by` / `approved_at` | **ĐỔI (RENAME)** → `decided_by` / `decided_at` | một cặp cột phục vụ cả duyệt lẫn từ chối |
| CHECK `bonus_penalties_approved_pair_check` | **ĐỔI** → `bonus_penalties_decided_pair_check`: `status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)` | |
| CHECK `bonus_penalties_consume_approved_check` (`… OR status = 'approved'`) | **ĐỔI** → `payroll_period_id IS NULL OR status = 'Approved'` | giá trị mới |
| `source` + CHECK `bonus_penalties_source_check` | **GỠ** | v1 chỉ nhập tay; `'kpi'` là di sản hướng cũ |
| `reference_type` · `task_id` · `kpi_result_id` + CHECK `bonus_penalties_reference_check` | **GỠ (cả 4)** | tham chiếu TASK/KPI là di sản. ⚠️ CHECK này **chết theo** `DROP COLUMN` — GỠ **tường minh** và **KHÔNG dựng lại** (khác `0548` nơi phải dựng lại vì cột còn). Kéo theo: bỏ FK `RESTRICT` sang `tasks`/`kpi_results` + index `bonus_penalties_approved_by_idx` giữ nguyên (đổi tên theo cột) |
| `currency` | **GỠ** | VND duy nhất |
| **TRIGGER `bonus_penalty_guard`** + `FUNCTION enforce_bonus_penalty_guard()` | **GỠ rồi DỰNG LẠI bản HẸP** | Bản cũ ép FSM chữ thường `draft→approved/rejected` ⇒ **chặn oan mọi hàng PascalCase mới** — phải DROP. Nhưng nó cũng là **lớp DB duy nhất đóng băng field tiền sau khi rời `Pending`** (chính `bonus-penalty-transition.int-spec.ts` chứng minh), và CHECK **không thể** so OLD/NEW ⇒ gỡ trắng là mất bất biến tiền trong im lặng. ⇒ dựng lại `enforce_bonus_penalty_freeze()` **hẹp hơn**: chỉ RAISE khi UPDATE làm đổi `amount` / `kind` / `user_id` / `period_month` / **`reason`** / **`decision_note`** **trong khi** `OLD.status <> 'Pending'` **hoặc** `OLD.payroll_period_id IS NOT NULL` (thiếu hai cột lý do thì sửa lý do một khoản phạt đã duyệt vẫn im lặng); **không** ép chuyển tiếp FSM (việc của service, PAYROLL-ERR-011/013); miễn trừ đường consume (`payroll_period_id`/`consumed_at` NULL↔set). Trigger hẹp không đóng băng cả bảng nên không dính bẫy `frozen-table-triggers-break-db-init` |
| — | **THÊM** `decision_note TEXT` + CHECK `bonus_penalties_reject_note_check` `status <> 'Rejected' OR decision_note IS NOT NULL` | reject bắt buộc lý do |
| — | **THÊM** `updated_by` · `deleted_by` | vết thao tác |
| FK `user_id`/`created_by`/`decided_by`/`payroll_period_id` (đơn cột) | **ĐỔI** → composite; `user_id`/`created_by` `NO ACTION`, `decided_by`/`updated_by`/`deleted_by` `SET NULL (col)`, `payroll_period_id` `NO ACTION` (**không** `SET NULL` — nhả consume phải đi qua service để `consumed_at` cùng về NULL, kẻo vỡ CHECK cặp) | |
| — | **THÊM** `bonus_penalties_company_id_id_uq UNIQUE (company_id, id)` | |

### 5.6 `payslip_acknowledgements` (mig `0131`)

| Hạng mục | Quyết định | Lý do |
| --- | --- | --- |
| `id` · `company_id` · `payslip_id` · `user_id` · `created_at` · UNIQUE `payslip_acknowledgements_payslip_user_uq (company_id, payslip_id, user_id)` · RLS + FORCE + policy · 2 index | **GIỮ** | hàng tồn tại = đã xác nhận |
| `status` + CHECK `payslip_ack_status_check` · `reason` + CHECK `payslip_ack_dispute_reason_check` · `resolved_by`/`resolved_at` + CHECK `payslip_ack_resolved_pair_check` · `resolution_note` · `updated_at` | **GỠ (toàn bộ)** | khiếu nại (`disputed`/`resolved`) **ngoài phạm vi v1** (SPEC-11 §5.2, §22f). Giữ 5 cột + 3 CHECK mà không route nào ghi = cột ghi-rồi-bỏ (`write-only-column-means-delete-not-wire-up`). Mở lại cùng **PARK-PAYROLL-001** |
| **TRIGGER `payslip_ack_status_guard`** + `FUNCTION enforce_payslip_ack_status()` | **GỠ (DROP)** | ép chuyển `disputed→resolved` trên cột vừa bị gỡ |
| GRANT app `SELECT, INSERT, UPDATE` | **ĐỔI** → **`SELECT, INSERT`** (REVOKE UPDATE) | bảng về đúng khuôn sổ chỉ-INSERT; UPDATE chỉ tồn tại để phục vụ đường khiếu nại đã gỡ. ⚠️ **`REVOKE` bảng xoá cả column-GRANT** — ở đây không có column-GRANT nên an toàn, vẫn phải verify bằng `aclexplode` sau khi chạy (`revoke-table-grant-wipes-column-grants`) |
| FK `payslip_id`/`user_id` (đơn cột) | **ĐỔI** → composite, **`NO ACTION`** (bảng chỉ-INSERT) | |

### 5.7 Tổng hợp — GỠ những gì

| Loại | Số lượng | Danh sách |
| --- | --- | --- |
| Cột | **20** | `salary_profiles`: `salary_type`·`pay_cycle`·`currency`·`status` (4) · `payroll_periods`: `kpi_locked` (1) · `payslips`: `entry_kind`·`replaces_payslip_id`·`kpi_amount`·`currency` (4) · `bonus_penalties`: `source`·`reference_type`·`task_id`·`kpi_result_id`·`currency` (5) · `payslip_acknowledgements`: `status`·`reason`·`resolved_by`·`resolved_at`·`resolution_note`·**`updated_at`** (6) |
| CHECK | **11** | 3 (`salary_profiles`) · 2 (`payslips`: entry_kind, chain) · 2 (`bonus_penalties`: source, reference) · 3 (`payslip_acknowledgements`) · +1 dựng lại có kiểm soát (`payslips_amounts_check`) |
| Index/unique | **3** | `payslips_replaces_uq` · `payslips_period_user_original_uq` (→ unique thẳng) · `salary_profiles_company_user_active_uq` (chết theo `DROP COLUMN status` — §5.1) |
| Trigger + function | **3 + 3 GỠ, 1 DỰNG LẠI** | GỠ: `payroll_period_status_guard`/`enforce_payroll_period_status` · `bonus_penalty_guard`/`enforce_bonus_penalty_guard` · `payslip_ack_status_guard`/`enforce_payslip_ack_status`. DỰNG LẠI (hẹp): `bonus_penalty_freeze_guard`/`enforce_bonus_penalty_freeze` (§5.5) |
| Cặp quyền | **16** | SPEC-11 §11.2 (bảng đầy đủ) — **thu hồi kèm mọi grant TRƯỚC khi seed 17 cặp mới** |
| FK đơn cột (theo cột bị GỠ) | **4** *(đính chính 01/09 — bản 31/08 ghi 2)* | `bonus_penalties.task_id` · `bonus_penalties.kpi_result_id` · `payslip_acknowledgements.resolved_by` · `payslips.replaces_payslip_id` — `FK_SINGLE_COL_PAIRS_FLOOR` **415 → 411**, đo hai trạng thái 416/412 (§4.2) |

---

## 6. Đặc tả bảng đích (sau reconcile)

### 6.1 ERD cấp module

```text
users (AUTH) 1─n salary_profiles (versioned theo effective_date)
attendance_periods (ATT) 0..1─n payroll_periods   ← phải 'locked' trước khi tính
payroll_periods 1─n payroll_period_lines n─1 users        (bảng lương NHÁP — mutable trước Approved)
payroll_periods 1─n payslips             n─1 users        (PHÁT HÀNH — append-only, UNIQUE (kỳ, người))
payslips        1─n payslip_items                          (breakdown — append-only)
payslips        1─n payslip_acknowledgements n─1 users     (sổ chỉ-INSERT, UNIQUE (phiếu, người))
users           1─n bonus_penalties  ─0..1─ payroll_periods (consume: bind kỳ đã gộp)
salary_profiles 0..1─n payroll_period_lines / payslips     (phiên bản lương đã dùng — vết giải thích)
```

### 6.2 `salary_profiles` — hồ sơ lương versioned

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK `companies.id` CASCADE, RLS |
| `user_id` | UUID | Có | composite FK → `users (company_id, id)` NO ACTION |
| `effective_date` | DATE | Có | ngày bắt đầu hiệu lực; phiên bản hiệu lực = bản `≤ ngày` mới nhất |
| `base_salary` | numeric(18,2) | Có | CHECK `> 0`; **mask ở server** |
| `allowances` | jsonb | Có | default `'[]'`; danh sách `{ name, amount }`; **mask ở server** |
| `note` | TEXT | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | chuẩn chung, soft delete |

```sql
ALTER TABLE salary_profiles ADD CONSTRAINT salary_profiles_company_id_id_uq UNIQUE (company_id, id);
CREATE UNIQUE INDEX salary_profiles_company_user_effective_uq
  ON salary_profiles (company_id, user_id, effective_date) WHERE deleted_at IS NULL;
-- GIỮ: salary_profile_base_positive_check, salary_profiles_company_id_idx, salary_profiles_user_id_idx
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

### 6.3 `payroll_periods` — kỳ lương (FSM 7 trạng thái)

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `period_month` | TEXT | Có | `YYYY-MM`, CHECK regex |
| `pay_date` | DATE | Không | ghi cứng lúc tạo từ `payroll_config_json.payDay` |
| `status` | TEXT | Có | 7 giá trị (SPEC-01 §17.15), default `Draft`; FSM ở SPEC-11 §13.1 |
| `attendance_period_id` | UUID | Không | composite FK → `attendance_periods (company_id, id)` NO ACTION; phải `locked` trước khi tính |
| `note` · `reopen_reason` | TEXT | Không | lý do mở lại (bắt buộc ở service) |
| `created_by` `updated_by` `calculated_by/at` `submitted_by/at` `approved_by/at` `published_by/at` `locked_by/at` | | | vết đầy đủ vòng đời; **reset theo bảng RESET của SPEC-11 §13.1** |
| `payslips_generated_by` `payslips_generated_at` | | | **cờ đã-sinh-phiếu** — nguồn kiểm DUY NHẤT của `reopen`/`publish`, đọc **dưới row-lock** trên chính hàng này. KHÔNG đếm bảng `payslips` (bảng khác không được row-lock bảo vệ) — SPEC-11 §13.1 |
| `created_at` `updated_at` `deleted_at` | | | soft delete |

```sql
-- CHECK (đổi/thêm)
chk status IN ('Draft','CollectingData','Calculated','Reviewing','Approved','Paid','Locked')
chk payroll_periods_approved_pair_check    status NOT IN ('Approved','Paid','Locked') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
chk payroll_periods_published_pair_check   status NOT IN ('Paid','Locked') OR (published_by IS NOT NULL AND published_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
chk payroll_periods_locked_pair_check      status <> 'Locked' OR (locked_by IS NOT NULL AND locked_at IS NOT NULL)
chk payroll_periods_four_eyes_check        approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by
chk payroll_periods_calculated_needs_attendance_check  status IN ('Draft','CollectingData') OR attendance_period_id IS NOT NULL
chk payroll_periods_generated_pair_check   (payslips_generated_by IS NULL) = (payslips_generated_at IS NULL)
ALTER TABLE payroll_periods ADD CONSTRAINT payroll_periods_company_id_id_uq UNIQUE (company_id, id);
-- GIỮ: payroll_periods_company_month_uq, payroll_periods_month_check, payroll_periods_company_id_idx
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. **Không trigger.**

### 6.4 `payroll_period_lines` — bảng lương NHÁP *(bảng MỚI)*

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `payroll_period_id` | UUID | Có | composite FK NO ACTION |
| `user_id` | UUID | Có | composite FK NO ACTION |
| `salary_profile_id` | UUID | Không | phiên bản lương đã dùng — vết giải thích; composite FK NO ACTION |
| `work_days` `present_days` `paid_leave_days` `unpaid_leave_days` | numeric(8,2) | Có | default 0 |
| `late_minutes` | INTEGER | Có | default 0 |
| `input_snapshot_json` | jsonb | Có | ảnh chụp đầu vào lúc `calculate` (SPEC-11 §3.4) |
| `base_amount` `allowance_amount` `bonus_amount` `penalty_amount` `deduction_amount` `adjustment_amount` `gross` `net` | numeric(18,2) | Có | default 0; tính ở SQL |
| `adjustment_amount` | numeric(18,2) | Có | default 0, **CÓ DẤU** (dương = truy lĩnh · âm = truy thu); nằm NGOÀI `gross`/`deduction` |
| `adjustment_reason` | TEXT | Không | **bắt buộc khi `adjustment_amount <> 0`** (CHECK) |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete (tính lại = upsert + xoá mềm dòng không còn đủ điều kiện) |

```sql
CREATE UNIQUE INDEX payroll_period_lines_period_user_uq
  ON payroll_period_lines (company_id, payroll_period_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX payroll_period_lines_company_period_idx ON payroll_period_lines (company_id, payroll_period_id) WHERE deleted_at IS NULL;
CREATE INDEX payroll_period_lines_company_user_idx   ON payroll_period_lines (company_id, user_id);
chk payroll_period_lines_amounts_check      base_amount >= 0 AND allowance_amount >= 0 AND bonus_amount >= 0
                                            AND penalty_amount >= 0 AND deduction_amount >= 0 AND gross >= 0 AND net >= 0
--   ⚠️ adjustment_amount CỐ Ý ngoài CHECK này — nó CÓ DẤU. net = GREATEST(gross − deduction_amount + adjustment_amount, 0)
chk payroll_period_lines_adjustment_check   adjustment_amount = 0 OR adjustment_reason IS NOT NULL
ALTER TABLE payroll_period_lines ADD CONSTRAINT payroll_period_lines_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. RLS ENABLE + FORCE + policy literal-GUC (khuôn `0549`/`0559`) **trước** mọi INSERT.

### 6.5 `payslips` — phiếu lương *(append-only)*

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `payroll_period_id` · `user_id` | UUID | Có | composite FK NO ACTION |
| `salary_profile_id` | UUID | Không | phiên bản lương đã dùng |
| `base_salary` `total_allowances` `bonus_amount` `penalty_amount` `deduction_amount` `gross` `net` | numeric(18,2) | Có | copy đóng băng từ dòng nháp |
| `adjustment_amount` | numeric(18,2) | Có | default 0, **CÓ DẤU** (dương = truy lĩnh · âm = truy thu) — nằm NGOÀI `gross`/`deduction`; thiếu cột này thì khoản điều chỉnh tay **biến mất hoặc bị cộng hai lần** lúc `generate-payslips` |
| `work_days` `present_days` `paid_leave_days` `unpaid_leave_days` | numeric(8,2) | Có | default 0 |
| `late_minutes` | INTEGER | Có | default 0 |
| `input_snapshot_json` | jsonb | Có | **không DEFAULT** — mọi INSERT phải ghi tường minh (CHECK dưới) |
| `created_by` `created_at` | | Có | **không** `updated_at`/`deleted_at` — append-only |

```sql
ALTER TABLE payslips ADD CONSTRAINT payslips_period_user_uq UNIQUE (company_id, payroll_period_id, user_id);
ALTER TABLE payslips ADD CONSTRAINT payslips_company_id_id_uq UNIQUE (company_id, id);
chk payslips_amounts_check   base_salary >= 0 AND total_allowances >= 0 AND deduction_amount >= 0 AND gross >= 0 AND net >= 0
--   ⚠️ adjustment_amount CỐ Ý KHÔNG có CHECK >= 0 — nó có dấu (SPEC-11 §13.4)
chk payslips_snapshot_check  input_snapshot_json <> '{}'::jsonb   -- "đóng băng" rỗng là snapshot giả
--   ⚠️ CHECK này + KHÔNG có DEFAULT là một cặp: để DEFAULT '{}' thì mọi INSERT bỏ trống cột đều 23514
--      (DEFAULT thành giá trị CHẾT). Mọi fixture/test INSERT payslips phải kèm snapshot khác {} — §10.1.
-- GIỮ: payslips_company_period_user_idx, payslips_company_user_idx
```

GRANT app: **`SELECT, INSERT` duy nhất** (không UPDATE/DELETE — bất biến #2).

### 6.6 `payslip_items` — dòng chi tiết phiếu *(append-only)*

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` · `payslip_id` | UUID | Có | composite FK NO ACTION |
| `item_type` | TEXT | Có | `earning`/`deduction`/`allowance`/`attendance`/`bonus`/`penalty`/**`adjustment`** (7 giá trị) |
| — | — | — | **`amount` CÓ DẤU**: earning/allowance/bonus dương · deduction/attendance/penalty âm · `adjustment` theo dấu người nhập ⇒ bất biến kiểm được `SUM(amount) = gross − deduction_amount + adjustment_amount` |
| `label` | TEXT | Có | nhãn hiển thị («Lương cơ bản pro-rate 18/22 ngày», «Phụ cấp ăn trưa», …) |
| `amount` | numeric(18,2) | Có | |
| `sort_order` | INTEGER | Có | default 0 |
| `meta` | jsonb | Không | |
| `created_at` | | Có | |

GRANT app: **`SELECT, INSERT` duy nhất**.

### 6.7 `bonus_penalties` — thưởng/phạt/khấu trừ theo kỳ

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` · `user_id` | UUID | Có | composite FK |
| `kind` | TEXT | Có | `bonus` / `penalty` |
| `amount` | numeric(18,2) | Có | CHECK `> 0` (không dùng số âm — tránh lỗi dấu) |
| `period_month` | TEXT | Có | `YYYY-MM`, CHECK regex — kỳ đích |
| `reason` | TEXT | **Có** | lý do bắt buộc |
| `status` | TEXT | Có | `Pending`/`Approved`/`Rejected` (SPEC-01 §17.17), default `Pending` |
| `decided_by` `decided_at` `decision_note` | | Không | reject bắt buộc `decision_note` (CHECK) |
| `payroll_period_id` `consumed_at` | | Không | cặp NULL/NOT NULL — bind kỳ đã gộp |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
chk bonus_penalties_status_check          status IN ('Pending','Approved','Rejected')
chk bonus_penalties_decided_pair_check    status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
chk bonus_penalties_reject_note_check     status <> 'Rejected' OR decision_note IS NOT NULL
chk bonus_penalties_consume_approved_check payroll_period_id IS NULL OR status = 'Approved'
-- GIỮ: kind_check, amount_check, month_check, consumed_pair_check + 4 index
ALTER TABLE bonus_penalties ADD CONSTRAINT bonus_penalties_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. **Không trigger.**

### 6.8 `payslip_acknowledgements` — sổ xác nhận *(chỉ-INSERT)*

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` · `payslip_id` · `user_id` | UUID | Có | composite FK NO ACTION |
| `created_at` | | Có | **hàng tồn tại = đã xác nhận** (không có cột trạng thái) |

GRANT app: **`SELECT, INSERT`** (REVOKE UPDATE di sản). Unique `(company_id, payslip_id, user_id)` là chốt cuối PAYROLL-ERR-015 `already-acknowledged`.

---

## 7. Enum chuẩn (đồng bộ `packages/contracts/src/payroll.ts` — mirror CHECK HAI CHIỀU, ĐÚNG BẰNG)

> ⚠️ File `packages/contracts/src/payroll.ts` **đã tồn tại** với DTO hướng cũ (`salaryTypeEnum`, `payCycleEnum`, `payrollPeriodStatusEnum` 3 giá trị chữ thường, `payslipEntryKindEnum`, `bonusSourceEnum`, `bonusReferenceTypeEnum`, `payslipAckStatusEnum`, `payslipReauthSchema`…). WO DB **viết lại toàn bộ**, gỡ các enum không còn CHECK tương ứng — enum Zod không có CHECT đối ứng là mã chết, enum thiếu là 500 ở DB.

| Nhóm | Giá trị | CHECK |
| --- | --- | --- |
| payroll period status (SPEC-01 §17.15) | `Draft` · `CollectingData` · `Calculated` · `Reviewing` · `Approved` · `Paid` · `Locked` | `payroll_periods_status_check` |
| payslip status (SPEC-01 §17.16) | `Generated` · `Published` · `Acknowledged` — **DẪN XUẤT, KHÔNG có cột, KHÔNG có CHECK** (SPEC-11 §13.2) | *(không)* |
| bonus/penalty status (SPEC-01 §17.17) | `Pending` · `Approved` · `Rejected` | `bonus_penalties_status_check` |
| bonus/penalty kind | `bonus` · `penalty` | `bonus_penalties_kind_check` |
| payslip item type | `earning` · `deduction` · `allowance` · `attendance` · `bonus` · `penalty` · **`adjustment`** (**7 giá trị**) | `payslip_items_type_check` |
| payslip item **dấu** | `amount` **CÓ DẤU**: earning/allowance/bonus dương · deduction/attendance/penalty âm · `adjustment` theo dấu người nhập ⇒ bất biến `SUM(amount) = gross − deduction_amount + adjustment_amount` | *(không CHECK — `0096` vốn không ràng buộc dấu; ép ở service + ca test §21)* |
| period month | `^\d{4}-(0[1-9]\|1[0-2])$` | `payroll_periods_month_check` · `bonus_penalties_month_check` |
| **GỠ khỏi contracts** | ~~`salaryTypeEnum`~~ ~~`payCycleEnum`~~ ~~`salaryProfileStatusEnum`~~ ~~`payslipEntryKindEnum`~~ ~~`bonusSourceEnum`~~ ~~`bonusReferenceTypeEnum`~~ ~~`payslipAckStatusEnum`~~ ~~`payslipReauthSchema`~~ | CHECK tương ứng đã bị GỠ ở §5 |

**Trường tiền trong DTO khai `.optional()`** (server mask = **vắng khoá**, không `null`, không `0`) — `server-masking-needs-optional-fe-schema`.

---

## 8. Index theo use case

| Use case | Index dùng |
| --- | --- |
| Danh sách kỳ lương lọc trạng thái/tháng (`PAYROLL-API-001`) | `payroll_periods_company_id_idx` · `payroll_periods_company_month_uq` |
| Bảng lương nháp theo kỳ (`PAYROLL-API-008`) · tổng chi phí (`018`) | `payroll_period_lines_company_period_idx` (`GROUP BY` một lần) |
| Phiếu lương theo kỳ / theo người (`029`) | `payslips_company_period_user_idx` · `payslips_company_user_idx` |
| «Phiếu lương của tôi» (`031`/`032` — Own) | `payslips_company_user_idx` |
| Breakdown phiếu (`030`/`032`) | `payslip_items_company_payslip_idx` |
| Hồ sơ lương hiệu lực tại ngày X (máy tính lương §13.4) | `salary_profiles_user_id_idx` (`(company_id, user_id)`) + lọc `effective_date <= X ORDER BY effective_date DESC` |
| Gộp thưởng/phạt khi tính (`period_month` + chưa consume) | `bonus_penalties_company_user_month_idx` · `bonus_penalties_company_status_idx` |
| Xác nhận phiếu (`033`) | `payslip_acknowledgements_payslip_user_uq` |
| Chốt cuối chống sinh phiếu hai lần | `payslips_period_user_uq` |
| Chốt cuối phiên bản lương trùng ngày | `salary_profiles_company_user_effective_uq` |

> Cô lập tenant ép ở RLS + FORCE; mọi index dẫn đầu bằng `company_id`. Máy tính lương chạy **set-based** (một câu lệnh cho cả kỳ) — **không** vòng lặp per-người ở JS (§19 SPEC-11).
>
> ⚠️ Đừng assert `Index Scan` trong test: `FORCE RLS` giấu biểu thức không-leakproof khỏi `Index Cond`, và planner đổi kế hoạch theo số hàng (`rls-force-hides-nonleakproof-expr-from-index-cond`, `pg-planner-index-assert-trap`, `idx-scan-zero-is-not-unused`).

---

## 9. Đối chiếu bất biến

| Bất biến | Áp dụng trong DB-13 |
| --- | --- |
| #1 `company_id` + RLS FORCE | cả 7 bảng (6 di sản **verify lại**, 1 mới tạo policy trước INSERT); composite tenant FK **bổ sung** cho toàn band G12; `withTenant` ở repo; own-scope phiếu lương ép ở service |
| #2 append-only / soft delete | `payslips` · `payslip_items` giữ nguyên `SELECT+INSERT`; `payslip_acknowledgements` **REVOKE UPDATE** về cùng khuôn; **không bảng nào có DELETE**; `salary_profiles`/`payroll_periods`/`bonus_penalties`/`payroll_period_lines` soft delete. Cập nhật danh sách bảng append-only ở `erd-current` §9 khi build |
| #3 không secret / dữ liệu nhạy cảm | module không lưu secret; **mọi trường tiền mask ở server** (13 cặp sensitive); payload NOTI/audit **không có số tiền**; role `payroll-officer` **bắt buộc 2FA** |

---

## 10. Seed & kế hoạch migration (`0564+` dự kiến, lane DB nối tiếp)

| Bước | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- |
| **0** (không phải migration) | **ĐO**: `SELECT count(*)` 6 bảng di sản (kỳ vọng 0 — **≠ 0 thì DỪNG, báo người**) · `pg_constraint`/`pg_index`/`pg_trigger` hiện trạng 6 bảng · `aclexplode` GRANT thật của `mediaos_app`/`mediaos_worker` · `permissions ⋈ role_permissions ⋈ roles` **VÀ `permissions ⋈ object_permissions`** cho **19 cặp** họ lương (SPEC-11 §11.2) — ⚠️ `object_permissions.permission_id` là `ON DELETE CASCADE` (`0005:154`), xoá cặp sẽ **cascade xoá âm thầm** hàng object-grant mà không ai đo · `_journal.json` `max(idx)` · `attendance_periods` đã có `UNIQUE (company_id, id)` chưa · dải `NOTI-EVENT-0` · giá trị hiện có trong CHECK `audit_logs.object_type` | **GRANT/grant trong migration cũ ≠ hiện trạng** — mọi lệnh dưới đây viết theo số ĐO được |
| **A** (`0564`) | **Reconcile DDL 6 bảng + tạo `payroll_period_lines`** theo §5/§6: DROP 3 trigger + 3 function · GỠ **20** cột (liệt kê CHECK chết theo, **dựng lại** `payslips_amounts_check`) · ĐỔI 6 CHECK + RENAME 2 cột · THÊM cột/CHECK/unique mới · thêm `UNIQUE (company_id, id)` ở 5 bảng đích + `attendance_periods` (nếu thiếu) · **ĐỔI toàn bộ FK đơn cột → composite tenant FK** theo §4.2 · tạo `payroll_period_lines` (RLS ENABLE+FORCE + policy **trước** INSERT + GRANT) · **REVOKE UPDATE** trên `payslip_acknowledgements` · đăng ký `rls-registry` · **VERIFY fail-loud** (khuôn `0549`/`0559`): 7 bảng `relrowsecurity AND relforcerowsecurity` + policy tồn tại; app role **0 quyền UPDATE/DELETE** trên `payslips`/`payslip_items`/`payslip_acknowledgements`, **0 DELETE** trên cả 7 bảng; tập cột UPDATE so bằng **`aclexplode`** (KHÔNG `information_schema.column_privileges`); verify **DƯƠNG đúng-bằng** số composite FK qua `pg_constraint`; verify 3 trigger cũ đã biến mất **và** trigger hẹp `bonus_penalty_freeze_guard` đã tồn tại; verify **20** cột đã biến mất; **RENAME index `bonus_penalties_approved_by_idx` → `bonus_penalties_decided_by_idx`** bằng lệnh tường minh (kẻo tên index nói dối tên cột sau RENAME cột) · **THU HỒI `SELECT` của `mediaos_worker`** trên `salary_profiles`/`payroll_period_lines`/`payslips`/`payslip_items` (§4.3) · **cùng commit**: `apps/api/src/db/schema/payroll.ts` parity + `payroll_period_lines` thêm vào `apps/api/test/helpers/seed.ts` `cleanupTenants()` đúng thứ tự con→cha (`payslip_acknowledgements` → `payslip_items` → `payslips` → `payroll_period_lines` → `bonus_penalties` → `payroll_periods` → `salary_profiles`) và **trước dòng `DELETE FROM users`** · thêm `payslip_acknowledgements` + `payroll_period_lines` vào `RetentionService.PROTECTED_TABLES` (+ danh sách trong `retention.service.spec.ts`) · **sửa 6 file test/fixture/seed di sản (bảng ngay dưới)** | RLS TRƯỚC mọi INSERT (bất biến #1); `fk-tenant-census`/`xtenant-fk-ratchet` không đỏ; thiếu `cleanupTenants` = đỏ hàng loạt `afterAll` (`drop-table-must-clean-test-teardown`) |
| **B** (`0565`) | **Module + role + THU HỒI quyền di sản + seed §9g**: (1) `modules.PAYROLL` — hàng **ĐÃ TỒN TẠI** từ `0435` ⇒ chỉ **verify tồn tại và GIỮ `is_active=false`**; guard **forward-compatible** (chỉ RAISE khi hàng **không tồn tại**, KHÔNG RAISE khi `is_active=true` — kẻo chính `S13-PAYROLL-FE-1` bật cờ xong là migration này đỏ trên DB mới; bài học `module-enable-guard-blocks-next-wo` 0550/0554/0560); pin `migration-smoke` `EXTENSION_INACTIVE_MODULES` giữ `PAYROLL` · (2) role hệ thống **`payroll-officer`** id `…0015` (`company_id NULL`, `is_system=true`, **`requires_two_factor=TRUE`**, `ON CONFLICT DO NOTHING`) — **kiểm trước** id `…0015` chưa thuộc role khác rồi mới INSERT (khuôn `0560` MED-3) · (3) **THU HỒI (ba bảng, không phải hai)**: `DELETE FROM object_permissions` + `DELETE FROM role_permissions` mọi hàng trỏ **16 cặp GỠ** → `DELETE FROM permissions` 16 cặp đó. **Và với 3 cặp GIỮ**: `DELETE FROM role_permissions` + **`DELETE FROM object_permissions`** của `hr-manager` (`…0009`) trên `view-payslip` (cặp này *giữ ngữ nghĩa object-permission override* — thu hồi chỉ ở `role_permissions` là để lại đường đọc phiếu lương sống trong khi verify vẫn XANH); `DELETE` grant `company-admin` + `hr-manager` trên `acknowledge-own-payslip` · (4) seed **17 cặp §9g** (`ON CONFLICT (action, resource_type) DO NOTHING`; **13 cặp `is_sensitive=TRUE`**) + grant per-(role, pair) **32 hàng** (DELETE-wrong-scope + INSERT ON CONFLICT) · (5) **VERIFY fail-loud**: đúng 32 hàng grant PAYROLL; **`hr-manager` = 0 cặp PAYROLL trên CẢ BA bảng `permissions`/`role_permissions`/`object_permissions`**; 16 cặp GỠ = 0 hàng ở **cả ba** bảng; **mọi role giữ `('manage','bonus-penalty')` đều giữ `('view','salary-profile')`** (điều kiện picker `PAYROLL-API-034`); **mọi role giữ `('approve','payroll-period')` đều giữ `('view-line','payroll-period')`** (kẻo người duyệt «duyệt mù») **và mọi role giữ `('calculate','payroll-period')` đều giữ `('view-line','payroll-period')`** (kẻo route GHI phải chở tiền — SPEC-11 §11.1); census grant phủ **bốn hình dạng wildcard** (`permission-grant-census-must-cover-four-wildcard-shapes`) · (6) **UNION-ADD** vào CHECK `audit_logs.object_type` **chỉ giá trị CÒN THIẾU** trong `('payroll_period','salary_profile','bonus_penalty','payslip')` — 4 giá trị này **đã có sẵn từ band G12** (`0090`/`0093`/`0099`), ĐO trước; nếu đủ cả 4 thì bước này **NO-OP có chủ đích**, ghi `RAISE NOTICE`, KHÔNG viết ALTER rỗng (**clone nguyên khối `0545`** khi cần thêm — neo 2 tầng, fail-closed, NO-LOSS/NO-GAIN, KHÔNG clone `0506`; bẫy `audit-check-union-parse-anchor-trap`) + `AUDIT_OBJECT_TYPES` cùng commit | `super-admin` KHÔNG enumerate (bootstrap). `payroll-officer` **không** canonical (`DashCanonicalRole`/`NOTI_CANONICAL_ROLES`/pin `auth-seed-canonical-roles` giữ 4 role). 13 cặp sensitive ⇒ WO BE khai **allowlist capability BACKEND** trước khi FE render màn quản trị. ⚠️ Thu hồi **phải chạy TRƯỚC** seed cặp mới trong cùng migration (một số cặp cũ/mới trùng `resource_type`) |
| **C** (`0566`) | **Seed NOTI**: 4 event `PAYROLL_PERIOD_SUBMITTED` · `PAYROLL_PERIOD_APPROVED` · `PAYROLL_PERIOD_REJECTED` · `PAYSLIP_PUBLISHED` vào `notification-event-catalog.const.ts` (`module:'PAYROLL'`, `type:'Payroll'`, `isEnabled:true`, `isSystemEvent:false`) + `notification_events` với **`dedupe_strategy='DedupeKey'`, `dedupe_window_seconds=NULL`** cả 4 (mặc định `'None'` làm tầng dedupe biến mất — `0538:707`) · INSERT dùng `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (bare ⇒ `42P10`) · template · **nới CHECK trên CẢ HAI bảng**: `notification_events` (`module_code += 'PAYROLL'`, `notification_type += 'Payroll'`) **VÀ** `notifications` (cùng hai CHECK, giữ nhánh `IS NULL OR`) — guard LIKE + re-stamp superset tường minh khuôn `0507`/`0529`/`0538`/`0551`/`0555`/`0561`, **baseline guard forward-compatible** (không RAISE khi module SAU đã nới thêm — `noti-check-baseline-guard-must-be-forward-compatible`) | PHẢI merge **TRƯỚC** khi `S13-PAYROLL-BE-2` đăng ký registrar outbox (`registerSource()` fail-loud lúc boot). Quên vế `notifications` = lỗi đã ship `0507` |

### 10.1 Test · fixture · seed DI SẢN phải sửa CÙNG COMMIT với bước A — **6 file**

> Đo 31/08/2026. Sáu file dưới đây đọc/ghi đúng những cột, giá trị và GRANT mà §5 gỡ ⇒ **sẽ đỏ ngay lần chạy đầu**. **SỬA, KHÔNG XOÁ** — trong đó `payslip-appendonly.int-spec.ts` là ca **ghim bất biến #2**, xoá nó là tháo chốt an toàn (bẫy `tests-can-pin-a-hole-open`). Hai file `apps/api/demo-seed-full.mjs` và `apps/api/src/foundation/retention/**` **phải được thêm vào `paths` của `S13-PAYROLL-DB-1`** trong `harness/backlog.mjs`, nếu không hook `guard-scope` sẽ cảnh báo ra-ngoài-phạm-vi giữa lane đỏ.

| File | Vì sao đỏ | Sửa thành |
| --- | --- | --- |
| `apps/api/test/integration/bonus-penalty-transition.int-spec.ts` | dựa trigger `bonus_penalty_guard`, `status` chữ thường, `reference_type`/`task_id`, `currency` — §5.5 gỡ hết | giữ ca **đóng băng field tiền** (chuyển sang trigger hẹp `bonus_penalty_freeze_guard` + giá trị PascalCase); ca **chuyển tiếp FSM** chuyển lên tầng service (PAYROLL-ERR-011/012/013); bỏ ca `reference_type`/`currency` |
| `apps/api/test/integration/payslip-acknowledgement-transition.int-spec.ts` | 100% dựa `status`/`reason`/`resolved_*` + trigger + **GRANT UPDATE** — §5.6 gỡ hết + REVOKE UPDATE | thay bằng ca **sổ chỉ-INSERT**: app role `UPDATE`/`DELETE` trên `payslip_acknowledgements` bị **DB từ chối**; unique `(company, payslip, user)` chặn xác nhận lần hai |
| `apps/api/test/integration/payslip-appendonly.int-spec.ts` | INSERT có `entry_kind` (cột bị GỠ) | **giữ nguyên mục đích** (ghim append-only), chỉ bỏ cột `entry_kind` khỏi payload INSERT và thêm ca `payslips_period_user_uq` chặn sinh hai lần |
| `apps/api/test/integration/rls-registry.ts` | fixture INSERT `payroll_periods … 'draft'` và `payslips … entry_kind` ⇒ `rls-guards.int-spec` đỏ cho 3 bảng | đổi `'draft'` → `'Draft'`, bỏ `entry_kind`, thêm fixture cho `payroll_period_lines` |
| `apps/api/test/integration/pgbouncer-tenant-isolation.int-spec.ts` | INSERT `payroll_periods … 'draft'` **và** `payslips … entry_kind='original'` (`:155-164`) ⇒ đỏ vì **ba** lý do: CHECK status PascalCase · cột `entry_kind` đã GỠ · thiếu `input_snapshot_json` (CHECK + không DEFAULT). Đây là spec **cô lập tenant nền** | `'draft'→'Draft'`, bỏ `entry_kind`, thêm `input_snapshot_json` khác `{}` |
| `apps/api/demo-seed-full.mjs` | seed demo/PROD dùng `salary_type`/`pay_cycle`/`currency`/`status`/`entry_kind`/`'published'` | cập nhật theo hình dạng §6; nếu không còn muốn seed lương ở demo thì **gỡ khối đó tường minh**, không để nửa vời |

> ⚠️ **Mọi INSERT `payslips` trong test/fixture/seed phải kèm `input_snapshot_json` khác `{}`** — cột này NOT NULL, **không DEFAULT**, và có CHECK (§6.5). Đo 31/08/2026, `INSERT INTO payslips` toàn repo nằm ở **đúng 5 file** — cả 5 đều đã có trong bảng trên: `payslip-appendonly.int-spec.ts` · `rls-registry.ts` · `pgbouncer-tenant-isolation.int-spec.ts` · `payslip-acknowledgement-transition.int-spec.ts` · `demo-seed-full.mjs`. Đây là lý do đỏ **thứ ba** của chúng — không chỉ `entry_kind`.
>
> ✅ **Đã kiểm, KHÔNG cần sửa:** `apps/api/test/integration/salary-profile-tenant-isolation.int-spec.ts` — chỉ dùng `company_id`/`user_id`/`effective_date`/`base_salary`, đều sống sót qua §5.1.

Giá trị superset hiện hành để re-stamp (đo tại `0561`, **xác minh lại lúc chạy**):

```text
module_code       : 'AUTH','HR','ATT','LEAVE','TASK','DASH','NOTI','SYSTEM','GOAL','LMS','CHAT','ASSET','ROOM','RECRUIT'  (+ 'PAYROLL')
notification_type : … 'Goal','Training','Chat','Asset','Room','Recruit' …                                                  (+ 'Payroll')
```

Ma trận grant §9g (bước B) — **32 hàng**: `employee` **3** (`access:payroll`@Own · `view-own-payslip`@Own · `acknowledge-own-payslip`@Own) · `manager` **0** · `hr` **0** · `hr-manager` **0** · `payroll-officer` **14** (`access`@Own + 13 cặp @Company, **KHÔNG** `approve:payroll-period`) · `company-admin` **15** (`access`@Own + 14 cặp @Company). Sai một hàng verify phải ĐỎ.

**KHÔNG có bước D cho widget DASH**: toàn bộ seed widget «chi phí lương kỳ» (hàng catalog + cặp gác + **sàn scope** `DASH_WIDGET_MIN_DATA_SCOPE` + slug FE `DashboardWidgetGrid`) thuộc **`S13-PAYROLL-DASH-1`** với migration riêng theo khuôn `0558`/`0563` — cố ý tách khỏi WO DB để wave ship BE/FE/QA trước khi chốt widget (`dash-widget-gate-needs-scope-floor` · `fe-widget-slug-map-is-unchecked-runtime-gate`).

Số migration là **dự kiến** — nối tiếp head THẬT tại thời điểm chạy WO.

---

## 11. Rủi ro dữ liệu đã nhận diện

| Rủi ro | Vì sao nguy hiểm | Chốt chặn |
| --- | --- | --- |
| **`DROP COLUMN` giết CHECK trong im lặng** | **20** cột bị gỡ kéo theo 11 CHECK; để trần là mất bất biến mà không ai biết | §5 liệt kê **tường minh** từng CHECK chết theo; `payslips_amounts_check` **dựng lại** có kiểm soát; verify fail-loud đếm `pg_constraint` sau khi chạy (`drop-column-silently-drops-check`) |
| **Ba trigger di sản ép FSM cũ** | `payroll_period_status_guard` chỉ cho `draft→approved→published` (chữ thường) ⇒ **mọi** chuyển tiếp mới bị `check_violation`; `bonus_penalty_guard` chặn `Pending`; `payslip_ack_status_guard` đọc cột vừa gỡ | Bước A **DROP cả 3 trigger + 3 function**; verify `pg_trigger` = 0; FSM ép ở service (§4.4) |
| **6 bảng có dữ liệu thật khi chạy** | mọi lệnh GỠ cột giả định 0 hàng; có hàng ⇒ mất dữ liệu lương | Bước 0 ĐO `count(*)`; **≠ 0 ⇒ DỪNG, báo người** — không tự quyết backfill lương |
| **Grant di sản rộng hơn hồ sơ ghi tay** | `approve-payroll-period`/`publish-payroll-period` để `is_sensitive=false` ⇒ **ăn theo wildcard `*:*`**; 4 cặp `payslip` của `0005` đã blanket-grant | SPEC-11 §11.2 bản đồ 19 cặp; bước B thu hồi **mọi** hàng `role_permissions` trỏ 16 cặp GỠ, không chỉ của `hr-manager`; verify `hr-manager` = 0 cặp |
| **Thu hồi đọc từ migration thay vì DB** | GRANT trong file cũ ≠ hiện trạng (role bị xoá/thêm sau đó) | Bước 0 đọc `permissions ⋈ role_permissions ⋈ roles` **trên DB thật** (`grant-in-old-migration-is-not-current-state`) |
| **Xoá `view-payslip` "cho sạch"** | `permission-admin.int-spec.ts` dùng cặp này làm ví dụ object-permission ⇒ đỏ test không liên quan | §5/§11.2: cặp này **GIỮ**, chỉ thu hồi grant `hr-manager` |
| Tính lương bằng số thực JS | sai số cộng dồn ⇒ lệch từng đồng trên hàng trăm phiếu | §4.5: `numeric(18,2)`, cộng/trừ/pro-rate/làm tròn/`GREATEST` **ở SQL**; fixture đối soát tay khớp từng đồng |
| Hai lần `generate-payslips` | trả lương hai lần | `payslips_period_user_uq` (UNIQUE thẳng) + `SELECT … FOR UPDATE` hàng kỳ; race map 409 **006** (bóc `23505` từ `cause` — drizzle bọc lỗi) |
| Thưởng/phạt cộng hai lần | một khoản thưởng vào hai kỳ | cặp `payroll_period_id`/`consumed_at` + `bonus_penalties_consume_approved_check`; tính lại **nhả rồi gộp lại** trong cùng tx, không đụng hàng consume bởi kỳ khác |
| `reopen` sau khi đã sinh phiếu | phiếu bất biến còn đó nhưng bảng lương đổi ⇒ hai nguồn sự thật | PAYROLL-ERR-004 ở service + ca test; DB không ép được (cần đếm bảng khác) |
| Four-eyes chỉ kiểm ở service | một bug ở service là một người tự duyệt lương của chính mình | CHECK `payroll_periods_four_eyes_check` là **chốt cuối ở DB**; cặp `approve` **không grant** cho `payroll-officer` (tầng quyền) |
| Snapshot không đóng băng | ATT/LEAVE đổi sau khi tính ⇒ phiếu đã phát hành nói dối | `input_snapshot_json` ghi lúc `calculate`; `payslips` copy đóng băng lúc generate; ca test đổi nguồn sau khi tính |
| `SET NULL` trên FK composite / trên bảng chỉ-INSERT | `SET NULL` cả `company_id` (nổ NOT NULL) / ghi đè cột không có grant UPDATE | §4.2: `SET NULL (col)` **liệt kê cột**, chỉ ở bảng mutable; `payslips`/`payslip_items`/`payslip_acknowledgements` dùng `NO ACTION` |
| `attendance_periods` thiếu `UNIQUE (company_id, id)` | composite FK không tạo được | Bước 0 ĐO; bước A THÊM (additive, không đổi dữ liệu ATT) |
| Thêm `payroll-officer` vào enumerate canonical | pin `auth-seed-canonical-roles`/`DashCanonicalRole` đỏ | §10 bước B ghi rõ **không** canonical |
| `dedupe_strategy` để `'None'` | `dedupeKey` thành chuỗi trang trí | §10 bước C: `'DedupeKey'` ngay seed đầu cho cả 4 |
| Quên nới CHECK `notifications` | mọi notification PAYROLL vỡ khi INSERT | bước C làm **cả hai bảng** cùng migration, verify fail-loud |
| Contracts cũ còn enum không có CHECK | Zod nhận payload DB từ chối (500) hoặc chặn oan | §7: **viết lại** `packages/contracts/src/payroll.ts`, mirror hai chiều đúng bằng, gỡ 8 enum/schema di sản |
| Quên `cleanupTenants` bảng mới | đỏ hàng loạt kiểu `drop-table-must-clean-test-teardown` | §10 bước A cùng commit, thứ tự con→cha, trước `DELETE FROM users` |
| **`reopen`/`reject` không xoá vết duyệt** | `approve → reopen → cùng người submit lại` vi phạm CHECK four-eyes ⇒ **`23514` = 500 ở vùng đỏ**; xoá sai vế thì `approved_pair_check` nổ | **Bảng RESET vết duyệt** ở SPEC-11 §13.1 là bắt buộc; service map `23514` (four-eyes) → **409 PAYROLL-ERR-005** |
| **Row-lock chỉ có ở `calculate`** | `generate-payslips ‖ reopen` ⇒ kỳ về `CollectingData` mà đã có `payslips` ⇒ phiếu không mang trạng thái dẫn xuất nào **và** mọi `generate` sau đều 409 vĩnh viễn (phiếu append-only, UNIQUE thẳng) | **MỌI** hành động đổi trạng thái mở tx với `SELECT … FOR UPDATE` trên hàng kỳ; `reopen`/`publish` đọc cờ `payslips_generated_at` **trên chính hàng đó**, không đếm bảng `payslips` |
| **Gỡ trắng trigger `bonus_penalty_guard`** | mất lớp DB đóng băng `amount` sau khi duyệt/consume — CHECK không so được OLD/NEW ⇒ một bug service là đổi tiền sau duyệt, im lặng | §5.5: DROP bản cũ (ép FSM chữ thường) rồi **DỰNG LẠI bản hẹp** chỉ đóng băng field tiền |
| **Test/fixture/seed di sản đỏ giữa lane đỏ** | WO migration bị cám dỗ **xoá** `payslip-appendonly.int-spec.ts` — ca ghim bất biến #2 | §10.1 liệt kê **6** file + assertion thay thế; `paths` của WO DB phải chứa `apps/api/demo-seed-full.mjs` và `apps/api/src/foundation/retention/**` |
| **DROP FK đơn cột "để thay bằng composite"** | `FK_SINGLE_COL_PAIRS_FLOOR` tụt ⇒ ratchet đỏ ⇒ hạ sàn cho qua = mất cổng | §4.2: **ADD composite, GIỮ đơn cột**; sàn chỉ hạ đúng bằng 2 FK biến mất theo cột GỠ, có đo hai lane |
| **Retention hard-delete bảng không có GRANT DELETE** | `42501` uncaught làm hỏng **cả lượt cleanup tenant** (comment trong `retention.service.ts` nói rõ) | §10 bước A: thêm `payslip_acknowledgements` + `payroll_period_lines` vào `PROTECTED_TABLES` |

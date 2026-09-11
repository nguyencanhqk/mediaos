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
| Phiên bản | **v2.0** — **Approved** cùng SPEC-11 v2 (owner ký PAY-DEC-011..020 ngày 02/09/2026). v1.0 (§1–§11) **giữ nguyên**; phần v2 là **§12–§15**, thêm vào cùng file theo PAY-DEC-011 |
| Ngày tạo / cập nhật | 31/08/2026 / **11/09/2026** (`S15-PAYROLL-DOC-1` viết §12–§15) |
| Head migration lúc viết | v1: idx 230 / `0563_…` ⇒ lô v1 `0564–0568` **đã viết**. **v2: đo 11/09/2026 = idx 236 / `0569_s14recruitfilegrant1_candidate_file_perm`** ⇒ lô v2 dự kiến **`0570+`** *(PAY-DEC-011 ghi «0569+» — đã lỗi thời, `0569` bị S14 lấy)* |
| Giai đoạn | Phase 2 «HR nâng cao» · v1 = wave S13-PAYROLL · **v2 = wave S15-PAYROLL-V2** — hậu go-live |

> ⚠️ Số migration dưới đây là **dự kiến**. WO DB phải đọc `apps/api/migrations/meta/_journal.json` **tại thời điểm chạy** và lấy `idx = max + 1` (**KHÔNG suy từ tên file** — bẫy `migration-not-in-journal-is-silently-skipped`); lane migration là lane **nối tiếp** duy nhất của wave.
>
> ⚠️ **Band di sản `0091`–`0180` BẤT KHẢ XÂM PHẠM.** Mọi thay đổi trên 6 bảng G12 làm bằng migration MỚI (`0564+`), không sửa file cũ.

---

## 2. Mục đích tài liệu

Đặc tả tầng dữ liệu cho module PAYROLL: hồ sơ lương versioned, thưởng/phạt theo kỳ, kỳ lương 🔁 **8 trạng thái (v2)** *(v1: 7 — `Published` thêm ở §12.3)*, bảng lương nháp, phiếu lương append-only + dòng chi tiết, xác nhận phiếu.

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

> **v2 thêm 11 bảng nữa và ALTER 3 bảng** — đặc tả ở **§12–§14**, không lặp lại ở đây. Tổng bảng PAYROLL sau v2: **18**. Phạm vi §3 dưới đây mô tả **v1**.

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

### 6.3 `payroll_periods` — kỳ lương (FSM 🔁 **8 trạng thái ở v2**, 7 ở v1)

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `period_month` | TEXT | Có | `YYYY-MM`, CHECK regex |
| `pay_date` | DATE | Không | ghi cứng lúc tạo từ `payroll_config_json.payDay` |
| `status` | TEXT | Có | 🔁 **v2: 8 giá trị** (SPEC-01 §17.15) *(v1: 7 — `Published` thêm ở §12.3)*, default `Draft`; FSM ở SPEC-11 §13.1 |
| `attendance_period_id` | UUID | Không | composite FK → `attendance_periods (company_id, id)` NO ACTION; phải `locked` trước khi tính |
| `note` · `reopen_reason` | TEXT | Không | lý do mở lại (bắt buộc ở service) |
| `created_by` `updated_by` `calculated_by/at` `submitted_by/at` `approved_by/at` `published_by/at` `locked_by/at` | | | vết đầy đủ vòng đời; **reset theo bảng RESET của SPEC-11 §13.1** |
| `payslips_generated_by` `payslips_generated_at` | | | **cờ đã-sinh-phiếu** — nguồn kiểm DUY NHẤT của `reopen`/`publish`, đọc **dưới row-lock** trên chính hàng này. KHÔNG đếm bảng `payslips` (bảng khác không được row-lock bảo vệ) — SPEC-11 §13.1 |
| `created_at` `updated_at` `deleted_at` | | | soft delete |

```sql
-- CHECK (đổi/thêm) — 🔁 BA DÒNG ĐẦU LÀ BẢN v1; BẢN CÒN HIỆU LỰC Ở §12.3 (v2, 8 giá trị + paid_pair_check)
chk status IN ('Draft','CollectingData','Calculated','Reviewing','Approved','Paid','Locked')
    -- 🔁 v2 (§12.3): ... ,'Approved','Published','Paid','Locked')
chk payroll_periods_approved_pair_check    status NOT IN ('Approved','Paid','Locked') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
    -- v2 (§12.3) KHÔNG đụng CHECK này — có chủ đích: vết approved_* ở 'Published' đã bị
    --    published_pair_check (bản v2) đòi, nên thêm 'Published' vào đây là ràng buộc TRÙNG, không phải lỗ.
chk payroll_periods_published_pair_check   status NOT IN ('Paid','Locked') OR (published_by IS NOT NULL AND published_at IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    -- 🔁 v2 (§12.3): status NOT IN ('Published','Paid','Locked') OR (...)  + THÊM payroll_periods_paid_pair_check
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
| payroll period status (SPEC-01 §17.15) | `Draft` · `CollectingData` · `Calculated` · `Reviewing` · `Approved` · `Paid` · `Locked` — 🔁 **v2 THÊM `Published` giữa `Approved` và `Paid` ⇒ 8 giá trị, xem §15.1** | `payroll_periods_status_check` |
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

---

## PHẦN v2 — wave S15-PAYROLL-V2 (§12–§15)

> **Nguồn nghiệp vụ của phần này:** [SPEC-11 v2](<../spec/SPEC-11 PAYROLL.md>) §3.9–§3.12 · §8.2 · §11.3 · §12.1 · §13.1 · §13.6–§13.8 · §15.1 · §18.1. Quy ước §4 (RLS+FORCE · composite tenant FK · append-only · FSM ở service · `numeric(18,2)` · mirror Zod hai chiều · UUID PK · **ĐO trước khi ALTER**) áp **nguyên vẹn** cho mọi bảng v2 — bên dưới chỉ ghi phần KHÁC.
>
> ⚠️ **Head migration đo ngày 11/09/2026: `idx 236` / `0569_s14recruitfilegrant1_candidate_file_perm`** ⇒ lô v2 bắt đầu **`0570+`**. PAY-DEC-011 (viết 02/09) ghi «`0569+`» — **`0569` đã bị `S14-RECRUIT-FILEGRANT-1` lấy**. WO DB vẫn **đọc `_journal.json` tại thời điểm chạy** và lấy `idx = max + 1` (`migration-not-in-journal-is-silently-skipped`).
>
> ⚠️ **Band di sản `0091`–`0180` và lô v1 `0564`–`0568` đều BẤT KHẢ XÂM PHẠM.** Mọi thay đổi làm bằng migration MỚI.

## 12. ALTER 3 bảng v1 (lô DB-1 · một phần lô DB-2)

### 12.1 `salary_profiles` — 5 cột MỚI (PAY-DEC-015 · PAY-DEC-016)

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `salary_type` | TEXT | Có | **default `'GROSS'`**, CHECK ∈ `GROSS`/`NET`; `NET` ⇒ gross-up (SPEC-11 §13.8) |
| `pit_payer` | TEXT | Có | **default `'EMPLOYEE'`**, CHECK ∈ `EMPLOYEE`/`COMPANY` — ai chịu TNCN (SPEC-11 §13.7 E) |
| `insurance_salary` | numeric(18,2) | Không | lương đóng BH; **NULL = dùng `base_salary`** (không backfill bằng `base_salary` — xem cảnh báo dưới); CHECK `> 0` khi NOT NULL |
| `probation_salary` | numeric(18,2) | Không | lương thử việc; CHECK `> 0` khi NOT NULL |
| `pay_ratio_pct` | numeric(5,2) | Có | **default `100.00`**, CHECK `> 0 AND <= 100` — tỉ lệ hưởng |

```sql
ALTER TABLE salary_profiles ADD COLUMN salary_type      TEXT          NOT NULL DEFAULT 'GROSS';
ALTER TABLE salary_profiles ADD COLUMN pit_payer        TEXT          NOT NULL DEFAULT 'EMPLOYEE';
ALTER TABLE salary_profiles ADD COLUMN insurance_salary numeric(18,2);
ALTER TABLE salary_profiles ADD COLUMN probation_salary numeric(18,2);
ALTER TABLE salary_profiles ADD COLUMN pay_ratio_pct    numeric(5,2)  NOT NULL DEFAULT 100.00;

ALTER TABLE salary_profiles ADD CONSTRAINT salary_profiles_salary_type_check
  CHECK (salary_type IN ('GROSS','NET'));
ALTER TABLE salary_profiles ADD CONSTRAINT salary_profiles_pit_payer_check
  CHECK (pit_payer IN ('EMPLOYEE','COMPANY'));
ALTER TABLE salary_profiles ADD CONSTRAINT salary_profiles_insurance_salary_check
  CHECK (insurance_salary IS NULL OR insurance_salary > 0);
ALTER TABLE salary_profiles ADD CONSTRAINT salary_profiles_probation_salary_check
  CHECK (probation_salary IS NULL OR probation_salary > 0);
ALTER TABLE salary_profiles ADD CONSTRAINT salary_profiles_pay_ratio_check
  CHECK (pay_ratio_pct > 0 AND pay_ratio_pct <= 100);
```

> ⚠️ **TÊN `salary_type` ĐÃ TỒN TẠI Ở BẢNG KHÁC, KHÁC NGHĨA.** `employee_profiles.salary_type` (`apps/api/src/db/schema/employees.ts:59`, CHECK **`emp_salary_type_check`** ∈ `monthly`/`hourly`/`project`) **không liên quan** tới cột mới này. Vì vậy CHECK mới **phải** mang tiền tố bảng (`salary_profiles_salary_type_check`) và comment schema phải nói thẳng — grep `salary_type` sẽ ra hai chỗ, người đọc sau cần biết ngay chỗ nào là chỗ nào.
>
> ⚠️ **`insurance_salary` để NULL, TUYỆT ĐỐI KHÔNG backfill = `base_salary`.** Hai đại lượng này trùng nhau *hôm nay* nhưng là hai khái niệm: backfill biến «chưa khai» thành «đã khai bằng lương», và lần sau ai đó đổi `base_salary` thì căn cứ đóng BH **không đổi theo** — sai âm thầm vào số nộp bảo hiểm. Quy tắc «NULL ⇒ dùng `base_salary`» sống ở **service**, một chỗ.
>
> ⚠️ **`pay_ratio_pct` áp lên LƯƠNG, KHÔNG áp lên căn cứ đóng BH** (SPEC-11 §13.7 B). Đây là ràng buộc nghiệp vụ, DB không ép được — ca test là chốt duy nhất.

### 12.2 `salary_profile_items` thay `allowances` jsonb — **EXPAND-CONTRACT**

`allowances jsonb [{name, amount}]` của v1 lên bảng con `salary_profile_items` (§13.1). Đi **hai lượt** (`migration-expand-contract-required`):

| Lượt | WO | Việc |
| --- | --- | --- |
| **EXPAND** | `S15-PAYROLL-DB-1` | TẠO `salary_profile_items` · **backfill** từ `allowances` · **GIỮ nguyên cột `allowances`** (đọc được, còn ghi được) · service đọc bảng mới, ghi **cả hai** |
| **CONTRACT** | **WO RIÊNG, SAU** | gỡ `allowances` — chỉ sau khi DB-1 chạy thật và **đo 0 đường đọc còn lại** trong `apps/api/**` |

> ⚠️ **ĐO SỐ HÀNG TRƯỚC.** PROD chưa chạy v1 ngày nào (lô `0564–0568` bị census `0565` chặn — `S14-PROD-PAYROLLGRANT-1`) ⇒ kỳ vọng **0 hàng trên PROD**, nhưng **DB dev/lane CÓ hàng**. Backfill phải chạy được với cả hai.
>
> ⚠️ **`allowances` có thể chứa phần tử sai khuôn** (jsonb không có CHECK hình dạng). Backfill **fail-loud** khi gặp phần tử thiếu `name`/`amount` hoặc `amount` không parse được — **KHÔNG bỏ qua im lặng** (bỏ qua = mất một khoản phụ cấp của một người, không ai biết). Migration đếm `jsonb_array_length` tổng trước/sau và verify **đúng bằng**.
>
> ⚠️ **`jsonb_array_length()` NÉM nếu `allowances` không phải mảng** (object/scalar). Guard bước (1) của migration phải kiểm `jsonb_typeof(allowances) = 'array'` cho mọi hàng **trước** khi đếm, với thông điệp riêng — kẻo lỗi nổ giữa lane với thông điệp khó đọc.

#### 12.2.a `component_code` lấy từ đâu — CHỐT ĐÓNG *(bổ sung 11/09/2026, plan-review `S15-PAYROLL-DB-1` B3)*

`allowances` là `[{name, amount}]` — **không có mã**. Bản §12.2 gốc không chốt quy tắc sinh `component_code`, và ba lối «tự nhiên» đều hỏng:

| Lối | Hỏng thế nào |
| --- | --- |
| `component_code := name` | `name` là chữ Việt có dấu/khoảng trắng ⇒ **không khớp hàng nào** của `salary_components` ⇒ thành phần `value_type='profile_item'` không phân giải được ⇒ sau CONTRACT **khoản phụ cấp biến mất khỏi `gross` mà không lỗi**; `salary_components_code_shape_check` cấm chữ thường/khoảng trắng nên cũng **không tạo lại được** qua catalog |
| Map hết về `PHU_CAP` | hồ sơ có ≥2 phụ cấp ⇒ đụng `salary_profile_items_profile_component_uq` ⇒ **`23505` giữa migration** |
| Sinh hàng catalog cho từng `name` | **BẤT KHẢ THI ở bước A**: `salary_components` seed **RUNTIME** (§15.3 bước B) ⇒ lúc backfill chạy **catalog chưa tồn tại** |

**Quy tắc ĐÓNG — mã tất định, KHÔNG đụng không gian tên catalog:**

```sql
component_code := 'PC_' || lpad(ordinality::text, 3, '0')  -- PC_001, PC_002… theo thứ tự phần tử, THEO TỪNG HỒ SƠ
note           := <name gốc>                               -- không mất thông tin người đọc
amount         := <amount gốc>
```

Ordinal theo **từng hồ sơ** thoả `..._profile_component_uq` kể cả khi hai phụ cấp **trùng tên**. `PC_` không nằm trong tiền tố cấm (`SYS_`/`TL_`/`GT_`) và không trùng mã seed nào.

> **Nợ bàn giao (`S15-PAYROLL-BE-1`):** mã `PC_nnn` nằm **ngoài** catalog. Đường **ĐỌC** trả nguyên kèm `note`; đường **GHI** (`020`/`022`) kiểm mã tồn tại ⇒ mã ngoài catalog trả **422 `PAYROLL-ERR-018`**. Ca test: đọc hồ sơ di sản `200` · lưu lại y nguyên ⇒ `422` (KHÔNG 500, KHÔNG im lặng mất dòng).

### 12.3 `payroll_periods` — 3 cột MỚI + 3 CHECK (PAY-DEC-013 · PAY-DEC-017)

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `template_id` | UUID | Không | mẫu bảng lương gắn vào kỳ; composite FK → `payroll_templates (company_id, id)` **NO ACTION**; đổi chỉ khi kỳ ≤ `CollectingData` (ép ở service ⇒ ERR-023) |
| `paid_by` | UUID | Không | composite FK → `users (company_id, id)` **SET NULL (paid_by)** |
| `paid_at` | timestamptz | Không | vết chuyển `Published → Paid` |

**Thứ tự DDL BẮT BUỘC — làm sai là `23514` ngay trên lượt migrate:**

```sql
-- (1) cột mới, để NULL
ALTER TABLE payroll_periods ADD COLUMN paid_by UUID;
ALTER TABLE payroll_periods ADD COLUMN paid_at timestamptz;

-- (2) NỚI status_check lên 8 giá trị TRƯỚC khi có hàng nào mang 'Published'
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_status_check;
ALTER TABLE payroll_periods ADD  CONSTRAINT payroll_periods_status_check
  CHECK (status IN ('Draft','CollectingData','Calculated','Reviewing','Approved','Published','Paid','Locked'));

-- (3) DI TRÚ NGHĨA: 'Paid' của v1 = 'đã phát hành phiếu' = 'Published' của v2
--     ĐO TRƯỚC: SELECT count(*) FROM payroll_periods WHERE status = 'Paid';  -- ghi số đo vào migration
UPDATE payroll_periods SET status = 'Published' WHERE status = 'Paid';

-- (4) RỒI MỚI siết hai CHECK cặp
ALTER TABLE payroll_periods DROP CONSTRAINT payroll_periods_published_pair_check;
ALTER TABLE payroll_periods ADD  CONSTRAINT payroll_periods_published_pair_check
  CHECK (status NOT IN ('Published','Paid','Locked')
         OR (published_by IS NOT NULL AND published_at IS NOT NULL
             AND approved_by IS NOT NULL AND approved_at IS NOT NULL));
ALTER TABLE payroll_periods ADD  CONSTRAINT payroll_periods_paid_pair_check
  CHECK (status NOT IN ('Paid','Locked')
         OR (paid_by IS NOT NULL AND paid_at IS NOT NULL));
```

> ⚠️ **Đảo bước (3) và (4) = mọi hàng `Paid` di sản vi phạm `paid_pair_check`** (cột `paid_by` còn NULL) ⇒ migration đỏ trên DB có dữ liệu, xanh trên DB rỗng. Đó là hình dạng «xanh ở CI, đỏ ở PROD» kinh điển.
>
> ⚠️ **`Locked` nằm trong vế trái của CẢ BA CHECK cặp** (`approved`/`published`/`paid`). Bỏ `Locked` khỏi một vế là mở đường ghi thẳng `Locked` không vết (`nullable-escape-clause-makes-check-vacuous`).
>
> ⚠️ **`template_id` KHÔNG được NOT NULL.** Kỳ v1 đã tồn tại không có mẫu; ép NOT NULL là chặn migration. Ràng buộc «phải có mẫu mới `calculate` được» sống ở **service** (⇒ 409 ERR-023 `template-missing`) — CHECK không biểu diễn được vì nó phụ thuộc hành động, không phụ thuộc trạng thái.

### 12.4 `payroll_period_lines` — 3 cột MỚI (PAY-DEC-012)

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `component_values_json` | jsonb | Có | **default `'{}'`** — snapshot giá trị TỪNG thành phần; dòng tính bằng mẫu thì `<> '{}'` |
| `template_fingerprint` | TEXT | Không | SHA-256 hex(64) của tập công thức hiệu lực + `statutory_rate_id` (SPEC-11 §13.6 G); NULL cho dòng tính theo công thức cố định v1 |
| `gross_up_iterations` | INTEGER | Không | số vòng gross-up; **NULL khi `salary_type = 'GROSS'`**; CHECK `>= 0 AND <= 30` khi NOT NULL |

```sql
ALTER TABLE payroll_period_lines ADD COLUMN component_values_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payroll_period_lines ADD COLUMN template_fingerprint  TEXT;
ALTER TABLE payroll_period_lines ADD COLUMN gross_up_iterations   INTEGER;
ALTER TABLE payroll_period_lines ADD CONSTRAINT payroll_period_lines_grossup_check
  CHECK (gross_up_iterations IS NULL OR (gross_up_iterations >= 0 AND gross_up_iterations <= 30));
ALTER TABLE payroll_period_lines ADD CONSTRAINT payroll_period_lines_fingerprint_check
  CHECK (template_fingerprint IS NULL OR template_fingerprint ~ '^[0-9a-f]{64}$');
```

> ⚠️ **`component_values_json` CÓ DEFAULT `'{}'`, khác `payslips.input_snapshot_json` (KHÔNG có default).** Có chủ đích và **không** mâu thuẫn §6.5: dòng v1 hợp lệ **không có** giá trị thành phần nào, nên `{}` là trạng thái đúng của chúng; còn `input_snapshot_json` rỗng thì luôn là snapshot giả. Vì vậy **KHÔNG** thêm CHECK `<> '{}'` cho cột này — ràng buộc «dòng tính bằng mẫu phải có component values» phụ thuộc `template_id` của kỳ (bảng khác) nên **CHECK không biểu diễn được**; ép ở service + ca test.
>
> **`payslips` KHÔNG nhận ba cột này.** Phiếu lương đã có `payslip_items` — mỗi thành phần một dòng, có nhãn, có dấu — tức là **cùng thông tin ở dạng giải-thích-được hơn**. Thêm một bản sao jsonb vào bảng append-only là nhân đôi nguồn sự thật trên chính bảng không sửa được. PDF (`PAYROLL-API-083/084`) đọc `payslip_items`, không đọc `component_values_json`.

---

## 13. Bảng MỚI — lô DB-1 (track A + B, 7 bảng)

### 13.1 `salary_profile_items` — phụ cấp/khấu trừ có định mức

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `salary_profile_id` | UUID | Có | composite FK → `salary_profiles (company_id, id)` **NO ACTION** |
| `component_code` | TEXT | Có | mã thành phần (§13.4); **không** FK cứng sang `salary_components` — xem cảnh báo |
| `amount` | numeric(18,2) | Có | CHECK `>= 0`; **mask ở server** |
| `is_active` | BOOLEAN | Có | default `true` — «trạng thái» của phụ cấp theo benchmark |
| `note` | TEXT | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE UNIQUE INDEX salary_profile_items_profile_component_uq
  ON salary_profile_items (company_id, salary_profile_id, component_code) WHERE deleted_at IS NULL;
CREATE INDEX salary_profile_items_company_profile_idx
  ON salary_profile_items (company_id, salary_profile_id) WHERE deleted_at IS NULL;
chk salary_profile_items_amount_check   amount >= 0
ALTER TABLE salary_profile_items ADD CONSTRAINT salary_profile_items_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. RLS ENABLE+FORCE + policy literal-GUC **trước** mọi INSERT.

> ⚠️ **`component_code` là TEXT, KHÔNG phải FK sang `salary_components.code`** — có chủ đích. Hồ sơ lương là bản ghi **versioned, đóng băng theo `effective_date`**; nếu FK cứng thì ngưng dùng một thành phần sẽ **kéo theo ràng buộc lên hồ sơ lương quá khứ** và biến một thao tác catalog thành một thao tác đụng dữ liệu lịch sử. Đổi lại: service **phải** kiểm mã tồn tại khi GHI (⇒ 422 ERR-018 `formula-unknown-ref` dùng chung mã), và có ca test ghim.

### 13.2 `payroll_employee_settings` — BH · công đoàn · tài khoản ngân hàng

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `user_id` | UUID | Có | composite FK → `users (company_id, id)` **NO ACTION**; **UNIQUE (company_id, user_id)** — 1 hàng/người |
| `joins_social_insurance` | BOOLEAN | Có | default `false` — có tham gia BHXH/BHYT/BHTN không |
| `social_insurance_no` | TEXT | Không | số sổ BHXH |
| `joins_union` | BOOLEAN | Có | default `false` — có đóng đoàn phí không |
| `bank_account_number` | TEXT | Không | **PII — mask 4 số cuối ở mọi DTO** (SPEC-11 §3.12) |
| `bank_name` · `bank_branch` · `account_holder` | TEXT | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE UNIQUE INDEX payroll_employee_settings_user_uq
  ON payroll_employee_settings (company_id, user_id) WHERE deleted_at IS NULL;
chk payroll_employee_settings_bank_pair_check
    bank_account_number IS NULL OR (bank_name IS NOT NULL AND account_holder IS NOT NULL)
ALTER TABLE payroll_employee_settings ADD CONSTRAINT payroll_employee_settings_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. **`mediaos_worker`: KHÔNG cấp `SELECT`.**

> **`bank_account_number` là PII hạng `tax_code`, KHÔNG phải secret hạng bất biến #3** — lưu plaintext + **mask ở server** + audit lượt xem, **không** envelope-encryption/KMS (SPEC-11 §3.12). Ghi ở đây để lượt sau không «nâng cấp» lệch với `employee_profiles.tax_code`.
>
> ⚠️ **CHECK cặp ngân hàng cố ý LỎNG** (`bank_branch` không bắt buộc): nhiều ngân hàng không cần chi nhánh. Nhưng **số tài khoản không có tên chủ tài khoản là một dòng UNC không gửi được** ⇒ cặp `account_number` + `account_holder` + `bank_name` là ràng buộc thật, ép ở DB.
>
> ⚠️ **KHÔNG có cột `bank_*` nào ở `employee_profiles`** (đo 11/09/2026: `grep -i bank apps/api/src/db/schema/` = 0 hit), và comment `employees.ts:78` **cấm** nhồi trường cần lọc vào `personal_extra` jsonb ⇒ cột ngân hàng **bắt buộc** ở bảng PAYROLL này (PAY-DEC-017).

### 13.3 `payroll_dependents` — người phụ thuộc giảm trừ TNCN

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `user_id` | UUID | Có | composite FK **NO ACTION** |
| `full_name` | TEXT | Có | **PII** |
| `relationship` | TEXT | Có | CHECK ∈ `Child`/`Spouse`/`Parent`/`Other` |
| `dependent_tax_code` | TEXT | Không | MST người phụ thuộc — **PII** |
| `date_of_birth` | DATE | Không | |
| `effective_from` | DATE | Có | |
| `effective_to` | DATE | Không | NULL = còn hiệu lực |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- cần cho EXCLUDE trộn '=' với '&&'

ALTER TABLE payroll_dependents ADD CONSTRAINT payroll_dependents_period_check
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE payroll_dependents ADD CONSTRAINT payroll_dependents_no_overlap_excl
  EXCLUDE USING gist (
    company_id WITH =,
    user_id    WITH =,
    full_name  WITH =,
    daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
  ) WHERE (deleted_at IS NULL);

CREATE INDEX payroll_dependents_company_user_idx
  ON payroll_dependents (company_id, user_id) WHERE deleted_at IS NULL;
ALTER TABLE payroll_dependents ADD CONSTRAINT payroll_dependents_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

> ⚠️ **`EXCLUDE` ném `23P01` (exclusion_violation), KHÔNG phải `23505`.** Service phải bóc **`23P01`** từ `error.cause` → **409 PAYROLL-ERR-032** `dependent-overlap`. Map thiếu = **500 ở vùng đỏ** (`drizzle-wraps-pg-error-code-in-cause`).
> ⚠️ **`btree_gist` là extension BẮT BUỘC** — `EXCLUDE` trộn toán tử `=` (uuid/text) với `&&` (range) không chạy nếu thiếu. Migration `CREATE EXTENSION IF NOT EXISTS` **trước** khi ADD CONSTRAINT, và verify fail-loud extension tồn tại.
> ⚠️ **Khoá chống trùng dùng `full_name`, không dùng `dependent_tax_code`** — MST NPT là cột **nullable** (nhiều NPT là trẻ em chưa có MST), mà `EXCLUDE` trên cột NULL **không loại được gì**: hai hàng NULL không «bằng» nhau nên ràng buộc thành rỗng (`nullable-escape-clause-makes-check-vacuous`). `full_name` NOT NULL là khoá duy nhất dùng được ở tầng DB; trùng tên thật (hai con cùng tên) là ca hiếm, xử lý bằng thông điệp lỗi hướng dẫn thêm hậu tố — **có chủ đích, không phải bỏ sót**.

### 13.4 `salary_components` — catalog thành phần lương

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `code` | TEXT | Có | **UNIQUE (company_id, code)**; CHECK regex + **cấm tiền tố `SYS_`/`TL_`/`GT_`** |
| `name` | TEXT | Có | nhãn hiển thị mặc định |
| `kind` | TEXT | Có | CHECK ∈ `earning` · `deduction` · `statutory_employee` · `statutory_employer` · `tax` · `tax_exempt` · `aggregate` (**7 giá trị**) |
| `value_type` | TEXT | Có | CHECK ∈ `formula` · `fixed` · `profile_item` · **`engine`** (**4 giá trị** — `engine` dành RIÊNG cho 4 nút `aggregate`, xem cảnh báo) |
| `formula` | TEXT | Không | bắt buộc khi `value_type='formula'` (CHECK cặp); ≤ 500 ký tự |
| `fixed_amount` | numeric(18,2) | Không | bắt buộc khi `value_type='fixed'` (CHECK cặp); **BẮT BUỘC NULL** khi `value_type='engine'` |
| `pit_deductible` | BOOLEAN | Có | default `false` — «khoản này được trừ khỏi **thu nhập tính thuế**». Chỉ có nghĩa với `kind='statutory_employee'`; seed `BHXH_NV`/`BHYT_NV`/`BHTN_NV` = `true`, **`DOAN_PHI` = `false`** (SPEC-11 §13.6 E · §13.7 D) |
| `is_system` | BOOLEAN | Có | default `false` — hàng seed; **không xoá được** (CHECK `salary_components_system_not_deletable` + service ⇒ ERR-024) |
| `is_active` | BOOLEAN | Có | default `true` |
| `sort_order` | INTEGER | Có | default 0 |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE UNIQUE INDEX salary_components_company_code_uq
  ON salary_components (company_id, code) WHERE deleted_at IS NULL;

chk salary_components_code_shape_check
    code ~ '^[A-Z][A-Z0-9_]{0,31}$' AND code NOT LIKE 'SYS\_%' AND code NOT LIKE 'TL\_%' AND code NOT LIKE 'GT\_%'
chk salary_components_kind_check
    kind IN ('earning','deduction','statutory_employee','statutory_employer','tax','tax_exempt','aggregate')
chk salary_components_value_type_check  value_type IN ('formula','fixed','profile_item','engine')
chk salary_components_value_pair_check
    (value_type = 'formula'      AND formula IS NOT NULL      AND fixed_amount IS NULL)
 OR (value_type = 'fixed'        AND fixed_amount IS NOT NULL AND formula IS NULL)
 OR (value_type = 'profile_item' AND formula IS NULL          AND fixed_amount IS NULL)
 OR (value_type = 'engine'       AND formula IS NULL          AND fixed_amount IS NULL AND is_system)
chk salary_components_formula_len_check  formula IS NULL OR length(formula) <= 500
-- Hàng hệ thống KHÔNG xoá mềm được — chốt cuối ở DB, không chỉ ở service:
chk salary_components_system_not_deletable   is_system = false OR deleted_at IS NULL
-- 'engine' chỉ dành cho 4 nút aggregate, và mọi aggregate đều phải là 'engine' (hai chiều):
chk salary_components_engine_kind_check      (value_type = 'engine') = (kind = 'aggregate')
ALTER TABLE salary_components ADD CONSTRAINT salary_components_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE` (hàng hệ thống không xoá; hàng tự thêm xoá mềm).

> ⚠️ **`salary_components_code_shape_check` là chốt DB cho luật «không gian tên dùng chung»** (SPEC-11 §8.2 C1 · §13.6 D). Không có nó, một thành phần tên `SYS_GROSS` **che** biến hệ thống trong mọi công thức — không CHECK nào khác bắt, không test nào thấy trừ khi có ca riêng. Lưu ý escape `\_` trong `LIKE` (dấu gạch dưới là ký tự đại diện của `LIKE`).
> 🔴 **`kind = 'aggregate'` ⇔ `value_type = 'engine'` — CHECK ép HAI CHIỀU.** Bốn mã hệ thống `TONG_THU_NHAP` · `TONG_BH_NV` · `THU_NHAP_CHIU_THUE` · `TONG_KHAU_TRU` (SPEC-11 §13.6 E) có giá trị do **engine** cộng, không do công thức người dùng. Chúng khai `value_type = 'engine'`, `formula IS NULL`, `fixed_amount IS NULL`, `is_system = true`.
>
> ⚠️ **Bản nháp khai chúng là `value_type='fixed'` với `fixed_amount` bằng KHÔNG — và đó là một BẪY FAIL-OPEN IM LẶNG, không phải thoả hiệp hình thức.** Mọi `switch (value_type)` viết **đúng theo DB** sẽ rơi vào nhánh `fixed` và trả **0** cho cả bốn nút ⇒ `TONG_THU_NHAP = 0` ⇒ **`net = 0`**, hoặc `TONG_KHAU_TRU = 0` ⇒ **`net = gross`** — **trong khi mọi bất biến SQL vẫn xanh** (`net ≥ 0` đúng, tổng khớp, CHECK không vỡ). Đúng hình dạng `empty-success-is-the-fail-open-shape`. Chốt bằng «service CẤM đọc `fixed_amount`» là một quy ước **không ai ép được**; một giá trị `value_type` thứ tư thì **trình biên dịch ép** — nhánh thiếu là lỗi kiểu, không phải số 0 âm thầm.
>
> **Giá phải trả đã cân nhắc:** thêm một nhánh `value_type` mà chỉ 4 hàng seed dùng. Đổi lại, nhánh đó **bắt buộc** phải được xử lý ở mọi chỗ khớp `value_type` (TS union + Zod enum + CHECK), và bốn nút tổng hợp **không thể** bị đọc nhầm thành 0. Đó là đánh đổi đúng trong vùng crown.
>
> **Đồng bộ bắt buộc cùng commit:** `packages/contracts/src/payroll.ts` `salaryComponentValueTypeEnum` = **4 giá trị**, mirror CHECK **hai chiều đúng bằng** (§15.1); SPEC-11 §15.1 route 045/047 từ chối `value_type='engine'` từ client (**chỉ seed** tạo được — ⇒ 422 `VALIDATION-ERR-001`).
>
> ⚠️ **`salary_components_system_not_deletable` là chốt DB cho «hàng hệ thống không xoá»** — trước đó luật này **chỉ sống ở service**. Một lượt xoá mềm lọt qua (bug, script, repository gọi thẳng) là `deleted_at` được set ⇒ hàng rơi khỏi `salary_components_company_code_uq` (partial `WHERE deleted_at IS NULL`) ⇒ người dùng **tạo lại `TONG_KHAU_TRU`** với công thức tuỳ ý và **che** nút engine. `code_shape_check` **KHÔNG** đỡ được: bốn mã đó không mang tiền tố `SYS_`/`TL_`/`GT_`. (§8.2 C1 của SPEC-11 khai «CHECK + UNIQUE» bảo vệ mã hệ thống — câu đó chỉ đúng **sau khi** có CHECK này.)
> **Seed hệ thống** (bước B của §15), `ON CONFLICT DO NOTHING`, tất cả `is_system = true`:
>
> | Nhóm | Mã | `kind` | `value_type` | `pit_deductible` |
> | --- | --- | --- | --- | --- |
> | Nút tổng hợp | `TONG_THU_NHAP` · `TONG_BH_NV` · `THU_NHAP_CHIU_THUE` · `TONG_KHAU_TRU` | `aggregate` | **`engine`** | `false` |
> | BH phần NV | `BHXH_NV` · `BHYT_NV` · `BHTN_NV` | `statutory_employee` | `formula` | **`true`** |
> | Đoàn phí | `DOAN_PHI` | `statutory_employee` | `formula` | **`false`** ⬅ **khác ba dòng trên — xem SPEC-11 §13.7 D** |
> | BH phần DN + KPCĐ | `BHXH_DN` · `BHYT_DN` · `BHTN_DN` · `KPCD` | `statutory_employer` | `formula` | `false` |
> | Thuế | `TNCN` | `tax` | `formula` | `false` |
> | Nền | `LUONG_CO_BAN` · `PHU_CAP` · `THUONG` · `PHAT` · `NGHI_KHONG_LUONG` · `TAM_UNG` | `earning`/`deduction` theo dấu | `formula`/`profile_item` | `false` |
>
> **Migration VERIFY fail-loud**: đúng **4** hàng `value_type='engine'`, và `count(*) WHERE kind='statutory_employee' AND pit_deductible` = **3** (ba loại BH bắt buộc, **không** gồm đoàn phí). Hai số này là chốt duy nhất chặn lỗi «đoàn phí giảm thuế» — không CHECK nào bắt được nó.

### 13.5 `payroll_templates` — mẫu bảng lương

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `code` · `name` | TEXT | Có | **UNIQUE (company_id, code)** |
| `scope` | TEXT | Có | CHECK ∈ `company` · `org_unit` (PAY-DEC-013 — theo vị trí/NV = PARK-PAYROLL-002) |
| `org_unit_id` | UUID | Không | composite FK **NO ACTION**; **cặp với `scope`** (CHECK) |
| `is_active` | BOOLEAN | Có | default `true` |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE UNIQUE INDEX payroll_templates_company_code_uq
  ON payroll_templates (company_id, code) WHERE deleted_at IS NULL;
chk payroll_templates_scope_check      scope IN ('company','org_unit')
chk payroll_templates_scope_pair_check (scope = 'org_unit') = (org_unit_id IS NOT NULL)
ALTER TABLE payroll_templates ADD CONSTRAINT payroll_templates_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

### 13.6 `payroll_template_components` — thành phần trong một mẫu

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `template_id` | UUID | Có | composite FK **NO ACTION** |
| `component_id` | UUID | Có | composite FK → `salary_components (company_id, id)` **NO ACTION** |
| `column_label` | TEXT | Không | nhãn cột ghi đè (NULL = dùng `salary_components.name`) |
| `formula_override` | TEXT | Không | công thức ghi đè (NULL = dùng của catalog); ≤ 500 ký tự |
| `is_visible` | BOOLEAN | Có | default `true` — ẩn/hiện cột |
| `sort_order` | INTEGER | Có | default 0 |
| `created_at/by` `updated_at/by` | | | **không** soft delete — đặt lại danh sách là DELETE-rồi-INSERT trong một tx (API-053) |

```sql
CREATE UNIQUE INDEX payroll_template_components_tpl_component_uq
  ON payroll_template_components (company_id, template_id, component_id);
CREATE INDEX payroll_template_components_company_tpl_idx
  ON payroll_template_components (company_id, template_id);
chk payroll_template_components_formula_len_check  formula_override IS NULL OR length(formula_override) <= 500
ALTER TABLE payroll_template_components ADD CONSTRAINT payroll_template_components_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE, **DELETE**`.

> ⚠️ **Đây là bảng PAYROLL DUY NHẤT có `GRANT DELETE`** — ngoại lệ có chủ đích, phải nói thẳng vì nó phá quy tắc «không bảng PAYROLL nào có DELETE» của §4.3. Lý do: `PUT /payroll/templates/:id/components` (API-053) **đặt lại toàn bộ** danh sách trong một transaction; làm bằng soft delete thì unique partial phải mang `deleted_at`, và mỗi lần sắp xếp lại cột sẽ tích luỹ hàng chết vô hạn trên một bảng **cấu hình thuần** (0 dữ liệu tiền, 0 giá trị lịch sử — lịch sử nằm ở `component_values_json` + `template_fingerprint` của dòng lương đã tính). **Vết đầy đủ của mọi lần sửa nằm ở `audit_logs`** (`object_type = 'payroll_template'`, payload kèm diff) — đó là nguồn lịch sử, không phải bảng này.
>
> ⚠️ Hệ quả: `RetentionService.PROTECTED_TABLES` **KHÔNG** cần bảng này, nhưng `fk-tenant-census` và ratchet GRANT **sẽ thấy một DELETE mới** ⇒ WO DB phải cập nhật pin/ratchet tương ứng **cùng commit**, kèm comment trỏ về đoạn này.

### 13.7 `payroll_statutory_rates` — tỉ lệ · trần · bậc thuế luật định

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `effective_from` | DATE | Có | **UNIQUE (company_id, effective_from)**; kỳ dùng bản `≤ ngày cuối kỳ` mới nhất |
| `si_employee_pct` `hi_employee_pct` `ui_employee_pct` | numeric(5,2) | Có | BHXH/BHYT/BHTN — **NV** |
| `si_employer_pct` `hi_employer_pct` `ui_employer_pct` | numeric(5,2) | Có | BHXH/BHYT/BHTN — **DN** |
| `union_employer_pct` | numeric(5,2) | Có | KPCĐ (DN) |
| `union_employee_pct` | numeric(5,2) | Có | đoàn phí (NV) |
| `si_cap` `hi_cap` `ui_cap` | numeric(18,2) | Có | **trần đóng, lưu THÀNH TIỀN** (không lưu «20×») |
| `base_wage` `min_region_wage` | numeric(18,2) | Có | lương cơ sở · lương tối thiểu vùng — lưu để **giải thích** trần, không để nhân lúc chạy |
| `personal_deduction` `dependent_deduction` | numeric(18,2) | Có | giảm trừ bản thân · mỗi NPT |
| `pit_brackets` | jsonb | Có | **7 bậc**, mỗi phần tử `{ "upTo": số HOẶC null, "rate": phần trăm }`; bậc cuối bắt buộc `upTo = null` (xem khối SQL + cảnh báo dưới) |
| `note` | TEXT | Không | nguồn văn bản pháp luật (người nhập ghi) |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE UNIQUE INDEX payroll_statutory_rates_company_effective_uq
  ON payroll_statutory_rates (company_id, effective_from) WHERE deleted_at IS NULL;
chk payroll_statutory_rates_pct_range_check
    si_employee_pct BETWEEN 0 AND 100 AND hi_employee_pct BETWEEN 0 AND 100 AND ui_employee_pct BETWEEN 0 AND 100
AND si_employer_pct BETWEEN 0 AND 100 AND hi_employer_pct BETWEEN 0 AND 100 AND ui_employer_pct BETWEEN 0 AND 100
AND union_employer_pct BETWEEN 0 AND 100 AND union_employee_pct BETWEEN 0 AND 100
chk payroll_statutory_rates_amount_check
    si_cap > 0 AND hi_cap > 0 AND ui_cap > 0 AND base_wage > 0 AND min_region_wage > 0
AND personal_deduction >= 0 AND dependent_deduction >= 0
chk payroll_statutory_rates_brackets_check
    jsonb_typeof(pit_brackets) = 'array' AND jsonb_array_length(pit_brackets) = 7
ALTER TABLE payroll_statutory_rates ADD CONSTRAINT payroll_statutory_rates_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

> ⚠️ **CHECK chỉ ép được HÌNH DẠNG của `pit_brackets` (mảng, 7 phần tử), KHÔNG ép được tính LIÊN TỤC** (không hở, không chồng, `upTo` tăng dần, bậc cuối `null`). Ép đầy đủ ở SQL cần hàm PL/pgSQL trong CHECK — không immutable, không dùng được. ⇒ **kiểm liên tục ở service khi LƯU và khi TÍNH** (⇒ 422 ERR-022 `statutory-rate-incomplete`), và có **ca test ghim từng hình dạng hỏng**: hở · chồng · không tăng dần · bậc cuối có `upTo` · 6 bậc · 8 bậc.
> **Trần lưu THÀNH TIỀN, không lưu hệ số** (SPEC-11 §13.7 B): hệ số «20×» và mức nền đổi độc lập nhau qua từng đợt sửa luật; lưu tích số là đúng thứ hệ thống áp, còn `base_wage`/`min_region_wage` lưu kèm **chỉ để giải thích** con số đó đến từ đâu. Service **KHÔNG** nhân lại — ca test ghim.
> **Seed bước B — số owner xác nhận 02/09/2026 (PAY-DEC-014):** NV `8 / 1,5 / 1` · DN `17,5 / 3 / 1` · KPCĐ `2` · đoàn phí `1` · giảm trừ bản thân `11.000.000` · mỗi NPT `4.400.000` · trần BHXH/BHYT `= 20 × lương cơ sở` · trần BHTN `= 20 × lương tối thiểu vùng` · 7 bậc TNCN. **Hệ thống LƯU và ÁP, không khẳng định đúng luật** (SPEC-11 §3.11) — ca test ghim **số seed**, không ghim «đúng luật».

---

## 14. Bảng MỚI — lô DB-2 (track C, 4 bảng)

### 14.1 `payroll_advances` — tạm ứng

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` · `user_id` | UUID | Có | composite FK **NO ACTION** |
| `amount` | numeric(18,2) | Có | CHECK `> 0`; **mask ở server** |
| `deduct_period_month` | TEXT | Có | `YYYY-MM`, CHECK regex — kỳ sẽ khấu trừ |
| `reason` | TEXT | **Có** | lý do bắt buộc |
| `status` | TEXT | Có | CHECK ∈ `Pending` · `Approved` · `Rejected` · **`Deducted`** (4 giá trị), default `Pending` |
| `decided_by` `decided_at` `decision_note` | | Không | reject bắt buộc `decision_note` |
| `payroll_period_id` `consumed_at` | | Không | **cặp NULL/NOT NULL** — khoá chống khấu trừ hai lần |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
chk payroll_advances_status_check         status IN ('Pending','Approved','Rejected','Deducted')
chk payroll_advances_amount_check         amount > 0
chk payroll_advances_month_check          deduct_period_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
chk payroll_advances_decided_pair_check   status = 'Pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)
chk payroll_advances_reject_note_check    status <> 'Rejected' OR decision_note IS NOT NULL
chk payroll_advances_consumed_pair_check  (payroll_period_id IS NULL) = (consumed_at IS NULL)
chk payroll_advances_consume_status_check payroll_period_id IS NULL OR status = 'Deducted'
CREATE INDEX payroll_advances_company_user_month_idx
  ON payroll_advances (company_id, user_id, deduct_period_month) WHERE deleted_at IS NULL;
CREATE INDEX payroll_advances_company_status_idx
  ON payroll_advances (company_id, status) WHERE deleted_at IS NULL;
ALTER TABLE payroll_advances ADD CONSTRAINT payroll_advances_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. **`mediaos_worker`: KHÔNG cấp `SELECT`** (chứa số tiền per-người).

> **Khuôn sao chép từ `bonus_penalties`, có chủ đích** (§6.7): cùng lớp lỗi «cộng hai lần» thì cùng một chốt cuối — cặp `(payroll_period_id, consumed_at)` NULL/NOT NULL. Đừng phát minh cờ `is_deducted` mới.
> ⚠️ **FSM 4 trạng thái, khác `bonus_penalties` (3).** `Deducted` là trạng thái **terminal thứ ba**, đạt được khi máy tính lương gộp khoản này vào kỳ. `payroll_advances_consume_status_check` khoá cặp: đã bind kỳ ⇒ **bắt buộc** `Deducted`. Chuyển tiếp hợp lệ: `Pending → Approved | Rejected`; `Approved → Deducted`. Sai ⇒ **409 PAYROLL-ERR-025**, ép ở service.
> ⚠️ **Tính lại kỳ chưa `Approved` phải NHẢ consume của CHÍNH kỳ đó** (set NULL **cả cặp** + `status` về `Approved`) rồi gộp lại trong cùng tx — y như `bonus_penalties` (SPEC-11 §13.4 bước 4). Nhả một vế của cặp là vỡ `consumed_pair_check`.

### 14.2 `payroll_payment_batches` — đợt chi trả

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `payroll_period_id` | UUID | Có | composite FK **NO ACTION** |
| `code` | TEXT | Có | mã đợt, **UNIQUE (company_id, code)** |
| `method` | TEXT | Có | CHECK ∈ `bank` · `cash` |
| `status` | TEXT | Có | CHECK ∈ `Draft` · `Ready` · `Completed`, default `Draft` |
| `pay_date` | DATE | Không | ngày chi thực tế |
| `completed_by` `completed_at` | | Không | **cặp NULL/NOT NULL với `status='Completed'`** |
| `note` | TEXT | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
CREATE UNIQUE INDEX payroll_payment_batches_company_code_uq
  ON payroll_payment_batches (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX payroll_payment_batches_company_period_idx
  ON payroll_payment_batches (company_id, payroll_period_id) WHERE deleted_at IS NULL;
chk payroll_payment_batches_method_check    method IN ('bank','cash')
chk payroll_payment_batches_status_check    status IN ('Draft','Ready','Completed')
chk payroll_payment_batches_completed_pair_check
    status <> 'Completed' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL)
ALTER TABLE payroll_payment_batches ADD CONSTRAINT payroll_payment_batches_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

> ⚠️ **DB KHÔNG ép được «kỳ phải `Published` mới lập đợt»** (ràng buộc chéo bảng) ⇒ service kiểm ⇒ **409 PAYROLL-ERR-027** `period-not-published`. Cùng lớp `check-cannot-enforce-fsm-transitions`.
> ⚠️ **`complete` đổi trạng thái CỦA KỲ** (`Published → Paid`) — route `PAYROLL-API-072` row-lock **kỳ TRƯỚC, đợt SAU** (thứ tự cố định chống deadlock khi hai đợt cùng kỳ hoàn tất song song) và gọi chính `assertPeriodTransition`. **Không** có hàm FSM thứ hai (SPEC-11 §13.1).
>
> 🔴 **MỘT KỲ CÓ NHIỀU ĐỢT — `Paid` bám LUẬT PHỦ, không bám «đợt đầu tiên hoàn tất».** Không có unique nào chặn hai đợt cùng `payroll_period_id` (index `..._company_period_idx` là **non-unique**, có chủ đích: bank + cash, hoặc chia theo đơn vị). ⇒ `complete` chỉ đẩy kỳ sang `Paid` khi **mọi `payslips` của kỳ đã có dòng chi thuộc một đợt `Completed`** (SPEC-11 §13.1 luật PHỦ). Đẩy kỳ sang `Paid` ngay ở đợt đầu làm đợt thứ hai **kẹt 409 vĩnh viễn** và những người trong đợt đó **không bao giờ được ghi là đã chi**.
>
> ⚠️ **DB KHÔNG ép được luật PHỦ** (đếm chéo `payslips` ⋈ `payroll_payment_lines` ⋈ `payroll_payment_batches`) ⇒ **service ép dưới row-lock kỳ**; ca test là chốt duy nhất. Cùng lớp `check-cannot-enforce-fsm-transitions`.
>
> ⚠️ **Đợt RỖNG không được `Completed`**: `status = 'Completed'` với 0 dòng `payroll_payment_lines` còn hiệu lực là **một lượt chi trả không tồn tại được ghi là đã chi**. CHECK không biểu diễn được (ràng buộc chéo bảng) ⇒ service ⇒ **409 PAYROLL-ERR-028** `batch-empty`, và đó là **đường phát duy nhất** của 028.

### 14.3 `payroll_payment_lines` — dòng chi trả per nhân sự

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `batch_id` | UUID | Có | composite FK → `payroll_payment_batches (company_id, id)` **NO ACTION** |
| `user_id` | UUID | Có | composite FK **NO ACTION** |
| `payslip_id` | UUID | Có | composite FK → `payslips (company_id, id)` **NO ACTION** — **nguồn số tiền** |
| `bank_account_snapshot` | TEXT | Không | **số TK ĐÓNG BĂNG lúc lập đợt**; **mask 4 số cuối khi đọc qua API-070** |
| `bank_name_snapshot` · `account_holder_snapshot` | TEXT | Không | |
| `paid_at` | timestamptz | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | **soft delete** — gỡ một dòng khỏi đợt `Draft` là xoá mềm, không DELETE (bảng chở dòng tiền, phải giữ vết) |

```sql
CREATE UNIQUE INDEX payroll_payment_lines_batch_user_uq
  ON payroll_payment_lines (company_id, batch_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX payroll_payment_lines_company_batch_idx
  ON payroll_payment_lines (company_id, batch_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX payroll_payment_lines_payslip_uq
  ON payroll_payment_lines (company_id, payslip_id) WHERE deleted_at IS NULL;
ALTER TABLE payroll_payment_lines ADD CONSTRAINT payroll_payment_lines_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`. Bảng vào `RetentionService.PROTECTED_TABLES`.

> **KHÔNG lưu bản sao số tiền** (SPEC-11 §8.2 C3): dòng chi tham chiếu `payslip_id` và đọc số từ đó. Lưu bản sao là đẻ nguồn sự thật thứ hai cho **cùng một khoản tiền**, và khi lệch thì không ai biết bên nào đúng. **Số tài khoản thì NGƯỢC LẠI — phải đóng băng**: nhân sự đổi tài khoản sau ngày chi thì tệp UNC đã gửi ngân hàng phải giải thích được bằng số **lúc gửi**.
> ⚠️ **`payroll_payment_lines_payslip_uq` là chốt cuối chống trả hai lần**: một phiếu lương chỉ nằm trong **đúng một** dòng chi trả của toàn công ty. Mạnh hơn `batch_user_uq` (chỉ chặn trùng trong **cùng** một đợt). Race hai đợt ⇒ `23505` ⇒ **409 PAYROLL-ERR-027** `payee-already-in-batch`. ⚠️ **Service phải map theo TÊN `payroll_payment_lines_payslip_uq`, KHÔNG phải `..._batch_user_uq`** — hai đợt khác nhau của cùng một kỳ **không** vi phạm `batch_user_uq` (khác `batch_id`), nên map nhầm tên để đường chống-trả-hai-lần trả **500** thay vì 409 (SPEC-11 §12.1 bảng `constraint → SQLSTATE → mã`).
> ⚠️ **Gỡ một dòng khỏi đợt `Draft` dùng SOFT DELETE, không DELETE** (bảng không có GRANT DELETE) ⇒ **cả ba index trên mang `WHERE deleted_at IS NULL`**. *(Bảng cấu hình `payroll_template_components` được cấp DELETE vì nó là cấu hình thuần — bảng này chở **dòng tiền**, phải giữ vết.)*
> ⚠️ **Hệ quả của soft delete lên `payroll_payment_lines_payslip_uq`:** một phiếu **bị gỡ** khỏi đợt A **được phép** vào đợt B — đúng ý (sửa sai lúc `Draft`). Nhưng nó cũng nghĩa là unique **không** chặn được «gỡ mềm rồi thêm lại vào đợt đã `Completed`» ⇒ đó là việc của **trigger đóng băng** dưới đây, không phải của index. Ca test phải có cả hai nhánh.
> **Sau khi đợt `Completed`, trigger hẹp đóng băng** `payslip_id` · `bank_account_snapshot` · `paid_at` · `deleted_at` của mọi dòng thuộc đợt đó — khuôn `bonus_penalty_freeze_guard` (§5.5). **Không** thu hồi UPDATE toàn bảng (còn phải sửa lúc `Draft`), và **phải** khoá cả `deleted_at` — thiếu vế đó thì xoá mềm một dòng của đợt đã hoàn tất vẫn qua được, tức là gỡ một người khỏi bảng chi trả **sau khi đã chi**.

### 14.4 `payroll_budgets` — ngân sách lương năm × đơn vị

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` · `company_id` | UUID | Có | |
| `fiscal_year` | INTEGER | Có | CHECK `BETWEEN 2000 AND 2100` |
| `org_unit_id` | UUID | Không | composite FK **NO ACTION**; **NULL = toàn công ty** |
| `planned_amount` | numeric(18,2) | Có | CHECK `>= 0` |
| `note` | TEXT | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | soft delete |

```sql
-- ⚠️ org_unit_id NULLABLE ⇒ unique thường KHÔNG chặn được hai hàng "toàn công ty"
--    (NULL <> NULL trong unique index). Dùng COALESCE về UUID sentinel toàn-0.
CREATE UNIQUE INDEX payroll_budgets_year_unit_uq
  ON payroll_budgets (company_id, fiscal_year, COALESCE(org_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;
chk payroll_budgets_year_check    fiscal_year BETWEEN 2000 AND 2100
chk payroll_budgets_amount_check  planned_amount >= 0
ALTER TABLE payroll_budgets ADD CONSTRAINT payroll_budgets_company_id_id_uq UNIQUE (company_id, id);
```

GRANT app: `SELECT, INSERT, UPDATE`. **Không** `DELETE`.

> ⚠️ **Bẫy NULL trong unique** đã vá bằng `COALESCE` sentinel: không có nó, «ngân sách toàn công ty năm 2026» tạo được **vô hạn lần** mà UNIQUE vẫn xanh, và ERR-029 thành mã chết. Race ⇒ `23505` ⇒ **409 PAYROLL-ERR-029**.
> **`planned_amount` là kế hoạch; «thực hiện» KHÔNG lưu cột** — nó cộng từ kỳ đã `Published` trở đi lúc đọc (`PAYROLL-API-073`). Lưu cột thực-hiện là nguồn sự thật thứ hai phải đồng bộ mỗi lần kỳ đổi trạng thái.

---

## 15. Enum v2 · index · kế hoạch migration · rủi ro (v2)

### 15.1 Enum v2 — mirror `packages/contracts/src/payroll.ts` HAI CHIỀU, ĐÚNG BẰNG

| Nhóm | Giá trị | CHECK |
| --- | --- | --- |
| **payroll period status** 🔁 **7 → 8** | `Draft` · `CollectingData` · `Calculated` · `Reviewing` · `Approved` · **`Published`** · `Paid` · `Locked` | `payroll_periods_status_check` |
| salary type *(MỚI)* | `GROSS` · `NET` | `salary_profiles_salary_type_check` |
| PIT payer *(MỚI)* | `EMPLOYEE` · `COMPANY` | `salary_profiles_pit_payer_check` |
| salary component kind *(MỚI, 7)* | `earning` · `deduction` · `statutory_employee` · `statutory_employer` · `tax` · `tax_exempt` · `aggregate` | `salary_components_kind_check` |
| salary component value type *(MỚI, **4**)* | `formula` · `fixed` · `profile_item` · **`engine`** | `salary_components_value_type_check` |
| template scope *(MỚI)* | `company` · `org_unit` | `payroll_templates_scope_check` |
| dependent relationship *(MỚI)* | `Child` · `Spouse` · `Parent` · `Other` | `payroll_dependents_relationship_check` |
| **advance status** *(MỚI, 4)* | `Pending` · `Approved` · `Rejected` · `Deducted` | `payroll_advances_status_check` |
| payment batch method *(MỚI)* | `bank` · `cash` | `payroll_payment_batches_method_check` |
| payment batch status *(MỚI)* | `Draft` · `Ready` · `Completed` | `payroll_payment_batches_status_check` |
| payslip item type | **KHÔNG ĐỔI** — vẫn 7 giá trị (§7) | `payslip_items_type_check` |

> 🔴 **`payrollPeriodStatusEnum` của contracts hiện là 7 giá trị** (`packages/contracts/src/payroll.ts:54–62`, đo 11/09/2026) — **phải lên 8 CÙNG COMMIT với migration §12.3**. Zod 7 vs CHECK 8 = **mã chết** theo đúng chiều nguy hiểm: DB nhận `Published`, Zod từ chối ⇒ **500 trên đường đọc** chứ không phải 4xx (`equal-caps-at-zod-and-service-make-dead-error-code`, `contract-must-mirror-db-check-both-directions`).
> **Trường tiền + `bankAccountNumber` + `taxCode` trong DTO khai `.optional()`** (server mask = **vắng khoá**) — `server-masking-needs-optional-fe-schema`.

### 15.2 Index theo use case (v2)

| Use case | Index |
| --- | --- |
| Danh sách nhân viên PAYROLL (`API-036`) | qua `PayrollPeopleRepository` (HR) + `payroll_employee_settings_user_uq` |
| Thiết lập/NPT của một người (`038`/`040`) | `payroll_employee_settings_user_uq` · `payroll_dependents_company_user_idx` |
| NPT hiệu lực trong kỳ (máy tính lương §13.7) | `payroll_dependents_company_user_idx` + lọc `daterange` (gist của `EXCLUDE` phục vụ luôn) |
| Catalog thành phần (`044`) · giải mã REF khi tính | `salary_components_company_code_uq` |
| Mẫu + thành phần của mẫu (`051`, tính lương) | `payroll_template_components_company_tpl_idx` (một lượt cho cả kỳ) |
| Bản tỉ lệ hiệu lực tại ngày cuối kỳ | `payroll_statutory_rates_company_effective_uq` + `effective_from <= X ORDER BY effective_from DESC LIMIT 1` |
| Tạm ứng gộp vào kỳ (`Approved`, chưa consume, đúng tháng) | `payroll_advances_company_user_month_idx` · `payroll_advances_company_status_idx` |
| Đợt chi trả theo kỳ (`066`) · dòng chi (`070`) | `payroll_payment_batches_company_period_idx` · `payroll_payment_lines_company_batch_idx` |
| Chống trả hai lần | `payroll_payment_lines_payslip_uq` |
| Ngân sách + thực hiện (`073`, widget 002) | `payroll_budgets_year_unit_uq` + `payroll_period_lines_company_period_idx` (đã có) |
| Báo cáo theo kỳ/đơn vị (`081`) | `payroll_period_lines_company_period_idx` (đã có) + JOIN org-unit qua điểm chiếu |

> ⚠️ **Đừng assert `Index Scan` trong test** — `FORCE RLS` giấu biểu thức không-leakproof khỏi `Index Cond`, planner đổi kế hoạch theo số hàng (`rls-force-hides-nonleakproof-expr-from-index-cond` · `pg-planner-index-assert-trap` · `idx-scan-zero-is-not-unused`).
> **Máy tính lương v2 vẫn đọc set-based**: §19.1 của SPEC-11 chốt **O(1) câu truy vấn theo số nhân sự** — ca QA **đếm CÂU SQL**, không đếm builder (`nplus1-test-must-count-queries-not-builders`).

### 15.3 Kế hoạch migration v2 (`0570+` — lane DB **nối tiếp**)

| Bước | WO | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- | --- |
| **0** *(không phải migration)* | DB-1 | **ĐO**: `_journal.json` `max(idx)` · `count(*)` 7 bảng v1 · **`count(*) FROM payroll_periods WHERE status='Paid'`** (ghi số đo vào migration) · `jsonb_array_length` tổng của `salary_profiles.allowances` · `aclexplode` GRANT thật `mediaos_app`/`mediaos_worker` · giá trị hiện có trong CHECK `audit_logs.object_type` · `permissions ⋈ role_permissions` cho 17 cặp v1 · `btree_gist` đã cài chưa | mọi lệnh dưới viết theo số **ĐO được**, không suy từ file migration (`grant-in-old-migration-is-not-current-state`) |
| **A** (`0570`) | DB-1 | **ALTER §12.1 + §12.4** · **TẠO 7 bảng §13** (RLS ENABLE+FORCE + policy literal-GUC **TRƯỚC** mọi INSERT + GRANT + composite tenant FK + `UNIQUE (company_id, id)`) · `CREATE EXTENSION btree_gist` · **backfill `allowances` → `salary_profile_items`** (fail-loud, verify tổng đúng bằng) · **GIỮ cột `allowances`** (expand) · **VERIFY fail-loud** khuôn `0549`/`0559`: 7 bảng mới `relrowsecurity AND relforcerowsecurity` + policy tồn tại; **0 `DELETE`** cho app role trên 6/7 bảng mới (ngoại lệ **có chủ đích**: `payroll_template_components` CÓ DELETE — §13.6); tập cột UPDATE so bằng **`aclexplode`**; số composite FK **đúng bằng**; `btree_gist` tồn tại · **cùng commit**: `apps/api/src/db/schema/payroll.ts` parity · `cleanupTenants()` thêm 7 bảng **đúng thứ tự con→cha** và **trước `DELETE FROM users`** · `RetentionService.PROTECTED_TABLES` + spec của nó · **đăng ký `rls-registry` + fixture cho cả 7 bảng** · `packages/contracts/src/payroll.ts` mirror hai chiều (`salaryComponentValueTypeEnum` **4 giá trị** gồm `engine`; **KHÔNG** đụng `payrollPeriodStatusEnum` — cột `status` chưa nới, đó là bước C) | RLS **TRƯỚC** INSERT (bất biến #1); thiếu `cleanupTenants` = đỏ hàng loạt `afterAll` (`drop-table-must-clean-test-teardown`) |
| **B** (`0571`) | DB-1 | 🔁 **ĐÍNH CHÍNH 11/09/2026 — bước B TÁCH LÀM HAI theo PHẠM VI DỮ LIỆU** *(plan-review `S15-PAYROLL-DB-1` B1/B6)*. **B-1 — migration `0571`, chỉ dữ liệu TOÀN CỤC**: 17 cặp quyền + 31 grant + UNION-ADD `audit_logs.object_type`. **B-2 — `PayrollMasterDataSeeder` RUNTIME (KHÔNG phải migration)**: `salary_components` hệ thống (4 `aggregate`/`engine` + luật định + nền) · **1 bản `payroll_statutory_rates`** (số PAY-DEC-014, `note` «owner xác nhận 02/09/2026») · **1 `payroll_templates` mặc định + `payroll_template_components` của nó** (một hàng cho MỖI thành phần `is_system`; `is_visible=false` cho `statutory_employer`; **KHÔNG tự gắn vào kỳ nào**). **Vì sao:** ba bảng này `company_id NOT NULL`, mà mig `0445:12` + `master-data-seeder.types.ts:8` **CẤM seed company-scoped ở migrate-time** (DB sạch có 0 company ⇒ seed 0 hàng ⇒ khối VERIFY «4 nút engine / 3 `pit_deductible`» thành **xanh RỖNG** — đúng lớp lỗi `empty-success-is-the-fail-open-shape`). **Giá phải trả, phải biết:** `MasterDataSeedRunner.runOne()` bọc try/catch toàn phần ⇒ seeder ném chỉ thành batch `Failed` + log, **KHÔNG chặn boot** ⇒ cổng CỨNG cho «catalog không đủ» chuyển sang đường TÍNH/ĐỌC: **422 `ERR-022`** (thiếu tỉ lệ hiệu lực) · **422 `ERR-018`** (thiếu/không phân giải được nút engine), **CẤM trả 0** — nợ ghi ở `done_when` của `S15-PAYROLL-BE-2`/`BE-3`. Assert của seeder dùng **SET-EQUALITY theo MÃ**, lọc `is_system = true AND deleted_at IS NULL` (đếm số trần thì công ty thêm khoản BH tự nguyện `pit_deductible=true` là gãy ⇒ áp lực nới assert ⇒ mất chốt «đoàn phí giảm thuế» — `invariant-count-must-filter-owned-rows`). · **17 cặp quyền v2** (`ON CONFLICT (action, resource_type) DO NOTHING`, **TẤT CẢ `is_sensitive = TRUE`**) + **31 hàng grant** · **UNION-ADD 10 giá trị** vào CHECK `audit_logs.object_type` (SPEC-11 §12.1 ghi chú 4 — gồm **`payroll_employee`** và **`payroll_report`**, hai giá trị KHÔNG ứng với bảng nào; thiếu chúng ⇒ 6/18 đường audit-đọc của SPEC-11 §18.1 B trả **500**) (**clone nguyên khối `0545`** — neo 2 tầng, fail-closed, NO-LOSS/NO-GAIN; `audit-check-union-parse-anchor-trap`) + `AUDIT_OBJECT_TYPES` cùng commit · **VERIFY fail-loud**: đúng **63** hàng grant PAYROLL (32 v1 + 31 v2); `hr`/`hr-manager`/`manager` **= 0 cặp** trên cả `role_permissions` **và** `object_permissions`; `payroll-officer` **KHÔNG** giữ `manage:statutory-rate` và `manage:payroll-budget`; **mọi role giữ `manage:payroll-template` đều giữ `view:salary-component`**; **mọi role giữ `approve:payroll-advance` đều giữ `view:payroll-advance`**; 🔴 **mọi role giữ `manage:X` đều giữ `view:X`** cho **bốn** tài nguyên `payroll-advance` · `payment-batch` · `payroll-budget` · `salary-component` (SPEC-11 §11.3 ghi chú 8 — role có `manage` mà không `view` **không có đường hợp lệ nào đọc lại số nó vừa ghi**, và đó chính là áp lực làm WO sau nhét số tiền vào envelope GHI); census grant phủ **bốn hình dạng wildcard** (`permission-grant-census-must-cover-four-wildcard-shapes`) | thu hồi/seed cặp chạy **sau** DDL; `super-admin` **không** enumerate |
| **C** (`0572`) | DB-2 | **§12.3 — ALTER thứ ba, ĐỦ 4 BƯỚC nguyên tử** (`template_id` · `paid_by/at` → nới `status_check` 8 giá trị → `UPDATE 'Paid' → 'Published'` → rồi mới siết `published_pair_check` + thêm `paid_pair_check`) · **TẠO 4 bảng §14** (RLS ENABLE+FORCE + policy literal-GUC **TRƯỚC** mọi INSERT + GRANT + composite tenant FK + `UNIQUE (company_id, id)`) · composite FK `payroll_periods.template_id` (phải **sau** khi `payroll_templates` tồn tại ⇒ **sau bước A**) · trigger hẹp đóng băng `payroll_payment_lines` sau `Completed` · **VERIFY fail-loud** khuôn `0549`/`0559` — **khối giống hệt bước A, KHÔNG rút gọn**: 4 bảng mới `relrowsecurity AND relforcerowsecurity` + policy tồn tại; **0 `DELETE`** cho app role trên **cả 4**; `mediaos_worker` **KHÔNG** `SELECT` trên `payroll_advances` · `payroll_payment_lines`; tập cột UPDATE so bằng **`aclexplode`**; số composite FK **đúng bằng**; `count(*) WHERE status='Paid' AND paid_by IS NULL` **= 0** sau di trú; `count(*) WHERE status='Paid'` **khớp số ĐO ở bước 0** · **cùng commit**: `schema/payroll.ts` parity · `cleanupTenants()` thêm 4 bảng **đúng thứ tự con→cha** (`payroll_payment_lines` → `payroll_payment_batches` → `payroll_advances` → `payroll_budgets`) và **trước `DELETE FROM users`** · `RetentionService.PROTECTED_TABLES` + spec của nó · **đăng ký `rls-registry` + fixture cho cả 4 bảng** · `packages/contracts/src/payroll.ts` mirror hai chiều (**`payrollPeriodStatusEnum` 7 → 8 — cùng commit với bước (2)**) | RLS **TRƯỚC** INSERT (bất biến #1); **bước (3) backfill TRƯỚC bước (4) siết CHECK** — đảo là `23514` trên DB có dữ liệu; thiếu `cleanupTenants` = đỏ hàng loạt `afterAll` (`drop-table-must-clean-test-teardown`) |
| **D** (`0573`) | DB-2 | **Seed NOTI 024–027** vào `notification-event-catalog.const.ts` + `notification_events` (**`dedupe_strategy='DedupeKey'`**, `dedupe_window_seconds=NULL`, `isSystemEvent=false`) + template · `ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING` (bare ⇒ `42P10`) · ⚠️ **CHECK `module_code='PAYROLL'`/`notification_type='Payroll'` ĐÃ được `0566` nới cho CẢ HAI bảng** ⇒ bước này **ĐO rồi NO-OP có chủ đích** kèm `RAISE NOTICE`, **KHÔNG viết ALTER rỗng** · seed **17 cặp quyền track C** nếu tách khỏi bước B | PHẢI merge **TRƯỚC** khi `S15-PAYROLL-BE-4` đăng ký registrar outbox (`registerSource()` fail-loud lúc boot) |

**KHÔNG có bước widget DASH** — toàn bộ seed `PAYROLL-WIDGET-002/003` (catalog + **sàn scope `Company`** + slug FE) thuộc **`S15-PAYROLL-DASH-1`** với migration riêng, khuôn `0558`/`0563`/`0568`.

Số migration là **dự kiến** — nối tiếp head THẬT tại thời điểm chạy WO.

### 15.4 Rủi ro dữ liệu MỚI của v2

| Rủi ro | Vì sao nguy hiểm | Chốt chặn |
| --- | --- | --- |
| **Backfill `Paid → Published` bị bỏ sót hoặc chạy SAU khi siết CHECK** | mọi kỳ v1 tự nhận «đã chi trả» mà không đợt chi nào tồn tại; hoặc migration `23514` trên DB có dữ liệu (xanh ở CI vì CI rỗng) | §12.3 chốt **4 bước có thứ tự**; bước 0 ĐO `count(*) WHERE status='Paid'` và ghi số vào migration; verify sau di trú = 0 |
| **Contracts `payrollPeriodStatusEnum` còn 7 giá trị** | DB trả `Published`, Zod từ chối ⇒ **500 trên đường ĐỌC**, không phải 4xx | §15.1: mirror **cùng commit**; ca test dựng kỳ `Published` rồi đọc qua DTO |
| **Bộ lọc `/me/payslips` còn `{Paid, Locked}`** | nhân viên **mất sạch phiếu lương**, route trả `200` + mảng rỗng — không lỗi, không log | SPEC-11 §13.2 + ca 13 của §21.1 (kỳ ở **đúng `Published`** ⇒ thấy · ack · PDF) |
| **`EXCLUDE` trên cột NULLABLE thành rỗng** | chọn `dependent_tax_code` (nullable) làm khoá ⇒ ràng buộc **không loại được gì**, ERR-032 thành mã chết | §13.3: khoá theo `full_name` (NOT NULL); ca test hai NPT trùng tên, khoảng giao nhau |
| **Thiếu `btree_gist`** | `EXCLUDE` trộn `=` với `&&` không tạo được ⇒ migration đỏ ở môi trường chưa cài | §15.3 bước A: `CREATE EXTENSION IF NOT EXISTS` **trước** ADD CONSTRAINT + verify |
| **`23P01` không được map** | NPT chồng lấp trả **500** thay vì 409 | §13.3: bóc `23P01` từ `error.cause` → 409 **ERR-032** (`drizzle-wraps-pg-error-code-in-cause`) |
| **Unique bỏ qua hàng `org_unit_id IS NULL`** | tạo được **vô hạn** ngân sách «toàn công ty» cùng năm; ERR-029 thành mã chết | §14.4: `COALESCE(org_unit_id, sentinel)` trong unique index |
| **Thành phần tên `SYS_*` che biến hệ thống** | một hàng catalog đổi nghĩa **mọi** công thức, không CHECK nào khác bắt | §13.4 `salary_components_code_shape_check` (chú ý escape `\_` của `LIKE`) + ca test |
| **`pit_brackets` hở/chồng/không tăng dần** | thuế tính sai theo cách **không ai thấy** (số vẫn ra, vẫn ≥ 0, tổng vẫn khớp) | CHECK chỉ ép hình dạng (mảng, 7 phần tử); **liên tục kiểm ở service** lúc lưu **và** lúc tính ⇒ 422 ERR-022; ca test 6 hình dạng hỏng |
| **Backfill `allowances` bỏ qua phần tử sai khuôn** | mất một khoản phụ cấp của một người, **im lặng** | §12.2: backfill **fail-loud**, verify tổng `jsonb_array_length` **đúng bằng** |
| **`insurance_salary` bị backfill = `base_salary`** | «chưa khai» thành «đã khai»; đổi lương sau đó không kéo theo căn cứ BH ⇒ sai số nộp bảo hiểm | §12.1: để **NULL**; quy tắc fallback sống ở **service**, một chỗ |
| **Phần DN cộng nhầm vào `TONG_KHAU_TRU`** | lương NV tụt ~21,5% **trong khi mọi bất biến SQL vẫn xanh** (tổng khớp, `net ≥ 0` đúng) | SPEC-11 §13.7 C + **fixture đối soát tay** (§21.1 ca 1–2) — chốt duy nhất |
| **`payroll_template_components` có GRANT DELETE** | phá quy tắc «không bảng PAYROLL nào có DELETE» ⇒ ratchet GRANT đỏ, WO sau bị cám dỗ nới cho cả bảng khác | §13.6 ghi **ngoại lệ có chủ đích** + lý do; cập nhật pin/ratchet **cùng commit**, comment trỏ về mục đó |
| **Số TK đầy đủ rò qua DTO** | PII thanh toán ra khỏi server ngoài đường đã kiểm soát | §13.2 + SPEC-11 §3.12/§18.1: mặc định **`bankAccountLast4`** (trường **DẪN XUẤT**, không phải cột); đường duy nhất = tệp UNC `API-071` + audit; ca test assert **vắng khoá** `bankAccountNumber` |
| **`mediaos_worker` được cấp `SELECT` bảng lương mới** | quyền đọc lương trôi qua nhiều WO | §13.2/§14.1: **không cấp** trên `payroll_employee_settings` · `salary_profile_items` · `payroll_advances` · `payroll_payment_lines`; verify `aclexplode` |
| **Một phiếu nằm trong hai đợt chi trả** | trả lương hai lần | `payroll_payment_lines_payslip_uq` (**toàn công ty**, mạnh hơn `batch_user_uq`); race ⇒ `23505` ⇒ 409 ERR-027 |
| **Deadlock khi hai đợt cùng kỳ hoàn tất song song** | tx treo/đỏ ngẫu nhiên ở vùng đỏ | `API-072` row-lock **kỳ TRƯỚC, đợt SAU** — thứ tự **cố định**, ghi ở SPEC-11 §13.1 và §14.2 |
| **11 bảng mới quên vào `PROTECTED_TABLES`** | retention hard-delete bảng không có GRANT DELETE ⇒ `42501` uncaught **hỏng cả lượt cleanup tenant** | §15.3 bước A/C cùng commit; `erd-current` §9 cập nhật «18 bảng» |
| 🔴 **11 bảng mới đứng NGOÀI `rls-registry`** | `rls-guards.int-spec` lấy danh sách bảng cần kiểm **từ registry**, không tự quét `information_schema` ⇒ bảng không đăng ký thì cổng cô lập tenant **im lặng bỏ qua nó**: policy sai, FORCE thiếu, hoặc composite FK vắng đều **xanh**. Đây là cách **bất biến #1 bị vô hiệu hoá mà không có ca nào đỏ** | §15.3 bước **A** (7 bảng) và bước **C** (4 bảng) khai `rls-registry` + fixture **CÙNG COMMIT** với migration tạo bảng; ca đối chứng: gỡ một bảng khỏi registry ⇒ spec phải ĐỎ (không được xanh-rỗng) |
| **Đợt chi trả RỖNG được `Completed`** | một lượt chi trả **không tồn tại** được ghi là đã chi; nếu nó cũng đẩy kỳ sang `Paid` thì cả kỳ mang nhãn đã chi trả mà **0 đồng rời công ty** | §14.2: service chặn ⇒ **409 ERR-028** `batch-empty` (CHECK không biểu diễn được — ràng buộc chéo bảng); ca §21.1 số 15 |
| **Kỳ nhiều đợt vào ngõ cụt vĩnh viễn** | đẩy kỳ sang `Paid` ở đợt ĐẦU ⇒ đợt sau ăn `assertPeriodTransition('Paid','Paid')` ⇒ **409 vĩnh viễn**, người trong đợt đó **không bao giờ được ghi là đã chi**, và `POST /payment-batches` cũng chặn vì kỳ không còn `Published` | SPEC-11 §13.1 **luật PHỦ** — chỉ sang `Paid` khi **mọi** phiếu của kỳ đã có dòng chi thuộc đợt `Completed`; ca §21.1 số 15 có **ca ÂM** assert đợt #2 KHÔNG trả 409 |

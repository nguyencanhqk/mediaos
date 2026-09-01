# Micro-plan — S13-PAYROLL-DB-1 (🔴 RED · crown · FULL gate)

> WO: `harness/backlog.mjs#S13-PAYROLL-DB-1` · Nguồn: **DB-13** (schema + bản đồ reconcile) ·
> **SPEC-11** (§11 quyền · §13 FSM · §17 NOTI · §18 audit) · **permission-matrix §9g/§9g.1** ·
> wave plan §3 (PAY-DEC-001..010, owner ký 31/08/2026).
> Lane migration **nối tiếp duy nhất** của wave. Model: Opus. Gate: FULL.

---

## 0. BƯỚC 0 — ĐO THẬT (chạy 2026-09-01 trên `mediaos` qua `docker exec mediaos-postgres psql`)

> Mọi lệnh ở §2–§4 viết theo số dưới đây, **không suy từ file migration cũ**
> (`grant-in-old-migration-is-not-current-state`).

### 0.1 Dữ liệu — ĐỦ ĐIỀU KIỆN CHẠY

| Bảng | `count(*)` |
| --- | --- |
| `salary_profiles` · `payroll_periods` · `payslips` · `payslip_items` · `bonus_penalties` · `payslip_acknowledgements` | **0 / 0 / 0 / 0 / 0 / 0** |

✅ Cả 6 = 0 hàng ⇒ **KHÔNG phải DỪNG** (DB-13 §4.9). `payroll_period_lines` chưa tồn tại (`to_regclass` NULL).

### 0.2 Bất biến #1 — ĐÃ ĐÚNG SẴN, chỉ verify lại

- `relrowsecurity = t AND relforcerowsecurity = t` trên **cả 6** bảng.
- Policy `tenant_isolation` tồn tại trên **cả 6**, dạng
  `company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid` — **cùng khuôn** literal-GUC
  mà `0549`/`0559` dùng cho bảng mới ⇒ `payroll_period_lines` clone y hệt.

### 0.3 ❗ LỆCH DB-13 #1 — composite tenant-FK **ĐÃ CÓ SẴN** trên cả 6 bảng

DB-13 §4.2/§5 giả định band G12 còn là **FK đơn cột** và bước A phải "ĐỔI toàn bộ FK đơn cột → composite".
**Đo được: sai.** Một đợt sau `0535` đã phủ composite. Hiện trạng (`pg_constraint`):

| Bảng | composite `*_company_fk` đã có | `UNIQUE (company_id, id)` |
| --- | --- | --- |
| `salary_profiles` | `user_id` (**CASCADE**) | ✅ có |
| `payroll_periods` | `attendance_period_id` · `created_by` · `approved_by` · `published_by` (đều `SET NULL (col)`) | ✅ có |
| `payslips` | `payroll_period_id` · `user_id` · `salary_profile_id` · `created_by` · `replaces_payslip_id` (đều NO ACTION) | ✅ có |
| `payslip_items` | `payslip_id` (**CASCADE**) | — (không phải bảng đích) |
| `bonus_penalties` | `user_id` · `created_by` (NO ACTION) · `approved_by` · `task_id` · `kpi_result_id` (**RESTRICT**) · `payroll_period_id` (`SET NULL (col)`) | ❌ **THIẾU** |
| `payslip_acknowledgements` | `payslip_id` · `user_id` (NO ACTION) · `resolved_by` (`SET NULL (col)`) | — (không phải bảng đích) |

⇒ **Bước A thu hẹp**: không "đổi toàn bộ", chỉ (a) THÊM composite cho **cột `*_by` MỚI**,
(b) SỬA `ON DELETE` của các composite lệch khuôn, (c) THÊM `bonus_penalties_company_id_id_uq`.
`attendance_periods` **đã có** `UNIQUE (company_id, id)` ⇒ bước "THÊM nếu thiếu" của DB-13 §5.2 là **NO-OP**, chỉ verify.

### 0.4 ❗ LỆCH DB-13 #2 — số FK đơn cột biến mất là **4**, không phải 2

Census `fk-tenant-census.ts` đếm **FK 1 cột giữa hai bảng đều có `company_id`**, loại `src_column='company_id'`.
Cột bị GỠ mang FK đơn cột tới bảng có `company_id`:

| FK đơn cột biến mất | Theo cột GỠ | DB-13 §4.2 có kể? |
| --- | --- | --- |
| `bonus_penalties_task_id_fkey → tasks` | `task_id` | ✅ |
| `bonus_penalties_kpi_result_id_fkey → kpi_results` | `kpi_result_id` | ✅ |
| **`payslip_acknowledgements_resolved_by_fkey → users`** | `resolved_by` (§5.6 GỠ) | ❌ **sót** |
| **`payslips_replaces_payslip_id_fkey → payslips`** | `replaces_payslip_id` (§5.3 GỠ) | ❌ **sót** |

⇒ `FK_SINGLE_COL_PAIRS_FLOOR` **415 → 411** (−4), **xác nhận bằng đo hai lane** ở §6 trước khi ghi số.
(4 composite tương ứng cũng biến mất — không ảnh hưởng census vì census chỉ đếm FK 1 cột.)

### 0.5 GRANT hiện trạng (`aclexplode`) — **0 column-GRANT** trên cả 6 bảng ⇒ `REVOKE` cấp bảng an toàn

| Bảng | `mediaos_app` | `mediaos_worker` |
| --- | --- | --- |
| `salary_profiles` · `payroll_periods` · `bonus_penalties` · **`payslip_acknowledgements`** | SELECT, INSERT, UPDATE | SELECT |
| `payslips` · `payslip_items` | SELECT, INSERT | SELECT |

### 0.6 Trigger / index / CHECK di sản — khớp DB-13

3 trigger đúng như §5: `payroll_period_status_guard` · `bonus_penalty_guard` · `payslip_ack_status_guard`.
`salary_profiles_user_id_idx` thực tế là `(company_id, user_id)` ✅ (khớp §8).

### 0.7 ❗ LỆCH DB-13/SPEC-11 #3 — quyền: **role TUỲ BIẾN của tenant cũng giữ grant lương**

Đo `permissions ⋈ role_permissions ⋈ roles`: **19 cặp** họ lương ✅ đúng số SPEC-11 §11.2
(21 hàng khớp bộ lọc − 2 cặp domain HR `view-salary:employee` / `update-salary:employee` **KHÔNG đụng**).
`object_permissions` = **0 hàng** cho **cả 19 cặp** ⇒ cascade `0005:154` là NO-OP, vẫn viết DELETE tường minh + verify.

Nhưng người giữ grant **rộng hơn tài liệu**:

| Role | Kiểu | Số cặp lương đang giữ |
| --- | --- | --- |
| `company-admin` (…0001) | hệ thống | 13 |
| `hr-manager` (…0009) | hệ thống | 12 |
| `employee` (…0008) | hệ thống | 2 (`view-own-payslip`, `acknowledge-own-payslip`) |
| **`QUẢN LÝ CẤP CAO`** | **tuỳ biến của tenant** `257e5de2…` | **19** |
| **`SA`** | **tuỳ biến** | **19** |
| **`SEO`** | **tuỳ biến** | **2** |

- Tài liệu chỉ nói tới 3 role hệ thống. Luật "xoá **mọi** hàng `role_permissions` trỏ 16 cặp GỠ" đã phủ,
  nhưng verify "**đúng 32 hàng** grant PAYROLL" chỉ đạt nếu **cũng** xoá grant của 3 role tuỳ biến trên
  **3 cặp GIỮ**. ⇒ Sau WO này `QUẢN LÝ CẤP CAO`/`SA`/`SEO` giữ **0 cặp PAYROLL**.
  **Chấp nhận được, ghi tường minh**: PAYROLL hiện có **0 route** nên không ai đang dùng; PAY-DEC-006 nói
  quyền lương là khối độc lập; role tuỳ biến cấp lại được lúc chạy qua `permission-admin`.
  → **flag cho owner** trong mô tả PR, không tự ý mở rộng phạm vi.
- ❗ **`view-own-payslip` của `employee` đang là `@Company`, KHÔNG phải `@Own`** như §9g ghi.
  Vòng grant dùng `DELETE data_scope <> 'Own'` + INSERT ⇒ tự sửa; ghi `RAISE NOTICE` số hàng re-scope.

### 0.8 Seed nền — 3 mục là NO-OP có chủ đích

| Mục | Đo được | Hành động |
| --- | --- | --- |
| `modules.PAYROLL` | tồn tại, `is_active = false`, Extension, sort 8 (từ `0435`) | **verify tồn tại**, forward-compatible (chỉ RAISE khi **thiếu hàng**; KHÔNG assert `is_active`) |
| `audit_logs.object_type` CHECK | **đã đủ cả 4**: `payroll_period` · `salary_profile` · `bonus_penalty` · `payslip` (thêm cả `payslip_item`, `payslip_acknowledgement`) | **NO-OP có chủ đích** — khối clone `0545`/`0560` tự `RAISE NOTICE … idempotent skip`, **KHÔNG viết ALTER rỗng** |
| role id `…0015` | **trống** (…0012 asset-manager · …0013 office-admin · …0014 recruiter) | INSERT `payroll-officer` sau guard va-chạm-id |

### 0.9 NOTI + journal

- CHECK `chk_notification_events_module_code` / `chk_notifications_module_code` = 14 giá trị, dừng ở `RECRUIT`;
  `chk_notification_events_type` / `chk_notifications_notification_type` = 17 giá trị, dừng ở `Recruit`
  ⇒ **khớp superset DB-13 §10.1**, thêm `PAYROLL`/`Payroll`.
- `notification_events` global = **71 hàng** (pin hiện hành).
- `NOTI-EVENT-020..023` đã được DOC-1 đặt chỗ trong docs ⇒ dùng đúng dải.
- `_journal.json`: `max(idx) = 230` (`0563`) ⇒ **0564 = idx 231 · 0565 = 232 · 0566 = 233**;
  `when` nối tiếp `1717587352000` ⇒ `…353000 / …354000 / …355000`.

---

## 1. Quyết định thi công (chốt ở đây — WO sau KHÔNG tự phát minh)

| # | Quyết định | Lý do |
| --- | --- | --- |
| **P1** | Bước A **chỉ THÊM/SỬA** composite FK còn thiếu-hoặc-lệch (§0.3), **không** đổi hàng loạt | composite đã có sẵn; đổi hàng loạt là diff rỗng rủi ro cao |
| **P2** | `salary_profiles.user_id`: đổi **CẢ HAI** FK (đơn cột + composite) `CASCADE → NO ACTION`, **và thêm `DELETE FROM salary_profiles`** vào `cleanupTenants()` | (a) DB-13 §4.2 đòi NO ACTION; (b) để lẫn CASCADE + NO ACTION trên cùng cặp (cha,con) là bẫy thứ-tự-trigger; (c) `salary_profiles` **hiện KHÔNG có** trong `cleanupTenants` — nó sống nhờ CASCADE, bỏ CASCADE mà quên dòng này là `23503` hàng loạt (`drop-table-must-clean-test-teardown`). FK đơn cột **vẫn tồn tại** (chỉ đổi `ON DELETE`) ⇒ census không tụt |
| **P3** | `payslip_items.payslip_id`: đổi **CẢ HAI** `CASCADE → NO ACTION` | DB-13 §5.4 — CASCADE trên bảng chỉ-INSERT là đường xoá ẩn |
| **P4** | `bonus_penalties`: composite `approved_by` đang **RESTRICT** ⇒ sau RENAME thành `decided_by`, đổi `SET NULL (decided_by)`; FK đơn cột cùng cột đổi `SET NULL` | DB-13 §5.5; `RESTRICT` chặn cascade `companies→users` (bài học `cleanupTenants`) |
| **P5** | Trigger hẹp `bonus_penalty_freeze_guard`/`enforce_bonus_penalty_freeze` — **BA nhánh** (xem §8.1), **không** ép FSM | DB-13 §5.5 + plan-review H1 của WO + **plan-review vòng 1 B1**: trigger di sản `0098:110-149` có **ba** nhánh chứ không một — bỏ hai nhánh kia là mất bất biến tiền trong im lặng |
| **P6** | `RetentionService.PROTECTED_TABLES` **+= 5 bảng**: `payslip_acknowledgements` · `payroll_period_lines` · `salary_profiles` · `payroll_periods` · `bonus_penalties` (+ spec). `payslips`/`payslip_items` đã có sẵn ⇒ đủ **cả 7** | không bảng PAYROLL nào có GRANT DELETE ⇒ `42501` uncaught hỏng **cả lượt** cleanup tenant (H2 + MED plan-review vòng 1) |
| **P7** | THU HỒI `SELECT` của `mediaos_worker` trên `salary_profiles` · `payslips` · `payslip_items`; `payroll_period_lines` **không cấp từ đầu**. **GIỮ** worker `SELECT` trên `payroll_periods` · `bonus_penalties` · `payslip_acknowledgements` | DB-13 §4.3 (M7) — 0 route/0 handler đọc bảng lương; 3 bảng giữ không chứa số lương per-phiếu |
| **P8** | Bước B thu hồi trên **BA** bảng, **TRƯỚC** khi seed 17 cặp; grant loop dùng khuôn `0560` (DELETE-wrong-scope + INSERT ON CONFLICT) | §9g.1; một số cặp cũ/mới trùng `resource_type` |
| **P9** | **BA** điều kiện verify quan hệ cặp (hợp của SPEC-11 §11.1 và §9g): `manage:bonus-penalty ⇒ view:salary-profile` · `approve:payroll-period ⇒ view-line` · `calculate:payroll-period ⇒ view-line` | hai tài liệu liệt kê hai bộ khác nhau; WO `done_when` đòi cả ba |
| **P10** | `FK_SINGLE_COL_PAIRS_FLOOR` **415 → 411**, kèm đo hai lane (§6) và giải thích **từng** cặp trong comment | §0.4; cấm hạ "cho vừa" |
| **P11** | `packages/contracts/src/payroll.ts` **viết lại**; `payroll.spec.ts` viết lại theo. Barrel `index.ts` **không đụng** (`export * from "./payroll"` giữ nguyên) | §7 DB-13; consumer duy nhất ngoài spec là `retention.service.ts` (chỉ dùng chuỗi tên bảng) và `console/settings/company.tsx` (dùng `payrollConfigJson` của **company**, không phải file này) ⇒ **0 call-site gãy** |
| **P12** | KHÔNG bật `modules.is_active`; guard verify hàng PAYROLL **forward-compatible** | `module-enable-guard-blocks-next-wo` |

---

## 2. Migration `0564` — Reconcile DDL (bước A)

Thứ tự trong file (mỗi bước `--> statement-breakpoint`):

1. **Guard mở đầu** — `lock_timeout 5s`; assert `count(*) = 0` trên cả 6 bảng ⇒ **RAISE EXCEPTION nếu ≠ 0**
   (mọi lệnh GỠ cột dưới đây giả định 0 hàng); assert `attendance_periods` có `UNIQUE (company_id, id)`.
2. **DROP 3 trigger + 3 function** (`payroll_period_status_guard`/`enforce_payroll_period_status` ·
   `bonus_penalty_guard`/`enforce_bonus_penalty_guard` · `payslip_ack_status_guard`/`enforce_payslip_ack_status`).
3. **`salary_profiles`**: DROP CHECK `salary_profile_type_check`/`…_pay_cycle_check`/`…_status_check` **tường minh**
   → DROP COLUMN `salary_type`,`pay_cycle`,`currency`,`status` (unique partial `…_active_uq` chết theo `status` — ghi comment)
   → ADD `created_by`,`updated_by`,`deleted_by` + 3 composite FK `SET NULL (col)`
   → đổi FK `user_id` (đơn + composite) sang **NO ACTION** (P2)
   → CREATE UNIQUE INDEX `salary_profiles_company_user_effective_uq (company_id,user_id,effective_date) WHERE deleted_at IS NULL`.
4. **`payroll_periods`**: DROP `kpi_locked`; đổi 3 CHECK (`status` 7 giá trị PascalCase + default `'Draft'`,
   `approved_pair`, `published_pair`); ADD `pay_date`,`note`,`reopen_reason`,`updated_by`,
   `calculated_by/at`,`submitted_by/at`,`locked_by/at`,`payslips_generated_by/at` + composite FK `SET NULL (col)`
   cho 5 cột `*_by` mới; ADD CHECK `locked_pair` · `four_eyes` · `calculated_needs_attendance` · `generated_pair`.
5. **`payslips`**: DROP CHECK `payslips_entry_kind_check`,`payslips_chain_check` + INDEX `payslips_replaces_uq`,
   `payslips_period_user_original_uq`
   → DROP COLUMN `entry_kind`,`replaces_payslip_id`,`kpi_amount`,`currency`
   → `bonus_amount`/`penalty_amount` **SET NOT NULL DEFAULT 0**
   → ADD `deduction_amount`,`adjustment_amount`,`paid_leave_days`,`unpaid_leave_days` (NOT NULL DEFAULT 0)
     + `input_snapshot_json jsonb NOT NULL` (**KHÔNG DEFAULT**; bảng 0 hàng nên `SET NOT NULL` chạy được)
   → **DỰNG LẠI** `payslips_amounts_check` (thêm `deduction_amount >= 0 AND net >= 0`)
     + ADD `payslips_snapshot_check (input_snapshot_json <> '{}'::jsonb)`
   → ADD `payslips_period_user_uq UNIQUE (company_id, payroll_period_id, user_id)`.
   ⚠️ `adjustment_amount` **cố ý ngoài** `amounts_check` (có dấu).
6. **`payslip_items`**: đổi `payslip_items_type_check` (bỏ `'kpi'`, thêm `'adjustment'` ⇒ 7 giá trị);
   ADD `sort_order INTEGER NOT NULL DEFAULT 0`; đổi FK `payslip_id` (đơn + composite) → **NO ACTION** (P3).
7. **`bonus_penalties`**: DROP CHECK `bonus_penalties_source_check`,`bonus_penalties_reference_check` **tường minh**
   → DROP COLUMN `source`,`reference_type`,`task_id`,`kpi_result_id`,`currency`
   (kéo theo 2 FK đơn + 2 FK composite — **không** dựng lại)
   → `reason` SET NOT NULL → RENAME `approved_by→decided_by`, `approved_at→decided_at`
   → **RENAME INDEX** `bonus_penalties_approved_by_idx → bonus_penalties_decided_by_idx` (tường minh)
   → đổi CHECK `status` (PascalCase + default `'Pending'`), `approved_pair_check → decided_pair_check`,
     `consume_approved_check`
   → ADD `decision_note` + CHECK `bonus_penalties_reject_note_check`; ADD `updated_by`,`deleted_by`
     + composite FK `SET NULL (col)`
   → đổi FK `decided_by` (đơn + composite) `RESTRICT → SET NULL (decided_by)` (P4) **và đổi tên constraint theo cột mới**
     (`…_approved_by_fkey → …_decided_by_fkey`, `…_approved_by_company_fk → …_decided_by_company_fk`)
   → **[B2] đổi FK `payroll_period_id` (đơn + composite) `SET NULL → NO ACTION`** — DB-13 §5.5: nhả consume phải đi
     qua service để `consumed_at` cùng về NULL; `SET NULL` cấp DB null một vế ⇒ `23514` trên
     `bonus_penalties_consumed_pair_check` giữa cascade/teardown
   → ADD `bonus_penalties_company_id_id_uq UNIQUE (company_id, id)`
   → **CREATE** `enforce_bonus_penalty_freeze()` + trigger `bonus_penalty_freeze_guard` (P5 · §8.1).
8. **`payslip_acknowledgements`**: DROP CHECK `payslip_ack_status_check`,`…_dispute_reason_check`,`…_resolved_pair_check`
   → DROP COLUMN `status`,`reason`,`resolved_by`,`resolved_at`,`resolution_note`,`updated_at`
   (FK `resolved_by` đơn + composite chết theo — §0.4)
   → **`REVOKE UPDATE ON payslip_acknowledgements FROM mediaos_app`**.
9. **CREATE TABLE `payroll_period_lines`** (DB-13 §6.4) → `ENABLE`+`FORCE RLS` → `CREATE POLICY tenant_isolation`
   (literal-GUC) → composite FK → 3 index → 2 CHECK → `UNIQUE (company_id, id)`
   → `GRANT SELECT, INSERT, UPDATE TO mediaos_app` (**không** GRANT worker).
   **RLS trước mọi INSERT** — bất biến #1.
10. **REVOKE worker** (P7): `REVOKE SELECT ON salary_profiles, payslips, payslip_items FROM mediaos_worker`.
11. **VERIFY fail-loud** (khuôn `0549`/`0559`), một khối `DO $$`:
    - 7 bảng `relrowsecurity AND relforcerowsecurity` + policy `tenant_isolation` tồn tại;
    - `aclexplode(relacl)` **và** `aclexplode(attacl)`: app **0 UPDATE/DELETE** trên
      `payslips`/`payslip_items`/`payslip_acknowledgements`; **0 DELETE** trên cả 7;
      worker **0 SELECT** trên 3 bảng vừa thu hồi, **còn** SELECT trên
      `payroll_periods`/`bonus_penalties`/`payslip_acknowledgements`;
    - composite FK: so **đúng-bằng** danh sách `(tbl, col, tgt, deltype, setcols)` + đếm thô FK ≥2 cột
      (khuôn `0559` (3)/(3a'));
    - **20 cột** đã biến mất (đếm `pg_attribute`); 3 trigger cũ = 0 **và** `bonus_penalty_freeze_guard` tồn tại;
    - `UNIQUE (company_id, id)` đủ trên 5 bảng đích + `payroll_period_lines`;
    - index unique so **đúng chuỗi** `pg_get_expr` predicate (không `ILIKE '%WHERE%'`);
    - `bonus_penalties_decided_by_idx` tồn tại **và** `…_approved_by_idx` không còn.

**Cùng commit với 0564:** `apps/api/src/db/schema/payroll.ts` (parity, +`payrollPeriodLines`, gỡ import `tasks`/`kpiResults`) ·
`apps/api/test/helpers/seed.ts` (`cleanupTenants`: thêm `payroll_period_lines` + **`salary_profiles`**, thứ tự con→cha,
trước `DELETE FROM users`) · `RetentionService.PROTECTED_TABLES` + `retention.service.spec.ts` ·
`fk-tenant-verdicts.ts` (FLOOR 415→411 + comment đo hai lane) · **6 file §5**.

---

## 3. Migration `0565` — Module · role · thu hồi · seed §9g (bước B)

1. `modules.PAYROLL` verify tồn tại (forward-compatible, khuôn `0560` bước 1).
2. Guard va-chạm id `…0015` → INSERT role `payroll-officer` (`company_id NULL`, `is_system=true`,
   **`requires_two_factor=TRUE`**, `ON CONFLICT DO NOTHING`).
3. **THU HỒI trước** — 16 cặp GỠ: `DELETE object_permissions` → `DELETE role_permissions` → `DELETE permissions`,
   đếm từng bước vào `RAISE NOTICE`. Với **3 cặp GIỮ**: xoá **mọi** grant hiện có ở `role_permissions` **và**
   `object_permissions` (§0.7 — gồm role tuỳ biến), để bước 4 seed lại đúng 32 hàng.
   Cặp `('view-salary','employee')`/`('update-salary','employee')` **KHÔNG đụng**.
4. Seed **17 cặp** (`ON CONFLICT (action, resource_type) DO NOTHING`, **13 sensitive**) → vòng grant **32 hàng**
   khuôn `0560` (DELETE-wrong-scope + INSERT ON CONFLICT), ma trận §9g:
   `employee` 3 @Own · `manager`/`hr`/`hr-manager` 0 · `payroll-officer` 14
   (`access`@Own + 13 @Company, **không** `approve:payroll-period`) · `company-admin` 15 (`access`@Own + 14 @Company).
5. **VERIFY fail-loud**: đúng **32** hàng grant PAYROLL; `hr-manager` = **0** cặp PAYROLL trên **cả ba** bảng;
   **16 cặp GỠ = 0 hàng** ở cả ba; **P9** ba điều kiện quan hệ cặp; census grant phủ **bốn hình dạng wildcard**
   (`*:*`, `action:*`, `*:resource`, exact).
6. `audit_logs.object_type`: clone **nguyên khối** `0560` bước (5) với
   `v_new = {payroll_period, salary_profile, bonus_penalty, payslip}` ⇒ theo §0.8 sẽ **idempotent skip + RAISE NOTICE**,
   không ALTER.

**Cùng commit:** `AUDIT_OBJECT_TYPES` (kiểm parity — dự kiến đã đủ, không sửa).

---

## 4. Migration `0566` — NOTI (bước C)

Clone `0561`: (A) baseline guard forward-compatible (neo `RECRUIT`/`Recruit` là bản sau `0561`; **không** RAISE khi
module SAU đã nới) → (B) 2 CHECK `notification_events` += `'PAYROLL'`/`'Payroll'` → (C) 2 CHECK `notifications`
(**giữ nhánh `IS NULL OR`**) → (D) 4 event `PAYROLL_PERIOD_SUBMITTED`/`_APPROVED`/`_REJECTED`/`PAYSLIP_PUBLISHED`
(`module_code='PAYROLL'`, `notification_type='Payroll'`, priority Normal/Normal/High/High, `is_enabled=true`,
`is_system_event=false`, **`dedupe_strategy='DedupeKey'`, `dedupe_window_seconds=NULL`**,
`ON CONFLICT (event_code) WHERE company_id IS NULL AND deleted_at IS NULL DO NOTHING`) → (E) 4 template IN_APP/vi-VN
**không chứa số tiền** → (F) verify.

**Cùng commit:** `notification-event-catalog.const.ts` (+4 entry, `NotiModuleCode += PAYROLL`, `NotiType += Payroll`,
pin 71→75 / template 57→61) · `packages/contracts/src/notification.ts` (`notificationTypeEnumSchema += 'Payroll'`) ·
`schema/noti.ts` CHECK parity · mọi pin đếm đỏ sau khi chạy full lane suite.

---

## 5. Contracts + 6 file di sản

| File | Sửa thành |
| --- | --- |
| `packages/contracts/src/payroll.ts` | **viết lại**: gỡ 8 enum/schema (`salaryType`,`payCycle`,`salaryProfileStatus`,`payslipEntryKind`,`bonusSource`,`bonusReferenceType`,`payslipAckStatus`,`payslipReauth`) + `refineReference`; enum mới 7 trạng thái kỳ · 3 trạng thái BP · 7 `payslipItemType`; **mọi trường tiền `.optional()`** (server mask = vắng khoá) |
| `packages/contracts/src/payroll.spec.ts` | viết lại theo — **thêm ca mirror hai chiều đúng bằng** cho từng CHECK |
| `test/integration/bonus-penalty-transition.int-spec.ts` | giữ ca **đóng băng field tiền** (trigger hẹp + PascalCase); ca FSM lên service; bỏ ca `reference_type`/`currency` |
| `test/integration/payslip-acknowledgement-transition.int-spec.ts` | thay bằng ca **sổ chỉ-INSERT**: app role UPDATE/DELETE bị DB từ chối; unique chặn ack lần hai |
| `test/integration/payslip-appendonly.int-spec.ts` | **giữ nguyên mục đích** (ghim bất biến #2); bỏ `entry_kind`, thêm `input_snapshot_json`, thêm ca `payslips_period_user_uq` |
| `test/integration/rls-registry.ts` | `'draft'→'Draft'`, bỏ `entry_kind`, thêm `input_snapshot_json`, **thêm fixture `payroll_period_lines`**; **[B6]** fixture `bonus_penalties` (`:1632-1636`) thêm `reason` (cột sẽ NOT NULL ⇒ `23502`) + `'draft'→'Pending'`; fixture `payslip_acknowledgements` (`:1658-1661`) **bỏ cột `status`** (đã GỠ ⇒ `42703`) |
| **`test/integration/s13-payroll-db1-invariants.int-spec.ts` (MỚI)** | **[B5]** ca RED-trước ghim bất biến — khuôn `s12-recruit-db1-invariants.int-spec.ts` (xem §8.2) |
| `test/integration/pgbouncer-tenant-isolation.int-spec.ts` | `'draft'→'Draft'`, bỏ `entry_kind`, thêm `input_snapshot_json` |
| `apps/api/demo-seed-full.mjs` | cập nhật theo hình dạng §6 hoặc **gỡ khối lương tường minh** — không để nửa vời |

> ⚠️ Mọi `INSERT INTO payslips` (đúng **5 file** trên) phải kèm `input_snapshot_json` khác `{}`.
> ✅ `salary-profile-tenant-isolation.int-spec.ts` **không cần sửa** (chỉ dùng cột sống sót).

---

## 6. Verify · thứ tự chạy

1. `bash scripts/lane-db-setup.sh payrollbase` ở **head 0563** → chạy census ⇒ ghi số FK đơn cột **TRƯỚC**.
2. `bash scripts/lane-db-setup.sh payrolldb1` → `pnpm db:migrate` (0564–0566) → chạy census ⇒ số **SAU**.
   Hiệu **phải đúng 4**, và 4 cặp phải khớp danh sách §0.4 từng-cặp-một. Chỉ khi khớp mới ghi FLOOR 411.
3. `export LANE_DB=mediaos_payrolldb1` → `pnpm --filter @mediaos/api test` + `pnpm typecheck` + `pnpm lint`.
4. `bash harness/check.sh --lane-db=payrolldb1` (hoặc `--all` trước PR — vùng đỏ).
5. FULL gate: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` (+ `santa-method`).

---

## 7. Rủi ro đã nhận diện thêm (ngoài DB-13 §11)

| Rủi ro | Chốt chặn |
| --- | --- |
| `salary_profiles` **không có** trong `cleanupTenants`, sống nhờ FK CASCADE | P2 — đổi FK **và** thêm dòng DELETE trong **cùng** commit; nếu tách là `23503` hàng loạt |
| Trộn `CASCADE` (FK đơn) + `NO ACTION` (composite) trên cùng cặp bảng | P2/P3 — đổi **cả hai** vế, không đổi một vế |
| Verify "32 hàng" xanh-giả nếu bỏ sót role tuỳ biến | §0.7 + bước B3 xoá grant **mọi** role trên **cả 19** cặp trước khi seed |
| Hạ FLOOR sai số (2 thay vì 4) ⇒ ratchet đỏ oan hoặc mất cổng | §0.4 + đo hai lane §6, khớp **từng cặp** |
| `input_snapshot_json` NOT NULL không DEFAULT trên bảng **0 hàng** | `ADD COLUMN … NOT NULL` chạy được vì bảng rỗng; fixture phải ghi tường minh |
| Bước audit-CHECK là NO-OP ⇒ dễ bị "dọn cho gọn" | §0.8 — **giữ nguyên khối clone**, để `RAISE NOTICE`; xoá khối là mất cổng cho DB chưa có đủ 4 giá trị |
| **`payroll_periods` sau WO KHÔNG còn trigger nào**; FSM 7 trạng thái chỉ có CHECK tập giá trị ⇒ nhảy cóc `Draft→Paid` chỉ bị `published_pair` chặn một phần | Chấp nhận tường minh: FSM ép ở `assertPeriodTransition` của **S13-PAYROLL-BE-1** (SPEC-11 §13.1). Khoảng trống kéo dài từ WO này tới BE-1 — **ghi vào bàn giao**, KHÔNG dựng trigger FSM mới (`check-cannot-enforce-fsm-transitions`) |
| `view-own-payslip` là `is_sensitive=true` ⇒ nếu WO BE quên `SENSITIVE_CAPABILITY_ALLOWLIST` thì màn «Phiếu lương của tôi» biến mất dù DB có grant | Phụ thuộc bàn giao cho **BE-1** (`capability-allowlist-hides-admin-screens`) — không làm ở WO này |

---

## 8. VÁ SAU PLAN-REVIEW VÒNG 1 (2026-09-01) — verdict **BLOCK**, 6 blocker

> Đã **xác minh lại từng claim trên code thật** trước khi nhận (memory `reviewers-pass-real-bugs`
> · `reviewer-proposed-fix-can-open-holes`). Kết quả: **B1·B2·B3·B5·B6 + HIGH-0130 là THẬT**;
> **B4 chỉ là rủi ro tiềm ẩn** — đo được cả 3 cặp GIỮ đang **đúng cờ** rồi, nhưng vẫn thêm cổng verify.

### 8.1 [B1] Trigger `enforce_bonus_penalty_freeze` — **BA nhánh**, không phải một

Trigger di sản `enforce_bonus_penalty_guard` (`apps/api/migrations/0098_g12_bonus_penalties.sql:110-149`)
có **bốn** nhánh trong `IF OLD.status <> 'draft'`. Chỉ nhánh (1) ép FSM là phải bỏ; **ba nhánh còn lại là bất biến tiền**:

| Nhánh `0098` | Nội dung | Bản mới |
| --- | --- | --- |
| (1) `:113-119` | `status` không đổi được sau khi rời draft | **BỎ** — ép FSM chữ thường, chặn oan PascalCase; FSM ở service |
| (2) `:121-133` | đóng băng `kind`/`amount`/`currency`/`user_id`/`period_month`/`reference_*` | **GIỮ**, đổi tập cột (bỏ `currency`/`reference_*` đã GỠ, **thêm `reason`, `decision_note`**) |
| **(2b) `:135-141`** | **cấm xoá mềm sau khi rời draft** | **GIỮ** — vòng 1 SÓT. SPEC-11 §13.3 vẫn đòi "hàng đã consume khoá sửa/**xoá**" |
| **(3) `:142-148`** | **cấm re-bind `payroll_period_id` sang kỳ KHÁC sau khi đã consume** | **GIỮ** — vòng 1 viết "miễn trừ đường consume" trọn gói ⇒ mất chốt "một khoản thưởng vào hai kỳ" (DB-13 §11) |

**Đặc tả chốt của `enforce_bonus_penalty_freeze()` (BEFORE UPDATE):**

```text
-- Cột NULLABLE dùng IS DISTINCT FROM. `<>` với một vế NULL trả NULL ⇒ KHÔNG BAO GIỜ true
--   ⇒ sửa `decision_note` trên hàng đã duyệt lọt im lặng. [MED plan-review vòng 1]
v_frozen := OLD.status <> 'Pending' OR OLD.payroll_period_id IS NOT NULL;

(A) NẾU v_frozen VÀ bất kỳ cột nào trong
      {amount, kind, user_id, period_month, reason, decision_note}
    IS DISTINCT FROM giá trị cũ                      -> RAISE check_violation
(B) NẾU v_frozen VÀ NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
                                                     -> RAISE check_violation   (nhánh 2b)
(C) NẾU OLD.payroll_period_id IS NOT NULL
       VÀ NEW.payroll_period_id IS DISTINCT FROM OLD.payroll_period_id
       VÀ NEW.payroll_period_id IS NOT NULL          -> RAISE check_violation   (nhánh 3)
    ⇒ CHO PHÉP x -> NULL (nhả consume khi tính lại kỳ chưa Approved — SPEC-11 §13.3)
    ⇒ CẤM      x -> y   (re-bind kỳ khác)
(D) NẾU OLD.status = 'Pending' VÀ NEW.status <> 'Pending'   [MED — câu lệnh DUYỆT]
       VÀ bất kỳ cột nào trong {amount, kind, user_id, period_month, reason}
       IS DISTINCT FROM giá trị cũ                   -> RAISE check_violation
    ⇒ vẫn cho ghi decided_by/decided_at/decision_note trong chính câu duyệt
KHÔNG nhánh nào ép chuyển tiếp FSM (PAYROLL-ERR-011/012/013 là việc của service).
```

Ca test bắt buộc (§8.2): **4 ca DENY (A·B·C·D) + 3 ca ALLOW** (`Pending→Approved` sạch · nhả consume `x→NULL`
· sửa `amount` khi còn `Pending` chưa consume). Thiếu ca ALLOW thì ca DENY thành **xanh-rỗng**
(`deny-cases-vacuous-without-allow-case`).

### 8.2 [B5] int-spec bất biến MỚI — `s13-payroll-db1-invariants.int-spec.ts`

Khuôn: `apps/api/test/integration/s12-recruit-db1-invariants.int-spec.ts` (tiền lệ cùng lớp:
`s11-asset-db1-invariants` · `s11-room-db1-invariants`). Verify trong `DO $$` của migration chạy **một lần/DB**,
**không phải cổng đứng** — WO sau đổi grant/GRANT/trigger sẽ không có gì đỏ. Tối thiểu:

1. **32 grant PAYROLL** — so **set-equality** (role, action, resource, data_scope), không chỉ đếm.
2. `hr-manager` = **0** cặp PAYROLL trên **cả ba** bảng `permissions`/`role_permissions`/`object_permissions`.
3. **16 cặp GỠ = 0 hàng** ở cả ba bảng.
4. **[B4]** 17 cặp tồn tại, tập `is_sensitive = true` **đúng bằng** 13 cặp §11.1, 4 cặp còn lại `false`.
5. Role `payroll-officer`: id `…0015` · `company_id IS NULL` · `is_system` · **`requires_two_factor`** ·
   **KHÔNG** trong `DashCanonicalRole`/`NOTI_CANONICAL_ROLES`.
6. Census grant phủ **bốn hình dạng wildcard** (`*:*` · `action:*` · `*:resource` · exact).
7. **P9** ba điều kiện quan hệ cặp.
8. GRANT: app **0 UPDATE/DELETE** trên `payslips`/`payslip_items`/`payslip_acknowledgements`; **0 DELETE** trên cả 7;
   worker **0 privilege** trên `payroll_period_lines` **và 0 SELECT** trên `salary_profiles`/`payslips`/`payslip_items`;
   worker **còn** SELECT trên `payroll_periods`/`bonus_penalties`/`payslip_acknowledgements`.
9. RLS + FORCE + policy trên **7** bảng; ghi chéo tenant vào `payroll_period_lines` bị composite FK chặn.
10. **7 ca trigger freeze** (§8.1).

### 8.3 [B3] Bảng composite FK ĐÍCH — **danh sách ĐÓNG** (verify "đúng-bằng" đọc đúng bảng này)

> Vòng 1 nói "so đúng-bằng danh sách" nhưng **không viết danh sách ra**. Nguồn DB-13 §4.2 lại **thiếu**
> `payslips_generated_by` (§6.3 bắt buộc cột này) ⇒ chép nguyên §4.2 là verify đỏ hoặc cột mới không có FK.
> `del`: `a` = NO ACTION · `n` = SET NULL (col).

| Bảng | Cột | Đích | del | setcols |
| --- | --- | --- | --- | --- |
| `salary_profiles` | `user_id` | `users` | `a` | — |
| `salary_profiles` | `created_by` · `updated_by` · `deleted_by` | `users` | `n` | chính nó |
| `payroll_periods` | `attendance_period_id` | `attendance_periods` | **`a`** (đổi từ `n` — xem dưới) | — |
| `payroll_periods` | `created_by` · `updated_by` · `calculated_by` · `submitted_by` · `approved_by` · `published_by` · `locked_by` · **`payslips_generated_by`** | `users` | `n` | chính nó |
| `payroll_period_lines` | `payroll_period_id` · `user_id` · `salary_profile_id` | `payroll_periods`/`users`/`salary_profiles` | `a` | — |
| `payroll_period_lines` | `created_by` · `updated_by` · `deleted_by` | `users` | `n` | chính nó |
| `payslips` | `payroll_period_id` · `user_id` · `salary_profile_id` · `created_by` | — | `a` | — |
| `payslip_items` | `payslip_id` | `payslips` | `a` | — |
| `bonus_penalties` | `user_id` · `created_by` · **`payroll_period_id`** | `users`/`payroll_periods` | `a` | — |
| `bonus_penalties` | `decided_by` · `updated_by` · `deleted_by` | `users` | `n` | chính nó |
| `payslip_acknowledgements` | `payslip_id` · `user_id` | `payslips`/`users` | `a` | — |

**`payroll_periods.attendance_period_id`: `SET NULL (col)` → `NO ACTION`.** Lý do: CHECK mới
`payroll_periods_calculated_needs_attendance_check` đòi `attendance_period_id IS NOT NULL` khi kỳ đã rời
`Draft`/`CollectingData`; RI `SET NULL` trong cascade sẽ null cột đó ⇒ **`23514`** ngay giữa lượt xoá.
Teardown an toàn: `cleanupTenants` đã xoá `payroll_periods` (`seed.ts:503`) **trước** `attendance_periods`
(`seed.ts:613`) — đã kiểm.

**Hai điều kiện để số `−4` FK đơn cột ở §0.4 đúng** (ghi cạnh FLOOR 411):
(i) P2/P3/P4/B2 đổi `ON DELETE` bằng **DROP + ADD giữ nguyên tên constraint**, **không** "thay bằng composite"
— census `fk-tenant-census.ts` trả **một hàng / một constraint**, DROP FK đơn cột là tụt sàn ngoài dự kiến;
(ii) `payroll_period_lines` là **composite thuần** (0 FK đơn cột ngoài `company_id → companies`).

### 8.4 Các mục còn lại đã nhận

| # | Nội dung | Nơi vá |
| --- | --- | --- |
| **HIGH-0130** | DROP `payroll_period_status_guard` cũng gỡ nhánh **cấm xoá mềm kỳ non-draft** (`0130:63-68`). **Quyết định: chấp nhận mất ở tầng DB**, ép ở service (BE-1) — khác `bonus_penalties` vì kỳ lương có `deleted_at` đi kèm FSM 7 trạng thái mà DB không so được OLD/NEW cho **cả** chuyển tiếp; dựng trigger thứ hai ở đây là dựng lại đúng thứ vừa gỡ. Ghi vào §7 + bàn giao BE-1 | §7 + bàn giao |
| **HIGH-defacl** | `pg_default_acl` đo được **0 hàng** ⇒ không có auto-grant. Vẫn assert worker **0 privilege** trên `payroll_period_lines` | §8.2 mục 8 |
| MED-retention | `salary_profiles`/`payroll_periods`/`bonus_penalties` cũng **không có GRANT DELETE** ⇒ cùng đường `42501`. **Thêm cả 3** vào `PROTECTED_TABLES` (⇒ tổng **5** bảng PAYROLL mới) — cùng file, cùng spec đang sửa | P6 mở rộng |
| MED-cleanup | Chốt vị trí trong `cleanupTenants`: `payslip_acknowledgements` → `payslip_items` → `payslips` → **`payroll_period_lines`** → `bonus_penalties` → `payroll_periods` → **`salary_profiles`**, cả khối **trước** `DELETE FROM users` (`seed.ts:772`) và trước `attendance_periods` (`:613`) | §2 "cùng commit" |
| MED-rename | Đổi `ON DELETE` = **DROP + ADD**, giữ nguyên tên constraint; riêng cột RENAME thì đổi tên constraint theo cột | §2 bước 7 |
| MED-nogenerate | Header cả 3 migration ghi **"THUẦN DDL/DATA viết tay — KHÔNG chạy `db:generate`"** | §2–§4 |
| MED-docs | **Cùng commit** vá tài liệu theo 3 phát hiện §0.3/§0.4/§0.7: `DB-13` (§4.2 số FK 2→4 + danh sách FK→users thêm `payslips_generated_by` · §5.7) · `permission-matrix §9g.1` (role tuỳ biến giữ grant) · `docs/erd-current.md` §9 (`payslip_acknowledgements` vào danh sách append-only) — `paths` của WO đã mở sẵn 3 đường này | §2 "cùng commit" |
| LOW-lines | `payroll_period_lines`: UNIQUE là **PARTIAL** `WHERE deleted_at IS NULL`; ON DELETE per-cột theo §8.3 | §2 bước 9 |
| LOW-effrange | `done_when` "CHECK effective-range `salary_profiles`" ⇒ DB-13 §5.1/§6.2 **thay bằng** partial UNIQUE versioned `(company_id,user_id,effective_date)`. Không phải mục bị bỏ | ghi nhận |
| LOW-lock | `lock_timeout '5s'` đặt ở **cả ba** migration (0565 re-stamp CHECK `audit_logs`, 0566 CHECK `notifications` đều lấy ACCESS EXCLUSIVE) | §3 · §4 |
| LOW-cols | §0 bổ sung đo **danh sách cột hiện có** 6 bảng trước `ADD COLUMN` (tránh `42701` trên DB đã lệch) — chạy ngay trước khi viết 0564 | §0 |
| OPEN-roles | Hệ quả §0.7 (3 role tuỳ biến về 0 cặp PAYROLL) nâng từ "ghi trong PR" thành **mục checklist bàn giao + `notes` của WO trong `harness/backlog.mjs`** | bàn giao |

---

## 9. VÁ SAU FULL GATE (2026-09-01) — security BLOCK · database PASS · silent-failure 2 mục

| Reviewer | Verdict | Kết quả |
| --- | --- | --- |
| `security-reviewer` | **BLOCK** → đã vá | 2 HIGH + 4 MEDIUM + 2 LOW |
| `ecc:database-reviewer` | **PASS** | 1 MEDIUM đã vá · 1 LOW để ngỏ |
| `ecc:silent-failure-hunter` | 2 mục | 1 đọc nhầm (làm rõ comment) · 1 thật (gỡ assert tautology) |

### 9.1 [HIGH-1] Nhánh (1) của trigger di sản làm HAI việc — §8.1 chỉ nhận ra MỘT

§8.1 kết luận "chỉ nhánh (1) ép FSM chữ thường bị bỏ, ba nhánh còn lại giữ". **Vẫn thiếu:** nhánh (1) của
`0098:113-119` cấm **mọi** đổi `status` sau khi rời `draft` — tức nó ép cả **tính TERMINAL**, và chính đó là
NEO giữ cho các nhánh đóng băng tiền không bị vòng qua:

```text
hàng Approved, chưa consume:
  1. UPDATE … SET status='Pending'   → (A) không kể `status` · (D) đòi OLD.status='Pending' ⇒ LỌT
                                        CHECK decided_pair cũng cho qua (vế `status = 'Pending'`)
  2. UPDATE … SET amount=99999999    → OLD.status='Pending', chưa consume ⇒ v_frozen=false ⇒ LỌT
  3. duyệt lại                        → khoản tiền đã bị đổi sau khi duyệt, 0 vết
```

⇒ dựng lại thành **nhánh (E)**: `OLD.status <> 'Pending' AND NEW.status IS DISTINCT FROM OLD.status → RAISE`.
KHÔNG mâu thuẫn `check-cannot-enforce-fsm-transitions`: (E) không ép **đồ thị** chuyển tiếp (việc của service,
PAYROLL-ERR-011/012/013) mà ép một **bất biến cần so OLD/NEW** — thứ CHECK không diễn đạt được.
**Bài học chung:** khi gỡ một nhánh trigger di sản, phải kể ra TỪNG VIỆC nhánh đó làm, không phải từng nhánh.

### 9.2 [HIGH-2] `four_eyes_check` RỖNG khi `submitted_by IS NULL` — và diff tự tạo mẫu code dùng lối thoát

`CHECK (approved_by IS NULL OR submitted_by IS NULL OR approved_by <> submitted_by)`: vế thứ hai là **bắt buộc**
(bảng RESET SPEC-11 §13.1 xoá `submitted_*` khi reject/reopen), nhưng một mình nó ⇒ chỉ cần để `submitted_by`
NULL là four-eyes vô hiệu — ghi thẳng kỳ `Approved` với `approved_by` = chính người tính.
DB-13 §6.3 liệt kê 7 CHECK và **không có** `submitted_pair` ⇒ lỗ có từ thiết kế.

⇒ thêm `payroll_periods_submitted_pair_check` (`status NOT IN ('Reviewing','Approved','Paid','Locked') OR
(submitted_by IS NOT NULL AND submitted_at IS NOT NULL)`). Tương thích bảng RESET: `reject` hạ về `Calculated`,
`reopen` hạ về `CollectingData` — cả hai NGOÀI danh sách nên xoá `submitted_*` cùng lệnh vẫn hợp lệ.

⚠️ Nghiêm trọng hơn CHECK: `demo-seed-full.mjs` của commit đầu **ghi comment hướng dẫn dùng đúng lối thoát đó**
("demo KHÔNG ghi submitted_by, vế `submitted_by IS NULL` cho qua"). demo-seed là thứ người viết BE-1 ĐỌC VÀ CHÉP
⇒ đã sửa dùng **hai actor khác nhau**. **Bài học:** fixture/demo là bề mặt API của bất biến, không phải phụ lục.

### 9.3 Census quyền: lọc theo SCOPE thì mù, không lọc thì đỏ ngẫu nhiên

Verify wildcard (0565) và int-spec D1/D6 ban đầu lọc `r.company_id IS NULL` (chép khuôn S12). Nhưng **chính §0.7
của WO này** phát hiện 3 role TUỲ BIẾN của tenant (`company_id NOT NULL`) đang giữ quyền lương ⇒ câu census mù
với đúng nhóm vừa tìm ra. Bỏ lọc thì D1 đỏ ngẫu nhiên vì `SuperAdminBootstrapService` cấp catalog per-pair lúc
boot (tuỳ thứ tự chunk).
⇒ **loại `super-admin` theo TÊN, quét mọi scope.** Một thay đổi đóng cả hai.

### 9.4 Mục còn lại đã vá

| # | Nội dung |
| --- | --- |
| MED (db-reviewer) | Nhánh (A) thêm `decided_by`/`decided_at` — trigger di sản không đóng băng `approved_by/at` ⇒ gán lại NGƯỜI DUYỆT một khoản tiền trong im lặng. Rewrite trigger là dịp đóng. |
| MED | Census `object_permissions` = 0 hàng trỏ 17 cặp (verify 0565 + D11) — object grant thoả **thẳng** cổng sensitive, mạnh hơn wildcard; (6.5)/D2 chỉ soi `hr-manager`. |
| MED | `payslipItemSchema.meta` (jsonb tự do, cạnh `amount` đã mask) vào cùng cổng `.optional()`. |
| LOW | Verify `export:payroll ⇒ view-line` (SPEC-11 §11.1, bài học RECRUIT H5) + D12. |
| LOW | demo-seed tự tạo `attendance_period` thay vì để NULL (`LIMIT 1` có thể NULL ⇒ 23514 hỏng **cả lượt** seed). |
| LOW (sf-hunter) | Gỡ assert tautology `expect(x).toBe(x)` ở ca A1. |

### 9.5 Để NGỎ — bàn giao, không vá ở WO này

- **`bonus_penalties(payroll_period_id)` không có index dẫn đầu** cho đường "nhả consume" (`WHERE
  payroll_period_id = X`, SPEC-11 §13.3). DB-13 §8 **không liệt kê** index này ⇒ thêm ở đây là vượt phạm vi và
  đoán mò. Bàn giao **BE-2** (WO viết đường recalc): đo `EXPLAIN` trên dữ liệu thật rồi quyết
  (`idx-scan-zero-is-not-unused` · `pg-planner-index-assert-trap`).
- `security-reviewer` và `database-reviewer` đều dừng sớm ở mốc chi phí; `silent-failure-hunter` chưa soi
  `seed.ts` · `fk-tenant-verdicts.ts` · `rls-registry.ts` · 2 int-spec · `demo-seed-full.mjs`.
  Phần `seed.ts`/`fk-tenant-verdicts.ts` **đã được `database-reviewer` phủ** (xác nhận thứ tự teardown + FK).
  Còn lại là vùng test/fixture, rủi ro thấp hơn vùng DDL/quyền.

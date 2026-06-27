# S3-ATT-DB-1 — Micro-plan: Migration ATT Core (DB-04)

> WO đỏ/crown · lane db-migration NỐI TIẾP (head idx 131 / `0451`, when=1717500650000 → **idx 132 / `0452_*` / when=1717500655000**). Nguồn chuẩn: **DB-04** §6-7. Bất biến: CLAUDE.md §2/§3/§9. Reconcile-first: SPEC thắng.
> **Rev 2 (2026-06-26)** — vá theo plan-reviewer (BLOCK→fix): FK target thật, RLS-ordering, append-only GRANT, rls-registry enumerate, NULLABLE deviation, dup coexistence.

## 0. TL;DR + quyết định cần CHỐT
DB-04 đụng tên bảng `attendance_records`/`attendance_adjustment_requests` với code media-era (khoá `user_id` cũ) → **Option A: evolve ADDITIVE** (ALTER-ADD nullable + build 7 bảng mới). **CRITICAL từ review**: DB-04 ghi FK `employees`/`departments` **KHÔNG tồn tại** → bảng thật là `employee_profiles` / `org_units`. Cần owner chốt Option A.

---

## 1. ⚠️ BẢN ĐỒ TÊN DB-04 → QUAN HỆ THẬT (bắt buộc — KHÔNG viết FK theo tên DB-04)
| DB-04 ghi | Quan hệ THẬT trong code | Ghi chú |
| --- | --- | --- |
| `employees(id)` | **`employee_profiles(id)`** (`schema/employees.ts`) | KHÔNG có bảng `employees`. `employee_profiles` IS the employee. |
| `departments(id)` | **`org_units(id)`** (`schema/org.ts`, type='department') | KHÔNG có bảng `departments`. |
| `positions(id)` | `positions(id)` | tồn tại — FK OK |
| `users(id)` | `users(id)` | OK |
| `files(id)` | `files(id)` (`schema/files.ts`) | tồn tại — `photo_file_id`/`attachment_file_id` FK OK (hoặc để UUID trần nếu muốn an toàn) |
| `leave_requests(id)` | `leave_requests` (`schema/hr.ts`) | tồn tại NHƯNG `attendance_records.leave_request_id` = **UUID TRẦN (logic FK, KHÔNG hard-FK)** theo DB-04 |
| `tasks(id)` | `tasks(id)` (`schema/workflow.ts`) | giữ Task-Hub bridge cũ |

**Mọi FK trong 9 bảng phải dùng cột PHẢI bên trên** (shift_assignments/attendance_rules/logs/adjustment/remote_work đều có employee_id→employee_profiles, department_id→org_units).

---

## 2. Hiện trạng (recon) — không đổi
Media-era `hr.ts`: `work_schedules` · `attendance_records`(user_id, status lowercase) · `attendance_adjustment_requests`(user_id+taskId) · `attendance_periods`(period lock). Consumer: `apps/api/src/attendance/**` (đọc `userId`/`status`); `payroll.ts` chỉ import `attendancePeriods` (KHÔNG đọc attendance_records → rủi ro payroll thấp). 6+1 bảng DB-04 thiếu hẳn.

## 3. Option A — Evolve ADDITIVE (KHUYẾN NGHỊ, cần owner chốt)
- `attendance_records`: **ALTER ADD các cột DB-04 §7.4 dạng NULLABLE (TẤT CẢ nullable — KHÔNG NOT NULL)** để không rewrite/fail trên row cũ. Cột mới gồm: `employee_id uuid → employee_profiles(id)`, `department_id uuid → org_units(id)`, `position_id uuid → positions(id)`, `shift_id uuid → shifts(id)`, `applied_rule_id uuid → attendance_rules(id)`, `attendance_status text` (CHECK TitleCase, tên `chk_attendance_records_attendance_status` — **KHÁC** cột `status` lowercase cũ), `attendance_source`, `work_mode`, `required_working_minutes/working_minutes/missing_minutes/overtime_minutes/break_minutes int`, `is_late/is_early_leave/is_missing_check_in/is_missing_check_out/is_adjusted/is_auto bool`, `first_log_id/last_log_id uuid` (**UUID TRẦN, KHÔNG FK** — tránh cycle records↔logs theo DB-04 DDL), `leave_request_id uuid` (UUID trần), `remote_work_request_id uuid → remote_work_requests(id)`, `check_in_status/check_out_status`, `locked_at/locked_by`, `calculation_snapshot jsonb`, `metadata jsonb`, `created_by/updated_by/deleted_by`.
  - **Cột cũ GIỮ**: `user_id`(NOT NULL), `status`(lowercase), `work_schedule_id`, `attendance_records_company_user_date_uq` → module cũ + payroll KHÔNG vỡ.
  - **Backfill** (migrator chạy = owner role, bypass RLS): `UPDATE attendance_records ar SET employee_id = ep.id FROM employee_profiles ep WHERE ep.user_id = ar.user_id AND ep.company_id = ar.company_id AND ep.deleted_at IS NULL;` (join 1:1 do `employee_profiles_company_user_active_uq`). employee_id còn NULL nếu user chưa link employee = chấp nhận (tighten ở S3-ATT-BE decommission).
- `shifts`: **build MỚI** §7.1 (canonical). `work_schedules` GIỮ (module cũ) — park.
- `attendance_adjustment_requests`: **ALTER ADD nullable** employee_id→employee_profiles + request_type + (cột DB-04 §7.6) ; GIỮ user_id/taskId. CHECK request_type tên mới, KHÔNG đụng `att_adj_status_check` cũ.
- **Build MỚI 7 bảng**: `shifts`, `shift_assignments`, `attendance_rules`, `attendance_logs`, `attendance_adjustment_items`, `remote_work_requests`, `remote_work_request_approvals` (đầy đủ DB-04 §7).
- **Thứ tự trong migration**: tạo `shifts`/`attendance_rules`/`remote_work_requests` TRƯỚC khi ALTER `attendance_records` add FK trỏ chúng. `attendance_logs` sau (records FK-less tới logs nên không kẹt cycle).

## 4. Bất biến PHẢI giữ (acceptance — vá theo review)
1. **RLS thứ tự (Invariant #1)**: mỗi bảng MỚI theo đúng template mig `0451`, THỨ TỰ: (a) CREATE TABLE (`company_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id',true),'')::uuid`), (b) `ENABLE ROW LEVEL SECURITY` + `FORCE`, (c) `CREATE POLICY tenant_isolation ... USING + WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)` — **dùng LITERAL form này (mirror 0451 dòng 67-69), KHÔNG `current_company()` (hàm này KHÔNG tồn tại)**, (d) indexes, (e) GRANTs. **KHÔNG seed trong 0452** (seed = S3-ATT-SEED-1). `attendance_records`/`adjustment_requests` đã có RLS sẵn (pre-existing) → ALTER-ADD + backfill an toàn.
2. **append-only `attendance_logs` (Invariant #2)** — bảng MỚI nên **GRANT** (KHÔNG "REVOKE"): `GRANT SELECT, INSERT ON attendance_logs TO mediaos_app;` + `GRANT SELECT ON attendance_logs TO mediaos_worker;` — **KHÔNG** cấp UPDATE/DELETE. Cột `deleted_at/deleted_by` giữ để parity nhưng app role không UPDATE được (CLAUDE.md §2 thắng DB-04 §7.5). *(remote_work_request_approvals + attendance_adjustment_items = ledger/append — cân nhắc cùng chính sách append-only; tối thiểu attendance_logs bắt buộc.)*
3. **UNIQUE chống trùng** DB-04 §7.4: `uq (company_id, employee_id, work_date, shift_id) WHERE deleted_at IS NULL AND shift_id IS NOT NULL` + `uq (company_id, employee_id, work_date) WHERE deleted_at IS NULL AND shift_id IS NULL`. **LƯU Ý transitional**: employee_id phần lớn NULL sau backfill → 2 index mới CHƯA enforce (NULL distinct); **guard chống-trùng LIVE vẫn là `attendance_records_company_user_date_uq` (user_id) cũ** tới khi S3-ATT-BE chuyển writer sang employee_id. Index mới = forward-looking. Ghi rõ.
4. **company_id NOT NULL** + RLS+FORCE mọi bảng. FK + RLS lo tenant isolation (**KHÔNG** hứa composite-FK same-company — schema hiện tại không dùng; hạ wording acceptance #4 cũ).
5. **Soft-delete** (deleted_at) cho shifts/assignments/rules/records/adjustment/items?/remote.
6. Migration **idx 132 / `0452_s3_attdb1_att_core` / when=1717500655000**, KHÔNG `db:generate` drop; 1 lane db-migration.

## 5. rls-registry — 7 CASE MỚI (`apps/api/test/integration/rls-registry.ts`)
Thêm `RlsTableCase` cho: `shifts`, `shift_assignments`, `attendance_rules`, `attendance_logs`, `attendance_adjustment_items`, `remote_work_requests`, `remote_work_request_approvals` (mỗi case seed FK-chain: vd attendance_logs cần employee_profiles + optional attendance_record; shift_assignments cần shifts + org_units/employee_profiles). 2 bảng reconcile (`attendance_records`, `attendance_adjustment_requests`) GIỮ case cũ (cột nullable mới không đổi seed). `rls-guards` test fail build nếu thiếu đăng ký → omission = RED, nhưng phải enumerate để builder seed đúng.

## 6. RED tests (viết TRƯỚC, lane `mediaos_attdb1`)
- **append-only `attendance_logs` 3 assertion**: INSERT (app role) OK · UPDATE (app role) **DENY** · DELETE (app role) **DENY**.
- RLS cross-tenant deny (9 bảng) — rls-tenant-isolation-tester.
- UNIQUE anti-dup: với employee_id NON-NULL → 2 record cùng (company,employee,date,shift) vi phạm; biến thể shift_id NULL. (+ ghi rõ guard live hiện là user_id-uq).
- Backfill assert: KHÔNG còn row có `user_id` mà `employee_profiles` tồn tại nhưng `employee_id` vẫn NULL (bắt join hỏng).
- migrate `0000→0452` sạch (migration-smoke) + regression: `attendance` module + `payroll` build/typecheck xanh (cột cũ giữ).

## 7. Rủi ro (cập nhật)
| Rủi ro | Giảm thiểu |
| --- | --- |
| FK viết theo tên DB-04 (employees/departments) → migrate FAIL | §1 bản đồ tên thật BẮT BUỘC; migration-smoke bắt |
| ALTER NOT NULL trên row cũ → fail/rewrite | MỌI cột add = NULLABLE (không default-NOT-NULL) |
| Index unique mới không enforce (employee_id NULL) | Giữ user_id-uq cũ làm guard live; ghi rõ transitional |
| append-only nhầm REVOKE trên bảng mới | Dùng GRANT SELECT,INSERT (không cấp UPDATE/DELETE) |
| CHECK enum đụng tên cũ | Cột `attendance_status` mới ≠ `status` cũ; CHECK tên mới |
| cycle records↔logs FK | first/last_log_id = UUID trần (DB-04 DDL) |
| payroll regression | Chỉ import attendancePeriods; ALTER-add-nullable an toàn; typecheck |

## 8. Quy trình harness còn lại
**plan-reviewer re-review (Rev2) → PASS** → **owner chốt Option A** → db-migration build (schema attendance.ts + ALTER hr.ts tối thiểu + `0452` + RLS/grants/index + 7 rls-registry case + RED) trên lane `mediaos_attdb1` → FULL gate (security-reviewer + rls-tenant-isolation-tester + database-reviewer) → deploy-gate PR (nhãn auto-merge nếu xanh) → người chốt merge.

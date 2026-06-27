# Micro-plan — S3-LEAVE-DB-1 (LEAVE Core migration 0453)

> Lane `L1-leave-core-migration` (Đội 2 Thực thi). Red-zone: migration · RLS · append-only ledger.
> Nối tiếp head **0452** (idx 132) → migration **0453** (idx 133, when 1717500660000 > 1717500655000).
> DDL thủ công (RLS/grant/CHECK không biểu diễn được bằng Drizzle) — **KHÔNG `db:generate`**.

## Nguồn chuẩn

- DB-05 §7.1–7.7 (shape 7 bảng) · §4.6/§4.10/§4.11 (ledger append-only · soft-delete · audit).
- Pattern: mig 0452 (Option A evolve-additive + RLS/FORCE/policy/grant) · attendance.ts · hr.ts.
- BẢN ĐỒ TÊN DB-05 → QUAN HỆ THẬT (KHÔNG có bảng `employees`/`departments`):
  - `employees(id)` → `employee_profiles(id)` · `departments(id)` → `org_units(id)`.
  - `job_levels` · `contract_types` · `positions` · `public_holidays` · `shifts` · `attendance_records` TỒN TẠI → FK thật.

## (A) 4 bảng MỚI

| Bảng | Loại | Soft-delete | GRANT mediaos_app |
| --- | --- | --- | --- |
| `leave_policies` | config | có | SELECT,INSERT,UPDATE |
| `leave_balance_transactions` | **ledger APPEND-ONLY** | KHÔNG (ledger §4.10) | **SELECT,INSERT** |
| `leave_request_days` | detail | có | SELECT,INSERT,UPDATE |
| `leave_request_approvals` | **history APPEND-ONLY** | KHÔNG | **SELECT,INSERT** |

Mỗi bảng: `company_id NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id',true),'')::uuid` + FK companies ·
UUID PK · ENABLE+FORCE RLS · POLICY tenant_isolation (USING+WITH CHECK GUC form mirror 0452) · indexes DB-05.

**Thứ tự BẤT BIẾN #1**: ENABLE+FORCE+POLICY TRƯỚC mọi INSERT/backfill (không có backfill ở lane này).

## (B) ALTER-ADD evolve-additive (MỌI cột NULLABLE, ADD COLUMN IF NOT EXISTS)

- `leave_types` ← DB-05 §7.1 (balance_unit/allow_*/require_*/limits/metadata…). Giữ `code`/`paid`/`status` cũ.
- `leave_requests` ← DB-05 §7.5 (employee_id nullable bên cạnh user_id · leave_request_code · duration_type ·
  half_day_session · balance_effect_status · attendance_sync_status · calculation_snapshot · approver/cancel/revoke…).
- `leave_balances` ← DB-05 §7.3 (employee_id · balance_year · opening/granted/pending/adjusted/… · deleted_at).
  **GIỮ NGUYÊN** `remaining_days` GENERATED ALWAYS AS (total_days-used_days) + CHECK `leave_bal_used_check`
  (used<=total) — CẤM DROP/recreate. KHÔNG re-add `used_days`/`remaining_days`.

## (C) status CHECK union (DB-05 §4.8)

`DROP CONSTRAINT leave_req_status_check` (lowercase) → ADD lại cùng tên = UNION:
lowercase (`pending/approved/rejected/cancelled/draft/revoked`) ∪ TitleCase
(`Draft/Pending/Approved/Rejected/Cancelled/Revoked`). Legacy `pending` vẫn chèn được.

## Drizzle sync

- File MỚI `schema/leave.ts`: 4 pgTable mới (cross-file FK = uuid TRẦN tránh import vòng, FK thật ở migration).
- `schema/hr.ts`: ADD cột additive nullable cho 3 bảng cũ (uuid TRẦN cho FK cross-file) — KHÔNG rewrite định nghĩa cũ.
- `schema/index.ts`: APPEND `export * from "./leave"`.

## Test (RED trước)

1. append-only RED (mirror attendance-logs-appendonly): app role INSERT vào ledger OK; UPDATE/DELETE → /permission denied/.
2. positive RLS: app role (set_config) INSERT leave_requests status='Pending' (TitleCase) + cột DB-05 mới → OK.
3. backward-compat: app role INSERT status='pending' (lowercase) → OK (union không vỡ).
4. tenant isolation: rls-registry 4 case mới + 3 cũ; cross-tenant deny qua rls-tenant-isolation-tester.
5. migration smoke: 0000→head SẠCH trên LANE_DB cô lập (forward-only/no-gap/no-dup).

## Bất biến giữ

RLS+FORCE+policy TRƯỚC INSERT · ledger append-only (no UPDATE/DELETE grant) · không secret plaintext (N/A) ·
hot-file APPEND (status CHECK = UNION giữ giá trị cũ, KHÔNG rewrite mất giá trị legacy).

# Micro-plan — S2-HR-DB-1 (🔴 RED / crown)

> Reconcile HR-Core schema vs DB-03 — **ADDITIVE** (owner chốt 2026-06-24). Giữ model media-era đang chạy,
> nới xung đột spec, thêm bảng thiếu. Nguồn: DB-03 · IMPLEMENTATION-05 §6.1/§12 · ISSUE-BOARD-01 §18.5 (HR-DB-001/002/003).

## 1. Quyết định reconcile (GIỮ / MAP / THÊM)

| Thực thể DB-03 | Hiện trạng | Quyết định |
| --- | --- | --- |
| `employees` | `employee_profiles` (mig 0018) | **GIỮ** (employee_profiles = bảng employee core; API /hr/* expose theo spec, tên bảng nội bộ giữ) |
| `departments` | `org_units` + `teams` (org.ts) | **MAP** ở API layer (S2-HR-BE) — KHÔNG đổi bảng |
| `positions` | `positions` (mig 0017) | **GIỮ** |
| `job_levels` | chỉ `positions.level` int | **THÊM** bảng job_levels |
| `contract_types` | chỉ `employee_profiles.contract_type` text | **THÊM** bảng contract_types (giữ cột text cũ back-compat) |
| `employee_status_histories` | (chưa có) | **THÊM** — append-only (BẤT BIẾN #2) |
| `employee_code_configs` | employee_code text thủ công | **THÊM** — config format; numbering qua sequence_counters (S1-FND-SEQ-1) |
| `employees.user_id` nullable | `user_id NOT NULL` | **NỚI nullable** ở DB (SPEC thắng §7.2: employee có trước, account sau) |

## 2. Thay đổi migration 0442 (idx 125, nối 0441)

A. **NỚI** `employee_profiles.user_id` DROP NOT NULL (guard is_nullable; widening an toàn — NULL phân biệt trong unique index nên `(company,user) active` vẫn chặn trùng user thật).
B. **THÊM 4 bảng** (company_id NOT NULL DEFAULT current_setting + RLS ENABLE+FORCE + policy tenant_isolation + GRANT, template mig 0017):
   - `job_levels` (code/name/rank_order/status, soft-delete) — app SELECT/INSERT/UPDATE.
   - `contract_types` (code/name/requires_end_date/status, soft-delete) — app SELECT/INSERT/UPDATE.
   - `employee_status_histories` (employee_id→employee_profiles, old/new_status/reason/changed_by/changed_at) — **APPEND-ONLY**: app SELECT/INSERT (KHÔNG UPDATE/DELETE, BẤT BIẾN #2).
   - `employee_code_configs` (prefix/pattern/number_length/allow_manual_override/status, unique company active) — app SELECT/INSERT/UPDATE.
C. **THÊM cột nullable** vào employee_profiles: `job_level_id`→job_levels, `contract_type_id`→contract_types (ON DELETE SET NULL). Giữ `contract_type` text + `base_salary` (KHÔNG drop — back-compat).
D. **THÊM index §12.4** trên employee_profiles: (company_id,status) · (company_id,org_unit_id) · (company_id,direct_manager_id) · (company_id,start_date). `CREATE INDEX IF NOT EXISTS`.

## 3. KHÔNG làm (giữ scope DB)

- KHÔNG sửa service/repo employees (innerJoin user_id → LEFT JOIN = **S2-HR-BE-1/2**). Drizzle `employeeProfiles.userId`: nới `.notNull()` CHỈ nếu typecheck xanh; vỡ → giữ + ghi chú "DB cho NULL, service rework ở BE-2".
- KHÔNG seed master data (= **S2-HR-SEED-1**). KHÔNG đụng org_units/teams/hr.ts (ATT/LEAVE = Sprint 3).
- KHÔNG employee_contracts / profile_change_requests (P1/P2 — S2-HR-BE-3).

## 4. Đích hội tụ (done_when)

| done_when | Verify |
| --- | --- |
| GIỮ/MAP/THÊM rõ ràng; SPEC thắng (user_id nullable) | bảng này + migration; int test user_id nullable insert OK |
| mọi bảng HR có company_id NOT NULL + RLS+FORCE + policy; rls-registry đủ | rls-tenant-isolation-tester PASS (4 bảng mới + employee_profiles) |
| index §12.4 | int test pg_indexes có 4 index mới |
| soft-delete; migrate 0000→head sạch | lane-db-setup chain + full suite xanh |
| append-only status_histories | int test app role UPDATE/DELETE → DENIED |

## 5. RED→GREEN + Gate

RED test viết TRƯỚC (bảng/cột chưa có → đỏ) → áp 0442 → xanh.
FULL gate: security-reviewer + rls-tenant-isolation-tester. Red zone → người chốt (KHÔNG auto-merge).
Nhánh `feat/s2-hr-db-1` base `feat/s2-auth-db-1` (0442 nối 0441 — migration nối tiếp).

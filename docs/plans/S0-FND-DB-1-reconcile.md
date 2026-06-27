<!-- ✅ DONE 2026-06-23 — KHÔNG BUILD LẠI. Deliverable đã committed (cda2a09 — mig 0438 đã TỒN TẠI; head idx 121).
     Tạo migration 0438 MỚI = vỡ journal (dup idx). WO đã verify+gate+close: 3 done_when xanh trên lane DB sạch
     (rls-coverage-assert/rls-guards/foundation-tables-tenant-deny + audit-logs-appendonly), FULL gate PASS
     (security-reviewer + rls-tenant-isolation-tester ISOLATION INTACT). Plan dưới = lịch sử phân rã, GIỮ để trace. -->
<!-- ⚙️ KHỐI MÁY-ĐỌC (auto-loop ĐỌC khối này thay vì phân rã lại; reconcile-refresh trước build). -->
<!-- Phần ỔN ĐỊNH (lanes/acceptanceChecks/testTasks/steps) tái dùng; phần GAP trong prose bên dưới PHẢI đối chiếu lại với code hiện tại. -->
```yaml
wo: S0-FND-DB-1
zone: red
status: done   # cda2a09 — mig 0438 committed; verify+gate PASS 2026-06-23
generated_by: human
reconciled_at: "DONE @ migration head 0438 / idx 121 (cda2a09) — verified + FULL gate PASS 2026-06-23"   # mốc freshness
lanes:
  - id: S0-FND-DB-1
    builder: db-migration
    task: "Migration 0438 (band foundation-db): thêm 11 cột DB-08 §8.5 (nullable, ADD COLUMN IF NOT EXISTS) + 2 index vào audit_logs; parity audit.ts; RED append-only test; journal idx 121"
    paths: ["apps/api/migrations/**", "apps/api/src/db/schema/audit.ts", "apps/api/test/integration/audit-logs-appendonly.int-spec.ts"]
acceptanceChecks:
  - "migration 0438 áp sạch nối tiếp head; 11 cột nullable idempotent (KHÔNG db:generate/drop/rename)"
  - "append-only audit_logs: INSERT qua app role SUCCEED, UPDATE/DELETE DENIED (RED test) — BẤT BIẾN #2"
  - "KHÔNG đụng RLS/policy/FORCE (đã đúng 0003), object_type CHECK (union), grant REVOKE (0432)"
  - "rls-coverage-assert + rls-guards xanh; typecheck xanh"
testTasks:
  - "apps/api/test/integration/audit-logs-appendonly.int-spec.ts — mirror file-access-logs: insert ok / update / delete denied (seed row qua directPool)"
steps:
  - "0438 SQL: 11 cột nullable §8.5 + 2 index (actor_created, action); re-assert GRANT SELECT,INSERT"
  - "audit.ts: 11 cột nullable parity (block 'DB-08 §8.5 ADDITIVE (mig 0438)')"
  - "RED test audit-logs-appendonly + _journal.json append {idx:121, tag:0438}"
```

# S0-FND-DB-1 — Micro-plan (reconcile schema nền vs DB-01/DB-08/DB-10)

> Zone: 🔴 RED / crown (RLS · audit · append-only · migration). Reconcile-first, append-only, spec-wins.
> Migration head: idx 120 / `0437`. Next: `0438`, idx 121, when `1717500560000`, band `foundation-db`.

## 0. Kết quả đối chiếu (đã verify line-level)

| done_when | Trạng thái | Hành động |
| --- | --- | --- |
| #1 RLS+FORCE+policy + rls-registry đủ | ✅ **đã đạt** | Không build. Verify bằng `rls-coverage-assert` + `rls-guards`. 9 bảng nền đã đăng ký `rls-registry.ts` L1901–2115. |
| #2 shape khớp DB-08 | ⚠️ **1 gap thật** | `audit_logs` thiếu 11 cột §8.5. settings/files/sequences/holidays đã khớp. |
| #3 append-only RED test (audit_logs + file_access_logs) | ⚠️ **1 gap** | `file_access_logs` có test; `audit_logs` có REVOKE (0432) nhưng **chưa có** test ghi-rồi-update FAIL. |

**Không có gì để build cho:** companies, modules, system_settings, company_settings, files, file_links, file_access_logs, sequence_counters, public_holidays — tất cả đã có company_id (NOT NULL hoặc nullable-tenant)/RLS ENABLE+FORCE/policy + đăng ký registry.

## 1. Phạm vi thay đổi (CHỈ additive — KHÔNG db:generate, KHÔNG drop/rename)

### A. Migration `0438_foundation_db6_audit_db08_shape.sql` (band foundation-db)
Thêm 11 cột DB-08 §8.5 còn thiếu vào `audit_logs` (tất cả **nullable**, `ADD COLUMN IF NOT EXISTS` — idempotent, không vỡ writer cũ):

| cột | kiểu | ghi chú |
| --- | --- | --- |
| `actor_employee_id` | uuid | **KHÔNG FK** (HR dùng `employee_profiles`, không `employees`) — theo tiền lệ `file_access_logs` (0433). |
| `action_group` | varchar(100) | |
| `entity_id_text` | varchar(255) | id ngoài/đặc biệt dạng text |
| `entity_code` | varchar(255) | mã nghiệp vụ (vd EMP0001) |
| `permission_code` | varchar(150) | quyền dùng khi thực hiện |
| `data_scope` | varchar(50) | Own/Team/Department/Company/System — **KHÔNG CHECK** (spec §8.5 constraints không định nghĩa CHECK cho cột này; app/Zod ép ở tầng service). |
| `device_info` | jsonb | |
| `diff_summary` | text | |
| `error_code` | varchar(100) | |
| `error_message` | text | đã lọc secret (BẤT BIẾN #3) |
| `metadata` | jsonb | |

+ 2 index §8.5 còn thiếu (0432 đã có company_created/entity/request/correlation):
- `idx_audit_logs_actor_created` ON `(actor_user_id, created_at DESC)`
- `idx_audit_logs_action` ON `(company_id, module_code, action, created_at DESC)`

**KHÔNG đụng:** RLS/policy/FORCE (đã đúng từ 0003), object_type CHECK (union append-only — giữ nguyên), grant append-only (REVOKE UPDATE/DELETE đã ở 0432). Re-assert `GRANT SELECT, INSERT ON audit_logs TO mediaos_app;` để hardening (no-op an toàn).

### B. `apps/api/src/db/schema/audit.ts`
Thêm 11 cột nullable tương ứng (drizzle parity) — đặt trong block "DB-08 §8.5 ADDITIVE (mig 0438)". Cập nhật comment header. KHÔNG đổi cột cũ.

### C. Test RED `apps/api/test/integration/audit-logs-appendonly.int-spec.ts`
Mirror `file-access-logs-appendonly.int-spec.ts`:
1. INSERT audit_logs qua app role (tenant ctx) → **SUCCEED** (GRANT SELECT,INSERT).
2. UPDATE audit_logs qua app role → **DENIED** (`rejects.toThrow(/permission denied/)`).
3. DELETE audit_logs qua app role → **DENIED**.
(Seed hàng audit_logs qua superuser `directPool` để có row đem update.)

### D. Journal `apps/api/migrations/meta/_journal.json`
Append entry: `{ idx:121, version:"7", when:1717500560000, tag:"0438_foundation_db6_audit_db08_shape", breakpoints:true }`.

## 2. Bất biến giữ nguyên (crown)
- **#1 tenant:** `audit_logs.company_id` GIỮ `NOT NULL` + RLS/FORCE/policy. **Lệch có chủ đích vs spec** (spec cho nullable cho "system event"): ở N=1 không có sự kiện không-công-ty, NOT NULL mạnh hơn — không nới. Ghi rõ ở header migration.
- **#2 append-only:** không nới UPDATE/DELETE cho audit_logs; test C chứng minh FAIL.
- **#3 no-secret:** `error_message`/`old_values`/`new_values`/`metadata` masking là việc của AuditMaskerService (S1-FND-AUDIT-1) — DB chỉ là cột.

## 3. Deviation giữ nguyên (KHÔNG churn — đã ship, có lý do)
- `public_holidays.is_paid_holiday` (vs spec `is_paid`) — HolidayService đã ship (BE-6, 76e8fac) dùng tên này; đổi sẽ vỡ. Giữ.
- `file_access_logs.actor_employee_id` uuid-no-FK — employees = `employee_profiles`. Giữ (và audit_logs theo cùng tiền lệ).

## 4. Verify (DB cô lập theo lane)
```
bash scripts/lane-db-setup.sh fnddb1
export LANE_DB=mediaos_fnddb1
pnpm --filter @mediaos/api db:migrate        # 0438 áp sạch, nối tiếp head
pnpm --filter @mediaos/api test -- audit-logs-appendonly file-access-logs-appendonly rls-coverage-assert rls-guards foundation-tables-tenant-deny
pnpm --filter @mediaos/api typecheck
```
Đích: migrate sạch từ head; 3 test append-only audit_logs PASS (insert ok, update/delete denied); rls-coverage/rls-guards xanh (không bảng company_id nào thiếu RLS/registry); typecheck xanh.

## 5. Gate
FULL (diff chạm audit/append-only/migration): `security-reviewer` + `database-reviewer`(→ `rls-tenant-isolation-tester`) + `silent-failure-hunter`. Người chốt vùng đỏ trước merge.

## 6. Out-of-scope (KHÔNG làm ở WO này)
- AuditService v2 điền cột mới + masker → **S1-FND-AUDIT-1**.
- Seed modules/settings → **S0-FND-SEED-1**.
- AUTH/RBAC schema → **S0-AUTH-DB-1**.

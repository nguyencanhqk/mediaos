# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-24 15:34Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S2-AUTH-DB-1` Mở rộng RBAC engine: thêm cột data_scope (Own/Team/Department/Company/System) vào role_permissions + CHECK/enum + giữ RLS+FORCE — gỡ nợ DEFERRED của S0-AUTH-DB-1
- 🔴 `S2-HR-DB-1` Reconcile HR-Core schema vs DB-03: departments/positions/job_levels/contract_types/employees/employee_status_histories/employee_code_configs (đối chiếu org media-era orgUnits/teams + employeeProfiles) + RLS+FORCE + index

**CHỜ (kẹt phụ thuộc):**
- `S2-AUTH-SEED-1` Seed/đối chiếu permission catalog AUTH.* + HR.* + default roles + ma trận role→permission CÓ data_scope (IMPLEMENTATION-05 §13) + bootstrap admin; idempotent ⏳ cần: S2-AUTH-DB-1
- `S2-AUTH-BE-1` Đối chiếu login/logout/refresh/session + password verify + login_logs + /auth/me context (user/company/roles/permissions/scopes/modules/employee) với API-02/DB-02 cho luồng user-công-ty ⏳ cần: S2-AUTH-SEED-1
- `S2-AUTH-BE-2` PermissionService + DataScopeResolver dùng-lại-được (Own/Team/Department/Company/System) + guard tích hợp HR API — CROWN: lớp kiểm soát quyền cuối backend ⏳ cần: S2-AUTH-DB-1, S2-AUTH-SEED-1
- `S2-HR-SEED-1` Seed HR master data (job_levels, contract_types, employee_code_config mặc định, demo department/position nếu cần) — idempotent ON CONFLICT ⏳ cần: S2-HR-DB-1
- `S2-HR-BE-1` HR read: GET /hr/employees (list pagination/search/filter/sort + data scope) + /hr/employees/{id} (sensitive masking) + /hr/me/profile + lookup department/position/job-level/contract-type ⏳ cần: S2-HR-DB-1, S2-AUTH-BE-2
- `S2-HR-BE-2` HR write: POST /hr/employees (sinh employee_code tx-safe) + PATCH update + change-status (status_history) + link-user/unlink (unique active link) + audit log ⏳ cần: S2-HR-DB-1, S2-AUTH-BE-2
- `S2-HR-BE-3` Department/Position CRUD cơ bản (reconcile org→HR-Core) + profile-change-request skeleton (table+API stub) — P1, làm nếu còn capacity ⏳ cần: S2-HR-DB-1, S2-AUTH-BE-2
- `S2-FE-AUTH-1` FE Auth: Login page + auth bootstrap (/auth/me) + ProtectedRoute/PublicRoute + PermissionGate/useCan + route/menu/action visibility theo permission (KHÔNG hard-code role) + clear cache khi logout ⏳ cần: S2-AUTH-BE-1
- `S2-FE-HR-1` FE HR read: EmployeeList (table, filter/search, pagination theo scope) + EmployeeDetail (tabs/sections, MaskedField theo quyền sensitive) + MyProfile read-only ⏳ cần: S2-HR-BE-1, S2-FE-AUTH-1
- `S2-FE-HR-2` FE HR write: EmployeeForm create/edit (dropdown lookup department/position/job-level/contract-type, validation, submit mutation + invalidate list/detail) + change-status/link-user action ⏳ cần: S2-HR-BE-2, S2-FE-HR-1
- `S2-QA-AUTH-1` QA AUTH/RBAC: login success/fail/locked/logout/me + RBAC data-scope Own/Team/Department/Company/System + role/permission inactive — deny-path RED, coverage ≥80% ⏳ cần: S2-AUTH-BE-2
- `S2-QA-HR-1` QA HR: employee CRUD + status/link-user + sensitive masking + cross-company isolation + code-gen concurrency 0-dup + FE smoke/E2E (login→list→detail→create) — deny-path RED, coverage ≥80% ⏳ cần: S2-HR-BE-1, S2-HR-BE-2, S2-FE-HR-2

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 1
- **migration head**: idx 123 — `0440_file1_audit_object_type` (124 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-25 00:57Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S2-AUTH-SEED-1` Seed permission/role/role_permission VỚI data_scope đúng từng role + bootstrap admin (idempotent ON CONFLICT) theo permission matrix §13 / API-10

**CHỜ (kẹt phụ thuộc):**
- `S2-AUTH-BE-1` Login/logout/me: password verify + session issue/revoke + login_log + GET /auth/me (user·company·roles·permissions·scopes·employee·modules) ⏳ cần: S2-AUTH-SEED-1
- `S2-AUTH-BE-2` Permission + data-scope resolver guard dùng chung (decorator/middleware): Own/Team/Department/Company/System — lớp kiểm soát quyền cuối cho mọi module ⏳ cần: S2-AUTH-SEED-1
- `S2-AUTH-BE-3` User admin API (P1): list/detail/create/update + lock/unlock + roles/permissions list (search/filter/paginate) ⏳ cần: S2-AUTH-BE-2
- `S2-AUTH-BE-4` Change-password + forgot/reset-password (P1): token hash + expiry/used_at + email mock; đổi mật khẩu khi đã đăng nhập ⏳ cần: S2-AUTH-BE-1
- `S2-HR-SEED-1` Seed HR master data (job_levels·contract_types·employee_code_config + demo department/position) idempotent + seed HR permissions ⏳ cần: S2-AUTH-SEED-1
- `S2-HR-BE-1` HR read core: GET /hr/employees (list/pagination/search/filter/sort/data-scope) + GET /{id} (sensitive masking) + GET /hr/me/profile + lookups ⏳ cần: S2-AUTH-BE-2
- `S2-HR-BE-2` HR write core: POST/PATCH /hr/employees + auto employee-code (tx + SequenceService) + change-status (history) + link/unlink user (unique active) + audit ⏳ cần: S2-HR-BE-1, S2-HR-SEED-1
- `S2-HR-BE-3` Department/position CRUD (P1): create/update/soft-delete + master data manage (job-level/contract-type) ⏳ cần: S2-AUTH-BE-2
- `S2-HR-BE-4` Profile change request skeleton (P1/P2): employee gửi yêu cầu sửa hồ sơ + HR duyệt/từ chối (có thể carry-over Sprint 5 nếu quá tải) ⏳ cần: S2-HR-BE-1
- `S2-FE-AUTH-1` FE Auth: Login page + auth bootstrap (/auth/me) + ProtectedRoute/PublicRoute/PermissionGate/ForbiddenState + menu/action visibility theo quyền ⏳ cần: S2-AUTH-BE-1, S2-AUTH-BE-2
- `S2-FE-HR-1` FE HR: EmployeeList (table/filter/search/pagination) + EmployeeDetail (tabs, masked sensitive state) nối API thật ⏳ cần: S2-HR-BE-1, S2-FE-AUTH-1
- `S2-FE-HR-2` FE HR: EmployeeForm (create/edit) + dropdown lookups + validation + submit mutation + invalidate list/detail ⏳ cần: S2-HR-BE-2, S2-FE-HR-1
- `S2-FE-HR-3` FE: MyProfile (read-only) + user/role read-only placeholder (P1, KHÔNG chặn Sprint 3) ⏳ cần: S2-HR-BE-1, S2-FE-AUTH-1
- `S2-INT-1` Tích hợp HR tạo employee ↔ AUTH tạo/link user (giao dịch nhất quán, unique active link, audit cả 2 phía) ⏳ cần: S2-HR-BE-2, S2-AUTH-BE-3
- `S2-INT-2` Tích hợp HR direct_manager ↔ data-scope Team/Department của permission resolver (approval scope nền cho LEAVE/ATT sau) ⏳ cần: S2-HR-BE-1, S2-AUTH-BE-2
- `S2-QA-1` QA AUTH + RBAC/data-scope: login success/fail/locked/logout/me + Own/Team/Department/Company/System cho HR list/detail ⏳ cần: S2-AUTH-BE-2, S2-HR-BE-1
- `S2-QA-2` QA HR CRUD + FE smoke + regression: employee create/update/status/link-user + login/route-guard/list/detail/create + checklist Sprint 2 ⏳ cần: S2-HR-BE-2, S2-FE-HR-2

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-HR-DB-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 3
- **migration head**: idx 126 — `0443_s2_authdb2_sessions_logs_security_events` (127 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

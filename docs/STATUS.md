# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 04:44Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S2-AUTH-BE-6 — Role write API (P1): POST/PATCH /auth/roles (create/update, KHÔNG sửa system role) + assign/revoke permission cho role (role_permissions) có audit — unblock S2-FE-AUTH-4
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/permission/**`, `apps/api/src/users/**`, `apps/api/src/db/schema/**`, `apps/api/migrations/**`, `packages/contracts/src/**`
- **phụ thuộc**: S2-AUTH-BE-3✓
- **done_when (đích hội tụ)**:
  - [ ] POST /auth/roles tạo role (company-scope) + PATCH /auth/roles/:id sửa name/description; role system-defined → KHÔNG cho sửa/xoá; permission guard AUTH.ROLE.CREATE/UPDATE
  - [ ] assign/revoke permission cho role (ghi role_permissions add/remove) qua AUTH.PERMISSION.ASSIGN; ghi audit RoleUpdated/PermissionAssigned trong tx withTenant; permission sensitive KHÔNG auto-grant qua wildcard
  - [ ] SCOPE CEILING (crown — chống leo thang, plan-review 2026-07-01): data_scope gán cho role BẮT BUỘC ≤ Company (canonical Own<Team<Department<Company<System; mig 0441 CỐ Ý DEFAULT 'Company' KHÔNG 'System' để không nới scope). Service REJECT 400 khi dataScope='System' (tenant-admin KHÔNG được gán System = mở lại đúng cái 0441 tránh); lý tưởng CLAMP dataScope ≤ scope actor THỰC giữ (fail-closed, mirror AC-5 userGrantsPermissionIds). RED test: 'assign dataScope=System → 400, 0 role_permissions, 0 audit'
  - [ ] ANTI-ESCALATION (crown, CHỐT 2026-07-02): pin (assign,permission) CHỈ company-admin (KHÔNG ép ≤ grant thực actor — N=1 chưa có non-admin giữ assign:permission, để dành phòng xa cho lúc thực sự cấp per-user). Cặp KHÔNG có trong catalog (findPermissionId=undefined) → 400 (KHÔNG 500/FK error). RED test: 'unknown pair → 400, 0 row, 0 audit'
  - [ ] AUDIT truy vết được: PermissionAssigned/Revoked objectType='role_permission' NHƯNG objectId=role.id (role_permissions không có uuid PK — key = role_id/permission_id/effect) + before/after={action,resourceType,effect,dataScope} đã mask; KHÔNG objectId NULL. Migration (audit object_type CHECK UNION-ADD 'role_permission' + sync AUDIT_OBJECT_TYPES cùng commit) đánh số SAU head ĐÃ MERGE (0456 đã thuộc PR #60 chưa merge → chờ #60 merge rồi số 0457+; verify meta/_journal.json idx+when đơn điệu trên LANE_DB cô lập)
  - [ ] deny-path RED viết-TRƯỚC: thiếu quyền → 403 + 0 audit; 2-tenant KHÔNG sửa role công ty khác (withTenant+RLS); FULL gate (security-reviewer) + người chốt

### 🔴 S2-AUTH-BE-7 — Session management API (P1): GET /auth/sessions (phiên của CHÍNH user) + revoke 1 phiên + revoke-all-others — hoàn tất user_sessions (DEFERRED ở BE-1) — unblock S2-FE-AUTH-5
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/auth/**`, `apps/api/src/db/schema/audit.ts`, `apps/api/migrations/**`, `packages/contracts/src/**`
- **phụ thuộc**: S2-AUTH-BE-1✓
- **done_when (đích hội tụ)**:
  - [ ] reconcile user_sessions: login đã dual-write (BE-1) — nếu shape thiếu field cho list (device/ip/last_seen/created) thì migration bổ sung NỐI TIẾP head; GET /auth/sessions liệt kê phiên ACTIVE của CHÍNH user (Own scope, Authenticated), KHÔNG lộ session/refresh token/hash
  - [ ] POST /auth/sessions/:id/revoke thu hồi 1 phiên của CHÍNH user + POST /auth/sessions/revoke-others (giữ phiên hiện tại); phiên bị revoke → refresh/next request fail-closed; ghi audit SessionRevoked trong tx withTenant
  - [ ] AUDIT object_type (CHỐT 2026-07-02): union-add 'user_session' vào AUDIT_OBJECT_TYPES (apps/api/src/db/schema/audit.ts) + CHECK audit_logs CÙNG commit migration (mẫu UNION-ADD 0456); apps/api/src/db/schema/audit.ts PHẢI nằm trong paths lane DB (không out-of-scope guard-scope)
  - [ ] PERMISSION (CHỐT 2026-07-02): session self-service = CHỈ Authenticated + owner-check ở service (KHÔNG cần permission pair riêng, giống pattern /auth/me) — KHÔNG seed pair mới
  - [ ] currentSessionId (CHỐT 2026-07-02): lấy từ session id trong access-token claim/jti của request ĐÃ auth (KHÔNG suy đoán theo thiết bị/IP) — revoke-others dùng giá trị này để loại trừ phiên hiện tại
  - [ ] deny-path RED viết-TRƯỚC: revoke phiên user khác → 403/404; 2-tenant KHÔNG thấy/thu hồi phiên công ty khác (withTenant+RLS); no-secret-log; FULL gate (auth crown — security-reviewer) + người chốt

### 🔴 S2-HR-BE-6 — Employee contracts (carry-over STORY-031): migration employee_contracts (RLS+FORCE) + CRUD API /hr/contracts + /hr/employees/:id/contracts + file link + cảnh báo hết hạn — unblock S2-FE-HR-7
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/db/schema/**`, `apps/api/migrations/**`, `apps/api/src/employees/**`, `packages/contracts/src/**`
- **phụ thuộc**: S2-HR-DB-1✓, S1-FND-FILE-1✓
- **done_when (đích hội tụ)**:
  - [ ] migration tạo bảng employee_contracts khớp DB-03: company_id NOT NULL · UUID PK · soft-delete · audit cols; employee_id UUID NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE (KHÔNG bảng 'employees' — không tồn tại, đã reconcile sang employee_profiles); contract_type_id NOT NULL REFERENCES contract_types(id); RLS ENABLE+FORCE + policy company_id TRƯỚC backfill; rls-registry đăng ký (BẤT BIẾN #1); index (employee_id, status, effective dates)
  - [ ] CRUD API GET /hr/contracts + GET /hr/employees/:id/contracts + POST/PATCH; permission pair (CHỐT 2026-07-02, pin đúng resource_type='contract'): ('view','contract') cho VIEW + ('manage','contract') cho create/update/delete — @RequirePermission dùng đúng cặp này, KHÔNG hard-code chuỗi khác; file hợp đồng link qua FileService (S1-FND-FILE-1) entity 'contract'; cảnh báo sắp hết hạn (ngưỡng 30 ngày mặc định)
  - [ ] SCOPE (CHỐT 2026-07-02): view:contract CHỈ data_scope='Company' cho hr/company-admin — employee/manager KHÔNG có Own/Team, gọi GET contract → 403 (KHÔNG lọc rỗng). Deny-path RED: employee/manager gọi GET /hr/contracts hoặc /hr/employees/:id/contracts → 403
  - [ ] AUDIT object_type (CHỐT 2026-07-02): union-add 'employee_contract' vào AUDIT_OBJECT_TYPES (apps/api/src/db/schema/audit.ts) + CHECK audit_logs CÙNG commit migration (mẫu UNION-ADD 0456); mỗi Create/Update/Link/Delete PHẢI ghi 1 audit row trong tx (KHÔNG audit-ma khi mutation fail rollback)
  - [ ] DTO list/detail KHÔNG lộ trường nhạy cảm ngoài allowlist (note/metadata/title không chứa lương/PII chưa mask) — test khẳng định
  - [ ] deny-path RED viết-TRƯỚC: thiếu quyền → 403; 2-tenant deny (withTenant+RLS, gồm contract_type cross-tenant); audit thao tác; migration NỐI TIẾP head THEO journal idx thực tế (verify _journal.json, KHÔNG tin tên file/STATUS); FULL gate (migration + PII) + người chốt

### 🟡 S3-FE-LEAVE-4 — FE LEAVE Calendar (/leave/calendar, own/team/company theo scope)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S3-LEAVE-BE-5✓, S3-FE-LEAVE-1✓
- **done_when (đích hội tụ)**:
  - [ ] /leave/calendar (LeaveCalendarPage): lịch nghỉ theo scope nối GET /leave/calendar; toggle own/team/company theo quyền; PermissionGate LEAVE.CALENDAR.VIEW_OWN/TEAM/COMPANY
  - [ ] KHÔNG lộ người ngoài scope (server đã lọc); loading/empty/error/forbidden
  - [ ] KHÔNG hard-code; web test xanh; typecheck xanh

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S2-FE-AUTH-2` FE Auth self-service: forgot-password + reset-password + session-expired (apps/auth) + /account/change-password nối API thật
- 🟡 `S2-FE-AUTH-3` FE User admin CRUD (/system/users): create + detail + edit + assign-roles nối /auth/users (thay read-only placeholder)
- 🟡 `S2-FE-FND-2` FE FOUNDATION admin: Audit log viewer (/system/audit-logs + detail, thay ModulePlaceholder) + File metadata viewer (/system/files + detail)
- 🟡 `S2-FE-FND-3` FE FOUNDATION admin: Module Catalog (/system/modules + /:code detail) nối admin module API — read-only trước
- 🟡 `S2-FE-FND-4` FE FOUNDATION admin: Public Holidays (/system/public-holidays list+CRUD) + Health Check (/system/health read-only status) — BE sẵn
- 🟡 `S2-FE-FND-5` FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only)
- 🟡 `S2-FE-FND-6` FE FOUNDATION admin: Retention Policies (/system/retention config) + File Access Logs viewer (/system/file-access-logs)
- 🟡 `S2-FE-HR-4` FE HR Profile change-request workflow: /hr/me/change-request (self gửi YC) + /hr/profile-change-requests (HR duyệt list) + /:id (detail + approve/reject/cancel)
- 🟡 `S2-FE-HR-6` FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/audit-logs, tái dùng foundation audit filter module=HR)
- 🟡 `S2-FE-HR-8` FE HR Employee-code config: /hr/settings/employee-code (form cấu hình mã NV + preview live) nối admin API
- 🔴 `S3-ATT-BE-5` ATT Remote/Onsite-work request workflow API (CO-S4-004): remote_work_requests create/list/detail + approve/reject + ảnh hưởng tính công + audit + event (skeleton 0452 → hoàn thiện)
- 🟡 `S3-FE-ATT-3` FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + /records/:id/adjust): tạo/duyệt/điều chỉnh trực tiếp

**CHỜ (kẹt phụ thuộc):**
- `S2-FE-AUTH-4` FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog ⏳ cần: S2-AUTH-BE-6
- `S2-FE-AUTH-5` FE Account self-service: /account/sessions (list + revoke phiên của chính user) ⏳ cần: S2-AUTH-BE-7
- `S2-FE-HR-7` FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API ⏳ cần: S2-HR-BE-6
- `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR ⏳ cần: S3-INT-1
- `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression ⏳ cần: S3-INT-1
- `S3-FE-ATT-4` FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt ⏳ cần: S3-ATT-BE-5
- `S3-FE-ATT-6` FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs) ⏳ cần: S3-ATT-BE-6
- `S3-LEAVE-BE-6` LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE) ⏳ cần: S3-LEAVE-BE-4
- `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions ⏳ cần: S3-LEAVE-BE-4, S3-LEAVE-BE-6
- `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) ⏳ cần: S3-LEAVE-BE-6

**🛑 BLOCKED:**
- `S3-LEAVE-BE-4` LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)
- `S3-INT-1` LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004)
- `S3-ATT-BE-6` ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổng hợp theo scope) + /attendance/audit-logs (tái dùng foundation audit filter module=ATT)

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-FND-1`, `S2-FND-BE-1`, `S2-FND-BE-2`, `S2-FND-BE-3`, `S2-FE-HR-5`, `S2-HR-BE-7`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-ATT-BE-4`, `S3-FE-ATT-5`, `S3-LEAVE-BE-5`, `S3-FE-LEAVE-3`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 3
- **migration head**: idx 136 — `0456_s2_fndbe3_retention_audit_object_type` (137 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `911179b` | 2026-07-02 | wip(HR5-SCREENS): HR master-data admin screens (departments/positions/job-levels/contract-types) |
| `178dfa3` | 2026-07-02 | chore(harness): reconcile plan_block feedback into done_when for 6 blocked WOs |
| `dcb0f34` | 2026-07-02 | chore(harness): reconcile S2-FE-FND-1 + S2-HR-BE-7 (PR #79 merged) + S3-FE-LEAVE-3 (duplicate stray commit) + regen STATUS |
| `899f48a` | 2026-07-02 | wip(HR5-WC): web-core HR master-data spine (api + pairs + routes + i18n + drift-guard) |
| `271bc40` | 2026-07-02 | chore(harness): reconcile S3-ATT-BE-4 + S2-FND-BE-1 stale ledger entries + reopen S2-FND-BE-2 + regen STATUS (#75) |
| `df6d468` | 2026-07-02 | chore(harness): regen STATUS after wave3 round 1 (#71) |
| `b91f9bd` | 2026-07-01 | chore(harness): commit stray plan docs from prior wave + regen STATUS (#67) |
| `602fa2b` | 2026-07-01 | chore(harness): move crown-jewel PLAN stage to Sonnet 5 to cut cost (#66) |
| `3c89694` | 2026-07-01 | feat(sprint3): S3 ATT/LEAVE core slice — registry spine + FE screens + approval FSM + foundation retention (#65) |
| `3b132ef` | 2026-07-01 | chore(harness): seed FE screen-coverage WOs + master-plan update (#57) |
| `8115bfa` | 2026-06-27 | feat(s3): Sprint 3 wave 1 — ATT + LEAVE backend spine + seeds (+ S2-AUTH-BE-5 viewer) (#56) |
| `05cdcc4` | 2026-06-27 | feat(harness): auto-reconcile merged-but-unstamped WOs in gen-status (#47) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

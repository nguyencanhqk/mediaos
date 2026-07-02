# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 06:43Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🟡 S2-FE-AUTH-2 — FE Auth self-service: forgot-password + reset-password + session-expired (apps/auth) + /account/change-password nối API thật
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/auth/**`, `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-AUTH-BE-4✓, S2-FE-AUTH-1✓
- **done_when (đích hội tụ)**:
  - [ ] /forgot-password (apps/auth): form email (RHF+Zod) → POST /auth/forgot-password (skipAuth); thông báo GENERIC KHÔNG tiết lộ email tồn tại; link quay lại /login; lỗi rate-limit hiển thị mềm
  - [ ] /reset-password (apps/auth): token lấy từ query-string → POST /auth/reset-password; validate rule mật khẩu + confirm; token sai/hết hạn/đã dùng → lỗi chuẩn KHÔNG lộ user; thành công → điều hướng /login
  - [ ] /session-expired (apps/auth): trang tĩnh + CTA đăng nhập lại (redirect SSO qua getAuthRedirectUrl); wire nhánh refresh-fail của web-core
  - [ ] /account/change-password (apps/app): mật khẩu cũ + mới + confirm → POST /auth/change-password; thành công → BE revoke session → điều hướng /login; loading/error rõ; PermissionGate AUTH.PASSWORD.CHANGE
  - [ ] token KHÔNG vào localStorage/sessionStorage + KHÔNG console.log (BẤT BIẾN #3 — grep chặn); loading/empty/error; web test apps/auth + apps/app xanh; typecheck xanh

### 🟡 S2-FE-AUTH-3 — FE User admin CRUD (/system/users): create + detail + edit + assign-roles nối /auth/users (thay read-only placeholder)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-AUTH-BE-3✓, S2-FE-HR-3✓
- **done_when (đích hội tụ)**:
  - [ ] /system/users/new: form tạo user (RHF+Zod) → POST /auth/users; mật khẩu hash ở SERVER; validation + error state; PermissionGate AUTH.USER.CREATE
  - [ ] /system/users/:id: detail đọc GET /auth/users/:id — thông tin + roles + trạng thái; nút lock/unlock → POST /auth/users/:id/lock|unlock (PermissionGate AUTH.USER.*); invalidate detail sau thao tác
  - [ ] /system/users/:id/edit: PATCH /auth/users/:id CHỈ dirty fields; dirty-form guard; thành công → invalidate list/detail
  - [ ] /system/users/:id/roles: gán/gỡ role cho user từ catalog GET /auth/roles; PermissionGate AUTH.USER.ASSIGN_ROLE
  - [ ] KHÔNG hard-code role (PermissionGate/useCan); direct URL thiếu quyền → ForbiddenState 403; loading/empty/error; web test xanh; typecheck xanh

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

### 🟡 S2-FE-FND-2 — FE FOUNDATION admin: Audit log viewer (/system/audit-logs + detail, thay ModulePlaceholder) + File metadata viewer (/system/files + detail)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S1-FND-AUDIT-1✓, S1-FND-FILE-1✓, S1-FE-REGISTRY-1✓
- **done_when (đích hội tụ)**:
  - [ ] /system/audit-logs (+ /:id detail): THAY ModulePlaceholder — bảng audit nối GET /foundation/audit-logs (Company) + /all (System scope nếu đủ quyền) filter module/action/actor/entity/from-to + pagination/sort whitelist; detail GET /foundation/audit-logs/:id; field nhạy cảm ĐÃ mask do server (§6.5)
  - [ ] /system/files (+ /:id detail): bảng file metadata GET /foundation/files + detail /:id; KHÔNG lộ storage_path/signed-url dài hạn; download qua GET /foundation/files/:id/download (backend-mediated, §6.4)
  - [ ] KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh

### 🟡 S2-FE-FND-3 — FE FOUNDATION admin: Module Catalog (/system/modules + /:code detail) nối admin module API — read-only trước
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-FND-BE-1✓, S1-FE-REGISTRY-1✓
- **done_when (đích hội tụ)**:
  - [ ] /system/modules: bảng module catalog nối GET /foundation/modules (admin, tất cả module) — code/name/active/enabled; filter/search; PermissionGate FOUNDATION.MODULE.VIEW (cặp seed thật)
  - [ ] /system/modules/:code: detail module (metadata/required-permissions/enabled); toggle enable/disable CHỜ BE follow-up (read-only trước — KHÔNG dựng nút mutation chết)
  - [ ] KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh

### 🟡 S2-FE-FND-4 — FE FOUNDATION admin: Public Holidays (/system/public-holidays list+CRUD) + Health Check (/system/health read-only status) — BE sẵn
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S1-FE-REGISTRY-1✓
- **done_when (đích hội tụ)**:
  - [ ] /system/public-holidays: list + CRUD nối GET/POST/PATCH/DELETE /foundation/public-holidays; PermissionGate FOUNDATION.HOLIDAY.VIEW + manage (cặp seed THẬT — KHÔNG hard-code nhãn); confirm khi xoá
  - [ ] /system/health: đọc GET /health + /health/db hiển thị trạng thái (db/uptime); PermissionGate FOUNDATION.HEALTH.VIEW (System); read-only
  - [ ] KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh

### 🟡 S2-FE-FND-6 — FE FOUNDATION admin: Retention Policies (/system/retention config) + File Access Logs viewer (/system/file-access-logs)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-FND-BE-3✓, S1-FE-REGISTRY-1✓
- **done_when (đích hội tụ)**:
  - [ ] /system/retention: form config retention policies nối GET/PATCH /foundation/retention-policies; confirm hậu quả rõ (governs purge — FRONTEND-13 §6.6); PermissionGate FOUNDATION.RETENTION.VIEW (System)
  - [ ] /system/file-access-logs: bảng access log nối GET /foundation/file-access-logs + filter/pagination; field nhạy cảm mask do server (KHÔNG lộ storage_path); PermissionGate FOUNDATION.FILE_ACCESS_LOG.VIEW
  - [ ] KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh

### 🟡 S2-FE-HR-4 — FE HR Profile change-request workflow: /hr/me/change-request (self gửi YC) + /hr/profile-change-requests (HR duyệt list) + /:id (detail + approve/reject/cancel)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-FE-HR-3✓, S2-INT-2✓
- **done_when (đích hội tụ)**:
  - [ ] /hr/me/change-request: form user tự gửi yêu cầu sửa hồ sơ → POST /hr/profile-change-requests (Own scope); chọn field + giá trị mới + lý do; user tự xem YC của mình qua GET /hr/profile-change-requests/me
  - [ ] /hr/profile-change-requests: HR list GET /hr/profile-change-requests theo scope (Company/System) + filter status; PermissionGate HR.PROFILE_CHANGE_REQUEST.VIEW (cặp seed THẬT, KHÔNG hard-code nhãn)
  - [ ] /hr/profile-change-requests/:id: detail GET /:id + duyệt POST /:id/approve · từ chối POST /:id/reject(reason bắt buộc) · self-cancel POST /:id/cancel; PermissionGate approve/reject; confirm hậu quả trước mutation
  - [ ] KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; invalidate list+detail sau action; web test xanh; typecheck xanh

### 🟡 S2-FE-HR-6 — FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/audit-logs, tái dùng foundation audit filter module=HR)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-FE-HR-1✓, S2-INT-2✓
- **done_when (đích hội tụ)**:
  - [ ] /hr/org-chart: sơ đồ tổ chức đọc GET /org/units/tree (+ manager-tree S2-INT-2) theo data-scope (Team/Company/System) — KHÔNG lộ người ngoài quyền; PermissionGate HR.ORG_CHART.VIEW
  - [ ] /hr/audit-logs: lịch sử thay đổi HR — bảng nối GET /foundation/audit-logs?module=HR (tái dùng, KHÔNG dựng endpoint mới) + filter/pagination; field nhạy cảm mask do server; PermissionGate HR.AUDIT_LOG.VIEW
  - [ ] KHÔNG hard-code (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh

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

### 🟡 S2-FE-HR-8 — FE HR Employee-code config: /hr/settings/employee-code (form cấu hình mã NV + preview live) nối admin API
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-HR-BE-7✓, S2-FE-HR-1✓
- **done_when (đích hội tụ)**:
  - [ ] /hr/settings/employee-code: form cấu hình mã NV (prefix/padding/reset) nối GET/PATCH /hr/settings/employee-code + preview live (KHÔNG mutate); PermissionGate HR.EMPLOYEE_CODE_CONFIG.VIEW
  - [ ] confirm khi đổi cấu hình; KHÔNG hard-code; loading/empty/error; web test xanh; typecheck xanh

### 🟡 S3-LEAVE-BE-4 — LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)
- **zone**: yellow · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/leave/**`, `packages/contracts/src/**`
- **phụ thuộc**: S3-LEAVE-SEED-1✓, S2-AUTH-BE-2✓
- **done_when (đích hội tụ)**:
  - [ ] CRUD leave types + leave policies (HR); permission pair THẬT (leave-permissions.const.ts, KHÔNG hard-code mã người-đọc): (create|update|delete,'leave-type') + (view|create|update|delete,'leave-policy'); soft-delete KHÔNG hard-delete; audit thao tác
  - [ ] HR view balances theo scope + adjust balance qua cặp (adjust,'leave-balance') — KHÔNG sửa số dư nếu KHÔNG tạo leave_balance_transactions (ledger, migration 0453 chỉ GRANT SELECT,INSERT app role — append-only); balance KHÔNG âm nếu allow_negative_balance=false (transaction + SELECT...FOR UPDATE row-lock chống race); balance_before/balance_after ledger liên tục khớp tail; audit_logs ghi khi adjust (DoD §16.3)
  - [ ] deny-path RED viết-TRƯỚC: thiếu adjust:leave-balance → 403 + 0 ledger row; thiếu create/update/delete:leave-type hoặc :leave-policy → 403; 2-tenant deny (adjust/view balance nhân viên công ty khác → 403/404); append-only: app role UPDATE/DELETE leave_balance_transactions PHẢI fail; âm-số-dư: vượt số dư khi allow_negative_balance=false → reject + concurrency test; đổi số dư KHÔNG insert ledger row → không thể xảy ra (test qua repository trực tiếp)
  - [ ] phần admin UI nâng cao = carry-over CO-S4-008; migration mới (nếu cần cột) PHẢI tạo RLS policy + FORCE TRƯỚC backfill; bảng đã có từ 0453 — xác nhận rõ trong plan có/không cần migration mới

### 🔴 S3-INT-1 — LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004)
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/attendance/**`, `apps/api/src/leave/**`, `apps/api/test/**`
- **phụ thuộc**: S3-ATT-BE-1✓, S3-LEAVE-BE-3✓
- **done_when (đích hội tụ)**:
  - [ ] internal handler onLeaveApproved + AttendanceLeaveSyncService map leave_request_days→attendance_records: full-day → status Leave + required_working_minutes 0; half-day → reduce required minutes; hourly → reduce theo minutes; nếu record đã có check-in/out → recalculate (KHÔNG mất dữ liệu chấm công); KHÔNG tạo trùng record (employee/date/shift)
  - [ ] cập nhật leave_request_days.attendance_sync_status; lưu sync error nếu fail + log; POST /internal/v1/attendance/recalculate (retry/manual); attendance/today + check-in đọc Approved leave để chặn full-day
  - [ ] onLeaveCancelled/onLeaveRevoked cho đơn ĐÃ Approved+đã sync: recalc attendance_records (gỡ Leave, khôi phục required minutes về shift/rule hiệu lực, tính lại late/early/missing nếu có check-in) + release/restore balance ĐÚNG SỐ; IDEMPOTENT (retry KHÔNG hoàn phép 2 lần — idempotency key / kiểm sync state) — S3-SYNC-004; FSM CANCEL chỉ owner (self) gọi được, REVOKE chỉ manager|HR (action REVOKE)
  - [ ] deny-path RED viết-TRƯỚC (CHỐT 2026-07-02, bổ sung sau plan_block): actor KHÔNG phải owner gọi CANCEL → 403 + KHÔNG đổi status/KHÔNG refund/KHÔNG phát revert-event; actor KHÔNG phải manager|HR gọi REVOKE → 403 tương tự; POST /internal/v1/attendance/recalculate không auth / thiếu manage:attendance / thiếu internal-guard → 403, KHÔNG reprocess; full-day leave date → check-in/out disabled + status Leave trong bảng công; sync fail → trạng thái lưu + log; cross-tenant KHÔNG sync chéo; FULL gate (crown) + người chốt; coverage ≥80%
  - [ ] AUDIT (CHỐT 2026-07-02): mọi attendance_record do sync/revert tạo/sửa/gỡ PHẢI append audit_logs (object_type=attendance_record) TRONG cùng tx app-pool — test khẳng định audit row tồn tại + rollback ⇒ không audit-ma

### 🔴 S3-ATT-BE-5 — ATT Remote/Onsite-work request workflow API (CO-S4-004): remote_work_requests create/list/detail + approve/reject + ảnh hưởng tính công + audit + event (skeleton 0452 → hoàn thiện)
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/attendance/**`, `apps/api/src/db/schema/**`, `apps/api/migrations/**`, `packages/contracts/src/**`
- **phụ thuộc**: S3-ATT-BE-2✓, S2-INT-2✓
- **done_when (đích hội tụ)**:
  - [ ] STATE-MACHINE (CHỐT LẠI 2026-07-02, owner override — GHI ĐÈ mọi bản done_when trước đó nói 'create → Pending'): create → **Draft** (KHÔNG Pending); action **submit** RIÊNG (Draft→Pending) trong contract/API — POST /attendance/remote-work-requests/:id/submit. Lúc submit: người tạo chọn current_approver_user_id là người duyệt TRỰC TIẾP HOẶC người duyệt THAY THẾ (delegate) + danh sách watcher_user_ids (theo dõi, nhận thông báo liên quan qua NOTI). Draft có thể sửa/xoá bởi chủ; chỉ request ở trạng thái Pending mới approve/reject được.
  - [ ] POST /attendance/remote-work-requests (create Own → Draft) + GET my + GET list (scope) + GET :id + approve/reject/cancel-own; audit + event mỗi chuyển trạng thái (Draft→Pending qua submit, Pending→Approved/Rejected); Approved ảnh hưởng cách tính công ngày remote/công tác theo rule; Approved sinh/cập nhật attendance_records UPSERT-BY (company_id,employee_id,date) IDEMPOTENT — re-approve KHÔNG nhân đôi record
  - [ ] hoàn thiện shape remote_work_requests (migration nối head nếu skeleton thiếu; RLS+FORCE); mutation trong tx; permission pair PIN đúng resource_type='remote-request' (seed 0454): create-own/view-own/view-team/view-company/cancel-own/approve/reject đều gate trên 'remote-request', reject dùng cặp reject:remote-request RIÊNG (không tái dùng approve)
  - [ ] AUDIT object_type (CHỐT 2026-07-02): union-add 'remote_work_request' vào AUDIT_OBJECT_TYPES (apps/api/src/db/schema/audit.ts) + CHECK audit_logs CÙNG commit migration (mẫu UNION-ADD 0456)
  - [ ] deny-path RED viết-TRƯỚC: tạo hộ người khác → chặn; submit hộ người khác / submit khi ≠Draft → chặn; approve/reject khi ≠Pending (vd còn Draft) → chặn; duyệt ngoài scope → 403; cross-tenant deny (gồm current_approver_user_id/watcher_user_ids PHẢI cùng company); cancel đơn người khác / cancel khi ≠Draft/Pending → chặn; FULL gate + người chốt

### 🟡 S3-ATT-BE-6 — ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổng hợp theo scope) + /attendance/audit-logs (tái dùng foundation audit filter module=ATT)
- **zone**: yellow · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/attendance/**`, `packages/contracts/src/**`
- **phụ thuộc**: S3-ATT-BE-2✓, S1-FND-AUDIT-1✓
- **done_when (đích hội tụ)**:
  - [ ] GET /attendance/reports tổng hợp công theo scope Team/Company (present/late/missing/leave) + filter kỳ; permission pair THẬT (attendance-permissions.const.ts, KHÔNG mã người-đọc): (view-team,'attendance') + (view-company,'attendance'); report Team PHẢI giới hạn theo cây quản lý (DataScopeService/manager-tree, S2-INT-2) — KHÔNG phải mọi nhân viên công ty; report = 1 aggregate query group-by cố định (no N+1, khẳng định số query không đổi theo N record); trả tổng hợp có phân trang, KHÔNG kèm export CSV/stream (carry-over ngoài WO này)
  - [ ] GET /attendance/audit-logs: TÁI DÙNG AuditRepository/AuditFilter (lọc module_code=ATT) nhưng route/controller/guard RIÊNG của ATT — KHÔNG dùng chung route/guard với foundation AuditController (cặp (view,'audit-log') của foundation KHÁC cặp ATT, tái dùng thẳng sẽ over-grant: ai có view audit-log foundation sẽ đọc được audit ATT). Gate bằng cặp (view,'attendance-audit-log'); dùng ĐÚNG masking layer của foundation audit read (audit_logs có thể chứa PII/salary ở old/new value)
  - [ ] deny-path RED viết-TRƯỚC (BẮT BUỘC — plan trước bị BLOCK vì testTasks/steps rỗng): (a) GET /attendance/reports thiếu view-team/view-company:attendance → 403; (b) GET /attendance/audit-logs thiếu (view,attendance-audit-log) → 403; (c) 2-tenant: user tenant B gọi report/audit tenant A → 0 row/403; (d) manager scope Team chỉ thấy cây quản lý của mình, KHÔNG thấy team khác cùng công ty (IDOR); (e) append-only: không route UPDATE/DELETE trên audit; (f) grant foundation-audit (view,audit-log) KHÔNG mở được /attendance/audit-logs (test khẳng định KHÔNG over-grant); (g) 1 dòng audit chứa field nhạy cảm bị mask khi đọc qua /attendance/audit-logs
  - [ ] PLAN BẮT BUỘC có micro-plan steps đầy đủ (route/guard pair/service scope/reuse foundation repo) TRƯỚC khi code — không được nộp steps rỗng lần nữa

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
- 🟡 `S2-FE-FND-5` FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only)
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

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-FND-1`, `S2-FND-BE-1`, `S2-FND-BE-2`, `S2-FND-BE-3`, `S2-FE-HR-5`, `S2-HR-BE-7`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-ATT-BE-4`, `S3-FE-ATT-5`, `S3-LEAVE-BE-5`, `S3-FE-LEAVE-3`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 1
- **migration head**: idx 136 — `0456_s2_fndbe3_retention_audit_object_type` (137 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `46b3c9b` | 2026-07-02 | fix(harness): reconcile-merged false-positive on chore(harness) commits |
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

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

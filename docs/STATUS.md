# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 06:48Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

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

### 🟡 S2-FE-HR-8 — FE HR Employee-code config: /hr/settings/employee-code (form cấu hình mã NV + preview live) nối admin API
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S2-HR-BE-7✓, S2-FE-HR-1✓
- **done_when (đích hội tụ)**:
  - [ ] /hr/settings/employee-code: form cấu hình mã NV (prefix/padding/reset) nối GET/PATCH /hr/settings/employee-code + preview live (KHÔNG mutate); PermissionGate HR.EMPLOYEE_CODE_CONFIG.VIEW
  - [ ] confirm khi đổi cấu hình; KHÔNG hard-code; loading/empty/error; web test xanh; typecheck xanh

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
- 🟡 `S2-FE-AUTH-4` FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog
- 🟡 `S2-FE-AUTH-5` FE Account self-service: /account/sessions (list + revoke phiên của chính user)
- 🟡 `S2-FE-FND-5` FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only)
- 🟡 `S2-FE-HR-7` FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API
- 🔴 `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR
- 🔴 `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression
- 🟡 `S3-FE-ATT-3` FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + /records/:id/adjust): tạo/duyệt/điều chỉnh trực tiếp
- 🟡 `S3-FE-ATT-4` FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt
- 🟡 `S3-FE-ATT-6` FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs)
- 🟡 `S3-LEAVE-BE-6` LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE)

**CHỜ (kẹt phụ thuộc):**
- `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions ⏳ cần: S3-LEAVE-BE-6
- `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) ⏳ cần: S3-LEAVE-BE-6

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-AUTH-BE-6`, `S2-AUTH-BE-7`, `S2-FE-FND-1`, `S2-FND-BE-1`, `S2-FND-BE-2`, `S2-FND-BE-3`, `S2-FE-HR-5`, `S2-HR-BE-6`, `S2-HR-BE-7`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-5`, `S3-LEAVE-BE-5`, `S3-FE-LEAVE-3`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 1
- **migration head**: idx 136 — `0456_s2_fndbe3_retention_audit_object_type` (137 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `087ba4f` | 2026-07-02 | chore(harness): sync ledger for batch6 (7/7 done) + fe-batch-a/b progress (7/10 done) + regen STATUS |
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

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

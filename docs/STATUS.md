# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 02:42Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🟡 S2-FE-FND-1 — FE FOUNDATION admin: System Overview (/system) + Company info view/edit (/system/company) + Company Settings (/system/settings) nối API thật
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S1-FND-MODULE-1✓, S1-FND-SETTING-1✓, S1-FE-REGISTRY-1✓
- **done_when (đích hội tụ)**:
  - [ ] /system: System Overview landing (thẻ tóm tắt company/module/health + link tới các trang con); PermissionGate theo cặp quyền ĐÃ SEED (verify pair seed thật — KHÔNG hard-code nhãn FRONTEND-13, bài học s1-fnd-module drift)
  - [ ] /system/company: view + edit thông tin công ty nối GET/PATCH /foundation/company/current; dirty-form guard; confirm hậu quả trước mutation (FRONTEND-13 §6.6); invalidate sau lưu; PermissionGate view/update company
  - [ ] /system/settings (+ /system/company/settings): đọc config qua POST /foundation/settings/resolve (batch known keys) + sửa qua PATCH /foundation/company-settings/:key; field is_sensitive do SERVER mask (§6.3); confirm khi đổi giá trị nhạy cảm
  - [ ] KHÔNG hard-code role (PermissionGate/useCan); loading/empty/error/forbidden; web test xanh; typecheck xanh

### 🟡 S2-HR-BE-7 — Employee-code config admin API (carry-over STORY-035): GET/PATCH /hr/settings/employee-code (sửa employee_code_configs) + lock manual-edit + audit — unblock S2-FE-HR-8
- **zone**: yellow · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/employees/**`, `apps/api/src/foundation/sequences/**`, `packages/contracts/src/**`
- **phụ thuộc**: S2-HR-DB-1✓, S1-FND-SEQ-1✓
- **done_when (đích hội tụ)**:
  - [ ] GET /hr/settings/employee-code đọc + PATCH sửa employee_code_configs (prefix/padding/reset policy); permission HR.EMPLOYEE_CODE_CONFIG.VIEW + manage; preview qua previewNextCode (S1-FND-SEQ-1 — KHÔNG mutate counter)
  - [ ] lock manual-edit khi policy yêu cầu; audit thay đổi config trong tx withTenant (config-only, KHÔNG current_value)
  - [ ] deny-path RED: thiếu quyền → 403 + 0 audit; 2-tenant deny; validate value_type

### 🟡 S3-FE-LEAVE-3 — FE LEAVE all-requests (/leave/requests, 006) + edit draft (/leave/requests/:id/edit, 002E)
- **zone**: yellow · **skills**: frontend-design, code-review
- **sửa ở đâu (paths)**: `apps/app/**`, `packages/web-core/**`
- **phụ thuộc**: S3-LEAVE-BE-3✓, S3-FE-LEAVE-1✓
- **done_when (đích hội tụ)**:
  - [ ] /leave/requests (AllLeaveRequestsPage): list mọi đơn theo scope (Team/Dept/Company) nối GET /leave/requests; filter status/kỳ/phòng ban; PermissionGate LEAVE.REQUEST.VIEW
  - [ ] /leave/requests/:id/edit (EditLeaveDraftPage): sửa đơn Draft nối PATCH /leave/requests/:id (Draft-only, S3-LEAVE-BE-2); dirty-form guard; PermissionGate LEAVE.REQUEST.UPDATE_DRAFT
  - [ ] KHÔNG hard-code; loading/empty/error/forbidden; web test xanh; typecheck xanh

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
- 🟡 `S2-FE-HR-5` FE HR Master data mgmt: /hr/departments + /hr/positions + /hr/job-levels + /hr/contract-types (list + CRUD) nối API thật
- 🟡 `S2-FE-HR-6` FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/audit-logs, tái dùng foundation audit filter module=HR)
- 🟡 `S3-FE-ATT-3` FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + /records/:id/adjust): tạo/duyệt/điều chỉnh trực tiếp

**CHỜ (kẹt phụ thuộc):**
- `S2-FE-AUTH-4` FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog ⏳ cần: S2-AUTH-BE-6
- `S2-FE-AUTH-5` FE Account self-service: /account/sessions (list + revoke phiên của chính user) ⏳ cần: S2-AUTH-BE-7
- `S2-FE-HR-7` FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API ⏳ cần: S2-HR-BE-6
- `S2-FE-HR-8` FE HR Employee-code config: /hr/settings/employee-code (form cấu hình mã NV + preview live) nối admin API ⏳ cần: S2-HR-BE-7
- `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR ⏳ cần: S3-INT-1
- `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression ⏳ cần: S3-INT-1
- `S3-FE-ATT-4` FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt ⏳ cần: S3-ATT-BE-5
- `S3-FE-ATT-6` FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs) ⏳ cần: S3-ATT-BE-6
- `S3-LEAVE-BE-6` LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE) ⏳ cần: S3-LEAVE-BE-4
- `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions ⏳ cần: S3-LEAVE-BE-4, S3-LEAVE-BE-6
- `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) ⏳ cần: S3-LEAVE-BE-6

**🛑 BLOCKED:**
- `S2-AUTH-BE-6` Role write API (P1): POST/PATCH /auth/roles (create/update, KHÔNG sửa system role) + assign/revoke permission cho role (role_permissions) có audit — unblock S2-FE-AUTH-4
- `S2-AUTH-BE-7` Session management API (P1): GET /auth/sessions (phiên của CHÍNH user) + revoke 1 phiên + revoke-all-others — hoàn tất user_sessions (DEFERRED ở BE-1) — unblock S2-FE-AUTH-5
- `S2-HR-BE-6` Employee contracts (carry-over STORY-031): migration employee_contracts (RLS+FORCE) + CRUD API /hr/contracts + /hr/employees/:id/contracts + file link + cảnh báo hết hạn — unblock S2-FE-HR-7
- `S3-LEAVE-BE-4` LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)
- `S3-INT-1` LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004)
- `S3-ATT-BE-5` ATT Remote/Onsite-work request workflow API (CO-S4-004): remote_work_requests create/list/detail + approve/reject + ảnh hưởng tính công + audit + event (skeleton 0452 → hoàn thiện)
- `S3-ATT-BE-6` ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổng hợp theo scope) + /attendance/audit-logs (tái dùng foundation audit filter module=ATT)
- `S3-FE-LEAVE-4` FE LEAVE Calendar (/leave/calendar, own/team/company theo scope)

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FND-BE-1`, `S2-FND-BE-2`, `S2-FND-BE-3`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-ATT-BE-4`, `S3-FE-ATT-5`, `S3-LEAVE-BE-5`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 3
- **migration head**: idx 136 — `0456_s2_fndbe3_retention_audit_object_type` (137 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `899f48a` | 2026-07-02 | wip(HR5-WC): web-core HR master-data spine (api + pairs + routes + i18n + drift-guard) |
| `271bc40` | 2026-07-02 | chore(harness): reconcile S3-ATT-BE-4 + S2-FND-BE-1 stale ledger entries + reopen S2-FND-BE-2 + regen STATUS (#75) |
| `df6d468` | 2026-07-02 | chore(harness): regen STATUS after wave3 round 1 (#71) |
| `b91f9bd` | 2026-07-01 | chore(harness): commit stray plan docs from prior wave + regen STATUS (#67) |
| `602fa2b` | 2026-07-01 | chore(harness): move crown-jewel PLAN stage to Sonnet 5 to cut cost (#66) |
| `3c89694` | 2026-07-01 | feat(sprint3): S3 ATT/LEAVE core slice — registry spine + FE screens + approval FSM + foundation retention (#65) |
| `3b132ef` | 2026-07-01 | chore(harness): seed FE screen-coverage WOs + master-plan update (#57) |
| `8115bfa` | 2026-06-27 | feat(s3): Sprint 3 wave 1 — ATT + LEAVE backend spine + seeds (+ S2-AUTH-BE-5 viewer) (#56) |
| `05cdcc4` | 2026-06-27 | feat(harness): auto-reconcile merged-but-unstamped WOs in gen-status (#47) |
| `edd68c9` | 2026-06-27 | Update README.md (#7) |
| `07254e3` | 2026-06-26 | feat(db): S3-ATT-DB-1 — ATT Core migration 0452 (DB-04 reconcile, evolve-additive) (#54) |
| `1074b0f` | 2026-06-26 | chore(harness): open Sprint 3 (ATT+LEAVE+sync) + close Sprint 2 + fix story-matrix traces (#53) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

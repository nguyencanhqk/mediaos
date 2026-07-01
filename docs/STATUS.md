# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-01 02:11Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S2-FE-AUTH-2` FE Auth self-service: forgot-password + reset-password + session-expired (apps/auth) + /account/change-password nối API thật
- 🟡 `S2-FE-AUTH-3` FE User admin CRUD (/system/users): create + detail + edit + assign-roles nối /auth/users (thay read-only placeholder)
- 🔴 `S2-AUTH-BE-6` Role write API (P1): POST/PATCH /auth/roles (create/update, KHÔNG sửa system role) + assign/revoke permission cho role (role_permissions) có audit — unblock S2-FE-AUTH-4
- 🔴 `S2-AUTH-BE-7` Session management API (P1): GET /auth/sessions (phiên của CHÍNH user) + revoke 1 phiên + revoke-all-others — hoàn tất user_sessions (DEFERRED ở BE-1) — unblock S2-FE-AUTH-5
- 🟡 `S2-FE-FND-1` FE FOUNDATION admin: System Overview (/system) + Company info view/edit (/system/company) + Company Settings (/system/settings) nối API thật
- 🟡 `S2-FE-FND-2` FE FOUNDATION admin: Audit log viewer (/system/audit-logs + detail, thay ModulePlaceholder) + File metadata viewer (/system/files + detail)
- 🟡 `S2-FND-BE-1` Admin module catalog API (P1): GET /foundation/modules (TẤT CẢ module, KHÁC my-apps đã lọc theo user) + GET /foundation/modules/:code detail — unblock S2-FE-FND-3 (toggle enable/disable = follow-up)
- 🟡 `S2-FE-FND-4` FE FOUNDATION admin: Public Holidays (/system/public-holidays list+CRUD) + Health Check (/system/health read-only status) — BE sẵn
- 🟡 `S2-FND-BE-2` Foundation ops admin API (P1): Sequences (GET list + preview + PATCH config over SequenceService) + Seed status (GET) — wire controller over service có sẵn — unblock S2-FE-FND-5
- 🔴 `S2-FND-BE-3` Foundation security-admin API (P1): Retention policies (GET + PATCH over RetentionService, governs purge) + File Access Logs viewer (GET masked, append-only) — unblock S2-FE-FND-6
- 🟡 `S2-FE-HR-4` FE HR Profile change-request workflow: /hr/me/change-request (self gửi YC) + /hr/profile-change-requests (HR duyệt list) + /:id (detail + approve/reject/cancel)
- 🟡 `S2-FE-HR-5` FE HR Master data mgmt: /hr/departments + /hr/positions + /hr/job-levels + /hr/contract-types (list + CRUD) nối API thật
- 🟡 `S2-FE-HR-6` FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/audit-logs, tái dùng foundation audit filter module=HR)
- 🔴 `S2-HR-BE-6` Employee contracts (carry-over STORY-031): migration employee_contracts (RLS+FORCE) + CRUD API /hr/contracts + /hr/employees/:id/contracts + file link + cảnh báo hết hạn — unblock S2-FE-HR-7
- 🟡 `S2-HR-BE-7` Employee-code config admin API (carry-over STORY-035): GET/PATCH /hr/settings/employee-code (sửa employee_code_configs) + lock manual-edit + audit — unblock S2-FE-HR-8
- 🟡 `S3-ATT-BE-3` Shift/rule minimum (P1): GET /attendance/shifts + /rules/effective + resolve-effective service + applied-rule snapshot (+ CRUD shift/rule/assignment mức tối thiểu nếu đủ thời gian)
- 🔴 `S3-LEAVE-BE-3` LEAVE approval workflow: pending-list theo scope + approve + reject(reason) + state-machine Pending→Approved/Rejected + balance reserve→use/release (row-lock, no double-approve) + approval history + audit + event + trigger ATT sync
- 🟡 `S3-LEAVE-BE-4` LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)
- 🟢 `S3-FE-REGISTRY-1` FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permission-driven) + attendanceApi/leaveApi + query-key factory + mutation invalidation matrix
- 🔴 `S3-ATT-BE-4` ATT Adjustment workflow API (CO-S4-003): adjustment_requests create/list/detail + approve/reject + direct-adjust + recalc attendance_records + audit + event (skeleton 0452 → hoàn thiện cột nếu thiếu)
- 🔴 `S3-ATT-BE-5` ATT Remote/Onsite-work request workflow API (CO-S4-004): remote_work_requests create/list/detail + approve/reject + ảnh hưởng tính công + audit + event (skeleton 0452 → hoàn thiện)
- 🟡 `S3-ATT-BE-6` ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổng hợp theo scope) + /attendance/audit-logs (tái dùng foundation audit filter module=ATT)

**CHỜ (kẹt phụ thuộc):**
- `S2-FE-AUTH-4` FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog ⏳ cần: S2-AUTH-BE-6
- `S2-FE-AUTH-5` FE Account self-service: /account/sessions (list + revoke phiên của chính user) ⏳ cần: S2-AUTH-BE-7
- `S2-FE-FND-3` FE FOUNDATION admin: Module Catalog (/system/modules + /:code detail) nối admin module API — read-only trước ⏳ cần: S2-FND-BE-1
- `S2-FE-FND-5` FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only) ⏳ cần: S2-FND-BE-2
- `S2-FE-FND-6` FE FOUNDATION admin: Retention Policies (/system/retention config) + File Access Logs viewer (/system/file-access-logs) ⏳ cần: S2-FND-BE-3
- `S2-FE-HR-7` FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API ⏳ cần: S2-HR-BE-6
- `S2-FE-HR-8` FE HR Employee-code config: /hr/settings/employee-code (form cấu hình mã NV + preview live) nối admin API ⏳ cần: S2-HR-BE-7
- `S3-INT-1` LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004) ⏳ cần: S3-LEAVE-BE-3
- `S3-FE-ATT-1` FE ATT Today: AttendanceTodayPage + AttendanceStatusCard + CheckInOutActions + useAttendanceToday/useCheckIn/useCheckOut + disabled reason + invalidate + toast + state ⏳ cần: S3-FE-REGISTRY-1
- `S3-FE-ATT-2` FE ATT records (P0/P1): MyAttendanceRecordsPage + TeamAttendanceRecordsPage + AttendanceRecordDetailPage + filter tháng/khoảng/status + StatusBadge + permission menu visibility ⏳ cần: S3-FE-ATT-1
- `S3-FE-LEAVE-1` FE LEAVE me: MyLeaveBalancePage/LeaveBalanceCard + MyLeaveRequestsPage + CreateLeaveRequestPage/LeaveRequestForm (date-range/half-day/preview) + LeaveRequestDetailPage + submit/cancel ⏳ cần: S3-FE-REGISTRY-1
- `S3-FE-LEAVE-2` FE LEAVE approval: LeaveApprovalPage + pending table + approval detail drawer + approve/reject confirmation + reject reason + invalidate list/detail/balance ⏳ cần: S3-LEAVE-BE-3, S3-FE-LEAVE-1
- `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR ⏳ cần: S3-INT-1
- `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression ⏳ cần: S3-LEAVE-BE-3, S3-INT-1
- `S3-FE-ATT-3` FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + /records/:id/adjust): tạo/duyệt/điều chỉnh trực tiếp ⏳ cần: S3-ATT-BE-4, S3-FE-ATT-2
- `S3-FE-ATT-4` FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt ⏳ cần: S3-ATT-BE-5, S3-FE-ATT-2
- `S3-FE-ATT-5` FE ATT admin + company records: /attendance/records (công ty, 004) + /attendance/shifts + /shift-assignments + /rules ⏳ cần: S3-ATT-BE-3, S3-FE-ATT-2
- `S3-FE-ATT-6` FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs) ⏳ cần: S3-ATT-BE-6, S3-FE-ATT-2
- `S3-LEAVE-BE-5` LEAVE Calendar API (CO-S4-005): GET /leave/calendar theo data-scope Own/Team/Company (đơn Approved/Pending trong khoảng) + mask ngoài quyền ⏳ cần: S3-LEAVE-BE-3
- `S3-LEAVE-BE-6` LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE) ⏳ cần: S3-LEAVE-BE-4
- `S3-FE-LEAVE-3` FE LEAVE all-requests (/leave/requests, 006) + edit draft (/leave/requests/:id/edit, 002E) ⏳ cần: S3-LEAVE-BE-3, S3-FE-LEAVE-1
- `S3-FE-LEAVE-4` FE LEAVE Calendar (/leave/calendar, own/team/company theo scope) ⏳ cần: S3-LEAVE-BE-5, S3-FE-LEAVE-1
- `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions ⏳ cần: S3-LEAVE-BE-4, S3-LEAVE-BE-6, S3-FE-LEAVE-1
- `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) ⏳ cần: S3-LEAVE-BE-6, S3-FE-LEAVE-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 5
- **migration head**: idx 135 — `0455_s3_leaveseed1_leave_perms` (136 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `8115bfa` | 2026-06-27 | feat(s3): Sprint 3 wave 1 — ATT + LEAVE backend spine + seeds (+ S2-AUTH-BE-5 viewer) (#56) |
| `05cdcc4` | 2026-06-27 | feat(harness): auto-reconcile merged-but-unstamped WOs in gen-status (#47) |
| `edd68c9` | 2026-06-27 | Update README.md (#7) |
| `07254e3` | 2026-06-26 | feat(db): S3-ATT-DB-1 — ATT Core migration 0452 (DB-04 reconcile, evolve-additive) (#54) |
| `1074b0f` | 2026-06-26 | chore(harness): open Sprint 3 (ATT+LEAVE+sync) + close Sprint 2 + fix story-matrix traces (#53) |
| `35419e0` | 2026-06-26 | docs: reconcile ERD + contracts to docs/DB standard (#52) |
| `835058c` | 2026-06-26 | fix(fe): normalize user.status casing — close false 403 USER_INACTIVE on all module routes (#51) |
| `49ef4dc` | 2026-06-26 | fix(api): S2-HR-EMP-LEGACY-LOCK-1 — scope + mask legacy GET /employees(/:id) (close IDOR + salaryType/PII leak) (#50) |
| `6c66ab5` | 2026-06-26 | feat(api): S2-HR-MASK-1 — gate salaryType behind view-salary (fail-closed) + HR read quality (#49) |
| `63ac8bf` | 2026-06-26 | S2-QA-2 — HR CRUD coverage gap-fill + FE smoke spine + Sprint 2 regression sign-off (#48) |
| `1bb8f7d` | 2026-06-26 | S2-INT-2 — HR manager-tree ↔ data-scope: Team (EMR multi-manager) + Department (org-unit head) (#46) |
| `5ab5dcb` | 2026-06-26 | S2-INT-1 — HR employee ↔ AUTH user provisioning (consistent tx · create:user gate · audit both sides) (#45) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

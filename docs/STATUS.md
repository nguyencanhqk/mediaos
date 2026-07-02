# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 08:13Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S2-FE-AUTH-2` FE Auth self-service: forgot-password + reset-password + session-expired (apps/auth) + /account/change-password nối API thật
- 🟡 `S2-FE-AUTH-3` FE User admin CRUD (/system/users): create + detail + edit + assign-roles nối /auth/users (thay read-only placeholder)
- 🔴 `S2-AUTH-BE-6` Role write API (P1): POST/PATCH /auth/roles (create/update, KHÔNG sửa system role) + assign/revoke permission cho role (role_permissions) có audit — unblock S2-FE-AUTH-4
- 🟡 `S2-FE-AUTH-5` FE Account self-service: /account/sessions (list + revoke phiên của chính user)
- 🟡 `S2-FE-FND-2` FE FOUNDATION admin: Audit log viewer (/system/audit-logs + detail, thay ModulePlaceholder) + File metadata viewer (/system/files + detail)
- 🟡 `S2-FE-FND-3` FE FOUNDATION admin: Module Catalog (/system/modules + /:code detail) nối admin module API — read-only trước
- 🟡 `S2-FE-FND-4` FE FOUNDATION admin: Public Holidays (/system/public-holidays list+CRUD) + Health Check (/system/health read-only status) — BE sẵn
- 🟡 `S2-FE-FND-5` FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only)
- 🔴 `S2-FND-BE-3` Foundation security-admin API (P1): Retention policies (GET + PATCH over RetentionService, governs purge) + File Access Logs viewer (GET masked, append-only) — unblock S2-FE-FND-6
- 🟡 `S2-FE-HR-4` FE HR Profile change-request workflow: /hr/me/change-request (self gửi YC) + /hr/profile-change-requests (HR duyệt list) + /:id (detail + approve/reject/cancel)
- 🟡 `S2-FE-HR-6` FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/audit-logs, tái dùng foundation audit filter module=HR)
- 🟡 `S2-FE-HR-7` FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API
- 🟡 `S2-HR-BE-7` Employee-code config admin API (carry-over STORY-035): GET/PATCH /hr/settings/employee-code (sửa employee_code_configs) + lock manual-edit + audit — unblock S2-FE-HR-8
- 🔴 `S3-LEAVE-BE-3` LEAVE approval workflow: pending-list theo scope + approve + reject(reason) + state-machine Pending→Approved/Rejected + balance reserve→use/release (row-lock, no double-approve) + approval history + audit + event + trigger ATT sync
- 🟡 `S3-LEAVE-BE-4` LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)
- 🔴 `S3-FE-REGISTRY-1` FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permission-driven) + attendanceApi/leaveApi + query-key factory + mutation invalidation matrix
- 🟡 `S3-FE-ATT-2` FE ATT records (P0/P1): MyAttendanceRecordsPage + TeamAttendanceRecordsPage + AttendanceRecordDetailPage + filter tháng/khoảng/status + StatusBadge + permission menu visibility
- 🟡 `S3-ATT-BE-6` ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổng hợp theo scope) + /attendance/audit-logs (tái dùng foundation audit filter module=ATT)

**CHỜ (kẹt phụ thuộc):**
- `S2-FE-AUTH-4` FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog ⏳ cần: S2-AUTH-BE-6
- `S3-INT-1` LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004) ⏳ cần: S3-LEAVE-BE-3
- `S3-FE-LEAVE-2` FE LEAVE approval: LeaveApprovalPage + pending table + approval detail drawer + approve/reject confirmation + reject reason + invalidate list/detail/balance ⏳ cần: S3-LEAVE-BE-3
- `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR ⏳ cần: S3-INT-1
- `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression ⏳ cần: S3-LEAVE-BE-3, S3-INT-1
- `S3-FE-ATT-3` FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + /records/:id/adjust): tạo/duyệt/điều chỉnh trực tiếp ⏳ cần: S3-FE-ATT-2
- `S3-FE-ATT-4` FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt ⏳ cần: S3-FE-ATT-2
- `S3-FE-ATT-5` FE ATT admin + company records: /attendance/records (công ty, 004) + /attendance/shifts + /shift-assignments + /rules ⏳ cần: S3-FE-ATT-2
- `S3-FE-ATT-6` FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs) ⏳ cần: S3-ATT-BE-6, S3-FE-ATT-2
- `S3-LEAVE-BE-5` LEAVE Calendar API (CO-S4-005): GET /leave/calendar theo data-scope Own/Team/Company (đơn Approved/Pending trong khoảng) + mask ngoài quyền ⏳ cần: S3-LEAVE-BE-3
- `S3-LEAVE-BE-6` LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE) ⏳ cần: S3-LEAVE-BE-4
- `S3-FE-LEAVE-3` FE LEAVE all-requests (/leave/requests, 006) + edit draft (/leave/requests/:id/edit, 002E) ⏳ cần: S3-LEAVE-BE-3
- `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions ⏳ cần: S3-LEAVE-BE-4, S3-LEAVE-BE-6
- `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) ⏳ cần: S3-LEAVE-BE-6

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-AUTH-BE-7`, `S2-FE-FND-1`, `S2-FND-BE-1`, `S2-FND-BE-2`, `S2-FE-FND-6`, `S2-FE-HR-5`, `S2-HR-BE-6`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-FE-ATT-1`, `S3-FE-LEAVE-1`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-FE-LEAVE-4`

## Trạng thái repo

- **branch**: `auto/fe-batch-b` · **file đang đổi (dirty)**: 80
- **migration head**: idx 145 — `0465_s2_hrbe6_contract_scope_fix` (146 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `10b90b6` | 2026-07-02 | merge: origin/master (PR #81/#82 Sprint 3 wave 3 + crown-jewel unblock) into auto/fe-batch-b |
| `487eb8f` | 2026-07-02 | fix(S2-FE-FND-4): resolve Rules-of-Hooks violation in HealthPage scope check |
| `a76d953` | 2026-07-02 | feat(S3-FE-ATT-3): FE ATT Adjustment — tạo/duyệt/điều chỉnh trực tiếp |
| `e71117f` | 2026-07-02 | feat(sprint2/3): unblock 7 crown-jewel WOs — role/session/contracts/leave-admin/sync/remote-work/att-reports (#82) |
| `2ef505f` | 2026-07-02 | feat(S2-FE-HR-8): FE HR Employee-code config admin (/hr/settings/employee-code) |
| `80a1bcd` | 2026-07-02 | feat(s3): Sprint 3 wave 3 — ATT shift/rule + adjustment FSM, LEAVE calendar, FND module catalog + seq/seed ops, HR master-data admin, FE ATT/LEAVE/FND/HR screens (#81) |
| `2dc9344` | 2026-07-02 | feat(S2-FE-HR-6): FE HR Org chart + HR audit-logs viewer |
| `d26c24c` | 2026-07-02 | feat(S2-FE-FND-6): FE Retention Policies + File Access Logs admin screens |
| `c66025f` | 2026-07-02 | feat(S2-FE-FND-4): Public Holidays list+CRUD + Health read-only screens |
| `4b2c60a` | 2026-07-02 | chore(harness): record human decisions (S2-HR-BE-6/S3-ATT-BE-5/S2-AUTH-BE-7) + reconcile S2-FE-FND-1/S2-FE-HR-5 ledger drift from paused auto-loop + regen STATUS (#78) |
| `67d8f16` | 2026-07-02 | rescue: S2-FE-FND-1 (Foundation admin FE) + S2-HR-BE-7 verify-mode additions (#79) |
| `271bc40` | 2026-07-02 | chore(harness): reconcile S3-ATT-BE-4 + S2-FND-BE-1 stale ledger entries + reopen S2-FND-BE-2 + regen STATUS (#75) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

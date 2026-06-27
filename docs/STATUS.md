# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-27 09:30Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S2-AUTH-BE-5` Login-log + security-event viewer (P1): GET /auth/login-logs + /security-events (permission + data-scope + mask) + FE admin viewer — đóng IMP02-STORY-024 (AUTH 12/12)
- 🔴 `S3-LEAVE-DB-1` Migration LEAVE Core: leave_types·leave_policies·leave_balances·leave_balance_transactions·leave_requests·leave_request_days·leave_request_approvals + RLS+FORCE + indexes + append-only ledger
- 🔴 `S3-ATT-SEED-1` Seed ATT permissions (§11.1) + role→data_scope mapping (§11.3) + default shift OFFICE_8H + DEFAULT_OFFICE_RULE (§12.1) idempotent
- 🟢 `S3-FE-REGISTRY-1` FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permission-driven) + attendanceApi/leaveApi + query-key factory + mutation invalidation matrix

**CHỜ (kẹt phụ thuộc):**
- `S3-LEAVE-SEED-1` Seed LEAVE permissions (§11.2) + role→data_scope mapping + leave types (Annual/Sick/Unpaid/Other) + default policy (§12.2) idempotent ⏳ cần: S3-LEAVE-DB-1, S3-ATT-SEED-1
- `S3-ATT-BE-1` ATT Today + check-in + check-out: resolve employee/shift/rule (server-time) + chặn Approved full-day leave + attendance_records tx (0-dup) + attendance_logs + tính late/early/missing + audit ⏳ cần: S3-ATT-SEED-1
- `S3-ATT-BE-2` ATT records read: my-records + records/{id} detail + team-records + records(HR) theo data-scope Own/Team/Dept/Company + pagination/filter/sort whitelist + mask GPS/IP/device + no N+1 ⏳ cần: S3-ATT-BE-1
- `S3-ATT-BE-3` Shift/rule minimum (P1): GET /attendance/shifts + /rules/effective + resolve-effective service + applied-rule snapshot (+ CRUD shift/rule/assignment mức tối thiểu nếu đủ thời gian) ⏳ cần: S3-ATT-SEED-1
- `S3-LEAVE-BE-1` LEAVE balance + types + calculation preview: GET /leave/types + GET /leave/me/balances (Own) + POST /leave/calculate (preview ngày/giờ + holiday/non-working-day + balance trước/sau) ⏳ cần: S3-LEAVE-SEED-1
- `S3-LEAVE-BE-2` LEAVE request workflow (me): create draft + update draft + submit + list + detail + cancel + validate (overlap/balance/min-notice) + leave_request_days + reserve + audit + event SUBMITTED ⏳ cần: S3-LEAVE-BE-1
- `S3-LEAVE-BE-3` LEAVE approval workflow: pending-list theo scope + approve + reject(reason) + state-machine Pending→Approved/Rejected + balance reserve→use/release (row-lock, no double-approve) + approval history + audit + event + trigger ATT sync ⏳ cần: S3-LEAVE-BE-2
- `S3-LEAVE-BE-4` LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy) ⏳ cần: S3-LEAVE-SEED-1
- `S3-INT-1` LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004) ⏳ cần: S3-ATT-BE-1, S3-LEAVE-BE-3
- `S3-FE-ATT-1` FE ATT Today: AttendanceTodayPage + AttendanceStatusCard + CheckInOutActions + useAttendanceToday/useCheckIn/useCheckOut + disabled reason + invalidate + toast + state ⏳ cần: S3-ATT-BE-1, S3-FE-REGISTRY-1
- `S3-FE-ATT-2` FE ATT records (P0/P1): MyAttendanceRecordsPage + TeamAttendanceRecordsPage + AttendanceRecordDetailPage + filter tháng/khoảng/status + StatusBadge + permission menu visibility ⏳ cần: S3-ATT-BE-2, S3-FE-ATT-1
- `S3-FE-LEAVE-1` FE LEAVE me: MyLeaveBalancePage/LeaveBalanceCard + MyLeaveRequestsPage + CreateLeaveRequestPage/LeaveRequestForm (date-range/half-day/preview) + LeaveRequestDetailPage + submit/cancel ⏳ cần: S3-LEAVE-BE-2, S3-FE-REGISTRY-1
- `S3-FE-LEAVE-2` FE LEAVE approval: LeaveApprovalPage + pending table + approval detail drawer + approve/reject confirmation + reject reason + invalidate list/detail/balance ⏳ cần: S3-LEAVE-BE-3, S3-FE-LEAVE-1
- `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR ⏳ cần: S3-ATT-BE-2, S3-INT-1
- `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression ⏳ cần: S3-LEAVE-BE-3, S3-INT-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S3-ATT-DB-1`

## Trạng thái repo

- **branch**: `chore/harness-reconcile-merged` · **file đang đổi (dirty)**: 34
- **migration head**: idx 132 — `0452_s3_attdb1_att_core` (133 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `79942e2` | 2026-06-26 | feat(harness): auto-reconcile merged-but-unstamped WOs in gen-status |
| `1bb8f7d` | 2026-06-26 | S2-INT-2 — HR manager-tree ↔ data-scope: Team (EMR multi-manager) + Department (org-unit head) (#46) |
| `5ab5dcb` | 2026-06-26 | S2-INT-1 — HR employee ↔ AUTH user provisioning (consistent tx · create:user gate · audit both sides) (#45) |
| `e2e0b9c` | 2026-06-26 | feat(fe): S2-FE-HR-2 — EmployeeForm (create/edit) + lookups + submit/invalidate (#44) |
| `0b378eb` | 2026-06-26 | feat(api): S2-HR-BE-2 — HR write core (create/update/change-status/link-user) (#43) |
| `18f5665` | 2026-06-26 | feat(s2-auth-harden-1): separate forgot rate-limit namespace + uniform-response floor (#42) |
| `bc73304` | 2026-06-26 | test(s2-qa-debt-1): gate auth int-specs on hasDb && LANE_DB + strengthen forgot-password rate-limit efficacy (#40) |
| `9db83d6` | 2026-06-25 | feat(auth): S2-AUTH-BRAND-1 — rebrand TOTP issuer MediaOS → FUNTIME MEDIA (#41) |
| `b3b5624` | 2026-06-25 | feat(fe): S2-FE-HR-3 — MyProfile read-only + user/role placeholder pages (#39) |
| `8bc722a` | 2026-06-25 | chore(backlog): seed S2-AUTH-BRAND-1 — TOTP issuer rebrand MediaOS→FUNTIME MEDIA (follow-up #37) (#38) |
| `83f028c` | 2026-06-25 | chore(s2): backlog reconcile (close #24/#27-#31 + seed 3 follow-up WO) + topbar rebrand EMS→FUNTIME MEDIA (#37) |
| `1a1ec4c` | 2026-06-25 | S2 wave2 → master: HR write (profile-change-request) + Dept/position CRUD + QA RBAC + FE HR (#32/#33/#34/#35) (#36) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

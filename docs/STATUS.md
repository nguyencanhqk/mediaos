# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-27 09:40Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S3-ATT-BE-3` Shift/rule minimum (P1): GET /attendance/shifts + /rules/effective + resolve-effective service + applied-rule snapshot (+ CRUD shift/rule/assignment mức tối thiểu nếu đủ thời gian)
- 🔴 `S3-LEAVE-BE-3` LEAVE approval workflow: pending-list theo scope + approve + reject(reason) + state-machine Pending→Approved/Rejected + balance reserve→use/release (row-lock, no double-approve) + approval history + audit + event + trigger ATT sync
- 🟡 `S3-LEAVE-BE-4` LEAVE type/policy management + HR balance view/adjust + ledger (P1): CRUD type/policy + HR view balances + adjust balance (mọi thay đổi qua leave_balance_transactions, no negative ngoài policy)
- 🟢 `S3-FE-REGISTRY-1` FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permission-driven) + attendanceApi/leaveApi + query-key factory + mutation invalidation matrix

**CHỜ (kẹt phụ thuộc):**
- `S3-INT-1` LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService (full-day=Leave/required 0 · half-day/hourly reduce · recalc existing check-in) + sync_status/retry + onLeaveCancelled/Revoked recalc + balance restore idempotent (S3-SYNC-004) ⏳ cần: S3-LEAVE-BE-3
- `S3-FE-ATT-1` FE ATT Today: AttendanceTodayPage + AttendanceStatusCard + CheckInOutActions + useAttendanceToday/useCheckIn/useCheckOut + disabled reason + invalidate + toast + state ⏳ cần: S3-FE-REGISTRY-1
- `S3-FE-ATT-2` FE ATT records (P0/P1): MyAttendanceRecordsPage + TeamAttendanceRecordsPage + AttendanceRecordDetailPage + filter tháng/khoảng/status + StatusBadge + permission menu visibility ⏳ cần: S3-FE-ATT-1
- `S3-FE-LEAVE-1` FE LEAVE me: MyLeaveBalancePage/LeaveBalanceCard + MyLeaveRequestsPage + CreateLeaveRequestPage/LeaveRequestForm (date-range/half-day/preview) + LeaveRequestDetailPage + submit/cancel ⏳ cần: S3-FE-REGISTRY-1
- `S3-FE-LEAVE-2` FE LEAVE approval: LeaveApprovalPage + pending table + approval detail drawer + approve/reject confirmation + reject reason + invalidate list/detail/balance ⏳ cần: S3-LEAVE-BE-3, S3-FE-LEAVE-1
- `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR ⏳ cần: S3-INT-1
- `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression ⏳ cần: S3-LEAVE-BE-3, S3-INT-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`

## Trạng thái repo

- **branch**: `feat/s3-wave1` · **file đang đổi (dirty)**: 4
- **migration head**: idx 135 — `0455_s3_leaveseed1_leave_perms` (136 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `ace6c4e` | 2026-06-27 | chore(harness): S3-LEAVE-BE-2 done — request workflow + reserve ledger; FULL gate PASS |
| `15476a7` | 2026-06-27 | feat(leave): S3-LEAVE-BE-2 — request workflow (draft/submit/cancel, overlap, reserve ledger, audit, event) |
| `7ec2ec8` | 2026-06-27 | chore(harness): S3-LEAVE-BE-1 done — types+balances+calculate preview; FULL gate PASS |
| `e57a034` | 2026-06-27 | feat(leave): S3-LEAVE-BE-1 — types + me/balances + calculate preview (HolidayService, no mutation) |
| `5b92086` | 2026-06-27 | chore(harness): S3-ATT-BE-2 done — scoped records read + server-side mask; FULL gate PASS |
| `fdc45ed` | 2026-06-27 | feat(att): S3-ATT-BE-2 — scoped records read (my/team/company/detail/logs) + server-side mask + no N+1 |
| `5a4f0b4` | 2026-06-27 | chore(harness): S3-ATT-BE-1 note — FULL gate PASS + service refactor <800 |
| `f426382` | 2026-06-27 | refactor(att): S3-ATT-BE-1 — extract attendance mappers/builders (service <800 lines, no behavior change) |
| `13c0d77` | 2026-06-27 | feat(att): S3-ATT-BE-1 — Today + check-in/check-out (effective shift/rule, leave-block, tx 0-dup, logs+audit) |
| `8a00052` | 2026-06-27 | chore(harness): S3-LEAVE-SEED-1 done — LEAVE perms (mig 0455) + master-data seeder; FULL gate PASS |
| `9fd71bf` | 2026-06-27 | feat(leave): S3-LEAVE-SEED-1 — LEAVE permission catalog+grants (mig 0455) + runtime type/policy seeder |
| `1737c64` | 2026-06-27 | chore(harness): S3-LEAVE-SEED-1 spec refine — (A)/(B) split mirror ATT-SEED-1 + leave/** path |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

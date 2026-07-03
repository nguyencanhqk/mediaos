# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-03 13:58Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression
- 🟡 `S2-FE-ACCT-SEC-1` FE Account Security: section Bảo mật trong /account/profile — trạng thái 2FA + bật (→ /account/setup-2fa) + tắt (dialog mật khẩu, ẨN khi bị ép)
- 🟡 `S2-FE-SYS-SEC-1` FE Admin security: /system/roles form toggle 'Bắt buộc 2FA' + /system/users detail hiện 2FA (nguồn ép) + toggle ép tài khoản + nút Reset 2FA (PermissionGate reset-2fa:user)
- 🔴 `S2-AUTH-DB-3` user_roles soft-delete (audit gap #4): thêm deleted_at/deleted_by + REVOKE DELETE app-role — gỡ role không còn xóa cứng (DB-02 §4.9, BẤT BIẾN #2)
- 🔴 `S2-FND-SEED-3` Bootstrap dựng-từ-trống tự động (audit §4.2): seed default company idempotent (thay bước psql tay) + must_change_password cho super-admin bootstrap
- 🟡 `S2-FND-SEED-4` Seed settings đủ theo DB-10 §11 (audit §4.2): bổ sung 9/14 system key + cơ chế company-defaults 12 key + chốt giá trị lệch (25MB vs 20 · 'vi' vs 'vi-VN')
- 🟡 `S3-LEAVE-SEED-2` Leave types 8/8 + pin mã (audit §4.2, DB-10 §14.3): thêm MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY + chốt ANNUAL↔ANNUAL_LEAVE + allowHourly
- 🔴 `S2-FND-BE-8` Đóng permission-seed orphan (audit §6.3): system-settings GET/PATCH + PATCH modules/:code toggle (audit CONFIG) + audit export + retention POST create/simulate + not-found guard
- 🔴 `S2-FND-JOBS-1` System Jobs khung tối thiểu (audit §5.2, DB-08 §8.14-15 + BACKEND-11 §18): bảng system_job_runs/locks + JobRunner trên WorkerScheduler + schedule RetentionCleanupJob + TEMP_FILE_CLEANUP
- 🔴 `S2-FND-FILE-2` Upload file E2E (audit H3, BACKEND-11 §11.4): chốt mô hình presigned-PUT + POST /:id/confirm → upload_status 'Uploaded' + checksum + extension↔MIME + blocked_extensions
- 🔴 `S2-FND-DB-2` DB hygiene theo DB-09 (audit §3.2, P2): index bổ sung (files/file_access_logs/sequence) + uq_file_links_entity_file_active + trigger chặn UPDATE audit_logs lớp 2
- 🟡 `S2-FND-CONTRACT-1` API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI /docs + bộ mã FOUNDATION-ERR-* + chốt pagination request + migrate DTO cục bộ vào contracts

**CHỜ (kẹt phụ thuộc):**
- _(trống)_

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FE-FND-7`, `S2-FND-DOC-1`

## Trạng thái repo

- **branch**: `feat/debt-wave2` · **file đang đổi (dirty)**: 1
- **migration head**: idx 148 — `0468_s2_fndbe6_public_holiday_audit_object_type` (149 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `a06c596` | 2026-07-03 | wip(be-settings-public): GET /foundation/settings/public → Authenticated (per-method PermissionGuard) |
| `695899e` | 2026-07-03 | wip(be-permsurface): reconcile my-apps permission surface + audit-log sole-gate (S2-FND-BE-5) |
| `4682a47` | 2026-07-03 | chore(harness): chốt hướng xử lý 3 WO plan-blocked (S2-AUTH-DB-3, S2-FND-BE-5, S2-FND-DB-2) |
| `3d96d15` | 2026-07-03 | chore(harness): chốt S2-FND-BE-6 + S2-FND-DB-1 (checkpoint 1, feat/debt-wave2) |
| `75236b1` | 2026-07-03 | wip(S2-FND-BE-6-FIX-1): thu hẹp stem salary→salaryamount trong AuditMaskerService |
| `677706a` | 2026-07-03 | wip(FND-BE-6-HOLIDAY): wire holiday CONFIG audit-in-tx + masker stems otp/salary/health/idcard |
| `c29ae49` | 2026-07-03 | wip(FND-BE-6-MIG): mig 0468 UNION add-only 'public_holiday' vào CHECK audit_logs + sync AUDIT_OBJECT_TYPES |
| `40acc91` | 2026-07-03 | wip(S2-FND-DB-1-mig): REVOKE DELETE app-role companies+users (mig 0467, BẤT BIẾN #2) |
| `d7e74f6` | 2026-07-03 | chore(harness): regen STATUS sau merge master vào wip |
| `cdc4924` | 2026-07-03 | merge: sync origin/master (S3-QA-1 #108) vào wip/s2-fe-hr-5-hr5-wc |
| `56fc006` | 2026-07-03 | chore(harness): regen STATUS sau khi S3-QA-1 lên master (#108, squash fb07ddb) |
| `fb07ddb` | 2026-07-03 | test(S3-QA-1): QA ATT — today/check-in-out gaps + records filters + canonical-role permission gate (#108) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

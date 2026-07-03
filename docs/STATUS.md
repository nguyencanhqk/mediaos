# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-03 08:23Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression
- 🟡 `S2-FE-ACCT-SEC-1` FE Account Security: section Bảo mật trong /account/profile — trạng thái 2FA + bật (→ /account/setup-2fa) + tắt (dialog mật khẩu, ẨN khi bị ép)
- 🟡 `S2-FE-SYS-SEC-1` FE Admin security: /system/roles form toggle 'Bắt buộc 2FA' + /system/users detail hiện 2FA (nguồn ép) + toggle ép tài khoản + nút Reset 2FA (PermissionGate reset-2fa:user)
- 🔴 `S2-AUTH-DB-3` user_roles soft-delete (audit gap #4): thêm deleted_at/deleted_by + REVOKE DELETE app-role — gỡ role không còn xóa cứng (DB-02 §4.9, BẤT BIẾN #2)
- 🔴 `S2-FND-BE-5` Permission-surface reconcile (audit H4+H6): chốt cặp audit-log viewer (0435↔0340) + MODULE_APP_METADATA sang cặp canonical + chốt gate /settings/public
- 🔴 `S2-FND-BE-6` Trả nợ audit CONFIG holiday (BE-6→BE-9, audit H5) + mở rộng audit-masker stems (otp/salary/health/id_card)
- 🔴 `S2-FND-DB-1` REVOKE DELETE app-role trên companies + users (audit sát-HIGH, BẤT BIẾN #2): chặn hard-delete tenant gốc + tài khoản
- 🔴 `S2-FND-SEED-3` Bootstrap dựng-từ-trống tự động (audit §4.2): seed default company idempotent (thay bước psql tay) + must_change_password cho super-admin bootstrap
- 🟡 `S2-FND-SEED-4` Seed settings đủ theo DB-10 §11 (audit §4.2): bổ sung 9/14 system key + cơ chế company-defaults 12 key + chốt giá trị lệch (25MB vs 20 · 'vi' vs 'vi-VN')
- 🟡 `S3-LEAVE-SEED-2` Leave types 8/8 + pin mã (audit §4.2, DB-10 §14.3): thêm MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY + chốt ANNUAL↔ANNUAL_LEAVE + allowHourly
- 🔴 `S2-FND-JOBS-1` System Jobs khung tối thiểu (audit §5.2, DB-08 §8.14-15 + BACKEND-11 §18): bảng system_job_runs/locks + JobRunner trên WorkerScheduler + schedule RetentionCleanupJob + TEMP_FILE_CLEANUP
- 🔴 `S2-FND-FILE-2` Upload file E2E (audit H3, BACKEND-11 §11.4): chốt mô hình presigned-PUT + POST /:id/confirm → upload_status 'Uploaded' + checksum + extension↔MIME + blocked_extensions
- 🔴 `S2-FND-DB-2` DB hygiene theo DB-09 (audit §3.2, P2): index bổ sung (files/file_access_logs/sequence) + uq_file_links_entity_file_active + trigger chặn UPDATE audit_logs lớp 2
- 🟡 `S2-FND-CONTRACT-1` API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI /docs + bộ mã FOUNDATION-ERR-* + chốt pagination request + migrate DTO cục bộ vào contracts

**CHỜ (kẹt phụ thuộc):**
- `S2-FND-BE-8` Đóng permission-seed orphan (audit §6.3): system-settings GET/PATCH + PATCH modules/:code toggle (audit CONFIG) + audit export + retention POST create/simulate + not-found guard ⏳ cần: S2-FND-BE-5

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-SEED-2`, `S2-FE-FND-7`, `S2-FND-DOC-1`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 0
- **migration head**: idx 146 — `0466_s2_authdb4_user_require_2fa_reset_perm` (147 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `cdc4924` | 2026-07-03 | merge: sync origin/master (S3-QA-1 #108) vào wip/s2-fe-hr-5-hr5-wc |
| `56fc006` | 2026-07-03 | chore(harness): regen STATUS sau khi S3-QA-1 lên master (#108, squash fb07ddb) |
| `fb07ddb` | 2026-07-03 | test(S3-QA-1): QA ATT — today/check-in-out gaps + records filters + canonical-role permission gate (#108) |
| `4b3a033` | 2026-07-03 | chore(harness): regen STATUS sau merge master vào wip |
| `6b1859d` | 2026-07-03 | merge: sync origin/master (wave security-wave1 #107) vào wip/s2-fe-hr-5-hr5-wc |
| `58a6785` | 2026-07-03 | chore(harness): regen STATUS sau khi wave security-wave1 (DB-4+BE-11+BE-12) lên master (#107, squash e565b47) |
| `e565b47` | 2026-07-03 | feat(security-wave1): 2FA per-user + admin reset (DB-4 + BE-11 + BE-12) (#107) |
| `68616f9` | 2026-07-03 | chore(harness): seed 5 WO security-wave (2FA per-user + admin reset + FE security UI) theo owner-decision 2026-07-03 |
| `808bc6a` | 2026-07-03 | chore(harness): regen STATUS sau khi wave carryover-wave1 lên master (#103, squash 9961849) |
| `2827e5a` | 2026-07-03 | merge: sync origin/master (wave carryover-wave1 #103) vào wip/s2-fe-hr-5-hr5-wc — audit report lấy bản master (đã cập nhật bởi S2-FND-DOC-1) |
| `9961849` | 2026-07-03 | feat(carryover-wave1): 12 WO carry-over audit AUTH/FOUNDATION + FE LEAVE/System (#103) |
| `eb85f6d` | 2026-07-03 | chore(harness): wave carryover-wave1 hoàn tất — 12 WO shipped (#90–#102), seed S2-AUTH-CAP-1, handoff 3 owner-decision đã áp dụng, regen STATUS + plan files |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 10:06Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR
- 🔴 `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression
- 🟡 `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions
- 🟡 `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs)
- 🔴 `S2-AUTH-BE-8` user_security_events WRITER (audit gap #1): ghi sự kiện bảo mật BACKEND-03 §22.2 vào bảng user_security_events — viewer /auth/security-events hết rỗng-vĩnh-viễn
- 🔴 `S2-AUTH-BE-9` Lock/suspend user → REVOKE toàn bộ session/refresh NGAY (audit gap #2): đóng cửa sổ access-token ≤15' sau khi khóa
- 🔴 `S2-AUTH-BE-10` refresh() kiểm company active (audit gap #3): company suspended → KHÔNG cấp access token mới (chặn cửa sổ 30 ngày)
- 🔴 `S2-AUTH-DB-3` user_roles soft-delete (audit gap #4): thêm deleted_at/deleted_by + REVOKE DELETE app-role — gỡ role không còn xóa cứng (DB-02 §4.9, BẤT BIẾN #2)
- 🟡 `S2-FE-AUTH-6` FE Account-layer còn thiếu: màn enroll 2FA trong apps/app khi mustSetupTwoFactor (BE đã enforce) + /account/profile (read) + sửa AvatarMenu trỏ đúng
- 🟢 `S2-AUTH-DOC-1` Pin lệch-có-chủ-đích vào docs AUTH (DB-02 · BACKEND-03 · API-02 · FRONTEND-06): code thắng ở các điểm đã chốt — chặn audit sau báo 'lệch' giả
- 🔴 `S2-FND-BE-4` File-access hardening (audit H1+H2): FilePolicy fallback FAIL-CLOSED cho file gắn entity module chưa đăng ký resolver + download chặn Infected/Pending
- 🔴 `S2-FND-BE-5` Permission-surface reconcile (audit H4+H6): chốt cặp audit-log viewer (0435↔0340) + MODULE_APP_METADATA sang cặp canonical + chốt gate /settings/public
- 🔴 `S2-FND-BE-6` Trả nợ audit CONFIG holiday (BE-6→BE-9, audit H5) + mở rộng audit-masker stems (otp/salary/health/id_card)
- 🔴 `S2-FND-DB-1` REVOKE DELETE app-role trên companies + users (audit sát-HIGH, BẤT BIẾN #2): chặn hard-delete tenant gốc + tài khoản
- 🟡 `S2-FND-SEED-2` Runtime seeder HR + Sequences (audit H7, DB-10 §14): job_levels 8 + contract_types 5 + employee_code_config EMP + sequence counter + SequenceService.ensureCounter — DB sạch tự sinh employee_code
- 🔴 `S2-FND-SEED-3` Bootstrap dựng-từ-trống tự động (audit §4.2): seed default company idempotent (thay bước psql tay) + must_change_password cho super-admin bootstrap
- 🟡 `S2-FND-SEED-4` Seed settings đủ theo DB-10 §11 (audit §4.2): bổ sung 9/14 system key + cơ chế company-defaults 12 key + chốt giá trị lệch (25MB vs 20 · 'vi' vs 'vi-VN')
- 🟡 `S3-LEAVE-SEED-2` Leave types 8/8 + pin mã (audit §4.2, DB-10 §14.3): thêm MATERNITY/MARRIAGE/BEREAVEMENT/COMPENSATORY + chốt ANNUAL↔ANNUAL_LEAVE + allowHourly
- 🔴 `S2-FND-JOBS-1` System Jobs khung tối thiểu (audit §5.2, DB-08 §8.14-15 + BACKEND-11 §18): bảng system_job_runs/locks + JobRunner trên WorkerScheduler + schedule RetentionCleanupJob + TEMP_FILE_CLEANUP
- 🟡 `S2-FE-FND-7` FE System sửa nhỏ theo audit (H8 + §7): defaultRoute app Hệ thống → /system + 4 sidebar entry FOUNDATION + GROUP_LABELS 'master-data' + audit-logs default date-range
- 🔴 `S2-FND-DB-2` DB hygiene theo DB-09 (audit §3.2, P2): index bổ sung (files/file_access_logs/sequence) + uq_file_links_entity_file_active + trigger chặn UPDATE audit_logs lớp 2
- 🟡 `S2-FND-CONTRACT-1` API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI /docs + bộ mã FOUNDATION-ERR-* + chốt pagination request + migrate DTO cục bộ vào contracts
- 🟢 `S2-FND-DOC-1` Pin lệch-có-chủ-đích Foundation vào docs (DB-08/09/10 · BACKEND-04/11/12 · API-09/10 · FRONTEND-13): code thắng ở các điểm đã chốt — chặn audit sau báo 'lệch' giả

**CHỜ (kẹt phụ thuộc):**
- `S2-FND-BE-8` Đóng permission-seed orphan (audit §6.3): system-settings GET/PATCH + PATCH modules/:code toggle (audit CONFIG) + audit export + retention POST create/simulate + not-found guard ⏳ cần: S2-FND-BE-5
- `S2-FND-FILE-2` Upload file E2E (audit H3, BACKEND-11 §11.4): chốt mô hình presigned-PUT + POST /:id/confirm → upload_status 'Uploaded' + checksum + extension↔MIME + blocked_extensions ⏳ cần: S2-FND-BE-4

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 1
- **migration head**: idx 145 — `0465_s2_hrbe6_contract_scope_fix` (146 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `74f989a` | 2026-07-02 | Merge remote-tracking branch 'origin/master' into wip/s2-fe-hr-5-hr5-wc |
| `421105e` | 2026-07-02 | chore(harness): seed 15 WO carry-over từ audit Foundation/System 2026-07-02 + báo cáo audit + regen STATUS |
| `efc3399` | 2026-07-02 | chore(harness): regen STATUS sau reconcile 31 WO shipped qua batch-squash (#68/#72/#82/#84/#85/#87/#88) — board còn 4 ready thật (QA-1/QA-2/LEAVE-5/LEAVE-6) (#89) |
| `76794c4` | 2026-07-02 | feat(sprint2): FE Role/Permission admin + account sessions + FND sequences/seeds (#88) |
| `e9ad014` | 2026-07-02 | feat(sprint2/3): FE HR contracts + ATT remote-work (Draft→submit FSM) + ATT reports/audit-logs (#87) |
| `be576d7` | 2026-07-02 | feat(S3-LEAVE-BE-6): LEAVE reports + balance transactions + audit read (P2) (#86) |
| `5ba414f` | 2026-07-02 | chore(harness): reflect parallel session progress (S3-LEAVE-BE-6 PR#86 open, 5 WO committed in fe-batch-c/d) + regen STATUS |
| `1e44be3` | 2026-07-02 | merge: sync wip/s2-fe-hr-5-hr5-wc with origin/master |
| `5689ee1` | 2026-07-02 | chore(harness): mark 18 WOs done (PR #82/83/84/85 merged) + regen STATUS |
| `5268d30` | 2026-07-02 | feat(sprint2/3): FE FND holidays/retention/file-access + HR org-chart/employee-code + ATT adjustment (#85) |
| `9b5be4b` | 2026-07-02 | feat(sprint2): FE Auth self-service + User admin + FND audit/module-catalog + HR change-request (#84) |
| `f250446` | 2026-07-02 | feat(S3-FE-LEAVE-4): FE Lịch nghỉ /leave/calendar (own/team/company theo scope) (#83) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

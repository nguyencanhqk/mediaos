# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-05 00:41Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- _(trống)_

**CHỜ (kẹt phụ thuộc):**
- _(trống)_

**🛑 BLOCKED:**
- `S2-FND-CONTRACT-1` API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI /docs + bộ mã FOUNDATION-ERR-* + chốt pagination request + migrate DTO cục bộ vào contracts

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-DOC-1`

## Trạng thái repo

- **branch**: `feat/debt-wave2` · **file đang đổi (dirty)**: 1
- **migration head**: idx 155 — `0475_s2_fndjobs1_system_jobs` (156 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `abf60df` | 2026-07-04 | wip(fix-jobs1-lanedb-gate): cứng hoá gate LANE_DB cho 3 int-spec jobs_db/jobs_runner |
| `8bb9138` | 2026-07-04 | wip(fix-jobs1-drift-allowlist): register file.pending_ttl_hours vào AGREED_EXTRA_DEFAULT_KEYS |
| `f038259` | 2026-07-04 | wip(jobs_tempfile): TEMP_FILE_CLEANUP handler — eligibility + system soft-delete (deleted_by=NULL) + audit System/null |
| `33e84fd` | 2026-07-04 | wip(jobs_retention): RetentionCleanupJobHandler bọc RetentionCleanupJob thành JobHandler |
| `d3e5959` | 2026-07-04 | wip(jobs_runner): SchedulerModule system-jobs runner (crown) — lock/logger/scrub/runner + wiring |
| `a9679ec` | 2026-07-04 | wip(jobs_db): mig 0475 system_job_runs (RLS+FORCE per-role app/worker, no-DELETE grant) + system_job_locks (no-RLS worker-infra) + drizzle parity + int-spec |
| `bdb0dba` | 2026-07-04 | chore(harness): regen STATUS (bỏ sót ở commit trước) — dọn cache plan S2-FND-JOBS-1 để re-decompose round 4 |
| `aa8f3e9` | 2026-07-04 | chore(harness): lưu micro-plan S2-FND-JOBS-1 round3 (block lần 3 — thiếu 2-tenant isolation test cho system_job_runs + vài điểm cần chốt hợp đồng JobHandler/withTenant) |
| `cdb266b` | 2026-07-04 | chore(harness): chốt S2-FND-BE-8 (auto-loop, pushed feat/debt-wave2) + lưu micro-plan S2-FND-JOBS-1 (block round2: secret-scrub/lane-wiring/link-safety) |
| `a45bd45` | 2026-07-04 | wip(be-retention-create-simulate): POST create + simulate với audit-in-tx + 404 guard |
| `78eb6a9` | 2026-07-04 | wip(be-module-toggle): PATCH /foundation/modules/:code enable/disable (S2-FND-BE-8) |
| `f3fb93b` | 2026-07-04 | wip(be-system-settings): GET/PATCH /foundation/system-settings(/:key) + system-manage gate |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

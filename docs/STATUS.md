# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-02 08:32Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S2-FE-AUTH-4` FE Role & Permission admin: /system/roles create/detail/edit + assign-permissions + /system/permissions catalog
- 🟡 `S2-FE-AUTH-5` FE Account self-service: /account/sessions (list + revoke phiên của chính user)
- 🟡 `S2-FE-FND-5` FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview+config) + Seed Status (/system/seeds read-only)
- 🟡 `S2-FE-HR-7` FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contracts (HĐ của nhân viên) nối contract API
- 🔴 `S3-QA-1` QA ATT: today/check-in/out rule + blocked-leave-day + records scope Own/Team/Company + permission/data-scope cross-team/cross-company + 0-dup + server-time + regression Auth/HR
- 🔴 `S3-QA-2` QA LEAVE + integration: balance + request draft/submit/cancel/validation/overlap + approval approve/reject scope + LEAVE→ATT (Approved full-day→Leave record + check-in block + cancel/revoke recalc+balance restore) + regression
- 🟡 `S3-FE-ATT-4` FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id): tạo + duyệt
- 🟡 `S3-FE-ATT-6` FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-logs)
- 🟡 `S3-LEAVE-BE-6` LEAVE Reports + balance transactions + audit read (P2): GET /leave/balances/:id/transactions (ledger) + /leave/reports + /leave/audit-logs (foundation audit filter LEAVE)

**CHỜ (kẹt phụ thuộc):**
- `S3-FE-LEAVE-5` FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR) + /leave/balances/:id/transactions ⏳ cần: S3-LEAVE-BE-6
- `S3-FE-LEAVE-6` FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) ⏳ cần: S3-LEAVE-BE-6

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-AUTH-BE-7`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-5`, `S3-LEAVE-BE-5`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`

## Trạng thái repo

- **branch**: `wip/s2-fe-hr-5-hr5-wc` · **file đang đổi (dirty)**: 314
- **migration head**: idx 145 — `0465_s2_hrbe6_contract_scope_fix` (146 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `5689ee1` | 2026-07-02 | chore(harness): mark 18 WOs done (PR #82/83/84/85 merged) + regen STATUS |
| `46038a0` | 2026-07-02 | chore(harness): stamp pr_opened for fe-batch-a (PR #84) + fe-batch-b (PR #85) + regen STATUS |
| `5ff5f26` | 2026-07-02 | chore(harness): stamp pr_opened for batch6 (PR #82) + regen STATUS |
| `087ba4f` | 2026-07-02 | chore(harness): sync ledger for batch6 (7/7 done) + fe-batch-a/b progress (7/10 done) + regen STATUS |
| `46b3c9b` | 2026-07-02 | fix(harness): reconcile-merged false-positive on chore(harness) commits |
| `911179b` | 2026-07-02 | wip(HR5-SCREENS): HR master-data admin screens (departments/positions/job-levels/contract-types) |
| `178dfa3` | 2026-07-02 | chore(harness): reconcile plan_block feedback into done_when for 6 blocked WOs |
| `dcb0f34` | 2026-07-02 | chore(harness): reconcile S2-FE-FND-1 + S2-HR-BE-7 (PR #79 merged) + S3-FE-LEAVE-3 (duplicate stray commit) + regen STATUS |
| `899f48a` | 2026-07-02 | wip(HR5-WC): web-core HR master-data spine (api + pairs + routes + i18n + drift-guard) |
| `271bc40` | 2026-07-02 | chore(harness): reconcile S3-ATT-BE-4 + S2-FND-BE-1 stale ledger entries + reopen S2-FND-BE-2 + regen STATUS (#75) |
| `df6d468` | 2026-07-02 | chore(harness): regen STATUS after wave3 round 1 (#71) |
| `b91f9bd` | 2026-07-01 | chore(harness): commit stray plan docs from prior wave + regen STATUS (#67) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

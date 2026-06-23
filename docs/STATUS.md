# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-23 04:25Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🟢 S0-GOV-1 — Governance: chuẩn hoá board/label/DoR/DoD + chốt backlog harness theo ISSUE-BOARD-01 (master-plan pointer)
- **zone**: green
- **sửa ở đâu (paths)**: `harness/**`, `docs/plans/**`, `docs/STATUS.md`, `.claude/**`
- **done_when (đích hội tụ)**:
  - [ ] backlog.mjs + docs/plans/MVP-MASTER-PLAN.md phản ánh đúng kế hoạch mới (7 sprint, pull-sprint policy); STATUS regen khớp
  - [ ] DoR/DoD + label taxonomy (module/layer/priority/sprint/scope) ghi rõ ở master-plan, trace về ISSUE-BOARD-01
  - [ ] mọi WO trong file này có src[] trace về docs nguồn (ISSUE-BOARD §5.2)

### 🟢 S0-FE-API-1 — Đối chiếu API client + query layer + error mapper (401/403/422/500 · request-id · idempotency) với FRONTEND-04
- **zone**: green · **skills**: code-review
- **sửa ở đâu (paths)**: `packages/web-core/**`
- **phụ thuộc**: S0-API-CORE-1⏳
- **done_when (đích hội tụ)**:
  - [ ] api-client inject token + map 401(refresh)/403(forbidden)/422(validation)/500; gắn request-id + idempotency-key
  - [ ] query/cache layer (TanStack Query) + invalidation; validate response bằng Zod contracts
  - [ ] web-core test xanh

### 🟡 S0-QA-1 — Test strategy + verify migrate/seed từ DB trống + test-case matrix skeleton (QA-01/02)
- **zone**: yellow · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/test/**`, `docs/plans/**`
- **phụ thuộc**: S0-FND-DB-1✓
- **done_when (đích hội tụ)**:
  - [ ] migrate + seed chạy sạch từ DB trống (lane DB cô lập) — không lỗi, idempotent
  - [ ] test strategy + smoke checklist + test-data plan ghi rõ; test-case matrix skeleton theo module (QA-02)

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🔴 `S0-FND-SEED-1` Seed module catalog (MVP active · Phase inactive) + default system/company settings idempotent (ON CONFLICT)
- 🟢 `S1-FE-LAYOUT-1` FE shell: Home Portal + App Switcher + Module Workspace layout (topbar/sidebar, permission-based app visibility, dirty-form guard)
- 🟢 `S1-FE-REGISTRY-1` App/route/sidebar registry (permission-driven; metadata permission/scope/module/status — KHÔNG hard-code role)
- 🟡 `S1-QA-DEBT-1` Test-suite triage: xoá/exclude test của module PARKED (de-media-fy: finance·workflow·media) + gate test phụ thuộc WO chưa land — để `pnpm api test` xanh = phạm vi THẬT
- 🟡 `S1-INT-MOUNT-1` Quyết scope + mount-or-skip: webhooks-deny + ui-config-deny đang 404 (module chưa mount) — mount nếu trong MVP, else exclude test có vé Phase

**CHỜ (kẹt phụ thuộc):**
- `S1-FND-SETTING-1` SettingService: precedence company→system→default + /settings/public (lọc is_public, mask is_sensitive) + admin update có audit ⏳ cần: S1-FND-AUDIT-1
- `S1-FND-FILE-1` FileService: upload metadata + StorageAdapter port + FilePolicy (deny-by-default) + link/unlink + download-qua-backend + file_access_log ⏳ cần: S1-FND-AUDIT-1
- `S1-FND-MODULE-1` CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogService /modules/my-apps (lọc permission+active+setting) ⏳ cần: S0-FND-SEED-1, S1-FND-AUDIT-1
- `S1-FND-WIRE-1` FoundationModule gom (company·module-catalog·settings·audit·files·sequence·holidays·retention·seed) + foundation contracts (Zod) + wire app.module additive ⏳ cần: S1-FND-AUDIT-1, S1-FND-SETTING-1, S1-FND-FILE-1, S1-FND-SEQ-1, S1-FND-MODULE-1
- `S1-QA-FND-1` QA hardening Foundation: permission/scope + file security + sequence concurrency + audit masking + public-settings leak + append-only ⏳ cần: S1-FND-AUDIT-1, S1-FND-SETTING-1, S1-FND-FILE-1, S1-FND-SEQ-1, S1-FND-MODULE-1

**🛑 BLOCKED:**
- `S0-CI-2` CI security gates: secret-scan (gitleaks/trufflehog) + dependency-scan (pnpm audit) theo DEVOPS-02 §9.2/§11/§17.2
- `S0-AUTH-DB-1` Đối chiếu AUTH/RBAC schema (users·sessions·password_reset·login_log·roles·permissions·user_roles·role_permissions) + seed matrix với DB-02
- `S0-API-CORE-1` Đối chiếu shared config·logger·error-response envelope {success,message,data,meta}·health/health-db·auth context với BACKEND-01
- `S1-FND-AUDIT-1` AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail API theo permission+data-scope (append-only)
- `S1-FND-SEQ-1` SequenceService.nextCode (tx + FOR UPDATE) + preview (không tăng) + reset_policy; concurrency 0-dup

**Đã xong (v2):** `S0-CI-1`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FE-CORE-1`

## Trạng thái repo

- **branch**: `feat/foundation-wave1` · **file đang đổi (dirty)**: 2
- **migration head**: idx 121 — `0438_foundation_db6_audit_db08_shape` (122 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| — | — | (không đọc được git log) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._

# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-06-23 09:12Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- _(trống)_

**CHỜ (kẹt phụ thuộc):**
- `S1-FND-SETTING-1` SettingService: precedence company→system→default + /settings/public (lọc is_public, mask is_sensitive) + admin update có audit ⏳ cần: S1-FND-AUDIT-1
- `S1-FND-FILE-1` FileService: upload metadata + StorageAdapter port + FilePolicy (deny-by-default) + link/unlink + download-qua-backend + file_access_log ⏳ cần: S1-FND-AUDIT-1
- `S1-FND-MODULE-1` CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogService /modules/my-apps (lọc permission+active+setting) ⏳ cần: S1-FND-AUDIT-1
- `S1-FND-WIRE-1` FoundationModule gom (company·module-catalog·settings·audit·files·sequence·holidays·retention·seed) + foundation contracts (Zod) + wire app.module additive ⏳ cần: S1-FND-AUDIT-1, S1-FND-SETTING-1, S1-FND-FILE-1, S1-FND-SEQ-1, S1-FND-MODULE-1
- `S1-QA-FND-1` QA hardening Foundation: permission/scope + file security + sequence concurrency + audit masking + public-settings leak + append-only ⏳ cần: S1-FND-AUDIT-1, S1-FND-SETTING-1, S1-FND-FILE-1, S1-FND-SEQ-1, S1-FND-MODULE-1

**🛑 BLOCKED:**
- `S0-CI-2` CI security gates: secret-scan (gitleaks/trufflehog) + dependency-scan (pnpm audit) theo DEVOPS-02 §9.2/§11/§17.2
- `S1-FND-AUDIT-1` AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail API theo permission+data-scope (append-only)
- `S1-FND-SEQ-1` SequenceService.nextCode (tx + FOR UPDATE) + preview (không tăng) + reset_policy; concurrency 0-dup

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`

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

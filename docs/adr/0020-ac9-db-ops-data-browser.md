# ADR-0020 — AC-9 db-ops data browser (operator CHỈ-ĐỌC, tenant-scoped qua Tầng 1)

- **Trạng thái:** 📝 Proposed (hiện thực hoá Tầng 3 của [0019](0019-control-plane-cross-tenant-access.md) cho AC-9 — `docs/prompts/ADMIN-CONTROL-PLANE-PRD-2026-06-17-v2.md` §3.4/§3.5/§4 N6)
- **Bất khả nghịch:** ⚠️ Cao (chạm RLS/auth/secret — BẤT BIẾN #1 & #3)
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0003](0003-pgbouncer-transaction-mode.md), [0004](0004-envelope-encryption-kms.md), [0010](0010-permission-engine-4-tier.md), [0017](0017-platform-admin-tenancy.md), **[0019](0019-control-plane-cross-tenant-access.md)** (mở rộng Tầng 3); G6-2 break-glass, AC-8

## Bối cảnh

AC-9 (db-ops) là **lane cuối** của Admin Control Plane, **blast-radius cao nhất**: operator cần (P1) xem trạng thái migration, (P2) **duyệt dữ liệu chéo tenant** (đọc bảng tuỳ ý), (P3) gate break-glass cho P2/P4, (P4) job xuất dữ liệu.

[ADR-0019 §Tầng 3](0019-control-plane-cross-tenant-access.md) đề xuất "role DB read-only chuyên dụng + pool riêng" cho data browser **quét-tất-cả-tenant**, nhưng đánh dấu là tầng nặng nhất (cần provision role/pool, elevated DB privilege lúc migrate). Câu hỏi cần chốt cho AC-9: **dùng cơ chế gì để đọc dữ liệu chéo tenant** mà KHÔNG (a) provision hạ tầng nặng ngay, (b) mở rộng escape-hatch/BYPASSRLS, (c) rò secret/PII.

## Quyết định

### 1. Data browser = TENANT-SCOPED qua Tầng 1 `withTenant(targetCompanyId)` (ADR-0019 Tầng 1)

Operator chọn **1 target tenant** + **1 bảng allowlist** + filter → đọc rows qua `db.withTenant(targetCompanyId, tx => …)`. RLS policy `company_id = current_setting('app.current_company_id')` **ÉP** khi `current = target` ⇒ chỉ thấy rows của đúng target tenant. **KHÔNG GUC mới · KHÔNG BYPASSRLS · KHÔNG mở rộng `app.platform_admin`.** Đây là cơ chế đã chạy (precedent `PlatformCompanyService` / AC-2/AC-3/AC-4), reviewer đã quen.

- **All-tenant scan (Tầng 3 role-DB-read-only + pool riêng) = DEFER.** Lý do hạ tầng: cần provision role Postgres read-only riêng + pool riêng + elevated DB privilege lúc migrate (`assertWorkerRoleSafe`), blast-radius lớn. Tenant-scoped browse (chọn target) đáp ứng 95% nhu cầu support; quét-tất-cả là hardening tương lai. Khi cần: thêm ADR riêng kế thừa 0019 §Tầng 3.

### 2. Allowlist default-DENY bảng + cột (defense-in-depth, BẤT BIẾN #3)

Data browser CHỈ đọc bảng + cột khai **tường minh** trong 1 allowlist (`packages/contracts/db-ops-allowlist.ts`). Bảng/cột ngoài allowlist → **400** (không passthrough). **LOẠI TRỪ tuyệt đối** (không bao giờ vào allowlist/projection/DTO/log/audit): `platform_accounts.secret_ciphertext`, `payslips`/`payslip_items`/`salary_profiles`, `*_totp`/two-factor secret, webhook secret envelope, `encryption_keys` (toàn bảng), `api_keys.token_hash`, `break_glass*`/`db_ops*` `reason`. Pagination BẮT BUỘC + ROW CAP [1..100].

### 3. Break-glass SoD gate (mirror G6-2) — bảng GLOBAL no-RLS operator-scoped

Mỗi data-browser/export read là đường **KHẨN CẤP**: cần 1 grant `'active'` còn hạn của operator cho target (hoặc all-tenant grant `target_tenant_id IS NULL`), ÉP `expires_at > now()` Ở DB. 3 bảng `db_ops_grants`/`db_ops_grant_approvals`/`db_export_jobs` dùng cột **`target_tenant_id` (KHÔNG `company_id`)** ⇒ GLOBAL no-RLS ⇒ tự loại khỏi rls-guards/rls-coverage-assert, KHÔNG vào rls-registry/cleanupTenants. Append-only + frozen cols ép Ở DB qua `REVOKE UPDATE,DELETE` + column-GRANT. SoD ÉP 3 tầng: `UNIQUE(grant_id,approver_user_id)` + `CHECK(approver<>requester)` + `CHECK(required_approvals>=2)` + service `COUNT(DISTINCT approver)>=required` mới flip `'active'`.

### 4. Audit từng query đọc (forensic, fail-closed)

MỖI data-browser/export read ghi 1 operator-action audit (actor + target + bảng + filter cột + returned count) qua `recordOperatorAction` (object_type=`'company'` REUSE ⇒ **0 audit-CHECK change**, giống AC-8) trong tx `withTenant(target)` RIÊNG. **Fail-closed**: audit lỗi ⇒ throw ⇒ client KHÔNG nhận data. after KHÔNG chứa row data/filter value (chỉ tên bảng/cột/count) — BẤT BIẾN #3.

### 5. Auth + chống reveal-class trap

Mọi route operator: `@OperatorOnly` (aud=operator) + `@UseGuards(OperatorReauthGuard, PermissionGuard)` + `@RequirePermission(action, resource, { isSensitive: true })` — **CHỈ isSensitive, TUYỆT ĐỐI KHÔNG `requiresReauth:true`** (cặp `isSensitive && requiresReauth` ⇒ reveal-class ⇒ per-OBJECT grant ⇒ operator role-level grant deny VĨNH VIỄN; đã phá AC-7/G12-4). Step-up cross-tenant ÉP tường minh ở controller qua `operatorReauth.resolveWindow`, fail-closed 403. Tenant-scoped op step-up theo target tenant id thật; all-tenant op (migration-status) theo sentinel `PLATFORM_DB_OPS_SCOPE`.

## Hệ quả

- ✅ KHÔNG hạ tầng mới (không role/pool DB riêng) — dùng `withTenant(target)` đã kiểm chứng. **Tầng 3 all-tenant DEFER.**
- ✅ Secret/PII bất khả xâm phạm: allowlist default-DENY + loại trừ verbatim + audit metadata-only.
- ✅ 0 audit-CHECK / schema-audit change (reuse object_type=`'company'`); bảng db_ops_* không đụng tenant-isolation (no company_id).
- ⚠️ Tenant-scoped: operator phải biết/chọn target id (không quét mù). Chấp nhận đánh đổi để né hạ tầng nặng.
- ⚠️ Worker materialize file export = scaffold (DEFER, như AC-6 delivery worker): job chỉ enqueue + audit, chưa tạo file thật.

## Phương án bị loại

- **Tầng 3 role-DB-read-only ngay (ADR-0019):** DEFER — provision role/pool nặng, elevated DB privilege; tenant-scoped đủ dùng.
- **GUC mới `app.platform_dbops_read` (mirror AC-8 `app.platform_audit_read`):** né được nhưng mở thêm bề mặt RLS cross-tenant cho bảng tuỳ ý — chỉ cân nhắc nếu Tầng 1 không đủ. Tầng 1 đủ ⇒ KHÔNG thêm GUC.
- **BYPASSRLS ở app role:** cấm tuyệt đối (ADR-0001/0003).

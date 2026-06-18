# ADR-0021 — AC-9 Tầng 3: all-tenant data browse qua role DB read-only `mediaos_readonly`

- **Trạng thái:** 📝 Proposed (hiện thực hoá **Tầng 3** của [0019](0019-control-plane-cross-tenant-access.md) cho AC-9 — phần mà [0020](0020-ac9-db-ops-data-browser.md) §19 **hoãn**: "Khi cần: thêm ADR riêng kế thừa 0019 §Tầng 3")
- **Bất khả nghịch:** ⚠️ Cao (chạm RLS/auth/secret — BẤT BIẾN #1 & #3)
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0003](0003-pgbouncer-transaction-mode.md), [0010](0010-permission-engine-4-tier.md), [0017](0017-platform-admin-tenancy.md), [0019](0019-control-plane-cross-tenant-access.md) (Tầng 3), **[0020](0020-ac9-db-ops-data-browser.md)** (mở rộng — gỡ DEFER); G6-2 break-glass, AC-8

## Bối cảnh

[ADR-0020](0020-ac9-db-ops-data-browser.md) chốt data-browser AC-9 là **TENANT-SCOPED** qua Tầng 1 `withTenant(targetCompanyId)`: operator chọn **1 target tenant** đã biết id → đọc rows tenant đó. Đủ ~95% nhu cầu support, KHÔNG hạ tầng mới. ADR-0020 §19 **DEFER** all-tenant scan (Tầng 3 của [0019](0019-control-plane-cross-tenant-access.md)) vì "provision role/pool nặng + elevated DB privilege", và ghi rõ: *"Khi cần: thêm ADR riêng kế thừa 0019 §Tầng 3."*

WAVE 3 cần năng lực **quét xuyên MỌI tenant** (vd: tìm 1 user theo email mà không biết tenant nào, đối chiếu dữ liệu chéo tenant cho support/forensic) — `withTenant(target)` không đáp ứng vì phải biết target id trước. Câu hỏi: đọc all-tenant **bằng cơ chế gì** mà KHÔNG (a) BYPASSRLS ở app/worker role (ADR-0001/0003 cấm; `db/worker-role.ts::assertWorkerRoleSafe` chặn), (b) mở rộng escape-hatch GUC sang bảng nghiệp vụ (0017/0020 cấm), (c) rò secret/PII.

Hiện trạng xác minh trên code:
- 3 role runtime (`mediaos_owner`/`mediaos_app`/`mediaos_worker`) đều `NOSUPERUSER NOBYPASSRLS` (mig 0001). Dưới FORCE-RLS, role chỉ-`GRANT SELECT` (không bypass, không policy) thấy **0 row chéo tenant** — fail-closed, không đọc được.
- **Tiền lệ đã chạy:** `mediaos_worker` đọc all-tenant `outbox_events`/`dead_letter_events` qua **policy `FOR SELECT TO mediaos_worker USING (true)`** (mig 0003) — vẫn `NOBYPASSRLS`. Cross-tenant read không cần bypass; chỉ cần 1 policy role-targeted.

## Quyết định

### 1. Role DB read-only chuyên dụng `mediaos_readonly` — NOBYPASSRLS, NOLOGIN

`CREATE ROLE mediaos_readonly NOSUPERUSER NOBYPASSRLS NOLOGIN` (mig 0346, idempotent như 0001). **NOLOGIN**: chỉ tiếp cận qua `SET LOCAL ROLE` từ `mediaos_app` trong 1 transaction — KHÔNG kết nối trực tiếp, KHÔNG credential mới, KHÔNG pool/hạ tầng mới (gỡ đúng cái 0020 ngại). `GRANT mediaos_readonly TO mediaos_app` để `SET ROLE` hợp lệ. Vì NOBYPASSRLS, role này vẫn lọt qua `assertWorkerRoleSafe` (không phải role bypass).

### 2. All-tenant read = policy `FOR SELECT TO mediaos_readonly USING (true)` per-bảng allowlist (mirror `mediaos_worker`)

Mỗi bảng trong allowlist data-browser (`packages/contracts/db-ops-allowlist.ts` — companies/users/org_units/teams/projects/channels/content_items/tasks) thêm 1 policy `FOR SELECT TO mediaos_readonly USING (true)` (read-only — **KHÔNG `WITH CHECK`** ⇒ không INSERT/UPDATE/DELETE chéo tenant qua role này). Đây là **đúng khuôn mediaos_worker** (0003), reviewer đã quen. RLS combine permissive policies bằng OR theo role hiện hành: sau `SET ROLE mediaos_readonly`, chỉ policy `TO mediaos_readonly` áp ⇒ thấy mọi row của các bảng allowlist (và **default-deny mọi bảng khác**: không policy cho role ⇒ 0 row).

### 3. GRANT SELECT THEO CỘT (column-scoped) — secret/PII bất khả xâm phạm Ở DB (BẤT BIẾN #3)

`GRANT SELECT (<chỉ cột allowlist>) ON <bảng> TO mediaos_readonly` — KHÔNG `GRANT SELECT` toàn bảng. Kể cả service có bug/injection chọn `password_hash`/`secret_ciphertext`/cột lương, DB **từ chối ở tầng quyền** (permission denied), không chỉ ở tầng app projection. Defense-in-depth: allowlist (app) + column-grant (DB) là 2 lớp độc lập.

### 4. Helper `withAllTenantReadContext(fn)` — SET LOCAL ROLE, transaction-scoped (PgBouncer-safe)

Đối xứng `withPlatformReadContext` (AC-8): mở transaction → `SET LOCAL ROLE mediaos_readonly` → chạy `fn` (chỉ SELECT) → commit (role tự reset, an toàn PgBouncer transaction-mode ADR-0003). KHÔNG set `app.current_company_id` (cố ý — quét all-tenant). Default-deny ngoài helper: không SET ROLE ⇒ `mediaos_app` đọc như thường (tenant-scoped).

### 5. Gate ÉP 3 lớp + audit fail-closed (mirror AC-8/AC-9)

Route `GET /operator/db-ops/browse-all`: `@OperatorOnly` (aud=operator) + `PermissionGuard` `@RequirePermission('read','db-all-tenant',{isSensitive:true})` (**CHỈ isSensitive, KHÔNG requiresReauth** — tránh reveal-class trap đã phá AC-7/G12-4) + step-up sentinel `PLATFORM_DB_OPS_SCOPE` (all-tenant op) + break-glass grant **all-tenant** (`findActiveAllTenantGrantTx` — grant `target_tenant_id IS NULL` 'active' còn hạn; grant tenant-scoped **KHÔNG đủ**). MỖI read ghi 1 operator-action audit (`operator.all_tenant_read`, object_type='company' REUSE ⇒ 0 audit-CHECK change) qua `withTenant(operator.companyId)` RIÊNG (audit_logs WITH CHECK keyed company_id ⇒ ghi ở home tenant của operator, mirror AC-8 `listCrossTenant`). Audit lỗi ⇒ throw ⇒ client KHÔNG nhận data. `after` chỉ metadata (bảng/cột/filter-col/count) — KHÔNG row data/filter value.

## Lý do

- **NOBYPASSRLS, không hạ tầng mới:** dùng đúng tiền lệ `mediaos_worker` (policy `USING(true)` + NOBYPASSRLS) + `SET LOCAL ROLE` (không pool/credential mới) ⇒ gỡ được lý do 0020 hoãn mà KHÔNG phá BẤT BIẾN #1 / ADR-0001/0003.
- **Blast-radius cô lập + tăng có chủ đích:** policy mới CHỈ trên đúng bảng allowlist, CHỈ cho đúng role `mediaos_readonly`, CHỈ chiều đọc. Không blanket-hatch, không đụng app role.
- **Secret/PII 2 lớp:** allowlist app (default-DENY 400) + column-GRANT DB (permission denied). Loại trừ verbatim như 0020 §2.
- **Nhất quán gate AC-9:** tái dùng break-glass SoD + step-up + audit metadata-only sẵn có.

## Hệ quả

- ✅ Gỡ DEFER của 0020 §19 cho năng lực all-tenant browse — KHÔNG đụng đường tenant-scoped (vẫn `withTenant(target)`).
- ⚠️ **Nghĩa vụ đồng bộ allowlist ↔ policy:** thêm bảng vào allowlist data-browser ⇒ PHẢI thêm policy + column-GRANT cho `mediaos_readonly` ở migration mới, nếu không browse-all bảng đó trả **0 row** (fail-closed, không rò — nhưng là lỗ hổng chức năng). Có test coverage assert mọi bảng allowlist đọc được qua role (chống drift).
- ⚠️ Role `mediaos_readonly` tồn tại ở cluster (NOLOGIN, NOBYPASSRLS, column-grant hẹp). Vận hành: KHÔNG cấp LOGIN, KHÔNG cấp INSERT/UPDATE/DELETE, KHÔNG `GRANT` role này cho ai ngoài `mediaos_app`.
- ⚠️ Quét all-tenant nặng hơn tenant-scoped (đọc qua nhiều tenant) → pagination + ROW CAP BẮT BUỘC (kẹp [1..100], như 0020) + `statement_timeout='30s'` LOCAL trong `withAllTenantReadContext` (chặn slow-scan/DoS kể cả caller hợp lệ).
- ⚠️ **PII có chủ đích:** allowlist (kế thừa AC-9 `DB_BROWSER_ALLOWLIST`) gồm `users.email` — column-GRANT cấp cho `mediaos_readonly` ở tầng DB. Là đánh đổi support/forensic CÓ CHỦ Ý (gate sau permission is_sensitive + step-up + break-glass all-tenant). KHÔNG mở rộng sang phone/địa chỉ trừ khi thật cần.
- ⚠️ **Forensic:** audit `operator.all_tenant_read` ghi vào HOME tenant của operator (audit_logs WITH CHECK keyed company_id ⇒ không ghi được "all-tenant"), mirror AC-8. Truy vết all-tenant-browse phải query theo actor+action ở tenant operator, KHÔNG xuất hiện ở audit trail của từng tenant bị đọc.
- 🅿️ **Follow-up hardening (DEFER, không block):** thêm assertion lúc boot rằng `mediaos_readonly` CHỈ được GRANT cho `mediaos_app` với `inherit_option=false` (chống lỡ `GRANT mediaos_readonly TO mediaos_worker` thiếu INHERIT FALSE — `assertWorkerRoleSafe` hiện KHÔNG bắt case này). Comment migration "KHÔNG cấp cho role khác" + NOINHERIT trên role là rào tạm.

## Phương án bị loại

- **Role read-only CÓ BYPASSRLS (+ pool riêng):** đơn giản hoá logic đọc nhưng thêm 1 role bypass vào cluster — phá tinh thần BẤT BIẾN #1 / `assertWorkerRoleSafe`, blast-radius lớn nếu role bị lạm dụng. Policy `USING(true)` NOBYPASSRLS đạt cùng kết quả mà không có role bypass nào.
- **GUC mới `app.platform_dbops_read` (mirror AC-8):** mở thêm bề mặt RLS cross-tenant cho app role trên bảng tuỳ ý + bị 0020 §48 loại; policy role-targeted hẹp hơn (chỉ `mediaos_readonly`, không phải `mediaos_app`).
- **Giữ DEFER (chỉ tenant-scoped):** không đáp ứng nhu cầu quét-không-biết-tenant của WAVE 3.

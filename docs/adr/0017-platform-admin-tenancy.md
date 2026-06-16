# ADR-0017 — Platform-admin tenancy: GUC escape-hatch trên `companies` (SaaS control plane)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao (chạm RLS — BẤT BIẾN #1)
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0003](0003-pgbouncer-transaction-mode.md), [0010](0010-permission-engine-4-tier.md); G16-3 (`TASKS.md` §G16)

## Bối cảnh

MediaOS là **SaaS-ready**: G16-3 cần tầng **platform-admin** (control plane) quản vòng đời tenant **chéo công ty** — list mọi workspace, tạo công ty mới, đình chỉ/cấu hình bất kỳ công ty nào.

Nhưng BẤT BIẾN #1 (ADR-0001): mọi bảng nghiệp vụ ép RLS theo `app.current_company_id`. `companies` có **FORCE ROW LEVEL SECURITY** với policy `id = app.current_company_id` ⇒ trong một `withTenant(X)`, bạn CHỈ thấy/sửa công ty X. Không có cách nào để một admin "list tất cả workspace" hay "tạo công ty mới" (chưa có tenant context) mà KHÔNG phá mô hình RLS.

Các lựa chọn cho truy cập chéo tenant:
1. Dùng role **BYPASSRLS** / superuser ở runtime app — ADR-0001/0003 cấm (app role KHÔNG bao giờ bypass RLS; chỉ migration/seed dùng owner).
2. Tách hẳn **boundary auth platform** riêng (login + JWT audience + DB role riêng) — đúng lâu dài nhưng tốn (nhiều ngày), thừa cho giai đoạn scaffold.
3. **GUC escape-hatch** giới hạn cực hẹp trên ĐÚNG bảng cần.

## Quyết định

Dùng **(3)**: thêm GUC LOCAL `app.platform_admin` và nới policy RLS **CHỈ trên `companies`**.

1. **Policy `companies`** (mig 0230) đổi thành:
   `USING/WITH CHECK ( id = app.current_company_id OR current_setting('app.platform_admin', true) = 'on' )`.
   **Default-DENY**: GUC chưa set ⇒ `current_setting(...,true)` trả NULL ⇒ `NULL = 'on'` là NULL (false) ⇒ KHÔNG bypass. Company-admin thường (chỉ có `app.current_company_id`) KHÔNG bao giờ thấy chéo tenant.

2. **`DatabaseService.withPlatformContext(fn)`** mở 1 transaction set `set_config('app.platform_admin','on',true)` (LOCAL — tự reset khi commit/rollback, an toàn PgBouncer transaction-mode như `withTenant`), và **KHÔNG** set `app.current_company_id`.

3. **Escape-hatch dùng cho ĐÚNG 1 thao tác**: **LIST mọi công ty** (`SELECT companies` chéo tenant) — thao tác duy nhất không có tenant context.

   **CREATE** công ty mới KHÔNG cần escape-hatch: app tự sinh UUID `newId` rồi chạy `withTenant(newId)` — `INSERT companies (id=newId)` qua WITH CHECK (`id = current_company`), và provision template + set subscription + audit chạy CÙNG tx ⇒ **ATOMIC** (lỗi bất kỳ → rollback toàn bộ, KHÔNG để công ty mồ côi), KHÔNG cần compensation.

   Mọi thao tác khác cũng chạy **`withTenant(targetCompanyId)`** (helper nhận `companyId` arg, độc lập JWT): get-one/suspend/configure một công ty (policy `id = current` khớp khi current = target), set plan/flag, và **TOÀN BỘ audit** ghi dưới `company_id` công ty đích như thường lệ. Tóm lại escape-hatch CHỈ được "đốt" bởi list-all.

4. **Cổng quyền**: endpoint platform dùng `PermissionGuard` + `@RequirePermission(action, 'platform-company'|'platform-template'|'platform-subscription', { isSensitive: true })`. Quyền sensitive ⇒ chỉ role được GRANT TƯỜNG MINH non-wildcard mới qua (ADR-0010 §sensitive gate; wildcard `*:*` của company-admin KHÔNG kế thừa). Seed role hệ thống `platform-admin` (mig 0230) giữ 4 quyền này. KHÔNG cần guard riêng — `PermissionGuard` đã fail-closed (thiếu decorator → 403).

## Lý do

- **Blast radius tối thiểu**: chỉ `companies` được nới; MỌI bảng nghiệp vụ khác giữ RLS nguyên vẹn — trong `withPlatformContext` chúng vẫn trả 0 row (không set company GUC), nên không có đường rò chéo tenant ngoài đúng `companies`.
- **Ở trong app role** (không BYPASSRLS): tuân ADR-0001/0003.
- **Fail-closed mặc định**: GUC vắng ⇒ hành vi y hệt trước G16-3.
- **Tái dùng permission engine**: platform-admin chỉ là user giữ role hệ thống `platform-admin`; không đổi shape JWT, không thêm boundary auth.

## Hệ quả

- **Cấm mở rộng** nhánh `app.platform_admin` sang policy bảng khác. Nếu tương lai cần platform ghi chéo tenant trên bảng per-company, làm qua `withTenant(targetCompanyId)` (đã đủ) — KHÔNG nới thêm escape-hatch.
- `withPlatformContext` CHỈ được gọi sau khi qua `PermissionGuard` với quyền `*:platform-company`. Reviewer FULL-gate phải canh điều này khi diff chạm `withPlatformContext`.
- **Create ATOMIC 1 tx**: `withTenant(newId)` (id tự sinh) — INSERT companies + provision template + set subscription + audit cùng commit/rollback. KHÔNG cần compensation, KHÔNG có cửa sổ công ty mồ côi.
- **Hardening follow-up**: role `platform-admin` nên bật `requires_two_factor=true` ở prod (hiện false để không phá harness login/test). Cân nhắc re-auth (step-up) cho thao tác suspend chéo tenant.

## Phương án đã loại

- **Boundary auth platform riêng** (JWT audience + DB role riêng): đúng nhất lâu dài nhưng quá tốn cho scaffold; có thể nâng cấp sau mà KHÔNG phá thiết kế này (escape-hatch vẫn là cơ chế data-access).
- **Superuser/BYPASSRLS ở runtime**: phá ADR-0001/0003 (app role không bao giờ bypass RLS).
- **Nới escape-hatch cho mọi bảng**: phá BẤT BIẾN #1 trên diện rộng — bị loại.

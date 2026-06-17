# ADR-0019 — Mô hình truy cập chéo-tenant cho Admin Control Plane (`apps/admin`)

- **Trạng thái:** 📝 Proposed (định hướng cho sáng kiến Admin Control Plane — `docs/prompts/ADMIN-CONTROL-PLANE-PRD-2026-06-17-v2.md`)
- **Bất khả nghịch:** ⚠️ Cao (chạm RLS/auth — BẤT BIẾN #1 & #3)
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0003](0003-pgbouncer-transaction-mode.md), [0004](0004-envelope-encryption-kms.md), [0010](0010-permission-engine-4-tier.md), **[0017](0017-platform-admin-tenancy.md)** (mở rộng); G16-3

## Bối cảnh

Admin Control Plane (`apps/admin`) cần truy cập **chéo tenant** cho **nhiều tài nguyên**, không chỉ `companies`: feature-flag/usage-limit, RBAC, audit log, branding, module on/off, và DB ops (đọc bảng tuỳ ý mọi tenant).

[ADR-0017](0017-platform-admin-tenancy.md) đã giải bài toán cho **đúng 1 bảng `companies`** bằng GUC escape-hatch `app.platform_admin` (default-deny, nới policy `companies`) + helper `withPlatformContext`. Nhưng 0017 **cấm mở rộng nhánh đó sang bảng khác** (§Hệ quả). Mọi bảng nghiệp vụ còn lại vẫn FORCE-RLS keyed `app.current_company_id`, **không có hatch**.

Hiện trạng được xác minh trên code (chống ngộ nhận "tái dùng = FE-only"):
- `subscription.controller.ts` là **self-service**: mọi route lấy `req.user.companyId` từ JWT. KHÔNG có route operator chéo-tenant cho flag/limit. Nhưng `SubscriptionService.setFeatureFlag/setUsageLimit/getEffectiveEntitlements` đã nhận `companyId` arg + `withTenant(companyId)`.
- `permission-admin.service.ts` (RBAC) hardcode `withTenant(actor.companyId)` ở mọi mutation — không tham số target.
- `AuditService.record` ghi trong tenant context hiện hành (`audit_logs` FORCE-RLS, append-only); **không có read-API**.
- **Không tồn tại** primitive impersonation/assume-tenant nào trong codebase. `withPlatformContext` chỉ nới `companies`.

Câu hỏi cần chốt: operator đọc/ghi **xuyên tenant** cho các tài nguyên trên **bằng cơ chế gì**, mà KHÔNG (a) bùng nổ escape-hatch khắp bảng, (b) dùng BYPASSRLS ở app role (ADR-0001/0003 cấm), (c) đẻ ra impersonation phức tạp/khó audit.

## Quyết định

Áp **mô hình 3 tầng**, ưu tiên tầng nhẹ nhất đủ dùng. **KHÔNG** lấy session-impersonation làm mặc định.

### Tầng 1 — `withTenant(targetCompanyId)` per-call *(mặc định cho thao tác trên 1 tenant đã biết id)*

```
Operator route: /operator/... hoặc /tenant/:companyId/...   (nhận target trong path/body)
  → PermissionGuard + @RequirePermission(action, 'platform-*', { isSensitive:true })   // authorize
  → Service(targetCompanyId) → this.db.withTenant(targetCompanyId, tx => …)             // data-access
```

- **Không session swap.** Operator giữ JWT của mình cho AUTH; `companyId` đích đến từ path/body của request. "Scope 1 công ty cho support" = mỗi request mang target id, KHÔNG phải "đăng nhập thành tenant".
- Tiền lệ đã chạy: `PlatformCompanyService.setSubscription(actor, targetCompanyId, dto)` → delegate `SubscriptionService.setSubscription(actor, targetCompanyId, dto)` → `withTenant(target)`. RLS policy `company_id = current` khớp khi `current = target` ⇒ thấy/ghi đúng tenant đích, KHÔNG cần hatch.
- **Phủ:** AC-2 (flags/limits), AC-3 nhánh-operator (RBAC tenant khác), AC-4/AC-7 (cấu hình hộ tenant), audit viewer **per-tenant** (AC-8 giai đoạn đầu).
- Routing: bỏ chữ **"impersonate"**; đổi `/tenant/*` → **`/tenant/:companyId/*`** (operator chọn 1 tenant thao tác qua `withTenant(target)`).

### Tầng 2 — GUC read-only hẹp theo từng bảng *(chỉ khi cần LIST/aggregate xuyên MỌI tenant)*

`withTenant(target)` chỉ phục vụ thao tác trên **1 tenant đã biết id**. Khi cần đọc **xuyên mọi tenant** mà không liệt kê được id rẻ (audit viewer toàn cục, queue monitor):

- **Ưu tiên:** vòng `withTenant(target)` per-tenant khi tập tenant nhỏ/đã lọc (không cần hatch mới).
- **Nếu thực sự cần quét-tất-cả:** thêm **GUC read-only riêng cho ĐÚNG bảng đó** (vd `app.platform_audit_read`), nới **chỉ policy SELECT** của bảng đó theo đúng khuôn default-deny của 0017:
  `USING ( company_id = app.current_company_id OR current_setting('app.platform_audit_read', true) = 'on' )` — KHÔNG đụng `WITH CHECK` (read-only).
- Set qua helper `DatabaseService.withPlatformReadContext(scope, fn)` đối xứng `withPlatformContext`, **chỉ SELECT**, ghi audit thao tác đọc.
- **Phủ:** AC-8 cross-tenant audit/queue (nếu chọn quét-tất-cả).

### Tầng 3 — Role DB read-only chuyên dụng *(AC-9 data browser — blast-radius cao nhất, ADR riêng)*

Data browser đọc **bảng tuỳ ý mọi tenant** vượt tầm GUC-per-bảng. Dùng **role Postgres read-only riêng** (KHÔNG `BYPASSRLS` lung tung — xem `db/worker-role.ts::assertWorkerRoleSafe`), tiếp cận qua service có gate, với:
- allowlist **bảng + cột**, **loại trừ** secret/PII (`platform_accounts.secret_ciphertext`, `payslips`, `*_totp`, salary…);
- audit **từng row đọc** (actor + tenant + bảng + filter); SoD approval kiểu break-glass; rate/row cap.
- Chi tiết allowlist/SoD/role-provisioning để **ADR riêng** (đề xuất ADR-0020) — ADR này chỉ chốt *nguyên tắc* tầng 3.

### Biên auth operator (điều kiện an toàn cho cả 3 tầng)

1. **Token audience riêng:** token operator `aud=operator`; mở rộng `verifyAccessToken` (token-confusion check sẵn có) để route operator **từ chối** tenant-token và ngược lại. `apps/admin` chỉ nhận `aud=operator`.
2. **2FA bắt buộc** cho role `platform-admin`: flip `requires_two_factor=true` (0230 seed `false` chỉ để không phá harness) + verify `two-factor-enforcement.guard` phủ route operator.
3. **Authorize trong scope đích:** đánh giá quyền có tham chiếu tenant đích (hoặc permission catalog platform-tier tenant-agnostic + audit rõ), tránh "check ở home-tenant, write ở target-tenant".
4. **Step-up / re-auth** cho mọi cross-tenant write + mọi AC-9 read; session operator TTL ngắn.
5. **Operator-action audit:** mỗi cross-tenant write để lại bản ghi append-only `operator_id + target_tenant_id + action` **trong cùng tx** (rollback-safe, mirror break-glass).

### (Optional) Impersonation thật — AC-10, chỉ khi nghiệp vụ cần

Nếu cần "operator thấy đúng UI như tenant-admin", mint token TTL ngắn `aud=tenant` + claim `acting_as_operator` + audit bắt buộc + banner UI. **Lane crown riêng**, KHÔNG phải mặc định.

## Lý do

- **Blast radius tối thiểu, tăng dần có chủ đích:** Tầng 1 không nới RLS gì cả (chỉ đổi nguồn `companyId`); Tầng 2 nới đúng 1 bảng/1 chiều đọc; Tầng 3 cô lập trong role riêng + allowlist + audit. Không có blanket-hatch.
- **Ở trong app role** (trừ Tầng 3 dùng role read-only riêng có kiểm soát): tuân ADR-0001/0003.
- **Tái dùng permission engine + service sẵn có** (`SubscriptionService` đã nhận `companyId`): ít code mới, không boundary-auth thứ 2 nặng nề.
- **Không impersonation mặc định:** tránh độ phức tạp token-swap + lỗ hổng audit khó truy "operator nào làm gì".
- **Nhất quán 0017:** dùng lại đúng khuôn default-deny GUC + helper context; reviewer FULL-gate đã quen canh `withPlatformContext`/`withPlatformReadContext`.

## Hệ quả

- **"Tái dùng = FE-only" bị bác cho AC-2/AC-3(operator)/AC-8:** mỗi cái cần controller/service operator mới (dù mỏng) + gate FULL — KHÔNG phải LIGHT/Sonnet. PRD v2 §4 đã re-label.
- **Mỗi nhu cầu cross-tenant-read là quyết định per-bảng tường minh** (Tầng 2), không có hatch chung. Thêm GUC mới = migration + FULL gate + cập nhật reviewer-canh-helper.
- **Nghĩa vụ operator-action audit** thành DoD per-lane (PRD v2 §8.3).
- **Tầng 3 (AC-9) là primitive rủi ro nhất hệ thống** → ADR riêng + land cuối + break-glass SoD.
- **Auth boundary** (aud riêng + 2FA + step-up) là **prerequisite AC-0b**, không phải "đã xong từ G16-3".
- Cấm (giữ từ 0017): mở rộng `app.platform_admin` sang bảng nghiệp vụ; BYPASSRLS ở app role.

## Phương án đã loại

- **Session-impersonation làm mặc định:** token-swap phức tạp + khó audit "operator×tenant"; chỉ giữ như AC-10 optional cho use-case xem-UI-như-tenant.
- **Nới `app.platform_admin` cho mọi bảng / blanket read-hatch:** phá BẤT BIẾN #1 diện rộng (0017 đã cấm).
- **BYPASSRLS / superuser ở runtime app:** phá ADR-0001/0003.
- **Boundary auth platform riêng hoàn chỉnh (DB role + IdP riêng) ngay bây giờ:** đúng lâu dài nhưng quá tốn cho giai đoạn này; mô hình 3 tầng + `aud=operator` đã đủ và có thể nâng cấp sau mà không phá thiết kế.

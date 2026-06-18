# MICRO-PLAN — CS-9 Bảo mật nâng cao (per-company security policy)

> Lane 🔴 crown-jewel (đụng AUTH). Micro-plan Opus theo CLAUDE §6. Bám mã auth THẬT (không đoán).
> Master: [CONSOLE-SYSTEM-UPGRADE.md](./CONSOLE-SYSTEM-UPGRADE.md) §6 CS-9. Phải qua `plan-reviewer` lần nữa + santa khi land.

## Meta

- **Mã:** CS-9 · **Vùng:** 🔴 đỏ (auth/enforcement) · **Model:** Opus · **Ước lượng:** L
- **Gate:** FULL — security + database + silent-failure + **santa-method** · **Migration band:** `0390s`
- **Nhánh/worktree:** `feat/cs9-security-policy` / `mediaos-cs9` (cp `.secrets/local-kek.bin` trước verify)

## 1. Mục tiêu

Mỗi công ty (tenant) tự đặt **chính sách bảo mật** và hệ thống **enforce thật** ở tầng auth:
tự động đăng xuất (idle), giới hạn truy cập theo IP, theo khung giờ, giới hạn tên miền email tài khoản,
danh sách user miễn giới hạn, và (tùy chọn) ép 2FA cho công ty — **không bao giờ hạ dưới sàn global**.

## 2. Mặt bằng mã THẬT (đã xác minh)

| Điểm | Vị trí | Ghi chú cho CS-9 |
| --- | --- | --- |
| Guard chain | `app.module.ts:114-123` | Jwt→Company→**TwoFactor**→FeatureFlag→Usage. Sửa `TwoFactorEnforcementGuard` cho 2FA-override. |
| 2FA guard | `auth/two-factor-enforcement.guard.ts` | đọc env 1 lần lúc init (L23); `getType()!=='http'→true` (L46, WS bỏ qua); `viaApiKey→true` (L55); quyết định bằng DB. |
| Login | `auth.controller.ts:65` → `auth.service.login(dto, meta)` | `meta={ip:req.ip,userAgent}` (L233). **Chèn IP/time check ở `auth.service.login` SAU verify mật khẩu, TRƯỚC cấp token.** |
| Refresh | `auth.controller.ts:87` → `auth.service.refresh(cookieToken)` | **KHÔNG có meta/IP** → phải đổi chữ ký `refresh(token, meta?)` + controller truyền `this.meta(req)`. |
| Settings CRUD mẫu | `settings/settings.{controller,service,repository,dto,module}.ts` | mirror cho `/settings/security-policy` (guard `configure-company`-style, `withTenant`, Zod, audit). |
| Migration RLS mẫu | `migrations/0320_ac6_webhooks.sql`, `0310_ac5_api_keys.sql` | copy khối CREATE TABLE + ENABLE/FORCE RLS + POLICY `company_id = current_setting('app.current_company_id')::uuid`. |
| Env-flag mẫu | `config/env.schema.ts` (`TWO_FACTOR_ENFORCEMENT_ENABLED`) | thêm `SECURITY_POLICY_ENFORCEMENT_ENABLED` (default `"true"`, so sánh `=== "true"`). |
| Tạo tài khoản | (xác minh ở bước 0) employees create / invite accept | chèn email-domain check. |

> **CHƯA CÓ** (xác nhận): `last_login_at` (đó là việc CS-7), session-idle timeout server-side. "Tự động đăng xuất" của CS-9 = **idle timeout client-driven** (web-core đọc `autoLogoutMinutes`) + access-token TTL ngắn làm backstop. KHÔNG xây session-store server mới.

## 3. Mô hình dữ liệu — `company_security_policies` (1 hàng / company)

```
id uuid pk · company_id uuid not null (RLS)
auto_logout_minutes int null                       -- null = tắt
ip_restriction_enabled bool not null default false
allowlist_cidrs jsonb not null default '[]'        -- string[] CIDR
time_restriction_enabled bool not null default false
time_windows jsonb not null default '[]'           -- [{day:0-6, start:'HH:MM', end:'HH:MM'}]
apply_scope text not null default 'all'            -- 'all' | 'selected'  (+ apply_app_keys jsonb)
exempt_user_ids jsonb not null default '[]'        -- uuid[] miễn giới hạn
email_domain_restriction_enabled bool not null default false
allowed_email_domains jsonb not null default '[]'  -- string[]
two_factor_enforced bool null                      -- null=theo global; true=ép thêm (KHÔNG hạ global)
created_at/updated_at timestamptz
UNIQUE(company_id)  -- 1 policy/công ty
+ ENABLE + FORCE ROW LEVEL SECURITY + POLICY company_id = current_setting('app.current_company_id')::uuid
```

Audit `object_types` CHECK **UNION** thêm `'security_policy'`.

## 4. QUY TẮC ENFORCEMENT (bất biến — RED-first, KHÔNG được sai)

1. **2FA fail-STRICTER:** `effective2FA = globalEnv || (policy.two_factor_enforced ?? false)`.
   Tenant chỉ **tăng** chuẩn; global `true` ⇒ tenant KHÔNG tắt được. (Sửa trong `TwoFactorEnforcementGuard`: nếu `this.enabled` global false, đọc policy DB để có thể bật riêng công ty.)
2. **Phạm vi check IP/giờ = "tại lúc CẤP TOKEN"** (login + refresh). KHÔNG check mỗi request/WS message. Bù: access-token TTL ngắn.
3. **fail-OPEN vs fail-CLOSED khi rỗng:**
   - `ip_restriction_enabled=true` + `allowlist_cidrs=[]` ⇒ coi như **TẮT** (fail-OPEN — chưa cấu hình, không tự khóa).
   - `time_restriction_enabled=true` + `time_windows=[]` ⇒ **fail-CLOSED** (không cửa sổ hợp lệ = chặn).
4. **Exempt + người-đang-cấu-hình KHÔNG bị khóa:** user trong `exempt_user_ids` bỏ qua IP/time. Người đang gọi `PATCH /settings/security-policy` không bao giờ tự khóa được (test bắt buộc).
5. **Thoát cứng:** `SECURITY_POLICY_ENFORCEMENT_ENABLED=false` ⇒ TẤT CẢ enforcement IP/time/email-domain bỏ qua (KHÔNG đọc DB). Chống tự-khóa khi policy lỗi/parse sai.
6. **email-domain** check ở (a) tạo tài khoản, (b) **accept invite** (CS-10), không chỉ lúc mời.

## 5. Phân rã micro-step

| # | Bước | Vùng | Test (RED trước) | DoD bước |
| --- | --- | --- | --- | --- |
| 0 | Xác minh điểm tạo tài khoản (employees create + invite) + chữ ký `AuditService.record` + cách `auth.service.refresh` lấy/không-lấy req | 🟢 | — | biết chính xác chỗ chèn email-domain + meta-threading |
| 1 | Contract `security-policy.ts` (Zod: policy DTO + `updateSecurityPolicySchema` CIDR/HH:MM/domain validate) + export `index.ts` | 🟢 | unit Zod: CIDR sai, HH:MM sai, domain sai → reject | contract build (dual ESM/CJS) |
| 2 | Migration `0390_cs9_security_policies.sql` (table + RLS + FORCE + UNIQUE) + schema drizzle | 🔴 | chain `0000→latest` apply sạch trên `mediaos_cs9` | bảng + RLS tồn tại, isolation 2-tenant |
| 3 | Repo + Service + Controller `GET/PATCH /settings/security-policy` (mirror settings; guard `configure-security-policy:company` sensitive+reauth; `withTenant`; audit `security_policy`) | 🔴 | deny khi thiếu quyền; PATCH validate; audit before/after | CRUD chạy, 1 hàng/công ty (upsert) |
| 4 | Env-flag `SECURITY_POLICY_ENFORCEMENT_ENABLED` + `SecurityPolicyService.evaluate(ctx)` thuần (IP-in-CIDR, time-in-window, exempt) — **logic thuần, test kỹ** | 🔴 | bảng chân lý: IP in/out, giờ in/out, exempt, rỗng-open/closed | hàm thuần phủ ≥95% |
| 5 | Chèn enforce vào `auth.service.login(dto, meta)` SAU verify mật khẩu | 🔴 | login sai IP/ngoài giờ→403 `code:ACCESS_RESTRICTED`; exempt qua; flag off bỏ qua | login enforce thật |
| 6 | Thread meta vào refresh: `refresh(token, meta?)` + controller `this.meta(req)` + enforce | 🔴 | refresh sai IP→ buộc login lại; cookie xóa | refresh enforce thật |
| 7 | Sửa `TwoFactorEnforcementGuard`: đọc policy `two_factor_enforced` theo công thức fail-STRICTER (cache ngắn để không +1 query mỗi request) | 🔴 | global off + company on → ép; global on + company null → vẫn ép; company KHÔNG hạ được global | 2FA override đúng, không hạ chuẩn |
| 8 | email-domain check ở tạo tài khoản (+ hook cho CS-10 accept) | 🔴 | tạo account domain ngoài allowlist→reject; rỗng/tắt→cho qua | domain enforce |
| 9 | FE console: trang "Bảo mật nâng cao" (toggles + danh sách CIDR/giờ/domain + whitelist user), mirror layout MISA | 🟡 | render; toggle; validate; loading/error/empty | UI khớp BE, PermissionGate |
| 10 | "Tự động đăng xuất": web-core đọc `auto_logout_minutes` → idle timer logout; backstop TTL | 🟡 | idle → logoutSession gọi | auto-logout client |

> Bước 4 (logic thuần) tách riêng để test cô lập trước khi cắm vào auth (bước 5-7) — giảm rủi ro hồi quy luồng login.

## 6. Rủi ro & giảm thiểu

| Rủi ro | Tác động | Giảm thiểu |
| --- | --- | --- |
| Tự khóa toàn bộ admin ra ngoài | 🔴 | exempt-list + "người đang cấu hình miễn nhiễm" + env thoát cứng (bước 5/test bắt buộc) |
| Hạ chuẩn 2FA từ tenant | 🔴 | công thức `global \|\| (policy ?? false)` (bước 7), test 4 tổ hợp |
| Bỏ sót đường refresh (chỉ chặn login) | 🔴 | bước 6 thread meta vào refresh; ghi rõ WS = TTL ngắn (chấp nhận) |
| `X-Forwarded-For` giả mạo IP | 🟡 | dùng `req.ip` (Express trust proxy phải cấu hình đúng ở reverse proxy); ghi chú ops |
| Regex/parse CIDR/time sai → fail mở | 🔴 | Zod validate chặt ở contract (bước 1) + fail-CLOSED cho time rỗng |
| `+1 query/request` ở guard 2FA | 🟡 | cache policy theo company TTL ngắn (mirror cache permission engine) |
| Rò chéo tenant bảng mới | 🔴 | RLS+FORCE TRƯỚC backfill; test 2-tenant |

## 7. Test plan (deny-path RED bắt buộc)

- Logic thuần (bước 4): IP in/out CIDR, giờ in/out window đa-ngày, exempt, rỗng-OPEN(ip)/rỗng-CLOSED(time).
- Login/refresh: chặn sai IP/giờ → 403 `ACCESS_RESTRICTED`; exempt qua; **admin-đang-sửa không tự khóa**; flag off bỏ qua hoàn toàn.
- 2FA: 4 tổ hợp (global×company) — không tổ hợp nào hạ dưới sàn global.
- email-domain: reject/allow; rỗng=tắt.
- Regression: suite auth/SSO (login/refresh/2fa/logout), isolation 2-tenant.
- Coverage ≥90% (auth-touch). Santa-method CONVERGED trước land.

## 8. Rollback

- Env `SECURITY_POLICY_ENFORCEMENT_ENABLED=false` → tắt enforce tức thì (không cần revert).
- Revert nhánh `feat/cs9-security-policy`; drop table `company_security_policies` (migration reversible).
- 2FA guard: nhánh policy-read có guard `if(!policyEnforcementEnabled)` → tháo an toàn.

---

## ✅ plan-reviewer (vòng 2 — chạy NGAY trước code)

_(xác nhận bước 0 đúng điểm tạo tài khoản + chữ ký refresh thật; verdict PASS/REVISE.)_

## 🏁 completion-evaluator

_(điền khi đóng CS-9.)_

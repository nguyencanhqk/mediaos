# SSO Integration Design

> **Trạng thái:** Designed — not built  
> **Ưu tiên:** P7 — SaaS prep (G16-3 context)  
> **Auth type:** SAML 2.0 (enterprise) + OIDC / OAuth 2.0 (Google / Microsoft / GitHub for SMB)

---

## 1. Mục tiêu / Objective

SSO (Single Sign-On) cho phép nhân viên MediaOS đăng nhập bằng account doanh nghiệp hiện có, không cần tạo/nhớ mật khẩu riêng. Connector SSO sẽ:

- **OIDC / Social login** (Google Workspace, Microsoft 365, GitHub) — phù hợp với công ty vừa (SMB, <500 nhân sự): nhanh setup, không cần SAML.
- **SAML 2.0** — cho enterprise customer khi MediaOS mở rộng SaaS: Okta, Azure AD, Google Workspace SAML.
- **Provisioning (SCIM)** — tự động tạo/deactivate user account từ IdP khi thêm/xóa nhân viên *(future, không build ngay)*.
- Giữ `passwordHash` trong `users` cho fallback login khi SSO provider down.
- Tích hợp với hệ thống 2FA hiện tại (G16-1a TOTP): SSO login cũng cần pass 2FA nếu `roles.requires_two_factor=true`.

---

## 2. OAuth / Auth & Scopes

### 2a. OIDC / Social login (SMB — ưu tiên build trước)

#### Google Workspace OIDC

```
User → GET /auth/sso/google (state={companyId,nonce})
  → Google OAuth2 Authorization Code (PKCE)
  → Consent: openid, email, profile (+ optional hd={workspace_domain})
  → ID token (JWT) chứa: sub, email, name, hd (hosted domain)
  → Verify JWT signature (Google's public keys via JWKS)
  → Map email → users.email (per tenant) → issue MediaOS access token
```

Restrict bằng `hd` parameter (hosted domain): chỉ cho phép `@company.com` accounts.

#### Microsoft 365 OIDC

```
GET /auth/sso/microsoft (endpoint: login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize)
  → Scopes: openid, email, profile, offline_access
  → ID token: sub (oid), email (preferred_username), name
  → Verify bằng Microsoft JWKS endpoint
```

#### Scopes tối thiểu OIDC

| Scope | Mục đích |
|-------|----------|
| `openid` | ID token |
| `email` | Email để map vào `users.email` |
| `profile` | Display name |

### 2b. SAML 2.0 (Enterprise)

```
User → GET /auth/sso/saml/{tenantSlug}
  → SP-initiated SAML AuthnRequest → IdP (Okta / Azure AD / Google SAML)
  → IdP authenticates → POST SAML Response to /auth/sso/saml/{tenantSlug}/callback
  → Verify XML signature (X.509 cert của IdP)
  → Extract NameID (email) + attributes → map → MediaOS user → issue JWT
```

**IdP metadata** (EntityID, SSO URL, X.509 cert) cần lưu per-tenant.

### Token lifecycle

| Token | Sống ở đâu |
|-------|-----------|
| OIDC `id_token` | Ephemeral — chỉ dùng lúc login, KHÔNG lưu DB |
| MediaOS `access_token` (JWT) | Memory / Valkey (nếu cần revoke), TTL 1h |
| MediaOS `refresh_token` | `refresh_tokens` table (hash-at-rest, G2 ✅) |
| SAML Assertion | Ephemeral — xử lý rồi discard, KHÔNG lưu |
| IdP metadata (X.509 cert) | `platform_accounts.secret_ciphertext` hoặc config table **(design only)** |

---

## 3. Rate-limit / Quota

SSO là inbound auth (IdP gọi vào MediaOS) — MediaOS không rate-limit phía IdP. Rate-limit ở phía MediaOS:

| Endpoint | Limit |
|----------|-------|
| `POST /auth/sso/saml/{slug}/callback` | 20 req/10s per IP (anti-brute SAML replay) |
| `GET /auth/sso/google` (OAuth initiate) | 30 req/phút per IP |
| OIDC callback | 20 req/phút per IP |

Dùng Valkey-backed rate limiter (đã có từ G16-1a auth hardening).

---

## 4. Webhook vs Polling

SSO là **push-only** (IdP → SP). Không có polling.

- **SAML callback:** IdP POST SAML Response → `/auth/sso/saml/{tenantSlug}/callback`.
- **OIDC callback:** IdP redirect → `/auth/sso/oidc/{provider}/callback?code=&state=`.
- **SCIM provisioning** (future): IdP gọi MediaOS SCIM API để create/update/deactivate users.

**Dedup / Replay protection:**

- SAML: check `InResponseTo` (CSRF token), `NotBefore` / `NotOnOrAfter` (time-bound), InResponseTo binding.
- OIDC: validate `nonce` trong ID token (state parameter phải match).
- Lưu `sub` (OIDC) hoặc `NameID` (SAML) vào `users` để link account **(new column — design only)**.

---

## 5. Mapping vào model MediaOS

### `platforms`

Cần thêm khi build:
- `platforms.code='sso_google'`, `'sso_microsoft'`, `'sso_saml'` **(new seeds — design only)**.
- Cập nhật CHECK constraint **(migration mới — design only)**.

### `platform_accounts` — SSO config per-tenant

| SSO config field | MediaOS column |
|-----------------|----------------|
| Provider slug (`google`, `microsoft`, `okta`) | `platform_accounts.account_identifier` |
| Client ID (OIDC) | `platform_accounts.account_name` |
| Client secret (OIDC) hoặc SAML cert | `platform_accounts.secret_ciphertext` (envelope-encrypted) |
| Tenant domain (`@company.com`) | `platform_accounts.account_email` (domain, not actual email) |
| SAML IdP metadata XML URL | `platform_accounts.account_identifier` (JSON: `{"metadata_url":"..."}`) |
| — | `platform_accounts.platform_id → platforms.id` (sso_*) |
| — | `platform_accounts.company_id` (per-tenant SSO config) |

### `users` — SSO identity link

> **New columns needed (design only):**

```
users.sso_provider text         -- 'google','microsoft','okta','saml'
users.sso_subject text          -- IdP's sub (OIDC) hoặc NameID (SAML)
users.sso_enabled_at timestamp  -- khi lần đầu login qua SSO
```

Unique constraint: `(company_id, sso_provider, sso_subject)` để tránh account clash.

### `companies` — SSO feature flag

> **New columns needed (design only):**

```
companies.sso_required boolean DEFAULT false  -- bắt buộc SSO, chặn password login
companies.sso_provider text                   -- 'google','microsoft','saml'
```

### Fallback

Nếu `companies.sso_required=false`: user có thể login bằng password (giữ `users.passwordHash`).  
Nếu `companies.sso_required=true`: chỉ SSO; `/auth/login` password route trả `403 SSO required`.

---

## 6. Rủi ro bảo mật / Security risks

### Credential / metadata storage

OIDC client secret và SAML private key lưu qua `SecretEncryptionService`:

```
encryptSecret(clientSecretOrSamlKey, { companyId, recordId: platformAccountId, purpose: 'platform_account' })
```

### SSO-specific risks

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| SAML XML signature bypass | CRITICAL | Dùng library đã kiểm chứng (`passport-saml` hoặc `samlify`); không tự parse XML |
| SAML replay attack | CRITICAL | Validate `NotBefore/NotOnOrAfter`; check `InResponseTo`; store seen assertion IDs (Valkey TTL) |
| OIDC state param CSRF | HIGH | Validate `state` param (PKCE + nonce); reject nếu không khớp |
| OIDC `nonce` replay | HIGH | Nonce lưu session/Valkey, single-use |
| Account takeover qua email match | HIGH | SSO email map chỉ dùng với verified domain (`hd` parameter); không tự-provision user mới qua SSO (chỉ link account đã tồn tại) |
| `sso_subject` collision cross-tenant | CRITICAL | Unique `(company_id, sso_provider, sso_subject)` — không share subject giữa tenant |
| IdP cert expired → lockout | MEDIUM | Monitor cert expiry; alert admin 30 ngày trước; fallback password login |
| Client secret rò | CRITICAL | Envelope-encrypt + rotate định kỳ |
| SCIM webhook giả mạo (future) | HIGH | SCIM token auth (Bearer token envelope-encrypted) |
| Bypass 2FA qua SSO | MEDIUM | SSO login PHẢI pass 2FA check nếu `roles.requires_two_factor=true` (cùng luồng với `TwoFactorService`) |
| Tenant isolation | CRITICAL | SSO config (`platform_accounts`) per `company_id` + RLS FORCE |

---

## 7. Thứ tự ưu tiên build / Build priority

**P7 — trong context G16-3 SaaS prep.**

Lý do:
- SSO là yêu cầu của enterprise customer khi MediaOS mở rộng SaaS — không cần thiết cho internal MVP.
- **P7a (Google OIDC login):** Build sớm nhất trong nhóm SSO — đơn giản, không cần SAML parser, cùng Google OAuth infra đã có.
- **P7b (Microsoft OIDC):** Tương tự Google, build ngay sau.
- **P7c (SAML 2.0):** Build sau, khi có enterprise customer cụ thể yêu cầu.
- **P7d (SCIM provisioning):** Defer — phức tạp, chỉ cần khi scale >500 user.

Build order: P7a → P7b → P7c → P7d.

Dependencies: `users` table (G2 ✅), `refresh_tokens` (G2 ✅), `companies` table (G2 ✅), 2FA TOTP (G16-1a ✅), `platform_accounts` (G6-2 ✅).

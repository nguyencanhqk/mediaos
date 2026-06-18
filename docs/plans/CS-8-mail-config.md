# MICRO-PLAN — CS-8 Cấu hình mail server (SMTP, secret)

> Lane 🔴 crown-jewel (SECRET — SMTP password). Micro-plan Opus theo CLAUDE §6. Bám mã THẬT (không đoán).
> Master: [CONSOLE-SYSTEM-UPGRADE.md](./CONSOLE-SYSTEM-UPGRADE.md) §6 CS-8. Qua FULL gate + santa khi land.

## Meta

- **Mã:** CS-8 · **Vùng:** 🔴 đỏ (secret SMTP) · **Model:** Opus · **Ước lượng:** M
- **Gate:** FULL — security + database + silent-failure + **santa-method** · **Migration band:** `0380s`
- **Nhánh/worktree:** `feat/cs8-mail-config` / `mediaos-cs8` (cp `.secrets/local-kek.bin` TRƯỚC verify)

## 1. Mục tiêu

Mỗi công ty (tenant) tự cấu hình **SMTP server riêng** (mặc định + theo app), lưu password **mã hoá phía app**
(envelope encryption reuse `SecretEncryptionService`), có nút **kiểm tra kết nối** trả kết quả **đã sanitize**
(không echo credential). Password KHÔNG plaintext, KHÔNG vào DTO, KHÔNG log.

## 2. Mặt bằng mã THẬT (đã xác minh)

| Điểm | Vị trí | Ghi chú cho CS-8 |
| --- | --- | --- |
| KeyPurpose union | `crypto/secret-encryption.types.ts:13` | `'platform_account' \| 'auth_reset_token' \| 'totp_secret' \| 'webhook_secret'` → **THÊM `'smtp_password'`** (bước 1). |
| SecretEncryptionService | `crypto/secret-encryption.service.ts:41-80` | `encryptSecret(plaintext, ctx): Promise<EncryptedColumns>` + `decryptSecret(row, ctx): Promise<string>`. ctx = `{companyId, recordId, purpose}`. |
| Consumer mẫu (envelope) | `media/platform-accounts.service.ts:214-249` | recordId = `crypto.randomUUID()` **TRƯỚC INSERT** (AAD bind id); 7 cột envelope: `secretCiphertext, encryptedDek, dekKeyVersion, kmsKeyId, ivNonce, authTag, encAlgo`. Decrypt try/catch → `decrypt_failed`. |
| EncryptedColumns | `crypto/secret-encryption.types.ts:38-46` | 7 cột Buffer/number/string — đúng tên cột mirror sang bảng mới. |
| Settings CRUD mẫu | `settings/settings.{controller,service,repository,module,dto}.ts` | mirror cho `/settings/mail-config`: `withTenant`, Zod DTO, audit before/after, guard `@RequirePermission`. |
| Migration RLS mẫu | `migrations/0320_ac6_webhooks.sql` (webhook + envelope secret), `0006_org.sql` (CREATE TABLE + ENABLE/FORCE RLS + POLICY + GRANT). | copy khối: `current_setting('app.current_company_id', true)` NULLIF, `mediaos_app`/`mediaos_worker` grants. |
| **⭐ TEMPLATE TOÀN BỘ** | `migrations/0320_ac6_webhooks.sql` (VERBATIM) | Mirror 1-1: table 7 cột envelope + RLS/FORCE/POLICY/index + column-GRANT (SELECT/INSERT + UPDATE chỉ cột non-secret) + DO-block extend `encryption_keys.purpose` CHECK + **seed encryption_keys row** + DO-block UNION audit CHECK + permission seed+grant. COPY khối này, đổi tên. |
| **🔴 encryption_keys** | `migrations/0028`/`0120`/`0320` (seed purpose) + `local-kek.provider.ts:84-101` (`currentKey` THROW nếu thiếu) | **BẮT BUỘC**: (a) extend CHECK `encryption_keys.purpose` (DO-block 0320:144-192) thêm `'smtp_password'`; (b) `INSERT INTO encryption_keys (key_version, kms_key_id, purpose, status) VALUES (1,'local-dev-kek','smtp_password','active') ON CONFLICT DO NOTHING`. KHÔNG seed = `encryptSecret` THROW lúc lưu. KHÔNG cần key material mới (LocalKekProvider dùng 1 file KEK cho mọi purpose). |
| Audit CHECK | DO-block UNION ADD-only (0320:205-252, parse cả IN & ANY form) + `db/schema/audit.ts:35-141` const | **THÊM `'mail_config'`** vào const TS + DO-block UNION (ADD-only, KHÔNG full-superset → tránh reconcile cross-lane). |
| Permission seed | `0320:260-270` (INSERT ... ON CONFLICT DO NOTHING + grant role `00000000-...-0001`) | seed `configure-mail:company` sensitive=true, gán system-admin. |
| Module register | `app.module.ts:53-103` imports[] | thêm `MailConfigModule`. |
| Schema export | `db/schema/index.ts` | `export * from "./mail-config";` |
| Contracts export | `packages/contracts/src/index.ts` | `export * from "./mail-config";` |
| Nodemailer | **CHƯA CÓ** (grep nodemailer/createTransport/sendMail = trống) | CS-8 là tích hợp mail ĐẦU TIÊN. `test` connection = `transporter.verify()` (KHÔNG gửi mail thật). Thêm dep `nodemailer` + `@types/nodemailer` vào `apps/api` (pnpm --filter @mediaos/api add). |

## 3. Mô hình dữ liệu — `company_mail_configs`

```
id uuid pk (app-gen TRƯỚC insert nếu cần AAD — dùng cùng id làm recordId)
company_id uuid not null (RLS + FORCE)
scope text not null default 'default'        -- 'default' | 'app:<KEY>' (vd 'app:studio')
host text not null
port int not null
username text not null
secure boolean not null default true          -- TLS
from_name text
from_email text not null
-- envelope (7 cột — KHÔNG plaintext):
secret_ciphertext bytea not null
encrypted_dek bytea not null
dek_key_version int not null
kms_key_id text not null
iv_nonce bytea not null
auth_tag bytea not null
enc_algo text not null
created_at/updated_at timestamptz
UNIQUE(company_id, scope)   -- 1 config / scope / công ty
+ ENABLE + FORCE ROW LEVEL SECURITY + POLICY company_id = current_setting('app.current_company_id')::uuid
```

Audit `object_types` CHECK **UNION** thêm `'mail_config'`. `enc_algo` v.v. mirror đúng tên cột envelope.

## 4. QUY TẮC SECRET (bất biến — RED-first, KHÔNG được sai)

1. **Password chỉ vào DB ở dạng envelope.** Plaintext chỉ tồn tại trong RAM lúc `encryptSecret` / lúc `test`.
   KHÔNG cột plaintext, KHÔNG trả về DTO, KHÔNG `console.log`/logger.
2. **GET /settings/mail-config trả DTO KHÔNG có password** (chỉ host/port/user/from/secure/scope + cờ `hasPassword`).
3. **PUT** nhận password optional: nếu có → re-encrypt; nếu vắng → giữ envelope cũ (không xoá secret).
4. **`test` sanitize:** bắt lỗi SMTP, **lọc bỏ** mọi chuỗi chứa username/password trước khi trả `{ok, errorMessage?}`.
   KHÔNG echo credential vào error message hay log. Lỗi auth SMTP → message chung "Xác thực SMTP thất bại".
5. **recordId = id của hàng** (app-gen `crypto.randomUUID()` TRƯỚC INSERT) → AAD bind. purpose `'smtp_password'`.
6. **Guard `configure-mail:company`** sensitive + reauth (mirror cách `platform-accounts`/secret route yêu cầu step-up).

## 5. Phân rã micro-step (RED trước cho mọi bước 🔴)

| # | Bước | Vùng | Test (RED trước) | DoD bước |
| --- | --- | --- | --- | --- |
| 1 | Thêm `'smtp_password'` vào `KeyPurpose` union (`secret-encryption.types.ts:13`) | 🔴 | round-trip purpose `'smtp_password'` (sau bước 3 seed key) | type compile |
| 2 | Contract `mail-config.ts` (Zod: `mailConfigSchema` view-DTO KHÔNG password + `updateMailConfigSchema` host/port/user/from-email/secure + password optional; `mailTestResultSchema {ok, errorMessage?}`) + export `index.ts` | 🟢 | Zod: port range, email, scope pattern; password vắng OK | contract build dual ESM/CJS |
| 3 | Migration `0380_cs8_company_mail_configs.sql` — **COPY 0320 verbatim, đổi tên**: table 7 cột envelope (+ enc_algo/iv12/tag16 CHECK) + RLS + FORCE + POLICY + index + GRANT(SELECT/INSERT + UPDATE non-secret) + UNIQUE(company_id,scope) + **DO-block extend `encryption_keys.purpose` CHECK +`'smtp_password'`** + **INSERT encryption_keys seed row 'smtp_password' active** + DO-block UNION audit CHECK +`'mail_config'` + seed perm `configure-mail:company` + grant. Schema drizzle `mail-config.ts` + `db/schema/index.ts` export + `AUDIT_OBJECT_TYPES += 'mail_config'` | 🔴 | chain `0000→latest` áp sạch trên `mediaos_cs8`; round-trip encrypt OK (key seeded); isolation 2-tenant | bảng+RLS+key tồn tại |
| 4 | Repo + Service: `getMailConfig(scope)` (DTO no-secret + `hasPassword`), `upsertMailConfig` (encrypt khi có password, withTenant, audit before/after KHÔNG secret) | 🔴 | password không bao giờ ra DTO; audit không chứa secret; upsert idempotent theo (company,scope) | CRUD chạy |
| 5 | `MailTransportService.test(config, plaintextPassword?)` dùng nodemailer `createTransport(...).verify()`; nếu PUT chưa lưu password thì decrypt từ envelope để test | 🔴 | test thành công→`{ok:true}`; lỗi→`{ok:false, errorMessage sanitize}`; **error KHÔNG chứa username/password** | test-connection sanitize |
| 6 | Controller `GET/PUT /settings/mail-config` + `POST /settings/mail-config/test` (guard `configure-mail:company` sensitive; reauth nếu pattern repo có) + DTO + module + đăng ký `app.module` | 🔴 | deny khi thiếu quyền; PUT validate; GET no-secret | endpoint chạy |
| 7 | FE console `routes/settings/mail-config.tsx`: empty-state "Chưa thiết lập" + form host/port/user/pass(masked)/from/TLS + tab "Mặc định"/"Theo ứng dụng" + nút Kiểm tra; nav.ts + router.tsx append; web-core nav label `mailConfig` | 🟡 | render; toggle tab; validate; loading/error/empty; PermissionGate | UI khớp BE |

## 6. Rủi ro & giảm thiểu

| Rủi ro | Tác động | Giảm thiểu |
| --- | --- | --- |
| Password rò (DTO/log/error SMTP) | 🔴 | bước 1-5: envelope-only, no-DTO, sanitize test error, test deny-path RED |
| SMTP error echo credential | 🔴 | lọc username/password khỏi error string trước khi trả/log (bước 5) |
| Rò chéo tenant bảng mới | 🔴 | RLS+FORCE TRƯỚC backfill; test 2-tenant |
| Lẫn KEK bucket với secret kênh | 🟡 | purpose mới `'smtp_password'` (bước 1) — KHÔNG tái dùng `'platform_account'` |
| nodemailer gửi mail thật khi test | 🟡 | `verify()` (handshake) KHÔNG `sendMail`; timeout ngắn |
| recordId mismatch AAD | 🔴 | app-gen id TRƯỚC insert = recordId (mẫu platform-accounts) |

## 7. Test plan (deny-path RED bắt buộc)

- Envelope round-trip purpose `'smtp_password'`; password KHÔNG bao giờ ra DTO/GET; PUT vắng password giữ envelope cũ.
- `test`: ok / fail-sanitized; assert error string KHÔNG chứa username/password.
- Deny khi thiếu `configure-mail:company`; audit `mail_config` ghi (before/after KHÔNG secret).
- Migration chain sạch; isolation 2-tenant (RLS không lộ config công ty khác).
- Coverage ≥90% (secret-touch). Santa-method CONVERGED trước land.

## 8. Rollback

- Revert nhánh `feat/cs8-mail-config`; drop table `company_mail_configs` (migration reversible).
- `'smtp_password'` purpose là additive (giữ lại vô hại nếu chưa dùng).
- FE nav/route tháo được (ẩn nav item) không ảnh hưởng lane khác.

---

## ✅ plan-reviewer (vòng 2 — chạy NGAY trước/trong code)

_(xác nhận purpose mới wiring đúng LocalKekProvider + reauth pattern thật; verdict PASS/REVISE.)_

## 🏁 completion-evaluator

✅ **CLOSED — LANDED master `cc76ef8` (--no-ff) 2026-06-18** (Console Wave 2). Security-review độc lập = **SAFE-TO-LAND** (8 bất biến secret OK, chứng minh trên live DB; migration regression `encryption_keys.purpose` ANY-form đã né đúng). Verify master: api 2605/0, contracts 195, console 136. **DEBT:** `requiresReauth` dropped (isSensitive-only, tiền lệ webhook); SMTP host/port blind-SSRF oracle (gated, DEFER egress-allowlist); per-app scope tab chỉ 1 config. 🔴 GOTCHA cho lane secret sau: DO-block `encryption_keys.purpose` PHẢI parse nhánh ANY-array (0320 đã rewrite sang `= ANY('{...}')`), KHÔNG copy verbatim block IN-form của 0320.

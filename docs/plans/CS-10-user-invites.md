# CS-10 — Đối tượng: Mời / Duyệt / Kích hoạt user (micro-plan crown)

> Wave 3 (SOLO, 1 crown) của [CONSOLE-WAVES.md](./CONSOLE-WAVES.md) §7. Band migration **0410s**.
> Prereq đã land: CS-8 (mail SMTP envelope) + CS-9 (email-domain policy). FULL gate + santa.

## 1. Mục tiêu

Luồng quản trị tài khoản người dùng theo MISA "Hệ thống › Đối tượng":
**mời (admin) → kích hoạt (người được mời đặt mật khẩu) → duyệt (admin) → tài khoản hoạt động.**
Hai hàng đợi quản trị: **"Yêu cầu kích hoạt"** (đã mời, chờ người dùng đặt mật khẩu) và
**"Chờ duyệt"** (đã đặt mật khẩu, chờ admin duyệt).

## 2. Máy trạng thái (1 bảng `user_invites`, cột `status`)

```
                 invite(admin)            accept(invitee+token)        approve(admin)
   (none) ───────────────────▶ [pending] ────────────────────▶ [accepted] ──────────▶ [approved]
            token+email gửi       │  pw hash lưu trên invite       │   tạo users row ACTIVE + audit
            (best-effort)         │                                │
                                  ▼ reject(admin)                  ▼ reject(admin)
                              [rejected]                       [rejected]
   hết hạn: pending & expires_at < now  ⇒  accept bị từ chối (coi như expired, KHÔNG tạo state mới)
```

| status | Tab FE | Ý nghĩa |
| --- | --- | --- |
| `pending` | **Yêu cầu kích hoạt** | Đã mời, email gửi, chờ người dùng accept (đặt mật khẩu). |
| `accepted` | **Chờ duyệt** | Người dùng đã đặt mật khẩu (hash lưu trên invite), chờ admin duyệt. |
| `approved` | — (terminal) | Admin duyệt → `users` row ACTIVE được tạo. |
| `rejected` | — (terminal) | Admin từ chối (huỷ lời mời / từ chối duyệt). |

### Vì sao tạo `users` row ở bước APPROVE (không phải accept)?

`auth.service.findActiveUserByEmail` lọc `deleted_at IS NULL` nhưng **KHÔNG** lọc `status` →
một cờ `status` trên `users` KHÔNG chặn được login. Để cổng-duyệt là THẬT mà **KHÔNG đụng đường
login nhạy cảm** (vùng rủi ro cao nhất — CS-9 đã chạm), ta **chỉ tạo `users` row khi admin duyệt**.
Giữa accept→approve, mật khẩu (argon2 **hash**, không plaintext — BẤT BIẾN #3) nằm trên cột
`password_hash` của `user_invites`; KHÔNG bao giờ vào DTO. Không có `users` row ⇒ không login được.

## 3. Tái dùng (KHÔNG viết mới)

| Cần | Tái dùng |
| --- | --- |
| email-domain check tại accept (CS-9) | `SecurityPolicyService.assertEmailDomainAllowedTx(tx, companyId, email)` (hook CS-9 đã chừa sẵn). |
| gửi email qua SMTP công ty (CS-8) | `MailConfigRepository.findByScope(companyId,'default')` + `SecretEncryptionService.decryptSecret` → nodemailer `sendMail`. |
| hash mật khẩu tại accept | `PasswordService.hash`. |
| tạo `users` row tại approve | mirror `employees.repository.createUserTx`. |
| resolve company từ slug (accept SESSIONLESS) | `resolve_company_by_slug` SECURITY DEFINER (như `auth.service.resolveCompanyId`). |
| audit-in-tx | `AuditService.record(tx, …)` object_type `user_invite`. |
| RLS+FORCE+grants+audit CHECK UNION+perm seed | mẫu mig `0390`/`0380`. |

## 4. Backend (module `user-invites`)

- **`POST /users/invite`** — `@RequirePermission('invite','user',{isSensitive:true})`. Body `{email, fullName}`.
  Pre-check: KHÔNG invite `pending|accepted` trùng email, KHÔNG `users` active trùng email (409). Sinh token
  ngẫu nhiên 32 byte (base64url), lưu `token_hash`=sha256(token), `expires_at`=now+72h, status `pending`,
  audit `invite.created` (cùng tx). Sau commit: gửi email best-effort ngoài tx → trả `emailSent`.
- **`POST /users/activation/accept`** — **SESSIONLESS** (token là auth). Body `{companySlug, token, password}`.
  resolve slug→companyId → `withTenant` → tìm invite theo `token_hash` + status `pending` + chưa hết hạn +
  `accepted_at IS NULL`. **email-domain check (CS-9)** trên `invite.email`. Hash password → lưu lên invite,
  set status `accepted`, `accepted_at=now` (single-use). audit `invite.accepted`. Lỗi → **đồng nhất** (không
  lộ tenant/invite tồn tại).
- **`GET /users/pending`** — `@RequirePermission('approve','user')`. Trả invite `pending`+`accepted` (kèm status)
  để FE chia 2 tab. KHÔNG trả `token_hash`/`password_hash`/cột nhạy cảm.
- **`POST /users/:id/approve`** — `@RequirePermission('approve','user',{isSensitive:true})`. `:id`=invite id.
  Chỉ hợp lệ khi status `accepted`. Tạo `users` row (email/fullName/password_hash từ invite, status active),
  set invite `approved` + `created_user_id`. Unique (company,email) vi phạm → 409. audit `invite.approved`.
- **`POST /users/:id/reject`** — `@RequirePermission('approve','user',{isSensitive:true})`. Hợp lệ khi
  `pending|accepted` → status `rejected`. audit `invite.rejected`.

## 5. Migration 0410 (`user_invites`)

Cột: `id`, `company_id` (DEFAULT GUC + FK + RLS/FORCE/policy/index), `email`, `full_name`,
`token_hash` (text, sha256 hex — **KHÔNG token thật**), `status` (CHECK in pending/accepted/approved/rejected),
`password_hash` (text NULL — argon2, đặt ở accept), `expires_at`, `accepted_at` NULL, `created_user_id` (uuid NULL),
`invited_by` (uuid NOT NULL), `created_at`/`updated_at`. Partial UNIQUE `(company_id, lower(email)) WHERE status='pending'`.
GRANT SELECT/INSERT/UPDATE (KHÔNG DELETE — terminal = status). Audit CHECK +`user_invite` (DO-block UNION 2-form).
Perm seed `invite:user` + `approve:user` (sensitive) + grant role system-admin `…0001`. idx/when set lúc LAND
(> master max idx 110 / when 1717500450000).

## 6. BẤT BIẾN bảo mật (FULL gate sẽ soi)

1. **#1 RLS**: company_id NOT NULL DEFAULT GUC + ENABLE/FORCE + policy USING+WITH CHECK + index. Mọi repo qua
   `withTenant`. Accept sessionless vẫn `withTenant(companyId-từ-slug)` (KHÔNG nhận companyId từ body).
2. **#3 secret**: token thật CHỈ qua email (lưu hash); `password_hash` argon2 (không plaintext); KHÔNG token/hash
   vào bất kỳ DTO/log/audit before-after.
3. **Single-use + expiry**: `accepted_at` chốt 1 lần; `expires_at` 72h; accept fail-closed (sai/hết hạn → lỗi đồng nhất).
4. **email-domain (CS-9)** check tại **accept** (đúng thời điểm biết danh tính người dùng).
5. **Cổng-duyệt THẬT**: users row chỉ sinh ở approve (không có row ⇒ không login).
6. **Silent-failure**: gửi email thất bại → KHÔNG nuốt; trả `emailSent:false` cho admin. Đọc policy lỗi → fail-open
   (theo tiền lệ CS-9, đã có log).

## 7. FE console (trong trang Đối tượng `/system/objects`)

2 tab mới **"Chờ duyệt"** + **"Yêu cầu kích hoạt"** (component riêng `invites-panel.tsx` để giữ file < 800 dòng) +
nút **"Mời"** (gate `invite:user`) + Duyệt/Từ chối (gate `approve:user`). API client `invites-api.ts`. i18n thêm key.
Trang activation cho người được mời (apps/auth) = **DEBT** (email link + accept API là hợp đồng; trang mỏng theo sau).

## 8. Test (≥90% — auth/secret)

Service spec: token hash/lookup, expiry, single-use (accept lần 2 fail), email-domain deny tại accept,
approve tạo users + status active, approve khi chưa accepted → 400, reject, duplicate invite → 409, mail best-effort
(no-config → emailSent:false, không throw). Integration RLS 2-tenant (invite tenant A không thấy ở B). FE panel spec.

## 9. Trạng thái

- [ ] contracts → migration → schema/audit → module → tests → FE → verify isolated DB → FULL gate+santa → land.

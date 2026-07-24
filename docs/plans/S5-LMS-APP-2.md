# S5-LMS-APP-2 — LMS SSO-only (đăng nhập LMS CHỈ qua MediaOS)

> Track **LOCAL** — `apps/lms` (fmc-app) là workspace riêng, **gitignore** trong repo MediaOS
> (`.gitignore:8 /apps/lms/`). Không có PR; "ship" = `next build` + restart service NSSM `MediaOS-LMS`
> (PORT 3400, tunnel `train.funtimemediacorp.com`).
> Trạng thái: **code XONG + đã vá 1 lỗ · cờ CHƯA BẬT ở PROD** (chờ owner test break-glass).

---

## 1. Mục tiêu

Khi `SSO_ONLY=true`:

| Luồng | Hành vi |
| --- | --- |
| `/register`, `/forgot-password` (UI) | redirect `/login` |
| `POST /api/auth/sign-up` · `forgot-password` · `reset-password` · `resend-otp` · `verify-email` | `403 { code: "SSO_ONLY" }` |
| `POST /api/auth/sign-in` | `403` cho user thường · **break-glass**: email ∈ `ADMIN_EMAILS` vẫn login mật khẩu |
| `/login` (UI) | chỉ nút **"Đăng nhập qua MediaOS"** → `{MEDIAOS_APP_URL}/lms`; link nhỏ mở form cho quản trị |
| `GET /api/auth/sso?token=…` | đường vào duy nhất của user thường (JIT tạo user nếu chưa có) |

`SSO_ONLY` unset/rỗng/khác `"true"` ⇒ **hành vi cũ nguyên vẹn** (không dùng `z.coerce` để `'0'`/`'false'`
không vô tình hoá true).

---

## 2. Bất biến & rủi ro đã xử lý

### 2.1 Guard chống tự-khoá-cửa (fail-loud)

`assertSsoOnlyConfig()` (`lib/platform/auth/sso-only.ts`) **THROW** khi bật cờ mà:

1. `ADMIN_EMAILS` rỗng ⇒ `isEnvOwnerEmail` luôn false ⇒ không ai break-glass được; **hoặc**
2. `MEDIAOS_APP_URL` rỗng ⇒ nút "Đăng nhập qua MediaOS" không có đích ⇒ user thường cũng không vào được.

Gọi ở **đầu mọi handler/page** bị SSO-only chi phối, không dựa vào `createEnv` (Zod không biểu diễn được
ràng buộc chéo field). Thà app đỏ ngay còn hơn khoá toàn bộ admin ra ngoài.

### 2.2 Ba điểm tạo phiên — phải đóng ĐỦ ba

Đây là phát hiện chính của vòng rà soát. Grep `SESSION_COOKIE_NAME` cho đúng **3** route tạo phiên:

| Route | Gate |
| --- | --- |
| `POST /api/auth/sign-in` | ✅ có từ đầu |
| `GET /api/auth/sso` | ✅ đường vào chủ đích |
| `POST /api/auth/verify-email` | ❌ **THIẾU → đã vá trong WO này** |

**Lỗ đã vá:** `verify-email` đổi OTP mục đích `register` lấy phiên. Đóng `sign-up` + `resend-otp` **không**
bịt được nó: mọi OTP phát ra *trước* lúc flip vẫn sống thêm `OTP_TTL_MS = 10 phút` ⇒ có cửa sổ 10 phút
đăng ký-xong-vào-thẳng, vòng qua SSO-only. Bản vá đặt check **sau** validate schema, **trước** `verifyOtp`
— cùng `403` cho mọi non-admin nên không tiết lộ mã đúng/sai; break-glass admin vẫn qua như `sign-in`.

### 2.3 JIT provisioning (điều kiện sống của user mới)

`app/api/auth/sso/route.ts:110` gọi `ensureUserForSso()` **trước** `verifyEmailAndCreateSession()` ⇒ nhân
viên MediaOS hợp lệ chưa từng vào LMS vẫn vào được dưới SSO-only. (Đây là câu hỏi Q2 của plan-review
2026-07-21 — đã xác minh có, không cần bổ sung.)

### 2.4 Audit consume SSO

`auditSso()` ghi `admin_audit_log` cho cả `sso.consume.success` và `sso.consume.failure`
(`invalid_signature` · `replay` · `session_failed`). **Không** chứa token/HMAC — chỉ `jti` + lý do
(BẤT BIẾN #3). Best-effort: lỗi ghi audit không chặn đăng nhập nhưng `console.error` server-side (không
nuốt câm). Rate-limit per-IP (burst 10, refill 0.5/s) đặt **trước** verify/audit để token-rác không phình
bảng — 429 không ghi audit.

---

## 3. Rủi ro CÒN LẠI — owner phải chốt trước khi bật

### 3.1 Break-glass có thật sự dùng được không?

Guard chỉ kiểm `ADMIN_EMAILS` **khác rỗng**, không kiểm tài khoản đó **có mật khẩu biết được**. Bẫy:
`ensureUserForSso()` tạo user JIT với **mật khẩu ngẫu nhiên 24 byte** — nếu 2 email trong `ADMIN_EMAILS`
(`ng.canh9x@gmail.com`, `fmc.tnd@gmail.com`) chỉ mới tồn tại trong LMS qua SSO/sync chứ chưa từng đặt mật
khẩu, thì dưới SSO-only:

- `forgot-password` đã 403 ⇒ **không đặt lại được mật khẩu**;
- đường vào duy nhất còn lại là SSO ⇒ **mất luôn break-glass khi MediaOS sự cố** (đúng kịch bản cần nó).

Giảm nhẹ: `isEnvOwnerEmail` cấp `ALL_PERMISSIONS + ADMINISTRATOR` cho **bất kỳ phiên nào** có email ∈
`ADMIN_EMAILS`, kể cả phiên tạo qua SSO ⇒ admin vào bằng SSO vẫn full quyền. Nên đây là rủi ro *mất đường
lùi khi MediaOS chết*, không phải mất quyền hằng ngày.

**Việc của owner:** đăng nhập thử `train.funtimemediacorp.com/login` bằng mật khẩu của 1 trong 2 email trên
**TRƯỚC** khi flip. Đăng nhập được ⇒ bật an toàn. Không được ⇒ đặt mật khẩu cho admin (qua
forgot-password khi cờ còn tắt) rồi mới bật.

### 3.2 Không smoke được cục bộ

`next.config.ts` không cho override `distDir`, nên `next dev`/`next build` đều ghi thẳng `.next` mà NSSM
đang phục vụ ⇒ **không dựng được bản chạy thử song song** để smoke. Hệ quả: smoke chỉ làm được **sau** khi
build+restart PROD. Vì vậy bản vá `verify-email` được thiết kế **inert khi cờ tắt** (`assertSsoOnlyConfig`
return sớm, `isSsoOnly()` false) — deploy trước, bật sau, hai bước tách rời.

---

## 4. Quy trình BẬT (owner)

Chuẩn bị đã xong: `apps/lms/.env.production` đã có `MEDIAOS_APP_URL=https://funtimemediacorp.com` và dòng
`# SSO_ONLY=true` để sẵn (đang comment). `ADMIN_EMAILS` đã set 2 email.

```powershell
# B0. BẮT BUỘC — test break-glass khi cờ CÒN TẮT: login train.funtimemediacorp.com bằng mật khẩu admin.
#     Không vào được ⇒ DỪNG, đặt mật khẩu admin qua /forgot-password rồi quay lại B0.

# B1. Bật cờ: bỏ dấu '#' ở dòng cuối apps/lms/.env.production
#     SSO_ONLY=true

# B2. Build + restart (dùng lệnh chuẩn, KHÔNG chạy next build tay rồi quên restart)
m prod-update lms

# B3. Smoke (mục 5). Hỏng bất kỳ mục nào ⇒ B4.

# B4. Rollback — comment lại SSO_ONLY rồi restart, KHÔNG cần build lại
#     (# SSO_ONLY=true)  →  m prod-restart lms
```

> `m prod-env` **không** đụng `apps/lms/.env.production` (chỉ ghi `.env`/`.env.prod` ở gốc MediaOS), nên
> `MEDIAOS_APP_URL`/`SSO_ONLY` không bị ghi đè.

---

## 5. Smoke checklist sau khi bật

| # | Bước | Kỳ vọng |
| --- | --- | --- |
| 1 | Mở `https://train.funtimemediacorp.com/login` (ẩn danh) | Chỉ nút "Đăng nhập qua MediaOS" → `https://funtimemediacorp.com/lms`; **không** form mật khẩu mặc định |
| 2 | `GET /register`, `GET /forgot-password` | redirect `/login` |
| 3 | `POST /api/auth/sign-up` (body bất kỳ) | `403` `{ code: "SSO_ONLY" }` |
| 4 | `POST /api/auth/verify-email` (email thường) | `403` `{ code: "SSO_ONLY" }` ← **luống mới vá** |
| 5 | `POST /api/auth/sign-in` email nhân viên thường | `403` (kể cả mật khẩu đúng) |
| 6 | `POST /api/auth/sign-in` email ∈ `ADMIN_EMAILS` | vào được (break-glass) |
| 7 | Nhân viên bấm ô "Đào tạo" trong MediaOS `/lms` | vào thẳng `/course`, có phiên |
| 8 | Nhân viên **chưa từng** vào LMS làm bước 7 | vẫn vào được (JIT `ensureUserForSso`) |
| 9 | `SELECT action, actor_email, target_id FROM admin_audit_log WHERE action LIKE 'sso.consume%' ORDER BY created_at DESC LIMIT 5` | có dòng `sso.consume.success`, `target_id` = jti, **không** có token |

---

## 6. File chạm

| File | Vai trò |
| --- | --- |
| `lib/platform/auth/sso-only.ts` | `isSsoOnly` · `SSO_ONLY_BLOCKED` · `assertSsoOnlyConfig` · `mediaosLoginUrl` |
| `lib/platform/auth/permissions.ts` | `hasEnvOwnerEmails()` (nguồn break-glass cho guard) |
| `lib/platform/env.ts` | khai `SSO_ONLY` (string optional) + `MEDIAOS_APP_URL` (refine http(s)) |
| `app/(auth)/login/page.tsx` + `_components/LoginForm.tsx` | nhánh SSO-only |
| `app/(auth)/register/page.tsx` · `forgot-password/page.tsx` | redirect |
| `app/api/auth/{sign-up,sign-in,forgot-password,reset-password,resend-otp}/route.ts` | 403 / break-glass |
| `app/api/auth/verify-email/route.ts` | **vá S5-LMS-APP-2** — đóng điểm tạo phiên thứ 3 |
| `app/api/auth/sso/route.ts` | JIT + audit + rate-limit + redirect nội bộ |
| `apps/lms/.env.production` | `MEDIAOS_APP_URL` (đã đặt) · `SSO_ONLY` (để sẵn, đang comment) |

## 7. Kiểm chứng đã chạy

**Tĩnh:** `npx tsc --noEmit` → 0 lỗi · `npx eslint app/api/auth/verify-email/route.ts` → sạch · rà tay
theo checklist bảo mật (điểm tạo phiên · rò thông tin qua mã lỗi · audit không chứa secret · guard
fail-loud · JIT). Chưa chạy `security-reviewer`/`silent-failure-hunter` dạng agent.

**Tiền đề đo trước khi bật** (đọc `data/app.db` read-only):

- `ng.canh9x@gmail.com` tạo 2026-04-07, `fmc.tnd@gmail.com` tạo 2026-01-16 — **trước** khi có JIT
  (`sso.ts` 2026-07-21) ⇒ mật khẩu do chính họ đặt, break-glass có thật (§3.1 đã giải toả).
- `sso.consume.success` đã có nhiều dòng thật trong ngày ⇒ đường vào SSO sống.

**Smoke PROD 2026-07-24 sau `m prod-restart lms`** (`https://train.funtimemediacorp.com`):

| # | Kiểm | Kết quả |
| --- | --- | --- |
| 1 | `GET /login` | 200, có "Đăng nhập qua MediaOS" → `https://funtimemediacorp.com/lms` ✅ |
| 2 | `GET /register` | 307 → `/login` ✅ |
| 3 | `GET /forgot-password` | 307 → `/login` ✅ |
| 4 | `POST /api/auth/sign-up` | 403 `SSO_ONLY` ✅ |
| 5 | `POST /api/auth/verify-email` | 403 `SSO_ONLY` ✅ **(lỗ đã vá)** |
| 6 | `POST /api/auth/sign-in` email thường | 403 `SSO_ONLY` ✅ |
| 7 | `POST /api/auth/sign-in` 2 email `ADMIN_EMAILS` (mật khẩu sai cố ý) | **401** "Invalid email or password" — KHÔNG bị 403 ⇒ break-glass còn mở ✅ |
| 8 | `forgot-password` · `reset-password` · `resend-otp` (API) | 403 `SSO_ONLY` ✅ |
| 9 | `GET /api/auth/sso` không token | 401 + ghi `sso.consume.failure`, `actor_email` rỗng, **không** có token trong log ✅ |
| — | `users` trước/sau smoke | 37 → 37 (sign-up 403 không tạo user) ✅ |

**Còn lại 1 mục người dùng thật:** nhân viên bấm ô "Đào tạo" trong MediaOS → vào `/course`. Chưa tự chạy
được vì cần phiên MediaOS thật. Rủi ro thấp: WO này **không sửa** `app/api/auth/sso/route.ts`, và
SSO-only không gate route đó — trước lúc restart vài phút vẫn có `sso.consume.success` thật
(`admin@funtimemediacorp.com`, 16:34 UTC).

**Quan sát ngoài phạm vi** (chưa seed WO): `POST /api/auth/sign-in` **không có rate-limit** (khác
`/api/auth/sso` đã có). Dưới SSO-only bề mặt này thu hẹp còn đúng 2 email `ADMIN_EMAILS`, nhưng nếu tắt cờ
thì đây là cửa brute-force mở cho toàn bộ 37 tài khoản.

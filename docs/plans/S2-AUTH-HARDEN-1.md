# S2-AUTH-HARDEN-1 — Hardening password-reset (P2) · micro-plan

> Crown/red (auth) · FULL gate (security-reviewer + silent-failure-hunter) + người chốt.
> Follow-up review PR #29 (LOW: rate-limit bucket share / timing-oracle / token-redact / env.example).
> Stack trên `feat/s2-qa-debt-1` (PR #40) vì WO này viết lại chính spec forgot-password mà #40 vừa tạo.

## Bối cảnh (state thật đã đọc)

- `forgotPassword` (auth.service.ts) hiện dùng **chung bucket login**: `LoginRateLimiter.key` (`rl:ip:*`)
  + `accountKey` (`rl:acct:*`). ⇒ spam forgot cho victim's email **lock được login của victim** (DoS). LOW #1.
- Comment dòng ~840 sai: nói "reset sau resetPassword thành công" — `resetPassword` KHÔNG reset bucket forgot.
- Timing-oracle: nhánh email-tồn-tại làm crypto (`encryptSecret`) + 2 INSERT + audit trong tx; nhánh ghost
  (`if(!user) return`) không làm gì ⇒ tồn-tại chậm hơn ghost. Mail consumer cho `auth.password_reset_requested`
  **CHƯA tồn tại** (deferred) ⇒ KHÔNG thể "đẩy mail khỏi request-path dựa consumer" ⇒ dùng **sàn/jitter**.
- `reset-password-mail.service.ts` ĐÃ trả `{sent,reason}` (no rethrow token) ⇒ LOW #3 token-redact: ĐẠT;
  chỉ còn `.env.example` thiếu `RESET_PASSWORD_URL` (env.schema đã có default `""`).

## Phạm vi (đúng `paths` WO — KHÔNG đụng env.schema/migration/employees/totp)

1. **`login-rate-limiter.ts`** — thêm 2 static helper namespace RIÊNG (additive, không đổi key login):
   - `forgotKey(slug,email,ip)` → `rl:forgot:ip:${slug}|${email}|${ip}`
   - `forgotAccountKey(slug,email)` → `rl:forgot:acct:${slug}|${email}`

2. **`auth.service.ts` `forgotPassword`** —
   - (#1) đổi `LoginRateLimiter.key/accountKey` → `forgotKey/forgotAccountKey`; sửa comment sai
     (bucket forgot tự hết hạn theo TTL `LOGIN_LOCKOUT_SEC`, KHÔNG reset ở resetPassword; tách hẳn login).
   - (#2) sàn thời gian đồng nhất: `startedAt = Date.now()` ở đầu method, `finally { await uniformFloor(startedAt) }`
     bao TRỌN mọi return-path (unknown-tenant · locked · ghost · existing · error) ⇒ mọi nhánh ≥ floor + jitter.
     Hằng số cục bộ (KHÔNG env — env.schema ngoài scope): `FORGOT_PW_FLOOR_MS=250`, `FORGOT_PW_JITTER_MS=80`.
     `Math.random()` (app-runtime — KHÔNG phải workflow script) cho jitter. Floor là **giảm thiểu**, không phải
     constant-time tuyệt đối — ghi rõ trong comment + PR.
   - Giữ nguyên uniform-void (202), no-secret-log, outbox durable, audit-in-tx.

3. **`.env.example`** — thêm `RESET_PASSWORD_URL=` (rỗng, cạnh ACTIVATION/invite URL dòng ~96) + comment 1 dòng.

4. **`forgot-password-rate-limit.spec.ts`** (của #40 — cập nhật cho namespace mới):
   - (a) N lần (= `LOGIN_MAX_ATTEMPTS`) forgot THẬT → `forgotKey` **locked**.
   - (a-sec) sau N lần forgot: `LoginRateLimiter.key`/`accountKey` (bucket login) **KHÔNG locked** —
     spam forgot KHÔNG khoá login victim (đích an ninh #1).
   - (b) locked (forgot bucket) → `withTenant` KHÔNG được gọi (short-circuit).
   - control: not-locked → `withTenant` gọi đúng 1 lần.

## Bất biến / rủi ro

- BẤT BIẾN #3 (no-secret-log): KHÔNG log token/link — giữ nguyên, không thêm log có token.
- Deny-path RED hiện có (`auth-reset-deny-path.int-spec.ts`) PHẢI còn xanh (uniform 202, ghost = no row/no outbox).
  Floor thêm độ trễ → test chậm hơn vài giây, KHÔNG đổi hành vi/assert.
- KHÔNG đổi shape token/migration/RLS. KHÔNG đụng login bucket (regression login rate-limit phải xanh).
- Floor áp cả nhánh locked: vẫn void, vẫn không chạm DB — chỉ trễ. Chấp nhận (uniform hơn).

## Verify

- unit `forgot-password-rate-limit.spec` (no DB) — 4+ test gồm a/a-sec/b/control xanh.
- int `auth-reset-deny-path.int-spec` + `auth.int-spec` trên `LANE_DB=mediaos_s2qadebt1` — xanh (không skip).
- typecheck + eslint apps/api xanh.
- FULL gate: security-reviewer + silent-failure-hunter PASS trên diff.

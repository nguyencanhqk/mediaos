# S18-AUTH-UNLOCK429-1 — Gỡ khoá đăng nhập (429) từ giao diện

> **Work Order:** `harness/backlog.mjs` → `S18-AUTH-UNLOCK429-1` · zone 🔴 · gate FULL · **0 migration**
> **Wave:** S18-AUTH-LOCKOUT (3 WO). WO này là WO NỀN — hai WO sau (`RESETCLEARS`, `RETRYAFTER`) dùng lại
> `clearLoginLocks()` / `remainingLockSec()` do WO này dựng.
> **Ngày:** 2026-09-03 · số đo đọc từ code THẬT (không suy từ comment).

---

## 1. Vấn đề — cơ chế chính xác

Người dùng gõ sai mật khẩu 5 lần → `LoginRateLimiter` khoá `rl:{envScope}:ip:{slug}|{email}|{ip}:lock`
900 giây. Đường thoát DUY NHẤT hôm nay là `valkey-cli DEL` trên máy chủ, vì:

| # | Đường tưởng-là-thoát | Vì sao KHÔNG thoát |
| --- | --- | --- |
| 1 | Nút **“Mở khoá”** ở `UserDetailPage` | `AuthUsersService.unlockUser` chỉ sửa `users.status`/`locked_at`; **KHÔNG inject `LoginRateLimiter`**. Người bị 429 vẫn `status='active'` ⇒ nút còn ném **400 `NOT_LOCKED`** (`auth-users.service.ts:332`) trước khi kịp làm gì. Hai khái niệm khoá TÁCH RỜI hoàn toàn. |
| 2 | “Quên mật khẩu” | `resetPassword` không chạm rate-limiter (phạm vi `S18-AUTH-RESETCLEARS-1`, không phải WO này). |
| 3 | Chờ hết TTL | 900s, và người dùng không biết còn bao lâu (phạm vi `S18-AUTH-RETRYAFTER-1`). |

**Vì sao không thể “xoá theo pattern”:** bốn môi trường dùng CHUNG một Valkey db0
(`common/valkey/valkey-key.ts` docblock, KI-067) ⇒ **CẤM `SCAN`/`FLUSHDB`**. Khoá per-IP nhúng `ip` vào
chuỗi khoá, mà server-side KHÔNG có nơi nào lưu “email này đã sai từ những IP nào”. ⇒ **phải dựng chỉ mục IP.**

### 1.1 Số đo hiện trạng (đọc 03/09)

- `LoginRateLimiter` (`apps/api/src/auth/login-rate-limiter.ts`, 214 dòng): `key()`/`accountKey()`/
  `forgotKey()`/`forgotAccountKey()` · `isLocked` · `recordFailure` · `reset` · `claimFirstOfWindow`.
  Hai đường: Valkey (khi `VALKEY_URL` có) và fallback `Map` in-memory `attempts`.
- `AuthService.recordLoginFailure` (`:835-841`) là **nơi duy nhất trong luồng login biết đủ bộ ba
  `(slug, email, ip)`** và luôn chạy khi một lượt sai được ghi nhận (4 call-site: `:324`, `:431`).
- `AuthService.forgotPasswordImpl` (`:1383-1389`) cũng biết đủ bộ ba — xem §4.4 (mở rộng có chủ đích).
- `ValkeyService` có `incr/get/set/setNx/sAddWithTtl/sRemCount/sCard/del`. **Thiếu `sMembers` và `ttl`.**
- Cặp quyền `unlock:user` (`AUTH_USER.UNLOCK`) đã seed 0444/0450, `is_sensitive=false`
  ⇒ controller **KHÔNG khai `isSensitive`** (khai thừa = chặn oan wildcard, khớp docblock controller `:52`).
- `audit_logs.object_type='user'` đã dùng bởi `user.locked`/`user.unlocked` ⇒ **CHECK không phải sửa**.
  `user_security_events.event_type='USER_UNLOCKED'` đã dùng ⇒ **0 migration cho cả WO**.

---

## 2. Ranh giới phạm vi (nói trước để review đo đúng)

**LÀM:** chỉ mục IP + `clearLoginLocks`/`loginThrottleState` trong `LoginRateLimiter`; 2 endpoint admin;
audit + security-event; badge & nút ở FE.

**KHÔNG LÀM (cố ý):**
- KHÔNG nới `LOGIN_MAX_ATTEMPTS`, KHÔNG hạ `LOGIN_LOCKOUT_SEC` — đây là control chống brute-force.
- KHÔNG đụng `unlockUser` hiện có (khoá admin) — hai đường tách bạch, kể cả nhãn ở FE.
- KHÔNG chạm `resetPassword` (WO `RESETCLEARS`), KHÔNG thêm `retryAfterSec` vào 429 (WO `RETRYAFTER`).
- KHÔNG thêm cặp quyền mới ⇒ 0 migration. Nếu thiết kế bắt buộc phải thêm ⇒ **dừng, hỏi owner** (đổi phạm vi).

---

## 3. Thiết kế — tầng Valkey

### 3.1 Chỉ mục IP (`ip-index`)

```ts
// valkey-key.ts — RlBucket += 'ip-index' (APPEND, giữ nguyên họ `rl:` để census/cổng envScope phủ sẵn)
rlKey("ip-index", `${slug}|${email.toLowerCase()}`)   // → rl:{envScope}:ip-index:{slug}|{email}
```

- **Ghi:** `SADD <set> <ip>` + `EXPIRE <set> LOGIN_LOCKOUT_SEC` — tái dùng **`ValkeyService.sAddWithTtl`
  đã có** (pipeline SADD+EXPIRE+SCARD, không cần method ghi mới). Trả `null` khi Valkey tắt/rớt ⇒ bỏ qua.
- **Đọc:** `sMembers` (mới).
- **TTL đặt lại ở MỖI lần ghi** ⇒ set luôn sống ít nhất bằng khoá dài nhất nó phải mô tả. Set hết hạn
  trước khoá là bất khả: mọi khoá `:lock` đều sinh ra từ một `recordFailure` vừa refresh set.

**Trần kích thước — có sẵn, không cần thêm cơ chế:** đường đã-khoá `return` **trước** `recordLoginFailure`
(`auth.service.ts:280-312`), nên khi bucket `acct` chạm ngưỡng (`LOGIN_ACCOUNT_MAX_ATTEMPTS=20`) mọi lượt sau
bị 429 ở đầu ⇒ **không SADD nữa**. Trần thực tế ≈ `accountMaxAttempts` IP phân biệt cho mỗi
`(slug,email)` mỗi cửa sổ 900s (≲ 20 × ~45 byte). Không có đường bơm phồng vô hạn từ endpoint công khai.

### 3.2 `clearLoginLocks(slug, email)` — xoá cái gì

| Khoá | Vì sao trong danh sách |
| --- | --- |
| `rl:…:ip:{slug}\|{email}\|{ip}` `:cnt` + `:lock` cho **TỪNG ip** trong set | chính khoá đang chặn |
| `rl:…:acct:{slug}\|{email}` `:cnt` + `:lock` | bucket tài khoản (ca 2+ IP) |
| `rl:…:forgot:ip:{slug}\|{email}\|{ip}` `:cnt` + `:lock` cho từng ip trong set | done_when: clear phải mở lại đường “Quên mật khẩu” |
| `rl:…:forgot:acct:{slug}\|{email}` `:cnt` + `:lock` | như trên |
| chính `rl:…:ip-index:{slug}\|{email}` | dọn sau khi dùng |

**KHÔNG xoá** `rl:…:logdedup:*` (khoá gộp `login_logs`): nó bảo vệ bảng **append-only không thu hồi được**
khỏi bồi hàng (KI-048). Xoá nó = mở lại đúng lỗ đó cho một admin bấm nút nhiều lần.
**KHÔNG xoá** `stepup:*`/`2fa*` (bucket khác vòng đời, không liên quan đăng nhập bằng mật khẩu).

Tất cả gom vào **một** `ValkeyService.del(...keys)` (đã nhận rest-args) ⇒ 1 round-trip, đồng thời
`assertKeysScoped` soi được toàn bộ danh sách.

### 3.3 Nhánh fallback in-memory — **không phải phần phụ**

`VALKEY_URL` thường VẮNG trong test ⇒ nếu chỉ vá nhánh Valkey thì **toàn bộ int-spec chạy trên nhánh
memory và không chứng minh được gì** (đúng lớp lỗi mà docblock `claimFirstOfWindow` đã ghi).

`clearLoginLocks` **LUÔN** dọn `attempts` (mirror `reset()` — memory có thể đã ghi trong lúc Valkey rớt),
bằng cách duyệt `this.attempts` theo **tiền tố** `rl:{envScope}:ip:{slug}|{email}|` + xoá đúng 2 khoá
`acct`/`forgot:acct` + tiền tố `forgot:ip`. Đây là duyệt `Map` **in-process** — KHÔNG phải `SCAN` Valkey,
lệnh cấm ở §1 không áp dụng. Chi phí O(số bucket sống trong process), không phải O(dữ liệu Valkey).

> ⚠️ Tiền tố phải dựng **qua `rlKey()`**, không nối chuỗi tay — nối tay là đúng lối mà
> `valkey-key-census.spec.ts` cấm, và sẽ lệch khi `envScope` đổi.

### 3.4 `loginThrottleState(slug, email)` → `{locked, remainingSec, buckets}`

- `buckets`: `'acct'` nếu khoá acct còn; `'ip'` nếu **bất kỳ** ip nào trong set còn khoá. Thứ tự cố định
  `['acct','ip']` (mảng, không Set) để test ghim được.
- `remainingSec` = **max** TTL trong các khoá đang giữ — vì người dùng chỉ vào được khi khoá CUỐI hết hạn.
  Valkey: `ttl(key)`; `-1`/`-2`/lỗi → `null`. Memory: `ceil((lockedUntilMs - now)/1000)`.
- Không khoá ⇒ `{locked:false, remainingSec:null, buckets:[]}`.
- Valkey rớt hoàn toàn ⇒ `remainingSec:null` nhưng `locked` vẫn tính đúng theo `isLocked` (đã fail-soft
  sang memory) — **không ném**, không hiện “0 giây” (mirror done_when của WO `RETRYAFTER`).

### 3.5 `ValkeyService` += 2 method (cùng hợp đồng fail-soft)

```ts
async sMembers(key: string): Promise<string[] | null>   // null = tắt/lỗi (KHÔNG phải mảng rỗng)
async ttl(key: string): Promise<number | null>          // <0 (không tồn tại / không TTL) → null
```

`assertKeysScoped("sMembers"|"ttl", [key])` đứng **TRƯỚC** `if (!this.client)` — đúng khuôn `incr`
(đặt sau thì cổng không bao giờ đo được gì trong test). **`null` ≠ `[]`** là phân biệt bắt buộc: `[]` nghĩa
“chắc chắn không có IP nào”, `null` nghĩa “không biết” — hai cái dẫn tới hai kết luận khác nhau ở §3.4.

---

## 4. Thiết kế — API

### 4.1 Hai endpoint (`AuthUsersController`)

```
GET  /auth/users/:id/login-throttle        → 200 {locked, remainingSec, buckets}
POST /auth/users/:id/login-throttle/clear  → 204
```

Cả hai: `@RequirePermission(AUTH_USER.UNLOCK.action, AUTH_USER.UNLOCK.resource)`, **không** `isSensitive`
(cặp `is_sensitive=false`; khai thừa ⇒ chặn oan — memory `sensitive-capability-allowlist-is-backend`).
`@Param('id', new ParseUUIDPipe())` như mọi route anh em. Không va route `@Get(':id')` (khác số segment).

### 4.2 Service — `AuthUsersService.getLoginThrottle` / `clearLoginThrottle`

Cần `(companySlug, email)` mà actor chỉ đưa `companyId` + `:id`:

```
withTenant(actor.companyId, tx):
  target = repo.findByIdTx(tx, companyId, id)      → không thấy/cross-tenant ⇒ 404 TRƯỚC mọi việc khác
  slug   = SELECT slug FROM companies WHERE id = $companyId AND deleted_at IS NULL   (khuôn
           dashboard-company-tz.util.ts:20 — đọc trong tenant tx, RLS là sàn)
```

`assertNotSelf` ở **POST clear** (theo done_when — mirror `lock`/`unlock`), **KHÔNG** ở GET: đọc trạng thái
khoá của chính mình vô hại và giúp admin tự chẩn đoán.

Thứ tự guard ở clear: `assertNotSelf` (400) → `findByIdTx` (404) → mới chạm Valkey. ⇒ Cross-tenant KHÔNG
bao giờ chạm tới chuỗi khoá của tenant khác, và không đẻ oracle “user này tồn tại” khác với `unlockUser`.

### 4.3 Audit + security event — thứ tự và **đánh đổi phải nói ra**

```
1. before = loginThrottleState(slug, email)        (đọc, không đổi trạng thái)
2. result = clearLoginLocks(slug, email)           (Valkey/memory — NGOÀI transaction)
3. withTenant(tx): audit.record + securityEvents.record   (commit vết)
```

**Vì sao clear TRƯỚC, ghi vết SAU:** Valkey không transactional — rollback DB không hoàn tác được `DEL`.
Ghi audit trong tx rồi clear sau commit sẽ để lại **vết nói dối** khi clear hỏng (“đã gỡ” mà chưa gỡ).
Đặt clear trước ⇒ vết luôn mô tả **kết quả thật**: payload mang `{ hadLock, buckets, clearedKeys, ok }`.
Rủi ro còn lại: bước 3 ném ⇒ đã gỡ mà mất vết. Chấp nhận có ý thức, và nó **hẹp hơn** rủi ro ngược lại
(vết sai). `audit.record` trong tx cùng `withTenant` là đường đã chạy ở 20+ chỗ khác, xác suất ném ≈ lỗi DB
— lúc đó cả request đã 500 và người vận hành có log.

- `audit`: `action:'user.login_throttle_cleared'`, `objectType:'user'`, `objectId:id`, `actorUserId:actor.id`.
  Không có CHECK trên `action` (chỉ `object_type` có) ⇒ 0 migration. **Không đưa email vào payload**
  (`rl:*` nhúng email; audit masker che theo tên khoá nhưng không nên dựa vào) — `objectId` đã định danh đủ.
- `securityEvents.record({eventType:'USER_UNLOCKED', userId:id, actorUserId:actor.id,
  payload:{reason:'login_throttle'}})` — `USER_UNLOCKED` đã trong CHECK; `reason` phân biệt với unlock admin.
- **GHI CẢ khi `hadLock=false`** (`lock-observability-rule`: đường GỠ khoá phải để vết kể cả khi không có gì
  để gỡ — “admin đã thử gỡ” là dữ kiện forensics). `hadLock` nằm trong payload nên hai ca phân biệt được.

### 4.4 Ghi chỉ mục ở ĐÂU — mở rộng có chủ đích so với chữ nghĩa WO

WO viết “ghi tại `recordLoginFailure` (nơi DUY NHẤT biết đủ slug/email/ip)”. **Đo lại: `forgotPasswordImpl`
(`auth.service.ts:1383-1389`) cũng biết đủ bộ ba.** Nếu chỉ ghi ở đường login thì done_when “clear xoá CẢ
`forgot:ip`” **không đạt được** cho IP chỉ-gọi-forgot-chưa-từng-login-sai. ⇒ ghi ở **cả hai** đường, qua
**một** method `noteFailureSource(slug, email, ip)` (một chỗ ghi, không hai bản).

An toàn: lượt SADD ở forgot chạy **vô điều kiện, trước nhánh rẽ theo “email có tồn tại không”** — cùng vị trí
với `recordFailure(ipKey)` hiện tại ⇒ **không thêm oracle enumeration** (email-ma và email-thật đi qua đúng
cùng số round-trip). Trần kích thước: bucket `forgot:acct` khoá sau 20 lượt ⇒ cùng lập luận §3.1.

### 4.5 Contracts (`packages/contracts/src/auth/user-admin.ts`)

```ts
export const authUserLoginThrottleSchema = z.object({
  locked: z.boolean(),
  remainingSec: z.number().int().nonnegative().nullable(),
  buckets: z.array(z.enum(["acct", "ip"])),
});
export type AuthUserLoginThrottleDto = z.infer<typeof authUserLoginThrottleSchema>;
```

KHÔNG `.default()` trên schema phản hồi (memory `zod-default-on-response-schema-breaks-apifetch-typing`).
Export qua barrel như các schema anh em.

---

## 5. Thiết kế — FE

`packages/web-core/src/lib/auth-users-api.ts` (+2):
`getLoginThrottle(id)` → `authUserLoginThrottleSchema` · `clearLoginThrottle(id)` → `authUserVoidSchema` (204).
Query key: `authUsersKeys.loginThrottle(id)` (thêm vào keys factory hiện có).

`apps/app/src/routes/system/users/UserDetailPage.tsx`:
- `useQuery({ ...loginThrottle, enabled: canUnlock })` — **`enabled` là bắt buộc**: GET gate `unlock:user`,
  admin chỉ có `view:user` sẽ ăn 403 và làm bẩn màn hình bằng lỗi không liên quan.
- Khi `data.locked`: `<Badge variant="danger">Đang bị khoá đăng nhập · còn ~N phút</Badge>`
  (`N = ceil(remainingSec/60)`; `remainingSec === null` ⇒ bỏ vế “còn ~N phút”, không hiện “0 phút”).
- Nút **“Gỡ khoá đăng nhập”** trong `<PermissionGate action="unlock" resource="user">`, **tách bạch** khỏi
  nút “Mở khoá” (khoá admin) — hai nhãn, hai mô tả, không bao giờ hiện như một cặp mơ hồ:
  - “Mở khoá” — trạng thái tài khoản (`status='locked'`), hiện khi `isLocked`.
  - “Gỡ khoá đăng nhập” — bộ chặn tần suất 429, hiện khi `throttle.locked`.
- Sau clear: invalidate `loginThrottle(id)` + `detail(id)`. Lỗi 403 → dùng đúng đường `mutationError` hiện có.
- i18n `apps/app/src/i18n/locales/vi/system.ts`: `users.detail.loginThrottle.{badge,badgeNoEta,clear,
  confirm,success}`.

---

## 6. Test (RED trước)

### 6.1 Unit — `login-rate-limiter.spec.ts` (+, chạy CẢ HAI nhánh)

Bảng ca chạy hai lượt (`useValkey: true` với fake ValkeyService in-memory, `false` với client vắng):

1. `recordLoginFailure` → set chứa đúng ip; gọi 2 IP → set 2 phần tử; TTL = `lockoutSec`.
2. Khoá 1 IP → `clearLoginLocks` → `isLocked(ipKey)` false, `isLocked(acctKey)` false.
3. **Đột biến A:** bỏ vế xoá `acct` ⇒ ca “20 lần sai từ 2 IP rồi clear” phải ĐỎ.
4. **Đột biến B:** bỏ vế xoá theo chỉ mục ⇒ ca “2 IP cùng bị khoá, clear xong cả hai vào được” phải ĐỎ.
5. `clearLoginLocks` khi KHÔNG có khoá nào ⇒ không ném, không xoá nhầm bucket của email KHÁC
   (**ca đối chứng**: email B vẫn khoá sau khi clear email A — chống `clearLoginLocks` quét quá tay).
6. `loginThrottleState`: không khoá / khoá acct / khoá ip / khoá cả hai (buckets đúng) / TTL null.
7. `forgot:*` bị xoá bởi clear (ca riêng, không gộp vào ca login).

### 6.2 Unit — `auth-users.service.spec.ts` (+)

`clearLoginThrottle`: self ⇒ 400 · không thấy ⇒ 404 **và** `clearLoginLocks` KHÔNG được gọi ·
`hadLock=false` vẫn ghi 1 audit + 1 security event · payload có `reason:'login_throttle'`.

### 6.3 Integration (LANE_DB) — `test/integration/auth-s18-unlock429-*.int-spec.ts`

- **deny.int-spec** (qua HTTP, `PermissionGuard` thật — khuôn `admin-users-deny.int-spec.ts`):
  thiếu `unlock:user` ⇒ **403** (kèm **ca ALLOW đối chứng** ⇒ 204, để ca deny không xanh-RỖNG —
  memory `deny-cases-vacuous-without-allow-case`) · user tenant khác ⇒ **404** · self ⇒ **400** ·
  id không tồn tại ⇒ **404** · GET cùng bộ.
- **flow.int-spec** (end-to-end qua các lớp thật): 5 lượt `auth.login` sai (cùng ip) ⇒ 429 →
  `clearLoginThrottle` → `auth.login` đúng mật khẩu ⇒ **200 NGAY** (không chờ TTL) + `login_logs` có
  hàng `success`. Ca 2 IP: 20 lượt sai rải 2 IP ⇒ bucket `acct` khoá ⇒ clear ⇒ cả hai IP vào được.
  Ca audit: đúng **1** hàng `audit_logs.action='user.login_throttle_cleared'` + **1**
  `user_security_events` `USER_UNLOCKED`; ca `hadLock=false` cũng đúng 1 hàng mỗi bảng.
  (Mẫu điều khiển IP: gọi `auth.login(..., {ip})` như `login-blocked-attribution.int-spec.ts:306` —
  không phụ thuộc `TRUST_PROXY`/header proxy trong test.)

### 6.4 FE — `UserDetailPage.spec.tsx` (+)

không khoá ⇒ **không** hiện nút/badge · khoá ⇒ badge có “còn ~N phút” + nút hiện ·
`remainingSec:null` ⇒ badge KHÔNG chứa “0” · thiếu quyền ⇒ nút vắng **và** query không chạy ·
clear 403 ⇒ hiện thông báo lỗi, badge giữ nguyên · clear 204 ⇒ invalidate (badge biến mất sau refetch).

### 6.5 Cổng

- `valkey-key-census.spec.ts` + `assertKeysScoped` XANH **không thêm dòng miễn trừ nào** — nếu phải thêm
  miễn trừ thì thiết kế sai, quay lại §3.1.
- `apps/api/package.json → test:cov:sensitive`: thêm `--coverage.include='src/auth/login-rate-limiter.ts'`
  + khoá threshold. File này đang **ngoài mọi `--coverage.include`** ⇒ hôm nay không cổng nào đo nó
  (memory `coverage-threshold-key-typo-is-dead-gate` — sai một khoá = cổng chết, phải chạy thử thấy số).
- `bash harness/check.sh --all --lane-db=s18unlock` XANH; typecheck api/contracts/web-core/app.

---

## 7. Thứ tự thực thi

1. `valkey-key.ts` (+`'ip-index'`) → `valkey.service.ts` (+`sMembers`/`ttl`) → spec RED.
2. `login-rate-limiter.ts`: `noteFailureSource` / `clearLoginLocks` / `loginThrottleState` → spec RED→GREEN.
3. `auth.service.ts`: gọi `noteFailureSource` ở `recordLoginFailure` + `forgotPasswordImpl`.
4. `contracts` → `auth-users.service.ts` → `auth-users.controller.ts` → int-spec deny + flow.
5. `web-core` api → `UserDetailPage` + i18n → FE spec.
6. Cổng coverage + `check.sh --all --lane-db=s18unlock` + FULL gate (security-reviewer, silent-failure-hunter).

## 8. Rủi ro đã nhận diện

| Rủi ro | Xử lý |
| --- | --- |
| Clear quét quá tay, gỡ khoá của email/tenant khác | Khoá dựng từ `(slug,email)` của **hàng user đã đọc trong tenant tx**; ca đối chứng §6.1(5) |
| Set chỉ mục hết hạn trước `:lock` ⇒ clear sót IP | TTL refresh ở MỖI `SADD` (§3.1); ca TTL ở §6.1(1) |
| Endpoint mới thành đường bỏ qua brute-force | Gate `unlock:user` + audit + security event mỗi lượt; ngưỡng/TTL không đổi |
| Nhánh memory không được đo (VALKEY_URL vắng trong test) | §6.1 chạy bảng ca **hai lượt** |
| Rò email qua audit/log | Payload chỉ `objectId` + cờ; `ValkeyKeyScopeError` vốn chỉ in namespace + độ dài |
| Hai nút “mở khoá” gây nhầm tiếp | §5 tách nhãn + điều kiện hiện khác nhau; ca FE ghim |

---

## 9. Bản vá kế hoạch sau review đối kháng (03/09) — **áp dụng, thay thế phần tương ứng ở trên**

`plan-reviewer` (Opus) verdict **REVISE**; ba khẳng định nền của §1/§3 đã đo lại và **sai** — vá như sau.
Owner chốt (i) + (ii) ngày 03/09.

### 9.1 ✅ owner duyệt — chuẩn hoá slug trong MỌI khoá rate-limit (B1, CRITICAL)

`companies.slug` là **citext** (`migrations/0002_companies_users.sql:78` — `resolve_company_by_slug(p_slug citext)`),
nhưng `key()/accountKey()/forgotKey()/forgotAccountKey()` ghép **slug thô do client gửi**
(`login-rate-limiter.ts:60-81`) và `contracts/src/auth.ts:10` không `.trim()/.toLowerCase()`.
⇒ `Funtime` và `funtime` đăng nhập vào CÙNG công ty nhưng rơi vào **hai bucket khác nhau**: (a) trần
brute-force nhân theo số biến thể hoa/thường; (b) clear dựng khoá từ slug **canonical đọc trong DB** sẽ
**không chạm** khoá thật ⇒ 204 + audit “đã gỡ” trong khi người dùng vẫn 429, và **mọi test vẫn xanh** vì
test dùng slug canonical.

⇒ `LoginRateLimiter.normSlug(s) = s.trim().toLowerCase()`, dùng ở **cả 4 builder + 2 chỉ mục mới +
`AuthService.claimBlockedLogSlot`** (`auth.service.ts:824-827` ghép slug thô, phải chuẩn hoá cùng nhịp,
nếu không khoá gộp `login_logs` lại tách theo case). Siết control (không nới), 0 migration.
Khoá cũ mồ côi tự hết hạn ≤900s — không dọn tay (CẤM SCAN/FLUSHDB).
**Ca RED:** `key("Funtime",…) === key("funtime",…)`; khoá tạo bằng `"Funtime"` phải gỡ được bằng `"funtime"`.

### 9.2 ✅ owner duyệt — clear GỠ CẢ bucket `2fa` bước-2 (B3, delta so với done_when)

`auth.service.ts:534` — `rateLimitKey("2fa", ${companyId}|${userId})` là bucket **bước-2 của chính luồng
login**: sai TOTP đủ ngưỡng ⇒ 429 ngay ở màn đăng nhập. Không gỡ nó thì UI sẽ khẳng định “không bị khoá”
đúng lúc người dùng đang bị khoá. Khoá dựng từ `(companyId, userId)` — endpoint admin **có sẵn cả hai**,
không cần chỉ mục, không có trần nào bị phá. `buckets` trả về mở rộng thành `('acct'|'ip'|'2fa')[]`.
Giữ nguyên loại trừ `2fa-enable`/`2fa-disable`/`change-pw`/`stepup` (luồng SAU đăng nhập) và `logdedup`.

### 9.3 Trần cứng cho chỉ mục IP — §3.1 nói SAI về “trần tự nhiên” (B2)

`recordFailure` **xoá counter** khi chạm ngưỡng (`login-rate-limiter.ts:107-110`) ⇒ hết 900s counter về 0
và nạp thêm ≤20 IP nữa; TTL set refresh mỗi `SADD` ⇒ **set không bao giờ hết hạn** khi còn lượt sai.
⇒ `IP_INDEX_CAP = 64`: `noteFailureSource` đọc `sCard` TRƯỚC, `>= CAP` thì **không SADD** (log WARN).
Đánh đổi phải nói ra: vượt trần thì per-IP ngoài 64 IP đầu không gỡ được bằng chỉ mục — nhưng ca đó bucket
`acct` mới là cái đang chặn, và nó **luôn** được gỡ. `del` một lệnh ≤ ~266 khoá (dưới ngưỡng an toàn 500).
`loginThrottleState` đọc **`ttl` (1 round-trip/ip), không `get`+`ttl`** — suy `locked` từ `ttl >= 0`.

### 9.4 Chỉ mục RIÊNG cho forgot (giữ ranh giới namespace đã ký)

Docblock `auth.service.ts:1378` tách namespace forgot/login chính vì “endpoint công khai không được ảnh
hưởng đường login”. Dùng chung một `ip-index` sẽ làm endpoint công khai nuôi cấu trúc dữ liệu của login.
⇒ **hai** bucket: `ip-index` (login) và `forgot:ip-index` (forgot); clear đọc **cả hai**. Cùng CAP.

### 9.5 Không được trả 204 khi chưa gỡ được gì (B4, silent-failure)

`del` trả `true` cả khi Valkey **chưa cấu hình** (no-op success, `valkey.service.ts:203-218`);
`sAddWithTtl` trả `null` khi rớt ⇒ chỉ mục có thể rỗng **dù khoá tồn tại**.
⇒ (a) `loginThrottleState` **hợp nhất** nguồn: Valkey ∪ quét tiền tố `attempts` in-process — nếu không,
nhánh “Valkey bật nhưng rớt” cho `locked:false` SAI; (b) **đọc lại state SAU clear**, đưa `after` vào cùng
hàng audit (vết mô tả **kết quả đo được**, không phải ý định); (c) còn khoá **hoặc** `degraded`
(`useValkey() && (sMembers===null || del===false)`) ⇒ **`ServiceUnavailableException`**, KHÔNG 204, audit
`ok:false`. `sMembers===null` khi Valkey **tắt hẳn** là BÌNH THƯỜNG (nhánh memory là nguồn sự thật) —
không tính là degraded.

### 9.6 DI vào `AuthUsersService` phải là tham số optional **ở CUỐI** (B5)

`auth-users.service.ts:99-119` có 2 tham số optional cuối, và 3 chỗ trong `auth-users.service.spec.ts`
dựng service **theo vị trí với `as never`** ⇒ chèn tham số vào giữa sẽ **trượt mock một ô mà vẫn biên dịch**.
⇒ thêm `rateLimiter?: LoginRateLimiter` ở CUỐI + **fail-fast lúc boot** trong `users.module.ts`
(mirror khối `SecurityEventWriter` đã có) + **ném rõ ràng** nếu vắng lúc gọi — KHÔNG `?.` no-op
(no-op ở đây = “bấm nút, không gì xảy ra, audit vẫn ghi đã gỡ”).

### 9.7 Cổng coverage nằm ở `vitest.config.ts`, không phải `package.json` (B6)

`package.json:12` **không có** cờ threshold nào; ngưỡng per-file sống ở `vitest.config.ts:116-284`
(khoá = đường dẫn chính xác; **khoá trượt file = cổng chết im lặng**).
⇒ `paths` của WO mở rộng thêm `apps/api/vitest.config.ts` và `packages/web-core/src/lib/query-keys.ts`
(nơi `authUsersKeys` thật sự sống), thêm khoá `src/auth/login-rate-limiter.ts` với **số đo thật** (chạy rồi
mới chốt ngưỡng), và `test/foundation/coverage-thresholds-ratchet.unit-spec.ts` phải xanh.

### 9.8 Sửa các tiền đề sai còn lại (cảnh báo MEDIUM/LOW — nhận)

- **CI CÓ `VALKEY_URL`** (`.github/workflows/ci.yml:35-43,58`) ⇒ int-spec chạy **nhánh Valkey** trên CI và
  **nhánh memory** ở máy local. Hệ quả: hai ca đột biến §6.1(3)(4) phải ĐỎ ở **cả hai** cấu hình; flow-spec
  dùng email/slug DUY NHẤT và dọn khoá ở `beforeEach` bằng `del` tường minh (cấm FLUSHDB/SCAN) — mọi
  int-spec chia chung không gian khoá `rl:` cùng `envScope`.
- **Fake Valkey làm `assertKeysScoped` mù** ⇒ thêm ca khẳng định chuỗi khoá bằng đúng `rlKey("ip-index",…)`
  và một ca đi qua `ValkeyService` THẬT (client null vẫn chạy cổng trước `if (!this.client)`).
- `remainingLockSec(key)` (1 `ttl` trên khoá đã biết + memory fallback) là primitive **WO
  `S18-AUTH-RETRYAFTER-1` tuyên bố tái dùng** — dựng nó, `loginThrottleState` gọi lại nó.
- `user_security_events.event_type` **KHÔNG có CHECK** (`0443:143,150` — chỉ `severity` có) ⇒ lý do “đã
  trong CHECK” ở §4.3 sai, nhưng kết luận 0 migration vẫn đúng. Giữ `USER_UNLOCKED` theo done_when + ca
  ghim `payload.reason === 'login_throttle'`; ghi nợ KI (timeline hiện `USER_UNLOCKED` cho tài khoản chưa
  từng `status='locked'`).
- `buckets` KHÔNG chứa `forgot`: khoá forgot **không chặn đăng nhập** — đưa vào sẽ làm badge “đang bị khoá
  đăng nhập” nói sai. Vẫn được **clear**.
- GET phơi trạng thái brute-force của mọi user trong tenant cho người giữ `unlock:user` — chấp nhận (cặp
  seed scope `Company`, `0450:53`), ghi ra để reviewer sau không tưởng là sót.
- FE: `staleTime` cho query throttle; **invalidate cả ở nhánh clear LỖI** (không thì badge giữ trạng thái cũ).

---

## 10. Kết quả thực thi (03/09) — số đo thật, không phải dự kiến

### 10.1 Đã ship

| Tầng | File | Nội dung |
| --- | --- | --- |
| Khoá | `common/valkey/valkey-key.ts` | `RlBucket += 'ip-index' \| 'forgot:ip-index'` (họ `rl:` ⇒ census phủ sẵn, 0 miễn trừ mới) |
| Valkey | `permission/valkey.service.ts` | `sMembers` + `ttl`, `assertKeysScoped` đứng TRƯỚC `if (!this.client)` |
| Limiter | `auth/login-rate-limiter.ts` | `normSlug` (dùng ở cả 4 builder + 2 chỉ mục) · `ipIndexKey` · `twoFactorKey` · `noteFailureSource` (CAP 64) · `clearLoginLocks` · `loginThrottleState` · `remainingLockSec` · `purgeMemoryLocks` |
| Auth | `auth/auth.service.ts` | `recordLoginFailure` + `forgotPasswordImpl` nuôi chỉ mục; `claimBlockedLogSlot` dùng `normSlug` |
| API | `users/auth-users.{service,controller}.ts` · `users.module.ts` | 2 route gate `unlock:user` (không `isSensitive`) · `requireRateLimiter` fail-fast · assert boot |
| Contracts | `contracts/src/auth/user-admin.ts` | `authUserLoginThrottleSchema` (`buckets: 'acct'\|'ip'\|'2fa'`, không `.default()`) |
| FE | `web-core/{auth-users-api,query-keys}.ts` · `app/.../UserDetailPage.tsx` · i18n | badge + nút TÁCH BẠCH nhãn với "Mở khoá"; query `enabled: canUnlock`; invalidate ở CẢ nhánh lỗi |
| Cổng | `apps/api/vitest.config.ts` · `apps/api/package.json` | khoá threshold + `--coverage.include` cho `login-rate-limiter.ts` (trước nay ngoài mọi cổng) |

**0 migration** — đúng như WO ràng buộc.

### 10.2 Test

- `login-rate-limiter.spec.ts`: **41 ca** (bảng ca chạy HAI cấu hình memory/Valkey).
- `auth-users.service.spec.ts`: **45 ca** (8 ca mới cho login-throttle).
- `auth-s18-unlock429-e2e.int-spec.ts`: **7 ca** dưới `LANE_DB=mediaos_s18unlock`.
- `UserDetailPage.spec.tsx`: **23 ca** (6 ca mới).
- Cổng `test:cov:sensitive` dưới LANE_DB: **1002 ca**, `login-rate-limiter.ts` = **100% stmts/lines/funcs · 98.97% branches** (ngưỡng chốt 95/95/90/95).

### 10.3 ĐỘT BIẾN — đo thật, không phải lời hứa

| Đột biến | Kết quả |
| --- | --- |
| Bỏ `accountKey` khỏi danh sách xoá (nhánh **Valkey**) | **1 ca ĐỎ** |
| Bỏ `accountKey` khỏi `exact` của `purgeMemoryLocks` (nhánh **memory**) | **1 ca ĐỎ** |
| Bỏ duyệt chỉ mục IP + bỏ quét tiền tố memory | **10 ca ĐỎ** |

⇒ hai nhánh có HAI vế xoá riêng, và mỗi vế được một ca đột biến riêng bắt. Bảng ca chạy một-nhánh sẽ
bỏ lọt đúng một nửa.

### 10.4 Phát hiện khi chạy thật — sửa lại giả định của chính plan

**"Trần tự nhiên" của §3.1 sai theo hướng NGƯỢC với dự đoán của reviewer, nhưng vẫn phải có CAP.**
Đo trên int-spec: sau lần sai thứ 5 từ **một** IP, bucket per-IP khoá ⇒ mọi lượt sau **từ chính IP đó**
`return` ở nhánh 429 TRƯỚC `recordLoginFailure` ⇒ không bump bucket tài khoản nữa. Muốn chạm ngưỡng 20
phải rải **≥4 nguồn** (ca `§acct` vì thế dùng 4 IP × 5, không phải 2 IP × 10). Nghĩa là mỗi IP đóng góp
tối đa ~5 lượt/cửa sổ — chỉ mục lớn chậm hơn plan lo, nhưng vẫn **không tự hết hạn** khi còn lượt sai
(TTL refresh mỗi `SADD`), nên `IP_INDEX_CAP` vẫn cần thiết.

**Ba mock `LoginRateLimiter` dựng tay** (`auth-status-guard.spec.ts`, `auth.service.spec.ts` ×2) vỡ khi
`recordLoginFailure` gọi thêm một method — 4 ca đỏ với `TypeError` chứ không phải assert. Đã bổ sung
`noteFailureSource` vào cả ba; đây là cái giá cố hữu của mock dựng tay theo hình dạng.

### 10.5 Giới hạn đã biết (ghi ra để không ai tưởng là bug mới)

- `INCR` thành công mà `SADD` hỏng **riêng lẻ** ⇒ IP đó vắng khỏi chỉ mục và không gỡ được bằng nút
  (tự lành sau `LOGIN_LOCKOUT_SEC`). Ca Valkey rớt HOÀN TOÀN — phổ biến hơn nhiều — đã phủ bằng memory.
- Vượt `IP_INDEX_CAP` (64 IP/cửa sổ cho một cặp `slug|email`): IP đến sau không gỡ được bằng chỉ mục;
  bucket `acct` — cái đang chặn ở đúng ca đó — vẫn luôn được gỡ.
- `USER_UNLOCKED` dùng lại cho hành động KHÔNG mở khoá tài khoản (WO chốt vậy). `event_type` không có
  CHECK nên một loại mới là khả thi, nhưng nó chạm `packages/contracts/src/auth.ts` — ngoài `paths`.
  Phân biệt bằng `payload.reason='login_throttle'`, có ca ghim. **Nợ KI.**
- GET phơi trạng thái bị brute-force của mọi user trong tenant cho người giữ `unlock:user` (cặp seed
  scope `Company`). Chấp nhận có ý thức — không phải sót vị từ scope.

---

## 11. FULL gate (03/09) — 2 BLOCK + 11 lỗi im lặng, đã vá

`security-reviewer` verdict **BLOCK**; `silent-failure-hunter` 11 phát hiện. Ba khẳng định của §9/§10 **sai**.

### 11.1 BLOCK-1 — `normSlug` có `.trim()`: khoá được tài khoản người khác + làm mù forensics

`companies.slug` citext **không** bỏ qua khoảng trắng, `loginSchema` không `.trim()`, `resolveCompanyId`
truyền slug THÔ. ⇒ `" acme"` là slug **không đăng nhập được** nhưng nếu trim ở builder khoá thì nó ghi
vào **đúng bucket của `acme`**: 5 request là khoá được nạn nhân 900s. Nặng hơn: nó chiếm suất
"1 hàng/cửa sổ" của khoá gộp, trong khi `resolveBlockedLogOwner` (slug thô) cho `company_id = NULL`
⇒ admin của tenant **không đọc được hàng nào** trong chính cửa sổ đang bị dò (`login_logs` append-only).
⇒ **Vá: `normSlug` CHỈ `toLowerCase()`.** Chuẩn hoá phải khớp CHÍNH XÁC phép so của DB, không rộng hơn.

### 11.2 BLOCK-2 — cặp non-sensitive gỡ được control 2FA

`unlock:user` là `is_sensitive=false` (mig 0450) ⇒ grant `*:*` thoả. Bucket `rl:2fa` là control DUY NHẤT
giới hạn dò TOTP bước-2, còn `reset-2fa:user` thì `isSensitive` — tức người giữ wildcard bị đường 2FA
chính danh TỪ CHỐI nhưng lại reset được ngưỡng qua nút mới. §9.2 mở bucket `2fa` mà không xét lại độ nhạy.
⇒ **Vá: `subject` chỉ được truyền khi actor qua được `can({reset-2fa:user, isSensitive:true})`**
(fail-closed; phần gỡ `ip`/`acct` vẫn chạy). 2 ca: deny + ALLOW đối chứng.

### 11.3 Lỗi im lặng đã vá

| # | Vấn đề | Vá |
| --- | --- | --- |
| F1 | `?? []` nuốt `sMembers` null ⇒ Valkey rớt ở đường ĐỌC thì báo "không bị khoá" **và nút gỡ biến mất** | `LoginThrottleState.unknown`; GET ném 503 khi `unknown && !locked`; FE hiện nút theo `locked \|\| isError` |
| F6 | Tràn `IP_INDEX_CAP` ⇒ 204 + audit `ok:true` với khoá còn sống. §9.3 nói "acct luôn được gỡ nên đủ" — **sai**: gỡ `acct` không mở khoá một IP đang giữ `:lock` riêng | marker `…\|capped`; clear thấy marker ⇒ `degraded` ⇒ 503 |
| M-1 | `after` **cấu trúc** không thấy bucket `ip` (chỉ mục đã bị xoá trước khi đọc lại) ⇒ cổng `ok` mù | verify `ttl` trên đúng các khoá `:lock` vừa xoá, NGAY trong `clearLoginLocks` |
| F2 | security event `USER_UNLOCKED` ghi cả khi gỡ THẤT BẠI | `payload.ok` |
| F3 | 503 hiện thành "lỗi hệ thống, thử lại sau" (khuyên SAI); chuỗi `loginThrottle.failed` là chuỗi CHẾT | map 503 → chuỗi riêng + ca FE |
| F4 | `mutationError` theo thứ tự cũ ⇒ lỗi 409 của nút "Khoá" bấm lúc trước NUỐT thông điệp 503 | đảo thứ tự + `onMutate` reset |
| F5 | `throttleQuery.isError` không bao giờ lộ ra | dòng cảnh báo + ca FE |
| M-2/F11 | log Valkey in NGUYÊN khoá `rl:*` (nhúng email + IP) | `redactKey()` — ns + độ dài |
| M-3 | `twoFactorKey` là bản sao thứ hai của khoá dựng tay ở `auth.service.ts:534` | `auth.service` dùng builder chung ⇒ một nguồn |
| F7 | WARN chạm trần không có chủ thể | thêm `slug` (KHÔNG email) |
| F10 | `if (!ip) return` lệch pha `recordFailure` ⇒ khoá vô hình | bỏ vế `!ip`; kèm `slice(0,64)` chống member do client định cỡ |
| F8 | comment quảng cáo assert boot quá lời | sửa comment: bảo đảm thật là ctor param không `@Optional()` |

**KHÔNG vá F9** (`securityEvents?.` vẫn `?.`): 6 call-site anh em đều vậy, đổi một chỗ đẻ bất đối xứng
khó nhớ hơn lỗi nó chặn; đã có assert boot cùng file.

**Perf ghi nhận (không vá):** `loginThrottleState` bắn tới `IP_INDEX_CAP` lệnh `ttl` tuần tự; ca thường
(chỉ mục ≤ 5 IP) là ~5 round-trip. Cần pipeline thì làm ở WO perf, không nhét vào WO an ninh.

### 11.4 Test sau vá

`login-rate-limiter.spec` 42 · `auth-users.service.spec` 49 · int-spec 7 (LANE_DB) · FE 25 —
**toàn bộ xanh**; typecheck api/app/contracts/web-core xanh.

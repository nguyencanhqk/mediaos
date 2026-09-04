# S18-AUTH-RESETCLEARS-1 — Đặt lại mật khẩu thành công thì gỡ luôn khoá đăng nhập 429

> **Wave:** S18-AUTH-LOCKOUT (3 WO). WO nền `S18-AUTH-UNLOCK429-1` đã merge (PR #472, commit `13219b1b`).
> WO này **tiêu thụ** hạ tầng đó: `clearLoginLocks` đã có, chỉ mục IP đã có, cổng coverage đã có.
> **0 migration. 0 cặp quyền mới. 0 route mới.**

---

## 1. Vấn đề — cơ chế chính xác

Người dùng gõ sai mật khẩu 5 lần ⇒ `LoginRateLimiter` khoá `rl:{env}:ip:…` (và `rl:{env}:acct:…` ở
ngưỡng tài khoản) trong `LOGIN_LOCKOUT_SEC`. Đường tự chữa **đúng** của họ là "Quên mật khẩu" →
đặt lại mật khẩu → đăng nhập lại.

Đường đó **không thông**: `AuthService.resetPassword` (`auth.service.ts:1506`) đổi hash, thu hồi
refresh token, thu hồi phiên, ghi audit + 2 security event — và **không chạm `rateLimiter` một dòng
nào**. Đo 03/09/2026: `grep -n "rateLimiter" auth.service.ts` không có kết quả nào trong thân
`resetPassword`.

Hệ quả đo được:

| Bước | Hôm nay |
| --- | --- |
| 5 lần sai ⇒ 429 | khoá `ip` (+ `acct` nếu nhiều IP) |
| "Quên mật khẩu" → email → đặt mật khẩu mới | **thành công**, mật khẩu đã đổi |
| Đăng nhập bằng mật khẩu MỚI | **vẫn 429** cho tới hết `LOGIN_LOCKOUT_SEC` |

Người dùng vừa chứng minh quyền kiểm soát hòm thư **và** đổi được mật khẩu, mà vẫn bị chặn bởi bộ
đếm dựng nên từ mật khẩu **cũ**. Cái khoá không còn bảo vệ gì: bí mật mà nó bảo vệ đã bị thay.

Đường thoát còn lại hôm nay: chờ hết TTL, hoặc gọi admin bấm nút của WO-1. WO này cắt phần lớn ca
phải gọi admin.

### 1.1 Ranh giới phạm vi — nói trước để review đo đúng

- **KHÔNG** nới `LOGIN_MAX_ATTEMPTS`, **KHÔNG** hạ `LOGIN_LOCKOUT_SEC`. Control chống brute-force
  giữ nguyên; WO chỉ mở đường **gỡ** cho người đã chứng minh danh tính.
- **KHÔNG** thêm `retryAfterSec` vào 429 (đó là `S18-AUTH-RETRYAFTER-1`).
- **KHÔNG** đụng FE. Không route mới, không contract mới, không i18n mới.
- **KHÔNG** viết bản thứ hai của `clearLoginLocks` (WO cấm tường minh).

---

## 2. Hai đường phải vá

| # | Đường | File | Ai là actor |
| --- | --- | --- | --- |
| A | Tự phục vụ — `POST /auth/reset-password` | `apps/api/src/auth/auth.service.ts` `resetPassword` | chính người dùng, chứng minh bằng token gửi qua email |
| B | Admin đặt lại hộ — `POST /auth/users/:id/password/reset` | `apps/api/src/users/auth-users.service.ts` `resetPassword` | admin có cặp SENSITIVE `reset-password:user` (mig 0476) |

Đường B đã trả `tempPassword` **một lần duy nhất** trong response. Nếu người dùng vẫn 429 sau khi
admin đặt lại hộ, admin phải bấm tiếp nút "Gỡ khoá đăng nhập" — hai thao tác cho một ý định.

---

## 3. Quyết định thiết kế (mỗi cái kèm lý do, không phải sở thích)

### D1 — `clearLoginLocks` nhận thêm tuỳ chọn `includeForgot`, KHÔNG viết hàm thứ hai

`clearLoginLocks` hiện xoá **cả** `forgot:ip` / `forgot:acct` / `forgot:ip-index`. Đường A **không
được** xoá chúng. Quyết định này đã ký từ trước, nguyên văn ở docblock `forgotPasswordImpl`
(`auth.service.ts:1387-1390`):

> rate-limit forgot dùng NAMESPACE RIÊNG (`rl:forgot:*`) — TÁCH HẲN bucket login … Trước đây dùng
> CHUNG ⇒ spam forgot cho email victim khoá luôn LOGIN của victim (DoS qua endpoint công khai).
> Bucket forgot tự HẾT HẠN theo TTL — **KHÔNG reset ở `resetPassword`**.

`rl:forgot:*` là control của một **endpoint công khai không cần xác thực**. Nếu đường A xoá nó thì
kẻ tấn công có một token reset hợp lệ (của chính hòm thư mình) sẽ tự cấp lại hạn mức forgot vô hạn
lần ⇒ endpoint công khai mất trần. Đường B thì khác: actor đã xác thực, đã qua cặp SENSITIVE, và
thao tác **đã** có hàng audit — đúng cùng lập luận WO-1 dùng để cho nút admin xoá `forgot:*`.

**Chữ ký mới:**

```ts
async clearLoginLocks(
  companySlug: string,
  email: string,
  subject?: LoginThrottleSubject,
  opts: { includeForgot?: boolean } = {},   // mặc định includeForgot = true
): Promise<ClearLoginLocksResult>
```

Mặc định `true` ⇒ **0 call-site cũ đổi hành vi** (nút admin của WO-1 giữ nguyên). Đường A truyền
`{ includeForgot: false }`.

Phải sửa **ba** chỗ trong hàm, không phải một — bỏ sót chỗ nào là gỡ nửa vời:

1. vòng `for (const family of ["login","forgot"])` → chỉ duyệt `["login"]` khi tắt;
2. danh sách `exact` cuối hàm — bỏ `LoginRateLimiter.forgotAccountKey(...)`;
3. `purgeMemoryLocks` — bỏ tiền tố `forgotKey(slug,email,"")` **và** `forgotAccountKey`. Bỏ sót chỗ
   này ⇒ nhánh Valkey giữ khoá forgot còn nhánh in-memory thì không: hai nhánh nói hai điều khác
   nhau, và test chạy nhánh nào cũng xanh.

Hệ quả `degraded`: khi tắt forgot, vòng lặp không đọc `sMembers`/marker của họ `forgot` ⇒ `degraded`
chỉ phản ánh họ `login`. Đúng ý: ta không hứa gì về forgot nên không được để nó bôi đen kết luận.

⚠️ `apps/api/src/auth/login-rate-limiter.ts` **không có trong `paths` của WO** (seed đo thiếu — mẫu
đã biết `wo-seed-hand-measurements-can-be-incomplete`). Thêm nó + `login-rate-limiter.spec.ts` vào
`paths` cùng commit; `harness/backlog.mjs` vốn đã nằm trong `paths`.

### D2 — TUYỆT ĐỐI không truyền `subject` ⇒ bucket `2fa` bước-2 KHÔNG bị gỡ ở cả hai đường

WO-1 đã ký (FULL gate HIGH-2, docblock `canClearTwoFactorBucket`): *"ai gỡ được 2FA của người khác
thì mới được gỡ khoá dò 2FA của họ"*. Đặt lại mật khẩu **không** chứng minh quyền kiểm soát yếu tố
thứ hai — đó chính là lý do 2FA tồn tại. `rl:2fa:{companyId}|{userId}` là control **duy nhất** giới
hạn dò mã TOTP ở bước-2 (10⁶ không gian).

Nếu đường A gỡ bucket `2fa`: kẻ chiếm được hòm thư (nhưng **không** có TOTP) đặt lại mật khẩu rồi tự
cấp lại 5 lượt dò TOTP mỗi lần reset — biến 2FA thành hình thức. Đây là **leo thang**, không phải
tiện ích.

Nếu đường B gỡ bucket `2fa`: `reset-password:user` không phải `reset-2fa:user`; gỡ ở đây là lách
đúng ranh giới WO-1 vừa dựng.

⇒ Cả hai đường gọi `clearLoginLocks(slug, email, undefined, …)`. Người bị khoá bước-2 vẫn có đường
riêng: `POST /auth/users/:id/login-throttle/clear` với cặp `reset-2fa:user`.

### D3 — Gọi SAU commit, chỉ khi `ok === true`, và **không bao giờ ném**

Vị trí: **ngoài** `withTenant` (WO ép, và lý do đúng: Valkey không transactional — DB rollback không
hoàn tác được `DEL`; gỡ trong tx rồi tx hỏng = khoá đã mất mà mật khẩu chưa đổi).

Fail-soft, `try/catch`, **không** ném ra ngoài. Lý do cụ thể cho từng đường:

- **A:** mật khẩu đã đổi và token đã đánh dấu `used_at` (single-use). Ném 5xx ở đây làm người dùng
  tưởng thất bại và bấm lại ⇒ lần hai chắc chắn "Token không hợp lệ hoặc đã hết hạn". Ta biến một
  thao tác **đã thành công** thành một ngõ cụt.
- **B:** `tempPassword` là plaintext trả **một lần duy nhất**, không lưu ở đâu. Ném sau commit =
  vứt mất mật khẩu tạm ⇒ admin phải reset lại lần nữa.

Đây **không phải** nuốt lỗi: nhánh lỗi ghi `logger.error` có cấu trúc (WO ghi email **đã che** —
`redactEmailFromDetail` đã có sẵn trong file cho đúng việc này), và cửa thoát vẫn còn nguyên hai
lớp: nút admin của WO-1 (trả 503 thật khi không gỡ được) + TTL tự hết.

**Không thêm hàng DB nào cho việc gỡ này.** Đã cân nhắc một `withTenant` thứ hai ghi
`USER_UNLOCKED{reason:'password_reset'}` sau commit; bác vì: (a) `lock-observability-rule` ràng buộc
đường **DỰNG** khoá phải để vết và đường **ĐANG KHOÁ** ghi 0 hàng — nó không đòi vết cho đường gỡ
kèm-theo; (b) hai đường này **đã** có hàng audit của chính thao tác reset (`auth.password_reset` /
`user.password_reset_by_admin`) và code luôn gỡ khi reset thành công, nên "có gỡ hay không" suy được
từ hàng đã có; (c) tx thứ hai sau commit đẻ thêm một cửa sổ hỏng trên đúng đường auth, đổi lấy giá
trị forensics mà log có cấu trúc đã phủ. **Điểm này ghi ra để plan-reviewer bác nếu thấy sai** —
nếu bác, phương án thay thế là ghi security event trong tx thứ hai, cũng bọc `try/catch`.

### D4 — `slug` + `email` đọc TỪ DB TRONG tx, không từ input

Khoá rate-limit nhúng `(slug, email)`. Lấy từ input là mở đường gỡ khoá của người khác.

- **A:** `resetPassword` hiện chỉ có `companyId` (bóc từ scoped token) và `row.userId` (từ hàng
  token). Cần **thêm trong tx**: `email` của user và `slug` của công ty. Đọc `users` theo `row.userId`
  và `SELECT slug FROM companies WHERE id = ... AND deleted_at IS NULL` — đúng khuôn
  `resolveThrottleTarget` (`auth-users.service.ts:471`).
- **B:** `target.email` đã có sẵn trong tx (`repo.findByIdTx`); chỉ cần thêm truy vấn `slug` vào
  chính tx đó.

Không có slug ⇒ **không gỡ** (log), **không đoán**: đoán sai nghĩa là gỡ khoá của người khác. Ở
đường A tuyệt đối không được biến "thiếu slug" thành lỗi reset — reset đã commit rồi.

Chuẩn hoá slug là việc của `LoginRateLimiter.normSlug` (đã có, **không** `trim()` — xem
`S18-AUTH-UNLOCK429-1.md` §9.1). Không chuẩn hoá tay ở call-site.

### D5 — Đường B dùng `requireRateLimiter()` (fail-fast TRƯỚC tx), không `?.`

`AuthUsersService` inject `rateLimiter` optional. `?.` no-op ở đây nghĩa là admin đặt lại mật khẩu
hộ mà khoá vẫn còn, âm thầm. Gọi `requireRateLimiter()` **ở đầu hàm, trước mọi mutation** ⇒ nếu DI
sai thì 500 sạch, 0 side-effect. `UsersModule` đã có assert boot cho đúng dependency này (WO-1) nên
nhánh này không đạt tới được ở PROD.

### D6 — Không thêm sàn thời gian cho `resetPassword`

`done_when` đòi "nhánh token hỏng giữ nguyên UNIFORM error + sàn thời gian" và "không tách được bằng
clear". Đo thật: `resetPassword` **chưa từng** có `applyUniformResponseFloor` (chỉ `forgotPassword`
có), và hai nhánh đã lệch nhau rất xa từ trước — nhánh token-đúng chạy argon2 hash (~100ms) + 5 lượt
ghi DB, nhánh token-sai chạy 1 `SELECT` rồi ném. Thêm một round-trip Valkey (~1ms) vào nhánh vốn đã
chậm gấp trăm lần **không tạo** kênh phân biệt mới.

Quan trọng hơn: đây **không phải oracle liệt kê** — để tới được nhánh này phải cầm sẵn một token
reset hợp lệ, tức đã kiểm soát hòm thư. Không có gì để liệt kê.

⇒ Không thêm sàn (thêm sàn là đổi hành vi một đường auth ngoài phạm vi WO, và cần hằng riêng). Thay
vào đó **đóng đinh bằng test hình dạng**: chuỗi lỗi của mọi nhánh token hỏng byte-giống nhau, và
`clearLoginLocks` **không** được gọi ở bất kỳ nhánh hỏng nào. Ghi số đo vào §7 sau khi chạy.

---

## 4. Bản vá — hình dạng code

### 4.1 `AuthService.resetPassword`

`withTenant` đang trả `boolean`. Đổi thành trả `{ slug, email } | null` (`null` = token hỏng).

```
const target = await this.dbsvc.withTenant(companyId, async (tx) => {
  … kiểm token như cũ; hỏng ⇒ return null …
  … đọc user row (email) + slug công ty TRONG tx …
  … toàn bộ update/audit/security-event giữ NGUYÊN …
  return { slug, email };
});

if (!target) throw new UnauthorizedException("Token không hợp lệ hoặc đã hết hạn.");  // chuỗi Y HỆT

// SAU commit. Không ném. Không đổi kết quả của reset.
try {
  await this.rateLimiter.clearLoginLocks(target.slug, target.email, undefined, {
    includeForgot: false,
  });
} catch (err) { /* logger.error, email đã che */ }
```

Bất biến giữ nguyên: chuỗi `UnauthorizedException` **không đổi một byte**; thứ tự ghi trong tx không
đổi; `revokeAllSessionsForUserTx` + 2 security event không đổi.

### 4.2 `AuthUsersService.resetPassword` (admin)

```
const limiter = this.requireRateLimiter();          // TRƯỚC mọi mutation
if (actor.id === id) throw …                        // self-guard giữ nguyên
const result = await this.db.withTenant(…, async (tx) => {
  … như cũ … + đọc slug công ty trong tx
  return { …dto, slug, email: target.email };
});
try { await limiter.clearLoginLocks(result.slug, result.email, undefined); } catch { /* log */ }
return { tempPassword, revokedSessionCount };
```

Đường B **có** gỡ `forgot:*` (mặc định) — cùng lập luận WO-1: đã xác thực + đã audit.

---

## 5. Test (RED trước)

### 5.1 Unit — `login-rate-limiter.spec.ts` (+)

| Ca | Đóng đinh |
| --- | --- |
| `includeForgot:false` ⇒ `forgot:ip` + `forgot:acct` + `forgot:ip-index` **CÒN NGUYÊN**, `ip`/`acct` đã sạch | D1 |
| `includeForgot` mặc định ⇒ forgot **bị xoá** (ca đối chứng — thiếu nó ca trên xanh-rỗng khi hàm không xoá gì cả) | D1 |
| Nhánh **in-memory** (`useValkey=false`) `includeForgot:false` ⇒ `attempts` của forgot còn, của login sạch | D1.3 |
| Không truyền `subject` ⇒ khoá `2fa` **còn nguyên** (ca đối chứng: truyền subject ⇒ mất) | D2 |

### 5.2 Unit — `auth.service.spec.ts` (+)

- token đúng ⇒ `clearLoginLocks` gọi **đúng 1 lần** với `(slug, email, undefined, {includeForgot:false})`
  — ghim cả 4 đối số (thiếu `undefined` = lộ bucket 2fa, thiếu opts = mất trần forgot).
- **ba** ca token hỏng (không tồn tại · hết hạn · `used_at` đã set) ⇒ `clearLoginLocks` **không được
  gọi**, và chuỗi lỗi ba ca giống hệt nhau.
- `clearLoginLocks` ném ⇒ `resetPassword` vẫn resolve (không ném ra ngoài) — **đột biến:** bỏ
  `try/catch` ⇒ ca này ĐỎ.
- slug không đọc được ⇒ không gọi limiter, không ném.

### 5.3 Unit — `auth-users.service.spec.ts` (+)

- admin reset thành công ⇒ `clearLoginLocks(slug, email, undefined)` (KHÔNG opts ⇒ forgot bị xoá).
- target 404 / tự-reset-mình ⇒ **không** gọi.
- thiếu DI limiter ⇒ ném **trước** khi chạm DB (0 audit, 0 update).

### 5.4 Integration (LANE_DB) — `test/integration/auth-s18-resetclears-e2e.int-spec.ts`

Đi **qua HTTP thật**, không gọi service trực tiếp:

1. **Ca chính:** 5 lần login sai ⇒ `429` → `POST /auth/forgot-password` → lấy token → 
   `POST /auth/reset-password` → login bằng mật khẩu MỚI ⇒ **`200` NGAY**, không chờ TTL.
2. **Ca 2 IP (bucket `acct`):** sai từ hai IP tới ngưỡng tài khoản ⇒ 429 → reset ⇒ login `200`.
   **Đột biến:** bỏ vế xoá `accountKey` ⇒ ca này ĐỎ.
3. **Ca token hỏng ×3:** khoá **còn nguyên** sau mỗi ca (đọc lại qua
   `GET /auth/users/:id/login-throttle` bằng admin — dùng chính đường quan sát của WO-1).
   **Đột biến:** gọi clear vô điều kiện ⇒ ĐỎ.
4. **Ca trần forgot còn giữ:** sau khi reset tự phục vụ thành công, endpoint `forgot-password` vẫn
   đếm tiếp (không được cấp lại hạn mức). **Đột biến:** bỏ `includeForgot:false` ⇒ ĐỎ.
5. **Ca admin:** admin `POST /auth/users/:id/password/reset` trên user đang 429 ⇒ login bằng
   `tempPassword` `200` ngay; `GET …/login-throttle` báo `locked:false`.

### 5.5 Cổng

- `login-rate-limiter.ts` đã nằm trong `test:cov:sensitive` với khoá 95/95/90/95 (WO-1) — **không
  được tụt**. `auth.service.ts` giữ ngưỡng hiện hành.
- `bash harness/check.sh --all --lane-db=s18reset` XANH (int-spec deny-path chạy THẬT, không skip).
- `pnpm typecheck` api + contracts xanh (không đụng FE).

---

## 6. Thứ tự thực thi

1. `paths` của WO += `login-rate-limiter.ts` + spec (`harness/backlog.mjs`).
2. RED: viết §5.1 + §5.2 + §5.3 trước khi sửa code sản phẩm.
3. `clearLoginLocks` += `opts` (3 chỗ) → GREEN §5.1.
4. Đường A (`auth.service.ts`) → GREEN §5.2.
5. Đường B (`auth-users.service.ts`) → GREEN §5.3.
6. Int-spec §5.4 trên `LANE_DB=mediaos_s18reset`, chạy **cả 4 đột biến** để chứng minh test không rỗng.
7. FULL gate: `security-reviewer` + `silent-failure-hunter` trên diff.
8. `check.sh --all --lane-db=s18reset` → PR (vùng đỏ, **không** auto-merge).

---

## 7. Rủi ro đã nhận diện

| # | Rủi ro | Xử |
| --- | --- | --- |
| R1 | Gỡ khoá theo email ⇒ ai đó reset mật khẩu của **mình** để gỡ khoá **người khác** | Khoá nhúng `(slug,email)` của **chính** user vừa reset, đọc từ DB trong tx (D4). Không có tham số nào do người gọi điều khiển. |
| R2 | Xoá `forgot:*` ⇒ mất trần endpoint công khai | D1 — đường A tắt tường minh + ca int-spec §5.4-4 đóng đinh. |
| R3 | Gỡ bucket `2fa` ⇒ 2FA thành hình thức | D2 — không truyền `subject`; ca đối chứng §5.1. |
| R4 | Ném sau commit ⇒ mất `tempPassword` / token đã dùng | D3 — fail-soft + log; ca §5.2 đột biến bỏ `try/catch`. |
| R5 | `degraded` bị nuốt ⇒ tưởng đã gỡ | Đường này **không** hứa 204 với ai; kết quả `degraded` ghi vào log, cửa thoát 503 thật vẫn nằm ở nút admin WO-1. |
| R6 | Đổi `withTenant` từ `boolean` sang object làm lệch spec cũ của `resetPassword` | Chuỗi lỗi + thứ tự ghi giữ nguyên byte; chạy toàn bộ `auth.service.spec.ts` + `auth-reset-password*.int-spec` hiện có. |
| R7 | Ba mock `LoginRateLimiter` dựng tay sẽ vỡ khi đổi chữ ký | Đã biết từ WO-1 (friction #3). `opts` có mặc định ⇒ mock cũ vẫn khớp kiểu; chỉ spec nào **assert đối số** mới phải cập nhật. |

---

## 8. Bản vá kế hoạch sau review đối kháng (03/09) — **áp dụng, thay thế phần tương ứng ở trên**

`plan-reviewer` trả **BLOCK** với 6 điểm chặn. Đã xác minh lại từng bằng chứng bằng đọc code, không
nhận vo. Bốn điểm cần người chốt đã hỏi owner và **owner duyệt cả bốn theo khuyến nghị** (03/09).

### 8.1 ✅ owner duyệt — B5: chỉ GÁC lời gọi clear, KHÔNG siết `WHERE` của UPDATE

R1 của §7 nói sai. Unique trên `users` là **partial**: `(company_id, normalized_email) WHERE
deleted_at IS NULL` (`auth-users.service.ts:583-585`) ⇒ email của một user **đã xoá mềm** có thể đã
được cấp lại cho người khác. `resetPassword` hiện **không** lọc `deleted_at`
(`auth.service.ts:1521-1524`) và `RESET_TOKEN_TTL_SEC = 3600`, nên một token còn sống của user đã xoá
sẽ gỡ khoá đăng nhập của **người đang dùng email đó**.

**Chốt:** đọc `deletedAt` cùng lượt ghi; `deletedAt !== null` ⇒ **không gọi** `clearLoginLocks`.
`resetPassword` giữ nguyên 200 y như hôm nay — **0 đổi hành vi auth**. Việc "user xoá mềm vẫn đặt lại
được mật khẩu" là **nợ CŨ có trước WO này**, ghi vào §9 + handoff, KHÔNG vá ở đây (siết `WHERE` sẽ
đổi 200 → 401 trên một đường auth ngoài phạm vi).

### 8.2 ✅ owner duyệt — B4: ghi vết CHỈ khi gỡ THẤT BẠI, ở CẢ HAI đường

Câu (b) của D3 **sai** và bị rút: `clearLoginLocks` trả `degraded=true` đúng ở những ca gỡ **không**
thành công (`login-rate-limiter.ts:355` `sMembers===null` · `:367-370` marker tràn trần còn sống ·
`:381` `del` false · `:384-386` `:lock` per-IP vẫn còn sau khi xoá). Ở đúng những ca đó, hàng
`auth.password_reset` / `user.password_reset_by_admin` hàm ý "vào lại được ngay" trong khi khoá còn
sống ⇒ **không** suy ra được "có gỡ hay không" từ hàng đã có.

**Chốt:**
- `ok = !result.degraded`. Không đọc lại `loginThrottleState` sau clear — phép verify per-IP **đã nằm
  trong** `clearLoginLocks` (`:383-386`), và không có đường 503 nào ở đây để tiêu thụ thêm một lượt đọc.
- `!ok` ⇒ `withTenant` **thứ hai** (sau commit, bọc `try/catch`) ghi `audit user.login_throttle_cleared`
  + `securityEvents USER_UNLOCKED{reason:'password_reset', ok:false}`. Đường A dùng `actorUserId =
  userId` (khuôn `auth.password_reset`), đường B dùng `actorUserId = actor.id`.
- `ok` ⇒ **không** ghi hàng nào (tránh bồi `USER_UNLOCKED` cho tài khoản chưa từng bị khoá — món nợ
  WO-1 đã ghi ở §10.5).
- **Cả hai** đường log `logger.error` khi `degraded`, ở **mọi** ca.
- **Giới hạn ghi ra:** `degraded` không verify lại bucket `acct` (chỉ verify per-IP). Nút admin của
  WO-1 — có `after = loginThrottleState` + 503 — vẫn là đường phán quyết chuẩn.

### 8.3 ✅ owner duyệt — B6: sửa `done_when` #6, KHÔNG thêm sàn thời gian

Đo thật: `resetPassword` (`auth.service.ts:1506-1558`) **chưa từng** gọi `applyUniformResponseFloor`
(sàn chỉ có ở `forgotPassword`, `:1372-1381`). Nhánh token-sai = 1 `SELECT` rồi ném (`:1518`); nhánh
token-đúng = argon2 (`:1520`) + 5 lệnh ghi. Đã lệch hàng trăm lần **trước** WO này.

**`done_when` #6 thay bằng ba ràng buộc đo được:** (1) ba nhánh token hỏng trả chuỗi lỗi **byte-giống
nhau**; (2) `clearLoginLocks` **không** được gọi ở bất kỳ nhánh hỏng nào; (3) ghi số đo **p50/p95**
hai nhánh vào §9 **trước khi mở PR**. Không thêm sàn (thêm sàn = đổi hành vi một đường auth ngoài
phạm vi + cần hằng riêng).

### 8.4 ✅ owner duyệt — M3(b): thêm ĐÚNG một dòng invalidate ở FE

`UsersPage.tsx:203-214` — `resetPasswordMutation.onSuccess` chỉ gọi `invalidateList()`
(`authUsersKeys.all`), **không** chạm `authUsersKeys.loginThrottle(id)` (`query-keys.ts:80`), mà badge
"Đang bị khoá đăng nhập" đọc query đó với `staleTime 15_000` (`UserDetailPage.tsx:301-306`). Không vá
thì WO ship xong giao diện vẫn nói người dùng đang bị khoá — tự mâu thuẫn với chính thứ WO vừa sửa.

`queryClient` đã có sẵn trong file (`:98`). `paths` += `apps/app/src/routes/system/UsersPage.tsx`
+ `apps/app/src/routes/system/**/*.spec.tsx`.

### 8.5 B1+B2 — ca `acct` của int-spec: **≥4 IP × 5 lượt**, gọi `login()` TRỰC TIẾP

§5.4-2 viết sai hai lần, cùng một sai lầm WO-1 đã đo và bác:

- **Số IP:** `login()` `return` 429 **trước** `recordLoginFailure` (`auth.service.ts:253-256`) ⇒ mỗi IP
  đóng góp tối đa `LOGIN_MAX_ATTEMPTS = 5` lượt vào bucket `acct`, mà ngưỡng `acct` là
  `LOGIN_ACCOUNT_MAX_ATTEMPTS = 20` (`env.schema.ts:119`). **2 IP không bao giờ khoá được `acct`** ⇒ ca
  xanh-rỗng và đột biến "bỏ vế xoá `accountKey` ⇒ ĐỎ" sẽ KHÔNG đỏ. Sửa: **4 IP × 5**
  (`auth-s18-unlock429-e2e.int-spec.ts:14` đã ghi đúng con số này).
- **Đường gọi:** ca nhiều-IP **không thể** đi qua HTTP — `req.ip` sau supertest là hằng số, và bật
  `trust proxy` trong test là đo một app **cấu hình khác production**
  (`auth-s18-unlock429-e2e.int-spec.ts:17-19`). Sửa: ca 1/3/4/5 qua HTTP (supertest); **ca `acct` gọi
  `auth.login(..., {ip})` trực tiếp**.

### 8.6 B3 — `requireRateLimiter()` làm 4 ca hiện có ĐỎ; self-guard phải đứng TRƯỚC

Năm chỗ dựng `AuthUsersService` **không** truyền tham số thứ 9: `auth-users.service.spec.ts:100`
(beforeEach) · `:190` · `:322` · `:374` · `:463`. Bốn ca gọi `resetPassword`: `:461`, `:509`, `:515`
(mong `BadRequestException`), `:524` (mong `NotFoundException`). R7 nói *"chỉ spec nào assert đối số
mới phải cập nhật"* — **sai**.

**Sửa §4.2:** `if (actor.id === id) throw CANNOT_RESET_SELF` giữ **NGUYÊN vị trí đầu hàm**,
`requireRateLimiter()` đứng **sau** nó (giữ nguyên byte thứ tự lỗi 400). Thêm mock `rateLimiter` vào
5 chỗ dựng.

### 8.7 H1 — `opts` là tham số **BẮT BUỘC**, không có mặc định

Mặc định `includeForgot: true` là fail-**open** đúng với cái trần nó bảo vệ: `rl:forgot:*` gác một
endpoint **công khai không xác thực** (`auth.service.ts:1388-1391`), và call-site tương lai quên
`opts` sẽ mở trần trong im lặng — không cổng nào bắt.

**Chốt:** `opts: { includeForgot: boolean }` **không default** ⇒ TypeScript ép **mọi** call-site khai
ý định; quên = lỗi **biên dịch**, không có đường trượt im lặng. Chi phí: sửa ~10 lời gọi trong
`login-rate-limiter.spec.ts` + 1 ở `auth-users.service.ts:437` — đều trong `paths`.

### 8.8 H2 — nội dung `catch` viết tường minh, và test phải assert **logger.error**

`ValkeyService` mọi method đều "Never throws" (`valkey.service.ts:89-98, 216-268`), `purgeMemoryLocks`
là duyệt `Map` thuần ⇒ thứ thật sự ném được là `ValkeyKeyScopeError` (bug namespace khoá) hoặc
`TypeError` khi field DI vắng. Một `catch` rỗng ở đây chỉ có tác dụng **giấu bug** (mẫu
`tests-can-pin-a-hole-open`), và §4.1 đang viết `catch (err) { /* comment */ }` — rất dễ ship thành
`catch {}`.

**Chốt:** thân catch viết rõ trong plan:
`this.logger.error("<đường>: gỡ khoá đăng nhập thất bại (mật khẩu ĐÃ đổi)", redactEmailFromDetail(detail, email))`
(`redactEmailFromDetail` có sẵn, dùng ở `auth.service.ts:1460`). Ca §5.2 **assert `logger.error` được
gọi**, không chỉ `resolves` — `catch {}` rỗng ⇒ ĐỎ.

### 8.9 H3 — dùng `.returning()`, cấm `try/catch` TRONG tx

`try/catch` bên trong `withTenant` là bẫy PG 25P02: statement lỗi đã abort tx ⇒ mọi lệnh sau ném ⇒
`resetPassword` 500 và mật khẩu **không** đổi. "Không có slug" phải là ca **0 hàng**, không phải ca catch.

**Chốt:** (i) `email` + `deletedAt` lấy bằng `.returning({ email: users.email, deletedAt:
users.deletedAt })` trên `UPDATE users` **đã có** (`:1521-1524`) — bớt một điểm hỏng **và** giải luôn
§8.1; (ii) `SELECT slug` đặt **sau** mọi lệnh ghi, không bọc `try/catch`, `rows.length === 0 ⇒
target = null`.

### 8.10 Sửa các tiền đề sai còn lại

- **M2 — lệch một nhịp:** lần sai thứ **5** trả 401 (lock đặt tại `login-rate-limiter.ts:238-241`),
  lần thứ **6** mới 429 (`auth.service.ts:253-256`). Mọi chỗ viết "5 lần sai ⇒ 429" ở §1/§5.4 đọc là
  "5 lần sai ⇒ khoá; lần thứ 6 ⇒ 429". Ca chính §5.4-1 phải dùng target **không bật 2FA** (nếu bật,
  login trả challenge chứ không phải `200`).
- **M1 — lấy reset token:** đọc `outbox_events` rồi `auth.decryptResetToken(...)`, khuôn
  `auth-reset-deny-path.int-spec.ts:107-119`. Cần KEK trong env (mẫu `worktree-missing-kek-false-red`).
- **M3(a) — `paths` += `apps/api/vitest.config.ts`:** ngưỡng per-file đang ghim `auth.service.ts`
  80/80/80/80 (`:195-200`) và `login-rate-limiter.ts` 95/95/90/95 (`:259-264`); WO thêm nhánh vào **cả
  hai** ⇒ phải đo lại trước PR (mẫu `coverage-threshold-key-typo-is-dead-gate`).
- **M4 — cửa sổ commit→clear:** lượt sai mới có thể dựng lại khoá rồi bị xoá. Vô hại (ý định vốn là
  xoá). **Không** thêm "đọc lại state sau clear". Ghi ra để review sau không tưởng là sót.
- **M5 — diff phải ADDITIVE:** nghiệm thu `git diff` khối `withTenant` của `resetPassword`
  (`:1520-1554`) **không có dòng `-` nào** ngoài chính dòng `.where(...)` được thay bằng
  `.where(...).returning(...)` và `return false/true` → `return null/target` (mẫu
  `plan-pseudocode-body-reverts-fixes`).
- **L1 — `clearedKeys`** là số khoá **gửi** cho `DEL`, không phải số đã xoá (`:387`). Không log nó như
  "đã xoá N khoá".
- **L2 — §5.1 ca "không truyền `subject`"** trùng ca đã có của WO-1; giữ nhưng không tính là ca mới.
  Giá trị thật nằm ở §5.2/§5.3 (ghim đối số tại call-site).

### 8.11 `paths` chốt lại (cập nhật `harness/backlog.mjs` cùng commit)

Thêm so với seed: `apps/api/src/auth/login-rate-limiter.ts` · `apps/api/vitest.config.ts` ·
`apps/app/src/routes/system/UsersPage.tsx` · `apps/app/src/routes/system/**/*.spec.tsx`.
**Không** cần: `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` (0 route mới) ·
`packages/contracts` (0 DTO mới).

---

## 9. Kết quả thực thi (03/09) — số đo thật, không phải dự kiến

### 9.1 Đã ship (0 migration · 0 route mới · 0 cặp quyền mới · 0 DTO mới)

- **`login-rate-limiter.ts`** — `ClearLoginLocksOptions { includeForgot: boolean }` **không có mặc
  định** (§8.7): quên khai = lỗi biên dịch. Cờ áp ở đúng **ba** chỗ — vòng `families` · danh sách
  `exact` · `purgeMemoryLocks` — nên nhánh Valkey và nhánh in-memory nói cùng một điều.
- **`auth.service.ts`** — `resetPassword` trả `{userId,email,deletedAt,slug}` thay `boolean`;
  `email`+`deletedAt` lấy bằng `.returning()` trên chính câu UPDATE đã có, `slug` đọc **sau** mọi lệnh
  ghi, không `try/catch` trong tx. Hai helper mới: `clearLoginLocksAfterReset` (gỡ, `includeForgot:
  false`, `subject: undefined`) và `recordFailedLockClear` (ghi vết **chỉ khi** thất bại).
- **`auth-users.service.ts`** — `requireRateLimiter()` **sau** self-guard (giữ nguyên byte thứ tự lỗi
  400), slug đọc trong tx, gỡ sau commit với `includeForgot: true`; `recordFailedLockClear` song song.
  `Logger` mới cho class này (trước nay không có).
- **FE** — `UsersPage.tsx` invalidate thêm `authUsersKeys.loginThrottle(user.id)` (đúng một dòng).
- **Cổng** — int-spec mới thêm vào `test:cov:sensitive`; `paths` của WO += 5 file seed đo thiếu.

### 9.2 Test

| Tầng | Số ca | Kết quả |
| --- | --- | --- |
| `login-rate-limiter.spec.ts` | 44 (33 cũ + 1 mới ×2 nhánh) | XANH |
| `auth.service.spec.ts` | 27 (16 cũ + 11 mới) | XANH |
| `auth-users.service.spec.ts` | 57 (49 cũ + 8 mới) | XANH |
| `UsersPage.spec.tsx` (FE) | 15 (14 cũ + 1 mới) | XANH |
| `auth-s18-resetclears-e2e.int-spec.ts` (LANE_DB) | 6 | XANH |
| `test:cov:sensitive` (LANE_DB) | 1014 | XANH — `login-rate-limiter.ts` **100/98.33/100/100** (sàn 95/95/90/95) · `auth.service.ts` **85.82/84.10/88.37/85.82** (sàn 80) |

**KHÔNG ca cũ nào bị xoá:** đếm `it(`/`it.each(` trước→sau: limiter 33→34 · auth.service 16→24 ·
auth-users 49→57.

### 9.3 ĐỘT BIẾN — đo thật, mỗi vế một lần

| # | Đột biến | Ca ĐỎ |
| --- | --- | --- |
| U1 | vòng `families` luôn gồm `forgot` | 1 |
| U2 | `exact` luôn gồm `forgotAccountKey` | 2 |
| U3 | `purgeMemoryLocks` luôn gồm tiền tố `forgot` | 1 |
| U4 | bỏ gác `deletedAt` (user xoá mềm vẫn gỡ khoá) | 1 |
| U5 | `includeForgot: false` → `true` ở đường A | 1 |
| U6 | bỏ ghi vết khi `degraded` | 1 |
| U7 | bỏ `logger.error` ở nhánh `degraded` (nhánh KHÔNG ném) | 1 |
| U8 | bỏ `logger.warn` ở nhánh thiếu slug | 1 |
| U9 | gộp `deletedAt` vào chung nhánh cảnh báo (bồi log nhiễu) | 1 |
| U10 | bỏ nhánh cảnh báo thiếu slug ở đường B | 1 |
| I1 | `includeForgot: true` ở đường A | §forgot |
| I2 | truyền `subject` (gỡ luôn bucket `2fa`) | §2fa |
| I3 | bỏ vế xoá `accountKey` trong `clearLoginLocks` | §acct |
| F1 | bỏ dòng invalidate `loginThrottle` ở FE | 1 |

14/14 đột biến ĐỎ đúng ca nó nhắm, khôi phục XANH lại đủ. Không ca nào xanh-rỗng.

### 9.4 Số đo p50/p95 — ràng buộc thay cho “sàn thời gian” (done_when #6, plan §8.3)

`POST /auth/reset-password`, n=25 mỗi nhánh, LANE_DB `mediaos_s18reset`, cùng một máy/cửa sổ:

| Nhánh | TRƯỚC bản vá | SAU bản vá |
| --- | --- | --- |
| token SAI | p50 **6ms** · p95 **18ms** | p50 **6ms** · p95 **18ms** |
| token ĐÚNG | p50 **29ms** · p95 **39ms** | p50 **30ms** · p95 **54ms** |

Đọc số: nhánh token-ĐÚNG **đã** chậm hơn nhánh token-SAI ~**5 lần** ở p50 **trước** WO này (argon2 +
5 lệnh ghi vs 1 `SELECT` rồi ném). Round-trip Valkey thêm vào đóng góp **~1ms ở p50** (29→30) — nằm
gọn trong nhiễu, và không đổi bậc độ lớn của khoảng cách vốn có. p95 lệch nhiều hơn (39→54) là nhiễu
theo lượt trên máy đang chạy việc khác, không phải chi phí cấu trúc.

Kết luận đã ký: **không thêm sàn**. Đây không phải oracle liệt kê — để tới được nhánh chậm phải cầm
sẵn một token reset hợp lệ, tức đã kiểm soát hòm thư; không có gì để liệt kê. Ràng buộc thay thế đã
thi công: ba nhánh token hỏng trả chuỗi lỗi **byte-giống nhau** (ca test so `new Set(messages).size
=== 1`) và `clearLoginLocks` **không** được gọi ở bất kỳ nhánh hỏng nào.

### 9.5 FULL gate

- **`security-reviewer`: PASS**, 0 CRITICAL / 0 HIGH. Ba control mà WO này có thể phá — bucket
  `rl:2fa`, trần `rl:forgot:*` của endpoint công khai, và không gian khoá của người khác — đều được
  chứng minh còn nguyên **bằng test chạy thật trên Postgres + Valkey**, không bằng lập luận. Xác minh
  độc lập: `audit_logs_object_type_chk` **có** `user` (⇒ 0 migration là đúng); truy vấn sau full int
  run cho **0 hàng** `action='user.login_throttle_cleared'` ⇒ ca thành công không bồi rác.
  - LOW đã vá: hai `catch` của đường admin giờ dùng `redactEmailFromDetail` + giữ `stack` (mirror
    đường A) — khoá `rl:*` nhúng email nên đây là chỗ email dễ trôi vào log nhất.
  - LOW đã vá: int-spec mới thêm vào `test:cov:sensitive`.
  - MEDIUM **là ảnh cũ** (đo lúc 14:05, vá lúc 14:2x): hai assert `expect(warn)` đã có ở
    `auth.service.spec.ts`, và đột biến U8/U9 chứng minh chúng chịu lực.
- **`silent-failure-hunter`: BLOCK → đã vá cả 3.** (1) nhánh `degraded` **không ném** trước đây chỉ
  ghi audit ⇒ log/APM im lặng đúng lúc bất thường nhất — nay `logger.error` ngay tại nhánh, ở **cả
  hai** đường (đúng chữ §8.2 đã ký); (2) nhánh thiếu `slug` im lặng tuyệt đối, mà đó là ca "không gỡ
  vì **chưa từng thử gỡ**" — ít dấu vết hơn cả ca Valkey chập chờn — nay tách khỏi `deletedAt` và
  `logger.warn`; (3) spec đường admin không có spy logger ⇒ đổi `catch (err) { log; … }` thành
  `catch { … }` vẫn xanh — nay có spy + assert.

### 9.6 Giới hạn đã biết (ghi ra để không ai tưởng là bug mới)

1. **`degraded` không verify lại bucket `acct`** — `clearLoginLocks` chỉ đọc lại `:lock` per-IP. Nút
   admin của WO-1 (có `after = loginThrottleState` + 503) vẫn là đường phán quyết chuẩn.
2. **`degraded` có thể bị bên ngoài tác động ở đường tự phục vụ**: marker "chỉ mục IP tràn trần" dựng
   khi đủ 64 IP phân biệt gõ sai cho `(slug,email)`, và marker đó ép `degraded=true` ⇒ mỗi lần nạn
   nhân reset thành công sẽ đẻ một `USER_UNLOCKED{ok:false}` + một hàng audit **dù việc gỡ đã chạy
   đúng**. Không khuếch đại (1 hàng/lần reset, bản thân reset đã ghi ~4 hàng) nên không phải lỗ —
   nhưng dashboard nào đọc `ok:false` là "gỡ khoá hỏng" thì đếm được từ ngoài.
3. **Hàng `user.login_throttle_cleared` giờ có HAI hình dạng**: của WO-1 (actor = admin, có `before`)
   và của WO này (actor = chính user ở đường A, không `before`). Discriminator duy nhất là
   `after.reason='password_reset'` ⇒ báo cáo đếm "admin đã gỡ khoá" theo mỗi `action` sẽ đếm **dư**.
4. **Nợ CŨ, KHÔNG vá ở đây (owner chốt §8.1):** user đã xoá mềm vẫn **đặt lại được mật khẩu** —
   `resetPassword` không lọc `deleted_at` ở câu UPDATE. WO này chỉ chặn phần của mình (không gỡ khoá
   cho hàng đã xoá mềm). Siết `WHERE` sẽ đổi 200 → 401 trên một đường auth, cần WO riêng.
5. **Bucket `2fa` không được gỡ ở cả hai đường** (D2, cố ý). Người bị khoá bước-2 vẫn phải đi đường
   admin `POST /auth/users/:id/login-throttle/clear` với cặp SENSITIVE `reset-2fa:user`.

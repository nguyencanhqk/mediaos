# S18-AUTH-490DEBT-1 — Trả 3 nợ FULL-gate của #490

> **Zone:** 🔴 crown (AUTH) · **Gate:** FULL · **Người chốt:** bắt buộc · **auto-merge:** KHÔNG
> **Nguồn:** `docs/plans/S18-AUTH-RESTORE2FA-1.md` §8 (nợ 2 · 7 · 8) + §9 (FULL gate 09/09/2026:
> MEDIUM-2 · MEDIUM-3 · LOW log-context)
> **Owner chốt 11/09/2026:** §8.2 vá ĐỦ · §8.7 phát `TOTP_RESET` có điều kiện · §8.8 làm luôn
> **Phiên bản:** **v3 — `plan-reviewer` PASS, được phép thi công.** v1 → BLOCK (C1–C4, H1–H4, M1–M6);
> v2 → BLOCK (B1–B5, W1–W5); v3 → **PASS**. Mọi phát hiện của reviewer đều được **đo lại trên code**
> trước khi nhận, không tin lời review suông.

---

## 0. Vì sao ba khoản này là nợ, không phải bỏ sót

Cả ba đều do `security-reviewer`/`silent-failure-hunter` nêu trong FULL gate của #490 và đều bị
**chuyển thành nợ** vì mỗi khoản **đảo một quyết định owner đã ký trong chính WO đó**:

| Nợ | Quyết định bị đảo | Owner chốt 11/09 |
| --- | --- | --- |
| §8.2 | D1.d — nhánh `account_gone` "cố ý KHÔNG `recordFailure`" | **Vá ĐỦ**: limiter cho `enroll` + `recordFailure` ở `account_gone` |
| §8.7 | §4 D3 — "không thêm hàng thứ ba" ở `restoreUser` | **Phát `TOTP_RESET` CHỈ KHI `twoFactorWasEnabled`** |
| §8.8 | (không đảo gì — LOW, có trước #490) | **Làm luôn**, vì §8.2 đã mở đúng hai file đó |

WO này KHÔNG mở lại ba quyết định ấy. Nó thi công đúng điều đã chốt và ghim lại bằng cổng.

---

## 1. Lỗ — số đo trên master `e953de13` (11/09/2026)

### (L1) §8.2 — nhánh từ chối 2FA bồi hàng `audit_logs` không trần

`apps/api/src/auth/two-factor.service.ts`:

| Điểm | Dòng | Ghi gì | Counter chặn |
| --- | --- | --- | --- |
| `enroll` nhánh `account_gone` | `:190-198` | 1 hàng `auth.2fa_enroll_denied` | **KHÔNG CÓ** — `enroll` không có `rlKey`/`isLocked`/`recordFailure` nào |
| `confirmEnable` nhánh `account_gone` | `:277-285` | 1 hàng `auth.2fa_enable_denied` | **KHÔNG** — `recordFailure` chỉ ở nhánh `bad_code` (`:322`); `account_gone` đã ném ở `:318-320` |

`audit_logs` **append-only** (BẤT BIẾN #2). Người giữ access token của tài khoản **vừa xoá mềm** lặp
hai endpoint này tới hết TTL token, mỗi lượt một hàng vĩnh viễn, **không gì chặn**.

Ca `§enable-deny-norl` (`test/integration/auth-s18-restore2fa-1.int-spec.ts:313-335`) gọi **6 lượt**
và assert cả 6 đều 401 — nó **minh hoạ chính lỗ này**, không phải chứng minh sự an toàn.

> **Luật đang chi phối** (`docs/plans/S10-SEC-LOGINLOG429-1.md` §1, memory `lock-observability-rule`):
> **"Đường DỰNG NÊN cái khoá phải để lại vết; đường ĐANG BỊ KHOÁ ghi 0 hàng."**
> Hôm nay hai nhánh trên **để lại vết** (đúng nửa đầu) nhưng **không có cái khoá nào để dựng** ⇒ trần
> lưu trữ mỗi cửa sổ = **vô hạn**, không phải `N`. Bản vá là dựng nốt cái khoá đó.

#### 1.1 ⚠️ Phạm vi CHÍNH XÁC của §8.2 — đọc trước khi viết PR body

Plan v1 nói bản vá "đóng nửa lỗ KMS". **Sai, đã sửa** (`plan-reviewer` C4, đã xác minh lại):

`enroll` gọi `generateSecret()` `:151` rồi `encryptSecret()` **`:152`** — **trước** `withTenant`. Dời
`isLocked` lên trước chúng chỉ chặn KMS cho người **đã bị khoá**, tức chỉ cho nhánh `account_gone`.
Nhánh **409 "2FA đã được bật"** (`:206-208`) — user **còn sống**, đã bật 2FA — vẫn lặp được **vô hạn**:
mỗi lượt `generateSecret + encryptSecret + 1 tx + 2 SELECT` rồi ném 409 trong tx. Không counter, không
audit, không khoá; `apps/api/src` **không có** `Throttler` nào (grep → 0) và
`auth.controller.ts:239-243` không có decorator tần suất.

⇒ Tuyên bố ĐÚNG của WO này, dùng nguyên văn này trong PR body:

> Trần **hàng `audit_logs`** của hai nhánh `account_gone` giảm từ **vô hạn** xuống
> **`LOGIN_MAX_ATTEMPTS` = 5 hàng / cửa sổ 900s / (company,user)**. Lượt **KMS** của nhánh **409
> (user còn sống, đã bật 2FA)** VẪN **không có trần** — nợ mới, ghi ở §8.

### (L2) §8.7 — `restoreUser` gỡ yếu tố thứ hai mà không phát tín hiệu bảo mật

`apps/api/src/users/auth-users.service.ts:639-715`. `restoreUser` gọi `deleteTwoFactorTx` (A1, **vô
điều kiện**) rồi ghi `audit_logs` `user.restored` + `securityEvents.record({eventType:"USER_RESTORED"})`
(`:705-711`). **Không có `TOTP_RESET`.**

Đường anh em `resetTwoFactor` (`:279-314`) làm **đúng cùng mutation** và **có** phát `TOTP_RESET`
(`:307-308`) ⇒ **lệch quan sát giữa hai đường cùng xoá credential**, đúng trong mô hình đe doạ mà #490
tồn tại để chống. Câu "yếu tố thứ hai của bạn đã bị gỡ" hiện sống **duy nhất** ở
`audit_logs.after.twoFactorReset` — thứ người dùng cuối **không đọc**.

### (L3) §8.8 — hai `catch` nuốt lỗi mà không mang ngữ cảnh truy vết

| File | Dòng **(đã sửa theo review M1)** | Log hiện tại |
| --- | --- | --- |
| `auth/auth.service.ts` | **`:2316-2320`** | chỉ `err.message` |
| `auth/two-factor.service.ts` | **`:371-375`** | chỉ `err.message` |

> 🔴 **BẪY**: `two-factor.service.ts:368` là dòng `userAgent: meta.userAgent` **nằm TRONG payload**
> của `securityEvents.record`, KHÔNG phải dòng log. Plan v1 dẫn `:368-372` — sửa nhầm ở đó là chạm
> BẤT BIẾN #3.

Nuốt-và-đi-tiếp là **CỐ Ý** (biến 401 thành 500 là biến mất-tầm-nhìn thành mất-đăng-nhập) và **KHÔNG
được đổi**. Vấn đề duy nhất: hỏng ở PROD thì không truy được **hàng của ai** đã mất.

---

## 2. Số đo phụ trợ — phải ĐO trước khi thiết kế

| Câu hỏi | Đo được | Hệ quả |
| --- | --- | --- |
| `user_security_events.event_type` có CHECK? | **KHÔNG.** `schema/auth-logs.ts:76` = `text(...)`; `migrations/0443_…sql:143` chỉ có `…_severity_check` | §8.7 **0 migration** |
| `TOTP_RESET` có trong union? | **CÓ** — `packages/contracts/src/auth.ts:226` + severity map `:285`. Cổng fail-closed thật là `SecurityEventWriter.record` (`security-event-writer.service.ts:55-62`) | dùng được ngay |
| `audit_logs.action` có CHECK? | Không (`text`) | 0 action mới ở WO này |
| `LoginRateLimiter` API | `isLocked` `:229` · `recordFailure(key, max = env.LOGIN_MAX_ATTEMPTS)` `:240` · `reset` `:264` · `remainingLockSecOrNull` `:523` | dùng lại nguyên, **không** viết limiter mới |
| Ngưỡng | `LOGIN_MAX_ATTEMPTS = 5` · `LOGIN_LOCKOUT_SEC = 900` (`env.schema.ts:115-116`) | trần mới = **5 hàng / 900s / (company,user)** |
| `RlBucket` là union đóng | `valkey-key.ts:49-80` (kết thúc ở `"forgot:ip-index"`, KHÔNG phải `:70`) | APPEND `"2fa-enroll"` vào **cuối** union |
| Ratchet đếm số bucket? | **Không.** `valkey-key-census.spec.ts` neo tiền tố `"rl:"` (đã phủ). Bảng `BUILDERS` (`valkey-key.spec.ts:42-140`) là **liệt kê thủ công, KHÔNG đối chiếu union** — `logdedup`/`ip-index`/`forgot:ip-index` đã vắng sẵn | thêm dòng là **vệ sinh, KHÔNG phải cổng** (review H4) |
| `clearLoginLocks` có xoá khoá mới? | **Không** — chỉ họ login (`acct`/`ip`/`2fa`/`forgot`); `2fa-enable`/`2fa-disable`/`change-pw` cũng không (`login-rate-limiter.ts:342-344` liệt kê **theo tên**) | xem §2.2 — đây KHÔNG còn là "tiền lệ vô hại" |
| Có throttler toàn cục? | **Không** (grep `Throttler` → 0) | §1.1 |
| Harness unit đã sẵn sàng? | `two-factor.service.spec.ts:159-166` `makeRateLimiterMock` + `:627-645` `makeEnrollSvc` **đã có** `isLocked`/`recordFailure`/`reset`; `two-factor.int-spec.ts:49-57` dựng `new LoginRateLimiter()` THẬT | D1 **không** phá 7 call-site `svc.enroll(...)`. Ghi ra để không ai "dọn trước" harness |
| Mock `rateLimiter` của `auth-users.service.spec.ts` | `:90-92` **chỉ có** `clearLoginLocks` | D3b buộc thêm `reset: vi.fn()` — xem §4 D3b |

### 2.1 🔴 Ràng buộc LỚN NHẤT — ratchet 429 sẽ bắt điểm ném mới

`test/foundation/login-log-429-ratchet.unit-spec.ts` + `login-log-429-census.ts` quét **AST** mọi điểm
`throw` 429 trong `src/auth/**` (nhận cả hình `throw tooManyRequests(...)`) và đòi **nhánh ném phải có
lời ghi**, trừ dòng trong `WAIVERS`.

Thêm `throw tooManyRequests(...)` vào `enroll` ⇒ mọc site **`TwoFactorService#enroll`**. Nhánh đó,
**theo đúng luật đã ký**, ghi **0 hàng** ⇒ ca (1) **ĐỎ** nếu không có waiver.

**Đã xác minh (plan-reviewer, đọc AST):** `innermostBlock()` của `throw` nằm trong `if (await isLocked(…)) { … }`
là chính khối `if` đó, không chứa write-call ⇒ `logsInBranch=false`; `enclosingKey()` cho đúng
`TwoFactorService#enroll`. Sàn ca (2) `>=6` → 7 OK; ca (2b) `byFactory >= 5` → 6 OK; ca (3) tập context
**không đổi** (D1/D2 không thêm literal nào vào `recordReauthFailure`).

**Neo dương nào cho waiver này?** Ba ứng viên, hai sai:

- ❌ `reauthFailedContexts()` (ca (3)) — thêm `"2fa_enroll"` sẽ phá **đẳng thức chính xác** ở
  `ratchet.unit-spec.ts:54,152`, và quan trọng hơn: D1.d của #490 **cấm** `recordReauthFailure` ở
  nhánh `account_gone` (gắn nhãn *"xác thực lại thất bại"* cho lượt **không phải "nhập sai mã"** là
  **SAI NHÃN**). Dùng neo này = **đảo D1.d qua cửa sau**.
- ❌ `audit.record` — census **cố ý không tính**: `isWriteCall` giới hạn `record` theo receiver
  `securityEvents` (`census.ts:142-158`).
- ❌ **Chép khuôn `stepUpAntiAmplificationAnchors()`** (plan v1 định làm — **SAI, đã bỏ**). Hàm đó
  (`census.ts:337-352`) duyệt **toàn bộ file** và đếm mọi call tên `recordFailure`; nó **không** có
  khái niệm nhánh. Chép sang `two-factor.service.ts` cho ra neo **RỖNG**: file đã có sẵn **một**
  `recordFailure` ở `:322` (nhánh `bad_code`) ⇒ sàn `>=1`/`>=2` xanh **trước cả khi vá**; sàn `>=3`
  thì một `recordFailure` thêm ở `disable()` vẫn giữ ca xanh trong khi vế `account_gone` bị xoá.
  Đúng cái `WAIVERS` docblock cấm: *"Waiver không neo là dây thừa"* (`ratchet.unit-spec.ts:34-35`).

✅ **Neo ĐÚNG = neo theo HÌNH DẠNG NHÁNH.** Thiết kế ở §4 D5.

Ghi thêm (review, miễn phí): **ca (1b) đã tự neo SỰ TỒN TẠI của điểm ném** — waiver có mặt mà điểm ném
biến mất ⇒ `noLongerSilent = ["TwoFactorService#enroll"]` ⇒ ca (1b) ĐỎ (`ratchet.unit-spec.ts:88-94`).
Ca (5) chỉ cần gánh vế `recordFailure`.

### 2.2 🔴 Khoá mới chặn ĐÚNG đường khắc phục mà #490 vừa dựng

Chuỗi đo được (review C3, đã xác minh):

1. Khoá mới `rl:{env}:2fa-enroll:{companyId}|{userId}`, TTL = `LOGIN_LOCKOUT_SEC` = **900s**.
2. `clearLoginLocks` **cố ý không** xoá họ post-auth (`login-rate-limiter.ts:342-344`).
3. Nhưng #490 đã dựng **A2**: `restoreUser` set `require_two_factor = true` khi `twoFactorWasEnabled`
   (`auth-users.service.ts:663-684`), và `TwoFactorEnforcementGuard` **ép user enroll**.

⇒ Kẻ giữ access token của tài khoản vừa xoá mềm gọi `POST /auth/2fa/enroll` **5 lượt** là khoá bề mặt
enroll của nạn nhân **15 phút**. Admin restore xong, nạn nhân **bị guard ép enroll** nhưng nhận **429**,
và nút *"Gỡ khoá đăng nhập"* của admin **không gỡ được**.

Plan v1 gọi đây là *"tiền lệ đã có, không phải hồi quy"* — **đúng** cho `2fa-enable`/`change-pw` (bề mặt
**không** bị guard ép), **sai** cho `2fa-enroll` **sau A2**. Đây là deny-path mới **không lối thoát**
trên vùng đỏ ⇒ **phải đóng trong chính WO này** (§4 D3b), không được ghi nợ.

---

## 3. Phạm vi

**TRONG:** D1 · D2 · D3a · D3b · D4 · D5 (cổng).
**NGOÀI (giữ nguyên ở `docs/plans/S18-AUTH-RESTORE2FA-1.md` §8):** §8.1 guard vô điều kiện · §8.3 gộp
hai writer `recordReauthFailure` · §8.4 `getTwoFactorStateTx` thiếu `company_id` tường minh · §8.5 nhãn
sai nhánh `!row` của `disableTwoFactor` (WO nhãn chung — **đừng seed WO thứ tư**) · §8.6 không backfill ·
§8.9 probe `alive` không serialize.

**Migration: 0.** Head giữ nguyên. **Rollback = revert 1 commit** (khoá `2fa-enroll` còn sót tự hết hạn
sau 900s và không mã nào đọc nó nữa).

---

## 4. Thiết kế từng vế

### D1 — `enroll` có rate-limit riêng (§8.2a)

```text
Bucket MỚI: "2fa-enroll"  →  rl:{envScope}:2fa-enroll:{companyId}|{userId}
```

Thứ tự bắt buộc trong `enroll`, **trước mọi thứ khác**:

1. dựng `rlKey` = `rateLimitKey("2fa-enroll", <companyId>|<userId>)` — cùng hình dạng `rest` như
   `confirmEnable:260`;
2. kiểm khoá — ⚠️ **BẮT BUỘC có ngoặc `{}`**:

   ```ts
   if (await this.rateLimiter.isLocked(rlKey)) {
     throw tooManyRequests(await this.rateLimiter.remainingLockSecOrNull(rlKey));
   }
   ```

   > Không phải thẩm mỹ. §2.1 phân tích `innermostBlock()` theo giả định **có** khối. Bản không-ngoặc
   > làm `innermostBlock()` của `throw` = **cả thân `enroll`** ⇒ ngày ai đó thêm bất kỳ
   > `securityEvents.record` nào vào `enroll`, waiver lật sang "no longer silent" và **ca (1b) đỏ vì
   > lý do không liên quan**.

3. **rồi mới** `generateSecret()` `:151` / `encryptSecret()` `:152` / `generateRecoveryCodes()`;
4. nhánh `account_gone` (**ngoài** `withTenant`, tại `if (outcome.kind === "account_gone")` `:237`,
   cạnh chỗ ném 401): `await this.rateLimiter.recordFailure(rlKey);`

> ⚠️ Bước 2 **phải** đứng trước bước 3 — nếu không, khoá chỉ chặn đường ghi DB mà vẫn để KMS bị gọi.
> **Xác minh không kéo theo hệ quả nào** (review): `secret`/`enc`/`recoveryCodes`/`recoveryHashes` chỉ
> được tiêu thụ ở `:221-224` và `:240`; không gì đọc chúng trước tx. Đường 409 và đường re-enroll hợp
> lệ không đổi.

**KHÔNG có `reset()` ở đường thành công của `enroll`** — khác `confirmEnable:332`, và đây là **quyết
định có chủ ý**:

> `recordFailure` **chỉ** chạy ở nhánh `account_gone`, tức chỉ cho tài khoản đã xoá mềm/vắng. Một user
> bình thường **không bao giờ** bồi counter ⇒ `reset` ở đường thành công là **no-op vĩnh viễn**, không
> ca nào đo được nó (review C2 bắt đúng: plan v1 khai một đột biến **không thể** đỏ). Đường duy nhất
> counter đó cần được xoá là **sau khi khôi phục tài khoản** — và đó là **D3b**, nơi nó CÓ cổng.
> Thêm `reset` ở đây là nối dây ghi-rồi-bỏ (memory `write-only-column-means-delete-not-wire-up`).
>
> ⚠️ **ĐIỀU KIỆN HẾT HẠN của lập luận này** — phải nằm trong docblock, không chỉ trong plan: nó đúng
> **chỉ vì** `recordFailure` nằm duy nhất ở nhánh `account_gone` (tài khoản đã chết). **WO nào thêm
> `recordFailure` cho một nhánh của user CÒN SỐNG — ví dụ nợ §8 #1, đặt trần cho nhánh 409 — PHẢI
> thêm `reset` ở đường thành công trong CÙNG lượt**, nếu không user hợp lệ tự khoá chính mình.

**KHOÁ RIÊNG, không dùng chung `2fa-enable`**: dùng chung thì hỏng ở bề mặt này khoá luôn bề mặt kia —
đúng lý do `valkey-key.ts:58-62` đã tách `stepup` khỏi `ip`/`acct`.

**KHÔNG** `recordReauthFailure` ở nhánh này (D1.d — §2.1).
Nhánh 409 "2FA đã được bật" (`:206-208`) **giữ nguyên** — nó ném trong tx ⇒ rollback ⇒ 0 hàng audit.
(Trần **KMS** của nhánh đó vẫn vô hạn: nợ mới ở §8.)

### D2 — `confirmEnable` phạt nhánh `account_gone` (§8.2b)

Tại `:318-320`, trước khi ném 401:

```ts
if (outcome === "account_gone") {
  await this.rateLimiter.recordFailure(rlKey);   // ← MỚI
  throw new UnauthorizedException("Phiên đăng nhập không còn hợp lệ.");
}
```

`rlKey` đã có sẵn (`:260`). Nhánh `bad_code` (`:321-325`) **giữ nguyên cả hai** lời gọi
(`recordFailure` **và** `recordReauthFailure`); chỉ `account_gone` được thêm **duy nhất** vế đếm.

> Docblock bắt buộc (không chỉ nằm trong plan): *"`recordFailure` là bộ **ĐẾM**, `recordReauthFailure`
> là **NHÃN**. Lập luận chống-sai-nhãn của D1.d nhắm vào nhãn, nên vế đếm được phép còn vế nhãn thì
> không."*

### D3a — `restoreUser` phát `TOTP_RESET` có điều kiện (§8.7)

Trong **cùng tx**, ngay sau `securityEvents.record({eventType:"USER_RESTORED"})` (`:705-711`):

```ts
if (twoFactorWasEnabled) {
  await this.securityEvents?.record(tx, {
    eventType: "TOTP_RESET",
    userId: id,              // nạn nhân
    actorUserId: actor.id,   // admin thực hiện restore
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}
```

- **CÓ ĐIỀU KIỆN** (owner chốt): `twoFactorWasEnabled` đọc ở `:660`, **TRƯỚC** `deleteTwoFactorTx` —
  đúng biến; `deleteTwoFactorTx` trả `void` nên không suy được từ kết quả xoá.
- `securityEvents?` giữ **optional** (`:121`) đúng convention hiện hành.
- **Không payload**, không secret/recovery code (BẤT BIẾN #3).
- **BẤT BIẾN đã xác minh** (review): `SecurityEventWriter.record` không set `company_id` (DB DEFAULT
  dưới `withTenant`), chỉ INSERT. `userId: id` an toàn vì `restoreTx` đã clear `deleted_at` trong
  **cùng** tx ⇒ hàng FK tồn tại (khác hẳn bẫy `actor_user_id` ở nhánh `!alive` của #490).
- ⚠️ **Lệch có chủ ý so với đường anh em, phải ghi vào docblock**: `resetTwoFactor` (`:291-314`) phát
  `TOTP_RESET` kèm `payload:{revokedSessionCount}` **và** thu hồi phiên. D3a **không** làm cả hai —
  đúng, vì phiên đã bị thu hồi ở `deleteUser`. Viết ra kẻo lượt sau "hài hoà hoá" hai đường.

### D3b — `restoreUser` gỡ khoá `2fa-enroll` (đóng §2.2)

🔴 **HAI vị trí, KHÔNG một** — `requireRateLimiter()` phải **hoist lên câu lệnh ĐẦU TIÊN**, chỉ lời
gọi `reset` mới đặt sau commit:

```ts
async restoreUser(actor, id, meta): Promise<AuthUserDto> {
  const limiter = this.requireRateLimiter();      // ① fail-fast TRƯỚC mọi mutation
  const dto = await this.db.withTenant(actor.companyId, async (tx) => { /* … D3a … */ });
  await limiter.reset(rlKey("2fa-enroll", `${actor.companyId}|${id}`));   // ② sau COMMIT
  return dto;
}
```

- **Vì sao ① phải ở đầu.** `requireRateLimiter()` (`:141-149`) **NÉM**. Ném **sau** commit ⇒ `restoreTx`
  đã xong, admin thấy **500**, bấm lại → `findDeletedByIdTx` không còn thấy hàng deleted → **404** ⇒
  vận hành kết luận "restore hỏng" trong khi nó đã **thành công**. Đúng lớp "nút bấm nói dối" mà
  docblock `:136-139` lập pháp chống. **Khuôn đã có trong chính file**: `resetPassword` gọi
  `requireRateLimiter()` **trước mọi mutation** (`:735-741`), có ca ghim
  (`auth-users.service.spec.ts:692-709`).
- ⚠️ **RESTRUCTURE BẮT BUỘC**: `restoreUser` hôm nay là **một biểu thức** `return this.db.withTenant(...)`
  (`:640`) ⇒ phải tách thành `const dto = await …; await limiter.reset(…); return dto;`. Đừng đọc
  "trước `return`" như thể chỗ đó đã có sẵn.
- `reset()` (`:264-270`) **không ném** khi Valkey rớt (`ValkeyService.del`, `permission/valkey.service.ts:258-267`,
  nuốt lỗi trả `false`) ⇒ ② không biến một lượt restore đã COMMIT thành 500 vì hạ tầng cache.
- ② đặt **ngoài tx, sau commit**: reset rồi tx rollback sẽ gỡ khoá cho một lượt restore không xảy ra.
- Cần `import { rlKey } from "../common/valkey/valkey-key"` (`auth-users.service.ts` **chưa** import).
- ⚠️ **GIỚI HẠN phải ghi vào docblock** (W2): ② là **best-effort CÂM** — `reset()` trả `void`, không có
  vế `ok`/`degraded` như `clearLoginThrottle`. Valkey degraded đúng lúc restore ⇒ khoá 429 sống hết
  **900s** và `clearLoginLocks` **cố ý** không gỡ nó (`login-rate-limiter.ts:342-344`) ⇒ **không lối
  thoát, không tín hiệu**. Tức §2.2 chỉ đóng ở trạng thái hạ tầng khoẻ. **Đừng dựng đường `ok`** —
  ngoài phạm vi WO này.
- ⚠️ **Kéo theo spec**: mock `rateLimiter` của `auth-users.service.spec.ts:90-92` **chỉ có**
  `clearLoginLocks` ⇒ phải thêm `reset: vi.fn(async () => undefined)`. Số đo chính xác: **8** điểm gọi
  `restoreUser` trong file đó (`:468 :482 :491 :504 :513 :537 :562 :585`), trong đó **4** ca chạm dòng
  mới (`:468 :504 :513 :562`) — bốn ca còn lại ném trước khi tới ②. Nhưng ① nằm ở **đầu hàm** nên
  thiếu `reset` trong mock sẽ làm đỏ **cả 4 ca đi tới ②**, không phải cả 8.

> Vì sao KHÔNG nới `clearLoginLocks` thay vì vá ở đây: `clearLoginLocks` là nút *"gỡ khoá **đăng
> nhập**"*, có hợp đồng riêng (`LoginThrottleBucket = "acct" | "ip" | "2fa"`, badge trạng thái, cờ
> `degraded`/`unknown`). Nhét một bucket post-auth vào đó làm badge nói sai — đúng lý do docblock
> `:44-49` đã loại `forgot` khỏi `LoginThrottleBucket`. Đường khắc phục đúng là **chính lượt restore**.

### D4 — ngữ cảnh cho hai log nuốt lỗi (§8.8)

`auth.service.ts:2316-2320` và `two-factor.service.ts:371-375`: giữ **nguyên** hành vi nuốt, chỉ thêm
`userId` + `companyId` + `context` vào dòng `logger.error`.

⚠️ **Cấm** đưa vào dòng log: `meta.ip`/`userAgent` (không giúp truy "hàng của ai", và log không phải
chỗ nhân bản PII) **và** `rlKey`/khoá Valkey — khoá họ `rl:` nhúng email/slug (`valkey-key.ts:219-223`).

### D5 — cổng: mở rộng census + ratchet 429 (BẮT BUỘC, §2.1)

**D5.1 — `login-log-429-census.ts`: thêm `twoFactorDenyBranchAnchors()`.**
Neo theo **HÌNH DẠNG NHÁNH**, không theo tên hàm, không theo tổng đếm cấp file
(memory `index-ratchet-must-pin-definition-not-name`):

> Duyệt `two-factor.service.ts`; gom **mọi `IfStatement` có string-literal `"account_gone"` trong
> `expression`**. Với mỗi nhánh, ghi **khoá hàm** bằng `enclosingKey(node, base)` — hàm **đã có sẵn**
> trong chính file census (`:274`) — và cờ "có `rateLimiter.recordFailure` là **hậu duệ của
> `thenStatement`**". Thêm `badCodeHasBoth` = nhánh `IfStatement` mang literal `"bad_code"` còn **cả**
> `recordFailure` **lẫn** `recordReauthFailure` trong `thenStatement`.
>
> ```ts
> twoFactorDenyBranchAnchors(): {
>   branches: Array<{ key: string; withRecordFailure: boolean }>;
>   badCodeHasBoth: boolean;
> }
> ```

🔴 **Số nhánh THẬT là 3, không phải 2** (plan v2 ghi `branches === 2` — **BẤT KHẢ THI**, review vòng 2
B1 bắt đúng). Đo trên cây thật, `IfStatement` có `"account_gone"` trong `expression`:

| Dòng | Hàm | Có `recordFailure` sau vá? |
| --- | --- | --- |
| `two-factor.service.ts:237` | `enroll` | ✅ (D1) |
| `two-factor.service.ts:318` | `confirmEnable` | ✅ (D2) |
| `two-factor.service.ts:466` | **`disable`** | ❌ — **WO này KHÔNG đụng** |

(Ba dòng `return … "account_gone"` ở `:199` · `:286` · `:429` nằm trong `thenStatement`, không phải
`expression` ⇒ không bị đếm.)

**D5.2 — `login-log-429-ratchet.unit-spec.ts`:**

- `WAIVERS` += `["TwoFactorService#enroll", "Trần = LOGIN_MAX_ATTEMPTS hàng/cửa sổ nhờ recordFailure ở nhánh account_gone (D1) — neo dương ở ca (5)."]`
- ca **(5)** MỚI — neo theo **KHOÁ NHÁNH**, tuyệt đối **KHÔNG** theo tổng đếm:

  ```ts
  const a = twoFactorDenyBranchAnchors();
  expect(a.branches.map((b) => `${b.key}:${b.withRecordFailure}`).sort()).toEqual([
    "TwoFactorService#confirmEnable:true",
    "TwoFactorService#disable:false",
    "TwoFactorService#enroll:true",
  ]);
  expect(a.badCodeHasBoth).toBe(true);
  ```

  > ⚠️ **Vì sao KHÔNG dùng `withRecordFailure === 2`** (bản "sửa nhanh" `2 → 3` cũng sai): tổng đếm
  > biến neo thành **cấp file** — dời `recordFailure` từ `enroll` sang `disable` vẫn ra `2` ⇒ **xanh
  > trong khi lỗ mở lại**. Đúng cái bệnh của `stepUpAntiAmplificationAnchors()` mà §2.1 vừa bác bỏ.
  > Đẳng thức theo khoá bắt được mọi hoán vị.

  **Docblock của vế `disable:false` phải giải thích, không được để trống** (đã đo): nhánh
  `account_gone` của `disable()` chỉ tới được sau khi re-auth mật khẩu **ĐÚNG** và chỉ khi xoá mềm
  chen giữa hai tx; đường lặp-được đã bị đếm ở **tầng trên** — `auth.service.ts:757-796` ghi
  `auth.2fa_disable_denied` rồi rơi xuống nhánh `!ok` ⇒ `recordFailure` bucket `2fa-disable`. Neo này
  vì thế ghim **cả chiều cấm**: ai thêm `recordFailure` vào `disable` cũng phải ĐỎ.

  Vế `badCodeHasBoth` ghim chiều ngược lại của D2: không được "dọn gọn" bằng cách bỏ
  `recordReauthFailure` khỏi `bad_code` (`:321-325` hiện có cả `recordFailure` `:322` lẫn
  `recordReauthFailure` `:323`).
- Ca (2) sàn `>= 6`, ca (2b) sàn `>= 5`: chỉ **tăng**. **KHÔNG hạ sàn nào.**

**D5.3 — `valkey-key.ts`:** APPEND `"2fa-enroll"` vào **cuối** union `RlBucket` (`:49-80`) kèm chú
thích kiểu các bucket trước (WO · vì sao tách khỏi `2fa-enable`).

**D5.4 — `valkey-key.spec.ts`:** thêm dòng `{ name: "rlKey(2fa-enroll)", …, carriesIdentity: true }`
vào bảng `BUILDERS` (`:42-140`). ⚠️ Đây là **vệ sinh, KHÔNG phải cổng** — bảng đó không đối chiếu với
union (`logdedup`/`ip-index`/`forgot:ip-index` đã vắng sẵn). Đừng viết trong PR body rằng "đã có cổng".

**D5.5 — `login-rate-limiter.ts`:** docblock `:342-344` liệt kê **theo tên** các bucket không bị
`clearLoginLocks` xoá ⇒ thêm `2fa-enroll` vào danh sách đó, kèm một câu trỏ sang D3b (đường gỡ của nó
là restore, không phải nút admin).

---

## 5. Bộ ca — RED trước, mỗi ca cô lập ĐÚNG một vế

File mới: `apps/api/test/integration/auth-s18-490debt-1.int-spec.ts` — qua **HTTP thật** (gọi thẳng
service ⇒ spec tự truyền `meta` ⇒ xanh-RỖNG với dây controller).

> ⚠️ **Cô lập ca (review M5).** Mỗi ca khoá bucket đốt cặp `(companyId,userId)` trong **900s** và
> **không có teardown Valkey**. Mọi ca rate-limit **phải** `seedTarget(<prefix RIÊNG>)`; **cấm** dùng
> lại user giữa các ca khoá. Chạy lại trong 900s trên cùng lane sẽ đỏ vì lý do sai
> (memory `flake-rate-tracks-lane-db-dirtiness`).
>
> ⚠️ Luật này phủ **CẢ HAI** bucket, không chỉ `2fa-enroll`. Sau D2, ca `§enable-deny` sẵn có
> (`auth-s18-restore2fa-1.int-spec.ts:283`) **đã đốt 1/5** hạn mức của user nó ⇒ `§enable-deny-rl` mới
> tuyệt đối **không** được dùng lại user đó.

### 5.1 §8.2 — `enroll`

| Ca | Ghim | Đột biến làm nó ĐỎ |
| --- | --- | --- |
| `§enroll-rl-lock` | user xoá mềm + token sống: lượt 1–5 → 401; **lượt 6 → 429** kèm `Retry-After` | bỏ `recordFailure` ở `account_gone` |
| `§enroll-rl-ceiling` | sau **10** lượt, số hàng `auth.2fa_enroll_denied` **=== 5** | bỏ `isLocked` (đếm = 10) |
| `§enroll-rl-before-kms` | số lần gọi `encryptSecret` **KHÔNG tăng** ở lượt thứ 6 (đang khoá) và **0 hàng** audit mới | dời `isLocked` xuống sau `encryptSecret` |
| `§enroll-rl-noreauth` | assert **RIÊNG**: sau toàn bộ chuỗi trên, `REAUTH_FAILED` của user đó = **0** | thêm `recordReauthFailure` vào nhánh `account_gone` |
| `§enroll-allow` | **ĐỐI CHỨNG DƯƠNG**: user BÌNH THƯỜNG enroll **6 lượt** liên tiếp ⇒ **cả 6 đều 200** | `recordFailure` đặt nhầm ở đường thành công / `isLocked` dùng khoá gộp với `2fa-enable` |

- `§enroll-rl-ceiling` dùng **`=== 5`, KHÔNG `≤ 5`** (review M4): `≤ 5` xanh cả khi đếm = 0, tức xanh
  cả khi nhánh từ chối **ngừng ghi vết** — giết đúng nửa quan sát của bất biến; `=== 5` còn bắt được
  "`recordFailure` gọi hai lần/lượt" và "đọc nhầm env ngưỡng".
- `§enroll-rl-before-kms` assert **"không tăng"**, KHÔNG "không được gọi" (review M3): muốn "đang khoá"
  thì phải chạy 5 lượt trước, mà mỗi lượt đó **có** gọi `encryptSecret`. Spy:
  `app.get(SecretEncryptionService)` **sau** `app.listen(0)`.
- `§enroll-allow` là **bắt buộc**: thiếu nó thì mọi ca 429 ở trên **xanh-RỖNG** với một bản vá
  khoá-tất-cả (memory `deny-cases-vacuous-without-allow-case`).

### 5.2 §8.2 — `confirmEnable` (sửa ca ĐANG GHIM hành vi cũ)

`§enable-deny-norl` (`auth-s18-restore2fa-1.int-spec.ts:313-335`) **phải đổi**. Đây là **đảo cổng có
chủ ý** — ghi rõ trong docblock của ca, plan và PR body để lượt sau không đọc thành "nới cổng"
(memory `tests-can-pin-a-hole-open`).

⚠️ Ca cũ mang **ba** vế, plan v1 chỉ giữ một (review H3). Ca mới **phải kế thừa đủ**:

| Ca | Ghim |
| --- | --- |
| `§enable-deny-noreauth` (đổi tên từ `-norl`) | `REAUTH_FAILED` = **0** ở nhánh `account_gone`. Bỏ vòng lặp 6 lượt + assert "không khoá". Docblock **phải trỏ tên** đối chứng dương của nó: **`§meta-enable`** trong cùng file (enable mã SAI ⇒ CÓ `REAUTH_FAILED`) — nếu không, ca assert-0 này là xanh-rỗng |
| `§enable-deny-rl` (MỚI) | lượt 1–5 → 401, **lượt 6 → 429**; `auth.2fa_enable_denied` **=== 5**; **mỗi lượt dùng mã TOTP ĐÚNG** (`totp.generate(secret)`, kế thừa `:330`) ⇒ ghim "401 đến từ `deleted_at`, không phải `bad_code`"; `enabledAt` vẫn **NULL** (kế thừa `:334`); **và `REAUTH_FAILED` = 0 TRONG CÙNG vòng lặp** — thiếu vế cuối thì 429 không quy được về `recordFailure` MỚI của `account_gone` hay `recordFailure` SẴN CÓ của `bad_code` ở `:322` (hình `overdetermined-gate-makes-deny-spec-vacuous`) |
| `§enable-allow` | đối chứng dương: user bình thường sai < 5 lượt rồi nhập **đúng** mã ⇒ bật được, không 429 |

### 5.3 §8.7 + §2.2 — `restoreUser`

| Ca | Ghim | Đột biến |
| --- | --- | --- |
| `§restore-totpreset` | user **từng bật** 2FA → xoá mềm → restore ⇒ đúng **1** hàng `TOTP_RESET`, `userId`=nạn nhân, `actorUserId`=admin, `ip`/`userAgent` của lượt restore | bỏ lời gọi |
| `§restore-totpreset-neg` | ⚠️ **CA ÂM BẮT BUỘC**: user **chưa từng** bật 2FA → restore ⇒ **0** hàng `TOTP_RESET` (`USER_RESTORED` vẫn có) | bỏ `if (twoFactorWasEnabled)` |
| `§restore-unlocks-enroll` (D3b) | 5 lượt enroll khi đã xoá mềm (khoá dựng) → admin restore → lượt enroll kế **200, KHÔNG 429** | bỏ `reset` ở D3b |

- Thiếu `§restore-totpreset-neg` thì bản vá **vô điều kiện** vẫn xanh — ca dương một mình không chứng
  minh được điều owner đã chốt.
- **Bỏ `§restore-totpreset-atomic` của plan v1** (review): tiền đề *"A2 khớp 0 hàng ⇒ rollback"* đã
  được dựng sẵn. Hai bản dựng độc lập của cùng tiền đề sẽ trôi — đúng điều §5 của #490 cấm với
  `§rls-shape`. Thay bằng **thêm một assert vào ca cũ**.

  🔴 **Ca cũ nằm ở UNIT, KHÔNG phải int-spec** (plan v2 trỏ sai — review vòng 2 B4):
  **`apps/api/src/users/auth-users.service.spec.ts:531`** (`§restore-flag-failclosed`, `withTenant`
  mock). Assert cần thêm: `expect(securityEvents.record).not.toHaveBeenCalled();` đặt cạnh
  `expect(audit.record).not.toHaveBeenCalled();` ở `:541`.

  ⚠️ **Lớp bằng chứng, ghi vào docblock**: đây là neo **hình-dạng ở tầng unit** (`withTenant` mock) —
  nó **KHÔNG** chứng minh rollback DB thật. Tiền đề rollback thật chỉ có ở `§restore-flag`
  (int-spec `:405`), nơi `TOTP_RESET` phải **= 1**, không phải 0. **Đừng dựng ca int mới cho vế này.**

### 5.4 §8.8

| Ca | File | Ghim |
| --- | --- | --- |
| `§reauth-log-ctx-2fa` | `apps/api/src/auth/two-factor.service.spec.ts` | ép `securityEvents.record` **ném** ⇒ (a) outcome vẫn **401, KHÔNG 500**; (b) dòng log chứa `userId` + `companyId` + `context`. **Hai assert RIÊNG** |
| `§reauth-log-ctx-auth` | `apps/api/src/auth/auth.service.spec.ts` | như trên, qua `disableTwoFactor`/`changePassword` — `AuthService.recordReauthFailure` là **`private`** (`auth.service.ts:2286`) nên **phải** đi qua entry point công khai |

⚠️ Dùng `withExpectedLoggerErrors` (`apps/api/test/helpers/expect-logged-errors.ts:58`) — helper khớp
`arg[0]` và assert min/max. `vi.spyOn(Logger.prototype,'error')` trần chính là thứ nó tồn tại để cấm.
Ba điều kiện sử dụng (đã đọc chữ ký): helper **ném khi `expected` rỗng**; mỗi mẫu phải khớp **≥1** lần
⇒ mỗi ca khai mẫu riêng; đọc nội dung bằng `matched.get(label)[0].message`. Spec colocate trong `src/**`
import `../../test/helpers/*` **có tiền lệ** khắp repo — không vướng typecheck.

Ca (a) là neo chống-hồi-quy cho quyết định "nuốt là cố ý"; ca (b) là vế mới.

### 5.5 Đo đột biến

Mỗi đột biến ở bảng trên phải làm **ĐỎ ĐÚNG ca của nó**. Đối chiếu **TÊN CA đỏ**, KHÔNG đọc mã thoát —
memory `mutation-red-can-be-ipc-flake` (sweep của #490 từng báo "đỏ" chỉ vì `ERR_IPC_CHANNEL_CLOSED`
sau teardown, không ca nào đỏ).

---

## 6. File đụng tới · hồi quy · rollback

| File | Vế |
| --- | --- |
| `apps/api/src/auth/two-factor.service.ts` | D1 · D2 · D4 |
| `apps/api/src/auth/auth.service.ts` | D4 |
| `apps/api/src/users/auth-users.service.ts` | D3a · D3b |
| `apps/api/src/auth/login-rate-limiter.ts` | D5.5 (**chỉ docblock**) |
| `apps/api/src/common/valkey/valkey-key.ts` | D5.3 |
| `apps/api/src/common/valkey/valkey-key.spec.ts` | D5.4 |
| `apps/api/test/foundation/login-log-429-census.ts` | D5.1 |
| `apps/api/test/foundation/login-log-429-ratchet.unit-spec.ts` | D5.2 |
| `apps/api/src/auth/two-factor.service.spec.ts` | §5.4 |
| `apps/api/src/auth/auth.service.spec.ts` | §5.4 |
| `apps/api/src/users/auth-users.service.spec.ts` | mock `reset` (D3b) |
| `apps/api/test/integration/auth-s18-restore2fa-1.int-spec.ts` | §5.2 · §5.3 (đảo cổng có chủ ý) |
| `apps/api/test/integration/auth-s18-490debt-1.int-spec.ts` | **MỚI** |
| `harness/backlog.mjs` · `docs/plans/S18-AUTH-490DEBT-1.md` | WO + plan |

> ⚠️ **File hạ tầng dùng chung** — `test/foundation/login-log-429-*` và `common/valkey/valkey-key*`.
> WO này **giữ** chúng trong suốt thời gian mở; wave khác không mở song song trên hai họ file đó
> (memory `stage-head-blob-races-parallel-session`).

**Bề mặt hồi quy phải chạy:** `two-factor.*` · `auth.service.*` · `auth-users.*` ·
`test/foundation/login-log-429-*` · `valkey-key*` · `auth-s18-restore2fa-1` · `auth-s18-seceventrest-1` ·
`auth-user-2fa-reset` · `auth-s18-2fadeleted-1` · `two-factor.int-spec`.

**Migration:** 0. **Rollback:** revert 1 commit.

---

## 7. Thứ tự thi công

1. **RED** — `auth-s18-490debt-1.int-spec.ts` + sửa `§enable-deny-norl` → đỏ đúng chỗ.
2. D5.3 + D5.4 (`RlBucket` + bảng) — `tsc` xanh trước khi dùng bucket mới.
3. D1 → D2 (`two-factor.service.ts`) **cùng lượt với** D5.1 + D5.2 (census + ratchet + waiver).
   > Vì sao cùng commit: ca (1b) đòi **mọi waiver phải CÒN im lặng**, tức phải **còn là một site**.
   > Đưa dòng `WAIVERS` vào trước khi `throw tooManyRequests(...)` tồn tại ⇒ `noLongerSilent` không
   > rỗng ⇒ ca (1b) **ĐỎ**. Tách commit sẽ đẻ một lượt đỏ khó đọc và áp lực "hạ sàn cho xanh".
4. D3a → D3b (`auth-users.service.ts`) + mock `reset` ở spec.
5. D4 (hai file) + D5.5 (docblock).
6. Sweep đột biến §5.5.
7. FULL gate → `bash harness/check.sh --all --lane-db=s18490debt` → `test:cov:sensitive`.

---

## 8. Nợ WO này KHÔNG đụng

Giữ nguyên §8.1 · §8.3 · §8.4 · §8.5 · §8.6 · §8.9 của `docs/plans/S18-AUTH-RESTORE2FA-1.md`.

**Nợ MỚI mở bởi WO này** (ghi ra để không thành bỏ sót):

1. **`enroll` nhánh 409 không có trần KMS** (§1.1). User **còn sống, đã bật 2FA** lặp
   `POST /auth/2fa/enroll` vô hạn: mỗi lượt `generateSecret + encryptSecret + 1 tx + 2 SELECT`, ném 409
   trong tx ⇒ 0 hàng audit. **Không phải lỗ ghi** — là lỗ **CPU/KMS**. Vá đòi tách probe-tx khỏi
   write-tx trên đường crown-jewel ⇒ **WO riêng, cổng riêng, đo tải trước**.
2. **`enroll:201-205` đọc `user_totp` không có `company_id` tường minh.** Cùng họ với §8.4 của #490
   (đường **ĐỌC**), quan sát được khi mở file cho WO này. **Cố ý không vá**: #490 đã ký ranh giới
   *"D2 siết đường GHI, đường ĐỌC ghi nợ"*, và siết ở đây không có cổng nào đo được — đúng cái bệnh
   §8.4 mô tả. Gộp vào WO nợ §8.4 khi làm.

---

## 9. FULL gate — điền sau khi chạy

| Cổng | Kết quả |
| --- | --- |
| `plan-reviewer` vòng 1 | **BLOCK** → v2 vá C1–C4, H1–H4, M1–M6 |
| `plan-reviewer` vòng 2 | **BLOCK** → v3 vá B1 (neo theo khoá nhánh, 3 nhánh không phải 2) · B2 (`paths` thiếu 6 file) · B3 (`done_when` đòi ngược C2) · B4 (trỏ sai file `§restore-flag-failclosed`) · B5 (hoist `requireRateLimiter`) + W1–W5 |
| `plan-reviewer` vòng 3 | **PASS** — được thi công từ §7 bước 1 |
| Đo đột biến §5.5 | *(chờ)* |
| int-spec mới | *(chờ)* |
| Hồi quy §6 | *(chờ)* |
| `test:cov:sensitive` (sàn 80%) | *(chờ)* |
| `security-reviewer` (FULL) | *(chờ)* |
| `silent-failure-hunter` (FULL) | *(chờ)* |
| `database-reviewer` | **không cần** — 0 migration, 0 đổi schema (§2) |
